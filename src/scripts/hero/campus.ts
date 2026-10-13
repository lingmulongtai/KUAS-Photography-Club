import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { CAMPUS_OUTLINE, inCampus } from './geo';
import { CLASS, type BoxBuilding, type PolyBuilding } from './buildings-data';
import { rng } from './util';

/*
 * The Uzumasa campus up close. PLATEAU only has plain blocks for these buildings, so they are
 * rebuilt from their real footprints and heights with architectural detail: white spandrels and
 * recessed glass bands floor by floor, parapets with a teal coping, rooftop plant, a paved plaza
 * and trees along the edge. Shown only when the camera is at the campus.
 */

/** Campus buildings that get the detailed model (the plain block is hidden while it shows). */
export function isDetailed(kind: number, h: number, x: number, z: number) {
  return (kind & 3) === CLASS.sturdy && h >= 9 && inCampus(x, z);
}

const MAT = { spandrel: 0, glass: 1, reveal: 2, roof: 3, plant: 4, coping: 5, paving: 6 };

function ringOfBox(b: BoxBuilding) {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const hw = b.w / 2;
  const hd = b.d / 2;
  const pts: [number, number][] = [
    [b.x - c * hw + s * hd, b.z - s * hw - c * hd],
    [b.x + c * hw + s * hd, b.z + s * hw - c * hd],
    [b.x + c * hw - s * hd, b.z + s * hw + c * hd],
    [b.x - c * hw - s * hd, b.z - s * hw + c * hd],
  ];
  return pts;
}

export function buildCampus(env: Env, hf: Heightfield, data: { boxes: BoxBuilding[]; polys: PolyBuilding[] }) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const mat: number[] = [];
  const cell: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], m: number, u0 = 0, u1 = 0, v0 = 0, v1 = 0) => {
    // a b c d counter-clockwise seen from outside; uv cells for the window grid
    const verts = [a, b, c, a, c, d];
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const flip = (ab[1] * ac[2] - ab[2] * ac[1]) * n[0] + (ab[2] * ac[0] - ab[0] * ac[2]) * n[1] + (ab[0] * ac[1] - ab[1] * ac[0]) * n[2] < 0;
    const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
    for (const k of order) {
      pos.push(...verts[k]);
      nrm.push(...n);
      mat.push(m);
      cell.push(...uvs[k]);
    }
  };

  const r = rng(306);
  const footprints: { ring: [number, number][]; h: number; y: number }[] = [];
  for (const b of data.boxes) if (isDetailed(b.kind, b.h, b.x, b.z)) footprints.push({ ring: ringOfBox(b), h: b.h, y: hf.height(b.x, b.z) + b.ground });
  for (const p of data.polys) {
    const ring: [number, number][] = [];
    for (let i = 0; i < p.ring.length; i += 2) ring.push([p.ring[i], p.ring[i + 1]]);
    const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length;
    const cz = ring.reduce((s, q) => s + q[1], 0) / ring.length;
    if (isDetailed(p.kind, p.h, cx, cz)) footprints.push({ ring, h: p.h, y: hf.height(cx, cz) + p.ground });
  }

  for (const f of footprints) {
    const ring = f.ring;
    const m = ring.length;
    let area = 0;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      area += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    const out = area >= 0 ? 1 : -1;
    const top = f.y + f.h;
    const floors = Math.max(2, Math.round((f.h - 1.2) / 3.9));
    const fh = (f.h - 1.2) / floors;
    const inset = 0.32;
    let along = 0;
    for (let i = 0; i < m; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % m];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const nx = (out * (bz - az)) / len;
      const nz = (-out * (bx - ax)) / len;
      const n = [nx, 0, nz];
      const ix = -nx * inset;
      const iz = -nz * inset;
      const u0 = along;
      const u1 = along + len;
      // base below ground
      quad([ax, f.y - 4, az], [bx, f.y - 4, bz], [bx, f.y, bz], [ax, f.y, az], n, MAT.spandrel);
      for (let k = 0; k < floors; k++) {
        const y0 = f.y + k * fh;
        const spandrelTop = y0 + (k === 0 ? 0.35 : fh * 0.36);
        const glassTop = y0 + fh;
        quad([ax, y0, az], [bx, y0, bz], [bx, spandrelTop, bz], [ax, spandrelTop, az], n, MAT.spandrel);
        // recessed glass with its sill and head
        quad([ax + ix, spandrelTop, az + iz], [bx + ix, spandrelTop, bz + iz], [bx + ix, glassTop, bz + iz], [ax + ix, glassTop, az + iz], n, MAT.glass, u0, u1, k, k + 1);
        quad([ax, spandrelTop, az], [bx, spandrelTop, bz], [bx + ix, spandrelTop, bz + iz], [ax + ix, spandrelTop, az + iz], [0, 1, 0], MAT.reveal);
        quad([ax + ix, glassTop, az + iz], [bx + ix, glassTop, bz + iz], [bx, glassTop, bz], [ax, glassTop, az], [0, -1, 0], MAT.reveal);
      }
      // parapet with a teal coping
      const py = f.y + floors * fh;
      quad([ax, py, az], [bx, py, bz], [bx, top, bz], [ax, top, az], n, MAT.spandrel);
      quad([ax, top, az], [bx, top, bz], [bx + ix * 1.5, top, bz + iz * 1.5], [ax + ix * 1.5, top, az + iz * 1.5], [0, 1, 0], MAT.coping);
      along = u1;
    }
    // roof slab, just below the parapet top
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const [a, b, c] = t.map((k) => contour[k]);
      const y = top - 1;
      const tri = [[a.x, y, a.y], [b.x, y, b.y], [c.x, y, c.y]];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      for (const v of cross < 0 ? tri : [tri[0], tri[2], tri[1]]) {
        pos.push(...v);
        nrm.push(0, 1, 0);
        mat.push(MAT.roof);
        cell.push(v[0], v[2]);
      }
    }
    // rooftop plant: a few boxes near the middle
    const cx = ring.reduce((s, q) => s + q[0], 0) / m;
    const cz = ring.reduce((s, q) => s + q[1], 0) / m;
    for (let k = 0; k < 3; k++) {
      const w = 3 + r() * 5;
      const d = 2.5 + r() * 4;
      const h = 1.6 + r() * 2;
      const x = cx + (r() - 0.5) * 10;
      const z = cz + (r() - 0.5) * 10;
      const y = top - 1;
      const c = [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]];
      for (let e = 0; e < 4; e++) {
        const [p0, p1] = [c[e], c[(e + 1) % 4]];
        const ex = p1[0] - p0[0], ez = p1[1] - p0[1];
        const l = Math.hypot(ex, ez);
        quad([p0[0], y, p0[1]], [p1[0], y, p1[1]], [p1[0], y + h, p1[1]], [p0[0], y + h, p0[1]], [ez / l, 0, -ex / l], MAT.plant);
      }
      quad([c[0][0], y + h, c[0][1]], [c[3][0], y + h, c[3][1]], [c[2][0], y + h, c[2][1]], [c[1][0], y + h, c[1][1]], [0, 1, 0], MAT.plant);
    }
  }

  // the plaza: the campus outline, paved
  const plaza = CAMPUS_OUTLINE.map(([x, z]) => new THREE.Vector2(x, z));
  for (const t of THREE.ShapeUtils.triangulateShape(plaza, [])) {
    const [a, b, c] = t.map((k) => plaza[k]);
    const tri = [a, b, c].map((p) => [p.x, hf.height(p.x, p.y) + 0.25, p.y]);
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (const v of cross < 0 ? tri : [tri[0], tri[2], tri[1]]) {
      pos.push(...v);
      nrm.push(0, 1, 0);
      mat.push(MAT.paving);
      cell.push(v[0], v[2]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
  geo.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 2));
  geo.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader: /* glsl */ `
      attribute float aMat;
      attribute vec2 aCell;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vMat;
      varying vec2 vCell;
      void main(){
        vWorld = position;
        vNormal = normal;
        vMat = aMat;
        vCell = aCell;
        vec3 p = position;
        // the plaza sits on the ground: pull it toward the camera so the terrain never covers it
        if (aMat > 5.5){ vec3 toCam = cameraPosition - p; float d = length(toCam); p += toCam / d * min(d * .003, 6.); }
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vMat;
      varying vec2 vCell;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 v = normalize(vWorld - cameraPosition);
        int m = int(vMat + .5);
        vec3 albedo = vec3(.62, .63, .62);
        vec3 emit = vec3(0.);
        if (m == 1){
          // glass: mullions every 1.6 m, sky reflection by day, lit rooms at night
          float u = vCell.x / 1.6;
          float mull = smoothstep(.0, .06, fract(u)) * smoothstep(1., .94, fract(u));
          vec2 id = vec2(floor(u), floor(vCell.y));
          float fres = .06 + .7 * pow(1. - max(dot(-v, n), 0.), 4.);
          vec3 refl = skyColor(reflect(v, n));
          albedo = mix(vec3(.5), vec3(.02, .03, .035), mull);
          emit += refl * fres * mull * .9;
          float lit = step(hash12(id + 3.1), .5);
          emit += vec3(1., .9, .76) * lit * mull * .9 * uCity;
        } else if (m == 2) albedo = vec3(.55, .56, .56);
        else if (m == 3) albedo = vec3(.3, .31, .31) * (.85 + .3 * vnoise(vCell * .3));
        else if (m == 4) albedo = vec3(.42, .43, .43);
        else if (m == 5){ albedo = vec3(.5, .78, .8); emit += vec3(.39, .86, .9) * (.4 + 1.6 * uCity); }
        else if (m == 6){
          // paving: big light slabs with fine joints
          vec2 g = fract(vCell / 3.);
          float joint = smoothstep(.0, .03, g.x) * smoothstep(.0, .03, g.y);
          albedo = vec3(.44, .43, .41) * (.85 + .15 * joint) * (.9 + .2 * vnoise(vCell * .2));
        }
        float sh = dot(n, uSunDir) > 0. ? sunShadow(vWorld, n) : 1.;
        vec3 col = shade(albedo, n, vWorld, sh);
        gl_FragColor = vec4(applyHaze(col, emit * uHighlight, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.visible = false;
  return { mesh, count: footprints.length };
}

/** Trees along the inside of the campus edge, as tree positions for the forest layer. */
export function campusTreeSpots(hf: Heightfield) {
  const spots: { x: number; y: number; z: number }[] = [];
  const p = CAMPUS_OUTLINE;
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[(i + 1) % p.length];
    const len = Math.hypot(bx - ax, bz - az);
    for (let t = 4; t < len - 4; t += 9) {
      const x = ax + ((bx - ax) * t) / len;
      const z = az + ((bz - az) * t) / len;
      // step a few metres inward toward the middle
      const ix = x + (-3755 - x) * 0.04;
      const iz = z + (-700 - z) * 0.04;
      spots.push({ x: ix, y: hf.height(ix, iz), z: iz });
    }
  }
  return spots;
}
