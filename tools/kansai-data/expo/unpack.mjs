import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [tile,out,moduleDir]=process.argv.slice(2);
const {MeshoptDecoder}=await import(pathToFileURL(path.join(moduleDir,'meshopt_decoder.mjs')));
await MeshoptDecoder.ready;
const b=fs.readFileSync(tile),o=[12,16,20,24].reduce((s,k)=>s+b.readUInt32LE(k),28),j=b.readUInt32LE(o+12),g=JSON.parse(b.subarray(o+20,o+20+j)),start=o+28+j;
const raw=Buffer.alloc(g.buffers[1].byteLength);
for(const view of g.bufferViews){
 const a=view.extensions.EXT_meshopt_compression,d=raw.subarray(view.byteOffset,view.byteOffset+view.byteLength);
 MeshoptDecoder.decodeGltfBuffer(d,a.count,a.byteStride,b.subarray(start+a.byteOffset,start+a.byteOffset+a.byteLength),a.mode,a.filter);
}
fs.writeFileSync(out,raw);
