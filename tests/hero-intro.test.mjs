import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../src/components/HeroIntro.astro',import.meta.url),'utf8');
const script=source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const classes=()=>{
  const set=new Set();
  return {add:value=>set.add(value),remove:value=>set.delete(value),contains:value=>set.has(value)};
};
function mount({unsupported=false,throws=false,reduced=true}={}) {
  const document=new EventTarget(),button=new EventTarget(),attributes=new Map(),styles=new Map(),percent={textContent:'00%'};
  const progress={setAttribute:(key,value)=>attributes.set(key,value)};
  class Dialog extends EventTarget {
    open=false;closed=0;classList=classes();style={setProperty:(key,value)=>styles.set(key,value)};
    showModal(){if(throws)throw Error('unsupported state');this.open=true;}
    close(){this.open=false;this.closed++;this.dispatchEvent(new Event('close'));}
    querySelector(selector){return selector==='button'?button:selector==='.intro-percent'?percent:progress;}
  }
  const intro=new Dialog();if(unsupported)intro.showModal=undefined;
  document.currentScript={previousElementSibling:intro};document.documentElement={classList:classes()};
  let timeout,delay,cleared=false,frames=[],clock=0;
  runInNewContext(script,{document,HTMLDialogElement:Dialog,matchMedia:()=>({matches:reduced}),
    performance:{now:()=>clock},
    setTimeout:(callback,ms)=>{timeout=callback;delay=ms;return 1;},clearTimeout:()=>{cleared=true;},
    requestAnimationFrame:callback=>frames.push(callback),cancelAnimationFrame:()=>{frames=[];}});
  const emit=(type,detail)=>document.dispatchEvent(new CustomEvent(type,{detail}));
  // play display frames at 60 fps
  const run=seconds=>{for(let i=0;i<Math.round(seconds*60);i++){const due=frames;frames=[];clock+=1000/60;due.forEach(frame=>frame(clock));}};
  return {intro,document,button,attributes,styles,percent,emit,run,get delay(){return delay;},expire:()=>timeout(),get cleared(){return cleared;}};
}

test('intro opens immediately, reports real progress, then releases the page on readiness',()=>{
  const state=mount();assert.equal(state.intro.open,true);
  assert.ok(state.document.documentElement.classList.contains('hero-intro-open'));
  state.emit('hero:progress',.6);assert.equal(state.attributes.get('aria-valuenow'),'60');
  assert.equal(state.styles.get('--progress'),'0.6');assert.equal(state.percent.textContent,'60%');
  state.emit('hero:ready');assert.equal(state.intro.open,false);assert.ok(state.cleared);
  assert.equal(state.document.documentElement.classList.contains('hero-intro-open'),false);
  state.emit('hero:progress',.8);state.emit('hero:error');assert.equal(state.percent.textContent,'60%');
  assert.equal(state.intro.closed,1,'late events cannot reopen or close the intro twice');
});

test('skip, Escape and a required-data error each dismiss without waiting for a download',()=>{
  for(const action of ['skip','escape','error']){
    const state=mount();
    if(action==='skip')state.button.dispatchEvent(new Event('click'));
    if(action==='error')state.emit('hero:error');
    if(action==='escape'){
      const event=new Event('cancel',{cancelable:true});state.intro.dispatchEvent(event);assert.ok(event.defaultPrevented);
    }
    assert.equal(state.intro.open,false,action);assert.equal(state.intro.closed,1);
    assert.equal(state.document.documentElement.classList.contains('hero-intro-open'),false);
  }
});

test('a missing main bundle or stalled connection cannot block the site beyond ten seconds',()=>{
  const state=mount();assert.equal(state.delay,10000);state.expire();
  assert.equal(state.intro.open,false);assert.ok(state.cleared);
  state.emit('hero:ready');assert.equal(state.intro.closed,1);
});

test('unsupported or failed modal setup leaves the document usable',()=>{
  for(const options of [{unsupported:true},{throws:true}]){
    const state=mount(options);assert.equal(state.intro.open,false);
    assert.equal(state.document.documentElement.classList.contains('hero-intro-open'),false);
    state.emit('hero:progress',.5);assert.equal(state.percent.textContent,'00%');
  }
});

test('a jump in loading is counted through on screen, never snapped or run ahead',()=>{
  const state=mount({reduced:false});
  state.emit('hero:progress',.15);state.run(1);assert.equal(state.percent.textContent,'15%');
  state.emit('hero:progress',.6);assert.equal(state.attributes.get('aria-valuenow'),'60','assistive technology hears the real value');
  const seen=[];
  for(let i=0;i<150;i++){state.run(1/60);seen.push(parseInt(state.percent.textContent));}
  assert.ok(seen[5]<30,'no snap to the new value');
  assert.ok(seen.every((value,i)=>i===0||value>=seen[i-1]),'never runs backwards');
  assert.ok(seen.filter(value=>value>15&&value<60).length>20,'passes through the values between');
  assert.equal(Math.max(...seen),60,'never ahead of the real progress');
  assert.equal(seen.at(-1),60);
  assert.equal(state.styles.get('--progress'),'0.6');
});

test('readiness lets the count reach 100% before the scene opens, but never holds the page for long',()=>{
  const state=mount({reduced:false});
  state.emit('hero:progress',.6);state.run(3);state.emit('hero:ready');
  assert.equal(state.intro.open,true,'the count finishes first');
  state.run(.7);assert.equal(state.percent.textContent,'100%');assert.equal(state.intro.open,false);
  // frames stop in a background tab: the page still opens soon after readiness
  const stalled=mount({reduced:false});stalled.emit('hero:progress',.3);stalled.emit('hero:ready');
  assert.equal(stalled.delay,3500);stalled.expire();assert.equal(stalled.intro.open,false);
  // skipping does not wait for the count
  const skipped=mount({reduced:false});skipped.emit('hero:progress',.4);skipped.emit('hero:ready');
  skipped.button.dispatchEvent(new Event('click'));assert.equal(skipped.intro.open,false);
});

test('a fast load plays a continuous short opening without counting ahead of real work',()=>{
  const state=mount({reduced:false});
  state.emit('hero:progress',.2);state.run(.2);
  assert.ok(parseInt(state.percent.textContent)<=20);
  state.emit('hero:ready');
  const seen=[];
  for(let i=0;i<100;i++){state.run(1/60);seen.push(parseInt(state.percent.textContent));}
  assert.equal(state.intro.open,true);
  assert.ok(seen.at(-1)<100,'the count stays in motion during the opening');
  assert.ok(seen.every((value,i)=>i===0||value>=seen[i-1]));
  assert.ok(new Set(seen).size>50,'the count advances through the sequence');
  state.run(1);assert.equal(state.percent.textContent,'100%');assert.equal(state.intro.open,false);
});

test('a late ready event still respects the ten-second safety limit',()=>{
  const state=mount({reduced:false});state.run(9.8);state.emit('hero:ready');
  assert.ok(state.delay<=201);state.expire();assert.equal(state.intro.open,false);
});
