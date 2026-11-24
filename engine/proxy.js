'use strict';
// Yerel HTTP/HTTPS proxy. HTTPS bağlantılarında ilk paketi (ClientHello) bölerek DPI'yı şaşırtır.
const net = require('net');
const dns = require('dns');
const { EventEmitter } = require('events');
const tls = require('./tls');
const doh = require('./doh');

const DISCORD_DOMAINS = [
  'discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media',
  'discordcdn.com', 'discord.dev', 'discord.new', 'discord.gift', 'discordstatus.com', 'dis.gd',
];

const DEFAULTS = {
  port: 8881,
  scope: 'list',            // 'list' | 'all'
  domains: DISCORD_DOMAINS.slice(),
  tlsRecordSplit: true,
  tcpSplit: true,
  chunkSize: 0,             // 0 = kalanı tek parça gönder
  delayMs: 5,               // parçalar arası bekleme
  dns: 'doh',               // 'doh' | 'system'
  dohProvider: 'cloudflare',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_CLIENTS = 1024;          // eşzamanlı bağlantı sınırı (dosya tanıtıcısı tükenmesini önler)
const IDLE_MS = 5 * 60 * 1000;     // 5 dk hareketsiz tünel kapatılır
const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,62}\.)*[a-z0-9-]{1,63}$/i;

// Proxy'nin asla bağlanmayacağı adresler: yerel makine, ev/şirket ağı, bağlantı-yerel, CGNAT, çok noktaya yayın.
// Proxy adları kendisi çözdüğü için tarayıcının yerel ağ korumaları devreye girmez; bu liste
// bir web sayfasının DNS rebinding ile bilgisayardaki ya da ağdaki servislere ulaşmasını engeller.
const PRIVATE = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) PRIVATE.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) PRIVATE.addSubnet(a, p, 'ipv6');

function isPublicAddress(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); // IPv4'e eşlenmiş IPv6
  if (mapped) ip = mapped[1];
  const type = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
  return !!type && !PRIVATE.check(ip, type);
}

class ProxyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function matches(host, domains) {
  host = host.toLowerCase();
  return domains.some((d) => host === d || host.endsWith('.' + d));
}

class SplitProxy extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = { ...DEFAULTS, ...opts };
    this.server = null;
    this.sockets = new Set();
    this.stats = { connections: 0, active: 0, bypassed: 0, bytesUp: 0, bytesDown: 0, errors: 0 };
  }

  update(opts) { this.opts = { ...this.opts, ...opts }; doh.clearCache(); }

  shouldBypass(host) { return this.opts.scope === 'all' || matches(host, this.opts.domains); }

  /** Adı IP'ye çevirir. Bağlanılacak adres tam olarak bu fonksiyonun döndürdüğüdür (denetim atlatılamaz). */
  async lookup(host) {
    if (net.isIP(host)) return host;
    if (this.opts.dns === 'doh') return doh.resolve(host, this.opts.dohProvider);
    const { address } = await dns.promises.lookup(host);
    return address;
  }

  log(level, msg) { this.emit('log', { t: Date.now(), level, msg }); }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((c) => this.handle(c));
      this.server.on('error', reject);
      this.server.listen(this.opts.port, '127.0.0.1', () => {
        this.log('info', `Proxy 127.0.0.1:${this.opts.port} üzerinde dinliyor`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      for (const s of this.sockets) s.destroy();
      this.sockets.clear();
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  track(sock) {
    this.sockets.add(sock);
    sock.on('close', () => this.sockets.delete(sock));
  }

  handle(client) {
    if (this.sockets.size >= MAX_CLIENTS) { client.destroy(); return; }
    this.track(client);
    client.setTimeout(IDLE_MS, () => client.destroy());
    client.setNoDelay(true);
    client.on('error', () => {});
    let head = Buffer.alloc(0);
    const onData = (d) => {
      head = Buffer.concat([head, d]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) {
        if (head.length > 16384) client.destroy();
        return;
      }
      client.removeListener('data', onData);
      client.pause();
      const headerText = head.subarray(0, end).toString('latin1');
      const rest = head.subarray(end + 4);
      const [requestLine] = headerText.split('\r\n');
      const [method, target] = requestLine.split(' ');
      if (method === 'CONNECT') this.handleConnect(client, target, rest);
      else this.handleHttp(client, method, target, headerText, rest);
    };
    client.on('data', onData);
  }

  async connectUpstream(host, port) {
    const ip = await this.lookup(host);
    if (!this.opts.allowPrivate && !isPublicAddress(ip)) {
      throw new ProxyError(403, `${host} yerel/özel bir adrese (${ip}) çözüldü; güvenlik nedeniyle engellendi`);
    }
    return new Promise((resolve, reject) => {
      const up = net.connect({ host: ip, port, timeout: 10000 });
      up.setNoDelay(true);
      up.once('connect', () => { up.setTimeout(0); resolve(up); });
      up.once('timeout', () => up.destroy(new Error('Bağlantı zaman aşımı')));
      up.once('error', reject);
    });
  }

  async handleConnect(client, target, rest) {
    const idx = target.lastIndexOf(':');
    const host = target.slice(0, idx).replace(/^\[|\]$/g, '');
    const port = parseInt(target.slice(idx + 1), 10);
    if (idx < 1 || !(port >= 1 && port <= 65535) || !(HOST_RE.test(host) || net.isIP(host))) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const hostMatch = this.shouldBypass(host);
    this.stats.connections++; this.stats.active++;
    this.emit('stats', this.stats);

    let up;
    try {
      up = await this.connectUpstream(host, port);
    } catch (e) {
      this.stats.errors++; this.stats.active--;
      this.log('warn', e.status === 403 ? e.message : `${host}: ${e.message}`);
      client.end(e.status === 403 ? 'HTTP/1.1 403 Forbidden\r\n\r\n' : 'HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    this.track(up);
    up.setTimeout(IDLE_MS, () => up.destroy());
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
    const done = () => { this.stats.active = Math.max(0, this.stats.active - 1); this.emit('stats', this.stats); };
    client.once('close', () => { up.destroy(); done(); });

    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    // İlk TLS kaydını tamamen topla, sonra bölerek gönder
    let first = rest;
    const sendFirst = async () => {
      const sniInfo = tls.findSni(first);
      const bypass = hostMatch || (sniInfo && this.shouldBypass(sniInfo.host));
      if (bypass && tls.isTlsHandshake(first)) {
        const parts = tls.desync(first, this.opts);
        if (parts.length > 1) {
          this.stats.bypassed++;
          const sni = tls.findSni(first);
          this.log('ok', `${sni ? sni.host : host} → ${parts.length} parça`);
        }
        for (let i = 0; i < parts.length; i++) {
          up.write(parts[i]);
          if (i < parts.length - 1 && this.opts.delayMs > 0) await sleep(this.opts.delayMs);
        }
      } else if (first.length) {
        up.write(first);
      }
      this.stats.bytesUp += first.length;
      pipe();
    };
    const pipe = () => {
      client.on('data', (d) => { this.stats.bytesUp += d.length; up.write(d); });
      up.on('data', (d) => { this.stats.bytesDown += d.length; client.write(d); });
      client.on('end', () => up.end());
      up.on('end', () => client.end());
      client.resume();
    };

    // Port 443 dışı ve listede olmayan bağlantılar dokunulmadan geçer
    if (!hostMatch && port !== 443) { if (first.length) up.write(first); pipe(); return; }

    const need = () => {
      if (!tls.isTlsHandshake(first) && first.length >= 5) return false; // TLS değil
      const len = tls.recordLength(first);
      return len < 0 || first.length < len;
    };
    if (first.length && !need()) return sendFirst();

    const timer = setTimeout(() => { client.pause(); client.removeListener('data', collect); sendFirst(); }, 300);
    const collect = (d) => {
      first = Buffer.concat([first, d]);
      if (!need()) { clearTimeout(timer); client.removeListener('data', collect); client.pause(); sendFirst(); }
    };
    client.on('data', collect);
    client.resume();
  }

  /**
   * Düz HTTP (şifresiz) istekleri. Bağlantı başına TEK istek işlenir:
   * hedef sunucu her istekte yeniden seçilmediği için aynı bağlantıdan gelen ikinci bir isteğin
   * (farklı bir siteye ait olsa bile) ilk sunucuya aktarılmasını önlemenin güvenli yolu budur.
   */
  async handleHttp(client, method, target, headerText, rest) {
    const reply = (status) => client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nProxy-Connection: close\r\nContent-Length: 0\r\n\r\n`);
    let url;
    try { url = new URL(target); } catch { reply('400 Bad Request'); return; }
    // Yalnızca mutlak http:// istekleri kabul edilir. Sayfaların proxy portuna doğrudan yaptığı
    // ("GET / HTTP/1.1") istekler bu sayede reddedilir.
    if (url.protocol !== 'http:' || !(HOST_RE.test(url.hostname) || net.isIP(url.hostname.replace(/^\[|\]$/g, '')))) { reply('400 Bad Request'); return; }

    const lines = headerText.split('\r\n');
    const version = /^HTTP\/1\.[01]$/.test(lines[0].split(' ')[2] || '') ? lines[0].split(' ')[2] : 'HTTP/1.1';
    const headers = lines.slice(1);
    const get = (name) => {
      const h = headers.find((l) => l.toLowerCase().startsWith(name + ':'));
      return h ? h.slice(name.length + 1).trim() : null;
    };
    // Parçalı (chunked) istek gövdeleri desteklenmez; gövde sınırı belirsiz olur
    if (get('transfer-encoding')) { reply('501 Not Implemented'); return; }
    const clRaw = get('content-length');
    if (clRaw !== null && !/^\d{1,12}$/.test(clRaw)) { reply('400 Bad Request'); return; }
    let remaining = clRaw === null ? 0 : parseInt(clRaw, 10);

    const port = parseInt(url.port, 10) || 80;
    this.stats.connections++;
    let up;
    try { up = await this.connectUpstream(url.hostname.replace(/^\[|\]$/g, ''), port); } catch (e) {
      this.stats.errors++;
      if (e.status === 403) this.log('warn', e.message);
      reply(e.status === 403 ? '403 Forbidden' : '502 Bad Gateway');
      return;
    }
    this.track(up);
    up.setTimeout(IDLE_MS, () => up.destroy());
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());

    // Bağlantıyı kalıcı tutan başlıkları kaldır, sunucuya bağlantıyı istekten sonra kapatmasını söyle
    const HOP = /^(connection|keep-alive|proxy-connection|proxy-authorization|te|trailer|upgrade):/i;
    const out = [`${method} ${url.pathname}${url.search} ${version}`, ...headers.filter((l) => l && !HOP.test(l)), 'Connection: close'];
    up.write(out.join('\r\n') + '\r\n\r\n');

    // Yalnızca bu isteğin gövdesini aktar; fazlası (ardışık ikinci istek) yok sayılır
    const forward = (chunk) => {
      if (remaining <= 0) return;
      const part = chunk.subarray(0, remaining);
      remaining -= part.length;
      this.stats.bytesUp += part.length;
      up.write(part);
      if (remaining <= 0) { client.removeListener('data', forward); client.pause(); }
    };
    if (rest.length) forward(rest);
    if (remaining > 0) { client.on('data', forward); client.resume(); }

    up.on('data', (d) => { this.stats.bytesDown += d.length; client.write(d); });
    up.on('end', () => client.end());
    client.on('close', () => up.destroy());
  }
}

module.exports = { SplitProxy, DEFAULTS, DISCORD_DOMAINS };
