// Kurulum dosyasını üretir: dist/win-unpacked → dist/SplitDPI-Setup-<sürüm>.exe
// Gereksinim: NSIS 3 (makensis PATH'te olmalı). Önce `npm run pack` çalıştırılmalı.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const src = path.join(root, 'dist', 'win-unpacked');
const out = path.join(root, 'dist', `SplitDPI-Setup-${version}.exe`);

if (!fs.existsSync(path.join(src, 'SplitDPI.exe'))) {
  console.error('dist/win-unpacked bulunamadı. Önce `npm run pack` çalıştır.');
  process.exit(1);
}

// Yalnızca Türkçe ve İngilizce dil paketlerini tut (~40 MB tasarruf)
const locales = path.join(src, 'locales');
for (const f of fs.readdirSync(locales)) {
  if (!['tr.pak', 'en-US.pak'].includes(f)) fs.unlinkSync(path.join(locales, f));
}

execFileSync('makensis', ['-V2', `-DVERSION=${version}`, `-DSRC=${src}`, `-DOUT=${out}`, 'installer.nsi'], { cwd: __dirname, stdio: 'inherit' });
console.log(`Hazır: ${path.relative(root, out)}`);
