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

test('resident streets retain core texel density with overlapping pages on a 4096-limited GPU',()=>{
  const box=[-9000,-7000,4600,13300],images=[];
  const renderer={capabilities:{maxTextureSize:4096,getMaxAnisotropy:()=>1},
    getRenderTarget:()=>null,getClearColor:c=>c,getClearAlpha:()=>1,setClearColor(){},
    setRenderTarget(target,page){this.page=page;},
    render(scene){images.push({page:this.page,box:scene.children[0].material.uniforms.uBox.value.toArray()});}};
  const field=module.exports.buildRoadField(renderer,[],4096,box,true);
  try {
    assert.equal(field.texture.image.depth,2);
    assert.equal(field.texture.image.width,4096);
    const height=field.texture.image.height;
    assert.ok(height<=4096);
    assert.deepEqual(images.map(i=>i.page),[0,1]);
    const [a,b]=images.map(i=>i.box);
    const metres=(a[3]-a[1])/height;
    assert.ok(metres<=13200/4096);
    assert.ok(Math.abs(a[3]-b[1]-8*metres)<1e-6);
    assert.ok(a[1]<box[1]&&b[3]>box[3]);
  } finally {field.dispose();}
});
