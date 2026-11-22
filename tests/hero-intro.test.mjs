import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {HOME_LANGUAGE_SWITCH_HASH} from '../src/lib/i18n.ts';

const source=readFileSync(new URL('../src/components/HeroIntro.astro',import.meta.url),'utf8');
const script=source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const classes=()=>{
  const set=new Set();
  return {add:value=>set.add(value),remove:value=>set.delete(value),contains:value=>set.has(value)};
};
function mount({unsupported=false,throws=false,reduced=true,animated=false,userAgent='Mozilla/5.0',hostname='kuas-photography-club.vercel.app',hash=''}={}) {
  const document=new EventTarget(),button=new EventTarget(),attributes=new Map(),styles=new Map(),percent={textContent:'00%'};
  const animations=[],ring=[];
  const animate=(_frames,options)=>{animations.push(options);return {finished:new Promise(()=>{}),cancel(){}};};
  const flash={animate};
  const element=()=>({style:{setProperty(){}},animate:animated?animate:undefined});
  const iris=element(),parts={'.intro-head':element(),'.intro-city':element(),'.intro-foot':element()};
  // the ring's half turns and its dot: their compositor animations are kept apart from the exit's
  const turn=()=>({style:{},animate:animated?(frames,options)=>{ring.push({frames,options});return {cancel(){},startTime:0};}:undefined});
  const turns={'.is-low .intro-turn':turn(),'.is-high .intro-turn':turn(),'.intro-ring-dot':turn()};
  const progress={setAttribute:(key,value)=>attributes.set(key,value),getBoundingClientRect:()=>({left:100,top:100,width:120,height:120})};
  class Dialog extends EventTarget {
    dataset={languageSwitchHash:HOME_LANGUAGE_SWITCH_HASH};
    open=false;closed=0;classList=classes();style={setProperty:(key,value)=>styles.set(key,value)};
    animate=animated?animate:undefined;
    showModal(){if(throws)throw Error('unsupported state');this.open=true;}
    close(){this.open=false;this.closed++;this.dispatchEvent(new Event('close'));}
    querySelector(selector){return selector==='button'?button:selector==='.intro-percent'?percent:selector==='.intro-flash'?flash:
      selector==='.intro-iris'?iris:parts[selector]??turns[selector]??progress;}
  }
  const intro=new Dialog();if(unsupported)intro.showModal=undefined;
  document.currentScript={previousElementSibling:intro};document.documentElement={classList:classes()};
  let delay,cleared=false,frames=[],clock=0,nextTimer=0;
  const timers=new Map();
  const advance=ms=>{
    const end=clock+ms;
    for(;;){
      const due=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due||due[1].at>end+1e-8)break;
      clock=due[1].at;timers.delete(due[0]);due[1].callback();
    }
    clock=end;
  };
  runInNewContext(script,{document,Event,navigator:{userAgent},location:{hostname,hash},HTMLDialogElement:Dialog,matchMedia:()=>({matches:reduced}),
    performance:{now:()=>clock},innerWidth:1280,innerHeight:720,
    setTimeout:(callback,ms)=>{delay=ms;const id=++nextTimer;timers.set(id,{callback,at:clock+ms});return id;},
    clearTimeout:id=>{cleared=true;timers.delete(id);},
    requestAnimationFrame:callback=>frames.push(callback),cancelAnimationFrame:()=>{frames=[];}});
  const emit=(type,detail)=>document.dispatchEvent(new CustomEvent(type,{detail}));
  // play display frames at 60 fps
  const run=seconds=>{for(let i=0;i<Math.round(seconds*60);i++){const due=frames;frames=[];advance(1000/60);due.forEach(frame=>frame(clock));}};
  const expire=()=>{const due=[...timers.values()].sort((a,b)=>a.at-b.at)[0];if(due)advance(due.at-clock);};
  return {intro,document,button,attributes,styles,percent,animations,ring,turns,emit,run,advance,get delay(){return delay;},get scheduledTimers(){return nextTimer;},expire,get cleared(){return cleared;}};
}

test('deployment screenshots use the still scene while normal browsers retain the intro',()=>{
  const headless='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.0 Safari/537.36';
  for(const options of [{userAgent:'Vercelbot (+https://vercel.com)'}, {userAgent:'vercel-screenshot-bot'},
    {userAgent:headless,hostname:'kuas-photography-club-39qmebkmq-lingmulongtais-projects.vercel.app'}]) {
    const state=mount(options);
    assert.equal(state.intro.open,false);
    assert.equal(state.document.documentElement.classList.contains('hero-intro-open'),false);
    assert.ok(state.document.documentElement.classList.contains('screenshot-preview'));
  }
  for(const userAgent of ['Mozilla/5.0', 'Googlebot/2.1', 'NotVercelbot/1.0', headless]) {
    assert.equal(mount({userAgent}).intro.open,true,userAgent);
  }
  assert.equal(mount({userAgent:headless,hostname:'localhost'}).intro.open,true);
});

test('switching the home language skips the modal and leaves the live scene enabled',()=>{
  const state=mount({hash:HOME_LANGUAGE_SWITCH_HASH,reduced:false,animated:true});
  assert.equal(state.intro.open,false);
  assert.equal(state.document.documentElement.classList.contains('hero-intro-open'),false);
  assert.equal(state.document.documentElement.classList.contains('screenshot-preview'),false);
  assert.equal(state.scheduledTimers,0);
  assert.equal(mount({hash:'#intro'}).intro.open,true);
});

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

test('the page hears once the intro is gone',()=>{
  const state=mount();let heard=0;state.document.addEventListener('hero:intro-done',()=>heard++);
  state.emit('hero:progress',.5);assert.equal(heard,0);
  state.emit('hero:ready');assert.equal(heard,1);state.emit('hero:error');assert.equal(heard,1);
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

test('a missing main bundle cannot block the site beyond the stall watchdog, even without animation frames',()=>{
  const state=mount();assert.equal(state.delay,6000);
  state.advance(5999);assert.equal(state.intro.open,true);state.advance(1);
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
  for(let i=0;i<120;i++){state.run(1/60);seen.push(parseInt(state.percent.textContent));}
  assert.ok(seen[5]<35,'no snap to the new value');
  assert.ok(seen.every((value,i)=>i===0||value>=seen[i-1]),'never runs backwards');
  assert.ok(seen.filter(value=>value>15&&value<60).length>15,'passes through the values between');
  assert.equal(Math.max(...seen),60,'never ahead of the real progress');
  assert.equal(seen.at(-1),60);
  assert.equal(state.styles.get('--progress'),'0.6');
});

test('readiness lets the count reach 100% before the scene opens, and opens promptly without artificial delay',()=>{
  const state=mount({reduced:false});
  state.emit('hero:progress',.6);state.run(2);state.emit('hero:ready');
  assert.equal(state.intro.open,true,'the count finishes first');
  state.run(.5);assert.equal(state.percent.textContent,'100%');assert.equal(state.intro.open,false);
  // frames stop in a background tab: the page still opens promptly after readiness
  const stalled=mount({reduced:false});stalled.emit('hero:progress',.3);stalled.emit('hero:ready');
  assert.ok(stalled.delay<=800,'background tab closes promptly after ready');stalled.expire();assert.equal(stalled.intro.open,false);
  // skipping does not wait for the count
  const skipped=mount({reduced:false});skipped.emit('hero:progress',.4);skipped.emit('hero:ready');
  skipped.button.dispatchEvent(new Event('click'));assert.equal(skipped.intro.open,false);
});

test('a fast load plays a brief continuous glide to 100% without holding a multi-second floor',()=>{
  const state=mount({reduced:false});
  state.emit('hero:progress',.2);state.run(.2);
  assert.ok(parseInt(state.percent.textContent)<=20);
  state.emit('hero:ready');
  const seen=[];
  for(let i=0;i<24;i++){state.run(1/60);seen.push(parseInt(state.percent.textContent));}
  assert.equal(state.intro.open,true);
  assert.ok(seen.at(-1)<100,'the count stays in motion during the glide');
  assert.ok(seen.every((value,i)=>i===0||value>=seen[i-1]));
  assert.ok(new Set(seen).size>10,'the count advances smoothly to 100%');
  state.run(.4);assert.equal(state.percent.textContent,'100%');assert.equal(state.intro.open,false);
});

test('active progress extends the stall watchdog until readiness, bounded by the hard cap',()=>{
  const state=mount({reduced:false});
  state.advance(3000);state.emit('hero:progress',.3);
  state.advance(3500);state.emit('hero:progress',.7);
  // Still open past 6.5 s because real progress is arriving
  assert.equal(state.intro.open,true);
  // Stalling for 6 s without further progress dismisses cleanly
  state.advance(5999);assert.equal(state.intro.open,true);
  state.advance(1);assert.equal(state.intro.open,false);
  // Continuous trickle still cannot exceed the 20 s hard cap
  const capped=mount({reduced:false});
  for(let step=1;step<=10;step++){
    capped.advance(2000);
    if(step<10){capped.emit('hero:progress',step*.09);assert.equal(capped.intro.open,true);}
  }
  assert.equal(capped.intro.open,false);
  const percent=capped.percent.textContent;
  capped.emit('hero:progress',1);capped.emit('hero:ready');capped.emit('hero:error');
  assert.equal(capped.intro.closed,1);assert.equal(capped.percent.textContent,percent);
});

test('late readiness and duplicate ready events still close cleanly within the hard cap',()=>{
  const state=mount({reduced:false});
  state.advance(4000);state.emit('hero:progress',.5);
  state.advance(5000);state.emit('hero:progress',.85);
  state.advance(4000);state.emit('hero:ready');
  state.run(.2);state.emit('hero:ready');assert.equal(state.intro.open,true);
  state.run(.6);assert.equal(state.intro.open,false);assert.equal(state.intro.closed,1);
});

test('the watchdog releases the modal at once and still opens onto the page with the iris',()=>{
  const state=mount({reduced:false,animated:true});
  state.emit('hero:progress',.4);
  state.advance(6000);
  assert.equal(state.intro.open,false);assert.equal(state.intro.closed,1);
  assert.equal(state.document.documentElement.classList.contains('hero-intro-open'),false,'scrolling is released immediately');
  assert.ok(state.intro.classList.contains('is-leaving'),'no cut straight to the page');
  assert.ok(state.animations.some(({duration})=>duration===900));
});

test('an early exit closes the modal before its animation and bounds the remaining visual transition',()=>{
  const state=mount({reduced:false,animated:true});
  state.advance(3500);state.button.dispatchEvent(new Event('click'));
  assert.equal(state.intro.open,false);
  assert.equal(state.document.documentElement.classList.contains('hero-intro-open'),false);
  assert.ok(state.animations.length>=2);
  assert.ok(state.animations.every(({duration,delay=0})=>duration+delay<=550),'a skip opens briskly');
});

test('a late but successful load still plays the whole opening instead of skipping it',()=>{
  const state=mount({reduced:false,animated:true});
  state.advance(4000);state.emit('hero:progress',.8);
  state.run(1);state.emit('hero:ready');state.run(.8);
  assert.equal(state.intro.open,false);
  assert.ok(state.animations.some(({duration})=>duration===900),'the iris keeps its full length');
});

test('the ring is handed to the compositor and keeps the upper half hidden before halfway so no 50% dot leaks',()=>{
  const state=mount({reduced:false,animated:true});
  state.emit('hero:progress',.45);
  const [,highEarly]=state.ring;
  assert.ok(highEarly.frames.every(frame=>frame.opacity===0),'upper half stays invisible before 50% handover');
  state.emit('hero:progress',.65);
  assert.equal(state.ring.length,6,'two glides of three ring layers');
  const [low,high]=state.ring.slice(-3),deg=frame=>parseFloat(frame.transform.slice(7));
  for(const {frames,options} of state.ring.slice(-3)){
    assert.ok(frames.every(frame=>/^rotate\(-?[\d.e-]+deg\)$/.test(frame.transform)),'transforms only');
    assert.equal(options.fill,'both');assert.ok(options.duration>=300&&options.duration<=1100);
  }
  // the low half is complete and the high half stays opacity 0 until crossing halfway
  const handover=low.frames.findIndex(frame=>deg(frame)===0);
  assert.ok(handover>0);assert.ok(Math.abs(deg(high.frames[handover])+180)<.01);
  assert.ok(high.frames.slice(0,handover).every(frame=>frame.opacity===0),'hidden right up to handover');
  assert.equal(high.frames.at(-1).opacity,1,'visible once past halfway');
  assert.ok(deg(high.frames.at(-1))>-180,'past halfway the high half turns in');
  state.emit('hero:progress',.5);assert.equal(state.ring.length,6,'no step backwards');
});

test('without compositor animations the ring is still placed every frame and hides the upper half before halfway',()=>{
  const state=mount({reduced:false});
  state.emit('hero:progress',.3);state.run(2);
  assert.match(state.turns['.intro-ring-dot'].style.transform,/rotate\(102.6deg\)/);
  assert.equal(state.turns['.is-high .intro-turn'].style.opacity,'0');
  state.emit('hero:progress',.7);state.run(2);
  assert.equal(state.turns['.is-high .intro-turn'].style.opacity,'1');
});
