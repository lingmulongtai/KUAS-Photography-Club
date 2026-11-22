import * as THREE from 'three';

/**
 * Tileable 3D Perlin-Worley + multi-octave Worley FBM volume texture for volumetric clouds.
 * One hardware trilinear lookup provides four octaves of billowing cumulus structure:
 *   R: Perlin-Worley base shape (smooth rounded domes with cellular pockets)
 *   G: Worley FBM low-mid frequency (main cauliflower lobes)
 *   B: Worley FBM mid-high frequency (secondary puffed heads)
 *   A: Worley high frequency (fine wispy edge erosion)
 */
const SIZE = 48;

function buildWorleyGrid(period: number, seed: number) {
  const count = period * period * period;
  const pts = new Float32Array(count * 3);
  const s = Math.imul(seed, 1274126177);
  for (let z = 0; z < period; z++) {
    const hz = Math.imul(z, 2147483647) ^ s;
    for (let y = 0; y < period; y++) {
      const hy = Math.imul(y, 668265263) ^ hz;
      for (let x = 0; x < period; x++) {
        let h = (Math.imul(x, 374761393) ^ hy) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        const rx = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
        h = Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0;
        const ry = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
        h = Math.imul(h ^ 0x85ebca6b, 3266489917) >>> 0;
        const rz = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
        const i = ((z * period + y) * period + x) * 3;
        pts[i] = x + 0.12 + rx * 0.76;
        pts[i + 1] = y + 0.12 + ry * 0.76;
        pts[i + 2] = z + 0.12 + rz * 0.76;
      }
    }
  }
  return pts;
}

function worleyField(size: number, period: number, seed: number) {
  const pts = buildWorleyGrid(period, seed);
  const out = new Float32Array(size * size * size);
  const scale = period / size;
  const p2 = period * period;
  // Precompute neighbor wrap indices and offsets for each voxel coordinate along an axis.
  const wrapIdx = new Int32Array(size * 3);
  const wrapOff = new Int32Array(size * 3);
  const coord = new Float32Array(size);
  for (let v = 0; v < size; v++) {
    const f = (v + 0.5) * scale;
    const c = Math.floor(f);
    coord[v] = f;
    for (let d = -1; d <= 1; d++) {
      const n = ((c + d) % period + period) % period;
      wrapIdx[v * 3 + d + 1] = n;
      wrapOff[v * 3 + d + 1] = c + d - n;
    }
  }
  for (let vz = 0; vz < size; vz++) {
    const fz = coord[vz];
    const zBase = vz * 3;
    const zOut = vz * size * size;
    for (let vy = 0; vy < size; vy++) {
      const fy = coord[vy];
      const yBase = vy * 3;
      const yOut = zOut + vy * size;
      for (let vx = 0; vx < size; vx++) {
        const fx = coord[vx];
        const xBase = vx * 3;
        let minD2 = 9;
        for (let dz = 0; dz < 3; dz++) {
          const nz = wrapIdx[zBase + dz] * p2;
          const oz = wrapOff[zBase + dz] - fz;
          for (let dy = 0; dy < 3; dy++) {
            const ny = (nz + wrapIdx[yBase + dy] * period);
            const oy = wrapOff[yBase + dy] - fy;
            for (let dx = 0; dx < 3; dx++) {
              const i = (ny + wrapIdx[xBase + dx]) * 3;
              const px = pts[i] + wrapOff[xBase + dx] - fx;
              const py = pts[i + 1] + oy;
              const pz = pts[i + 2] + oz;
              const d2 = px * px + py * py + pz * pz;
              if (d2 < minD2) minD2 = d2;
            }
          }
        }
        // Inverted cellular distance: bright rounded puffy cores (1) and crisp dark creases (0).
        out[yOut + vx] = minD2 >= 1 ? 0 : 1 - minD2;
      }
    }
  }
  return out;
}

function gradField(size: number, period: number, seed: number) {
  const grads = new Float32Array(period * period * period * 3);
  const s = Math.imul(seed, 1274126177);
  for (let z = 0; z < period; z++) {
    const hz = Math.imul(z, 2147483647) ^ s;
    for (let y = 0; y < period; y++) {
      const hy = Math.imul(y, 668265263) ^ hz;
      for (let x = 0; x < period; x++) {
        let h = (Math.imul(x, 374761393) ^ hy) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        const gx = (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
        h = Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0;
        const gy = (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
        h = Math.imul(h ^ 0x85ebca6b, 3266489917) >>> 0;
        const gz = (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
        const inv = 1 / Math.max(1e-5, Math.hypot(gx, gy, gz));
        const i = ((z * period + y) * period + x) * 3;
        grads[i] = gx * inv;
        grads[i + 1] = gy * inv;
        grads[i + 2] = gz * inv;
      }
    }
  }
  const dot = (gx: number, gy: number, gz: number, dx: number, dy: number, dz: number) => {
    const i = ((gz * period + gy) * period + gx) * 3;
    return grads[i] * dx + grads[i + 1] * dy + grads[i + 2] * dz;
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const out = new Float32Array(size * size * size);
  const scale = period / size;
  for (let vz = 0; vz < size; vz++) {
    const fz = (vz + 0.5) * scale;
    const z0 = Math.floor(fz) % period, z1 = (z0 + 1) % period, dz = fz - Math.floor(fz), uz = fade(dz);
    for (let vy = 0; vy < size; vy++) {
      const fy = (vy + 0.5) * scale;
      const y0 = Math.floor(fy) % period, y1 = (y0 + 1) % period, dy = fy - Math.floor(fy), uy = fade(dy);
      for (let vx = 0; vx < size; vx++) {
        const fx = (vx + 0.5) * scale;
        const x0 = Math.floor(fx) % period, x1 = (x0 + 1) % period, dx = fx - Math.floor(fx), ux = fade(dx);
        const n000 = dot(x0, y0, z0, dx, dy, dz);
        const n100 = dot(x1, y0, z0, dx - 1, dy, dz);
        const n010 = dot(x0, y1, z0, dx, dy - 1, dz);
        const n110 = dot(x1, y1, z0, dx - 1, dy - 1, dz);
        const n001 = dot(x0, y0, z1, dx, dy, dz - 1);
        const n101 = dot(x1, y0, z1, dx - 1, dy, dz - 1);
        const n011 = dot(x0, y1, z1, dx, dy - 1, dz - 1);
        const n111 = dot(x1, y1, z1, dx - 1, dy - 1, dz - 1);
        const nx00 = lerp(n000, n100, ux);
        const nx10 = lerp(n010, n110, ux);
        const nx01 = lerp(n001, n101, ux);
        const nx11 = lerp(n011, n111, ux);
        const nxy0 = lerp(nx00, nx10, uy);
        const nxy1 = lerp(nx01, nx11, uy);
        out[(vz * size + vy) * size + vx] = Math.max(0, Math.min(1, lerp(nxy0, nxy1, uz) * 0.7 + 0.5));
      }
    }
  }
  return out;
}

export function generateCloudNoiseData(size = SIZE) {
  const p4 = gradField(size, 4, 11);
  const p8 = gradField(size, 8, 23);
  const w4 = worleyField(size, 4, 37);
  const w8 = worleyField(size, 8, 53);
  const w12 = worleyField(size, 12, 71);
  const w16 = worleyField(size, 16, 97);

  const total = size * size * size;
  const rgba = new Uint8Array(total * 4);
  for (let i = 0; i < total; i++) {
    const perlin = p4[i] * 0.68 + p8[i] * 0.32;
    const lowWorley = w4[i] * 0.625 + w8[i] * 0.25 + w12[i] * 0.125;
    // Remap Perlin by inverted Worley to obtain puffy Perlin-Worley cumulus base shapes.
    const pw = Math.max(0, Math.min(1, (perlin - (1 - lowWorley) * 0.45) / (1 - (1 - lowWorley) * 0.45)));
    const midWorley = w8[i] * 0.65 + w12[i] * 0.25 + w16[i] * 0.10;
    const hiWorley = w12[i] * 0.55 + w16[i] * 0.45;
    const o = i * 4;
    rgba[o] = Math.round(pw * 255);
    rgba[o + 1] = Math.round(lowWorley * 255);
    rgba[o + 2] = Math.round(midWorley * 255);
    rgba[o + 3] = Math.round(hiWorley * 255);
  }
  return rgba;
}

let sharedTexture: THREE.Data3DTexture | undefined;

export function cloudNoiseTexture() {
  if (!sharedTexture) {
    const texture = new THREE.Data3DTexture(generateCloudNoiseData(SIZE), SIZE, SIZE, SIZE);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    sharedTexture = texture;
  }
  return sharedTexture;
}
