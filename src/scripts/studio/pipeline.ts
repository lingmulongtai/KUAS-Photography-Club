import * as THREE from 'three';
import { SENSOR_H, cameraEV, vfov, type Shot } from './optics';

/**
 * A small "camera" renderer: the scene is rendered in linear HDR, averaged over the
 * shutter time (motion blur and camera shake), blurred by depth (depth of field with
 * aperture-blade shaped bokeh), exposed by the settings, passed through the lens and any
 * filter (fringing, softness, flare, glow, star streaks), given sensor noise for the ISO,
 * and only then tone mapped. Every learning-lab page draws its pictures through it.
 */

export interface Exposable {
  scene: THREE.Scene;
  /** Scene brightness as EV100 (sunny day 15, night street 5). */
  ev: number;
  /** Brightness multiplier that makes a correct exposure look right. */
  gain: number;
  /** Put moving things where they are at `time` seconds. */
  step(time: number): void;
  /** True when something moves, so long shutter speeds need several subframes. */
  moving: boolean;
  /** A light bright enough to flare the lens (the sun), as a direction and its brightness over the sky. */
  flareSource?: { dir: THREE.Vector3; power: number } | null;
  /** Called once per picture with the shutter's open and close times and the size of a pixel (radians). */
  prepare?(camera: THREE.PerspectiveCamera, open: number, close: number, pxAngle: number): void;
  /** Called before each of the `n` subframes of a picture (a flash fires in only one of them). */
  subframe?(i: number, n: number): void;
}

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How a lens draws, beyond its focal length and aperture. All zero is a perfect lens. */
export interface LensCharacter {
  /** Lateral chromatic aberration: how much red and blue are scaled apart at the edge. */
  ca: number;
  /** Softness at the corners when wide open, in pixels of a 1080-line picture. */
  soft: number;
  /** Extra darkening of the corners when wide open (0..1). */
  vignette: number;
  /** Ghosts and veiling glare from a light in or near the frame (0..1). */
  flare: number;
  /** Widest f-number, to tell how far the lens is stopped down. */
  fmin: number;
}

/** What a filter in front of the lens does to the picture. */
export interface FilterEffect {
  /** Mix of a small blur (soft-focus filter). */
  glow: number;
  /** Mix of a wide blur (mist filters lower the contrast). */
  haze: number;
  /** Halation around bright parts. */
  bloom: number;
  /** Milky lift of the shadows. */
  lift: number;
  /** Cross-screen star filter strength and number of lines (2 lines = 4 points). */
  cross: number;
  crossLines: number;
  /** Saturation change (a polariser deepens colours). */
  sat: number;
}

const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const DEPTH = /* glsl */ `
uniform sampler2D tDepth;
uniform float near, far, focus, cocScale, maxCoc;
float viewZ(vec2 uv){ float d = texture2D(tDepth, uv).x * 2. - 1.; return 2. * near * far / (far + near - d * (far - near)); }
float coc(float z){ return clamp(cocScale * (z - focus) / z, -maxCoc, maxCoc); }
`;

const ACCUM_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform float w; varying vec2 vUv;
void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, w); }`;

// Single-pass scatter-as-gather bokeh after Dennis Gustafsson (2018), with polygonal blades.
const DOF_FRAG = /* glsl */ `
uniform sampler2D tColor; uniform vec2 res; uniform float radScale, blades, bladeRot, bladeAmt;
varying vec2 vUv;
${DEPTH}
float polyR(float a){
  if (blades < 3.) return 1.;
  float seg = 6.2831853 / blades;
  float x = mod(a - bladeRot, seg) - seg * .5;
  return cos(seg * .5) / cos(x);
}
void main(){
  vec2 px = 1. / res;
  float zc = viewZ(vUv);
  float sc = abs(coc(zc));
  vec3 col = texture2D(tColor, vUv).rgb;
  float tot = 1.;
  float spill = 0.;
  float radius = radScale;
  float ang = 0.;
  for (int i = 0; i < 220; i++) {
    if (radius >= maxCoc) break;
    ang += 2.39996323;
    float shape = mix(1., polyR(ang), bladeAmt);
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * px * radius * shape;
    vec3 sCol = texture2D(tColor, tc).rgb;
    float sz = viewZ(tc);
    float s = abs(coc(sz));
    if (sz > zc) s = clamp(s, 0., sc * 2.);
    float m = smoothstep(radius - .5, radius + .5, s);
    col += mix(col / tot, sCol, m);
    tot += 1.;
    if (sz < zc * .97) spill = max(spill, m * smoothstep(.6, 2., s));
    radius += radScale / radius;
  }
  gl_FragColor = vec4(col / tot, max(smoothstep(.25, 1.1, sc), spill));
}`;

// The exposed picture at quarter size, for glow, streaks and the light meter.
const COMPOSE_FRAG = /* glsl */ `
uniform sampler2D tSharp, tDof; uniform float exposure; varying vec2 vUv;
void main(){
  vec4 d = texture2D(tDof, vUv);
  gl_FragColor = vec4(mix(texture2D(tSharp, vUv).rgb, d.rgb, d.a) * exposure, 1.);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * .2270270;
  c += (texture2D(tSrc, vUv + dir * 1.3846154).rgb + texture2D(tSrc, vUv - dir * 1.3846154).rgb) * .3162162;
  c += (texture2D(tSrc, vUv + dir * 3.2307692).rgb + texture2D(tSrc, vUv - dir * 3.2307692).rgb) * .0702703;
  gl_FragColor = vec4(c, 1.);
}`;

// Thin lines of light from bright points: a cross-screen filter, or the diffraction
// "sunstar" of a stopped-down aperture (twice as many points as an odd number of blades).
const STREAK_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 px; uniform float lines, rot, thr, len, gain; varying vec2 vUv;
vec3 bright(vec2 uv){ return max(texture2D(tSrc, uv).rgb - thr, 0.); }
void main(){
  vec3 acc = vec3(0.);
  for (int d = 0; d < 9; d++) {
    if (float(d) >= lines) break;
    float a = rot + 3.14159265 * float(d) / lines;
    vec2 dir = vec2(cos(a), sin(a)) * px * len;
    for (int k = 1; k <= 12; k++) {
      float w = 1. - float(k) / 13.;
      w *= w;
      acc += w * (bright(vUv + dir * float(k)) + bright(vUv - dir * float(k)));
    }
  }
  gl_FragColor = vec4(acc * gain, 1.);
}`;

// Log luminance at a few hundred points, packed into 8 bits, for the light meter.
const METER_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 px; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + px * vec2(-.25, -.25)).rgb + texture2D(tSrc, vUv + px * vec2(.25, -.25)).rgb
         + texture2D(tSrc, vUv + px * vec2(-.25, .25)).rgb + texture2D(tSrc, vUv + px * vec2(.25, .25)).rgb;
  float l = dot(c * .25, vec3(.2126, .7152, .0722));
  float e = clamp((log2(max(l, 1e-5)) + 14.) / 20., 0., 1.);
  gl_FragColor = vec4(e, fract(e * 255.), 0., 1.);
}`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tSharp, tDof, tGlow, tHaze, tStreak; uniform vec2 res;
uniform float exposure, shotGain, readNoise, chroma, time, vignette, peaking, zebra, grain, fullCoc;
uniform float ca, soft, useGlow, glow, haze, bloom, lift, useStreak, sat;
uniform vec2 flareSrc; uniform float flareAmt, veil, blades, bladeRot;
uniform vec3 flareTint;
varying vec2 vUv;
${DEPTH}
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gauss(vec2 p){ return (hash(p) + hash(p + 17.13) + hash(p + 41.7) - 1.5) * 2.; }
float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
vec3 base(vec2 uv){ vec4 d = texture2D(tDof, uv); return mix(texture2D(tSharp, uv).rgb, d.rgb, d.a); }
vec3 softened(vec2 uv, vec2 off){
  vec3 c = base(uv);
  if (soft <= 0.) return c;
  return c * .4 + .15 * (base(uv + off) + base(uv - off) + base(uv + vec2(off.x, -off.y)) + base(uv - vec2(off.x, -off.y)));
}
vec3 lens(vec2 uv){
  if (ca <= 0. && soft <= 0.) return base(uv);
  vec2 q = uv - .5;
  float r2 = dot(q * vec2(res.x / res.y, 1.), q * vec2(res.x / res.y, 1.)) * 2.;
  vec2 off = soft * (.35 + r2) / res;
  return vec3(softened(.5 + q * (1. + ca), off).r, softened(uv, off).g, softened(.5 + q * (1. - ca), off).b);
}
float ghost(vec2 p, float r){
  float a = atan(p.y, p.x);
  float rr = r;
  if (blades >= 3.) {
    float seg = 6.2831853 / blades;
    float x = mod(a - bladeRot, seg) - seg * .5;
    rr = r * cos(seg * .5) / cos(x);
  }
  float l = length(p);
  return smoothstep(rr, rr * .82, l) * (.55 + .45 * smoothstep(rr * .5, rr, l));
}
vec3 flare(){
  const float K[6] = float[6](-.35, -.8, -1.25, .45, -.15, .75);
  const float R[6] = float[6](.05, .11, .07, .03, .02, .16);
  vec3 C[6] = vec3[6](vec3(.25, .55, .4), vec3(.4, .3, .55), vec3(.6, .45, .2), vec3(.3, .5, .7), vec3(.7, .5, .3), vec3(.15, .3, .25));
  vec2 asp = vec2(res.x / res.y, 1.);
  vec3 g = vec3(0.);
  for (int i = 0; i < 6; i++) {
    vec2 ctr = .5 + (flareSrc - .5) * K[i];
    g += C[i] * ghost((vUv - ctr) * asp, R[i]);
  }
  float d = length((vUv - flareSrc) * asp);
  g += flareTint * (exp(-d * 9.) * .9 + exp(-d * 2.5) * .25);
  return g;
}
void main(){
  vec3 c = lens(vUv) * exposure;
  vec2 q = vUv - .5;
  c *= 1. - vignette * dot(q, q) * 1.8;
  if (useGlow > .5) {
    vec3 g = texture2D(tGlow, vUv).rgb;
    vec3 h = texture2D(tHaze, vUv).rgb;
    c = mix(c, g, glow);
    c = mix(c, h, haze);
    c += bloom * (max(g - .75, 0.) + max(h - .6, 0.) * 1.5);
    c += lift * h;
  }
  if (useStreak > .5) c += texture2D(tStreak, vUv).rgb;
  if (flareAmt > 0.) {
    // a subject in front of the sun hides it (the sky is the only thing that far away)
    float seen = 1.;
    if (all(greaterThan(flareSrc, vec2(0.))) && all(lessThan(flareSrc, vec2(1.)))) {
      vec2 o = 6. / res;
      seen = (step(40., viewZ(flareSrc)) + step(40., viewZ(flareSrc + o)) + step(40., viewZ(flareSrc - o))
        + step(40., viewZ(flareSrc + vec2(o.x, -o.y))) + step(40., viewZ(flareSrc - vec2(o.x, -o.y)))) * .2;
      seen = .06 + .94 * seen;
    }
    c += seen * (flareAmt * flare() + veil * flareTint);
  }
  if (sat != 0.) c = max(mix(vec3(luma(c)), c, 1. + sat), 0.);
  vec2 cell = floor(gl_FragCoord.xy / grain) + floor(fract(time * 7.31) * 64.) * vec2(13.7, 71.3);
  float sigma = sqrt(max(luma(c), 0.) * shotGain) + readNoise;
  vec3 nz = vec3(gauss(cell)) + chroma * vec3(gauss(cell + 3.1), gauss(cell + 5.7), gauss(cell + 9.2));
  c = max(c + nz * sigma, 0.);
  vec3 o = aces(c);
  if (zebra > .5 && max(o.r, max(o.g, o.b)) > .975) {
    float s = step(.5, fract((gl_FragCoord.x + gl_FragCoord.y) / (10. * grain) - time * 1.5));
    o = mix(o, vec3(s), .8);
  }
  if (peaking > .5) {
    float z = viewZ(vUv);
    float cc = abs(cocScale * (z - focus) / z) * fullCoc;
    vec2 px = 1. / res;
    vec3 sharp = texture2D(tSharp, vUv).rgb;
    float gx = luma(texture2D(tSharp, vUv + vec2(px.x, 0.)).rgb) - luma(texture2D(tSharp, vUv - vec2(px.x, 0.)).rgb);
    float gy = luma(texture2D(tSharp, vUv + vec2(0., px.y)).rgb) - luma(texture2D(tSharp, vUv - vec2(0., px.y)).rgb);
    float edge = smoothstep(.05, .14, length(vec2(gx, gy)) / (luma(sharp) + .08));
    o = mix(o, vec3(1., .16, .3), edge * (1. - smoothstep(.5, 1.4, cc)) * .95);
  }
  gl_FragColor = vec4(srgb(o) + (hash(gl_FragCoord.xy) - .5) / 255., 1.);
}`;

function target(w: number, h: number, depth: boolean, samples = 0) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples,
    depthBuffer: depth,
  });
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.depthTexture.type = THREE.UnsignedIntType;
  }
  return rt;
}

/** Camera shake in radians about one axis: a slow sway and a fine tremor (about 1.5°/s, the 1/focal-length rule). */
function shakeAt(time: number, axis: number) {
  const sway = 0.0005 * (Math.sin(time * 1.7 + axis * 2.1) + 0.5 * Math.sin(time * 2.9 + axis));
  const tremor = 0.00045 * (Math.sin(time * 52 + axis * 1.3) + 0.6 * Math.sin(time * 73 + axis * 0.4));
  return sway + tremor;
}

export interface PipelineOptions {
  /** Most scene renders per frame for long exposures. */
  maxSubframes?: number;
  /** Largest bokeh radius in DOF-buffer pixels. */
  maxCoc?: number;
  vignette?: number;
}

export interface MeterReading {
  /** Average brightness against a correct exposure, in stops (center-weighted). */
  stops: number;
  /** Share of the picture that is blown out / blocked up. */
  clipped: number;
  crushed: number;
}

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  private rtScene: THREE.WebGLRenderTarget;
  private rtAccum: THREE.WebGLRenderTarget;
  private rtDof: THREE.WebGLRenderTarget;
  private rtQ: THREE.WebGLRenderTarget;
  private rtQ2: THREE.WebGLRenderTarget;
  private rtGlow: THREE.WebGLRenderTarget;
  private rtE: THREE.WebGLRenderTarget;
  private rtE2: THREE.WebGLRenderTarget;
  private rtStreak: THREE.WebGLRenderTarget;
  private rtSmall: THREE.WebGLRenderTarget | null = null;
  private rtMeter: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh;
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private accum: THREE.ShaderMaterial;
  private dof: THREE.ShaderMaterial;
  private compose: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private streak: THREE.ShaderMaterial;
  private meterMat: THREE.ShaderMaterial;
  private final: THREE.ShaderMaterial;
  private w = 2;
  private h = 2;
  private opts: Required<PipelineOptions>;
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  /** Linear multiplier applied in the last frame; 1 means a correct exposure. */
  lastStops = 0;
  /** Where the flare source was in the last picture (0..1, y up), or null. */
  lastFlare: { x: number; y: number; amount: number } | null = null;

  constructor(renderer: THREE.WebGLRenderer, options: PipelineOptions = {}) {
    this.renderer = renderer;
    const low = isLowPower();
    this.opts = {
      maxSubframes: options.maxSubframes ?? (low ? 5 : 10),
      maxCoc: options.maxCoc ?? (low ? 14 : 22),
      vignette: options.vignette ?? 0.35,
    };
    this.rtScene = target(2, 2, true, low ? 0 : 4);
    this.rtAccum = target(2, 2, false);
    this.rtDof = target(2, 2, false);
    this.rtQ = target(2, 2, false);
    this.rtQ2 = target(2, 2, false);
    this.rtGlow = target(2, 2, false);
    this.rtE = target(2, 2, false);
    this.rtE2 = target(2, 2, false);
    this.rtStreak = target(2, 2, false);
    const depthUniforms = () => ({
      tDepth: { value: this.rtScene.depthTexture },
      near: { value: 0.1 },
      far: { value: 100 },
      focus: { value: 1 },
      cocScale: { value: 0 },
      maxCoc: { value: 1 },
    });
    const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.accum = pass(ACCUM_FRAG, { tSrc: { value: null }, w: { value: 1 } }, { transparent: true });
    this.dof = pass(DOF_FRAG, {
      ...depthUniforms(),
      tColor: { value: null },
      res: { value: new THREE.Vector2() },
      radScale: { value: 0.6 },
      blades: { value: 0 },
      bladeRot: { value: 0.3 },
      bladeAmt: { value: 0 },
    });
    this.compose = pass(COMPOSE_FRAG, { tSharp: { value: null }, tDof: { value: this.rtDof.texture }, exposure: { value: 1 } });
    this.blur = pass(BLUR_FRAG, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.streak = pass(STREAK_FRAG, {
      tSrc: { value: this.rtQ.texture },
      px: { value: new THREE.Vector2() },
      lines: { value: 2 },
      rot: { value: 0.4 },
      thr: { value: 1 },
      len: { value: 1.5 },
      gain: { value: 0.1 },
    });
    this.meterMat = pass(METER_FRAG, { tSrc: { value: this.rtQ.texture }, px: { value: new THREE.Vector2() } });
    this.final = pass(FINAL_FRAG, {
      ...depthUniforms(),
      tSharp: { value: null },
      tDof: { value: this.rtDof.texture },
      tGlow: { value: this.rtGlow.texture },
      tHaze: { value: this.rtE2.texture },
      tStreak: { value: this.rtStreak.texture },
      res: { value: new THREE.Vector2() },
      exposure: { value: 1 },
      shotGain: { value: 0 },
      readNoise: { value: 0 },
      chroma: { value: 0.3 },
      time: { value: 0 },
      vignette: { value: this.opts.vignette },
      peaking: { value: 0 },
      zebra: { value: 0 },
      grain: { value: 1 },
      fullCoc: { value: 2 },
      ca: { value: 0 },
      soft: { value: 0 },
      useGlow: { value: 0 },
      glow: { value: 0 },
      haze: { value: 0 },
      bloom: { value: 0 },
      lift: { value: 0 },
      useStreak: { value: 0 },
      sat: { value: 0 },
      flareSrc: { value: new THREE.Vector2(0.5, 0.5) },
      flareAmt: { value: 0 },
      flareTint: { value: new THREE.Color(1, 0.92, 0.8) },
      veil: { value: 0 },
      blades: { value: 9 },
      bladeRot: { value: 0.3 },
    });
    this.quad = new THREE.Mesh(tri, this.accum);
    this.quad.frustumCulled = false;
  }

  /** Size in device pixels. */
  setSize(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.rtScene.setSize(w, h);
    this.rtAccum.setSize(w, h);
    this.rtDof.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    const qw = Math.ceil(w / 4);
    const qh = Math.ceil(h / 4);
    for (const rt of [this.rtQ, this.rtQ2, this.rtGlow, this.rtStreak]) rt.setSize(qw, qh);
    for (const rt of [this.rtE, this.rtE2]) rt.setSize(Math.ceil(w / 12), Math.ceil(h / 12));
  }

  get size() {
    return { w: this.w, h: this.h };
  }

  private pass(material: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(to);
    this.renderer.render(this.quad, this.ortho);
  }

  private blurInto(src: THREE.WebGLRenderTarget, tmp: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, spread: number) {
    const u = this.blur.uniforms;
    u.tSrc.value = src.texture;
    u.dir.value.set(spread / src.width, 0);
    this.pass(this.blur, tmp);
    u.tSrc.value = tmp.texture;
    u.dir.value.set(0, spread / tmp.height);
    this.pass(this.blur, dst);
  }

  /**
   * Take a picture of `world` through `camera` with `shot`, at `now` seconds.
   * `viewport` is in CSS pixels on the canvas; without it the picture fills the canvas.
   */
  render(world: Exposable, camera: THREE.PerspectiveCamera, shot: Shot, now: number, viewport?: Viewport, to: THREE.WebGLRenderTarget | null = null, clip?: Viewport) {
    const r = this.renderer;
    const crop = shot.crop ?? 1;
    const f = shot.mm / 1000;
    const focus = Math.max(shot.focus, f * 1.5);
    // focusing close moves the lens away from the sensor, which narrows the view ("breathing")
    const imageDist = shot.breathing ? (focus * f) / (focus - f) : f;
    camera.fov = (vfov(imageDist * 1000, crop) * 180) / Math.PI;
    camera.updateProjectionMatrix();
    world.prepare?.(camera, now - shot.t, now, THREE.MathUtils.degToRad(camera.fov) / this.h);

    // 1. Average the scene over the time the shutter is open.
    const shake = shot.shake ?? 0;
    const moving = world.moving || shake > 0;
    const n = moving ? Math.max(1, Math.min(this.opts.maxSubframes, Math.ceil(shot.t * 240))) : 1;
    this.q.copy(camera.quaternion);
    const prevAutoClear = r.autoClear;
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    for (let i = 0; i < n; i++) {
      const time = n === 1 ? now : now - shot.t + (shot.t * i) / (n - 1);
      world.step(time);
      world.subframe?.(i, n);
      if (shake) {
        camera.quaternion.copy(this.q);
        camera.rotateX(shake * shakeAt(time, 0));
        camera.rotateY(shake * shakeAt(time, 1));
      }
      r.shadowMap.needsUpdate = i === 0;
      r.autoClear = true;
      r.setRenderTarget(this.rtScene);
      r.render(world.scene, camera);
      if (n > 1) {
        this.accum.uniforms.tSrc.value = this.rtScene.texture;
        this.accum.uniforms.w.value = 1 / (i + 1);
        r.autoClear = i === 0;
        this.pass(this.accum, this.rtAccum);
      }
    }
    camera.quaternion.copy(this.q);
    r.autoClear = prevAutoClear;
    r.shadowMap.autoUpdate = prevShadow;
    const color = n > 1 ? this.rtAccum.texture : this.rtScene.texture;

    // 2. Depth of field, at half resolution.
    const cocDiameter = (f * f) / (shot.N * (focus - f)) / (SENSOR_H / crop);
    const halfH = this.rtDof.height;
    const cocScale = 0.5 * cocDiameter * halfH;
    const maxCoc = Math.min(this.opts.maxCoc * (halfH / 540) ** 0.5, cocScale * 1.6 + 1);
    for (const m of [this.dof, this.final]) {
      m.uniforms.near.value = camera.near;
      m.uniforms.far.value = camera.far;
      m.uniforms.focus.value = focus;
      m.uniforms.cocScale.value = cocScale;
      m.uniforms.maxCoc.value = Math.max(1, maxCoc);
      m.uniforms.tDepth.value = this.rtScene.depthTexture;
    }
    const du = this.dof.uniforms;
    du.tColor.value = color;
    du.res.value.set(this.rtDof.width, this.rtDof.height);
    du.radScale.value = Math.max(0.55, (maxCoc * maxCoc) / (2 * 150));
    const blades = shot.blades ?? 9;
    du.blades.value = blades;
    // a wide open lens is round; stopping down shows the blades
    du.bladeAmt.value = blades ? Math.min(1, Math.max(0, (Math.log2(shot.N) - 1) / 2.2)) : 0;
    this.pass(this.dof, this.rtDof);

    // 3. Exposure. Close focusing also dims the picture (the effective f-number grows).
    const mag = shot.breathing ? f / (focus - f) : 0;
    const stops = world.ev - cameraEV(shot.N, shot.t, shot.iso) + (shot.bias ?? 0) - 2 * Math.log2(1 + mag);
    this.lastStops = stops;
    const exposure = world.gain * 2 ** stops;
    const lens = shot.lens;
    const filter = shot.filter;
    // how far the lens is stopped down: 0 wide open, 1 at three stops down
    const closed = lens ? Math.min(1, Math.max(0, Math.log2(shot.N / lens.fmin) / 1.5)) : 1;

    // 4. The exposed picture at quarter size: glow, streaks and the light meter start here.
    this.compose.uniforms.tSharp.value = color;
    this.compose.uniforms.exposure.value = exposure;
    this.pass(this.compose, this.rtQ);
    const useGlow = !!filter && filter.glow + filter.haze + filter.bloom + filter.lift > 0;
    if (useGlow) {
      this.blurInto(this.rtQ, this.rtQ2, this.rtGlow, 1.2);
      this.blurInto(this.rtGlow, this.rtE, this.rtE2, 1);
      this.blurInto(this.rtE2, this.rtE, this.rtE2, 1.6);
    }
    // a stopped-down aperture draws points of light as stars; a cross filter does it at any aperture
    const sunstar = blades >= 5 ? Math.min(1, Math.max(0, (shot.N - 5) / 11)) : 0;
    const cross = filter?.cross ?? 0;
    const useStreak = cross > 0 || sunstar > 0;
    if (useStreak) {
      const su = this.streak.uniforms;
      su.px.value.set(1 / this.rtQ.width, 1 / this.rtQ.height).multiplyScalar(this.rtQ.height / 135);
      if (cross > 0) {
        su.lines.value = filter!.crossLines;
        su.rot.value = 0.35;
        su.thr.value = 1.1;
        su.len.value = 2.6;
        su.gain.value = 0.05 * cross;
      } else {
        su.lines.value = blades % 2 ? blades : blades / 2;
        su.rot.value = 0.3 + Math.PI / 2;
        su.thr.value = 2.5;
        su.len.value = 0.9 + sunstar * 0.8;
        su.gain.value = 0.035 * sunstar;
      }
      this.pass(this.streak, this.rtStreak);
    }

    // 5. Lens, filter, noise, tone mapping.
    const fu = this.final.uniforms;
    fu.tSharp.value = color;
    fu.res.value.set(this.w, this.h);
    fu.exposure.value = exposure;
    const isoK = shot.iso / 100;
    fu.shotGain.value = 0.00005 * isoK;
    fu.readNoise.value = 0.00008 * isoK;
    fu.chroma.value = Math.min(0.6, 0.12 * Math.log2(isoK + 1));
    fu.time.value = now;
    fu.peaking.value = shot.peaking ? 1 : 0;
    fu.zebra.value = shot.zebra ? 1 : 0;
    fu.grain.value = Math.max(1, this.renderer.getPixelRatio() * 0.9);
    fu.fullCoc.value = this.h / Math.max(1, halfH);
    fu.vignette.value = this.opts.vignette + (lens ? lens.vignette * (1 - closed) : 0);
    // softness: the lens's own at the corners (gone by three stops down), then diffraction past F11
    const diffraction = Math.max(0, shot.N - 11) / 11;
    fu.soft.value = ((lens ? lens.soft * (1 - closed * 0.85) : 0) + diffraction * 1.4) * (this.h / 1080);
    fu.ca.value = lens ? lens.ca : 0;
    fu.useGlow.value = useGlow ? 1 : 0;
    fu.glow.value = filter?.glow ?? 0;
    fu.haze.value = filter?.haze ?? 0;
    fu.bloom.value = filter?.bloom ?? 0;
    fu.lift.value = filter?.lift ?? 0;
    fu.sat.value = filter?.sat ?? 0;
    fu.useStreak.value = useStreak ? 1 : 0;
    fu.blades.value = blades;
    this.flare(world, camera, exposure, lens);
    r.setRenderTarget(to);
    if ((viewport || clip) && !to) {
      const s = r.getSize(new THREE.Vector2());
      const v = viewport ?? { x: 0, y: 0, w: s.x, h: s.y };
      const c = clip ?? v;
      r.setViewport(v.x, v.y, v.w, v.h);
      r.setScissor(c.x, c.y, c.w, c.h);
      r.setScissorTest(true);
    }
    this.quad.material = this.final;
    r.render(this.quad, this.ortho);
    if ((viewport || clip) && !to) {
      const s = r.getSize(new THREE.Vector2());
      r.setViewport(0, 0, s.x, s.y);
      r.setScissorTest(false);
    }
  }

  /** Ghosts and veiling glare from the world's flare source, if it is in or near the frame. */
  private flare(world: Exposable, camera: THREE.PerspectiveCamera, exposure: number, lens?: LensCharacter) {
    const fu = this.final.uniforms;
    fu.flareAmt.value = 0;
    fu.veil.value = 0;
    this.lastFlare = null;
    const src = world.flareSource;
    if (!src || !lens || lens.flare <= 0) return;
    const p = this.v.copy(src.dir).multiplyScalar(100).add(camera.position).project(camera);
    if (p.z > 1) return;
    const x = p.x * 0.5 + 0.5;
    const y = p.y * 0.5 + 0.5;
    const outside = Math.max(0, Math.abs(x - 0.5) - 0.5, Math.abs(y - 0.5) - 0.5);
    const near = 1 - THREE.MathUtils.smoothstep(outside, 0, 0.35);
    if (near <= 0) return;
    const strength = THREE.MathUtils.smoothstep(Math.log2(Math.max(1e-6, src.power * exposure)), 7, 13);
    const amount = lens.flare * strength * near;
    if (amount <= 0.01) return;
    fu.flareSrc.value.set(x, y);
    fu.flareAmt.value = amount * 0.9;
    fu.veil.value = amount * 0.014;
    fu.bladeRot.value = 0.3;
    this.lastFlare = { x, y, amount };
  }

  /** Luminance histogram (0..1 per bin) of the last picture. */
  histogram(bins = 64) {
    if (!this.rtSmall) this.rtSmall = new THREE.WebGLRenderTarget(96, 64);
    this.quad.material = this.final;
    this.renderer.setRenderTarget(this.rtSmall);
    this.renderer.render(this.quad, this.ortho);
    this.renderer.setRenderTarget(null);
    const px = new Uint8Array(96 * 64 * 4);
    this.renderer.readRenderTargetPixels(this.rtSmall, 0, 0, 96, 64, px);
    const out = new Float32Array(bins);
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      out[Math.min(bins - 1, Math.floor((l / 256) * bins))]++;
    }
    const max = Math.max(...out.slice(1, bins - 1), 1);
    return out.map((v) => Math.min(1, v / max));
  }

  /**
   * Read the last picture like a camera's meter: the center-weighted average brightness
   * against middle grey, and how much of it is blown out or blocked up.
   */
  meter(focus?: { u: number; v: number }): MeterReading {
    const W = 48;
    const H = 32;
    if (!this.rtMeter) this.rtMeter = new THREE.WebGLRenderTarget(W, H);
    this.meterMat.uniforms.px.value.set(1 / this.rtQ.width, 1 / this.rtQ.height);
    this.pass(this.meterMat, this.rtMeter);
    this.renderer.setRenderTarget(null);
    const px = new Uint8Array(W * H * 4);
    this.renderer.readRenderTargetPixels(this.rtMeter, 0, 0, W, H, px);
    let sum = 0;
    let wsum = 0;
    let clipped = 0;
    let crushed = 0;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = (j * W + i) * 4;
        const e = (px[k] + px[k + 1] / 255) / 255;
        const l = e * 20 - 14;
        // center-weighted, and weighted again round the focus point (as evaluative metering does)
        const dx = (i + 0.5) / W - 0.5;
        const dy = (j + 0.5) / H - 0.5;
        let w = 1 + 1.5 * Math.exp(-(dx * dx + dy * dy) / 0.04);
        if (focus) {
          const fx = (i + 0.5) / W - focus.u;
          const fy = (j + 0.5) / H - (1 - focus.v);
          w += 4 * Math.exp(-(fx * fx + fy * fy) / 0.012);
        }
        // a few very bright pixels (the sun) should not swing the meter
        sum += Math.min(l, 2.5) * w;
        wsum += w;
        if (l > 1.6) clipped++;
        if (l < -7.5) crushed++;
      }
    }
    return { stops: sum / wsum - Math.log2(0.18) + METER_BIAS, clipped: clipped / (W * H), crushed: crushed / (W * H) };
  }

  dispose() {
    for (const rt of [this.rtScene, this.rtAccum, this.rtDof, this.rtQ, this.rtQ2, this.rtGlow, this.rtE, this.rtE2, this.rtStreak]) rt.dispose();
    this.rtSmall?.dispose();
    this.rtMeter?.dispose();
  }
}

/** Calibrates the meter so that the lab's daylight scenes read about zero when exposed for their EV. */
const METER_BIAS = 0;

/**
 * Collects several pictures into one, as a camera's interval shooting with in-camera
 * compositing does: "lighten" keeps the brightest of every pixel (star trails, meteors),
 * "average" averages them (less noise).
 */
export class Stacker {
  private frame: THREE.WebGLRenderTarget;
  private sum: THREE.WebGLRenderTarget;
  private out: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh;
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lighten: THREE.ShaderMaterial;
  private average: THREE.ShaderMaterial;
  private copy: THREE.ShaderMaterial;
  count = 0;
  mode: 'lighten' | 'average' = 'lighten';

  constructor(private renderer: THREE.WebGLRenderer) {
    this.frame = new THREE.WebGLRenderTarget(2, 2);
    this.sum = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    const mat = (extra: Partial<THREE.ShaderMaterialParameters>) =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: ACCUM_FRAG,
        uniforms: { tSrc: { value: this.frame.texture }, w: { value: 1 } },
        depthTest: false,
        depthWrite: false,
        ...extra,
      });
    this.lighten = mat({ blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.average = mat({ transparent: true });
    this.copy = mat({});
    this.quad = new THREE.Mesh(tri, this.copy);
    this.quad.frustumCulled = false;
  }

  /** The target to render each picture into, sized like the canvas in device pixels. */
  begin(w: number, h: number, mode: 'lighten' | 'average') {
    this.frame.setSize(w, h);
    this.sum.setSize(w, h);
    this.count = 0;
    this.mode = mode;
    return this.frame;
  }

  add() {
    const r = this.renderer;
    const m = this.mode === 'lighten' ? this.lighten : this.average;
    m.uniforms.tSrc.value = this.frame.texture;
    m.uniforms.w.value = 1 / (this.count + 1);
    const prev = r.autoClear;
    r.autoClear = this.count === 0;
    if (this.count === 0) this.quad.material = this.copy;
    else this.quad.material = m;
    this.copy.uniforms.tSrc.value = this.frame.texture;
    r.setRenderTarget(this.sum);
    r.render(this.quad, this.ortho);
    r.autoClear = prev;
    r.setRenderTarget(null);
    this.count++;
  }

  /** Draw the composite so far on the canvas. */
  show() {
    this.copy.uniforms.tSrc.value = this.sum.texture;
    this.quad.material = this.copy;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quad, this.ortho);
  }

  /** The composite as a JPEG data URL. */
  toDataURL() {
    const { width: w, height: h } = this.sum;
    this.out ??= new THREE.WebGLRenderTarget(w, h);
    this.out.setSize(w, h);
    this.copy.uniforms.tSrc.value = this.sum.texture;
    this.quad.material = this.copy;
    this.renderer.setRenderTarget(this.out);
    this.renderer.render(this.quad, this.ortho);
    this.renderer.setRenderTarget(null);
    const px = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(this.out, 0, 0, w, h, px);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  }

  dispose() {
    this.frame.dispose();
    this.sum.dispose();
    this.out?.dispose();
  }
}

export function isLowPower() {
  if (typeof window === 'undefined') return false;
  return matchMedia('(max-width: 720px)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;
}
