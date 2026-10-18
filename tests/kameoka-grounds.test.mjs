import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {kameokaGrounds,kameokaClearing} from '../src/scripts/hero/kameoka-grounds.ts';
import {loadHeightfield} from '../src/scripts/hero/heightfield.ts';

test('campus walks face upward and remain valid on flat terrain or the actual hillside',async(t)=>{
  const root=new URL('../public/kyoto/',import.meta.url),meta=JSON.parse(await readFile(new URL('terrain.json',root),'utf8'));
  const original=globalThis.fetch;globalThis.fetch=async(url)=>new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(()=>{globalThis.fetch=original;});const actual=await loadHeightfield(meta);
  for(const hf of [{height:()=>100},actual]){
    const g=kameokaGrounds(hf,{x:-18824.8865,z:1105.346}),p=g.getAttribute('position'),n=g.getAttribute('normal');
    assert.ok([...p.array].every(Number.isFinite));assert.ok(p.count<100000);
    for(let i=0;i<6;i++)assert.ok(n.getY(i)>.6,'the first walk is visible with normal back-face culling');
    assert.deepEqual(g.userData.parts.map(p=>p.name),['terraced-pedestrian-walks','sports-baseballNorth','sports-main','sports-baseballSouth','tennis-painted-area']);
    for(const part of g.userData.parts.slice(1))for(let i=part.start;i<part.start+part.count;i+=3){
      const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
      const gap=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3-hf.height(x,z);
      assert.ok(gap>-.12&&gap<.55,`mapped surface must hug its hillside: ${gap}`);
      assert.ok(n.getY(i)>0,'even the sloped field boundary faces upward');
    }g.dispose();
  }
  assert.equal(kameokaClearing(85,230),true);assert.equal(kameokaClearing(-255,-115),true);
  assert.equal(kameokaClearing(0,-140),true);assert.equal(kameokaClearing(200,-200),false);
});
