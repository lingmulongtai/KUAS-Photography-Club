import test from 'node:test';
import assert from 'node:assert/strict';
import {DetailList,PART,boxDetails,facadeGrid,polyDetails} from '../src/scripts/hero/building-details.ts';
import {CLASS,USAGE} from '../src/scripts/hero/buildings-data.ts';
const kindOf=(cls,use)=>cls|(use<<2);
const lists=()=>({near:new DetailList(),mid:new DetailList()});
const parts=(list,part)=>Array.from({length:list.count},(_,i)=>i).filter(i=>list.meta[i*4+2]===part);
const office=kindOf(CLASS.sturdy,USAGE.office);
test('concrete buildings get roof clutter that stays on the roof and a parapet round it',()=>{
  for(let s=1;s<40;s++){
    const out=lists(),b={x:100,z:-50,angle:0,kind:office},w=18,d=14,h=24,ground=40;
    boxDetails(out,b,w,d,h,ground,s/41);
    const roof=[PART.unit,PART.tank,PART.housing,PART.cabinet,PART.duct].flatMap(p=>parts(out.mid,p));
    assert.ok(parts(out.mid,PART.unit).length>=2,'air-conditioner units on every roof');
    for(const i of roof){
      const [x,y,z]=out.mid.center.slice(i*3,i*3+3),[sx,sy,sz]=out.mid.size.slice(i*3,i*3+3);
      assert.ok(Math.abs(x-b.x)+sx/2<=w/2&&Math.abs(z-b.z)+sz/2<=d/2,'inside the roof');
      assert.ok(y-sy/2>=ground+h-1e-6,'standing on it');
    }
    assert.ok(out.mid.count>=4);
  }
});
test('details are deterministic per building and leave out wooden houses, sheds and low buildings',()=>{
  const a=lists(),b=lists(),box={x:0,z:0,angle:.4,kind:office};
  boxDetails(a,box,20,12,30,0,.37);boxDetails(b,box,20,12,30,0,.37);
  assert.deepEqual(a,b);
  const none=lists();
  boxDetails(none,{x:0,z:0,angle:0,kind:kindOf(CLASS.shed,USAGE.works)},20,12,30,0,.5);
  boxDetails(none,{x:0,z:0,angle:0,kind:office},20,12,4,0,.5);
  boxDetails(none,{x:0,z:0,angle:0,kind:kindOf(CLASS.wooden,USAGE.house)},20,12,18,0,.5);
  polyDetails(none,new Float32Array([0,0,20,0,20,20,0,20]),kindOf(CLASS.wooden,USAGE.public),12,0,.5);
  assert.equal(none.near.count+none.mid.count,0);
});
test('pillars stand on the window grid, between bays, out of the wall',()=>{
  const {cellW}=facadeGrid(office);
  let checked=0;
  for(let s=1;s<60;s++){
    const out=lists(),w=20,d=16,h=30;
    boxDetails(out,{x:0,z:0,angle:0,kind:office},w,d,h,0,s/61);
    for(const i of parts(out.mid,PART.frame)){
      const [x,,z]=out.mid.center.slice(i*3,i*3+3),[sx,sy,sz]=out.mid.size.slice(i*3,i*3+3);
      if(sy<h||Math.max(sx,sz)>.8)continue;
      // the shader's grid runs along each face from an offset: ±17 m on the ±z faces, ±31 m on ±x
      const zFace=Math.abs(z)>d/2;
      const u=zFace?x+Math.sign(z)*17:z+Math.sign(x)*31;
      assert.ok(Math.abs(u/cellW-Math.round(u/cellW))<1e-6,'between two windows');
      if(zFace)assert.ok(Math.abs(z)-sz/2>=d/2-1e-6,'standing out of the wall');
      else assert.ok(Math.abs(x)-sx/2>=w/2-1e-6,'standing out of the wall');
      checked++;
    }
  }
  assert.ok(checked>20);
});
test('extruded outlines get edge parapets and roof clutter inside the outline',()=>{
  const ring=new Float32Array([0,0, 40,0, 40,20, 20,20, 20,40, 0,40]);
  for(const ccw of [true,false]){
    const r=ccw?ring:new Float32Array(Array.from({length:6},(_,i)=>[ring[(5-i)*2],ring[(5-i)*2+1]]).flat());
    const out=lists();polyDetails(out,r,office,28,10,.42);
    for(const i of parts(out.mid,PART.unit)){
      const [x,,z]=out.mid.center.slice(i*3,i*3+3);
      assert.ok(x>0&&z>0&&(x<20||z<20)&&x<40&&z<40,'inside the L');
    }
    // parapets sit just inside each edge
    const parapets=parts(out.mid,PART.structure).filter(i=>Math.abs(out.mid.size[i*3+1]-.9)<1e-6);
    assert.equal(parapets.length,6);
    for(const i of parapets){
      const [x,,z]=out.mid.center.slice(i*3,i*3+3);
      assert.ok(x>0&&z>0&&x<40&&z<40,'inside the outline');
    }
  }
});
