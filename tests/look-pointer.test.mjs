import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLookRotation, mountLookControls } from '../src/scripts/hero/look-controls.ts';

function setup(t, enabled=()=>true) {
  const listeners = new Map(), captured = new Set();
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = {addEventListener(){}};
  globalThis.document = {addEventListener(){}};
  t.after(() => { globalThis.window=oldWindow; globalThis.document=oldDocument; });
  const el = {
    addEventListener(type, cb){ listeners.set(type,cb); },
    setPointerCapture(id){ captured.add(id); }, hasPointerCapture(id){return captured.has(id);}, releasePointerCapture(id){captured.delete(id);},
    classList:{add(){},remove(){}}, getBoundingClientRect(){return {left:0,top:0,width:600,height:400};},
  };
  const look = createLookRotation(); let taps=0;
  mountLookControls(el,look,()=>taps++,enabled);
  const send=(type,x,y,extra={})=>listeners.get(type)({type,isPrimary:true,button:0,pointerType:'mouse',pointerId:1,clientX:x,clientY:y,timeStamp:10,target:{closest(){return null;}},...extra});
  return {send,look,captured,taps:()=>taps};
}
test('small mouse release outside is captured, cancelled and never becomes a later hover drag', (t) => {
  const h=setup(t); h.send('pointerdown',599,100);
  assert.ok(h.captured.has(1));
  h.send('pointerup',602,100);
  h.send('pointermove',300,100);
  assert.equal(h.look.state.yaw,0); assert.equal(h.taps(),0);
});
test('flight input lock ignores drags and taps until the camera has arrived', (t)=>{
  let arrived=false;
  const h=setup(t,()=>arrived);
  h.send('pointerdown',100,100);h.send('pointermove',240,100);h.send('pointerup',240,100);
  assert.equal(h.look.state.yaw,0);assert.equal(h.taps(),0);assert.equal(h.captured.size,0);
  arrived=true;
  h.send('pointerdown',100,100);h.send('pointermove',240,100);h.send('pointerup',240,100);
  assert.ok(h.look.state.yaw<0);
});
test('short taps remain taps while horizontal drags and vertical touch scrolls do not fire them', (t) => {
  const h=setup(t);
  h.send('pointerdown',100,100); h.send('pointermove',103,100); h.send('pointerup',103,100);
  assert.equal(h.taps(),1);
  h.send('pointerdown',100,100); h.send('pointermove',120,100); h.send('pointerup',120,100);
  assert.equal(h.taps(),1); assert.ok(h.look.state.yaw<0);
  h.send('pointerdown',100,100,{pointerType:'touch'}); h.send('pointermove',101,130,{pointerType:'touch'}); h.send('pointerup',101,130,{pointerType:'touch'});
  assert.equal(h.taps(),1); assert.equal(h.look.state.dragging,false);
});
