'use strict';
// DNS-over-HTTPS çözücü. ISS DNS zehirlemesini atlatır.
// Sunuculara IP üzerinden bağlanılır: SNI yok, bootstrap DNS gerekmez.
const https = require('https');
const net = require('net');

const PROVIDERS = {
  cloudflare: { host: '1.1.1.1', path: '/dns-query' },
  google: { host: '8.8.8.8', path: '/resolve' },
};

const cache = new Map(); // host -> { ip, expires }

function query(provider, name, type) {
  const p = PROVIDERS[provider] || PROVIDERS.cloudflare;
  const path = `${p.path}?name=${encodeURIComponent(name)}&type=${type}`;
  return new Promise((resolve, reject) => {
    const req = https.get({ host: p.host, path, headers: { accept: 'application/dns-json' }, timeout: 4000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; if (body.length > 65536) req.destroy(new Error('DoH yanıtı çok büyük')); });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const want = type === 'AAAA' ? 28 : 1;
          const ans = (json.Answer || []).filter((a) => a.type === want);
          if (!ans.length) return resolve(null);
          if (!net.isIP(ans[0].data)) return resolve(null);
          resolve({ ip: ans[0].data, ttl: Math.max(30, Math.min(ans[0].TTL || 300, 3600)) });
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('DoH zaman aşımı')));
    req.on('error', reject);
  });
}

/** Host adını IPv4 adresine çevirir (gerekirse IPv6). */
async function resolve(host, provider = 'cloudflare') {
  if (net.isIP(host)) return host;
  const key = `${provider}:${host}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.ip;

  const order = [provider, ...Object.keys(PROVIDERS).filter((k) => k !== provider)];
  let lastErr;
  for (const prov of order) {
    try {
      const r = (await query(prov, host, 'A')) || (await query(prov, host, 'AAAA'));
      if (r) {
        cache.set(key, { ip: r.ip, expires: Date.now() + r.ttl * 1000 });
        return r.ip;
      }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`Çözülemedi: ${host}`);
}

function clearCache() { cache.clear(); }

module.exports = { resolve, clearCache, PROVIDERS };
