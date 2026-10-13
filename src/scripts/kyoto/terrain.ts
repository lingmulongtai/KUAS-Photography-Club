import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { CITY, LANDMARKS, VIEW, heightAt, RIVER_HALF_WIDTH } from './layout';

/**
 * Terrain mesh on a warped grid: vertices are packed densely near the camera
 * and spread out toward the far mountains, so one mesh covers ~25 km at good detail.
 */
export function buildTerrain(env: Env, segments = 280) {
  const R = 1500;
  const cx = VIEW.camera.x;
  const cz = VIEW.camera.z;
  const n = segments + 1;
  const warp = (s: number) => Math.sign(s) * Math.pow(Math.abs(s), 1.9) * R;

  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    const z = cz + warp((j / segments) * 2 - 1);
    for (let i = 0; i < n; i++) {
      const x = cx + warp((i / segments) * 2 - 1);
      const k = (j * n + i) * 3;
      pos[k] = x;
      pos[k + 1] = heightAt(x, z);
      pos[k + 2] = z;
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], p);
      p += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const d = LANDMARKS.daimonji;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...env,
      uFire: { value: 0 },
      uDaimonji: { value: new THREE.Vector4(d.x, heightAt(d.x, d.z) + 4, d.z, d.size) },
      uGosho: { value: new THREE.Vector4(LANDMARKS.gosho.minX, LANDMARKS.gosho.maxX, LANDMARKS.gosho.minZ, LANDMARKS.gosho.maxZ) },
      uBounds: { value: new THREE.Vector4(CITY.minX, CITY.maxX, CITY.minZ, CITY.maxZ) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uFire;
      uniform vec4 uDaimonji;
      uniform vec4 uGosho;
      uniform vec4 uBounds;
      varying vec3 vWorld;
      varying vec3 vNormal;

      float riverCenter(float z){ return 136. + 5. * sin(z * .009) + 2. * sin(z * .023 + 1.2); }

      float seg(vec2 p, vec2 a, vec2 b){
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
        return length(pa - ba * h);
      }

      // The character 大 as three strokes, in -1..1 coordinates.
      float daiMask(vec2 p, float aa){
        float d = seg(p, vec2(-.85, .38), vec2(.85, .38));
        d = min(d, seg(p, vec2(.02, .95), vec2(0., .38)));
        d = min(d, seg(p, vec2(0., .38), vec2(-.2, -.15)));
        d = min(d, seg(p, vec2(-.2, -.15), vec2(-.8, -.92)));
        d = min(d, seg(p, vec2(.04, .3), vec2(.82, -.92)));
        return 1. - smoothstep(.085, .085 + aa, d);
      }

      void main(){
        vec3 n = normalize(vNormal);
        float h = vWorld.y;
        float grain = fbm(vWorld.xz * .08);
        float patchy = fbm(vWorld.xz * .012 + 4.);

        vec3 urban = mix(vec3(.05, .048, .045), vec3(.075, .07, .062), grain);
        vec3 forest = mix(vec3(.018, .032, .02), vec3(.04, .055, .03), patchy) * (.75 + .5 * grain);
        vec3 fields = mix(vec3(.07, .07, .04), vec3(.05, .065, .035), patchy);

        bool inCity = vWorld.x > uBounds.x && vWorld.x < uBounds.y && vWorld.z > uBounds.z && vWorld.z < uBounds.w;
        vec3 flat_ = inCity ? urban : fields;
        vec3 albedo = mix(flat_, forest, smoothstep(.4, 3.5, h));

        // Imperial Palace gardens
        if (vWorld.x > uGosho.x && vWorld.x < uGosho.y && vWorld.z > uGosho.z && vWorld.z < uGosho.w) albedo = mix(vec3(.06, .07, .05), forest, .5 + .5 * grain);

        // Kamo river banks: pale gravel
        float rd = abs(vWorld.x - riverCenter(vWorld.z));
        albedo = mix(albedo, vec3(.11, .1, .085), (1. - smoothstep(${(RIVER_HALF_WIDTH + 1.2).toFixed(1)}, ${(RIVER_HALF_WIDTH + 3).toFixed(1)}, rd)) * step(h, .5));

        vec3 emit = vec3(0.);

        // 左大文字: a bare patch on the slope, lit with fire on the night of 16 August
        vec2 dp = vec2(-(vWorld.z - uDaimonji.z), vWorld.y - uDaimonji.y) / uDaimonji.w;
        if (abs(dp.x) < 1.2 && abs(dp.y) < 1.2 && abs(vWorld.x - uDaimonji.x) < 40.){
          float aa = fwidth(dp.x) * 1.5;
          float m = daiMask(dp, aa);
          albedo = mix(albedo, vec3(.12, .1, .075), m * .9);
          float flick = .75 + .25 * sin(uTime * 13. + dp.y * 9.) * sin(uTime * 7.3 + dp.x * 11.);
          emit += vec3(4., 1.5, .4) * m * uFire * flick;
        }

        vec3 col = shade(albedo, n);
        gl_FragColor = vec4(applyFog(col, emit, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, fire: material.uniforms.uFire };
}

/** Whether 左大文字 is lit (Gozan no Okuribi: 16 August, about 20:15–20:50). */
export function daimonjiLit(month: number, day: number, minutes: number) {
  return month === 8 && day === 16 && minutes >= 20 * 60 + 15 && minutes <= 20 * 60 + 50;
}
