'use strict';
// Motor testi: gerçek bir TLS istemcisi proxy üzerinden yerel bir TLS sunucusuna bağlanır.
// Sunucunun ilk aldığı baytlar bölünmüş olmalı, el sıkışma yine de başarılı olmalı.
const assert = require('assert');
const net = require('net');
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

  const proxy = new SplitProxy({ port: 0, dns: 'system', scope: 'list', domains: ["discord.gg", "localhost"], delayMs: 10 });
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
  console.log('Tüm testler geçti.');
  process.exit(0);
})().catch((e) => { console.error('✗', e); process.exit(1); });
