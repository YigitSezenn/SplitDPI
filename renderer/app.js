import { createFlow } from './flow.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const api = window.splitdpi;
const scene = createFlow($('#scene'));

let S = { running: false, startedAt: 0, settings: {}, presets: {}, domainCount: 0 };
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

const PRESET_STYLE = {
  discord: { letter: 'D', bg: 'linear-gradient(135deg,#5865f2,#7983f5)' },
  roblox: { letter: 'R', bg: 'linear-gradient(135deg,#3b3f47,#6b717d)' },
  wattpad: { letter: 'W', bg: 'linear-gradient(135deg,#ff6122,#ff8f4d)' },
};

// ---------- Yardımcılar ----------
const fmtBytes = (n) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 2 : 1) : Math.round(n)) + ' ' + u[i];
};
const pad = (n) => String(n).padStart(2, '0');
let toastTimer;
function toast(text, err = false) {
  const t = $('#toast');
  t.textContent = text; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
const cleanErr = (e) => String(e.message || e).replace(/^Error invoking remote method '\w+': (Error: )?/, '');

// ---------- Tema ----------
const SUN = 'M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z';
const MOON = 'M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z';
function applyTheme() {
  const pref = S.settings.theme || 'system';
  const theme = pref === 'system' ? (darkMQ.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = theme;
  scene.setTheme(theme);
  $('#themeIcon').setAttribute('d', theme === 'dark' ? MOON : SUN);
}
darkMQ.addEventListener('change', applyTheme);
$('#themeBtn').onclick = () => save({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }, false);

// ---------- Gezinme ----------
function go(page) {
  const btn = $(`.nav[data-page="${page}"]`);
  $$('.nav').forEach((n) => n.classList.toggle('active', n === btn));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  $('#navInd').style.transform = `translateY(${btn.offsetTop - 10}px)`;
}
$$('.nav').forEach((b) => (b.onclick = () => go(b.dataset.page)));
$('#scopeCard').onclick = () => go('sites');
$$('[data-win]').forEach((b) => (b.onclick = () => api.win(b.dataset.win)));

// ---------- Durum ----------
function render() {
  const on = S.running, s = S.settings;
  document.body.classList.toggle('on', on);
  scene.setActive(on);
  document.body.classList.toggle('svc-mode', !!s.serviceMode);
  $('#eyebrow').textContent = on ? (S.service ? 'Bağlı · arka plan servisi' : 'Bağlı') : 'Bağlı değil';
  $('#title').innerHTML = on ? 'Erişim<br />açık' : 'Süzgece<br />takılıyorsun';
  const scope = s.scope === 'all' ? 'tüm siteler' : `${S.domainCount} alan adı`;
  $('#sub').textContent = on
    ? (S.service ? `Arka plan servisi çalışıyor. Bu pencereyi kapatsan da erişim açık kalır. Kapsam: ${scope}.` : `Trafiğin bölünerek DPI'nın gözünden kaçıyor. Kapsam: ${scope}.`)
    : 'Discord ve seçtiğin siteler DPI tarafından engelleniyor. Erişimi açmak için bağlan.';
  $('#connectLabel').textContent = on ? 'Bağlantıyı kes' : 'Bağlan';
  $('#sScope').textContent = s.scope === 'all' ? 'Tüm siteler' : S.domainCount;
  const names = (s.presets || []).map((k) => S.presets[k] && S.presets[k].name).filter(Boolean);
  $('#sScopeSub').textContent = s.scope === 'all' ? 'tüm HTTPS trafiği' : (names.join(', ') || 'yalnızca özel liste');
  tick();
}

function tick() {
  if (!S.running || !S.startedAt) { $('#timer').textContent = '00:00:00'; return; }
  const sec = Math.floor((Date.now() - S.startedAt) / 1000);
  $('#timer').textContent = `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}
setInterval(tick, 1000);

$('#connectBtn').onclick = async () => {
  document.body.classList.add('busy');
  try { S.running = await api.toggle(); } finally { document.body.classList.remove('busy'); }
  if (!S.running) { resetSpark(); }
  render();
};

$('#discordBtn').onclick = async () => {
  try { toast(`${await api.launchDiscord()} SplitDPI üzerinden başlatılıyor`); } catch (e) { toast(cleanErr(e), true); }
};

api.on('state', (st) => { S.running = st.running; S.startedAt = st.startedAt; S.service = st.service; if (!st.running) resetSpark(); render(); });
api.on('hosts', (list) => (list || []).forEach((h) => scene.addHost(h)));

// ---------- İstatistik + canlı grafik ----------
const HIST = 60;
let upH = Array(HIST).fill(0), downH = Array(HIST).fill(0), last = null;
function resetSpark() { upH.fill(0); downH.fill(0); last = null; drawSpark(); $('#rUp').textContent = '0 B/s'; $('#rDown').textContent = '0 B/s'; }

api.on('stats', (st) => {
  $('#sBypassed').textContent = st.bypassed.toLocaleString('tr-TR');
  $('#sConn').textContent = `${st.connections.toLocaleString('tr-TR')} bağlantı`;
  $('#sTotal').textContent = fmtBytes(st.bytesUp + st.bytesDown);
  $('#sActive').textContent = `${st.active} aktif bağlantı`;
  if (last) {
    const up = Math.max(0, st.bytesUp - last.bytesUp), down = Math.max(0, st.bytesDown - last.bytesDown);
    upH.push(up); upH.shift(); downH.push(down); downH.shift();
    $('#rUp').textContent = fmtBytes(up) + '/s';
    $('#rDown').textContent = fmtBytes(down) + '/s';
    drawSpark();
  }
  last = { ...st };
});

const spark = $('#spark');
function drawSpark() {
  const dpr = devicePixelRatio || 1, w = spark.clientWidth, h = spark.clientHeight;
  if (!w) return;
  spark.width = w * dpr; spark.height = h * dpr;
  const g = spark.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const max = Math.max(2048, ...upH, ...downH) * 1.15;
  const series = (arr, color) => {
    const step = w / (HIST - 1);
    const y = (v) => h - 2 - (v / max) * (h - 6);
    g.beginPath(); g.moveTo(0, y(arr[0]));
    for (let i = 1; i < HIST; i++) {
      const x0 = (i - 1) * step, x1 = i * step, xm = (x0 + x1) / 2;
      g.bezierCurveTo(xm, y(arr[i - 1]), xm, y(arr[i]), x1, y(arr[i]));
    }
    g.strokeStyle = color; g.lineWidth = 1.8; g.stroke();
    g.lineTo(w, h); g.lineTo(0, h); g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
    g.fillStyle = grad; g.fill();
  };
  series(downH, css.getPropertyValue('--a1').trim());
  series(upH, css.getPropertyValue('--a2').trim());
}
new ResizeObserver(drawSpark).observe(spark);

// ---------- Kayıtlar ----------
const TAGS = { ok: 'ATLATILDI', warn: 'UYARI', error: 'HATA', info: 'BİLGİ' };
api.on('log', (l) => {
  const ul = $('#logs');
  const empty = ul.querySelector('.empty'); if (empty) empty.remove();
  const li = document.createElement('li'); li.className = l.level;
  const time = document.createElement('time'); time.textContent = new Date(l.t).toLocaleTimeString('tr-TR');
  const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = TAGS[l.level] || l.level;
  const msg = document.createElement('span'); msg.className = 'msg'; msg.textContent = l.msg;
  li.append(time, tag, msg);
  ul.prepend(li);
  while (ul.children.length > 400) ul.lastChild.remove();
  if (l.level === 'error') toast(l.msg, true);
  if (l.level === 'ok') scene.addHost(l.msg.split(' → ')[0]);
});
$('#clearLogs').onclick = () => ($('#logs').innerHTML = '<li class="empty">Kayıtlar temizlendi.</li>');
$$('#logFilter button').forEach((b) => (b.onclick = () => {
  $$('#logFilter button').forEach((x) => x.classList.toggle('on', x === b));
  $('#logs').className = 'logs' + (b.value === 'all' ? '' : ' f-' + b.value);
}));

// ---------- Siteler ----------
function renderPresets() {
  const box = $('#presets');
  box.innerHTML = '';
  for (const [key, p] of Object.entries(S.presets)) {
    const st = PRESET_STYLE[key] || { letter: p.name[0], bg: 'var(--a2)' };
    const on = (S.settings.presets || []).includes(key);
    const el = document.createElement('button');
    el.className = 'preset' + (on ? ' on' : '');
    el.innerHTML = `<span class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
      <span class="ico" style="background:${st.bg}">${st.letter}</span>
      <span><b></b><small></small></span>
      <span class="meta"><span>${p.count} alan adı</span></span>`;
    el.querySelector('b').textContent = p.name;
    el.querySelector('small').textContent = p.desc;
    el.onclick = () => {
      const cur = new Set(S.settings.presets || []);
      cur.has(key) ? cur.delete(key) : cur.add(key);
      save({ presets: [...cur] });
    };
    box.append(el);
  }
  // "Tüm siteler" kartı: açıkken diğer listeler gereksiz olur
  const all = S.settings.scope === 'all';
  const el = document.createElement('button');
  el.className = 'preset all' + (all ? ' on' : '');
  el.innerHTML = `<span class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    <span class="ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg></span>
    <span><b>Tüm siteler</b><small>Engelli olan her siteye eriş. Normal siteler etkilenmez.</small></span>
    <span class="meta"><span>Tüm HTTPS trafiği</span></span>`;
  el.onclick = () => save({ scope: all ? 'list' : 'all' });
  box.prepend(el);
  box.classList.toggle('scope-all', all);
}

// ---------- Ayarlar ----------
async function save(patch, notify = true) {
  try {
    const r = await api.saveSettings(patch);
    S.settings = r.settings; S.domainCount = r.domainCount;
    fillSettings(); applyTheme(); renderPresets(); render();
    if (notify) toast('Kaydedildi');
  } catch (e) { toast(cleanErr(e), true); }
}

function fillSettings() {
  $$('[data-k]').forEach((el) => {
    const v = S.settings[el.dataset.k];
    if (el.classList.contains('seg')) el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.value === String(v)));
    else if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'TEXTAREA') { if (document.activeElement !== el) el.value = (v || []).join('\n'); }
    else el.value = v;
  });
}

$$('[data-k]').forEach((el) => {
  const k = el.dataset.k;
  if (el.classList.contains('seg')) {
    el.querySelectorAll('button').forEach((b) => (b.onclick = (e) => { e.preventDefault(); save({ [k]: b.value }, k !== 'theme'); }));
    return;
  }
  el.addEventListener('change', () => {
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (el.tagName === 'TEXTAREA') v = el.value.split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
    if (k === 'port' && (v < 1024 || v > 65535)) { toast('Port 1024–65535 arasında olmalı', true); fillSettings(); return; }
    save({ [k]: v });
  });
});

// ---------- Başlangıç ----------
(async () => {
  const st = await api.getState();
  S = { ...S, ...st };
  $('#verTag').textContent = 'v' + st.version;
  $('#aboutVer').textContent = 'v' + st.version;
  fillSettings(); applyTheme(); renderPresets(); render();
  requestAnimationFrame(() => go('home'));
  if (!st.discord) { $('#discordBtn').disabled = true; $('#discordBtn').title = 'Discord kurulu bulunamadı'; }
})();
