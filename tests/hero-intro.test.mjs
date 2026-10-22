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
function mount({unsupported=false,throws=false}={}) {
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
  let timeout,delay,cleared=false;
  runInNewContext(script,{document,HTMLDialogElement:Dialog,matchMedia:()=>({matches:true}),
    setTimeout:(callback,ms)=>{timeout=callback;delay=ms;return 1;},clearTimeout:()=>{cleared=true;}});
  const emit=(type,detail)=>document.dispatchEvent(new CustomEvent(type,{detail}));
  return {intro,document,button,attributes,styles,percent,emit,get delay(){return delay;},expire:()=>timeout(),get cleared(){return cleared;}};
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
