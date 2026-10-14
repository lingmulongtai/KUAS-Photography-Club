import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeProfile, standDensity } from '../src/scripts/hero/tree-profile.ts';

test('tree traits are stable, bounded and vary independently within both species',()=>{
  const traits=Array.from({length:1000},(_,i)=>treeProfile(i*8-3000,i*13-5000));
  for(const t of traits) {
    assert.ok(t.aspect>=.78&&t.aspect<=1.24);
    assert.ok(t.height>=.72&&t.height<=1.22);
    assert.ok(Math.abs(t.lean)<=.11);
    assert.ok(t.crown>=.72&&t.crown<=1.3);
  }
  for(const cedar of [true,false]) {
    const same=traits.filter(t=>t.cedar===cedar);
    assert.ok(same.some(t=>t.height<.8)&&same.some(t=>t.height>1.14));
    assert.ok(same.some(t=>t.width<.8)&&same.some(t=>t.width>1.25));
    assert.ok(new Set(same.map(t=>t.tint.join(','))).size>=2);
  }
  assert.deepEqual(treeProfile(-234,567),treeProfile(-234,567));
});
test('stand density is continuous, bounded and has both open and dense patches',()=>{
  const d=Array.from({length:300},(_,i)=>standDensity(i*13-2000,i*17-1800));
  assert.ok(d.every(v=>v>=.58&&v<=1));
  assert.ok(d.some(v=>v<.67)&&d.some(v=>v>.9));
  assert.ok(Math.abs(standDensity(65-.001,33)-standDensity(65+.001,33))<1e-5);
});
