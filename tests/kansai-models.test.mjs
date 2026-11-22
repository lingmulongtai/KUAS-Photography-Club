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

test('Nara Park places four Kasuga sanctuaries and the open dance hall on their mapped footprints',()=>{
  const source=json('landmarks/kasuga-footprints.geojson').features;
  const models=json('landmarks/index.json').filter(b=>b.id.startsWith('kasuga-'));
  assert.equal(models.length,5);
  for(const [i,b] of models.entries()){
    assert.equal(b.pref,'29');
    assert.deepEqual([b.lon,b.lat],source[i].properties.center);
    assert.deepEqual(b.rings,source[i].geometry.coordinates);
    const file=readFileSync(new URL('landmarks/'+b.id+'.glb',root));
    const doc=JSON.parse(file.toString('utf8',20,20+file.readUInt32LE(12)));
    const pos=doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];
    assert.ok(pos.min[1]>=-.001);
    if(i<4)assert.ok(pos.max[1]>6.4&&pos.max[1]<6.6,'the chigi project above the documented 5.712 m ridge');
  }
});

test('Lake Biwa Museum keeps the design height, roof materials and the mapped atrium detail',()=>{
  const model=json('landmarks/index.json').find(b=>b.id==='biwa-museum');
  const outlines=json('landmarks/biwa-museum.geojson').features;
  assert.equal(outlines[0].geometry.coordinates.length,5);
  assert.deepEqual(model.rings,outlines.map(f=>f.geometry.coordinates[0]));
  const bytes=readFileSync(new URL('landmarks/biwa-museum.glb',root));
  const doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const primitives=doc.meshes.flatMap(mesh=>mesh.primitives);
  const heights=primitives.map(p=>doc.accessors[p.attributes.POSITION].max[1]);
  assert.equal(Math.max(...heights),15);
  assert.ok(primitives.some(p=>p.attributes.TEXCOORD_0!==undefined&&doc.materials[p.material].pbrMetallicRoughness.baseColorTexture));
  assert.ok(doc.meshes.some(m=>m.name==='Mullions'));
});

test('Mizunomori preserves the six pavilion footprints and transparent planted atrium',()=>{
  const model=json('landmarks/index.json').find(b=>b.id==='lotus-pavilion');
  const outlines=json('landmarks/lotus-pavilion.geojson').features;
  assert.equal(model.pref,'25');
  assert.equal(model.rings.length,6);
  assert.deepEqual(model.rings,outlines.map(f=>f.geometry.coordinates[0]));
  const bytes=readFileSync(new URL('landmarks/lotus-pavilion.glb',root));
  const doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const glass=doc.meshes.find(m=>m.name==='Glazing').primitives[0];
  const material=doc.materials[glass.material];
  assert.equal(material.alphaMode,'BLEND');
  assert.ok(material.pbrMetallicRoughness.baseColorFactor[3]<.65);
  for(const name of ['Steel','Water','Leaves','Lilies'])assert.ok(doc.meshes.some(m=>m.name===name));
  assert.ok(doc.accessors[glass.attributes.POSITION].max[1]>10);
});

test('Osaka Castle has a resident textured keep at its surveyed height',()=>{
  const keep=json('landmarks/index.json').find(b=>b.id==='osaka-keep');
  const camera=OUTINGS.find(p=>p.id==='osaka-castle');
  assert.ok(inPolygon([camera.lon,camera.lat],keep.rings));
  const file=readFileSync(new URL(keep.file.slice('/kansai/'.length),root));
  const gltf=JSON.parse(file.toString('utf8',20,20+file.readUInt32LE(12)));
  const textured=gltf.meshes[0].primitives.find(p=>p.attributes.TEXCOORD_0!==undefined);
  const geometry=gltf.accessors[textured.attributes.POSITION];
  assert.ok(gltf.materials[textured.material].pbrMetallicRoughness.baseColorTexture);
  assert.ok(geometry.count>500);
  assert.ok(Math.abs(keep.ellipsoidHeight+geometry.max[1]-121.685)<.05);
});

test('Katsura only loads photographed 2024 roofs with a unique 2025 building match',()=>{
  const base='surveys/katsura/',rows=json(base+'matches.json').buildings;
  const region=json('surveys/regions.json').find(layer=>layer.url.endsWith('/katsura/tileset.json'));
  assert.equal(region.pref,'26');assert.equal(region.lod,2);
  assert.equal(rows.length,646);
  const targets=new Map(rows.map(([old,current,iou,height,latest])=>{
    assert.ok(iou>=.8&&Math.abs(height-latest)<=Math.max(2,height*.18));
    return [old,current];
  }));
  assert.equal(targets.size,rows.length);
  assert.equal(new Set(targets.values()).size,rows.length);
  for(const child of json(base+'tileset.json').root.children){
    const tile=readFileSync(new URL(base+child.content.uri,root));
    assert.equal(tile.toString('ascii',0,4),'b3dm');
    assert.equal(tile.readUInt32LE(8),tile.length);
    const start=28+tile.readUInt32LE(12),end=start+tile.readUInt32LE(20);
    const batch=JSON.parse(tile.toString('utf8',start,end));
    const gltf=JSON.parse(tile.toString('utf8',end+20,end+20+tile.readUInt32LE(end+12)));
    assert.ok(gltf.materials.some(m=>m.pbrMetallicRoughness.baseColorTexture));
    const texture=gltf.textures[0];
    const photo=readFileSync(new URL(base+gltf.images[texture.source].uri,root));
    const compressed=readFileSync(new URL(base+gltf.images[texture.extensions.KHR_texture_basisu.source].uri,root));
    assert.equal(photo.subarray(1,4).toString(),'PNG');
    assert.equal(compressed.subarray(0,12).toString('hex'),'ab4b5458203230bb0d0a1a0a');
    assert.equal(compressed.readUInt32LE(20),photo.readUInt32BE(16));
    assert.equal(compressed.readUInt32LE(24),photo.readUInt32BE(20));
    assert.ok(compressed.readUInt32LE(40)>1);
    for(const p of gltf.meshes[0].primitives){
      assert.ok(p.attributes._BATCHID!==undefined);
      const accessor=gltf.accessors[p.attributes._BATCHID],view=gltf.bufferViews[accessor.bufferView];
      const data=end+28+tile.readUInt32LE(end+12)+view.byteOffset;
      for(let i=0;i<accessor.count;i++)assert.ok(tile.readUInt16LE(data+2*i)<batch.gml_id.length);
    }
    for(const [i,id] of batch.source_gml_id.entries()){
      assert.equal(batch._lod[i],2);assert.equal(targets.get(id),batch.gml_id[i]);targets.delete(id);
    }
  }
  assert.equal(targets.size,0);
});

test('the Kyoto laser-survey roofs have a registered footprint, camera-lit normals and a photograph',()=>{
  const catalogue=json('landmarks/index.json'), roofs=json('landmarks/temple-roofs.json');
  assert.equal(roofs.length,8);
  for(const roof of roofs){
    assert.deepEqual(catalogue.find(entry=>entry.id===roof.id),roof);
    const bytes=readFileSync(new URL(roof.file.slice('/kansai/'.length),root));
    const doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    const surface=doc.meshes.find(m=>m.name==='Measured roof').primitives[0];
    const positions=doc.accessors[surface.attributes.POSITION];
    const belfry=roof.id==='eikando-shoro';
    assert.ok(positions.count>(belfry?120:1000)&&positions.max[1]-positions.min[1]>(belfry?2:4),roof.id);
    if(belfry){
      assert.ok(doc.meshes.some(m=>m.name==='Patinated bell'));
      assert.ok(!doc.meshes.some(m=>m.name==='Lime plaster'));
    }
    assert.equal(doc.accessors[surface.attributes.NORMAL].count,positions.count);
    assert.equal(doc.accessors[surface.attributes.TEXCOORD_0].count,positions.count);
    assert.ok(doc.materials[surface.material].pbrMetallicRoughness.baseColorTexture);
    assert.ok(doc.images[0].bufferView!==undefined);
  }
});

test('Nankinmachi retains the measured heights and individual street footprints of all four structures',()=>{
  const catalogue=json('landmarks/index.json'), source=json('landmarks/nankinmachi.json');
  assert.equal(source.length,4);
  for(const {center,dimension,ring} of source){
    const b=catalogue.find(b=>b.pref==='28'&&b.lon===center[0]&&b.lat===center[1]);
    assert.deepEqual(b.rings,[ring]);
    const bytes=readFileSync(new URL(b.file.slice('/kansai/'.length),root));
    const doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    const pos=doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];
    assert.ok(Math.abs(pos.max[1]-(dimension.maximumHeightM??dimension.originalHeightM))<.01,b.id);
  }
});

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
