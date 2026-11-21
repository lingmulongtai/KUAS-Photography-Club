import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [folder,moduleDir]=process.argv.slice(2);
const {MeshoptEncoder}=await import(pathToFileURL(path.join(moduleDir,'meshopt_encoder.js')));
const {MeshoptDecoder}=await import(pathToFileURL(path.join(moduleDir,'meshopt_decoder.mjs')));
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
const g=JSON.parse(fs.readFileSync(path.join(folder,'raw.json'))),raw=fs.readFileSync(path.join(folder,'raw.bin')),head=fs.readFileSync(path.join(folder,'prefix.bin'));
const compressed=[];let encodedLength=0;
for(const view of g.bufferViews){
  const todo=view.extras;delete view.extras;
  const part=raw.subarray(view.byteOffset,view.byteOffset+view.byteLength);
  const e=MeshoptEncoder.encodeGltfBuffer(part,todo.count,todo.stride,todo.mode);
  const d=new Uint8Array(part.byteLength);MeshoptDecoder.decodeGltfBuffer(d,todo.count,todo.stride,e,todo.mode);
  if(Buffer.compare(part,d)!==0)throw Error('Meshopt round trip mismatch');
  view.extensions={EXT_meshopt_compression:{buffer:0,byteOffset:encodedLength,byteLength:e.length,byteStride:todo.stride,count:todo.count,mode:todo.mode,filter:'NONE'}};
  view.buffer=1;compressed.push(e);encodedLength+=e.length;
  const gap=(-encodedLength)&3;if(gap){compressed.push(Buffer.alloc(gap));encodedLength+=gap;}
}
g.buffers=[{byteLength:encodedLength},{byteLength:raw.length,extensions:{EXT_meshopt_compression:{fallback:true}}}];
let js=Buffer.from(JSON.stringify(g));js=Buffer.concat([js,Buffer.alloc((-js.length)&3,32)]);
const glh=Buffer.alloc(20);glh.write('glTF');glh.writeUInt32LE(2,4);glh.writeUInt32LE(28+js.length+encodedLength,8);glh.writeUInt32LE(js.length,12);glh.write('JSON',16);
const binh=Buffer.alloc(8);binh.writeUInt32LE(encodedLength,0);binh.writeUInt32LE(0x004e4942,4);
const chunks=[head,glh,js,binh,...compressed];const gltfEnd=head.length+28+js.length+encodedLength;head.writeUInt32LE(gltfEnd,8);
fs.writeFileSync(path.join(folder,'tile.b3dm'),Buffer.concat(chunks));
