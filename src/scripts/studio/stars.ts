import * as THREE from 'three';

/**
 * A generated night sky over a dark plateau: stars that turn about the celestial pole
 * (so long exposures draw trails), the Milky Way with its dark rift, airglow, a town's
 * light on the horizon, and meteors (a Perseid-like shower) that only a lucky frame catches.
 *
 * The sky turns at the real rate, one turn per sidereal day, so a 30-second frame barely
 * trails at 14mm and a 30-minute stack draws arcs.
 */

const SIDEREAL = 86164;
const LATITUDE = THREE.MathUtils.degToRad(35);
/** North is -z (the way the camera faces by default in the other places). */
export const POLE = new THREE.Vector3(0, Math.sin(LATITUDE), -Math.cos(LATITUDE)).normalize();
const MAX_METEORS = 6;

const dirFrom = (azDeg: number, altDeg: number) => {
  // azimuth measured from north (-z) towards east (+x)
  const az = THREE.MathUtils.degToRad(azDeg);
  const alt = THREE.MathUtils.degToRad(altDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
};

// the galactic centre low in the south, the band climbing through the zenith to the north-east
const GAL_CENTER = dirFrom(195, 22);
const GAL_NORMAL = new THREE.Vector3().crossVectors(GAL_CENTER, dirFrom(40, 75)).normalize();
const RADIANT = dirFrom(40, 45);
const TOWN = dirFrom(250, 0);

const VERT = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec3 pole, galN, galC, town;
uniform float rot0, rot1, steps, pxAngle, invTime;
uniform vec3 mA[${MAX_METEORS}];
uniform vec3 mB[${MAX_METEORS}];
uniform float mF[${MAX_METEORS}];
varying vec3 vWorld;

vec3 hash33(vec3 p){
  p = fract(p * vec3(.1031, .1030, .0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float hash13(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 1.7; a *= .5; } return s; }
vec3 turn(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1. - c); }

// The one star in the cube-map cell that holds direction d, drawn as a pixel-sized gaussian.
vec3 star(vec3 d, float G, float faint, float dens, float salt){
  vec3 a = abs(d);
  vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0. ? 0. : 1.; }
  else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0. ? 2. : 3.; }
  else { uv = d.xy / a.z; face = d.z > 0. ? 4. : 5.; }
  vec2 cell = floor((uv * .5 + .5) * G);
  vec3 h = hash33(vec3(cell, face * 7.1 + salt));
  float h2 = hash13(vec3(cell.yx, face + salt * 3.3));
  if (h2 > dens) return vec3(0.);
  vec2 sp = (cell + .25 + .5 * h.xy) / G * 2. - 1.;
  vec3 sd = face < 1.5 ? vec3(face < .5 ? 1. : -1., sp) : face < 3.5 ? vec3(sp.x, face < 2.5 ? 1. : -1., sp.y) : vec3(sp, face < 4.5 ? 1. : -1.);
  sd = normalize(sd);
  vec3 q = d - sd;
  float r2 = dot(q, q);
  float sig = pxAngle * .62;
  // brightness follows a power law: many faint stars, a few bright ones
  float flux = faint * pow(max(h.z, 2e-4), -.8);
  vec3 tint = mix(vec3(.72, .84, 1.18), vec3(1.18, .92, .68), h.x * h.x);
  return tint * flux * exp(-r2 / (2. * sig * sig)) * .44;
}

float milky(vec3 d){
  float b = dot(d, galN);
  vec3 inPlane = normalize(d - galN * b);
  float l = acos(clamp(dot(inPlane, galC), -1., 1.));
  float core = exp(-l * l / .35);
  float w = .065 + .11 * core;
  float band = exp(-b * b / (w * w));
  float n = fbm(d * 5.);
  float rift = smoothstep(.42, .66, fbm(d * 11. + 3.)) * exp(-b * b / (.035 * .035 + .05 * core * .05));
  return band * (.3 + .9 * core) * (.45 + 1.1 * n * n) * (1. - .8 * rift);
}

void main(){
  vec3 d = normalize(vWorld - cameraPosition);
  float alt = d.y;
  vec3 col = vec3(.006, .009, .02);
  // airglow near the horizon and the glow of a town to the west-south-west
  vec3 hz = normalize(vec3(d.x, 0., d.z));
  col += vec3(.016, .018, .02) * exp(-max(alt, 0.) / .18);
  col += vec3(.09, .05, .022) * exp(-max(alt, 0.) / .07) * pow(max(dot(hz, town), 0.), 6.);
  float rm = .5 * (rot0 + rot1);
  vec3 dm = turn(d, pole, -rm);
  float mw = milky(dm);
  col += mw * mix(vec3(.026, .032, .048), vec3(.075, .06, .045), exp(-pow(acos(clamp(dot(dm, galC), -1., 1.)), 2.) / .25));
  // stars, averaged over the positions they pass while the shutter is open
  vec3 s = vec3(0.);
  for (int k = 0; k < 24; k++) {
    if (float(k) >= steps) break;
    float r = mix(rot0, rot1, (float(k) + .5) / steps);
    vec3 dc = turn(d, pole, -r);
    float b = dot(dc, galN);
    s += star(dc, 70., .1, .6, 1.) + star(dc, 220., .022, .35 + .6 * exp(-b * b / .03), 9.);
  }
  col += s / steps;
  // meteors burn for a moment, so they do not get dimmer with a longer exposure
  for (int i = 0; i < ${MAX_METEORS}; i++) {
    if (mF[i] <= 0.) continue;
    vec3 n = normalize(cross(mA[i], mB[i]));
    float off = dot(d, n);
    vec3 p = normalize(d - n * off);
    float len = acos(clamp(dot(mA[i], mB[i]), -1., 1.));
    float ta = acos(clamp(dot(mA[i], p), -1., 1.));
    float tb = acos(clamp(dot(p, mB[i]), -1., 1.));
    if (ta + tb > len * 1.001) continue;
    float t = ta / len;
    float w = pxAngle * .9;
    float prof = smoothstep(0., .25, t) * smoothstep(1., .8, t) * (.35 + .65 * t);
    col += mF[i] * invTime * prof * exp(-off * off / (2. * w * w)) * vec3(.8, 1., .85);
  }
  if (alt < 0.) col *= .25;
  gl_FragColor = vec4(col * 2., 1.);
}`;

export interface Meteor {
  a: THREE.Vector3;
  b: THREE.Vector3;
  flux: number;
  time: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Meteors that happen between t0 and t1 (seconds of sky time): about one every two minutes. */
export function meteorsBetween(t0: number, t1: number): Meteor[] {
  const out: Meteor[] = [];
  const slot = 20;
  for (let k = Math.floor(t0 / slot); k <= Math.floor(t1 / slot); k++) {
    if (hash(k) > 0.17) continue;
    const time = k * slot + hash(k + 0.31) * slot;
    if (time < t0 || time > t1) continue;
    const start = dirFrom(hash(k + 0.7) * 360, 22 + hash(k + 0.9) * 50);
    // a meteor runs away from the radiant along a great circle
    const axis = new THREE.Vector3().crossVectors(RADIANT, start).normalize();
    const len = THREE.MathUtils.degToRad(7 + hash(k + 1.3) * 18);
    const end = start.clone().applyAxisAngle(axis, len);
    out.push({ a: start, b: end, flux: 0.0035 * (0.4 + 1.6 * hash(k + 2.1) ** 2), time });
    if (out.length >= MAX_METEORS) break;
  }
  return out;
}

export class StarSky {
  readonly group = new THREE.Group();
  /** Meteors in the last exposure. */
  meteors: Meteor[] = [];
  /** Sky time (s) at which the live view starts; shots move it on so every frame sees a new sky. */
  epoch = 0;
  private uniforms: Record<string, THREE.IUniform>;

  constructor() {
    this.uniforms = {
      pole: { value: POLE },
      galN: { value: GAL_NORMAL },
      galC: { value: GAL_CENTER },
      town: { value: TOWN },
      rot0: { value: 0 },
      rot1: { value: 0 },
      steps: { value: 1 },
      pxAngle: { value: 0.002 },
      invTime: { value: 1 },
      mA: { value: Array.from({ length: MAX_METEORS }, () => new THREE.Vector3(0, 1, 0)) },
      mB: { value: Array.from({ length: MAX_METEORS }, () => new THREE.Vector3(0, 1, 0)) },
      mF: { value: new Array(MAX_METEORS).fill(0) },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(150, 64, 32),
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: true }),
    );
    dome.frustumCulled = false;
    this.group.add(dome, ground(), ridge());
    const hemi = new THREE.HemisphereLight('#4a5a86', '#0b0c0a', 0.64);
    this.group.add(hemi);
  }

  /** Set up the sky for an exposure from `open` to `close` (scene seconds). */
  prepare(open: number, close: number, pxAngle: number) {
    const t0 = this.epoch + open;
    const t1 = this.epoch + Math.max(close, open + 1e-3);
    const u = this.uniforms;
    u.rot0.value = (t0 / SIDEREAL) * Math.PI * 2;
    u.rot1.value = (t1 / SIDEREAL) * Math.PI * 2;
    // enough samples that a trail is a line, not a row of dots
    const trail = (u.rot1.value - u.rot0.value) / Math.max(pxAngle, 1e-5);
    u.steps.value = Math.max(1, Math.min(24, Math.ceil(trail * 1.2)));
    u.pxAngle.value = pxAngle;
    u.invTime.value = 1 / (t1 - t0);
    this.meteors = meteorsBetween(t0, t1);
    for (let i = 0; i < MAX_METEORS; i++) {
      const m = this.meteors[i];
      u.mF.value[i] = m ? m.flux : 0;
      if (m) {
        u.mA.value[i].copy(m.a);
        u.mB.value[i].copy(m.b);
      }
    }
  }
}

/** Dark grass to the horizon. */
function ground() {
  const g = new THREE.Mesh(new THREE.CircleGeometry(140, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3b4434', roughness: 1 }));
  g.receiveShadow = true;
  g.userData.occludes = true;
  return g;
}

/** A ring of low mountains, a few degrees high, black against the sky. */
function ridge() {
  const seg = 256;
  const R = 120;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const h = 3 + 5 * (0.5 + 0.5 * Math.sin(a * 3 + 1)) * (0.6 + 0.4 * Math.sin(a * 7.3 + 2)) + 1.6 * Math.sin(a * 23 + 0.5) ** 2;
    const x = Math.sin(a) * R;
    const z = -Math.cos(a) * R;
    pos.push(x, -1, z, x, h, z);
    if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#030405', side: THREE.DoubleSide }));
}
