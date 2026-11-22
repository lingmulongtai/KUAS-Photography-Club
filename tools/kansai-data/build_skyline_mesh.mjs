/** Build streamable far buildings from the compact outlines and sample_skyline_ground.py elevations.
 * Run: node --experimental-strip-types tools/kansai-data/build_skyline_mesh.mjs <terrain-cache>
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import earcut from 'earcut';
import {MeshoptEncoder} from 'meshoptimizer';
import {Cartesian3, Matrix4, Transforms} from 'cesium';
import {lonLat} from '../../src/scripts/kansai/coordinates.ts';

const cache=process.argv[2];
if(!cache)throw Error('Expected the sampled terrain cache directory');
const data=fileURLToPath(new URL('../../public/kansai/',import.meta.url));
const output=path.join(data,'skyline-mesh');
fs.mkdirSync(output,{recursive:true});
await MeshoptEncoder.ready;
const palette=[[80,84,85],[97,94,88],[74,83,91],[114,99,88],[73,81,78]];
const rad=Math.PI/180;
function pad(buffer,alignment,offset=0,value=0){
  return Buffer.concat([buffer,Buffer.alloc((alignment-(buffer.length+offset)%alignment)%alignment,value)]);
}
const json=(value,alignment=4,offset=0)=>pad(Buffer.from(JSON.stringify(value)),alignment,offset,32);
function b3dm(rows,origin,point){
  const coords=[],normals=[],colors=[],batch=[],indices=[],metadata={lon:[],lat:[]};
  let magnitude=1;
  function vertex(p,n,color,feature){
    magnitude=Math.max(magnitude,Math.abs(p[0]),Math.abs(p[1]),Math.abs(p[2]));
    coords.push(...p);normals.push(...n);colors.push(...color,255);batch.push(feature);
    return batch.length-1;
  }
  const transform=Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(...origin));
  const inverse=Matrix4.inverseTransformation(transform,new Matrix4()),scratch=new Cartesian3();
  const bounds=[Infinity,Infinity,-Infinity,-Infinity,Infinity,-Infinity];
  function local(geo,h){
    Cartesian3.fromDegrees(...geo,h,undefined,scratch);
    Matrix4.multiplyByPoint(inverse,scratch,scratch);
    return [scratch.x,scratch.z,-scratch.y];
  }
  for(const [feature,row] of rows.entries()){
    const {floor,top,min,rings,center,seed}=row;
    metadata.lon.push(center[0]);metadata.lat.push(center[1]);
    const roof=palette[seed%palette.length],v=seed%19,wall=[183+v,177+v,163+v];
    const lids=[],flat=[],holes=[];
    for(const [ringIndex,ring] of rings.entries()){
      let geo=[];for(let j=0;j<ring.length;j+=2)geo.push(point(ring[j],ring[j+1]));
      // Exterior counterclockwise in ENU, holes clockwise. Reverse before making walls.
      const twice=geo.reduce((sum,p,i)=>{const q=geo[(i+1)%geo.length];return sum+p[0]*q[1]-p[1]*q[0];},0);
      if((twice>0)!==(ringIndex===0))geo.reverse();
      const tops=geo.map(p=>local(p,top)),lows=geo.map(p=>local(p,min?floor+min:floor-2));
      if(ringIndex)holes.push(lids.length);
      for(let i=0;i<geo.length;i++){
        const [lon,lat]=geo[i];bounds[0]=Math.min(bounds[0],lon);bounds[1]=Math.min(bounds[1],lat);
        bounds[2]=Math.max(bounds[2],lon);bounds[3]=Math.max(bounds[3],lat);
        const j=(i+1)%geo.length,a=lows[i],b=lows[j],c=tops[j],d=tops[i];
        const nx=a[2]-b[2],nz=b[0]-a[0],length=Math.hypot(nx,nz)||1;
        const n=[nx/length,0,nz/length];
        const start=vertex(a,n,wall,feature);vertex(b,n,wall,feature);vertex(c,n,wall,feature);vertex(d,n,wall,feature);
        indices.push(start,start+1,start+2,start,start+2,start+3);
        lids.push(vertex(d,[0,1,0],roof,feature));flat.push(d[0],-d[2]);
      }
    }
    for(const n of earcut(flat,holes))indices.push(lids[n]);
    bounds[4]=Math.min(bounds[4],floor-2);bounds[5]=Math.max(bounds[5],top);
  }
  const scale=magnitude/32760,vertexData=Buffer.alloc(batch.length*20),min=[32767,32767,32767],max=[-32768,-32768,-32768];
  for(let i=0;i<batch.length;i++){
    const off=i*20;
    for(let j=0;j<3;j++){
      const v=Math.round(coords[i*3+j]/scale);vertexData.writeInt16LE(v,off+j*2);
      min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);
      vertexData.writeInt8(Math.round(normals[i*3+j]*127),off+8+j);
    }
    for(let j=0;j<4;j++)vertexData[off+12+j]=colors[i*4+j];
    vertexData.writeUInt16LE(batch[i],off+16);
  }
  const indexData=new Uint32Array(indices);
  const encodedVertices=Buffer.from(MeshoptEncoder.encodeGltfBuffer(vertexData,batch.length,20,'ATTRIBUTES'));
  const encodedIndices=Buffer.from(MeshoptEncoder.encodeGltfBuffer(new Uint8Array(indexData.buffer),indices.length,4,'TRIANGLES'));
  const vbytes=pad(encodedVertices,4),payload=pad(Buffer.concat([vbytes,encodedIndices]),4);
  const compression=(byteOffset,byteLength,count,byteStride,mode)=>({EXT_meshopt_compression:{buffer:0,byteOffset,byteLength,count,byteStride,mode}});
  const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,scale:[scale,scale,scale]}],
    extensionsRequired:['EXT_meshopt_compression','KHR_mesh_quantization'],extensionsUsed:['EXT_meshopt_compression','KHR_mesh_quantization'],
    buffers:[{byteLength:payload.length},{byteLength:vertexData.length+indexData.byteLength,extensions:{EXT_meshopt_compression:{fallback:true}}}],
    bufferViews:[{buffer:1,byteOffset:0,byteLength:vertexData.length,byteStride:20,target:34962,extensions:compression(0,encodedVertices.length,batch.length,20,'ATTRIBUTES')},
      {buffer:1,byteOffset:vertexData.length,byteLength:indexData.byteLength,target:34963,extensions:compression(vbytes.length,encodedIndices.length,indices.length,4,'TRIANGLES')}],
    accessors:[{bufferView:0,byteOffset:0,componentType:5122,count:batch.length,type:'VEC3',min,max},
      {bufferView:0,byteOffset:8,componentType:5120,count:batch.length,type:'VEC3',normalized:true},
      {bufferView:0,byteOffset:12,componentType:5121,count:batch.length,type:'VEC4',normalized:true},
      {bufferView:0,byteOffset:16,componentType:5123,count:batch.length,type:'SCALAR'},
      {bufferView:1,componentType:5125,count:indices.length,type:'SCALAR'}],
    materials:[{pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:.95}}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2,_BATCHID:3},indices:4,material:0}]}]};
  const g=json(gltf),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+g.length+payload.length,8);
  header.writeUInt32LE(g.length,12);header.write('JSON',16);
  const bin=Buffer.alloc(8);bin.writeUInt32LE(payload.length);bin.write('BIN\0',4);
  const glb=Buffer.concat([header,g,bin,payload]);
  const ft=json({BATCH_LENGTH:rows.length},8,28),bt=json(metadata,8,28+ft.length),h=Buffer.alloc(28);
  h.write('b3dm');h.writeUInt32LE(1,4);h.writeUInt32LE(28+ft.length+bt.length+glb.length,8);
  h.writeUInt32LE(ft.length,12);h.writeUInt32LE(bt.length,20);
  return {bytes:Buffer.concat([h,ft,bt,glb]),transform:Array.from(transform),region:bounds.map((v,i)=>i<4?v*rad:v)};
}

const districts=JSON.parse(fs.readFileSync(path.join(data,'skyline/index.json'))).tiles;
let chunks=0,features=0;
for(const key of districts){
  const id=key.replace('/','-'),[x,y]=key.split('/').map(Number);
  const source=JSON.parse(gunzipSync(fs.readFileSync(path.join(data,'skyline',id+'.json.gz'))));
  const heights=fs.readFileSync(path.join(cache,id+'.i16'));
  if(heights.length!==source.length*2)throw Error('Wrong elevation count in '+id);
  const point=(u,v)=>lonLat(x+u/16384,y+v/16384,12);
  const rows=source.map(([height,min,,,rings],i)=>{
    const r=rings[0],xs=r.filter((_,j)=>j%2===0),ys=r.filter((_,j)=>j%2===1);
    const u=(Math.min(...xs)+Math.max(...xs))/2,v=(Math.min(...ys)+Math.max(...ys))/2;
    const floor=heights.readInt16LE(i*2)/10;
    return {u,v,center:point(u,v),floor,top:floor+Math.max(height,min+.2),min,rings,seed:(Math.imul(i+1,2654435761)>>>0)};
  });
  const children=[];
  function emit(group,u,v,size,suffix){
    if(!group.length)return;
    if(group.length>210&&size>512){
      const half=size/2,parts=[[],[],[],[]];
      for(const r of group)parts[Number(r.u>=u+half)+2*Number(r.v>=v+half)].push(r);
      parts.forEach((list,i)=>emit(list,u+(i%2)*half,v+(i>>1)*half,half,suffix+i));
      return;
    }
    const origin=point(u+size/2,v+size/2),mesh=b3dm(group,origin,point),uri=id+suffix+'.b3dm';
    fs.writeFileSync(path.join(output,uri),mesh.bytes);
    children.push({boundingVolume:{region:mesh.region},transform:mesh.transform,geometricError:0,content:{uri}});
    chunks++;features+=group.length;
  }
  emit(rows,0,0,16384,'r');
  const region=children[0].boundingVolume.region.map((_,i)=>([0,1,4].includes(i)?Math.min:Math.max)(...children.map(c=>c.boundingVolume.region[i])));
  const tree={asset:{version:'1.0'},geometricError:1500,root:{geometricError:1500,refine:'ADD',boundingVolume:{region},children}};
  fs.writeFileSync(path.join(output,id+'.json'),JSON.stringify(tree));
}
console.log({districts:districts.length,chunks,features});
