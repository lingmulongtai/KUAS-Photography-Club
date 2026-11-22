import fs from 'node:fs';
import readline from 'node:readline';
import {MeshoptSimplifier as s} from './tools/meshoptimizer/meshopt_simplifier.js';
await s.ready;
for await (const line of readline.createInterface({input:process.stdin,terminal:false})) {
 const [input,idxFile,out,goal,err]=JSON.parse(line);
 try {
  const p=fs.readFileSync(input), i=fs.readFileSync(idxFile);
  const pos=new Float32Array(p.buffer,p.byteOffset,p.byteLength/4);
  const indices=new Uint32Array(i.buffer,i.byteOffset,i.byteLength/4);
  const [simp,actual]=s.simplify(indices,pos,3,Math.min(goal*3,indices.length),err,['ErrorAbsolute']);
  fs.writeFileSync(out,Buffer.from(simp.buffer,simp.byteOffset,simp.byteLength));
  process.stdout.write(JSON.stringify({tri:simp.length/3,err:actual})+'\n');
 } catch(e) {process.stdout.write(JSON.stringify({error:String(e)})+'\n');}
}
