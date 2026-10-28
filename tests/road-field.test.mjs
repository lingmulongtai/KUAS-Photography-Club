import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import * as THREE from 'three';

const compiled=buildSync({stdin:{resolveDir:process.cwd(),contents:"export {buildRoadField} from './src/scripts/hero/roads.ts';"},
  bundle:true,platform:'node',format:'cjs',external:['three'],write:false}).outputFiles[0].text;
const module={exports:{}},require=createRequire(import.meta.url);
new Function('require','module','exports',compiled)(id=>id==='three'?THREE:require(id),module,module.exports);

test('road field restores renderer state even if GPU rendering fails',()=>{
  const originalTarget={},originalColor=new THREE.Color('#336699');
  const renderer={target:originalTarget,color:originalColor.clone(),alpha:.4,autoClear:false,toneMapping:THREE.ACESFilmicToneMapping,
    capabilities:{getMaxAnisotropy:()=>1},getRenderTarget(){return this.target;},getClearColor(out){return out.copy(this.color);},
    getClearAlpha(){return this.alpha;},setRenderTarget(target){this.target=target;},setClearColor(color,alpha){this.color.set(color);this.alpha=alpha;},
    render(){throw Error('GPU unavailable');}};
  assert.throws(()=>module.exports.buildRoadField(renderer,[],16,[-1,-1,1,1]),/GPU unavailable/);
  assert.equal(renderer.target,originalTarget);assert.ok(renderer.color.equals(originalColor));assert.equal(renderer.alpha,.4);
  assert.equal(renderer.autoClear,false);assert.equal(renderer.toneMapping,THREE.ACESFilmicToneMapping);
});
