import test from 'node:test';
import assert from 'node:assert/strict';
import {fushimiInari,replacesInari,inariClearing,INARI_BUILDINGS,INARI_PATHS} from '../src/scripts/hero/fushimi-inari.ts';
test('mapped shrine compounds replace their old footprints without clearing the whole district',()=>{
  for(const b of INARI_BUILDINGS)assert.ok(replacesInari(b.x,b.z),b.id);
  assert.ok(!replacesInari(1000,4000));assert.ok(!inariClearing(1380,4130));
  for(const path of INARI_PATHS)for(const [x,z] of path)assert.ok(inariClearing(x,z));
});
test('shrine halls and two torii corridors retain bounded finite world geometry',()=>{
  const parts=fushimiInari(()=>25);let vertices=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const {geo} of parts) {
    const p=geo.getAttribute('position');vertices+=p.count;
    for(let i=0;i<p.count;i++){assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)));minX=Math.min(minX,p.getX(i));maxX=Math.max(maxX,p.getX(i));minY=Math.min(minY,p.getY(i));maxY=Math.max(maxY,p.getY(i));}
    geo.dispose();
  }
  assert.ok(vertices<150000);assert.ok(minX>1140&&maxX<1490);assert.ok(minY>=25&&maxY<41);
  assert.ok(parts.length>600,'both dense torii corridors are present');
});
