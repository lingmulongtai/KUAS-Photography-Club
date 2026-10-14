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
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(.299, .587, .114));
      float v = 1. - smoothstep(.4, 1.25, length((vUv - .5) * vec2(1.1, 1.)));
      c *= mix(.78, 1., v);
      float g = hash12(vUv * uRes + fract(uTime * 7.31) * 517.) - .5;
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
    setSize(w: number, h: number, dpr: number) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      bloom.resolution.set(w * dpr * 0.5, h * dpr * 0.5);
      finish.uniforms.uRes.value.set(w * dpr, h * dpr);
    },
    render(time: number) {
      finish.uniforms.uTime.value = time;
      composer.render();
    },
  };
}
