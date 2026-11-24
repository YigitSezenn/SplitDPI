'use strict';
// TLS ClientHello ayrıştırma ve "desync" (bölme) yardımcıları.
// Mantık GoodbyeDPI / ByeDPI ile aynı: DPI kutusu SNI'yi tek parçada göremezse eşleştiremez.

/** Buffer TLS handshake kaydıyla mı başlıyor? */
function isTlsHandshake(buf) {
  return buf.length >= 5 && buf[0] === 0x16 && buf[1] === 0x03;
}

/** İlk TLS kaydının toplam uzunluğu (başlık dahil). Yeterli veri yoksa -1. */
function recordLength(buf) {
  if (buf.length < 5) return -1;
  return 5 + buf.readUInt16BE(3);
}

/**
 * ClientHello içinden SNI'yi bulur.
 * Dönüş: { host, offset } — offset, host adının buf içindeki başlangıç konumu. Bulunamazsa null.
 */
function findSni(buf) {
  try {
    if (!isTlsHandshake(buf)) return null;
    let p = 5;
    if (buf[p] !== 0x01) return null; // ClientHello değil
    p += 4;           // handshake type + length(3)
    p += 2 + 32;      // version + random
    p += 1 + buf[p];  // session id
    p += 2 + buf.readUInt16BE(p); // cipher suites
    p += 1 + buf[p];  // compression methods
    const extEnd = p + 2 + buf.readUInt16BE(p);
    p += 2;
    while (p + 4 <= extEnd && p + 4 <= buf.length) {
      const type = buf.readUInt16BE(p);
      const len = buf.readUInt16BE(p + 2);
      p += 4;
      if (type === 0x0000) {
        // server_name: list len(2), name type(1), name len(2), name
        const nameLen = buf.readUInt16BE(p + 3);
        const offset = p + 5;
        if (offset + nameLen > buf.length) return null;
        return { host: buf.toString('ascii', offset, offset + nameLen), offset, length: nameLen };
      }
      p += len;
    }
  } catch (_) { /* bozuk paket */ }
  return null;
}

/**
 * İlk TLS kaydını `at` noktasından iki ayrı TLS kaydına böler (tlsrec).
 * at: kayıt gövdesine göre değil, buf'a göre mutlak konum (5 < at < recordEnd).
 */
function splitRecord(buf, at) {
  const end = recordLength(buf);
  if (end < 0 || end > buf.length || at <= 5 || at >= end) return buf;
  const head = buf.subarray(0, 3); // type + version
  const body1 = buf.subarray(5, at);
  const body2 = buf.subarray(at, end);
  const h1 = Buffer.alloc(5); head.copy(h1); h1.writeUInt16BE(body1.length, 3);
  const h2 = Buffer.alloc(5); head.copy(h2); h2.writeUInt16BE(body2.length, 3);
  return Buffer.concat([h1, body1, h2, body2, buf.subarray(end)]);
}

/**
 * Ayarlara göre ilk paketi gönderilecek parçalara çevirir.
 * opts: { tlsRecordSplit: bool, tcpSplit: bool, chunkSize: number }
 * Dönüş: Buffer[] — her biri ayrı TCP yazımı olarak gönderilir.
 */
function desync(buf, opts) {
  const sni = findSni(buf);
  if (!sni) return [buf];
  const mid = sni.offset + Math.max(1, Math.floor(sni.length / 2));

  let data = buf;
  let shift = 0;
  if (opts.tlsRecordSplit) {
    data = splitRecord(buf, mid);
    if (data !== buf) shift = 5; // araya ikinci kayıt başlığı girdi
  }
  if (!opts.tcpSplit) return [data];

  // SNI'nin başından ve ortasından TCP olarak da böl
  const cuts = [sni.offset + 1, mid + shift].filter((c, i, a) => c > 0 && c < data.length && a.indexOf(c) === i).sort((a, b) => a - b);
  const parts = [];
  let last = 0;
  for (const c of cuts) { parts.push(data.subarray(last, c)); last = c; }
  // Kalanı isteğe bağlı küçük parçalara ayır
  const size = opts.chunkSize > 0 ? opts.chunkSize : data.length;
  while (last < data.length) {
    parts.push(data.subarray(last, Math.min(last + size, data.length)));
    last += size;
  }
  return parts;
}

module.exports = { isTlsHandshake, recordLength, findSni, splitRecord, desync };
