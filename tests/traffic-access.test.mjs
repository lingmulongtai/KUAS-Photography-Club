import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trafficSegments,trafficLaneFraction} from '../src/scripts/hero/traffic-access.ts';
import {GYOEN_OUTLINE} from '../src/data/kyotogyoen.ts';

const square=[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:0,z:10}];
const split=(p,b=square)=>trafficSegments(new Float32Array(p),b).map(p=>Array.from(p));
test('through roads are split into exterior pieces without bridging the forbidden interior',()=>{
  assert.deepEqual(split([-2,5,12,5]),[[-2,5,0,5],[10,5,12,5]]);
  assert.deepEqual(split([-2,2,12,2,12,8,-2,8]),[[-2,2,0,2],[10,2,12,2,12,8,10,8],[0,8,-2,8]]);
  assert.deepEqual(split([2,2,8,8]),[]);
  assert.deepEqual(split([-2,-2,0,0,12,-2]),[[-2,-2,0,0,12,-2]]);
  assert.deepEqual(split([-2,0,12,0]),[[-2,0,12,0]],'preserve tangent boundary roads');
});
test('lane offsets at the south-west corner do not drift into the park',()=>{
  const fraction=trafficLaneFraction(-5,-1554,6,0);
  assert.ok(fraction>0&&fraction<1);
  assert.equal(trafficLaneFraction(-16,-2100,8,0),1,'normal Karasuma lanes are preserved');
  assert.equal(trafficLaneFraction(-4000,-700,6,0),1);
});

test('indexed park edges retain the original boundary epsilon and all lane fractions',()=>{
  const boundary=GYOEN_OUTLINE,xs=boundary.map(p=>p.x),zs=boundary.map(p=>p.z);
  const bounds=[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];
  // The original full-outline test is the reference for the new spatial index.
  const inside=(x,z)=>{
    let hit=false;
    for(let i=0,j=boundary.length-1;i<boundary.length;j=i++) {
      const a=boundary[j],b=boundary[i],dx=b.x-a.x,dz=b.z-a.z;
      if(Math.abs((x-a.x)*dz-(z-a.z)*dx)<1e-5&&(x-a.x)*(x-b.x)+(z-a.z)*(z-b.z)<=1e-5)return false;
      if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)hit=!hit;
    }
    return hit;
  };
  const original=(x,z,dx,dz)=>{
    const tx=x+dx,tz=z+dz;
    if(tx<bounds[0]||tx>bounds[2]||tz<bounds[1]||tz>bounds[3]||!inside(tx,tz))return 1;
    let lo=0,hi=1;
    for(let i=0;i<10;i++) {const mid=(lo+hi)/2;if(inside(x+dx*mid,z+dz*mid))hi=mid;else lo=mid;}
    return lo;
  };
  const check=(x,z,dx,dz)=>assert.equal(trafficLaneFraction(x,z,dx,dz),original(x,z,dx,dz),JSON.stringify({x,z,dx,dz}));
  for(let i=0,j=boundary.length-1;i<boundary.length;j=i++) {
    const a=boundary[j],b=boundary[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    const nx=-dz/length,nz=dx/length;
    for(const t of [0,.25,.5,.75,1])for(const delta of [0,-1.01e-5/length,-.99e-5/length,.99e-5/length,1.01e-5/length,-.0031,.0031,-.0033,.0033]) {
      const x=a.x+dx*t+nx*delta,z=a.z+dz*t+nz*delta;
      for(const sign of [-1,1])check(x-nx*12*sign,z-nz*12*sign,nx*12*sign,nz*12*sign);
    }
    if(dz)for(let z=Math.ceil(Math.min(a.z,b.z)/32)*32;z<=Math.max(a.z,b.z);z+=32) {
      const x=a.x+dx*(z-a.z)/dz;
      for(const delta of [-1e-7,0,1e-7])check(x-nx*8,z+delta-nz*8,nx*8,nz*8);
    }
  }
  let seed=131;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<10000;i++)check(bounds[0]-20+random()*(bounds[2]-bounds[0]+40),bounds[1]-20+random()*(bounds[3]-bounds[1]+40),(random()-.5)*24,(random()-.5)*24);
});
test('real Gyoen paths disappear while Karasuma and Marutamachi roads remain intact',()=>{
  assert.deepEqual(trafficSegments(new Float32Array([120,-2082.5,411.5,-2083])),[]);
  for(const points of [[-15.5,-2167.5,-16.5,-1961.5,-15.5,-1929],[-5.5,-1528,57.5,-1530,121,-1529.5,263.5,-1532,402,-1532,532.5,-1534,639.5,-1533,712.5,-1533.5]]){
    const road=new Float32Array(points);assert.deepEqual(trafficSegments(road),[road]);
  }
  const crossing=trafficSegments(new Float32Array([242,-1926.5,-15.5,-1929]));
  assert.equal(crossing.length,1);
  assert.ok(crossing[0][0]<10&&crossing[0][0]>-10);
  assert.equal(crossing[0].at(-2),-15.5);
});
