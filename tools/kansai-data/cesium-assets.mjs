import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';

const distribution = new URL('../../node_modules/cesium/Build/Cesium/', import.meta.url);
const output = new URL('../../public/kansai-engine/', import.meta.url);

// Serve workers, shaders and decoders from the same release and origin as Cesium.js.
export async function prepareCesiumAssets() {
  const {version} = JSON.parse(await readFile(new URL('../../package.json', distribution), 'utf8'));
  const stamp = new URL('version.txt', output);
  if (await readFile(stamp, 'utf8').catch(() => '') === version && await stat(new URL('Cesium.js', output)).catch(() => null)) return;
  await mkdir(output, {recursive:true});
  for (const asset of ['Assets', 'ThirdParty', 'Widgets', 'Workers', 'Cesium.js']) {
    await cp(new URL(asset, distribution), new URL(asset, output), {recursive:true});
  }
  await cp(new URL('../../LICENSE.md', distribution), new URL('LICENSE.md', output));
  await writeFile(stamp, version);
}
