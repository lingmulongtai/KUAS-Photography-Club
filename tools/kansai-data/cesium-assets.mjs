import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import {writeTerrainPrograms} from './terrain-programs.mjs';
import irradiance from '@cesium/engine/Source/Shaders/ComputeIrradianceFS.js';
import specular from '@cesium/engine/Source/Shaders/ConvolveSpecularMapFS.js';

const distribution = new URL('../../node_modules/cesium/Build/Cesium/', import.meta.url);
const output = new URL('../../public/kansai-engine/', import.meta.url);

// Keep all 256 diffuse / 128 specular samples. A uniform loop bound stops ANGLE
// from eagerly unrolling every iteration when the first building appears.
export function boundEnvironmentLoops(bundle){
  const loop='for (int i = 0; i < samples; ++i)';
  let modified=false;
  for(const [source,sampler] of [[irradiance,'u_radianceMap'],[specular,'u_radianceTexture']]){
    if(!source.includes(loop)||!bundle.includes(source))continue;
    const bounded=[
      '#if __VERSION__ >= 300',
      `    int sampleCount = min(samples, textureSize(${sampler}, 0).x + samples);`,
      '#else',
      '    const int sampleCount = samples;',
      '#endif',
      loop.replace('i < samples','i < sampleCount'),
    ].join('\n');
    bundle=bundle.replace(source,()=>source.replace(loop,bounded));
    modified=true;
  }
  return modified?'/* This distribution modifies the diffuse and specular GPU loop bounds. */\n'+bundle:bundle;
}

// glTF stores vertex semantics in a dictionary. A different key order in two
// survey files otherwise produces separate GLSL sources and separate native
// program links, even when their material and vertex layout are equivalent.
export function orderGltfAttributes(bundle){
  // GltfLoader.loadPrimitive in the pinned Cesium distribution. Match the
  // surrounding accessor lookup to leave instance and morph-target plans alone.
  const loader='g=!1,f=t.attributes;if(l(f))for(let V in f){if(!f.hasOwnProperty(V))continue;let w=f[V]';
  const index=bundle.indexOf(loader);
  if(index<0||index!==bundle.lastIndexOf(loader))throw Error('Review glTF primitive attribute loading in this Cesium release');
  return bundle.replace(loader,loader.replace('in f){if(!f.hasOwnProperty(V))continue;', 'of Object.keys(f).sort()){'));
}

// Serve workers, shaders and decoders from the same release and origin as Cesium.js.
export async function prepareCesiumAssets() {
  const {version} = JSON.parse(await readFile(new URL('../../package.json', distribution), 'utf8'));
  const stamp = new URL('version.txt', output);
  await mkdir(output, {recursive:true});
  await writeTerrainPrograms(new URL('terrain-programs.json.gz',output));
  const buildVersion=version+'-env-loops-1-gltf-order-1';
  if (await readFile(stamp, 'utf8').catch(() => '') === buildVersion && await stat(new URL('Cesium.js', output)).catch(() => null)) return;
  for (const asset of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
    await cp(new URL(asset, distribution), new URL(asset, output), {recursive:true});
  }
  await cp(new URL('../../LICENSE.md', distribution), new URL('LICENSE.md', output));
  const bundle=await readFile(new URL('Cesium.js',distribution),'utf8');
  await writeFile(new URL('Cesium.js',output),'/* Primitive attributes are loaded in semantic order. */\n'+orderGltfAttributes(boundEnvironmentLoops(bundle)));
  await writeFile(stamp, buildVersion);
}
