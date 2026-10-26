// Stamps the app icon and version info into Lantern VTT.exe after packaging.
// electron-builder normally does this with rcedit, which needs Wine when building on Linux;
// resedit is pure JavaScript, so the installer can be built anywhere.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { appInfo } = context.packager;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, groupId, lang, iconFile.icons.map((i) => i.data),
  );

  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const [major, minor, patch] = appInfo.version.split('.').map((n) => parseInt(n, 10) || 0);
    vi.setFileVersion(major, minor, patch, 0, 1033);
    vi.setProductVersion(major, minor, patch, 0, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      FileDescription: appInfo.productName,
      ProductName: appInfo.productName,
      CompanyName: appInfo.productName,
      OriginalFilename: `${appInfo.productFilename}.exe`,
      InternalName: appInfo.productFilename,
      LegalCopyright: appInfo.copyright || '',
    });
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • stamped icon and version info into ${path.basename(exePath)}`);
};
