import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HASH } from '../gl/shaders';

/** Finish applied after tone mapping: very fine grain and a gentle vignette. */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.018 },
    /** 0..1: how much of the daylight print look to apply (none at night) */
    uGrade: { value: 0 },
    /** unsharp mask: crisper block edges and window grids, the clean look of a voxel game */
    uSharp: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }
  `,
  fragmentShader: /* glsl */ `
    ${HASH}
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uGrain;
    uniform float uGrade;
    uniform float uSharp;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 px = 1. / uRes;
      vec3 around = texture2D(tDiffuse, vUv + vec2(px.x, 0.)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.)).rgb
                  + texture2D(tDiffuse, vUv + vec2(0., px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0., px.y)).rgb;
      // limited, so a lone bright light does not get a dark ring
      c = clamp(c + clamp(c - around * .25, -.08, .08) * uSharp * 4., 0., 1.);
      float l = dot(c, vec3(.299, .587, .114));
      // daylight print look: a touch more contrast and colour, cool shade, warm highlights,
      // so the grey city under a flat sky reads like a photograph rather than a model
      vec3 graded = mix(vec3(l), c, 1.12);
      graded = mix(graded, graded * graded * (3. - 2. * graded), .28);
      graded += vec3(-.012, .002, .016) * (1. - l) * (1. - l) + vec3(.02, .008, -.016) * l * l;
      c = mix(c, clamp(graded, 0., 1.), uGrade);
      l = dot(c, vec3(.299, .587, .114));
      float v = 1. - smoothstep(.4, 1.25, length((vUv - .5) * vec2(1.1, 1.)));
      c *= mix(.78, 1., v);
      // Static fine grain: temporal screen noise must not look like unstable city lights.
      float g = hash12(vUv * uRes) - .5;
      c += g * uGrain * (1. - l * .7);
      gl_FragColor = vec4(c, 1.);
    }
  `,
};

/**
 * Replaces NaN and infinite pixels before bloom. A single bad pixel would otherwise be smeared
 * across the whole frame by the bloom blur and flash the screen black.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // comparisons with NaN are always false, which survives compilers that drop isnan()
      bool ok = c.r < 1e20 && c.g < 1e20 && c.b < 1e20 && c.r > -1e20 && c.g > -1e20 && c.b > -1e20;
      if (!ok || any(isnan(c))) c = vec3(0.);
      gl_FragColor = vec4(clamp(c, 0., 2000.), 1.);
    }
  `,
};

/**
 * Bright-pass for the bloom. Each bloom texel averages the whole patch of screen pixels it covers
 * (four bilinear taps, up to 4×4 pixels), so a light one pixel across is never skipped between
 * taps and does not blink as it moves. A soft knee replaces the hard cut-off: a light just above
 * the threshold glows a little instead of popping on and off, and the glow grows with its energy.
 */
const BrightPassShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    luminosityThreshold: { value: 1 },
    /** one screen pixel, in uv */
    uTexel: { value: new THREE.Vector2(1, 1) },
    /** screen pixels across one bloom texel */
    uSpan: { value: 2 },
    /**
     * 1: a pixel over the threshold glows with all its light (the big soft glow of the sun and the
     * sky round it by day and at sunset); 0: only with the light above the threshold (at night,
     * when the threshold is low enough for every lamp and window to glow by its own brightness).
     */
    uWhole: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold;
    uniform vec2 uTexel;
    uniform float uSpan;
    uniform float uWhole;
    varying vec2 vUv;
    vec3 bright(vec2 uv){
      vec3 c = textureLod(tDiffuse, uv, 0.).rgb;
      float l = dot(c, vec3(.2126, .7152, .0722));
      float t = luminosityThreshold, k = t * .6 + 1e-4;
      float soft = clamp(l - t + k, 0., 2. * k);
      soft = soft * soft / (4. * k);
      float part = max(soft, l - t) / max(l, 1e-4);
      float whole = smoothstep(t, t + .01, l);
      return c * mix(part, whole, uWhole);
    }
    void main(){
      vec2 o = uTexel * uSpan * .25;
      vec3 c = bright(vUv + vec2(-o.x, -o.y)) + bright(vUv + vec2(o.x, -o.y))
             + bright(vUv + vec2(-o.x, o.y)) + bright(vUv + vec2(o.x, o.y));
      gl_FragColor = vec4(c * .25, 1.);
    }
  `,
};

/**
 * HDR pipeline: the scene renders into a multisampled half-float target (4× MSAA, so building
 * edges and power lines of light stay clean), then bloom, ACES tone mapping and the finish.
 */
export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples = 4) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(SanitizeShader));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.5, 0.85);
  const bright = new THREE.ShaderMaterial(BrightPassShader);
  bloom.materialHighPassFilter.dispose();
  bloom.materialHighPassFilter = bright;
  bloom.highPassUniforms = bright.uniforms;
  // The glow is sized in CSS pixels, not device pixels: on a phone or a Retina screen the blur
  // would otherwise cover half or a third of the area and the lights barely glow, and it would
  // shrink again whenever the frame rate guard lowers the resolution.
  let cssWidth = 1;
  let cssHeight = 1;
  const sizeBloom = bloom.setSize.bind(bloom);
  bloom.setSize = (w: number, h: number) => {
    sizeBloom(cssWidth, cssHeight);
    bright.uniforms.uTexel.value.set(1 / w, 1 / h);
    bright.uniforms.uSpan.value = w / Math.max(1, Math.round(cssWidth / 2));
  };
  // Bloom targets have no mipmaps. Explicit level-zero sampling keeps ANGLE from
  // estimating undefined gradients inside the separable blur's filter loop.
  for (const material of bloom.separableBlurMaterials) {
    material.fragmentShader = material.fragmentShader.replace(
      /texture2D\( colorTexture, (vUv(?: [+-] uvOffset)?) \)/g,
      'textureLod( colorTexture, $1, 0.0 )',
    );
  }
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  return {
    composer,
    bloom,
    /** how much of a bright pixel's light the bloom takes (see BrightPassShader) */
    bloomWhole: bright.uniforms.uWhole,
    grade: finish.uniforms.uGrade,
    setSize(w: number, h: number, dpr: number) {
      cssWidth = w;
      cssHeight = h;
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      finish.uniforms.uRes.value.set(w * dpr, h * dpr);
    },
    render(time: number) {
      finish.uniforms.uTime.value = time;
      composer.render();
    },
  };
}
