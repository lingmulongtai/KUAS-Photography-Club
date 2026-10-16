import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shishinden } from '../src/scripts/hero/temple-models.ts';

test('the palace hall remains a bounded lightweight model within its mapped footprint', () => {
  const parts=shishinden();
  let vertices=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const {geo} of parts) {
    const positions=geo.getAttribute('position');
    vertices+=positions.count;
    for(let i=0;i<positions.count;i++) {
      const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
      assert.ok([x,y,z].every(Number.isFinite));
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
    geo.dispose();
  }
  assert.ok(vertices<4000);
  assert.equal(maxX-minX,43);
  assert.ok(maxZ-minZ>=35&&maxZ-minZ<40);
  assert.ok(minY>=-1e-6&&maxY>16&&maxY<19);
});
