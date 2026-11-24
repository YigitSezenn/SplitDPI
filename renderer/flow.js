// Paket akışı görselleştirmesi.
// Site adını taşıyan paketler soldan sağa DPI kapısına ilerler.
// Kapalı: kapı SNI'yi okur, paket kırmızıya döner ve düşer.
// Açık: paket, motorun gerçekten kestiği yerlerden (1. karakter + SNI ortası) parçalanır,
//        kapıdan tanınmadan geçer ve karşıda yeniden birleşir.

const SAMPLE = ['discord.com', 'gateway.discord.gg', 'cdn.discordapp.com', 'media.discordapp.net',
  'roblox.com', 'wattpad.com', 'status.discord.com', 'images-ext-1.discordapp.net', 'rbxcdn.com'];

const ROWS = 5;
const SPEED = 95;            // px/sn
const PILL_H = 28;

export function createFlow(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let on = false, mix = 0;   // mix: 0 kapalı → 1 açık (geçiş animasyonu)
  let colors = {};
  const packets = [];
  const live = [];           // gerçek trafikten gelen adlar
  let spawnT = 0, gateFlash = 0, gateFlashBad = false, lastT = performance.now(), visible = true;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = { text: v('--text'), text2: v('--text-2'), muted: v('--muted'), a1: v('--a1'), a2: v('--a2'), ok: v('--ok'), off: v('--off'), border: v('--border-2'), surface: v('--surface-3') };
  }

  function resize() {
    dpr = devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
  }
  new ResizeObserver(resize).observe(canvas);

  // Geometri: akış alanı kahraman metninin sağında
  const geo = () => {
    const xs = Math.max(W * 0.47, 430), xe = W - 40;
    const xg = xs + (xe - xs) * 0.48;
    const gap = Math.min(52, (H - 140) / (ROWS - 1));
    const y0 = H / 2 - gap * (ROWS - 1) / 2 - 8;
    return { xs, xe, xg, gap, y0 };
  };

  const font = '500 12px "Cascadia Code", Consolas, monospace';
  const measure = (s) => { ctx.font = font; return ctx.measureText(s).width; };

  function spawn() {
    const g = geo();
    const host = live.length && Math.random() < 0.85 ? live[(Math.random() * live.length) | 0] : SAMPLE[(Math.random() * SAMPLE.length) | 0];
    const free = [...Array(ROWS).keys()].filter((r) => !packets.some((p) => p.row === r && p.x < g.xs + 140));
    if (!free.length) return;
    const row = free[(Math.random() * free.length) | 0];
    const mid = Math.max(2, Math.floor(host.length / 2));
    const parts = [host.slice(0, 1), host.slice(1, mid), host.slice(mid)];
    const widths = parts.map(measure);
    packets.push({ host, parts, widths, w: measure(host) + 22, row, x: g.xs - 20, split: 0, state: 'go', t: 0, alpha: 0, passed: false });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawPill(x, y, w, label, stroke, fill, textColor, alpha) {
    ctx.globalAlpha = alpha;
    roundRect(x, y - PILL_H / 2, w, PILL_H, 8);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = stroke; ctx.stroke();
    ctx.fillStyle = textColor; ctx.font = font; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 11, y + 0.5);
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!visible) return;
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    mix += ((on ? 1 : 0) - mix) * Math.min(1, dt * 4);
    gateFlash = Math.max(0, gateFlash - dt * 2.5);
    const g = geo();

    // Yeni paket
    spawnT -= dt;
    if (spawnT <= 0) { spawn(); spawnT = (on ? 0.45 : 0.75) + Math.random() * 0.5; }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Raylar
    ctx.lineWidth = 1;
    for (let r = 0; r < ROWS; r++) {
      const y = g.y0 + r * g.gap;
      ctx.strokeStyle = colors.border; ctx.globalAlpha = 0.6;
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(g.xs, y); ctx.lineTo(g.xe, y); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // Uç etiketleri
    ctx.font = '600 10.5px "Segoe UI Variable", "Segoe UI", sans-serif';
    ctx.fillStyle = colors.muted; ctx.textBaseline = 'alphabetic';
    const top = g.y0 - 34;
    ctx.textAlign = 'left'; ctx.fillText('BİLGİSAYARIN', g.xs, top);
    ctx.textAlign = 'right'; ctx.fillText('SUNUCU', g.xe, top);

    // DPI kapısı
    const gateCol = gateFlashBad ? colors.off : colors.text2;
    const gTop = g.y0 - 26, gBot = g.y0 + g.gap * (ROWS - 1) + 26;
    ctx.textAlign = 'center';
    ctx.fillStyle = mix < 0.5 ? colors.off : colors.muted;
    ctx.fillText('DPI', g.xg, top);
    ctx.font = '500 10px "Segoe UI Variable", "Segoe UI", sans-serif';
    ctx.fillStyle = colors.muted;
    ctx.fillText(mix < 0.5 ? 'SNI okunuyor' : 'SNI okunamıyor', g.xg, gBot + 18);
    ctx.strokeStyle = mix < 0.5 ? colors.off : colors.border;
    ctx.globalAlpha = 0.55 + gateFlash * 0.45;
    ctx.lineWidth = 1.5 + gateFlash * 1.5;
    ctx.beginPath(); ctx.moveTo(g.xg, gTop); ctx.lineTo(g.xg, gBot); ctx.stroke();
    for (let y = gTop; y <= gBot; y += 8) { ctx.beginPath(); ctx.moveTo(g.xg - 3, y); ctx.lineTo(g.xg + 3, y); ctx.stroke(); }
    if (gateFlash > 0) {
      ctx.globalAlpha = gateFlash * 0.12; ctx.fillStyle = gateCol;
      ctx.fillRect(g.xg - 18, gTop, 36, gBot - gTop);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';

    // Paketler
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      const y = g.y0 + p.row * g.gap;
      p.alpha = Math.min(1, p.alpha + dt * 4);
      const front = p.x + p.w;

      if (p.state === 'go') {
        p.x += SPEED * dt;
        // Bölünme: kapıdan önce açıl, sonra kapan
        const dist = g.xg - front;
        if (on) {
          if (dist < 90 && !p.passed) p.split = Math.min(1, p.split + dt * 3);
          if (p.x > g.xg + 12) { p.passed = true; p.split = Math.max(0, p.split - dt * 4); }
        } else p.split = Math.max(0, p.split - dt * (p.passed ? 4 : 3));
        // Kapıya çarptı
        if (front >= g.xg && !p.passed) {
          if (on || p.split > 0.6) { p.passed = true; gateFlash = 0.6; gateFlashBad = false; }
          else { p.state = 'scan'; p.t = 0; gateFlash = 1; gateFlashBad = true; }
        }
        if (p.x > g.xe + 10) { packets.splice(i, 1); continue; }
      } else if (p.state === 'scan') {
        p.t += dt;
        if (p.t > 0.45) { p.state = 'drop'; p.t = 0; }
      } else if (p.state === 'drop') {
        p.t += dt;
        if (p.t > 0.7) { packets.splice(i, 1); continue; }
      }

      // Çizim
      const blocked = p.state !== 'go';
      const dropY = p.state === 'drop' ? p.t * p.t * 90 : 0;
      const fade = p.state === 'drop' ? 1 - p.t / 0.7 : 1;
      const done = p.passed && p.split < 0.05;
      let stroke = colors.border, fill = colors.surface, tc = colors.text2;
      if (blocked) { stroke = colors.off; tc = colors.off; }
      else if (done) { stroke = colors.a1; tc = colors.text; }

      if (p.split < 0.02 || blocked) {
        const label = done ? '✓ ' + p.host : blocked ? '✕ ' + p.host : p.host;
        const w = done || blocked ? p.w + measure('✓ ') : p.w;
        drawPill(blocked ? p.x - (w - p.w) : p.x, y + dropY, w, label, stroke, fill, tc, p.alpha * fade);
      } else {
        // Parçalar arasında boşluk aç (gerçek kesim noktaları)
        const gap = p.split * 12;
        let x = p.x;
        p.parts.forEach((part, k) => {
          const w = p.widths[k] + 14;
          drawPill(x, y, w, part, on ? colors.a2 : stroke, fill, tc, p.alpha);
          // Ayrı TLS kaydı başlığını simgeleyen küçük işaret
          if (k > 0 && p.split > 0.3) {
            ctx.globalAlpha = p.split * p.alpha; ctx.fillStyle = colors.a2;
            ctx.fillRect(x - 1, y - PILL_H / 2 - 5, 2, 3);
            ctx.globalAlpha = 1;
          }
          x += w + gap - 3;
        });
      }
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) { lastT = performance.now(); requestAnimationFrame(frame); }
  });

  readColors();
  resize();
  requestAnimationFrame(frame);

  return {
    setActive(v) { on = v; },
    setTheme() { requestAnimationFrame(readColors); },
    addHost(h) {
      if (!h || live.includes(h)) return;
      live.push(h); if (live.length > 30) live.shift();
    },
  };
}
