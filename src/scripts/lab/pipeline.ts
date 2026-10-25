import * as THREE from 'three';
import { SENSOR_H, cameraEV, vfov, type Shot } from './optics';

/**
 * A small "camera" renderer: the scene is rendered in linear HDR, averaged over the
 * shutter time (motion blur and camera shake), blurred by depth (depth of field with
 * aperture-blade shaped bokeh), exposed by the settings, given sensor noise for the ISO,
 * and only then tone mapped. Every learning-lab proposal draws its pictures through it.
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
}

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
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

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tSharp, tDof; uniform vec2 res;
uniform float exposure, shotGain, readNoise, chroma, time, vignette, peaking, zebra, grain, fullCoc;
varying vec2 vUv;
${DEPTH}
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gauss(vec2 p){ return (hash(p) + hash(p + 17.13) + hash(p + 41.7) - 1.5) * 2.; }
float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
void main(){
  vec3 sharp = texture2D(tSharp, vUv).rgb;
  vec4 dof = texture2D(tDof, vUv);
  vec3 c = mix(sharp, dof.rgb, dof.a) * exposure;
  vec2 q = vUv - .5;
  c *= 1. - vignette * dot(q, q) * 1.8;
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

export interface PipelineOptions {
  /** Most scene renders per frame for long exposures. */
  maxSubframes?: number;
  /** Largest bokeh radius in DOF-buffer pixels. */
  maxCoc?: number;
  vignette?: number;
}

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  private rtScene: THREE.WebGLRenderTarget;
  private rtAccum: THREE.WebGLRenderTarget;
  private rtDof: THREE.WebGLRenderTarget;
  private rtSmall: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh;
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private accum: THREE.ShaderMaterial;
  private dof: THREE.ShaderMaterial;
  private final: THREE.ShaderMaterial;
  private w = 2;
  private h = 2;
  private opts: Required<PipelineOptions>;
  private q = new THREE.Quaternion();
  /** Linear multiplier applied in the last frame; 1 means a correct exposure. */
  lastStops = 0;

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
    const depthUniforms = () => ({
      tDepth: { value: this.rtScene.depthTexture },
      near: { value: 0.1 },
      far: { value: 100 },
      focus: { value: 1 },
      cocScale: { value: 0 },
      maxCoc: { value: 1 },
    });
    this.accum = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: ACCUM_FRAG,
      uniforms: { tSrc: { value: null }, w: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.dof = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: DOF_FRAG,
      uniforms: {
        ...depthUniforms(),
        tColor: { value: null },
        res: { value: new THREE.Vector2() },
        radScale: { value: 0.6 },
        blades: { value: 0 },
        bladeRot: { value: 0.3 },
        bladeAmt: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.final = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FINAL_FRAG,
      uniforms: {
        ...depthUniforms(),
        tSharp: { value: null },
        tDof: { value: this.rtDof.texture },
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
      },
      depthTest: false,
      depthWrite: false,
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
  }

  private pass(material: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(to);
    this.renderer.render(this.quad, this.ortho);
  }

  /**
   * Take a picture of `world` through `camera` with `shot`, at `now` seconds.
   * `viewport` is in CSS pixels on the canvas; without it the picture fills the canvas.
   */
  render(world: Exposable, camera: THREE.PerspectiveCamera, shot: Shot, now: number, viewport?: Viewport, to: THREE.WebGLRenderTarget | null = null, clip?: Viewport) {
    const r = this.renderer;
    const crop = shot.crop ?? 1;
    camera.fov = (vfov(shot.mm, crop) * 180) / Math.PI;
    camera.updateProjectionMatrix();

    // 1. Average the scene over the time the shutter is open.
    const shake = shot.shake ?? 0;
    const moving = world.moving || shake > 0;
    const n = moving ? Math.max(1, Math.min(this.opts.maxSubframes, Math.ceil(shot.t * 240))) : 1;
    this.q.copy(camera.quaternion);
    const prevAutoClear = r.autoClear;
    for (let i = 0; i < n; i++) {
      const time = n === 1 ? now : now - shot.t + (shot.t * i) / (n - 1);
      world.step(time);
      if (shake) {
        const a = 0.0035 * shake;
        camera.quaternion.copy(this.q);
        camera.rotateX(a * (Math.sin(time * 7.1) + 0.6 * Math.sin(time * 13.7 + 1.3) + 0.3 * Math.sin(time * 29.3)));
        camera.rotateY(a * (Math.sin(time * 6.3 + 2.1) + 0.6 * Math.sin(time * 15.1) + 0.3 * Math.sin(time * 31.9 + 0.7)));
      }
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
    const color = n > 1 ? this.rtAccum.texture : this.rtScene.texture;

    // 2. Depth of field, at half resolution.
    const f = shot.mm / 1000;
    const focus = Math.max(shot.focus, f * 1.5);
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

    // 3. Exposure, noise, tone mapping.
    const stops = world.ev - cameraEV(shot.N, shot.t, shot.iso) + (shot.bias ?? 0);
    this.lastStops = stops;
    const fu = this.final.uniforms;
    fu.tSharp.value = color;
    fu.res.value.set(this.w, this.h);
    fu.exposure.value = world.gain * 2 ** stops;
    const isoK = shot.iso / 100;
    fu.shotGain.value = 0.00011 * isoK;
    fu.readNoise.value = 0.00012 * isoK;
    fu.chroma.value = Math.min(0.6, 0.12 * Math.log2(isoK + 1));
    fu.time.value = now;
    fu.peaking.value = shot.peaking ? 1 : 0;
    fu.zebra.value = shot.zebra ? 1 : 0;
    fu.grain.value = Math.max(1, this.renderer.getPixelRatio() * 0.9);
    fu.fullCoc.value = this.h / Math.max(1, halfH);
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

  dispose() {
    this.rtScene.dispose();
    this.rtAccum.dispose();
    this.rtDof.dispose();
    this.rtSmall?.dispose();
  }
}

export function isLowPower() {
  if (typeof window === 'undefined') return false;
  return matchMedia('(max-width: 720px)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;
}
