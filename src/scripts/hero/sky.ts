import * as THREE from 'three';
import { ENV_GLSL, NOISE_GLSL, type Env } from './env';
import { KYOTO } from './astro';
import { rng } from './util';

/** Radius of the sky dome in metres: inside the camera's far plane, beyond the farthest mountains. */
export const RADIUS = 45000;

/**
 * The sky dome: analytic sky, sun disc and a moon lit in 3D by the real sun direction
 * (so its phase and tilt are right). It follows the camera.
 */
export function buildSkyDome(env: Env) {
  const uniforms = {
    ...env,
    uMoonVis: { value: 0 },
    uMoonIllum: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 wp = modelMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uMoonVis;
      uniform float uMoonIllum;
      varying vec3 vDir;
      void main(){
        vec3 dir = normalize(vDir);
        vec3 c = skyColor(dir);
        if (dir.y < 0.) c = mix(c, uHorizon * .35, smoothstep(0., -.08, dir.y));

        // sun disc
        float cosA = dot(dir, uSunDir);
        float sunR = .0072;
        c += uSunLight * smoothstep(cos(sunR * 1.25), cos(sunR), cosA) * 4.5;

        // moon: a sphere lit by the sun
        vec3 m = normalize(uMoonDir);
        float mr = .0115;
        float along = dot(dir, m);
        vec3 tp = dir - m * along;
        float dd = length(tp);
        if (along > 0. && dd < mr * 1.05){
          float z = sqrt(max(mr * mr - dd * dd, 0.)) / mr;
          vec3 nrm = normalize(tp / mr - m * z);
          float lit = smoothstep(-.04, .12, dot(nrm, uSunDir));
          float maria = fbm(nrm.xy * 2.6 + nrm.z * 1.7 + 3.);
          vec3 alb = vec3(.92, .9, .85) * (.62 + .45 * smoothstep(.38, .68, maria));
          float edge = 1. - smoothstep(mr * .97, mr * 1.03, dd);
          vec3 moonCol = alb * (lit * 1.5 + .012) * uMoonVis;
          c = mix(c, c * .25 + moonCol, edge * min(uMoonVis * 1.5, 1.));
        }
        c += vec3(.45, .5, .6) * pow(max(along, 0.), 1800.) * .08 * uMoonIllum * uMoonVis;

        gl_FragColor = vec4(c, 1.);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 64, 32), material);
  mesh.renderOrder = -2;
  mesh.frustumCulled = false;

  return { mesh, uniforms };
}

/**
 * Stars and the Milky Way on a celestial sphere that turns with sidereal time
 * about the pole star, 35° above the northern horizon in Kyoto.
 */
export function buildCelestial(env: Env, quality: number) {
  const group = new THREE.Group();
  const r = rng(1969);
  const count = Math.round(2600 * quality + 600);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  const R = RADIUS * 0.9;
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1;
    const th = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos.set([s * Math.cos(th) * R, s * Math.sin(th) * R, u * R], i * 3);
    const warm = r();
    col.set(warm < 0.2 ? [0.75, 0.85, 1] : warm > 0.85 ? [1, 0.78, 0.55] : [1, 0.96, 0.9], i * 3);
    mag[i] = Math.pow(r(), 7);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uStars: env.uStars, uTime: env.uTime, uDpr: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aMag;
      uniform float uStars;
      uniform float uTime;
      uniform float uDpr;
      varying vec3 vColor;
      varying float vA;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vec3 dir = normalize(wp.xyz - cameraPosition);
        float horizon = smoothstep(.02, .22, dir.y);
        float tw = .75 + .25 * sin(uTime * (2. + aMag * 3.) + position.x * .37);
        // light pollution hides faint stars first
        float visible = smoothstep(0., .4, uStars - (1. - aMag) * .5);
        vA = (.2 + aMag * 2.4) * tw * horizon * uStars * visible;
        vColor = aColor;
        gl_PointSize = (1.3 + aMag * 2.6) * uDpr;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vA;
      void main(){
        float r = length(gl_PointCoord - .5) * 2.;
        float a = exp(-r * r * 4.) * vA;
        if (a < .002) discard;
        gl_FragColor = vec4(vColor * a, 1.);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(geo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -1;

  // Milky Way, drawn in equatorial coordinates on the same sphere
  const ngp = equatorial(192.86, 27.13);
  const gc = equatorial(266.4, -28.94);
  const mwMat = new THREE.ShaderMaterial({
    uniforms: { uStars: env.uStars, uNgp: { value: ngp }, uGc: { value: gc } },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorldDir;
      void main(){
        vLocal = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.);
        vWorldDir = normalize(wp.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uStars;
      uniform vec3 uNgp;
      uniform vec3 uGc;
      varying vec3 vLocal;
      varying vec3 vWorldDir;
      void main(){
        float b = dot(vLocal, uNgp);
        float band = exp(-b * b / .018);
        float core = exp(-pow(1. - dot(vLocal, uGc), 2.) * 1.6);
        vec2 q = vec2(atan(vLocal.y, vLocal.x) * 3., vLocal.z * 6.);
        float dust = smoothstep(.35, .75, fbm(q * 2.2));
        float lane = 1. - .7 * exp(-b * b / .0012) * smoothstep(.45, .7, fbm(q * 4. + 7.));
        float a = band * (.35 + .65 * dust) * lane * (.5 + core) * uStars * smoothstep(.05, .3, vWorldDir.y);
        gl_FragColor = vec4(vec3(.62, .66, .8) * a * .045, 1.);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const milky = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 0.92, 48, 32), mwMat);
  milky.frustumCulled = false;
  milky.renderOrder = -1;
  group.add(milky, stars);

  // Equatorial frame → scene: x toward the meridian on the equator (south, 55° up),
  // y toward east, z toward the celestial pole (north, 35° up).
  const phi = (KYOTO.lat * Math.PI) / 180;
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, Math.cos(phi), Math.sin(phi)),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, Math.sin(phi), -Math.cos(phi)),
  );
  const spin = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  const setSidereal = (lst: number) => {
    spin.makeRotationZ(-lst);
    m.multiplyMatrices(basis, spin);
    group.quaternion.setFromRotationMatrix(m);
  };
  return { group, setSidereal, starUniforms: starMat.uniforms };
}

/** Unit vector for right ascension / declination in degrees (equatorial frame). */
function equatorial(raDeg: number, decDeg: number) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
}
