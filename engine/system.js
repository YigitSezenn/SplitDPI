'use strict';
// Windows sistem proxy'si ve Discord başlatıcı.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REG = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const isWin = process.platform === 'win32';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// WinINET'e "ayarlar değişti" bildirimi: açık uygulamalar yeni proxy'yi hemen görür.
const REFRESH_PS = `
$s='[DllImport("wininet.dll")]public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);'
$t=Add-Type -MemberDefinition $s -Name W -Namespace G -PassThru
$t::InternetSetOption(0,39,0,0)|Out-Null;$t::InternetSetOption(0,37,0,0)|Out-Null`;

async function refresh() {
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', REFRESH_PS]).catch(() => {});
}

let backup = null;

async function readCurrent() {
  const get = async (name) => {
    try {
      const out = await run('reg', ['query', REG, '/v', name]);
      const m = out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.*)`));
      return m ? m[1].trim() : null;
    } catch { return null; }
  };
  return { enable: await get('ProxyEnable'), server: await get('ProxyServer'), override: await get('ProxyOverride') };
}

async function enable(port) {
  if (!isWin) return false;
  if (!backup) backup = await readCurrent();
  await run('reg', ['add', REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
  await run('reg', ['add', REG, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `127.0.0.1:${port}`, '/f']);
  await run('reg', ['add', REG, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', 'localhost;127.*;10.*;192.168.*;<local>', '/f']);
  await refresh();
  return true;
}

async function disable() {
  if (!isWin) return false;
  const b = backup || { enable: '0x0', server: null, override: null };
  const on = b.enable && parseInt(b.enable, 16) === 1 && b.server && !b.server.startsWith('127.0.0.1:');
  await run('reg', ['add', REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', on ? '1' : '0', '/f']);
  if (b.server && on) await run('reg', ['add', REG, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', b.server, '/f']);
  if (b.override) await run('reg', ['add', REG, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', b.override, '/f']);
  await refresh();
  backup = null;
  return true;
}

/** Senkron kapatma — uygulama beklenmedik kapanırken kullanılır. */
function disableSync() {
  if (!isWin) return;
  try {
    require('child_process').execFileSync('reg', ['add', REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], { windowsHide: true });
  } catch { /* yut */ }
}

function findDiscord() {
  const local = process.env.LOCALAPPDATA || '';
  for (const name of ['Discord', 'DiscordPTB', 'DiscordCanary']) {
    const upd = path.join(local, name, 'Update.exe');
    if (fs.existsSync(upd)) return { name, updater: upd };
  }
  return null;
}

/** Discord'u kapatıp proxy bayrağıyla yeniden başlatır. */
async function launchDiscord(port) {
  const d = findDiscord();
  if (!d) throw new Error('Discord kurulu bulunamadı');
  await run('taskkill', ['/IM', `${d.name}.exe`, '/F']).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  spawn(d.updater, ['--processStart', `${d.name}.exe`, '--process-start-args', `--proxy-server=127.0.0.1:${port}`], {
    detached: true, stdio: 'ignore', windowsHide: false,
  }).unref();
  return d.name;
}

/** pid'in gerçekten bu uygulamaya ait olup olmadığını doğrular (yanlış süreci sonlandırmamak için). */
function isOwnProcess(pid, exeName) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (!isWin) return true;
  try {
    const out = require('child_process').execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }).toString().toLowerCase();
    return out.includes(`"${exeName.toLowerCase()}"`);
  } catch { return false; }
}

/**
 * Uygulama beklenmedik şekilde kapandıysa (görev yöneticisi, elektrik kesintisi) sistem proxy'si
 * ölü bir porta işaret ederek internet bağlantısını kesebilir. Açılışta bunu düzeltir.
 */
async function cleanupStale(port) {
  if (!isWin) return false;
  const cur = await readCurrent();
  if (cur.enable && parseInt(cur.enable, 16) === 1 && cur.server === `127.0.0.1:${port}`) {
    await run('reg', ['add', REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f']);
    await refresh();
    return true;
  }
  return false;
}

module.exports = { enable, disable, disableSync, launchDiscord, findDiscord, isOwnProcess, cleanupStale, isWin };
