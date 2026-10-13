import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HASH } from '../gl/shaders';

/** Film finish applied after tone mapping: grain, gentle vignette and a touch of warmth in the shadows. */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.06 },
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
      c += vec3(.012, .004, -.006) * (1. - l);
      float v = smoothstep(1.2, .35, length((vUv - .5) * vec2(1.15, 1.)));
      c *= mix(.62, 1., v);
      float g = hash12(vUv * uRes + fract(uTime * 7.31) * 517.) - .5;
      c += g * uGrain * (1. - l * .6);
      gl_FragColor = vec4(c, 1.);
    }
  `,
};

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.55, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);

  return {
    composer,
    bloom,
    setSize(w: number, h: number, dpr: number) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      bloom.resolution.set(w * dpr * 0.5, h * dpr * 0.5);
      film.uniforms.uRes.value.set(w * dpr, h * dpr);
    },
    render(time: number) {
      film.uniforms.uTime.value = time;
      composer.render();
    },
  };
}
