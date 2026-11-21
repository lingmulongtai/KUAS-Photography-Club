import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {lonLat,tileMetresPerDegree} from '../src/scripts/kansai/coordinates.ts';

const bundle=buildSync({stdin:{contents:`export * from './src/scripts/kansai/seta-bridge';
export {Mesh} from './src/scripts/kansai/mesh';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};runInNewContext(bundle.outputFiles[0].text,{module});
const {isSetaDeck,drawSetaBridges,Mesh}=module.exports;
test('Karahashi retains both pile rows, the island road and one continuous deck through the tile seam',()=>{
  assert.equal(isSetaDeck([135.9052,34.973323]),true);
  assert.equal(isSetaDeck([135.906705,34.972953]),true);
  assert.equal(isSetaDeck([135.905637,34.973215]),false);
  assert.equal(isSetaDeck([135.906705,34.973040]),false);
  const west=[135.9049509,34.9733849],scale=tileMetresPerDegree(34.973);
  const local=([lon,lat])=>[(lon-west[0])*scale[0],(lat-west[1])*scale[1]];
  function region(w,e){
    const mesh=new Mesh();drawSetaBridges(mesh,[w,34.97,e,34.99],local);return mesh;
  }
  const seam=lonLat(57509,25964,16)[0],left=region(135.90,seam),right=region(seam,135.91),whole=region(135.90,135.91);
  assert.ok(left.positions.length&&right.positions.length);
  // At identical elevations, cap profiles and submerged piles are owned by one tile.
  const rings=mesh=>new Set(mesh.positions.flatMap((v,i)=>i%3===0&&mesh.positions[i+2]<119
    ?[Math.round(v*100)+','+Math.round(mesh.positions[i+1]*100)]:[]));
  const leftPiles=rings(left),rightPiles=rings(right);
  assert.equal([...leftPiles].filter(p=>rightPiles.has(p)).length,0);
  assert.equal(new Set([...leftPiles,...rightPiles]).size,rings(whole).size);
  // The clipped upper road faces must have the same area as the undivided ones.
  function asphalt(mesh){
    let area=0;
    for(let i=0;i<mesh.positions.length;i+=9){
      if(mesh.colors[i/9*12]!==85||mesh.normals[i+2]<.99)continue;
      const [ax,ay,,bx,by,,cx,cy]=mesh.positions.slice(i,i+9);
      area+=Math.abs((bx-ax)*(cy-ay)-(cx-ax)*(by-ay))*.5;
    }
    return area;
  }
  assert.ok(asphalt(whole)>3250&&asphalt(whole)<3700);
  assert.ok(Math.abs(asphalt(left)+asphalt(right)-asphalt(whole))<.0001);
  assert.equal(region(135.95,135.96).positions.length,0);
});
