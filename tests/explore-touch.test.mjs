import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExploreButtons } from '../src/scripts/hero/explore-touch.ts';

function setup(t) {
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  const windowListeners=new Map(),documentListeners=new Map();
  globalThis.window={addEventListener:(type,fn)=>windowListeners.set(type,fn),setTimeout};
  globalThis.document={hidden:false,addEventListener:(type,fn)=>documentListeners.set(type,fn)};
  t.after(()=>{globalThis.window=oldWindow;globalThis.document=oldDocument;});
  const buttons=['forward','back','left','right','up','down','fast'].map(direction=>{
    const listeners=new Map(), classes=new Set();
    return {dataset:{direction},listeners,classes,addEventListener:(type,fn)=>listeners.set(type,fn),setPointerCapture(){},classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
  });
  const moves=[];
  const controls=createExploreButtons({querySelectorAll:()=>buttons},move=>moves.push(move));
  const send=(direction,type,extra={})=>{
    const button=buttons.find(b=>b.dataset.direction===direction);
    button.listeners.get(type)({button:0,pointerId:1,stopPropagation(){},preventDefault(){},...extra});
  };
  return {buttons,moves,controls,send,windowListeners,documentListeners};
}

test('independent touches combine and release without stopping another direction',t=>{
  const h=setup(t);
  h.send('forward','pointerdown',{pointerId:1});
  h.send('right','pointerdown',{pointerId:2});
  assert.deepEqual(h.moves.at(-1),{forward:1,side:1,up:0,fast:false});
  h.send('forward','pointerup',{pointerId:1});
  assert.deepEqual(h.moves.at(-1),{forward:0,side:1,up:0,fast:false});
  h.send('right','pointercancel',{pointerId:2});
  assert.deepEqual(h.moves.at(-1),{forward:0,side:0,up:0,fast:false});
  assert.ok(h.buttons.every(button=>!button.classes.has('is-held')));
});

test('opposite directions cancel and lost capture, reset and blur stop movement',t=>{
  const h=setup(t);
  h.send('up','pointerdown',{pointerId:1}); h.send('down','pointerdown',{pointerId:2});
  assert.equal(h.moves.at(-1).up,0);
  h.send('down','lostpointercapture',{pointerId:2}); assert.equal(h.moves.at(-1).up,1);
  h.controls.reset(); assert.equal(h.moves.at(-1).up,0);
  h.send('forward','pointerdown'); h.windowListeners.get('blur')();
  assert.deepEqual(h.moves.at(-1),{forward:0,side:0,up:0,fast:false});
  h.send('left','pointerdown'); globalThis.document.hidden=true; h.documentListeners.get('visibilitychange')();
  assert.deepEqual(h.moves.at(-1),{forward:0,side:0,up:0,fast:false});
});

test('keyboard press and loss of focus release a movement button',t=>{
  const h=setup(t);
  h.send('forward','keydown',{key:' '}); assert.equal(h.moves.at(-1).forward,1);
  h.send('forward','keyup',{key:' '}); assert.equal(h.moves.at(-1).forward,0);
  h.send('up','keydown',{key:'Enter'}); h.send('up','blur'); assert.equal(h.moves.at(-1).up,0);
});

test('assistive activation moves briefly and resets on exit',async t=>{
  const h=setup(t);
  h.send('forward','click',{detail:1}); assert.equal(h.moves.length,0);
  h.send('forward','click',{detail:0}); assert.equal(h.moves.at(-1).forward,1);
  await new Promise(resolve=>setTimeout(resolve,450));
  assert.equal(h.moves.at(-1).forward,0);
  h.send('up','click',{detail:0}); h.controls.reset();
  assert.equal(h.moves.at(-1).up,0);
});


test('acceleration combines with movement and releases on cancellation, blur and reset',t=>{
  const h=setup(t);
  h.send('forward','pointerdown',{pointerId:1});
  h.send('fast','pointerdown',{pointerId:2});
  assert.deepEqual(h.moves.at(-1),{forward:1,side:0,up:0,fast:true});
  h.send('fast','pointercancel',{pointerId:2});
  assert.deepEqual(h.moves.at(-1),{forward:1,side:0,up:0,fast:false});
  h.send('fast','pointerdown',{pointerId:3}); h.windowListeners.get('blur')();
  assert.deepEqual(h.moves.at(-1),{forward:0,side:0,up:0,fast:false});
  h.send('fast','pointerdown',{pointerId:4}); h.controls.reset();
  assert.equal(h.moves.at(-1).fast,false);
});
