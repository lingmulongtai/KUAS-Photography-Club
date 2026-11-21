import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {BANK, FIELD, PADDY, groundSheet, readGroundSheet} from '../src/scripts/hero/ground-relief-data.ts';

const root = new URL('../public/kyoto/ground-relief/',import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json',root)));
const sheet = (key,x,z) => readGroundSheet(gunzipSync(readFileSync(new URL(key+'.bin',root))),x,z);

test('every advertised cell is present and its contours decode', () => {
  assert.deepEqual(Object.keys(index).map(k=>k+'.bin').sort(),readdirSync(root).filter(k=>k.endsWith('.bin')).sort());
  const counts = [0,0,0,0];
  for (const [key,ids] of Object.entries(index)) {
    const [x,z] = key.split('_').map(Number), data=sheet(key,x,z);
    assert.deepEqual([...data.cells.keys()],ids);
    for (const id of ids) for (const feature of data.features(id)) counts[feature.kind]++;
  }
  assert.ok(counts[PADDY]>100000 && counts[FIELD]>50000 && counts[BANK]>20000);
});

function contains(path,x,z) {
  let inside=false;
  for (let i=0,j=path.length-2;i<path.length;j=i,i+=2) {
    if ((path[i+1]>z)!==(path[j+1]>z) && x<(path[j]-path[i])*(z-path[i+1])/(path[j+1]-path[i+1])+path[i]) inside=!inside;
  }
  return inside;
}

test('neighbouring Kameoka parcels keep their actual paddy and dry field classification', () => {
  for (const [x,z,kind] of [[-17656,-1894.1,PADDY],[-17663.7,-1782.8,FIELD]]) {
    const s=groundSheet(Math.floor(x/512),Math.floor(z/512));
    const data=sheet(s.key,s.x,s.z);
    const feature=[...data.features(s.cell)].find(f=>f.kind!==BANK && contains(f.paths[0],x,z));
    assert.equal(feature?.kind,kind);
  }
});

test('a partial sheet is rejected before any geometry is exposed', () => {
  const key=Object.keys(index)[0], raw=gunzipSync(readFileSync(new URL(key+'.bin',root)));
  assert.throws(()=>readGroundSheet(raw.subarray(0,raw.length-1),0,0));
});
