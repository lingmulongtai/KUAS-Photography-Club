import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {pagoda} from '../src/scripts/hero/temple-models.ts';

for(const [name,n,base,top,height,spire] of [['Toji',5,9.5,6.6,54.8,12],['Yasaka',5,6.4,4.6,46,9.5],['Kiyomizu',3,6.2,4.8,31,8]]) {
  test(`${name} retains its storeys and measured silhouette within the geometry budget`,()=>{
    const parts=pagoda(n,base,top,height,spire,[.07,.042,.025],[.035,.038,.042]);
    const bounds=new THREE.Box3();let triangles=0;
    for(const {geo} of parts){geo.computeBoundingBox();bounds.union(geo.boundingBox);triangles+=(geo.index?.count??geo.getAttribute('position').count)/3;assert.ok([...geo.getAttribute('position').array].every(Number.isFinite));}
    assert.ok(Math.abs(bounds.max.y-height)<.001);
    assert.ok(Math.abs(bounds.max.x-bounds.min.x-base*2.05)<.001);
    assert.ok(triangles<7500);
    assert.equal(parts.filter(({geo})=>geo.type==='TorusGeometry').length,9);
    parts.forEach(({geo})=>geo.dispose());
  });
}
