import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {MAP_PLACES} from '../src/data/kansai-outings.ts';
import {toLocal} from '../src/scripts/hero/geo.ts';
import {decodeTreeCover} from '../src/scripts/hero/tree-cover.ts';

const asset=(name)=>readFileSync(new URL('../public/'+name,import.meta.url));
const {grid,patches}=JSON.parse(asset('kyoto/kansai/ground.json'));
const inside=({x,z},[w,n,e,s])=>x>=w && x<=e && z>=n && z<=s;

test('the home terrain encloses all five surveyed boundaries, including detached islands',()=>{
  const {features}=JSON.parse(asset('kansai/prefectures.json'));
  assert.deepEqual(features.map(f=>f.properties.code).sort(),['25','26','27','28','29']);
  for(const feature of features){
    for(const polygon of feature.geometry.coordinates)for(const [lon,lat] of polygon[0]){
      assert.ok(inside(toLocal(lat,lon),grid.box),feature.properties.name);
    }
  }
  for(const place of MAP_PLACES)assert.ok(patches.some(p=>inside(toLocal(place.lat,place.lon),p.box)),place.id);
  assert.equal(gunzipSync(asset('kyoto/'+grid.file)).length,2*grid.nx*grid.nz);
});

test('the seasonal forest samples the lake, Awaji, northern Kyoto and the southern Nara mountains',()=>{
  const cover=decodeTreeCover(gunzipSync(asset('kyoto/kansai/canopy.bin')));
  function density(lat,lon){
    const p=toLocal(lat,lon);
    assert.ok(inside(p,cover.box));
    const x=Math.floor((p.x-cover.box[0])*cover.width/(cover.box[2]-cover.box[0]));
    const z=Math.floor((p.z-cover.box[1])*cover.height/(cover.box[3]-cover.box[1]));
    return cover.cells[z*cover.width+x];
  }
  assert.equal(density(35.29,136.10),0);
  for(const [lat,lon] of [[34.429,134.885],[35.72,135.20],[33.97,135.86]])assert.ok(density(lat,lon)>8);
});
