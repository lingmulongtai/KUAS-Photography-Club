import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, type Env } from './env';
import { LANDMARKS, heightAt } from './layout';

/**
 * Landmark material: diffuse shading, plus night lighting that rises from the base
 * (floodlit temples) or comes from a band of windows (the tower's observation deck).
 */
function landmarkMaterial(env: Env, albedo: THREE.Color, night: { flood: THREE.Color; band?: [number, number, THREE.Color] }) {
  const band = night.band ?? [-1, -1, new THREE.Color(0, 0, 0)];
  return new THREE.ShaderMaterial({
    uniforms: {
      ...env,
      uAlbedo: { value: albedo },
      uFlood: { value: night.flood },
      uBand: { value: new THREE.Vector2(band[0], band[1]) },
      uBandColor: { value: band[2] },
      uTop: { value: 1 },
      uBase: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform vec3 uAlbedo;
      uniform vec3 uFlood;
      uniform vec2 uBand;
      uniform vec3 uBandColor;
      uniform float uTop;
      uniform float uBase;
      uniform vec2 uCenter;
      varying vec3 vWorld;
      varying vec3 vN;
      void main(){
        vec3 n = normalize(vN);
        float y = (vWorld.y - uBase) / (uTop - uBase);
        vec3 col = shade(uAlbedo, n);
        vec3 emit = uFlood * uCity * mix(1.2, .35, clamp(y, 0., 1.)) * (.6 + .4 * max(n.y, 0.) + .3 * abs(n.x));
        float inBand = step(uBand.x, vWorld.y) * step(vWorld.y, uBand.y);
        vec2 rel = vWorld.xz - uCenter;
        float slats = step(.35, fract(atan(rel.y, rel.x) * 3.8197));
        emit += uBandColor * inBand * uCity * (.5 + .5 * slats);
        gl_FragColor = vec4(applyFog(col, emit, vWorld), 1.);
      }
    `,
  });
}

/** A five-storey pagoda: tiered bodies with square, slightly flaring roofs and a spire. Height in units. */
function pagodaGeometry(height: number) {
  const parts: THREE.BufferGeometry[] = [];
  const tier = height * 0.155;
  const base = height * 0.24;
  const plinth = new THREE.BoxGeometry(base * 1.3, tier * 0.25, base * 1.3).translate(0, tier * 0.125, 0);
  parts.push(plinth);
  let y = tier * 0.25;
  for (let i = 0; i < 5; i++) {
    const w = base * Math.pow(0.88, i);
    const bodyH = tier * (i === 0 ? 0.62 : 0.5);
    parts.push(new THREE.BoxGeometry(w * 0.62, bodyH, w * 0.62).translate(0, y + bodyH / 2, 0));
    y += bodyH;
    const roofW = w * 1.25;
    const roof = new THREE.CylinderGeometry(roofW * 0.2, roofW * 0.74, tier * 0.34, 4, 1);
    roof.rotateY(Math.PI / 4);
    parts.push(roof.translate(0, y + tier * 0.12, 0));
    // eaves: thin flared skirt under the roof
    const eave = new THREE.CylinderGeometry(roofW * 0.74, roofW * 0.7, tier * 0.06, 4, 1);
    eave.rotateY(Math.PI / 4);
    parts.push(eave.translate(0, y - tier * 0.04, 0));
    y += tier * 0.29;
  }
  parts.push(new THREE.CylinderGeometry(height * 0.012, height * 0.02, height * 0.2, 6).translate(0, y + height * 0.1, 0));
  for (let k = 0; k < 9; k++) {
    parts.push(new THREE.CylinderGeometry(height * 0.03, height * 0.03, height * 0.006, 8).translate(0, y + height * (0.02 + k * 0.016), 0));
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  merged.computeVertexNormals();
  return merged;
}

/** Kyoto Tower: a candle-like lathe on top of a nine-storey building. */
function towerGeometry() {
  const pts = [
    [0.001, 0], [0.78, 0], [0.7, 2.2], [0.56, 4.6], [0.48, 6.2], [0.46, 6.5],
    [0.98, 6.62], [1.04, 6.95], [1.0, 7.4], [0.86, 7.55], [0.34, 7.62], [0.28, 8.2],
    [0.14, 9.1], [0.06, 9.7], [0.02, 10.05], [0.001, 10.1],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 28);
}

export function buildLandmarks(env: Env) {
  const group = new THREE.Group();

  // Kyoto Tower and its base building
  const t = LANDMARKS.kyotoTower;
  const towerBase = new THREE.Mesh(
    new THREE.BoxGeometry(7, 3.1, 4.6).translate(t.x, 1.55, t.z),
    landmarkMaterial(env, new THREE.Color(0.3, 0.3, 0.3), { flood: new THREE.Color(0.25, 0.22, 0.18) }),
  );
  const towerMat = landmarkMaterial(env, new THREE.Color(0.62, 0.62, 0.6), {
    flood: new THREE.Color(0.9, 0.85, 0.8),
    band: [9.75, 10.25, new THREE.Color(2.4, 1.6, 0.9)],
  });
  towerMat.uniforms.uBase.value = 3.1;
  towerMat.uniforms.uTop.value = 13.2;
  towerMat.uniforms.uCenter.value.set(t.x, t.z);
  const tower = new THREE.Mesh(towerGeometry().translate(t.x, 3.1, t.z), towerMat);
  group.add(towerBase, tower);

  // Kyoto Station: a long glass block
  const st = LANDMARKS.kyotoStation;
  const station = new THREE.Mesh(
    new THREE.BoxGeometry(st.w, st.h, st.d).translate(st.x, st.h / 2, st.z),
    landmarkMaterial(env, new THREE.Color(0.1, 0.11, 0.12), {
      flood: new THREE.Color(0.05, 0.045, 0.04),
      band: [st.h * 0.45, st.h * 0.62, new THREE.Color(0.3, 0.24, 0.16)],
    }),
  );
  group.add(station);

  // Toji (55 m) and Yasaka-no-to (46 m), both floodlit at night
  const tojiMat = landmarkMaterial(env, new THREE.Color(0.07, 0.05, 0.04), { flood: new THREE.Color(0.9, 0.42, 0.14) });
  tojiMat.uniforms.uTop.value = 5.5;
  const toji = new THREE.Mesh(pagodaGeometry(5.5).translate(LANDMARKS.toji.x, 0, LANDMARKS.toji.z), tojiMat);
  const y = LANDMARKS.yasaka;
  const yBase = heightAt(y.x, y.z);
  const yasakaMat = landmarkMaterial(env, new THREE.Color(0.07, 0.05, 0.04), { flood: new THREE.Color(1.1, 0.5, 0.16) });
  yasakaMat.uniforms.uBase.value = yBase;
  yasakaMat.uniforms.uTop.value = yBase + 4.6;
  const yasaka = new THREE.Mesh(pagodaGeometry(4.6).translate(y.x, yBase - 0.1, y.z), yasakaMat);
  group.add(toji, yasaka);

  return group;
}

/** A soft beacon over the Uzumasa campus, where the club meets. */
export function buildCampusBeacon(env: Env) {
  const c = LANDMARKS.campus;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([c.x, 2.2, c.z], 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: env.uTime, uPx: { value: 600 }, uFogDensity: env.uFogDensity },
    vertexShader: /* glsl */ `
      uniform float uPx;
      uniform float uTime;
      uniform float uFogDensity;
      varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        float d = -mv.z;
        float pulse = .6 + .4 * sin(uTime * 2.2);
        gl_PointSize = clamp(2.4 * uPx / d * (1. + pulse * .5), 4., 40.);
        vA = pulse * exp(-d * uFogDensity * .3);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        float r = length(gl_PointCoord - .5) * 2.;
        float a = (exp(-r * r * 9.) * 1.6 + exp(-r * r * 2.5) * .4) * vA;
        gl_FragColor = vec4(vec3(3., 1.7, .7) * a, 1.);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, position: new THREE.Vector3(c.x, 2.2, c.z) };
}
