import fs from 'node:fs';
import readline from 'node:readline';
import {MeshoptSimplifier as simp} from './tools/meshoptimizer/meshopt_simplifier.js';
await simp.ready;
for await(const line of readline.createInterface({input:process.stdin,terminal:false})){
 const [src,dst,target]=JSON.parse(line);
 try {
  const b=fs.readFileSync(src),pos=new Float32Array(b.buffer,b.byteOffset,b.length/4);const n=pos.length/3;
  const seq=Uint32Array.from({length:n},(_,i)=>i);
  const [simpl,err]=simp.simplifySloppy(seq,pos,3,null,Math.min(n,target*3),1);
  if(simpl.length===0)throw Error('empty simplified mesh');
  fs.writeFileSync(dst,Buffer.from(simpl.buffer,simpl.byteOffset,simpl.byteLength));
  process.stdout.write(JSON.stringify({triangles:simpl.length/3,metres:err*simp.getScale(pos,3)})+'\n');
 }catch(e){process.stdout.write(JSON.stringify({error:String(e)})+'\n');}
}
