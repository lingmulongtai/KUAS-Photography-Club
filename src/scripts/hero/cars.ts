import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { LINE, type LineFeature } from './lines-data';
import { ROAD_WIDTH } from './roads';
import { rng } from './util';
import { trafficSegments, trafficLaneFraction } from './traffic-access';
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

export function buildCars(env: Env, hf: Heightfield, lines: LineFeature[], quality: number) {
  const r = rng(131);
  const paths: Path[] = [];
  const weight: number[] = [];
  for (const f of lines) {
    if (f.kind !== LINE.road) continue;
    const rank = f.attr & 15;
    if (rank < 2) continue;
    for (const p of trafficSegments(f.pts)) {
      const n = p.length / 2;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      if (cum[n - 1] < 80) continue;
      paths.push({ pts: p, cum, rank });
      weight.push(cum[n - 1] * DENSITY[rank] * 2);
    }
  }
  const total = weight.reduce((a, b) => a + b, 0);
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
    const lanes = LANES[path.rank];
    lane[i] = lanes[Math.floor(r() * lanes.length)] * ROAD_WIDTH[path.rank];
  };
  for (let i = 0; i < count; i++) place(i, true);

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
  geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(color, 3));
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
    uniforms: { ...env, uScale: { value: 1 } },
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
        float core = clamp(uScale * 1.5 / dist, 1., 3.5);
        float px = max(4.,core*2.);
        // only after dark, and not so big right under the viewpoint that they flood the bloom
        float near = 1. - smoothstep(2., 3.5, uScale * 1.5 / dist) * .6;
        // lights drawn larger than they are, far away, would pile up into glare
        float far = pow(clamp(uScale * 1.5 / dist, .12, 1.), .6);
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
  function update(dt: number) {
    for (let i = 0; i < count; i++) {
      let path = paths[pathOf[i]];
      let n = path.cum.length;
      dist[i] += dir[i] * speed[i] * dt;
      if (dist[i] < 0 || dist[i] > path.cum[n - 1]) {
        place(i, false);
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
      const fraction=trafficLaneFraction(cx,cz,uz*lane[i],-ux*lane[i]);
      const x = cx + uz * lane[i]*fraction;
      const z = cz - ux * lane[i]*fraction;
      const y = hf.height(x, z) + 0.05;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      fwd[i * 2] = ux;
      fwd[i * 2 + 1] = uz;
      const o = i * 6;
      lp[o] = x + ux * 2.3;
      lp[o + 1] = y + 0.75;
      lp[o + 2] = z + uz * 2.3;
      lp[o + 3] = x - ux * 2.3;
      lp[o + 4] = y + 0.85;
      lp[o + 5] = z - uz * 2.3;
      ld[i * 4] = ux;
      ld[i * 4 + 1] = uz;
      ld[i * 4 + 2] = ux;
      ld[i * 4 + 3] = uz;
    }
    iPos.needsUpdate = true;
    iDir.needsUpdate = true;
    lpos.needsUpdate = true;
    ldir.needsUpdate = true;
  }
  update(0);

  const group = new THREE.Group();
  group.add(bodies, points);
  return { group, update, uniforms: lightMat.uniforms as typeof lightMat.uniforms & { uScale: { value: number } }, count };
}
