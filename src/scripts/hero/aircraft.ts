import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, type Env } from './env';
import {
  AIRLINER_FLIGHTS,
  HELICOPTER_FLIGHTS,
  airlinerPose,
  helicopterPose,
} from './aircraft-path';

function paintGeometry(geo: THREE.BufferGeometry, rgb: [number, number, number], accent = 0): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  if (nonIndexed !== geo) geo.dispose();
  const count = nonIndexed.getAttribute('position').count;
  const cols = new Float32Array(count * 3);
  const acc = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    cols[i * 3] = rgb[0];
    cols[i * 3 + 1] = rgb[1];
    cols[i * 3 + 2] = rgb[2];
    acc[i] = accent;
  }
  nonIndexed.setAttribute('aPartColor', new THREE.BufferAttribute(cols, 3));
  nonIndexed.setAttribute('aAccent', new THREE.BufferAttribute(acc, 1));
  return nonIndexed;
}

function buildAirlinerGeometry(): THREE.BufferGeometry {
  const white: [number, number, number] = [0.84, 0.86, 0.89];
  const belly: [number, number, number] = [0.58, 0.62, 0.67];
  const wingMetal: [number, number, number] = [0.72, 0.75, 0.78];
  const cockpit: [number, number, number] = [0.08, 0.11, 0.15];
  const engineDark: [number, number, number] = [0.24, 0.27, 0.30];

  const parts: THREE.BufferGeometry[] = [];

  // Main cylindrical fuselage (+Z = nose forward, +Y = up)
  const body = new THREE.CylinderGeometry(2.15, 2.15, 28, 12);
  body.rotateX(Math.PI / 2);
  parts.push(paintGeometry(body, white));

  // Tapered nose cone + cockpit glass band
  const nose = new THREE.ConeGeometry(2.15, 7.2, 12);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, -0.15, 17.6);
  parts.push(paintGeometry(nose, white));

  const visor = new THREE.BoxGeometry(2.6, 0.85, 2.2);
  visor.translate(0, 0.95, 15.2);
  parts.push(paintGeometry(visor, cockpit));

  // Tapered tail cone
  const tailCone = new THREE.ConeGeometry(2.15, 9.5, 12);
  tailCone.rotateX(-Math.PI / 2);
  tailCone.translate(0, 0.35, -18.75);
  parts.push(paintGeometry(tailCone, belly));

  // Swept left & right main wings + upturned winglets
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(18.5, 0.55, 6.2);
    wing.rotateY(side * -0.44);
    wing.rotateZ(side * 0.055);
    wing.translate(side * 9.8, -0.45, -1.6);
    parts.push(paintGeometry(wing, wingMetal));

    // Winglet (painted in livery accent!)
    const winglet = new THREE.BoxGeometry(0.32, 2.6, 2.0);
    winglet.rotateZ(side * -0.22);
    winglet.translate(side * 18.2, 0.95, -5.6);
    parts.push(paintGeometry(winglet, white, 1));

    // Underwing turbofan engine nacelle + pylon
    const engine = new THREE.CylinderGeometry(1.15, 1.05, 4.6, 10);
    engine.rotateX(Math.PI / 2);
    engine.translate(side * 6.4, -1.75, 1.0);
    parts.push(paintGeometry(engine, engineDark));

    // Swept horizontal tailplane
    const hStab = new THREE.BoxGeometry(7.2, 0.32, 2.6);
    hStab.rotateY(side * -0.42);
    hStab.translate(side * 3.8, 0.85, -18.2);
    parts.push(paintGeometry(hStab, wingMetal));
  }

  // Swept vertical tailfin (painted in airline livery accent!)
  const fin = new THREE.BoxGeometry(0.42, 7.6, 5.2);
  fin.rotateX(-0.34);
  fin.translate(0, 4.5, -18.4);
  parts.push(paintGeometry(fin, white, 1));

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

function buildHelicopterBodyGeometry(): THREE.BufferGeometry {
  const cabinCol: [number, number, number] = [0.84, 0.86, 0.88];
  const glassCol: [number, number, number] = [0.08, 0.13, 0.18];
  const darkCol: [number, number, number] = [0.22, 0.24, 0.26];
  const parts: THREE.BufferGeometry[] = [];

  // Streamlined cabin (+Z forward)
  const cabin = new THREE.BoxGeometry(3.2, 2.8, 7.4);
  cabin.translate(0, 1.9, 1.2);
  parts.push(paintGeometry(cabin, cabinCol, 0.85));

  // Rounded front cockpit glass canopy
  const canopy = new THREE.SphereGeometry(1.75, 10, 8);
  canopy.scale(0.92, 0.78, 1.35);
  canopy.translate(0, 1.95, 4.4);
  parts.push(paintGeometry(canopy, glassCol));

  // Engine cowling & rotor mast on top
  const cowl = new THREE.BoxGeometry(2.1, 1.15, 4.2);
  cowl.translate(0, 3.6, 0.4);
  parts.push(paintGeometry(cowl, cabinCol, 0.5));

  const mast = new THREE.CylinderGeometry(0.28, 0.35, 1.5, 8);
  mast.translate(0, 4.7, 0.8);
  parts.push(paintGeometry(mast, darkCol));

  // Tail boom + vertical tail fin + horizontal stabilizer
  const boom = new THREE.CylinderGeometry(0.42, 0.78, 9.2, 8);
  boom.rotateX(Math.PI / 2);
  boom.translate(0, 2.35, -6.5);
  parts.push(paintGeometry(boom, cabinCol, 0.85));

  const vFin = new THREE.BoxGeometry(0.32, 2.8, 1.8);
  vFin.rotateX(-0.28);
  vFin.translate(0, 3.1, -11.0);
  parts.push(paintGeometry(vFin, cabinCol, 1.0));

  const hFin = new THREE.BoxGeometry(3.4, 0.22, 0.85);
  hFin.translate(0, 2.35, -8.8);
  parts.push(paintGeometry(hFin, cabinCol, 0.6));

  // Landing skids
  for (const side of [-1, 1]) {
    const skid = new THREE.CylinderGeometry(0.16, 0.16, 7.2, 6);
    skid.rotateX(Math.PI / 2);
    skid.translate(side * 1.75, 0.25, 1.2);
    parts.push(paintGeometry(skid, darkCol));

    for (const zStrut of [-0.6, 2.8]) {
      const strut = new THREE.CylinderGeometry(0.12, 0.12, 1.5, 6);
      strut.rotateZ(side * 0.28);
      strut.translate(side * 1.45, 0.9, zStrut);
      parts.push(paintGeometry(strut, darkCol));
    }
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

function buildHelicopterRotorGeometry(): THREE.BufferGeometry {
  const bladeCol: [number, number, number] = [0.16, 0.17, 0.19];
  const tipCol: [number, number, number] = [0.85, 0.75, 0.22];
  const parts: THREE.BufferGeometry[] = [];
  // 4-blade main rotor centered at origin (positioned at rotor hub during animation)
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.BoxGeometry(0.42, 0.08, 7.8);
    blade.translate(0, 0, 3.9);
    blade.rotateY((i * Math.PI) / 2);
    parts.push(paintGeometry(blade, i % 2 === 0 ? bladeCol : tipCol));
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

function createAircraftMaterial(env: Env): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: env,
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */ `
      attribute vec3 aPartColor;
      attribute float aAccent;
      attribute float iOpacity;
      attribute vec3 iLivery;
      varying vec3 vWorld, vNormal, vColor;
      varying float vOpacity;
      void main(){
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vColor = mix(aPartColor, iLivery, aAccent);
        vOpacity = iOpacity;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld, vNormal, vColor;
      varying float vOpacity;
      void main(){
        if (vOpacity < .02) discard;
        vec3 n = normalize(vNormal);
        vec3 lit = shade(vColor, n, vWorld, 1.);
        // Subtle cabin window glow & tailfin logo floodlight at night.
        vec3 emit = (vec3(.95, .86, .68) * .045 + vColor * .08) * uCity;
        gl_FragColor = vec4(applyHaze(lit, emit, vWorld), vOpacity);
      }
    `,
  });
}

/**
 * Airliners (taking off & landing at Itami, Kansai Intl, Kobe Airport + Kansai overflights)
 * and helicopters (vertical takeoff/landing & scenic loops) with nav/strobe/landing lights.
 */
export function buildAircraft(env: Env, initialGround?: (x: number, z: number) => number) {
  let ground = initialGround ?? (() => 0);
  const group = new THREE.Group();
  group.name = 'illustrative-aircraft';

  const airlinerGeo = buildAirlinerGeometry();
  const airlinerOpacity = new THREE.InstancedBufferAttribute(new Float32Array(AIRLINER_FLIGHTS.length), 1);
  const airlinerLivery = new THREE.InstancedBufferAttribute(new Float32Array(AIRLINER_FLIGHTS.length * 3), 3);
  AIRLINER_FLIGHTS.forEach((f, i) => airlinerLivery.setXYZ(i, f.livery[0], f.livery[1], f.livery[2]));
  airlinerGeo.setAttribute('iOpacity', airlinerOpacity);
  airlinerGeo.setAttribute('iLivery', airlinerLivery);
  const airlinerMat = createAircraftMaterial(env);
  const airlinerMesh = new THREE.InstancedMesh(airlinerGeo, airlinerMat, AIRLINER_FLIGHTS.length);
  airlinerMesh.name = 'kansai-airliners';
  airlinerMesh.frustumCulled = false;
  group.add(airlinerMesh);

  const heliBodyGeo = buildHelicopterBodyGeometry();
  const heliOpacity = new THREE.InstancedBufferAttribute(new Float32Array(HELICOPTER_FLIGHTS.length), 1);
  const heliLivery = new THREE.InstancedBufferAttribute(new Float32Array(HELICOPTER_FLIGHTS.length * 3), 3);
  HELICOPTER_FLIGHTS.forEach((h, i) => {
    heliOpacity.setX(i, 1);
    heliLivery.setXYZ(i, h.color[0], h.color[1], h.color[2]);
  });
  heliBodyGeo.setAttribute('iOpacity', heliOpacity);
  heliBodyGeo.setAttribute('iLivery', heliLivery);
  const heliMat = createAircraftMaterial(env);
  const heliMesh = new THREE.InstancedMesh(heliBodyGeo, heliMat, HELICOPTER_FLIGHTS.length);
  heliMesh.name = 'kansai-helicopters';
  heliMesh.frustumCulled = false;
  group.add(heliMesh);

  const rotorGeo = buildHelicopterRotorGeometry();
  const rotorOpacity = new THREE.InstancedBufferAttribute(new Float32Array(HELICOPTER_FLIGHTS.length), 1);
  const rotorLivery = new THREE.InstancedBufferAttribute(new Float32Array(HELICOPTER_FLIGHTS.length * 3), 3);
  HELICOPTER_FLIGHTS.forEach((_, i) => {
    rotorOpacity.setX(i, 0.72);
    rotorLivery.setXYZ(i, 0.2, 0.2, 0.2);
  });
  rotorGeo.setAttribute('iOpacity', rotorOpacity);
  rotorGeo.setAttribute('iLivery', rotorLivery);
  const rotorMesh = new THREE.InstancedMesh(rotorGeo, heliMat, HELICOPTER_FLIGHTS.length);
  rotorMesh.name = 'kansai-helicopter-rotors';
  rotorMesh.frustumCulled = false;
  group.add(rotorMesh);

  // Navigation, anti-collision strobe, red beacon & forward landing lights for every airliner & helicopter
  // 4 lights per airliner (port red, starboard green, white strobe/landing, red beacon) + 2 per helicopter
  const lightCount = AIRLINER_FLIGHTS.length * 4 + HELICOPTER_FLIGHTS.length * 2;
  const lPos = new Float32Array(lightCount * 3);
  const lCol = new Float32Array(lightCount * 3);
  const lSize = new Float32Array(lightCount);
  const lAlpha = new Float32Array(lightCount);
  const lPosAttr = new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage);
  const lColAttr = new THREE.BufferAttribute(lCol, 3);
  const lSizeAttr = new THREE.BufferAttribute(lSize, 1).setUsage(THREE.DynamicDrawUsage);
  const lAlphaAttr = new THREE.BufferAttribute(lAlpha, 1).setUsage(THREE.DynamicDrawUsage);
  const lightGeo = new THREE.BufferGeometry();
  lightGeo.setAttribute('position', lPosAttr);
  lightGeo.setAttribute('aColor', lColAttr);
  lightGeo.setAttribute('aSize', lSizeAttr);
  lightGeo.setAttribute('aAlpha', lAlphaAttr);

  // Assign fixed light colors
  let li = 0;
  for (let i = 0; i < AIRLINER_FLIGHTS.length; i++) {
    lCol.set([1.0, 0.16, 0.14], (li++) * 3); // Port red wingtip
    lCol.set([0.16, 1.0, 0.34], (li++) * 3); // Starboard green wingtip
    lCol.set([1.0, 0.97, 0.88], (li++) * 3); // Nose landing light / white strobe
    lCol.set([1.0, 0.22, 0.16], (li++) * 3); // Belly/top flashing red beacon
  }
  for (let i = 0; i < HELICOPTER_FLIGHTS.length; i++) {
    lCol.set([1.0, 0.96, 0.84], (li++) * 3); // Nose spotlight
    lCol.set([1.0, 0.18, 0.14], (li++) * 3); // Anti-collision red strobe
  }

  const lightMat = new THREE.ShaderMaterial({
    uniforms: env,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.);
        float dist = max(18., -mv.z);
        vColor = aColor;
        vAlpha = aAlpha * (1. - smoothstep(26000., 55000., dist));
        gl_PointSize = clamp(aSize * 950. / dist, 2.0, 18.);
        gl_Position = vAlpha > .01 ? projectionMatrix * mv : vec4(2., 2., 2., 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec2 d = gl_PointCoord - .5;
        float r2 = dot(d, d);
        if (r2 > .25) discard;
        float glow = exp(-r2 * 16.) + .4 * exp(-r2 * 5.);
        gl_FragColor = vec4(vColor * glow * 1.4, vAlpha);
      }
    `,
  });
  const lightPoints = new THREE.Points(lightGeo, lightMat);
  lightPoints.name = 'kansai-aircraft-lights';
  lightPoints.frustumCulled = false;
  group.add(lightPoints);

  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  const rotorDummy = new THREE.Object3D();
  rotorDummy.rotation.order = 'YXZ';
  const localVec = new THREE.Vector3();
  const hubOffset = new THREE.Vector3(0, 5.45, 0.8);
  let elapsed = 0;

  const setLight = (idx: number, world: THREE.Vector3, size: number, alpha: number) => {
    lPos[idx * 3] = world.x;
    lPos[idx * 3 + 1] = world.y;
    lPos[idx * 3 + 2] = world.z;
    lSize[idx] = size;
    lAlpha[idx] = alpha;
  };

  const update = (dt: number) => {
    elapsed += Math.max(0, dt);
    const nightBoost = 0.35 + 0.65 * Math.min(1, env.uCity.value * 1.4);
    let idx = 0;

    AIRLINER_FLIGHTS.forEach((flight, i) => {
      const p = airlinerPose(flight, elapsed, ground);
      dummy.position.set(p.x, p.y, p.z);
      // In Three.js YXZ order: +Y yaw rotates +Z toward +X; negative X pitch lifts +Z nose upward.
      dummy.rotation.set(-p.pitch, p.yaw, -p.roll);
      dummy.scale.setScalar(flight.scale);
      dummy.updateMatrix();
      airlinerMesh.setMatrixAt(i, dummy.matrix);
      airlinerOpacity.setX(i, p.opacity);

      const strobe = Math.sin(elapsed * 5.2 + i * 1.7) > 0.82 ? 1.8 : 0.25;
      const beacon = Math.sin(elapsed * 3.1 + i * 2.3) > 0.65 ? 1.5 : 0.15;

      // Port red wingtip
      localVec.set(18.2, 0.5, -5.2).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 3.6 * flight.scale, p.opacity * nightBoost);
      // Starboard green wingtip
      localVec.set(-18.2, 0.5, -5.2).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 3.6 * flight.scale, p.opacity * nightBoost);
      // Nose landing light (bright even by day on approach/takeoff!) + white strobe
      localVec.set(0, -1.2, 16.5).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, (4.0 + 4.8 * p.landingLights) * flight.scale, p.opacity * Math.max(p.landingLights * 0.95, strobe * nightBoost));
      // Red anti-collision beacon
      localVec.set(0, 2.8, 0).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 4.2 * flight.scale, p.opacity * beacon * nightBoost);
    });

    HELICOPTER_FLIGHTS.forEach((flight, i) => {
      const p = helicopterPose(flight, elapsed, ground);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(-p.pitch, p.yaw, -p.roll);
      dummy.scale.setScalar(1.35);
      dummy.updateMatrix();
      heliMesh.setMatrixAt(i, dummy.matrix);

      // Spinning main rotor positioned at hub in helicopter local space
      localVec.copy(hubOffset).applyMatrix4(dummy.matrix);
      rotorDummy.position.copy(localVec);
      rotorDummy.rotation.set(-p.pitch, p.yaw + p.rotorPhase, -p.roll);
      rotorDummy.scale.setScalar(1.35);
      rotorDummy.updateMatrix();
      rotorMesh.setMatrixAt(i, rotorDummy.matrix);

      const strobe = Math.sin(elapsed * 4.4 + i * 1.9) > 0.72 ? 1.6 : 0.2;
      localVec.set(0, 1.2, 5.2).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 4.2, Math.max(p.landingLights * 0.85, nightBoost * 0.6));
      localVec.set(0, 4.2, -10.8).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 3.4, strobe * nightBoost);
    });

    airlinerMesh.instanceMatrix.needsUpdate = airlinerOpacity.needsUpdate = true;
    heliMesh.instanceMatrix.needsUpdate = true;
    rotorMesh.instanceMatrix.needsUpdate = true;
    lPosAttr.needsUpdate = lSizeAttr.needsUpdate = lAlphaAttr.needsUpdate = true;
  };

  update(0);
  return {
    mesh: group,
    update,
    setGround(next: (x: number, z: number) => number) {
      ground = next;
    },
  };
}
