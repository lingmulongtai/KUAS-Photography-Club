import {finishSteps} from './task-yield';
import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { LINE, type LineFeature } from './lines-data';
import { ROAD_WIDTH } from './roads';
import { rng } from './util';
import { trafficSegments, trafficLaneFraction } from './traffic-access';
import {trafficJunctions,chooseConnection} from './traffic-junctions';
import { remainingAfterSignal, signalApproaches, signalAspect } from './traffic-signals';
import { buildSignalHeads } from './traffic-signal-heads';
import { lightSpriteGeometry, LIGHT_SPRITE_VERTEX, LIGHT_SPRITE_FRAGMENT } from './light-sprites';

/*
 * Traffic: small cars driving on the left along the real avenues and main streets. Each car
 * follows one road line from end to end at its own speed in its own lane, then turns up on
 * another road. By day they are little boxes in the usual Japanese car colours; after dark
 * headlights shine toward the camera and tail lights glow red going away, which from the
 * hills draws Kyoto's grid in moving light.
 */

interface Path {
  pts: Float32Array;
  /** distance from the start to each point */
  cum: Float32Array;
  rank: number;
  motorway: boolean;
}

/** Cars per metre of road, each way. */
const DENSITY = [0, 0, 1 / 240, 1 / 70, 1 / 45];
const SPEED = [0, 0, [6, 9], [9, 12.5], [11, 15]] as const;
/** Lane centres from the middle of the road, as a share of its width. */
const LANES = [[], [], [0.25], [0.12, 0.33], [0.1, 0.24, 0.38]];
const COLORS = [
  [0.82, 0.82, 0.8], [0.82, 0.82, 0.8], [0.82, 0.82, 0.8], // white
  [0.48, 0.5, 0.52], [0.48, 0.5, 0.52], // silver
  [0.05, 0.05, 0.055], [0.05, 0.05, 0.055], // black (and the MK taxis)
  [0.2, 0.21, 0.23], // grey
  [0.08, 0.13, 0.25], // dark blue
  [0.42, 0.06, 0.05], // red
  [0.62, 0.55, 0.12], // a yellow taxi now and then
  [0.1, 0.25, 0.14], // green taxi
];

/** A car: body and cabin as two boxes. Local x forward, y up, z across. */
function carShape() {
  const parts: [number, number, number, number, number, number, number][] = [
    // sx, sy, sz, cx, cy, cz, part (0 body, 1 cabin)
    [4.4, 0.72, 1.72, 0, 0.6, 0, 0],
    [2.3, 0.58, 1.5, -0.25, 1.25, 0, 1],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const part: number[] = [];
  for (const [sx, sy, sz, cx, cy, cz, k] of parts) {
    const box = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
    box.translate(cx, cy, cz);
    pos.push(...(box.getAttribute('position').array as Float32Array));
    nrm.push(...(box.getAttribute('normal').array as Float32Array));
    for (let i = 0; i < box.getAttribute('position').count; i++) part.push(k);
    box.dispose();
  }
  return { pos, nrm, part };
}

export function* buildCarsSteps(env: Env, hf: Heightfield, lines: LineFeature[], quality: number,
  roadHeight?: (x: number, z: number, dx: number, dz: number) => number) {
  const r = rng(131);
  const paths: Path[] = [];
  const weight: number[] = [];
  let scanned=0;
  for (const f of lines) {
    if(++scanned%128===0)yield;
    if (f.kind !== LINE.road) continue;
    const rank = f.attr & 15;
    if (rank < 2) continue;
    for (const p of trafficSegments(f.pts)) {
      const n = p.length / 2;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      if (cum[n - 1] < 80) continue;
      paths.push({ pts: p, cum, rank, motorway: (f.attr >> 4) === 3 });
      weight.push(cum[n - 1] * DENSITY[rank] * 2);
    }
  }
  const total = weight.reduce((a, b) => a + b, 0);
  yield;
  const junctions=trafficJunctions(paths);
  yield;
  const approaches = signalApproaches(paths, junctions, ROAD_WIDTH, (x,z,dx,dz) =>
    !!roadHeight && roadHeight(x,z,dx,dz) > hf.height(x,z) + 1, quality > .75 ? 520 : 260);
  const controlled = new Int32Array(paths.length * 2).fill(-1);
  const queues = approaches.map((arm, index) => {
    controlled[arm.path * 2 + arm.end] = index;
    return LANES[arm.rank].map(() => [] as number[]);
  });
  const count = Math.round(Math.min(total, quality > 0.75 ? 12000 : 4000) * Math.min(1, quality * 1.1));
  // pick roads in proportion to how many cars they carry
  const cumW = new Float64Array(weight.length);
  weight.reduce((acc, w, i) => (cumW[i] = acc + w), 0);
  const pickPath = () => {
    const x = r() * total;
    let lo = 0;
    let hi = cumW.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumW[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const pathOf = new Int32Array(count);
  const segOf = new Int32Array(count);
  const dist = new Float32Array(count);
  const dir = new Int8Array(count);
  const speed = new Float32Array(count);
  const velocity = new Float32Array(count), advance = new Float32Array(count);
  const remaining = new Float32Array(count), laneNumber = new Uint8Array(count);
  const lane = new Float32Array(count);
  const place = (i: number, anywhere: boolean) => {
    const k = pickPath();
    const path = paths[k];
    const len = path.cum[path.cum.length - 1];
    pathOf[i] = k;
    dir[i] = r() < 0.5 ? 1 : -1;
    dist[i] = anywhere ? r() * len : dir[i] > 0 ? 0 : len;
    segOf[i] = 0;
    while (segOf[i] < path.cum.length - 2 && path.cum[segOf[i] + 1] < dist[i]) segOf[i]++;
    const [lo, hi] = SPEED[path.rank] as readonly [number, number];
    speed[i] = lo + r() * (hi - lo);
    velocity[i] = speed[i];
    const lanes = LANES[path.rank];
    laneNumber[i] = Math.floor(r() * lanes.length);
    lane[i] = lanes[laneNumber[i]] * ROAD_WIDTH[path.rank];
  };
  for (let i=0;i<count;i++){if(i && i%256===0)yield;place(i,true);}

  /* ---- bodies ---- */
  const shape = carShape();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(shape.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(shape.nrm, 3));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(shape.part, 1));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const iDir = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  iPos.setUsage(THREE.DynamicDrawUsage);
  iDir.setUsage(THREE.DynamicDrawUsage);
  const color = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.set(COLORS[Math.floor(r() * COLORS.length)], i * 3);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iDir', iDir);
  const iColor = new THREE.InstancedBufferAttribute(color.slice(),3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iColor',iColor);
  geo.instanceCount = count;
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader: /* glsl */ `
      attribute float aPart;
      attribute vec3 iPos;
      attribute vec2 iDir;
      attribute vec3 iColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec3 vLocalN;
      varying vec3 vColor;
      varying float vPart;
      void main(){
        vec2 f = iDir;
        vec2 side = vec2(-f.y, f.x);
        vec3 w = iPos + vec3(f.x * position.x + side.x * position.z, position.y, f.y * position.x + side.y * position.z);
        vWorld = w;
        vNormal = vec3(f.x * normal.x + side.x * normal.z, normal.y, f.y * normal.x + side.y * normal.z);
        vLocal = position;
        vLocalN = normal;
        vColor = iColor;
        vPart = aPart;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec3 vLocalN;
      varying vec3 vColor;
      varying float vPart;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 alb = vColor;
        vec3 emit = vec3(0.);
        bool cabin = vPart > .5;
        // windows all round the cabin, a dark band of bumper and tyres at the bottom
        if (cabin && vLocalN.y < .5) alb = vec3(.02, .025, .03);
        if (!cabin && vLocal.y < .32) alb = vec3(.025);
        // lamps: two headlights at the front, a red bar at the back
        if (!cabin && abs(vLocal.z) > .45 && vLocal.y > .6 && vLocalN.x > .5) emit += vec3(1., .92, .78) * 3. * uCity;
        if (!cabin && vLocal.y > .6 && vLocalN.x < -.5) emit += vec3(1., .05, .02) * (.25 + 1.6 * uCity);
        vec3 col = shade(alb, n, vWorld, 1.);
        // a little sky in the glass and paint
        vec3 v = normalize(vWorld - cameraPosition);
        col += skyColor(reflect(v, n)) * (cabin && vLocalN.y < .5 ? .12 : .05);
        gl_FragColor = vec4(applyHaze(col, emit, vWorld), 1.);
      }
    `,
  });
  const bodies = new THREE.Mesh(geo, bodyMat);
  bodies.frustumCulled = false;

  /* ---- lights, which stay visible as points of light from far away ---- */
  const lpos = new THREE.InstancedBufferAttribute(new Float32Array(count * 2 * 3), 3);
  const ldir = new THREE.InstancedBufferAttribute(new Float32Array(count * 2 * 2), 2);
  const lgeo = lightSpriteGeometry(lpos);
  lpos.setUsage(THREE.DynamicDrawUsage);
  ldir.setUsage(THREE.DynamicDrawUsage);
  const head = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) head[i * 2] = 1;
  lgeo.setAttribute('aDir', ldir);
  lgeo.setAttribute('aHead', new THREE.InstancedBufferAttribute(head, 1));
  const lightMat = new THREE.ShaderMaterial({
    uniforms: { ...env, uScale: { value: 1 }, uDpr: { value: 1 } },
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${LIGHT_SPRITE_VERTEX}
      attribute vec2 aDir;
      attribute float aHead;
      varying vec3 vColor;
      void main(){
        vec3 toCam = normalize(cameraPosition - aLightPosition);
        float facing = dot(vec3(aDir.x, 0., aDir.y), toCam);
        // headlights are seen from in front, tail lights from behind
        float seen = aHead > .5 ? smoothstep(-.1, .3, facing) : 1. - smoothstep(-.3, .1, facing);
        vec3 c = aHead > .5 ? vec3(1., .9, .72) * 2.4 : vec3(1., .07, .03) * 1.7;
        vec4 mv = viewMatrix * vec4(aLightPosition, 1.);
        float dist = max(-mv.z,.01);
        float s = uScale / uDpr * 1.5 / dist;
        float core = clamp(s, 1., 3.5);
        float px = max(4.,core*2.);
        // only after dark, and not so big right under the viewpoint that they flood the bloom
        float near = 1. - smoothstep(2., 3.5, s) * .6;
        // far lights are drawn larger than they are and dim with their true area, so a far
        // road glows the same on every screen width rather than piling up into glare
        float fade = clamp(s, .05, 1.);
        float far = min(1., pow(fade, 1.5) * 7.);
        vColor = c * seen * uCity * near * far * mix(hazeTransmittance(aLightPosition), 1., .4) * (core*core/(px*px));
        gl_Position = lightSprite(mv,px);
      }
    `,
    fragmentShader: LIGHT_SPRITE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Mesh(lgeo, lightMat);
  points.frustumCulled = false;

  /* ---- driving ---- */
  const pos = iPos.array as Float32Array;
  const fwd = iDir.array as Float32Array;
  const lp = lpos.array as Float32Array;
  const ld = ldir.array as Float32Array;
  const deckPath = new Int32Array(count).fill(-1), deckDistance = new Float32Array(count);
  const deckHeight = new Float32Array(count).fill(-Infinity);
  function planMovement(dt: number) {
    for (let i = 0; i < count; i++) {
      advance[i] = Math.min(speed[i], velocity[i] + 2.6 * dt) * dt;
      const end = dir[i] > 0 ? 1 : 0;
      const signal = controlled[pathOf[i] * 2 + end];
      if (signal < 0) continue;
      const cum = paths[pathOf[i]].cum;
      remaining[i] = end ? cum[cum.length - 1] - dist[i] : dist[i];
      queues[signal][laneNumber[i]].push(i);
    }
    for (let j = 0; j < approaches.length; j++) {
      const arm = approaches[j], aspect = signalAspect(env.uTime.value, arm.phase);
      const stop = arm.line + 2.4; // The front bumper stops just before the paint.
      for (const queue of queues[j]) {
        if (!queue.length) continue;
        queue.sort((a,b) => remaining[a] - remaining[b]);
        let leader = -Infinity;
        for (const i of queue) {
          const before = remaining[i];
          const move = aspect !== 0 && before >= stop - .03
            ? Math.min(advance[i], Math.sqrt(7 * Math.max(0,before - stop)) * dt) : advance[i];
          leader = remainingAfterSignal(before, move, stop, aspect, leader);
          advance[i] = before - leader;
        }
        queue.length = 0;
      }
    }
  }
  // Traffic continues to simulate around the city. Stream just the bodies and lamps in view.
  const carBounds=new THREE.Sphere(new THREE.Vector3(),4);
  function update(dt: number, frustum?:THREE.Frustum, inHorizontalView?:(x:number,z:number,margin:number)=>boolean) {
    planMovement(dt);
    let drawn=0;
    for (let i = 0; i < count; i++) {
      let path = paths[pathOf[i]];
      let n = path.cum.length;
      dist[i] += dir[i] * advance[i];
      if (dt > 0) velocity[i] = advance[i] / dt;
      if (dist[i] < 0 || dist[i] > path.cum[n - 1]) {
        const end=dir[i]>0?1:0,pts=path.pts,a=end?pts.length-4:2,b=end?pts.length-2:0;
        const dx=pts[b]-pts[a],dz=pts[b+1]-pts[a+1],len=Math.hypot(dx,dz)||1;
        const next=chooseConnection(junctions[pathOf[i]][end],dx/len,dz/len,r());
        if(next){
          const overflow=end?dist[i]-path.cum[n-1]:-dist[i];
          pathOf[i]=next.path;path=paths[next.path];n=path.cum.length;dir[i]=next.end?-1:1;
          dist[i]=next.end?Math.max(0,path.cum[n-1]-overflow):Math.min(path.cum[n-1],overflow);
          segOf[i]=next.end?n-2:0;
          const lanes=LANES[path.rank], width=ROAD_WIDTH[path.rank];
          let best=0;
          for(let l=1;l<lanes.length;l++)if(Math.abs(lanes[l]*width-lane[i])<Math.abs(lanes[best]*width-lane[i]))best=l;
          laneNumber[i]=best; lane[i]=lanes[best]*width;
        }else place(i, false);
        path = paths[pathOf[i]];
        n = path.cum.length;
      }
      let s = segOf[i];
      while (s < n - 2 && path.cum[s + 1] < dist[i]) s++;
      while (s > 0 && path.cum[s] > dist[i]) s--;
      segOf[i] = s;
      const p = path.pts;
      const ax = p[s * 2], az = p[s * 2 + 1], bx = p[s * 2 + 2], bz = p[s * 2 + 3];
      const len = path.cum[s + 1] - path.cum[s] || 1;
      const t = (dist[i] - path.cum[s]) / len;
      const ux = ((bx - ax) / len) * dir[i];
      const uz = ((bz - az) / len) * dir[i];
      // keep left: the left of a heading (ux, uz) is (uz, -ux) with x east and z south
      const cx=ax+(bx-ax)*t,cz=az+(bz-az)*t;
      if(inHorizontalView&&!inHorizontalView(cx,cz,Math.abs(lane[i])+carBounds.radius))continue;
      const fraction=trafficLaneFraction(cx,cz,uz*lane[i],-ux*lane[i]);
      const x = cx + uz * lane[i]*fraction;
      const z = cz - ux * lane[i]*fraction;
      const ground = hf.height(x, z);
      // On a deck follow its slope every step. On ordinary streets, repeat the
      // spatial lookup only after the car has moved another two metres.
      if (roadHeight && (deckHeight[i] > ground || deckPath[i] !== pathOf[i] || Math.abs(deckDistance[i] - dist[i]) > 2)) {
        const elevation = roadHeight(x,z,ux,uz);
        deckHeight[i] = Number.isFinite(elevation) && elevation > ground ? elevation : -Infinity;
        deckDistance[i] = dist[i]; deckPath[i] = pathOf[i];
      }
      const y = Math.max(ground, deckHeight[i]) + .05;
      carBounds.center.set(x,y+.8,z);
      if(frustum&&!frustum.intersectsSphere(carBounds))continue;
      const dst=drawn++;
      iColor.setXYZ(dst,color[3*i],color[3*i+1],color[3*i+2]);
      pos[dst * 3] = x;
      pos[dst * 3 + 1] = y;
      pos[dst * 3 + 2] = z;
      fwd[dst * 2] = ux;
      fwd[dst * 2 + 1] = uz;
      const o = dst * 6;
      lp[o] = x + ux * 2.3;
      lp[o + 1] = y + 0.75;
      lp[o + 2] = z + uz * 2.3;
      lp[o + 3] = x - ux * 2.3;
      lp[o + 4] = y + 0.85;
      lp[o + 5] = z - uz * 2.3;
      ld[dst * 4] = ux;
      ld[dst * 4 + 1] = uz;
      ld[dst * 4 + 2] = ux;
      ld[dst * 4 + 3] = uz;
    }
    geo.instanceCount=drawn;
    lgeo.instanceCount=drawn*2;
    for(const [attribute,instances] of [[iPos,drawn],[iDir,drawn],[iColor,drawn],[lpos,drawn*2],[ldir,drawn*2]] as const){
      attribute.clearUpdateRanges();
      if(instances){
        attribute.addUpdateRange(0,instances*attribute.itemSize);
        attribute.needsUpdate=true;
      }
    }
  }
  update(0);

  const group = new THREE.Group();
  group.add(bodies, points);
  group.add(buildSignalHeads(approaches, ROAD_WIDTH, (x,z) => hf.height(x,z), lightMat.uniforms as typeof env & {uScale:{value:number};uDpr:{value:number}}));
  return { group, update, uniforms: lightMat.uniforms as typeof lightMat.uniforms & { uScale: { value: number }; uDpr: { value: number } }, count };
}

export function buildCars(...args: Parameters<typeof buildCarsSteps>){
  return finishSteps(buildCarsSteps(...args));
}
