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
  // Strip unused uv so built-in primitives and custom lofted airfoils merge cleanly.
  if (nonIndexed.getAttribute('uv')) nonIndexed.deleteAttribute('uv');
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

/** Loft a smooth swept tapered airfoil surface across spanwise cross-sections (used for B787-8 wings & tail). */
function buildLoftedAirfoil(
  sections: { x: number; y: number; zLead: number; zTrail: number; thick: number }[],
  rgb: [number, number, number],
  accent = 0,
): THREE.BufferGeometry {
  // 8-point streamlined airfoil ring around each span station
  const profile: [number, number][] = [
    [0.0, 0.0],
    [0.14, 0.48],
    [0.38, 0.56],
    [0.72, 0.34],
    [1.0, 0.0],
    [0.72, -0.22],
    [0.35, -0.34],
    [0.12, -0.26],
  ];
  const m = profile.length;
  const pos: number[] = [];
  const ringPts = sections.map((s) => {
    const chord = s.zLead - s.zTrail;
    return profile.map(([u, v]) => [s.x, s.y + v * s.thick, s.zLead - u * chord] as [number, number, number]);
  });
  const pushTri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  for (let i = 0; i < ringPts.length - 1; i++) {
    const r0 = ringPts[i], r1 = ringPts[i + 1];
    const flip = sections[i + 1].x < sections[i].x;
    for (let k = 0; k < m; k++) {
      const kn = (k + 1) % m;
      if (flip) {
        pushTri(r0[k], r1[kn], r1[k]);
        pushTri(r0[k], r0[kn], r1[kn]);
      } else {
        pushTri(r0[k], r1[k], r1[kn]);
        pushTri(r0[k], r1[kn], r0[kn]);
      }
    }
  }
  // Cap outer wingtip cleanly
  const tip = ringPts[ringPts.length - 1];
  const flipTip = sections[sections.length - 1].x < sections[0].x;
  for (let k = 1; k < m - 1; k++) {
    if (flipTip) pushTri(tip[0], tip[k + 1], tip[k]);
    else pushTri(tip[0], tip[k], tip[k + 1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return paintGeometry(geo, rgb, accent);
}

/** Build a smooth swept vertical stabilizer (tailfin) lofted along Y. */
function buildVerticalTail(
  sections: { y: number; zLead: number; zTrail: number; halfThick: number }[],
  rgb: [number, number, number],
  accent = 1,
): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0.0, 0.0],
    [0.20, 0.95],
    [0.52, 1.0],
    [0.82, 0.55],
    [1.0, 0.0],
    [0.82, -0.55],
    [0.52, -1.0],
    [0.20, -0.95],
  ];
  const m = profile.length;
  const pos: number[] = [];
  const ringPts = sections.map((s) => {
    const chord = s.zLead - s.zTrail;
    return profile.map(([u, v]) => [v * s.halfThick, s.y, s.zLead - u * chord] as [number, number, number]);
  });
  const pushTri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  for (let i = 0; i < ringPts.length - 1; i++) {
    const r0 = ringPts[i], r1 = ringPts[i + 1];
    for (let k = 0; k < m; k++) {
      const kn = (k + 1) % m;
      pushTri(r0[k], r1[kn], r1[k]);
      pushTri(r0[k], r0[kn], r1[kn]);
    }
  }
  const tip = ringPts[ringPts.length - 1];
  for (let k = 1; k < m - 1; k++) pushTri(tip[0], tip[k], tip[k + 1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return paintGeometry(geo, rgb, accent);
}

/**
 * True-proportion Boeing 787-8 Dreamliner geometry (56.7 m length, 60.1 m wingspan, 16.9 m tail height):
 * smooth ogive nose & 4-pane wrap-around cockpit glass, elliptical fuselage with passenger window belt,
 * tapered swept supercritical wings with signature curved dihedral flex & raked wingtips,
 * twin GEnx high-bypass turbofans on sculpted pylons, and swept vertical/horizontal stabilizers.
 */
function buildAirlinerGeometry(): THREE.BufferGeometry {
  const white: [number, number, number] = [0.88, 0.90, 0.92];
  const belly: [number, number, number] = [0.64, 0.68, 0.72];
  const wingSilver: [number, number, number] = [0.78, 0.80, 0.83];
  const cockpit: [number, number, number] = [0.06, 0.09, 0.14];
  const windowBand: [number, number, number] = [0.16, 0.21, 0.27];
  const intakeLip: [number, number, number] = [0.76, 0.79, 0.82];
  const fanDark: [number, number, number] = [0.12, 0.14, 0.17];
  const exhaustDark: [number, number, number] = [0.24, 0.26, 0.29];

  const parts: THREE.BufferGeometry[] = [];

  // 1. Sculpted Boeing 787-8 Fuselage (z = -28.4 tail tip .. +28.3 nose tip, diameter ~5.76 m)
  // Profile points [z, radius, yCenterOffset]
  const fuseProfile: [number, number, number][] = [
    [28.3, 0.04, -0.62],
    [27.6, 0.72, -0.58],
    [26.2, 1.48, -0.45],
    [24.2, 2.15, -0.26],
    [21.6, 2.66, -0.08],
    [18.2, 2.88, 0.0],
    [10.0, 2.88, 0.0],
    [-8.5, 2.88, 0.0],
    [-14.5, 2.66, 0.18],
    [-20.5, 2.02, 0.56],
    [-25.2, 1.12, 0.96],
    [-28.4, 0.34, 1.24],
  ];
  const radSegs = 16;
  const fPos: number[] = [];
  const fCol: number[] = [];
  const fAcc: number[] = [];
  const ringVerts = fuseProfile.map(([z, r, yc]) => {
    const pts: [number, number, number, number][] = [];
    for (let k = 0; k < radSegs; k++) {
      const a = (k / radSegs) * Math.PI * 2;
      // Slightly taller oval cross-section (Boeing 787 double-bubble cabin)
      const x = Math.cos(a) * r;
      const y = yc + Math.sin(a) * r * 1.04;
      pts.push([x, y, z, Math.sin(a)]);
    }
    return pts;
  });
  for (let i = 0; i < ringVerts.length - 1; i++) {
    const zMid = 0.5 * (fuseProfile[i][0] + fuseProfile[i + 1][0]);
    const r0 = ringVerts[i], r1 = ringVerts[i + 1];
    for (let k = 0; k < radSegs; k++) {
      const kn = (k + 1) % radSegs;
      const a0 = r0[k], a1 = r0[kn], b0 = r1[k], b1 = r1[kn];
      const sinAvg = 0.25 * (a0[3] + a1[3] + b0[3] + b1[3]);
      // Shade belly subtly darker grey-blue, crisp passenger window belt along cabin sides, and cockpit glass on nose forehead
      let rgb: [number, number, number] = white;
      let acc = 0;
      if (zMid > 21.5 && zMid < 25.4 && sinAvg > 0.18 && sinAvg < 0.72) {
        rgb = cockpit;
      } else if (zMid > -15.5 && zMid < 20.5 && sinAvg > 0.08 && sinAvg < 0.34) {
        rgb = windowBand;
      } else if (zMid > -17.0 && zMid < 21.5 && sinAvg > -0.14 && sinAvg <= 0.08) {
        rgb = white;
        acc = 0.72; // Sleek airline cheatline along fuselage waist
      } else if (sinAvg < -0.35) {
        rgb = belly;
      }
      for (const v of [a0, b0, b1, a0, b1, a1]) {
        fPos.push(v[0], v[1], v[2]);
        fCol.push(rgb[0], rgb[1], rgb[2]);
        fAcc.push(acc);
      }
    }
  }
  const fuseGeo = new THREE.BufferGeometry();
  fuseGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  fuseGeo.setAttribute('aPartColor', new THREE.Float32BufferAttribute(fCol, 3));
  fuseGeo.setAttribute('aAccent', new THREE.Float32BufferAttribute(fAcc, 1));
  fuseGeo.computeVertexNormals();
  parts.push(fuseGeo);

  // Wing-to-body aerodynamic belly fairing
  const fairing = new THREE.SphereGeometry(3.2, 12, 8);
  fairing.scale(1.08, 0.56, 3.6);
  fairing.translate(0, -1.85, 0.5);
  parts.push(paintGeometry(fairing, belly));

  // 2. Signature Boeing 787-8 Supercritical Tapered Swept Wings with Upward Flex & Raked Wingtips (60.1 m span!)
  for (const side of [-1, 1]) {
    parts.push(buildLoftedAirfoil([
      { x: side * 2.2, y: -1.45, zLead: 7.4, zTrail: -4.2, thick: 1.45 },
      { x: side * 7.8, y: -0.95, zLead: 4.9, zTrail: -4.4, thick: 1.05 },
      { x: side * 15.2, y: -0.05, zLead: 1.1, zTrail: -5.4, thick: 0.70 },
      { x: side * 23.0, y: 1.25, zLead: -3.2, zTrail: -7.5, thick: 0.44 },
      { x: side * 27.6, y: 2.35, zLead: -6.2, zTrail: -9.1, thick: 0.28 },
      // Iconic 787 strongly swept-back raked wingtip (replaces boxy winglet!)
      { x: side * 30.05, y: 3.15, zLead: -9.2, zTrail: -10.3, thick: 0.14 },
    ], wingSilver));

    // 3. Twin GEnx / Trent 1000 High-Bypass Turbofan Engines on Sculpted Pylons
    const ex = side * 9.8, ey = -2.25, ez = 4.6;
    // Aerodynamic engine pylon linking nacelle cleanly into wing leading edge
    const pylon = new THREE.BoxGeometry(0.68, 2.05, 5.2);
    pylon.translate(ex, ey + 1.15, ez - 1.6);
    parts.push(paintGeometry(pylon, wingSilver));

    // Outer streamlined white fan cowling
    const cowl = new THREE.CylinderGeometry(1.52, 1.62, 4.3, 14);
    cowl.rotateX(Math.PI / 2);
    cowl.translate(ex, ey, ez);
    parts.push(paintGeometry(cowl, white));

    // Metallic silver intake lip ring
    const lip = new THREE.CylinderGeometry(1.44, 1.54, 0.72, 14);
    lip.rotateX(Math.PI / 2);
    lip.translate(ex, ey, ez + 2.35);
    parts.push(paintGeometry(lip, intakeLip));

    // Dark recessed fan face inside intake
    const fan = new THREE.CylinderGeometry(1.36, 1.36, 0.22, 14);
    fan.rotateX(Math.PI / 2);
    fan.translate(ex, ey, ez + 2.15);
    parts.push(paintGeometry(fan, fanDark));

    // Tapered rear core exhaust nozzle + plug (chevron silhouette)
    const nozzle = new THREE.CylinderGeometry(1.12, 0.68, 2.3, 12);
    nozzle.rotateX(Math.PI / 2);
    nozzle.translate(ex, ey, ez - 2.9);
    parts.push(paintGeometry(nozzle, exhaustDark));

    // 4. Swept Tapered Horizontal Stabilizers (20.2 m span)
    parts.push(buildLoftedAirfoil([
      { x: side * 0.9, y: 1.05, zLead: -19.8, zTrail: -25.4, thick: 0.56 },
      { x: side * 5.6, y: 1.55, zLead: -22.6, zTrail: -26.5, thick: 0.34 },
      { x: side * 10.1, y: 2.10, zLead: -25.8, zTrail: -27.8, thick: 0.16 },
    ], wingSilver));
  }

  // 5. Sculpted Swept Vertical Stabilizer (Tailfin, 16.9 m total height, painted in airline livery!)
  parts.push(buildVerticalTail([
    { y: 1.4, zLead: -16.8, zTrail: -26.2, halfThick: 0.54 },
    { y: 3.4, zLead: -19.2, zTrail: -26.6, halfThick: 0.44 },
    { y: 7.8, zLead: -22.4, zTrail: -27.8, halfThick: 0.32 },
    { y: 12.6, zLead: -25.8, zTrail: -29.2, halfThick: 0.20 },
    { y: 13.8, zLead: -26.7, zTrail: -29.4, halfThick: 0.12 },
  ], white, 1.0));

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
  const bladeCol: [number, number, number] = [0.15, 0.16, 0.18];
  const tipCol: [number, number, number] = [0.78, 0.68, 0.18];
  const hubCol: [number, number, number] = [0.22, 0.24, 0.27];
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.CylinderGeometry(0.55, 0.62, 0.32, 8);
  parts.push(paintGeometry(hub, hubCol));
  // 4 slender dark composite blades with subtle yellow safety tips
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const blade = new THREE.BoxGeometry(0.34, 0.06, 6.8);
    blade.translate(0, 0, 3.6);
    blade.rotateY(angle);
    parts.push(paintGeometry(blade, bladeCol));

    const tip = new THREE.BoxGeometry(0.35, 0.065, 0.85);
    tip.translate(0, 0, 7.42);
    tip.rotateY(angle);
    parts.push(paintGeometry(tip, tipCol));
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

function buildTailRotorGeometry(): THREE.BufferGeometry {
  const bladeCol: [number, number, number] = [0.18, 0.19, 0.21];
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.BoxGeometry(0.08, 2.2, 0.24);
    blade.rotateX((i * Math.PI) / 2);
    parts.push(paintGeometry(blade, bladeCol));
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

  const tailRotorGeo = buildTailRotorGeometry();
  const tailRotorOpacity = new THREE.InstancedBufferAttribute(new Float32Array(HELICOPTER_FLIGHTS.length), 1);
  const tailRotorLivery = new THREE.InstancedBufferAttribute(new Float32Array(HELICOPTER_FLIGHTS.length * 3), 3);
  HELICOPTER_FLIGHTS.forEach((_, i) => {
    tailRotorOpacity.setX(i, 0.78);
    tailRotorLivery.setXYZ(i, 0.2, 0.2, 0.2);
  });
  tailRotorGeo.setAttribute('iOpacity', tailRotorOpacity);
  tailRotorGeo.setAttribute('iLivery', tailRotorLivery);
  const tailRotorMesh = new THREE.InstancedMesh(tailRotorGeo, heliMat, HELICOPTER_FLIGHTS.length);
  tailRotorMesh.name = 'kansai-helicopter-tail-rotors';
  tailRotorMesh.frustumCulled = false;
  group.add(tailRotorMesh);

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
  const localVec = new THREE.Vector3();
  // Local-space rotor transforms composed directly onto the helicopter body matrix so the rotor
  // spins cleanly around the mast axis without YXZ Euler precession wobble.
  const mainHubTrans = new THREE.Matrix4().makeTranslation(0, 5.45, 0.8);
  const tailHubTrans = new THREE.Matrix4().makeTranslation(0.45, 3.15, -11.0);
  const spinMat = new THREE.Matrix4();
  const rotorMat = new THREE.Matrix4();
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
      // In Three.js YXZ order (+Z forward, +Y up, +X port/left):
      // -p.pitch lifts +Z nose upward; +p.roll lifts +X port wing & drops -X starboard wing (banking right).
      dummy.rotation.set(-p.pitch, p.yaw, p.roll);
      dummy.scale.setScalar(flight.scale);
      dummy.updateMatrix();
      airlinerMesh.setMatrixAt(i, dummy.matrix);
      airlinerOpacity.setX(i, p.opacity);

      const strobe = Math.sin(elapsed * 5.2 + i * 1.7) > 0.82 ? 1.8 : 0.25;
      const beacon = Math.sin(elapsed * 3.1 + i * 2.3) > 0.65 ? 1.5 : 0.15;

      // Port red wingtip (B787-8 raked wingtip at +30.0, +3.1, -9.6)
      localVec.set(29.8, 3.1, -9.6).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 4.2 * flight.scale, p.opacity * nightBoost);
      // Starboard green wingtip
      localVec.set(-29.8, 3.1, -9.6).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 4.2 * flight.scale, p.opacity * nightBoost);
      // Nose landing light (bright even by day on approach/takeoff!) + white strobe
      localVec.set(0, -1.5, 24.5).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, (4.4 + 5.2 * p.landingLights) * flight.scale, p.opacity * Math.max(p.landingLights * 0.95, strobe * nightBoost));
      // Red anti-collision beacon atop center fuselage
      localVec.set(0, 3.2, 2.0).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 4.6 * flight.scale, p.opacity * beacon * nightBoost);
    });

    HELICOPTER_FLIGHTS.forEach((flight, i) => {
      const p = helicopterPose(flight, elapsed, ground);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(-p.pitch, p.yaw, p.roll);
      dummy.scale.setScalar(1.35);
      dummy.updateMatrix();
      heliMesh.setMatrixAt(i, dummy.matrix);

      // Compose main & tail rotors strictly in helicopter local coordinates (zero wobble!)
      spinMat.makeRotationY(p.rotorPhase);
      rotorMat.copy(dummy.matrix).multiply(mainHubTrans).multiply(spinMat);
      rotorMesh.setMatrixAt(i, rotorMat);

      spinMat.makeRotationX(p.rotorPhase * 2.3);
      rotorMat.copy(dummy.matrix).multiply(tailHubTrans).multiply(spinMat);
      tailRotorMesh.setMatrixAt(i, rotorMat);

      const strobe = Math.sin(elapsed * 4.4 + i * 1.9) > 0.72 ? 1.6 : 0.2;
      localVec.set(0, 1.2, 5.2).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 4.2, Math.max(p.landingLights * 0.85, nightBoost * 0.6));
      localVec.set(0, 4.2, -10.8).applyMatrix4(dummy.matrix);
      setLight(idx++, localVec, 3.4, strobe * nightBoost);
    });

    airlinerMesh.instanceMatrix.needsUpdate = airlinerOpacity.needsUpdate = true;
    heliMesh.instanceMatrix.needsUpdate = true;
    rotorMesh.instanceMatrix.needsUpdate = true;
    tailRotorMesh.instanceMatrix.needsUpdate = true;
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
