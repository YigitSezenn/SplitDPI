'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { SplitProxy, DEFAULTS, DISCORD_DOMAINS } = require('./engine/proxy');
const { PRESETS, buildDomains } = require('./engine/presets');
const system = require('./engine/system');

// İki çalışma biçimi:
//   normal     → pencere + tepsi
//   --service  → penceresiz, tepsisiz arka plan servisi (GoodbyeDPI servisi gibi)
const SERVICE = process.argv.includes('--service');
const DATA = path.join(app.getPath('appData'), 'SplitDPI'); // %APPDATA%\SplitDPI
app.setPath('userData', DATA);
// 1.1 sürümünden (eski adı "Geçit") ayarları taşı
try {
  const OLD = path.join(app.getPath('appData'), 'Geçit', 'ayarlar.json');
  if (!fs.existsSync(path.join(DATA, 'ayarlar.json')) && fs.existsSync(OLD)) { fs.mkdirSync(DATA, { recursive: true }); fs.copyFileSync(OLD, path.join(DATA, 'ayarlar.json')); }
} catch { /* yok say */ }
const SETTINGS_FILE = path.join(DATA, 'ayarlar.json');
const STATUS_FILE = path.join(DATA, 'servis.json');
if (SERVICE) app.setPath('userData', path.join(DATA, 'servis-profili')); // ayrı tek-örnek kilidi

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.yigit.splitdpi');

// ---------- Ayarlar ----------
const BASE = { ...DEFAULTS, scope: 'all', presets: ['discord'], customDomains: [], theme: 'system', systemProxy: true,
  autoStart: false, startMinimized: false, connectOnLaunch: false, serviceMode: false };
delete BASE.domains;

function loadSettings() {
  let s = { ...BASE };
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (Array.isArray(saved.domains) && !saved.customDomains) saved.customDomains = saved.domains.filter((d) => !DISCORD_DOMAINS.includes(d));
    delete saved.domains;
    // v1.2: Yetişkin listesi kaldırıldı, tüm siteler varsayılan oldu
    if (!saved.v12) { saved.scope = 'all'; saved.v12 = true; }
    if (Array.isArray(saved.presets)) saved.presets = saved.presets.filter((k) => PRESETS[k]);
    s = { ...s, ...saved };
  } catch { /* ilk açılış */ }
  return s;
}
let settings = loadSettings();
// Arayüzden gelen her ayarı doğrula; tanımsız anahtarları ve geçersiz değerleri reddet.
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const VALIDATORS = {
  port: (v) => Number.isInteger(v) && v >= 1024 && v <= 65535,
  delayMs: (v) => Number.isInteger(v) && v >= 0 && v <= 1000,
  chunkSize: (v) => Number.isInteger(v) && v >= 0 && v <= 16384,
  scope: (v) => v === 'all' || v === 'list',
  dns: (v) => v === 'doh' || v === 'system',
  dohProvider: (v) => v === 'cloudflare' || v === 'google',
  theme: (v) => ['system', 'dark', 'light'].includes(v),
  presets: (v) => Array.isArray(v) && v.length <= 20 && v.every((k) => Object.prototype.hasOwnProperty.call(PRESETS, k)),
  customDomains: (v) => Array.isArray(v) && v.length <= 1000 && v.every((d) => typeof d === 'string' && DOMAIN_RE.test(d)),
};
for (const k of ['tlsRecordSplit', 'tcpSplit', 'systemProxy', 'autoStart', 'startMinimized', 'connectOnLaunch', 'serviceMode']) VALIDATORS[k] = (v) => typeof v === 'boolean';
function sanitize(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('Geçersiz ayar');
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'customDomains' && Array.isArray(v)) {
      const list = [...new Set(v.map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
      const bad = list.filter((d) => !DOMAIN_RE.test(d));
      if (bad.length) throw new Error(`Geçersiz alan adı: ${bad.slice(0, 3).join(', ')}`);
      out[k] = list.slice(0, 1000);
      continue;
    }
    if (!VALIDATORS[k] || !VALIDATORS[k](v)) throw new Error(`Geçersiz ayar: ${k}`);
    out[k] = v;
  }
  return out;
}
const save = () => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch { /* yut */ } };
const engineOpts = () => ({ ...settings, domains: buildDomains(settings.presets, settings.customDomains) });

if (SERVICE) runService(); else runApp();

// =====================================================================
// SERVİS: penceresiz motor. Durumunu servis.json'a yazar, ayar değişikliklerini izler.
// =====================================================================
function runService() {
  let proxy, startedAt = Date.now(), recent = [];
  const writeStatus = () => {
    try { fs.writeFileSync(STATUS_FILE, JSON.stringify({ pid: process.pid, startedAt, port: settings.port, updated: Date.now(), stats: proxy.stats, recent })); } catch { /* yut */ }
  };
  const shutdown = () => {
    try { fs.unlinkSync(STATUS_FILE); } catch { /* yok */ }
    if (settings.systemProxy) system.disableSync();
  };

  app.whenReady().then(async () => {
    proxy = new SplitProxy(engineOpts());
    proxy.on('log', (l) => {
      if (l.level !== 'ok') return;
      const host = l.msg.split(' → ')[0];
      if (!recent.includes(host)) { recent.push(host); if (recent.length > 20) recent.shift(); }
    });
    try { await proxy.start(); } catch { app.exit(1); return; }
    if (settings.systemProxy) await system.enable(settings.port).catch(() => {});
    writeStatus();
    setInterval(writeStatus, 1500);
    // Uygulamadan yapılan ayar değişikliklerini canlı uygula
    fs.watchFile(SETTINGS_FILE, { interval: 1500 }, () => {
      const next = loadSettings();
      if (!next.serviceMode) { shutdown(); app.exit(0); return; }
      settings = next; proxy.update(engineOpts());
    });
  });
  app.on('window-all-closed', (e) => e.preventDefault());
  app.on('before-quit', shutdown);
  process.on('exit', shutdown);
}

// =====================================================================
// UYGULAMA: pencere + tepsi. Servis açıksa onu yönetir, değilse kendi motorunu çalıştırır.
// =====================================================================
function runApp() {
  let win, tray, proxy = null, running = false, quitting = false, startedAt = 0, statsTimer = null, svcTimer = null;
  const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
  const log = (level, msg) => send('log', { t: Date.now(), level, msg });
  const asset = (f) => path.join(__dirname, 'assets', f);

  // ---------- Servis yardımcıları ----------
  function serviceStatus() {
    try {
      const st = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      if (Date.now() - st.updated > 6000) return null;
      process.kill(st.pid, 0); // süreç yaşıyor mu?
      return st;
    } catch { return null; }
  }
  const svcRunning = () => !!serviceStatus();

  async function startService() {
    if (svcRunning()) return true;
    if (proxy) await stopLocal(); // aynı portu kullanmasınlar
    const pass = process.argv.filter((a) => a === '--no-sandbox'); // geliştirme ortamı bayrakları
    const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--service', ...pass];
    spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); if (svcRunning()) return true; }
    log('error', 'Arka plan servisi başlatılamadı. Port başka bir uygulama tarafından kullanılıyor olabilir.');
    return false;
  }

  async function stopService() {
    const st = serviceStatus();
    // Yalnızca gerçekten SplitDPI'a ait süreci sonlandır
    if (st && system.isOwnProcess(st.pid, path.basename(process.execPath))) { try { process.kill(st.pid); } catch { /* zaten kapalı */ } }
    try { fs.unlinkSync(STATUS_FILE); } catch { /* yok */ }
    if (settings.systemProxy) await system.disable().catch(() => {});
  }

  // Servis açıkken arayüzü servis.json'dan besle
  let lastSvc = false;
  function pollService() {
    const st = serviceStatus();
    const on = !!st;
    if (on) {
      send('stats', st.stats);
      send('hosts', st.recent);
    }
    if (on !== lastSvc || (on && startedAt !== st.startedAt)) {
      lastSvc = on;
      if (!proxy) { running = on; startedAt = on ? st.startedAt : 0; pushState(); }
    }
  }

  // ---------- Pencere ve tepsi ----------
  function createWindow() {
    win = new BrowserWindow({
      width: 1180, height: 760, minWidth: 960, minHeight: 640,
      frame: false, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#07060d' : '#f4f2fb',
      icon: asset('icon.png'), title: 'SplitDPI',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    const hidden = settings.startMinimized || process.argv.includes('--autostart');
    win.once('ready-to-show', () => { if (!hidden) win.show(); });
    win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  }

  function buildTray() {
    tray = new Tray(nativeImage.createFromPath(asset('tray.png')));
    tray.on('click', () => { win.show(); win.focus(); });
    refreshTray();
  }
  function refreshTray() {
    if (!tray) return;
    const svc = settings.serviceMode && running;
    tray.setImage(nativeImage.createFromPath(asset(running ? 'tray-on.png' : 'tray.png')));
    tray.setToolTip(running ? (svc ? 'SplitDPI — servis çalışıyor' : 'SplitDPI — bağlı') : 'SplitDPI — bağlı değil');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: running ? (svc ? '● Servis çalışıyor' : '● Bağlı') : '○ Bağlı değil', enabled: false },
      { label: running ? 'Bağlantıyı kes' : 'Bağlan', click: () => toggle() },
      { label: "Discord'u SplitDPI ile aç", click: () => launchDiscord().catch((e) => log('error', e.message)) },
      { type: 'separator' },
      { label: 'Pencereyi göster', click: () => { win.show(); win.focus(); } },
      { label: settings.serviceMode ? 'Pencereyi kapat (servis çalışmaya devam eder)' : 'Çıkış', click: () => { quitting = true; app.quit(); } },
    ]));
  }
  function pushState() { send('state', { running, startedAt, service: settings.serviceMode && running && !proxy }); refreshTray(); }

  // ---------- Yerel motor ----------
  async function startLocal() {
    if (proxy) return;
    proxy = new SplitProxy(engineOpts());
    proxy.on('log', (l) => send('log', l));
    await proxy.start();
    if (settings.systemProxy) await system.enable(settings.port).catch((e) => log('error', 'Sistem proxy ayarlanamadı: ' + e.message));
    running = true; startedAt = Date.now();
    statsTimer = setInterval(() => proxy && send('stats', proxy.stats), 1000);
    pushState();
  }
  async function stopLocal() {
    if (!proxy) return;
    clearInterval(statsTimer);
    if (settings.systemProxy) await system.disable().catch(() => {});
    await proxy.stop();
    proxy = null; running = false; startedAt = 0;
    pushState();
  }

  async function toggle() {
    try {
      if (settings.serviceMode) {
        if (svcRunning()) { await stopService(); running = false; startedAt = 0; }
        else await startService();
        pollService(); pushState();
      } else if (proxy) await stopLocal();
      else await startLocal();
    } catch (e) {
      if (proxy) await proxy.stop().catch(() => {});
      proxy = null; running = false;
      log('error', e.code === 'EADDRINUSE' ? `${settings.port} portu başka bir uygulama tarafından kullanılıyor. Ayarlardan portu değiştir.` : e.message);
      pushState();
    }
    return running;
  }

  async function launchDiscord() {
    if (!running) await toggle();
    return system.launchDiscord(settings.port);
  }

  // Windows açılışı: servis modu varsa servis, yoksa normal uygulama başlar
  function applyLoginItem() {
    if (!app.isPackaged) return;
    const svc = settings.serviceMode;
    app.setLoginItemSettings({ openAtLogin: svc || !!settings.autoStart, path: process.execPath, args: [svc ? '--service' : '--autostart'] });
  }

  // ---------- IPC ----------
  ipcMain.handle('toggle', toggle);
  ipcMain.handle('getState', () => ({
    running, startedAt, settings, version: app.getVersion(), packaged: app.isPackaged,
    service: settings.serviceMode && running && !proxy,
    discord: !!system.findDiscord(),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { name: v.name, desc: v.desc, count: v.domains.length }])),
    domainCount: buildDomains(settings.presets, settings.customDomains).length,
  }));
  ipcMain.handle('saveSettings', async (_e, raw) => {
    const patch = sanitize(raw);
    const prev = settings;
    settings = { ...settings, ...patch };
    // Servis modu açıldı/kapandı
    if ('serviceMode' in patch && patch.serviceMode !== prev.serviceMode) {
      save();
      if (patch.serviceMode) {
        await stopLocal();
        await startService();
      } else {
        const wasOn = svcRunning();
        await stopService();
        running = false; startedAt = 0;
        if (wasOn) await startLocal().catch((e) => log('error', e.message));
      }
      pollService(); pushState(); applyLoginItem();
      return { settings, domainCount: buildDomains(settings.presets, settings.customDomains).length };
    }
    const restart = ('port' in patch && patch.port !== prev.port) || ('systemProxy' in patch && patch.systemProxy !== prev.systemProxy);
    if ('systemProxy' in patch && !patch.systemProxy && running) await system.disable().catch(() => {});
    save(); // servis ayar dosyasını izler, değişikliği kendisi uygular
    if (proxy) { if (restart) { await stopLocal(); await startLocal(); } else proxy.update(engineOpts()); }
    if (settings.serviceMode && restart && svcRunning()) { await stopService(); await startService(); }
    if ('autoStart' in patch) applyLoginItem();
    refreshTray();
    return { settings, domainCount: buildDomains(settings.presets, settings.customDomains).length };
  });
  ipcMain.handle('launchDiscord', launchDiscord);
  ipcMain.handle('win', (_e, action) => {
    if (action === 'min') win.minimize();
    else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.hide();
  });
  ipcMain.handle('open', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

  // ---------- Yaşam döngüsü ----------
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  // Arayüz yalnızca kendi dosyalarını gösterebilir: yeni pencere, dış sayfa ve tarayıcı izinleri kapalı
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('will-attach-webview', (e) => e.preventDefault());
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // Önceki oturum çöktüyse ölü proxy ayarını temizle (yoksa kullanıcının interneti kesilir)
    if (!svcRunning()) await system.cleanupStale(settings.port).catch(() => {});
    buildTray();
    createWindow();
    applyLoginItem();
    pollService();
    svcTimer = setInterval(pollService, 1000);
    if (settings.serviceMode && !svcRunning()) startService().then(() => { pollService(); pushState(); });
    else if (!settings.serviceMode && settings.connectOnLaunch) toggle();
  });
  app.on('before-quit', async (e) => {
    quitting = true;
    clearInterval(svcTimer);
    if (proxy) { e.preventDefault(); await stopLocal(); app.quit(); }
  });
  // Çökme vb. durumda sistem proxy'sini açık bırakma (servis kendi başına çalışmaya devam eder)
  process.on('exit', () => { if (proxy && settings.systemProxy) system.disableSync(); });
}
