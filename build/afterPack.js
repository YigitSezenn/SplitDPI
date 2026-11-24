// electron-builder afterPack kancası: SplitDPI.exe'ye simge ve sürüm bilgisini yazar.
// (Linux'ta Wine gerektiren rcedit yerine saf JS "resedit" kullanılır; Windows'ta da çalışır.)
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { NtExecutable, NtExecutableResource, Data, Resource } = ResEdit.default || ResEdit;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const exePath = fs.existsSync(exe) ? exe : path.join(ctx.appOutDir, 'SplitDPI.exe');
  const app = ctx.packager.appInfo;

  // Electron "fuse"ları: paketlenmiş uygulamanın kötüye kullanılabilecek özelliklerini kalıcı olarak kapat
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  await flipFuses(exePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,                         // SplitDPI.exe genel amaçlı Node.js olarak çalıştırılamaz
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // NODE_OPTIONS ile kod enjeksiyonu yok
    [FuseV1Options.EnableNodeCliInspectArguments]: false,      // --inspect ile hata ayıklayıcı bağlanamaz
    [FuseV1Options.OnlyLoadAppFromAsar]: true,                 // yalnızca imzalı paket içinden uygulama yüklenir
    [FuseV1Options.EnableCookieEncryption]: true,
  });

  const ne = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(ne);
  const ico = Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const id = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map((i) => i.data));

  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] || Resource.VersionInfo.createEmpty();
  const [ma, mi, pa] = app.version.split('.').map(Number);
  vi.setFileVersion(ma, mi, pa, 0, 1033);
  vi.setProductVersion(ma, mi, pa, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'SplitDPI',
    ProductName: 'SplitDPI',
    CompanyName: app.companyName || 'yigit',
    OriginalFilename: 'SplitDPI.exe',
    InternalName: 'SplitDPI',
    LegalCopyright: `© ${new Date().getFullYear()} yigit`,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(ne);
  fs.writeFileSync(exePath, Buffer.from(ne.generate()));
  console.log('  • simge ve sürüm bilgisi yazıldı', path.basename(exePath));
};
