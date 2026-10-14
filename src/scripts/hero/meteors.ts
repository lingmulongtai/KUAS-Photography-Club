import * as THREE from 'three';
import { rng } from './util';

/*
 * Occasional shooting stars with short, fine tails and a faint trace of glitter.
 * Taps still summon a meteor; natural appearances are sparse, especially by day.
 */

const MAX = 8;
const SEG = 24;
const GLITTER = 240;
const R = 30000;

interface Meteor {
  a: THREE.Vector3;
  b: THREE.Vector3;
  t: number;
  dur: number;
  len: number;
  width: number;
  bright: number;
  hue: number;
}

export function buildMeteors(quality: number) {
  const r = rng((Date.now() & 0xffff) ^ 0x5eed);
  const group = new THREE.Group();

  /* tails: one ribbon of SEG quads per meteor, rebuilt each frame */
  const tailPos = new Float32Array(MAX * (SEG + 1) * 2 * 3);
  const tailCol = new Float32Array(MAX * (SEG + 1) * 2 * 4);
  const tailUv = new Float32Array(MAX * (SEG + 1) * 2 * 2);
  const tailIdx: number[] = [];
  for (let m = 0; m < MAX; m++) {
    for (let i = 0; i < SEG; i++) {
      const o = (m * (SEG + 1) + i) * 2;
      tailIdx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
  }
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPos, 3).setUsage(THREE.DynamicDrawUsage));
  tailGeo.setAttribute('aColor', new THREE.BufferAttribute(tailCol, 4).setUsage(THREE.DynamicDrawUsage));
  tailGeo.setAttribute('aUv', new THREE.BufferAttribute(tailUv, 2));
  tailGeo.setIndex(tailIdx);
  const tailMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec4 aColor;
      attribute vec2 aUv;
      varying vec4 vColor;
      varying vec2 vUv;
      void main(){
        vColor = aColor;
        vUv = aUv;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec4 vColor;
      varying vec2 vUv;
      void main(){
        // soft core across the ribbon, broken up a little along it so it sparkles
        // with MSAA the edge pixels can see uv slightly outside 0..1: clamp, or pow() gives NaN
        float across = clamp(1. - abs(vUv.y * 2. - 1.), 0., 1.);
        float core = pow(across, 2.2) + pow(across, 12.) * .6;
        float flick = .92 + .08 * sin(vUv.x * 90. - uTime * 18.);
        gl_FragColor = vec4(vColor.rgb * vColor.a * core * flick, 1.);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const tails = new THREE.Mesh(tailGeo, tailMat);
  tails.frustumCulled = false;

  /* heads and glitter: star sprites */
  const N = MAX + GLITTER;
  const spritePos = new Float32Array(N * 3);
  const spriteCol = new Float32Array(N * 4);
  const spriteSize = new Float32Array(N);
  const spriteGeo = new THREE.BufferGeometry();
  spriteGeo.setAttribute('position', new THREE.BufferAttribute(spritePos, 3).setUsage(THREE.DynamicDrawUsage));
  spriteGeo.setAttribute('aColor', new THREE.BufferAttribute(spriteCol, 4).setUsage(THREE.DynamicDrawUsage));
  spriteGeo.setAttribute('aSize', new THREE.BufferAttribute(spriteSize, 1).setUsage(THREE.DynamicDrawUsage));
  const spriteMat = new THREE.ShaderMaterial({
    uniforms: { uDpr: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aColor;
      attribute float aSize;
      uniform float uDpr;
      varying vec4 vColor;
      void main(){
        vColor = aColor;
        gl_PointSize = aSize * uDpr;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec4 vColor;
      void main(){
        vec2 p = gl_PointCoord * 2. - 1.;
        float d = length(p);
        // a round glow with four thin rays: a twinkle
        float glow = exp(-d * d * 9.);
        float rays = exp(-abs(p.x) * 26.) * exp(-abs(p.y) * 2.6) + exp(-abs(p.y) * 26.) * exp(-abs(p.x) * 2.6);
        float a = (glow + rays * .16) * vColor.a;
        if (a < .004) discard;
        gl_FragColor = vec4(vColor.rgb * a, 1.);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprites = new THREE.Points(spriteGeo, spriteMat);
  sprites.frustumCulled = false;
  group.add(tails, sprites);
  group.renderOrder = 1;

  const live: Meteor[] = [];
  const glitter = Array.from({ length: GLITTER }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 1, life: 1, size: 2, col: new THREE.Color(), phase: 0 }));
  let gi = 0;
  let next = 10;
  const palette = [new THREE.Color(1, 1, 1), new THREE.Color(0.55, 0.95, 1), new THREE.Color(1, 0.88, 0.55), new THREE.Color(0.85, 0.7, 1)];

  const tmp = new THREE.Vector3();
  const pt = new THREE.Vector3();
  const side = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const head = new THREE.Vector3();
  const white = new THREE.Color(1, 1, 1);
  const teal = new THREE.Color(0.39, 0.86, 0.9);
  const violet = new THREE.Color(0.62, 0.42, 1);
  const c = new THREE.Color();

  function dirAt(az: number, alt: number, out: THREE.Vector3) {
    return out.set(Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az));
  }

  function spawn(viewAz: number, halfWidth: number, topAlt: number, big: boolean) {
    // start inside the strip of sky in view, sometimes just above it so they fall in
    const az = viewAz + (r() * 2 - 1) * halfWidth * 0.9;
    const alt = Math.max(0.05, topAlt * (0.4 + r() * 0.75));
    const a = dirAt(az, alt, new THREE.Vector3());
    // fall mostly downward and across
    const heading = (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.9);
    const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), a).normalize();
    const north = new THREE.Vector3().crossVectors(a, east).normalize();
    const travel = east.multiplyScalar(Math.sin(heading)).addScaledVector(north, -Math.cos(heading));
    const len = (big ? 16 + r() * 10 : 6 + r() * 10) * (Math.PI / 180);
    const b = a.clone().addScaledVector(travel, len).normalize();
    live.push({
      a,
      b,
      t: 0,
      dur: big ? 1.6 + r() * 0.8 : 0.55 + r() * 0.75,
      len: big ? 0.3 : 0.18 + r() * 0.12,
      width: big ? 1.5 : 0.6 + r() * 0.5,
      bright: big ? 1.2 : 0.55 + r() * 0.35,
      hue: r(),
    });
  }

  let pending = 0;

  return {
    group,
    spriteUniforms: spriteMat.uniforms,
    /** Send some shooting stars right away (a tap on the sky). */
    burst(n = 1) {
      pending += n;
    },
    /**
     * @param cam camera position (meteors live on a sphere around it)
     * @param view the camera's heading (radians from north, clockwise), half its horizontal field
     *   of view and the elevation of the top of the frame, so meteors fall where they can be seen
     * @param night 0 by day … 1 on a dark night
     * @param pxPerM pixels per metre at 1 m distance (for ribbon width)
     */
    update(time: number, dt: number, cam: THREE.Vector3, view: { az: number; half: number; top: number }, night: number, pxPerM: number) {
      tailMat.uniforms.uTime.value = time;
      const vis = Math.max(night, 0.16);
      if (time > next && live.length < MAX) {
        const big = r() < 0.02;
        spawn(view.az, view.half, view.top, big);
        const gap = night > 0.6 ? 8 + r() * 18 : night > 0.2 ? 14 + r() * 24 : 24 + r() * 36;
        next = time + gap / Math.max(quality, 0.6);
      }

      while (pending > 0 && live.length < MAX) {
        spawn(view.az, view.half, view.top, pending > 2 && r() < 0.3);
        pending--;
      }
      pending = 0;

      tailPos.fill(0);
      tailCol.fill(0);
      spriteCol.fill(0);
      const worldPerPx = R / pxPerM;

      for (let m = live.length - 1; m >= 0; m--) {
        const s = live[m];
        s.t += dt / s.dur;
        if (s.t >= 1.15) live.splice(m, 1);
      }
      live.forEach((s, m) => {
        const t = Math.min(s.t, 1);
        // fade in fast, burn, then flare and die
        const life = Math.min(1, t * 6) * (t < 1 ? 1 : Math.max(0, 1 - (s.t - 1) / 0.15)) * (0.8 + 0.4 * Math.sin(t * Math.PI));
        const headT = t;
        const tailT = Math.max(0, headT - s.len * Math.min(1, t * 2.5));
        head.copy(s.a).lerp(s.b, headT).normalize();
        tan.copy(s.b).sub(s.a).normalize();
        for (let i = 0; i <= SEG; i++) {
          const u = i / SEG; // 0 head … 1 tail
          tmp.copy(s.a).lerp(s.b, headT + (tailT - headT) * u).normalize();
          side.crossVectors(tmp, tan).normalize();
          const p = pt.copy(tmp).multiplyScalar(R).add(cam);
          const w = s.width * (1 - u * 0.85) * worldPerPx;
          const o = (m * (SEG + 1) + i) * 2;
          tailPos.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w], o * 3);
          tailPos.set([p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], o * 3 + 3);
          // white at the head, then teal, then violet
          if (u < 0.3) c.copy(white).lerp(teal, u / 0.3);
          else c.copy(teal).lerp(violet, (u - 0.3) / 0.7);
          const a = Math.pow(1 - u, 1.1) * life * s.bright * vis * 1.3;
          tailCol.set([c.r, c.g, c.b, a], o * 4);
          tailCol.set([c.r, c.g, c.b, a], o * 4 + 4);
          tailUv.set([u * s.len * 20, 0], o * 2);
          tailUv.set([u * s.len * 20, 1], o * 2 + 2);
        }
        // head sprite
        const hp = head.clone().multiplyScalar(R).add(cam);
        spritePos.set([hp.x, hp.y, hp.z], m * 3);
        spriteCol.set([1, 0.98, 0.94, life * s.bright * vis * .7], m * 4);
        spriteSize[m] = (3 + s.width * 1.8) * (0.95 + 0.05 * Math.sin(time * 18 + m));
        // shed glitter
        const shed = Math.round(Math.min(1, dt * 60) * (t < 1 ? 1 : 0));
        for (let k = 0; k < shed; k++) {
          const g = glitter[gi];
          gi = (gi + 1) % GLITTER;
          g.p.copy(hp).addScaledVector(side, (r() - 0.5) * 10 * worldPerPx);
          g.v.copy(tan).multiplyScalar(-R * 0.01 * r()).add(new THREE.Vector3(0, -R * 0.004 * (0.5 + r()), 0));
          g.age = 0;
          g.life = 0.6 + r() * 1.4;
          g.size = 1 + r() * 2;
          g.col.copy(palette[Math.floor(r() * palette.length)]);
          g.phase = r() * 10;
        }
      });
      for (let m = live.length; m < MAX; m++) spriteSize[m] = 0;

      for (let k = 0; k < GLITTER; k++) {
        const g = glitter[k];
        const i = MAX + k;
        if (g.age >= g.life) {
          spriteSize[i] = 0;
          continue;
        }
        g.age += dt;
        g.p.addScaledVector(g.v, dt);
        const f = 1 - g.age / g.life;
        const tw = 0.4 + 0.6 * Math.max(0, Math.sin(time * 26 + g.phase * 7)) ** 2;
        spritePos.set([g.p.x, g.p.y, g.p.z], i * 3);
        spriteCol.set([g.col.r, g.col.g, g.col.b, Math.max(0, f) * tw * vis * .25], i * 4);
        spriteSize[i] = g.size * (0.6 + 0.4 * f);
      }

      tailGeo.attributes.position.needsUpdate = true;
      tailGeo.attributes.aColor.needsUpdate = true;
      tailGeo.attributes.aUv.needsUpdate = true;
      spriteGeo.attributes.position.needsUpdate = true;
      spriteGeo.attributes.aColor.needsUpdate = true;
      spriteGeo.attributes.aSize.needsUpdate = true;
    },
  };
}
