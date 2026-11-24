'use strict';
// Yerel HTTP/HTTPS proxy. HTTPS bağlantılarında ilk paketi (ClientHello) bölerek DPI'yı şaşırtır.
const net = require('net');
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

  async lookup(host) {
    if (this.opts.dns === 'doh') return doh.resolve(host, this.opts.dohProvider);
    return host; // sistem DNS'i net.connect yapar
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
      this.log('warn', `${host}: ${e.message}`);
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
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

  async handleHttp(client, method, target, headerText, rest) {
    // Düz HTTP: hedefe yönlendir (Host başlığını parçalamak gerekmez, Discord HTTPS kullanır)
    let url;
    try { url = new URL(target); } catch { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    // Yalnızca mutlak http:// istekleri (tarayıcı sayfalarının DNS rebinding ile proxy'yi kötüye kullanmasını engeller)
    if (url.protocol !== 'http:' || !(HOST_RE.test(url.hostname) || net.isIP(url.hostname))) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const port = parseInt(url.port, 10) || 80;
    this.stats.connections++;
    let up;
    try { up = await this.connectUpstream(url.hostname, port); } catch (e) {
      this.stats.errors++;
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    this.track(up);
    const lines = headerText.split('\r\n');
    lines[0] = `${method} ${url.pathname}${url.search} ${lines[0].split(' ')[2] || 'HTTP/1.1'}`;
    const filtered = lines.filter((l) => !/^proxy-connection:/i.test(l));
    up.write(filtered.join('\r\n') + '\r\n\r\n');
    if (rest.length) up.write(rest);
    client.pipe(up); up.pipe(client);
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
    client.resume();
  }
}

module.exports = { SplitProxy, DEFAULTS, DISCORD_DOMAINS };
