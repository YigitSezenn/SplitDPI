'use strict';
// Motor testi: gerçek bir TLS istemcisi proxy üzerinden yerel bir TLS sunucusuna bağlanır.
// Sunucunun ilk aldığı baytlar bölünmüş olmalı, el sıkışma yine de başarılı olmalı.
const assert = require('assert');
const net = require('net');
const http = require('http');
const tlsNode = require('tls');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('../engine/tls');
const { SplitProxy } = require('../engine/proxy');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'splitdpi-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=discord.com',
  '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1'], { stdio: 'ignore' });
const key = fs.readFileSync(path.join(dir, 'k.pem'));
const cert = fs.readFileSync(path.join(dir, 'c.pem'));

function captureClientHello() {
  return new Promise((resolve) => {
    const srv = net.createServer((s) => s.once('data', (d) => { resolve(d); s.destroy(); srv.close(); }));
    srv.listen(0, () => {
      const c = tlsNode.connect({ port: srv.address().port, servername: 'gateway.discord.gg', rejectUnauthorized: false });
      c.on('error', () => {});
    });
  });
}

(async () => {
  // 1) Ayrıştırma ve bölme
  const hello = await captureClientHello();
  const sni = t.findSni(hello);
  assert.strictEqual(sni.host, 'gateway.discord.gg');
  const split = t.splitRecord(hello, sni.offset + 5);
  assert.strictEqual(split.length, hello.length + 5);
  assert.strictEqual(t.recordLength(split), 5 + (sni.offset + 5 - 5));
  const parts = t.desync(hello, { tlsRecordSplit: true, tcpSplit: true, chunkSize: 0 });
  assert.ok(parts.length >= 3, 'en az 3 TCP parçası');
  assert.ok(!Buffer.concat(parts).includes('gateway.discord.gg'), 'SNI tek parçada görünmemeli');
  console.log('✓ SNI bulundu ve bölündü:', parts.map((p) => p.length).join(' + '));

  // 2) Uçtan uca: proxy üzerinden TLS el sıkışması (bölünmüş kayıtlarla)
  const server = tlsNode.createServer({ key, cert }, (s) => s.end('merhaba'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const proxy = new SplitProxy({ port: 0, dns: 'system', scope: 'list', domains: ["discord.gg", "localhost"], delayMs: 10, allowPrivate: true });
  proxy.opts.port = 18881;
  await proxy.start();

  const reply = await new Promise((resolve, reject) => {
    const s = net.connect(18881, '127.0.0.1', () => s.write(`CONNECT localhost:${port} HTTP/1.1\r\nHost: localhost\r\n\r\n`));
    s.once('data', (d) => {
      assert.ok(d.toString().startsWith('HTTP/1.1 200'));
      const c = tlsNode.connect({ socket: s, servername: 'gateway.discord.gg', rejectUnauthorized: false });
      let body = '';
      c.on('data', (x) => (body += x));
      c.on('end', () => resolve(body));
      c.on('error', reject);
    });
  });
  assert.strictEqual(reply, 'merhaba');
  assert.strictEqual(proxy.stats.bypassed, 1);
  console.log('✓ Bölünmüş TLS kayıtlarıyla proxy üzerinden el sıkışma başarılı');

  await proxy.stop();
  server.close();

  // 3) Güvenlik: yerel/özel adreslere yönlendirme engellenir (DNS rebinding koruması)
  const guard = new SplitProxy({ port: 18882, dns: 'system', scope: 'all' });
  await guard.start();
  const raw = (payload, port = 18882) => new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(payload));
    let out = ''; s.on('data', (d) => (out += d)); s.on('close', () => resolve(out)); s.on('error', () => resolve(out));
    setTimeout(() => s.destroy(), 2000);
  });
  for (const target of ['127.0.0.1:443', 'localhost:80', '192.168.1.1:80', '10.0.0.1:443', '[::1]:443', '169.254.169.254:80']) {
    const r = await raw(`CONNECT ${target} HTTP/1.1\r\n\r\n`);
    assert.ok(r.startsWith('HTTP/1.1 403'), `CONNECT ${target} engellenmeli: ${r.split('\r\n')[0]}`);
  }
  const r2 = await raw('GET http://127.0.0.1:8080/admin HTTP/1.1\r\nHost: 127.0.0.1:8080\r\n\r\n');
  assert.ok(r2.startsWith('HTTP/1.1 403'), 'düz HTTP ile yerel adres engellenmeli');
  await guard.stop();
  console.log('✓ Yerel ve özel ağ adreslerine yönlendirme engelleniyor (403)');

  // 4) Güvenlik: aynı bağlantıdaki ikinci düz HTTP isteği ilk sunucuya ASLA gitmez
  const hits = { a: [], b: [] };
  const mk = (name) => http.createServer((req, res) => { hits[name].push(req.url); res.setHeader('Connection', 'keep-alive'); res.end(name); });
  const A = mk('a'), B = mk('b');
  await new Promise((r) => A.listen(0, '127.0.0.1', r));
  await new Promise((r) => B.listen(0, '127.0.0.1', r));
  const pa = A.address().port, pb = B.address().port;
  const hp = new SplitProxy({ port: 18883, dns: 'system', scope: 'all', allowPrivate: true });
  await hp.start();
  const both = await raw(
    `GET http://127.0.0.1:${pa}/ilk HTTP/1.1\r\nHost: 127.0.0.1:${pa}\r\nProxy-Connection: keep-alive\r\n\r\n` +
    `GET http://127.0.0.1:${pb}/ikinci HTTP/1.1\r\nHost: 127.0.0.1:${pb}\r\nCookie: gizli=1\r\n\r\n`, 18883);
  assert.deepStrictEqual(hits.a, ['/ilk'], 'A sunucusu yalnızca kendi isteğini almalı');
  assert.ok(!hits.a.includes('/ikinci'), 'ikinci istek A sunucusuna sızmamalı');
  assert.ok(both.includes('\r\n\r\na'), 'ilk isteğin yanıtı dönmeli');
  // Gövdeli istek (POST) yalnızca kendi gövdesini taşımalı
  const post = await raw(`POST http://127.0.0.1:${pa}/form HTTP/1.1\r\nHost: 127.0.0.1:${pa}\r\nContent-Length: 5\r\n\r\nmerhaGET /x HTTP/1.1\r\n\r\n`, 18883);
  assert.ok(post.includes('\r\n\r\na'), 'POST yanıtı dönmeli');
  assert.deepStrictEqual(hits.a, ['/ilk', '/form'], 'POST sonrası fazladan istek iletilmemeli');
  await hp.stop(); A.close(); B.close();
  console.log('✓ Düz HTTP: bağlantı başına tek istek, sonraki istekler başka sunucuya sızmıyor');

  console.log('Tüm testler geçti.');
  process.exit(0);
})().catch((e) => { console.error('✗', e); process.exit(1); });
