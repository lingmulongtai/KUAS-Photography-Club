import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { toLocal } from './geo';

type RGB = [number, number, number];
type GroundFn = (x: number, z: number) => number;

/** Exact surveyed positions of Osaka's signature skyline landmarks. */
export const OSAKA_SKYLINE_SITES = {
  abenoHarukas: { lat: 34.646181, lon: 135.513396, maskRadius: 68 },
  umedaSky: { lat: 34.705244, lon: 135.490177, maskRadius: 74 },
  tsutenkaku: { lat: 34.652540, lon: 135.506305, maskRadius: 28 },
} as const;

const MASK_CIRCLES = Object.values(OSAKA_SKYLINE_SITES).map((s) => {
  const p = toLocal(s.lat, s.lon);
  return { x: p.x, z: p.z, r2: s.maskRadius * s.maskRadius };
});

/** True when a generic skyline/regional building sits inside a bespoke Osaka landmark footprint. */
export function inOsakaLandmarkMask(x: number, z: number): boolean {
  for (const c of MASK_CIRCLES) {
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz < c.r2) return true;
  }
  return false;
}

interface Builder {
  pos: number[];
  nrm: number[];
  col: number[];
  emit: number[];
  glass: number[];
  style: number[]; // 0: plain/solid, 1: curtain-wall tower glass, 2: glowing atrium/observatory, 3: neon/accent band
  lightPos: number[];
  lightCol: number[];
  lightSize: number[];
  lightPhase: number[];
}

function createBuilder(): Builder {
  return { pos: [], nrm: [], col: [], emit: [], glass: [], style: [], lightPos: [], lightCol: [], lightSize: [], lightPhase: [] };
}

function pushQuad(
  b: Builder,
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  n: [number, number, number],
  rgb: RGB,
  em = 0,
  gl = 0,
  st = 0,
) {
  for (const v of [p0, p1, p2, p0, p2, p3]) {
    b.pos.push(v[0], v[1], v[2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.col.push(rgb[0], rgb[1], rgb[2]);
    b.emit.push(em);
    b.glass.push(gl);
    b.style.push(st);
  }
}

function addBox(
  b: Builder,
  ox: number,
  oy: number,
  oz: number,
  rotY: number,
  lx: number,
  ly0: number,
  lz: number,
  sx: number,
  sy: number,
  sz: number,
  rgb: RGB,
  opts?: { topRgb?: RGB; emit?: number; topEmit?: number; glass?: number; style?: number },
) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const pt = (x: number, y: number, z: number): [number, number, number] => [
    ox + (lx + x) * c - (lz + z) * s,
    oy + ly0 + y,
    oz + (lx + x) * s + (lz + z) * c,
  ];
  const nrm = (nx: number, ny: number, nz: number): [number, number, number] => [nx * c - nz * s, ny, nx * s + nz * c];
  const hx = sx * 0.5, hz = sz * 0.5;
  const b00 = pt(-hx, 0, -hz), b10 = pt(hx, 0, -hz), b11 = pt(hx, 0, hz), b01 = pt(-hx, 0, hz);
  const t00 = pt(-hx, sy, -hz), t10 = pt(hx, sy, -hz), t11 = pt(hx, sy, hz), t01 = pt(-hx, sy, hz);
  const em = opts?.emit ?? 0;
  const topEm = opts?.topEmit ?? em * 0.25;
  const gl = opts?.glass ?? 0;
  const st = opts?.style ?? (gl > 0.4 ? 1 : 0);
  const topRgb = opts?.topRgb ?? rgb;

  pushQuad(b, t00, t01, t11, t10, [0, 1, 0], topRgb, topEm, gl * 0.25, st === 2 ? 2 : 0);
  pushQuad(b, b01, b11, t11, t01, nrm(0, 0, 1), rgb, em, gl, st);
  pushQuad(b, b10, b00, t00, t10, nrm(0, 0, -1), rgb, em, gl, st);
  pushQuad(b, b11, b10, t10, t11, nrm(1, 0, 0), [rgb[0] * 0.94, rgb[1] * 0.94, rgb[2] * 0.94], em, gl, st);
  pushQuad(b, b00, b01, t01, t00, nrm(-1, 0, 0), [rgb[0] * 0.94, rgb[1] * 0.94, rgb[2] * 0.94], em, gl, st);
}

/** Add a diagonal glass escalator tube (iconic Umeda Sky Building crossed escalators!). */
function addBeam(
  b: Builder,
  a: [number, number, number],
  c: [number, number, number],
  width: number,
  height: number,
  rgb: RGB,
  em = 0.8,
  gl = 0.75,
) {
  const dx = c[0] - a[0], dz = c[2] - a[2];
  const hLen = Math.hypot(dx, dz) || 1;
  const rx = (-dz / hLen) * (width * 0.5), rz = (dx / hLen) * (width * 0.5);
  const hh = height * 0.5;
  const a0: [number, number, number] = [a[0] - rx, a[1] - hh, a[2] - rz];
  const a1: [number, number, number] = [a[0] + rx, a[1] - hh, a[2] + rz];
  const a2: [number, number, number] = [a[0] + rx, a[1] + hh, a[2] + rz];
  const a3: [number, number, number] = [a[0] - rx, a[1] + hh, a[2] - rz];
  const c0: [number, number, number] = [c[0] - rx, c[1] - hh, c[2] - rz];
  const c1: [number, number, number] = [c[0] + rx, c[1] - hh, c[2] + rz];
  const c2: [number, number, number] = [c[0] + rx, c[1] + hh, c[2] + rz];
  const c3: [number, number, number] = [c[0] - rx, c[1] + hh, c[2] - rz];
  const nx = -dz / hLen, nz = dx / hLen;
  pushQuad(b, a3, a2, c2, c3, [0, 1, 0], rgb, em, gl, 2);
  pushQuad(b, a1, c1, c2, a2, [nx, 0, nz], rgb, em, gl, 2);
  pushQuad(b, c0, a0, a3, c3, [-nx, 0, -nz], rgb, em, gl, 2);
  pushQuad(b, a0, c0, c1, a1, [0, -1, 0], rgb, em * 0.7, gl, 2);
}

function addLight(b: Builder, p: [number, number, number], rgb: RGB, size: number, phase = 0) {
  b.lightPos.push(p[0], p[1], p[2]);
  b.lightCol.push(rgb[0], rgb[1], rgb[2]);
  b.lightSize.push(size);
  b.lightPhase.push(phase);
}

/**
 * Build bespoke high-detail 3D models for Osaka's signature skyline icons:
 * - あべのハルカス (Abeno Harukas, 300 m)
 * - 梅田スカイビル (Umeda Sky Building, 173 m)
 * - 通天閣 (Tsutenkaku, 108 m)
 * Persistent at all ranges so they stand out unmistakably from Mt. Ikoma, Osaka Castle, and Osaka Bay.
 */
export function buildOsakaLandmarks(env: Env, ground: GroundFn): THREE.Group {
  const b = createBuilder();

  // =========================================================================
  // 1. あべのハルカス (Abeno Harukas — 300 m stepped glass monolith)
  // =========================================================================
  {
    const p = toLocal(OSAKA_SKYLINE_SITES.abenoHarukas.lat, OSAKA_SKYLINE_SITES.abenoHarukas.lon);
    const y0 = ground(p.x, p.z) - 2.0;
    const rot = -0.06;
    const glassBlue: RGB = [0.22, 0.34, 0.44];
    const glassMid: RGB = [0.26, 0.39, 0.49];
    const glassCrown: RGB = [0.34, 0.48, 0.58];
    const frameSilver: RGB = [0.76, 0.79, 0.82];
    const gardenGreen: RGB = [0.16, 0.34, 0.14];

    // Low-rise Kintetsu Dept Store podium (0–82 m, 88 m × 66 m)
    addBox(b, p.x, y0, p.z, rot, 0, 0, 0, 88, 82, 66, [0.30, 0.36, 0.42], {
      topRgb: [0.50, 0.52, 0.54], emit: 0.55, glass: 0.78, style: 1,
    });
    // 16th-floor Sky Garden outdoor terrace (82 m)
    addBox(b, p.x, y0, p.z, rot, -10, 82, 6, 48, 1.8, 34, gardenGreen, { topRgb: gardenGreen, emit: 0.12 });
    // Crisp white/silver structural edge belt at 82 m
    addBox(b, p.x, y0, p.z, rot, 0, 80.5, 0, 90, 2.2, 68, frameSilver, { emit: 0.42, style: 3 });

    // Mid-rise stepped office tier (82–186 m, 64 m × 56 m shifted NE)
    addBox(b, p.x, y0, p.z, rot, 10, 82, -4, 64, 104, 56, glassBlue, {
      topRgb: [0.54, 0.57, 0.60], emit: 0.62, glass: 0.92, style: 1,
    });
    // Structural silver corner mullions running full height of mid-tier
    for (const sx of [-31.5, 31.5]) for (const sz of [-27.5, 27.5]) {
      addBox(b, p.x, y0, p.z, rot, 10 + sx, 82, -4 + sz, 2.2, 104, 2.2, frameSilver, { emit: 0.22 });
    }
    // Mechanical sky-lobby terrace belt at 186 m
    addBox(b, p.x, y0, p.z, rot, 10, 184.5, -4, 66, 2.4, 58, frameSilver, { emit: 0.48, style: 3 });

    // High-rise Marriott Hotel & Observatory shaft (186–280 m, 44 m × 48 m shifted N)
    addBox(b, p.x, y0, p.z, rot, 18, 186, -8, 44, 94, 48, glassMid, {
      topRgb: [0.62, 0.65, 0.68], emit: 0.70, glass: 0.95, style: 1,
    });
    // Signature Harukas 300 Triple-Height Glowing Glass Observatory Crown (280–300 m)
    addBox(b, p.x, y0, p.z, rot, 18, 280, -8, 44.6, 20, 48.6, glassCrown, {
      topRgb: [0.72, 0.75, 0.78], emit: 0.95, topEmit: 0.45, glass: 0.96, style: 2,
    });
    // Iconic horizontal luminous crown rim & rooftop helipad pad at 300 m
    addBox(b, p.x, y0, p.z, rot, 18, 298.8, -8, 46, 1.8, 50, [0.92, 0.95, 0.98], { emit: 1.0, style: 3 });
    addBox(b, p.x, y0, p.z, rot, 18, 300.2, -8, 20, 0.9, 20, [0.30, 0.32, 0.34]);
    // Pulsing twin red aviation beacons at 303 m + glowing crown accents
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [lx, lz] of [[-2, -28], [38, 12]] as const) {
      addLight(b, [p.x + lx * c - lz * s, y0 + 304.5, p.z + lx * s + lz * c], [1.0, 0.10, 0.06], 7.8, 1.1);
    }
    addLight(b, [p.x + 18 * c + 8 * s, y0 + 292, p.z + 18 * s - 8 * c], [0.90, 0.96, 1.0], 8.5, 0);
  }

  // =========================================================================
  // 2. 梅田スカイビル (Umeda Sky Building — 173 m Twin Towers + Floating Garden Ring)
  // =========================================================================
  {
    const p = toLocal(OSAKA_SKYLINE_SITES.umedaSky.lat, OSAKA_SKYLINE_SITES.umedaSky.lon);
    const y0 = ground(p.x, p.z) - 2.0;
    const rot = 0.08;
    const skyGlass: RGB = [0.28, 0.40, 0.50];
    const silverMetal: RGB = [0.76, 0.80, 0.84];
    const atriumGlow: RGB = [0.72, 0.86, 0.96];
    const c = Math.cos(rot), s = Math.sin(rot);
    const worldPt = (lx: number, ly: number, lz: number): [number, number, number] => [
      p.x + lx * c - lz * s, y0 + ly, p.z + lx * s + lz * c,
    ];

    // Twin sleek silver-blue glass towers (Tower East & Tower West) separated by a 34 m dramatic central void
    for (const side of [-1, 1]) {
      const tx = side * 32;
      addBox(b, p.x, y0, p.z, rot, tx, 0, 0, 30, 152, 34, skyGlass, {
        topRgb: silverMetal, emit: 0.62, glass: 0.94, style: 1,
      });
      // Vertical metallic-silver corner fins framing each tower
      for (const fx of [-15, 15]) for (const fz of [-17, 17]) {
        addBox(b, p.x, y0, p.z, rot, tx + fx, 0, fz, 1.8, 154, 1.8, silverMetal, { emit: 0.18 });
      }
    }

    // Central cylindrical glass elevator core rising through the open courtyard
    addBox(b, p.x, y0, p.z, rot, 0, 0, 0, 13, 152, 13, atriumGlow, { emit: 0.72, glass: 0.92, style: 2 });

    // Iconic Floating Garden Observatory (空中庭園展望台, 152–173 m): cantilevered square ring with circular open center!
    // Built as 4 dramatic cantilevered bridge sides around an open 26 m × 26 m sky aperture
    const deckY = 152, deckH = 21;
    addBox(b, p.x, y0, p.z, rot, 0, deckY, -22, 92, deckH, 16, silverMetal, { topRgb: [0.84, 0.87, 0.90], emit: 0.58, glass: 0.82, style: 1 });
    addBox(b, p.x, y0, p.z, rot, 0, deckY, 22, 92, deckH, 16, silverMetal, { topRgb: [0.84, 0.87, 0.90], emit: 0.58, glass: 0.82, style: 1 });
    addBox(b, p.x, y0, p.z, rot, -34, deckY, 0, 24, deckH, 28, silverMetal, { topRgb: [0.84, 0.87, 0.90], emit: 0.58, glass: 0.82, style: 1 });
    addBox(b, p.x, y0, p.z, rot, 34, deckY, 0, 24, deckH, 28, silverMetal, { topRgb: [0.84, 0.87, 0.90], emit: 0.58, glass: 0.82, style: 1 });
    // Glowing blue-white inner observatory ring trim
    addBox(b, p.x, y0, p.z, rot, 0, deckY + 18, -14.5, 48, 3.2, 1.6, atriumGlow, { emit: 1.0, style: 3 });
    addBox(b, p.x, y0, p.z, rot, 0, deckY + 18, 14.5, 48, 3.2, 1.6, atriumGlow, { emit: 1.0, style: 3 });

    // Signature crossed open-air glass tube escalators bridging the central void (130 m -> 154 m)!!
    addBeam(b, worldPt(-18, 130, -5), worldPt(18, 154, 5), 3.4, 3.6, atriumGlow, 0.98, 0.88);
    addBeam(b, worldPt(18, 130, -5), worldPt(-18, 154, 5), 3.4, 3.6, atriumGlow, 0.98, 0.88);

    // Rooftop red aviation beacons & cool-blue observatory glow lights
    addLight(b, worldPt(-42, 176.5, -26), [1.0, 0.10, 0.06], 7.4, 1.4);
    addLight(b, worldPt(42, 176.5, 26), [1.0, 0.10, 0.06], 7.4, 1.4);
    addLight(b, worldPt(0, 165, 0), [0.68, 0.88, 1.0], 8.2, 0);
  }

  // =========================================================================
  // 3. 通天閣 (Tsutenkaku — 108 m Shinsekai iconic illuminated tower)
  // =========================================================================
  {
    const p = toLocal(OSAKA_SKYLINE_SITES.tsutenkaku.lat, OSAKA_SKYLINE_SITES.tsutenkaku.lon);
    const y0 = ground(p.x, p.z) - 1.5;
    const steel: RGB = [0.64, 0.67, 0.70];
    const neonBlue: RGB = [0.22, 0.56, 0.96];
    const neonGold: RGB = [1.0, 0.82, 0.36];

    // Four-legged arched base podium (0–28 m)
    for (const sx of [-7.5, 7.5]) for (const sz of [-7.5, 7.5]) {
      addBox(b, p.x, y0, p.z, 0, sx, 0, sz, 4.2, 28, 4.2, steel, { emit: 0.25 });
    }
    addBox(b, p.x, y0, p.z, 0, 0, 24, 0, 20, 6, 20, steel, { emit: 0.45, style: 3 });
    // Tapered central steel shaft with glowing vertical Osaka neon signage bands (28–80 m)
    addBox(b, p.x, y0, p.z, 0, 0, 28, 0, 10.5, 52, 10.5, steel, { emit: 0.35 });
    addBox(b, p.x, y0, p.z, 0, 0, 34, 5.6, 4.2, 42, 0.9, neonBlue, { emit: 0.98, style: 3 });
    addBox(b, p.x, y0, p.z, 0, 0, 34, -5.6, 4.2, 42, 0.9, neonBlue, { emit: 0.98, style: 3 });
    addBox(b, p.x, y0, p.z, 0, 5.6, 34, 0, 0.9, 42, 4.2, neonGold, { emit: 0.92, style: 3 });
    addBox(b, p.x, y0, p.z, 0, -5.6, 34, 0, 0.9, 42, 4.2, neonGold, { emit: 0.92, style: 3 });
    // Wide observation deck (80–93 m)
    addBox(b, p.x, y0, p.z, 0, 0, 80, 0, 17, 13, 17, [0.16, 0.26, 0.34], { topRgb: steel, emit: 0.88, glass: 0.90, style: 2 });
    // Iconic illuminated round weather-forecast crown & spire (93–108 m)
    addBox(b, p.x, y0, p.z, 0, 0, 93, 0, 7.5, 9, 7.5, neonGold, { emit: 1.0, style: 3 });
    addBox(b, p.x, y0, p.z, 0, 0, 102, 0, 1.4, 7, 1.4, [0.90, 0.92, 0.95], { emit: 0.8, style: 3 });
    addLight(b, [p.x, y0 + 110, p.z], [1.0, 0.14, 0.10], 6.4, 1.7);
    addLight(b, [p.x, y0 + 97, p.z], [1.0, 0.86, 0.44], 7.8, 0);
  }

  const group = new THREE.Group();
  group.name = 'osaka-skyline-landmarks';

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setAttribute('aEmit', new THREE.Float32BufferAttribute(b.emit, 1));
  geo.setAttribute('aGlass', new THREE.Float32BufferAttribute(b.glass, 1));
  geo.setAttribute('aStyle', new THREE.Float32BufferAttribute(b.style, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aEmit;
      attribute float aGlass;
      attribute float aStyle;
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit, vGlass, vStyle;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = aColor;
        vEmit = aEmit;
        vGlass = aGlass;
        vStyle = aStyle;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      varying vec3 vWorld, vNormal, vColor;
      varying float vEmit, vGlass, vStyle;
      void main(){
        vec3 n = normalize(vNormal);
        // Convert sRGB authoring tones to true linear architectural albedo so glass skyscrapers
        // read as deep reflective sapphire/slate glass instead of washed-out white boxes.
        vec3 col = pow(vColor, vec3(2.2));
        float st = floor(vStyle + .5);
        float fp = max(length(dFdx(vWorld)), length(dFdy(vWorld)));
        float win = 1.;
        float nightPattern = 1.;

        if (st == 1.) {
          // Sleek skyscraper glass curtain wall with crisp aluminum mullions & dark floor spandrel ribbons
          float along = abs(n.x) > abs(n.z) ? vWorld.z : vWorld.x;
          float fY = fract(vWorld.y / 4.2);
          float fX = fract(along / 3.2);
          float fwY = fwidth(vWorld.y / 4.2);
          float fwX = fwidth(along / 3.2);
          float tY = smoothstep(.18, .46, fwY);
          float tX = smoothstep(.18, .46, fwX);
          float bandY = mix(smoothstep(.14 - fwY, .14 + fwY, fY) * (1. - smoothstep(.86 - fwY, .86 + fwY, fY)), .72, tY);
          float bandX = mix(smoothstep(.06 - fwX, .06 + fwX, fX) * (1. - smoothstep(.94 - fwX, .94 + fwX, fX)), .82, tX);
          // Macro 3-floor structural rhythm visible from 16 km away (Mt. Ikoma!)
          float macro = .5 + .5 * cos(6.28318 * vWorld.y / 12.6) * exp(-pow(fwY * .33, 2.) * 7.);
          win = mix(bandY * bandX, .56 + .28 * macro, tY * .75);
          vec3 mullionCol = vec3(.22, .25, .28);
          col = mix(mullionCol, col * .42, win);
          // Crisp sparse office floor & window clusters at night (high contrast, zero bloom whiteout)
          vec2 id = vec2(floor(along / 4.8), floor(vWorld.y / 4.2));
          float roomOn = step(.52, hash12(id * vec2(1.9, 3.1) + 7.1)) * step(.32, hash12(vec2(id.y * 2.3, 4.7)));
          nightPattern = mix(roomOn * bandY * bandX, (.24 + .18 * macro), smoothstep(.6, 2.8, fp * .2));
        } else if (st == 0. && abs(n.y) < .5) {
          // Subtle structural steel truss / concrete panel joints on tower legs & fins
          float grid = smoothstep(.05, .12, min(fract(vWorld.y / 5.0), 1. - fract(vWorld.y / 5.0)));
          col *= .82 + .18 * grid;
          nightPattern = .35;
        }

        vec3 lit = shade(seasonalSurface(col, n, vWorld), n, vWorld, 1.);
        if (vGlass > .05) {
          vec3 v = normalize(vWorld - cameraPosition);
          vec3 r = reflect(v, n);
          r.y = clamp(r.y + .06, -.05, 1.);
          vec3 rn = normalize(r);
          float fres = .06 + .32 * pow(1. - clamp(dot(-v, n), 0., 1.), 3.3);
          lit += skyColor(rn) * fres * vGlass * win;
          lit += uSunLight * pow(max(dot(rn, uSunDir), 0.), 56.) * .42 * vGlass * win;
        }
        vec3 emitTint = st == 3. ? pow(vColor, vec3(1.5)) * .52
                      : st == 2. ? vec3(.48, .72, .96)
                      : mix(vec3(.92, .74, .46), vec3(.66, .80, .98), .45);
        float emitScale = st == 3. ? .55 : st == 2. ? .34 : .28;
        vec3 emit = emitTint * vEmit * nightPattern * emitScale * uCity * cityLightShimmer(vWorld);
        gl_FragColor = vec4(applyHaze(lit, emit, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'osaka-skyline-meshes';
  mesh.frustumCulled = false;
  group.add(mesh);

  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.lightPos, 3));
  lGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(b.lightCol, 3));
  lGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(b.lightSize, 1));
  lGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(b.lightPhase, 1));
  lGeo.computeBoundingSphere();

  const lMat = new THREE.ShaderMaterial({
    uniforms: env,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uCity;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vec4 mv = viewMatrix * wp;
        float dist = max(25., -mv.z);
        float night = smoothstep(.10, .55, uCity);
        float pulse = aPhase > .5
          ? (.25 + .85 * pow(.5 + .5 * sin(uTime * 3.2 + aPhase * 4.), 2.2))
          : 1.;
        vColor = aColor * 1.05;
        vAlpha = night * pulse * (1. - smoothstep(22000., 42000., dist));
        gl_PointSize = clamp(aSize * 540. / dist + 1.8, 2.2, 9.0);
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
        float core = exp(-r2 * 18.) + .45 * exp(-r2 * 5.);
        gl_FragColor = vec4(vColor * core, vAlpha);
      }
    `,
  });
  const pts = new THREE.Points(lGeo, lMat);
  pts.name = 'osaka-skyline-lights';
  pts.frustumCulled = false;
  group.add(pts);

  return group;
}
