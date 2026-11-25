import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { toLocal } from './geo';

interface LakeBridgeSpec {
  name: string;
  west: [number, number]; // [lat, lon]
  east: [number, number]; // [lat, lon]
  width: number;
  baseY: number;
  approachH: number;
  archPeakH: number;
  archCenterT: number;
  archWidthT: number;
  pierCount: number;
}

/** Surveyed spans for Lake Biwa's two iconic cross-lake bridges so they remain visible from 20–35 km away. */
const LAKE_BRIDGES: readonly LakeBridgeSpec[] = [
  {
    name: 'omi-ohashi',
    // 近江大橋: Otsu (west) to Kusatsu (east), ~1.29 km across southern Lake Biwa.
    west: [35.0029, 135.8934],
    east: [35.0079, 135.9074],
    width: 17,
    baseY: 85.0,
    approachH: 6.2,
    archPeakH: 18.5,
    archCenterT: 0.42,
    archWidthT: 0.24,
    pierCount: 16,
  },
  {
    name: 'biwako-ohashi',
    // 琵琶湖大橋: Katata (west) to Moriyama (east), ~1.40 km arched main span rising 26.3 m above the lake.
    west: [35.1200, 135.9272],
    east: [35.1180, 135.9438],
    width: 15,
    baseY: 85.0,
    approachH: 6.8,
    archPeakH: 26.3,
    archCenterT: 0.34,
    archWidthT: 0.22,
    pierCount: 18,
  },
];

function pushBox(
  pos: number[],
  nrm: number[],
  col: number[],
  emit: number[],
  p0: [number, number, number],
  p1: [number, number, number],
  nx: number,
  nz: number,
  halfW: number,
  depth: number,
  rgb: [number, number, number],
  emissive = 0,
) {
  const [ax, ay, az] = p0;
  const [bx, by, bz] = p1;
  const rx = nx * halfW, rz = nz * halfW;
  const tl0: [number, number, number] = [ax - rx, ay, az - rz];
  const tr0: [number, number, number] = [ax + rx, ay, az + rz];
  const tl1: [number, number, number] = [bx - rx, by, bz - rz];
  const tr1: [number, number, number] = [bx + rx, by, bz + rz];
  const bl0: [number, number, number] = [ax - rx, ay - depth, az - rz];
  const br0: [number, number, number] = [ax + rx, ay - depth, az + rz];
  const bl1: [number, number, number] = [bx - rx, by - depth, bz - rz];
  const br1: [number, number, number] = [bx + rx, by - depth, bz + rz];

  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    n: [number, number, number],
    faceRgb: [number, number, number],
    faceEmit: number,
  ) => {
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(n[0], n[1], n[2]);
      col.push(faceRgb[0], faceRgb[1], faceRgb[2]);
      emit.push(faceEmit);
    }
  };

  // Top deck
  quad(tl0, tr0, tr1, tl1, [0, 1, 0], rgb, emissive);
  // Two vertical sides
  const sideRgb: [number, number, number] = [rgb[0] * 0.92, rgb[1] * 0.92, rgb[2] * 0.92];
  quad(tr0, br0, br1, tr1, [nx, 0, nz], sideRgb, 0);
  quad(tl1, bl1, bl0, tl0, [-nx, 0, -nz], sideRgb, 0);
}

/** Build persistent distant-visible 3D arched bridges for Omi Ohashi and Biwako Ohashi. */
export function buildBiwaBridges(env: Env): THREE.Mesh {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const emit: number[] = [];

  const roadCol: [number, number, number] = [0.22, 0.23, 0.24];
  const girderCol: [number, number, number] = [0.58, 0.59, 0.57];
  const pierCol: [number, number, number] = [0.46, 0.47, 0.45];

  for (const b of LAKE_BRIDGES) {
    const w = toLocal(b.west[0], b.west[1]);
    const e = toLocal(b.east[0], b.east[1]);
    const dx = e.x - w.x, dz = e.z - w.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const nx = -uz, nz = ux;
    const steps = 28;
    const deckY = (t: number) => {
      // Smooth touchdown at both shores plus arched main shipping channel.
      const endFade = Math.sin(Math.min(1, t / 0.12) * Math.PI * 0.5) * Math.sin(Math.min(1, (1 - t) / 0.12) * Math.PI * 0.5);
      const u = (t - b.archCenterT) / b.archWidthT;
      const arch = Math.exp(-u * u * 1.45);
      return b.baseY + 1.8 + (b.approachH - 1.8) * endFade + (b.archPeakH - b.approachH) * arch;
    };

    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const p0: [number, number, number] = [w.x + dx * t0, deckY(t0), w.z + dz * t0];
      const p1: [number, number, number] = [w.x + dx * t1, deckY(t1), w.z + dz * t1];
      // Main roadway slab + lighter steel/concrete side fascia & subtle night deck strip
      pushBox(pos, nrm, col, emit, p0, p1, nx, nz, b.width * 0.5, 2.2, roadCol, 0.35);
      // Raised pale parapets on both edges so the bridge silhouette reads cleanly from across Lake Biwa.
      const edgeOff = b.width * 0.5 - 0.55;
      for (const side of [-1, 1]) {
        const q0: [number, number, number] = [p0[0] + nx * edgeOff * side, p0[1] + 1.15, p0[2] + nz * edgeOff * side];
        const q1: [number, number, number] = [p1[0] + nx * edgeOff * side, p1[1] + 1.15, p1[2] + nz * edgeOff * side];
        pushBox(pos, nrm, col, emit, q0, q1, nx, nz, 0.65, 1.4, girderCol, 0.55);
      }
    }

    // Concrete piers descending cleanly into Lake Biwa.
    for (let i = 1; i < b.pierCount; i++) {
      const t = i / b.pierCount;
      const topY = deckY(t) - 2.0;
      const cx = w.x + dx * t, cz = w.z + dz * t;
      const pierLen = 3.2;
      const p0: [number, number, number] = [cx - ux * pierLen * 0.5, topY, cz - uz * pierLen * 0.5];
      const p1: [number, number, number] = [cx + ux * pierLen * 0.5, topY, cz + uz * pierLen * 0.5];
      pushBox(pos, nrm, col, emit, p0, p1, nx, nz, b.width * 0.36, Math.max(2, topY - (b.baseY - 3)), pierCol, 0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('aEmit', new THREE.Float32BufferAttribute(emit, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aEmit;
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = aColor;
        vEmit = aEmit;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 lit = shade(seasonalSurface(vColor, n, vWorld), n, vWorld, 1.);
        // Subtle warm bridge streetlamp ribbon along the span at night.
        float lamp = .55 + .45 * sin((vWorld.x + vWorld.z) * .16);
        vec3 emit = vec3(1., .76, .46) * vEmit * lamp * .45 * uCity;
        gl_FragColor = vec4(applyHaze(lit, emit, vWorld), 1.);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'biwa-bridges';
  return mesh;
}
