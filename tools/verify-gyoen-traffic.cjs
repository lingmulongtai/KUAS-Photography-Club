// Exercise the shipped road data and the actual car simulation without a browser/GPU.
const {build}=require('esbuild');
const Module=require('node:module');
(async()=>{
  const result=await build({stdin:{resolveDir:process.cwd(),contents:`
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    import {buildCars} from './src/scripts/hero/cars.ts';
    import {loadLines} from './src/scripts/hero/lines-data.ts';
    import {createEnv} from './src/scripts/hero/env.ts';
    import {GYOEN_OUTLINE as boundary} from './src/data/kyotogyoen.ts';
    module.exports=(async()=>{
    globalThis.fetch=async path=>new Response(fs.readFileSync('public'+path));
    const cars=buildCars(createEnv(),{height:()=>0},await loadLines(),1);
    const position=cars.group.children[0].geometry.getAttribute('iPos');
    let internal=0,karasuma=0,marutamachi=0;
    const violations=[];
    function inside(x,z) {
      if(x<0||x>730||z< -2830||z> -1540)return false;
      let hit=false;
      for(let i=0,j=boundary.length-1;i<boundary.length;j=i++){
        const a=boundary[j],b=boundary[i];
        if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)hit=!hit;
      }
      return hit;
    }
    for(let sample=0;sample<=120;sample++) {
      cars.update(sample?5:0);
      for(let i=0;i<position.count;i++) {
        const x=position.getX(i),z=position.getZ(i);
        assert.ok(Number.isFinite(x)&&Number.isFinite(z));
        if(inside(x,z)){internal++;if(violations.length<5)violations.push({x,z,sample});}
        if(Math.abs(x+16)<13&&z> -2750&&z< -1600)karasuma++;
        if(x>10&&x<700&&Math.abs(z+1533)<13)marutamachi++;
      }
    }
    assert.equal(internal,0,'general cars must not drive through Kyoto Gyoen: '+JSON.stringify(violations));
    assert.ok(karasuma>0&&marutamachi>0,'surrounding avenues must retain traffic');
    console.log(JSON.stringify({cars:cars.count,simulatedSeconds:600,samples:121,internal,karasuma,marutamachi}));
    })();
  `},bundle:true,write:false,platform:'node',format:'cjs'});
  const compiled=new Module(__filename,module);compiled.paths=module.paths;
  compiled._compile(result.outputFiles[0].text,__filename);
  await compiled.exports;
})().catch(e=>{console.error(e);process.exitCode=1});
