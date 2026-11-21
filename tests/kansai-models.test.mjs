import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {KANSAI} from '../src/data/kansai.ts';
import {OUTINGS} from '../src/data/kansai-outings.ts';
import {prefectureLookup,tileXY,inPolygon} from '../src/scripts/kansai/coordinates.ts';
import {pitchedRoof} from '../src/scripts/kansai/roofs.ts';
import {railStructure} from '../src/scripts/kansai/rail.ts';

const root=new URL('../public/kansai/',import.meta.url);
const json=file=>JSON.parse(readFileSync(new URL(file,root),'utf8'));
const owner=prefectureLookup(json('prefectures.json').features);

test('both GSI rail representations keep underground lines out of the rose garden',()=>{
  assert.equal(railStructure('RailCL',8201,'地下'),'hidden');
  assert.equal(railStructure('RailTrCL',2804,''),'hidden');
  assert.equal(railStructure('RailTrCL',2803,''),'raised');
  assert.equal(railStructure('RailTrCL',2801,''),'surface');
});

test('all outing cameras land inside the named prefecture, including the Mt. Ikoma border',()=>{
  assert.equal(OUTINGS.length,34);
  assert.equal(new Set(OUTINGS.map(p=>p.id)).size,34);
  for(const p of OUTINGS)assert.equal(owner([p.lon,p.lat]),p.pref,p.ja);
  assert.equal(owner([134.897,34.343]),'28','Awaji Island');
  assert.equal(owner([139.75,35.68]),undefined);
});

test('each prefecture has real local building, transport, agricultural and survey data',()=>{
  const network=json('network/index.json'),surface=json('surfaces/index.json'),edges=json('surfaces/edges/index.json');
  const survey=json('surveys/index.json'),attributes=json('building-attributes/index.json'),fields=json('fields/index.json');
  for(const p of KANSAI){
    for(const [folder,index] of [['network',network],['surfaces',surface],['surfaces/edges',edges]]){
      const [x,y]=tileXY(p.lon,p.lat,index.zoom).map(Math.floor),span=2**(index.zoom-index.packZoom);
      const key=Math.floor(x/span)+'/'+Math.floor(y/span);
      assert.ok(index.prefectures[p.code].includes(key),folder+' '+p.en);
      const bytes=readFileSync(new URL(folder+'/'+p.code+'/'+key.replace('/','-')+'.bin',root));
      const slot=(y%span)*span+x%span,sub=bytes.subarray(bytes.readUInt32LE(4*slot),bytes.readUInt32LE(4*(slot+1)));
      const layers=new VectorTile(new Pbf(gunzipSync(sub))).layers;
      assert.ok(Object.values(layers).some(layer=>layer.length>0),folder+' '+p.en);
    }
    assert.ok(survey.layers.some(layer=>layer.pref===p.code&&layer.kind==='bldg'));
    assert.ok(attributes.featuresByPrefecture[p.code]>0);
    assert.ok(Object.values(fields.parcelCounts[p.code]).every(n=>n>0));
  }
  const skyline=json('skyline/index.json');
  assert.ok(skyline.tiles.every(tile=>existsSync(new URL('skyline/'+tile.replace('/','-')+'.json.gz',root))));
});

test('pitched roof planes retain the courtyard opening and meet at the recorded ridge height',()=>{
  const rings=[[[0,0],[24,0],[24,12],[0,12]],[[5,3],[5,7],[10,7],[10,3]]];
  for(const shape of ['gabled','hipped','pyramidal','skillion','mansard']){
    let area=0,high=0;
    pitchedRoof(rings,shape,6,3,(a,b,c)=>{
      const xy=Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/2;
      if(xy<1e-8)return;
      assert.ok(inPolygon([(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3],rings));
      area+=xy;high=Math.max(high,a[2],b[2],c[2]);
    },()=>{});
    assert.ok(Math.abs(area-268)<1e-5,shape+' area '+area);
    assert.ok(Math.abs(high-9)<1e-6,shape+' ridge '+high);
  }
});
