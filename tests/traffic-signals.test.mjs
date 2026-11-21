import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTrafficView} from '../src/scripts/hero/traffic-view.ts';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import { readFile } from 'node:fs/promises';
import { signalApproaches, signalAspect, remainingAfterSignal, VEHICLE_GAP } from '../src/scripts/hero/traffic-signals.ts';
import { trafficJunctions } from '../src/scripts/hero/traffic-junctions.ts';
import { trafficSegments } from '../src/scripts/hero/traffic-access.ts';
import { loadLines, LINE } from '../src/scripts/hero/lines-data.ts';

const widths = [3, 4.5, 9, 16, 24];
const road = (...coords) => ({ pts: Float32Array.from(coords), rank: 3, motorway: false });
const cross = () => [road(-100,0, 0,0), road(0,0, 100,0), road(0,0, 0,100), road(0,-100, 0,0)];
const at = (paths, elevated = () => false, cap = 100) => signalApproaches(paths, trafficJunctions(paths), widths, elevated, cap);

test('perpendicular approaches never get simultaneous green; amber and all-red clear the crossing', () => {
  const arms = at(cross());
  assert.equal(arms.length, 4);
  const [a,b,c,d] = arms;
  assert.equal(a.phase,b.phase); assert.equal(c.phase,d.phase);
  let amber = 0, clear = 0;
  for (let t = 0; t < 52; t++) {
    const main = signalAspect(t, a.phase), side = signalAspect(t, c.phase);
    if (main === 1) amber++;
    if (main === 2 && side === 2) clear++;
    assert.ok(main === 2 || side === 2);
  }
  assert.equal(amber, 3); assert.equal(clear, 4);
  assert.equal(at(cross().slice(0,3)).length, 3, 'at-grade T junction');
  assert.equal(at(cross(), () => false, 3).length, 0, 'no partially signalled intersection');
});

test('a geometric crossing, grade-separated arm, expressway or simple bend gets no signal', () => {
  assert.equal(at([road(-100,0,100,0),road(0,-100,0,100)]).length,0);
  assert.equal(at(cross(), (_x,z) => z > 1).length,0);
  const freeway = cross(); freeway[1].motorway = true;
  assert.equal(at(freeway).length,0);
  assert.equal(at([road(-100,0,0,0),road(0,0,20,100)]).length,0);
});

test('cars queue in lane behind the front bumper, tolerate position rounding, and depart on green', () => {
  const stop = 12.4;
  let front = 18, rear = 27;
  for (let frame=0; frame<100; frame++) {
    front = remainingAfterSignal(front, .5, stop, 2, -Infinity);
    rear = remainingAfterSignal(rear, .6, stop, 2, front);
    assert.ok(rear - front >= VEHICLE_GAP - 1e-8);
  }
  assert.equal(front,stop);
  assert.ok(Math.abs(rear - stop - VEHICLE_GAP) < 1e-8);
  assert.equal(remainingAfterSignal(stop-.001,1,stop,1,-Infinity), stop-.001);
  assert.equal(remainingAfterSignal(stop-1,1,stop,1,-Infinity), stop-2, 'already across');
  front = remainingAfterSignal(front,.7,stop,0,-Infinity);
  assert.ok(remainingAfterSignal(rear,.8,stop,0,front) < rear);
});

test('the shipped central, southern and Tamba networks contain bounded signal approaches', async t => {
  const original = globalThis.fetch;
  const root = new URL('../public/kyoto/', import.meta.url);
  globalThis.fetch = async url => new Response(await readFile(new URL(String(url).split('/').pop(),root)));
  t.after(() => { globalThis.fetch = original; });
  const { regions } = JSON.parse(await readFile(new URL('regions.json',root),'utf8'));
  for (const id of ['core','south','kameoka','sonobe']) {
    const m = regions.find(r => r.id === id)?.lines;
    const lines = await loadLines(undefined,m?.file,m?.box,m?.q);
    const paths = [];
    for (const l of lines) {
      if (l.kind !== LINE.road || (l.attr & 15) < 2) continue;
      for (const pts of trafficSegments(l.pts)) {
        let length = 0;
        for (let i=2;i<pts.length;i+=2) length += Math.hypot(pts[i]-pts[i-2],pts[i+1]-pts[i-1]);
        if (length >= 80) paths.push({ pts, rank:l.attr & 15, motorway:(l.attr >> 4) === 3 });
      }
    }
    const arms = at(paths, () => false, 260);
    assert.ok(arms.length >= 3 && arms.length <= 260, id);
  }
});

test('culling packs the same moving bodies, paint and lamps and preserves traffic outside the view',()=>{
  const code=buildSync({entryPoints:['src/scripts/hero/cars.ts'],bundle:true,format:'cjs',platform:'node',packages:'external',write:false}).outputFiles[0].text;
  const mod={exports:{}};new Function('require','module','exports',code)(createRequire(import.meta.url),mod,mod.exports);
  const lines=[{kind:LINE.road,attr:4,pts:new Float32Array([-500,0,500,0])}];
  const make=()=>mod.exports.buildCars({uTime:{value:10}},{height:()=>10},lines,1);
  const full=make(),clipped=make(),view={intersectsSphere:s=>s.center.x>0};
  full.update(.1);clipped.update(.1,view);
  const [bodies,lamps]=clipped.group.children.map(o=>o.geometry);
  const [original,originalLamps]=full.group.children.map(o=>o.geometry);
  const expected=[];
  for(let i=0;i<full.count;i++)if(original.getAttribute('iPos').getX(i)>0)expected.push(i);
  assert.ok(expected.length>0&&expected.length<full.count);
  assert.equal(bodies.instanceCount,expected.length);
  assert.equal(lamps.instanceCount,expected.length*2);
  for(const [drawn,id] of expected.entries()){
    assert.equal(bodies.getAttribute('iPos').getX(drawn),original.getAttribute('iPos').getX(id));
    assert.equal(bodies.getAttribute('iColor').getY(drawn),original.getAttribute('iColor').getY(id));
    assert.equal(lamps.getAttribute('aLightPosition').getX(2*drawn),originalLamps.getAttribute('aLightPosition').getX(2*id));
  }
  full.update(.1);clipped.update(.1);
  assert.deepEqual(bodies.getAttribute('iPos').array,original.getAttribute('iPos').array);
});

test('early map culling retains traffic throughout the lens at every elevation',()=>{
  const camera=new THREE.PerspectiveCamera(60,1.5,1,50000),view=createTrafficView();
  camera.position.set(300,570,1300);
  for(const pitch of [-1.56,-.55,.22]){
    camera.rotation.set(pitch,.6,.1,'YXZ');camera.updateMatrixWorld();
    view.update(camera,camera.projectionMatrix);
    for(const depth of [1.1,100,5000])for(const a of [-1,0,1])for(const b of [-1,0,1]){
      const p=new THREE.Vector3(a*depth/camera.projectionMatrix.elements[0],b*depth/camera.projectionMatrix.elements[5],-depth).applyMatrix4(camera.matrixWorld);
      assert.ok(view.contains(p.x,p.z,4));
    }
  }
  const rear=new THREE.Vector3(0,0,700).applyMatrix4(camera.matrixWorld);
  assert.equal(view.contains(rear.x,rear.z,4),false);
});
