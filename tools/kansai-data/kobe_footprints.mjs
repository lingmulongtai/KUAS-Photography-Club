/** Export GSI and attributed OSM outlines in the same z12/16384 grid as the resident skyline. */
import fs from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {VectorTile,classifyRings} from '@mapbox/vector-tile';
import Pbf from 'pbf';
const [data,xs,ys,dest]=process.argv.slice(2),x=Number(xs),y=Number(ys),key=x+'-'+y;
const file=(dir,ext)=>data+'/'+dir+'/'+key+ext;
const output=new Map();
function add(rings){
  if(!rings[0] || rings[0].length<6)return;
  const outer=rings[0],xs=[],ys=[];
  for(let i=0;i<outer.length;i+=2){xs.push(outer[i]);ys.push(outer[i+1]);}
  const w=Math.min(...xs),n=Math.min(...ys),e=Math.max(...xs),s=Math.max(...ys);
  const cx=Math.round((w+e)/2),cy=Math.round((n+s)/2);
  if(cx<0||cy<0||cx>=16384||cy>=16384||e-w<7||s-n<7)return;
  output.set([cx,cy,e-w,s-n].join(','),rings);
}
const packed=file('network/28','.bin');
if(fs.existsSync(packed)){
  const bytes=fs.readFileSync(packed);
  for(let slot=0;slot<256;slot++){
    const start=bytes.readUInt32LE(slot*4),end=bytes.readUInt32LE((slot+1)*4);
    if(start===end)continue;
    const bytes2=bytes.subarray(start,end);
    const layer=new VectorTile(new Pbf(bytes2[0]===31?gunzipSync(bytes2):bytes2)).layers.BldA;
    for(let f=0;f<(layer?.length??0);f++){
      const feature=layer.feature(f);
      for(const group of classifyRings(feature.loadGeometry()))add(group.map(r=>r.flatMap(p=>[
        (slot%16)*1024+Math.round(p.x*1024/feature.extent),
        (slot>>4)*1024+Math.round(p.y*1024/feature.extent)])));
    }
  }
}
const tags=file('building-attributes','.json.gz');
if(fs.existsSync(tags))for(const row of JSON.parse(gunzipSync(fs.readFileSync(tags)))){
  for(const group of row.polygons)add(group.map(r=>r.flatMap(([lon,lat])=>[
    Math.round(((lon+180)/360*4096-x)*16384),
    Math.round(((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)*2048-y)*16384)])));
}
const skyline=file('skyline','.json.gz');
if(fs.existsSync(skyline))for(const row of JSON.parse(gunzipSync(fs.readFileSync(skyline))))if(!row[1])add(row[4]);
fs.writeFileSync(dest,gzipSync(JSON.stringify([...output.values()])));
