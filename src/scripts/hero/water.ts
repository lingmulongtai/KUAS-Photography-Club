import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { LINE, type LineFeature } from './lines-data';
import { ROAD_GLSL } from './roads';
import {refineWaterSurfaceSteps} from './water-surface';
import {toLocal} from './geo';
import {loadBinary} from './data';
import {yieldTask} from './task-yield';
import type {KamoChannel} from './kamo-channel';

const senkoji=toLocal(35.0157751,135.6655983);

/**
 * Rivers, the castle moat, Lake Biwa, Seta River and ponds from GSI water areas.
 * Surfaces mirror the sky, clouds, seasonal shoreline silhouettes, sun/moon glitter and
 * nighttime city reflections, with organic multi-octave waves and directional river flow.
 */
type WaterRoads = {
  uRoads: { value: THREE.Texture | null };
  uRoadBox: { value: THREE.Vector4 };
  uRoadsOn: { value: number };
  uRegionRoads:{value:THREE.Texture};
  uRegionRoadBox:{value:THREE.Vector4};
  uRegionRoadsOn:{value:number};
};

export function* waterSteps(env: Env, hf: Heightfield, lines: LineFeature[], roads: WaterRoads,
  regionalEdge=18,channel?:KamoChannel,regionalSurface=false) {
  const pos: number[] = [];
  const stable:number[]=[],profiles:number[]=[];
  let trianglesBuilt=0;
  for (let i = 0; i < lines.length; i++) {
    if(i && i%128===0)yield;
    const f = lines[i];
    if (f.kind !== LINE.water) continue;
    const ring = toVec(f.pts);
    const profile=waterProfile(ring,f.attr);
    const holes: THREE.Vector2[][] = [];
    while (i + 1 < lines.length && lines[i + 1].kind === LINE.waterHole) holes.push(toVec(lines[++i].pts));
    if (ring.length < 3) continue;
    let all: {x:number;y:number}[] = ring.concat(...holes);
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(ring, holes);
    } catch {
      continue;
    }
    if(regionalSurface||f.attr===1||f.attr===2) {
      // A bounded fallback retains the complete shoreline if a pathological polygon is huge.
      let refined;
      for(const edge of [regionalEdge,regionalEdge*2,regionalEdge*4]) {
        try {refined=yield* refineWaterSurfaceSteps(all,tris,edge,40000,f.attr===1?{x:senkoji.x,y:senkoji.z}:undefined,regionalSurface&&edge<=36?(x,z)=>hf.height(x,z):undefined);break;} catch { /* retry coarser, never drop water */ }
      }
      if(refined) {all=refined.points;tris=refined.triangles;}
    }
    for (const t of tris) {
      if(++trianglesBuilt%512===0)yield;
      // face up
      const [a, b, c] = t.map((k) => all[k]);
      const up = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0;
      for (const k of up ? t : [t[0], t[2], t[1]]) {
        const p = all[k];
        const ground=hf.height(p.x,p.y),fixed=channel&&channel.owns(f.pts);
        pos.push(p.x,fixed?channel.surface(p.x,p.y,ground):ground+.4,p.y);
        stable.push(fixed?channel.stability(p.x,p.y):0);
        profiles.push(...profile);
      }
    }
  }
  const position=new THREE.Float32BufferAttribute(pos,3);
  yield;
  const stability=new THREE.Float32BufferAttribute(stable,1);
  yield;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',position);
  geo.setAttribute('aStable',stability);
  geo.setAttribute('aWater',new THREE.Float32BufferAttribute(profiles,3));
  const mesh = new THREE.Mesh(geo, waterMaterial(env,roads,regionalSurface?.35:30));
  mesh.frustumCulled = false;
  return mesh;
}

// The river's main axis follows the length-weighted orientation of its banks.
export function waterProfile(ring:readonly {x:number;y:number}[],attr:number):[number,number,number]{
  let xx=0,xy=0,yy=0,perimeter=0,area=0;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i],x=b.x-a.x,y=b.y-a.y,length=Math.hypot(x,y);
    if(length===0)continue;
    perimeter+=length;area+=a.x*b.y-b.x*a.y;
    xx+=x*x/length;xy+=x*y/length;yy+=y*y/length;
  }
  const angle=.5*Math.atan2(2*xy,xx-yy);
  const compactness=2*Math.PI*Math.abs(area)/Math.max(1,perimeter*perimeter);
  const river=attr===1 || attr===2 || compactness<.32;
  return [river?1:0,Math.cos(angle),Math.sin(angle)];
}

export function waterMaterial(env:Env,roads:WaterRoads,bias:number,surfaceClearance=false){
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...roads, uWaterBias:{value:bias}, uClearance:{value:surfaceClearance?1:0} },
    vertexShader: /* glsl */ `
      attribute float aStable;
      attribute vec3 aWater;
      uniform float uWaterBias;
      uniform float uClearance;
      varying float vStable;
      varying vec3 vWater;
      varying vec3 vWorld;
      void main(){
        vec3 p = position;
        vWorld = p;
        vStable=aStable;vWater=aWater;
        vec3 toCam = cameraPosition - p;
        float dist = length(toCam);
        float pull;
        if (uClearance > .5) {
          // Keep Lake Biwa's shoreline, Seta River and Osaka rivers cleanly above coarse 100-200 m
          // terrain slopes at every range (so lakes & rivers never shrink or dry up close), while staying below bridges.
          float nearPull = aWater.x > 1.5
            ? clamp(dist * .0065, 1.25, 11.)
            : clamp(dist * .0045, .75, 2.5);
          float farLake = aWater.x > 1.5 ? smoothstep(2600., 14000., dist) : 0.;
          pull = mix(nearPull, max(nearPull, min(dist * .0038, 110.)), farLake);
        } else {
          float farLake = aWater.x > 1.5 ? smoothstep(2500., 14000., dist) : 0.;
          pull = mix(min(dist * .004, uWaterBias), max(uWaterBias, min(dist * .0035, 110.)), farLake);
        }
        p += toCam / max(dist,.01) * pull * (1.-aStable);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${ROAD_GLSL}
      varying vec3 vWorld;
      varying float vStable;
      varying vec3 vWater;

      // Multi-octave rotated organic wave height (zero periodic grid regularity).
      float waveHeight(vec2 p, vec2 drift, float fine, float med, float broad){
        const mat2 R1 = mat2(.80, -.60, .60, .80);
        const mat2 R2 = mat2(.54, .84, -.84, .54);
        const mat2 R3 = mat2(-.38, .92, -.92, -.38);
        vec2 warp = vec2(vnoise(p * .035 + drift * .25), vnoise(p * .035 - drift * .21 + 17.3)) - .5;
        vec2 q0 = p + warp * 5.5;
        float h = 0.;
        if (broad > .001) {
          vec2 a = R1 * (q0 * .055) + drift * .38;
          h += (vnoise(a) - .5) * 1.15 * broad;
          vec2 b = R2 * (q0 * .115) - drift * .52 + 11.4;
          h += (vnoise(b) - .5) * .68 * broad;
        }
        if (med > .001) {
          vec2 c = R3 * (q0 * .24) + drift * .85 + 29.7;
          h += (vnoise(c) - .5) * .42 * med;
        }
        if (fine > .001) {
          vec2 d = R1 * (p * .58) - drift * 1.35 + 47.1;
          h += (vnoise(d) - .5) * .22 * fine;
        }
        return h;
      }

      // Environment reflection: sky dome, reflected cloud wisps, seasonal mountain/shoreline
      // silhouette near the horizon, and warm nighttime bank/city light reflections.
      vec3 reflectScenery(vec3 r, vec3 wp, bool lake, bool river){
        vec3 sky = skyColor(r);
        // Reflected cloud wisps in the upper sky.
        if (r.y > .04) {
          vec2 cloudUv = wp.xz * .00004 + r.xz / max(r.y + .18, .22) * .75 + vec2(uTime * .0015, 0.);
          float cMask = smoothstep(.46, .78, fbm(cloudUv * 2.2)) * smoothstep(.04, .28, r.y) * (1. - smoothstep(.55, .95, r.y));
          vec3 cCol = mix(uCloudLight * .88 + uHorizon * .25, uHorizon * .45, uCity);
          sky = mix(sky, cCol, cMask * .42);
        }
        // Low-angle surrounding hills / shoreline / city silhouette mirrored on the water.
        float az = atan(r.x, r.z);
        float ridge = .055 + .048 * vnoise(vec2(az * 3.1 + wp.x * .00004, wp.z * .00004 + 4.2))
                           + .026 * vnoise(vec2(az * 7.8 + 12.1, wp.x * .00007 - wp.z * .00007));
        float ridgeScale = lake ? .85 : (river ? 1.25 : 1.55);
        float sill = 1. - smoothstep(ridge * ridgeScale * .65, ridge * ridgeScale * 1.15 + .018, r.y);
        vec3 hillBase = vec3(.08, .12, .08);
        hillBase = mix(hillBase, vec3(.16, .10, .06), uAutumn * .65);
        hillBase = mix(hillBase, vec3(.07, .14, .07), uSummer * .55);
        hillBase = mix(hillBase, vec3(.14, .12, .13), uSpring * .4);
        hillBase = mix(hillBase, vec3(.22, .24, .27), uSnow * .65);
        vec3 cityTone = vec3(.11, .12, .13);
        float urbanMix = river ? .55 : (lake ? .32 : .42);
        vec3 landCol = mix(hillBase, cityTone, urbanMix) * (skyLight(vec3(0., .7, .7)) + uSunLight * max(uSunDir.y, 0.) * .55);
        // Subtle warm city / shoreline glow reflected across water at night.
        if (uCity > .01) {
          float shoreBand = exp(-r.y * 18.) * (.45 + .55 * vnoise(vec2(az * 14. + wp.x * .0004, wp.z * .0004)));
          landCol += vec3(1., .64, .32) * shoreBand * uCity * (river ? .42 : (lake ? .22 : .28));
        }
        float reflStrength = lake ? .58 : (river ? .68 : .76);
        return mix(sky, landCol, sill * reflStrength);
      }

      void main(){
        vec2 q = vWorld.xz;
        float footprint=max(length(dFdx(q)),length(dFdy(q)));
        Road road = roadAt(q);
        if (road.edge <= 0. && vStable<.001) discard;
        bool baySea = vWater.x > 2.5;
        bool lake = vWater.x > 1.5 && !baySea;
        bool river = vWater.x > .5 && !lake && !baySea;
        if (baySea) {
          // Match regional-ground.ts renderSea() bit-for-bit so Osaka Bay harbors and open sea
          // join with zero visible tile seam around Yumeshima, Kobe Port and Sakishima.
          const mat2 R1 = mat2(.80, -.60, .60, .80);
          const mat2 R2 = mat2(.54, .84, -.84, .54);
          float broad = 1. - smoothstep(2., 16., footprint);
          float med = 1. - smoothstep(.4, 4.5, footprint);
          vec2 drift = vec2(uTime * .38, uTime * .26);
          float eps = max(.55, footprint * .5);
          vec2 wp0 = vec2(vnoise(q * .022 + drift * .22), vnoise(q * .022 - drift * .19 + 13.7)) - .5;
          vec2 q0 = q + wp0 * 7.5;
          vec2 qx = q + vec2(eps, 0.) + (vec2(vnoise((q + vec2(eps, 0.)) * .022 + drift * .22), vnoise((q + vec2(eps, 0.)) * .022 - drift * .19 + 13.7)) - .5) * 7.5;
          vec2 qy = q + vec2(0., eps) + (vec2(vnoise((q + vec2(0., eps)) * .022 + drift * .22), vnoise((q + vec2(0., eps)) * .022 - drift * .19 + 13.7)) - .5) * 7.5;
          float h0 = ((vnoise(R1 * (q0 * .038) + drift * .35) - .5) * 1.2 + (vnoise(R2 * (q0 * .082) - drift * .46 + 9.4) - .5) * .65) * broad
                   + (vnoise(R1 * (q0 * .19) + drift * .78 + 24.1) - .5) * .38 * med;
          float hx = ((vnoise(R1 * (qx * .038) + drift * .35) - .5) * 1.2 + (vnoise(R2 * (qx * .082) - drift * .46 + 9.4) - .5) * .65) * broad
                   + (vnoise(R1 * (qx * .19) + drift * .78 + 24.1) - .5) * .38 * med;
          float hy = ((vnoise(R1 * (qy * .038) + drift * .35) - .5) * 1.2 + (vnoise(R2 * (qy * .082) - drift * .46 + 9.4) - .5) * .65) * broad
                   + (vnoise(R1 * (qy * .19) + drift * .78 + 24.1) - .5) * .38 * med;
          float gust = .58 + .68 * vnoise(q * .0012 + vec2(uTime * .014, -uTime * .01));
          vec2 slope = vec2(hx - h0, hy - h0) / eps * .11 * gust;
          vec3 n = normalize(vec3(slope.x, 1., slope.y));
          vec3 view = normalize(vWorld - cameraPosition);
          vec3 r = reflect(view, n);
          r.y = clamp(abs(r.y) + .02, .015, 1.);
          vec3 rn = normalize(r);
          float facing = clamp(dot(-view, n), 0., 1.);
          float fres = .045 + .88 * pow(1. - facing, 4.5);
          vec3 sky = skyColor(rn);
          if (rn.y > .04) {
            vec2 cloudUv = q * .000035 + rn.xz / max(rn.y + .18, .22) * .75 + vec2(uTime * .0014, 0.);
            float cMask = smoothstep(.46, .78, fbm(cloudUv * 2.1)) * smoothstep(.04, .28, rn.y) * (1. - smoothstep(.55, .95, rn.y));
            vec3 cCol = mix(uCloudLight * .88 + uHorizon * .25, uHorizon * .45, uCity);
            sky = mix(sky, cCol, cMask * .4);
          }
          float az = atan(rn.x, rn.z);
          float ridge = .04 + .035 * vnoise(vec2(az * 3.2 + q.x * .00003, q.y * .00003 + 3.7));
          float sill = 1. - smoothstep(ridge * .6, ridge * 1.15 + .015, rn.y);
          vec3 shoreCol = vec3(.09, .10, .11) * (skyLight(vec3(0., .7, .7)) + uSunLight * max(uSunDir.y, 0.) * .5);
          if (uCity > .01) {
            float glow = exp(-rn.y * 16.) * (.45 + .55 * vnoise(vec2(az * 12. + q.x * .0003, q.y * .0003)));
            shoreCol += vec3(1., .64, .32) * glow * uCity * .24;
          }
          vec3 envRefl = mix(sky, shoreCol, sill * .48);
          vec3 ambient = skyLight(vec3(0., 1., 0.)) + uSunLight * max(uSunDir.y, 0.);
          vec3 col = mix(vec3(.009, .031, .047) * ambient, envRefl, fres);
          float sunDot = max(dot(rn, uSunDir), 0.);
          float moonDot = max(dot(rn, uMoonDir), 0.);
          col += uSunLight * (pow(sunDot, 170.) * .55 + pow(sunDot, 24.) * .065);
          col += uMoonLight * (pow(moonDot, 170.) * 2.8 + pow(moonDot, 24.) * .28);
          gl_FragColor = vec4(applyHaze(col, vec3(0.), vWorld), 1.);
          return;
        }
        vec2 axis=normalize(vWater.yz),crosswind=vec2(-axis.y,axis.x);
        vec2 along=vec2(dot(q,axis),dot(q,crosswind));

        float broad = 1. - smoothstep(1.2, 9.5, footprint);
        float med   = 1. - smoothstep(.35, 3.2, footprint);
        float fine  = 1. - smoothstep(.08, .95, footprint);

        vec2 sampleCoord;
        vec2 drift;
        if (river) {
          // Elongate wave shapes along the river channel and advect steadily downstream.
          sampleCoord = vec2(along.x * .58, along.y * 1.45);
          drift = vec2(-uTime * 1.55, sin(uTime * .23) * .12);
        } else if (lake) {
          sampleCoord = q * .85;
          drift = vec2(uTime * .46, uTime * .31);
        } else {
          // Ponds & castle moats: calm, gentle ripples.
          sampleCoord = q * 1.15;
          drift = vec2(uTime * .14, -uTime * .10);
        }

        // Finite-difference slope of the organic wave field in world space.
        float eps = max(.35, footprint * .5);
        float h0 = waveHeight(sampleCoord, drift, fine, med, broad);
        float hx = waveHeight(sampleCoord + vec2(eps, 0.), drift, fine, med, broad);
        float hy = waveHeight(sampleCoord + vec2(0., eps), drift, fine, med, broad);
        vec2 localGrad = vec2(hx - h0, hy - h0) / eps;

        // Wind gusts create natural calm vs ruffled patches across Lake Biwa.
        float gust = lake ? (.55 + .70 * vnoise(q * .0016 + vec2(uTime * .018, -uTime * .012))) : 1.;
        float ripple = (lake ? .115 : river ? .095 : .032) * gust;
        vec2 slope = river
          ? (axis * (localGrad.x * .58) + crosswind * (localGrad.y * 1.45)) * ripple
          : localGrad * ripple;
        vec3 n = normalize(vec3(slope.x, 1., slope.y));

        vec3 view = normalize(vWorld - cameraPosition);
        vec3 r = reflect(view, n);
        r.y = clamp(abs(r.y) + (lake ? .025 : river ? .04 : .012), .012, 1.);
        vec3 rn = normalize(r);

        float facing = clamp(dot(-view, n), 0., 1.);
        float fres = .04 + .90 * pow(1. - facing, 4.6);
        vec3 deep = lake ? vec3(.009, .032, .045) : river ? vec3(.020, .039, .033) : vec3(.016, .032, .024);
        vec3 ambient = skyLight(vec3(0., 1., 0.)) + uSunLight * max(uSunDir.y, 0.);
        vec3 envRefl = reflectScenery(rn, vWorld, lake, river);
        vec3 col = mix(deep * ambient, envRefl, fres);

        // Dual-lobe solar & lunar specular sparkle.
        float sunDot = max(dot(rn, uSunDir), 0.);
        float moonDot = max(dot(rn, uMoonDir), 0.);
        float tight = lake ? 180. : river ? 120. : 240.;
        float broadGloss = lake ? 26. : river ? 20. : 38.;
        col += uSunLight * (pow(sunDot, tight) * .55 + pow(sunDot, broadGloss) * .065);
        col += uMoonLight * (pow(moonDot, tight) * 2.8 + pow(moonDot, broadGloss) * .28);
        gl_FragColor = vec4(applyHaze(col, vec3(0.), vWorld), 1.);
      }
    `,
  });
}

export type BiwaSurface = THREE.Group & { refit: (ground: (x: number, z: number) => number) => void };

// Recursively bisect river triangles whose longest edge exceeds maxEdge so refit(ground)
// tracks interior DEM bulges across wide channels instead of letting terrain poke through up close.
function subdivideWaterTriangles(raw: Float32Array, maxEdge: number | ((x: number, z: number) => number), defaultY: number): Float32Array<ArrayBuffer> {
  const out: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < raw.length; i += 9) {
    stack.push(raw[i], raw[i + 2], raw[i + 3], raw[i + 5], raw[i + 6], raw[i + 8]);
    while (stack.length) {
      const cz = stack.pop()!, cx = stack.pop()!;
      const bz = stack.pop()!, bx = stack.pop()!;
      const az = stack.pop()!, ax = stack.pop()!;
      const limit = typeof maxEdge === 'number' ? maxEdge : maxEdge((ax + bx + cx) / 3, (az + bz + cz) / 3);
      const maxSq = limit * limit;
      const ab = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
      const bc = (cx - bx) * (cx - bx) + (cz - bz) * (cz - bz);
      const ca = (ax - cx) * (ax - cx) + (az - cz) * (az - cz);
      if (ab <= maxSq && bc <= maxSq && ca <= maxSq) {
        out.push(ax, defaultY, az, bx, defaultY, bz, cx, defaultY, cz);
      } else if (ab >= bc && ab >= ca) {
        const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
        stack.push(ax, az, mx, mz, cx, cz, mx, mz, bx, bz, cx, cz);
      } else if (bc >= ca) {
        const mx = (bx + cx) * 0.5, mz = (bz + cz) * 0.5;
        stack.push(ax, az, bx, bz, mx, mz, ax, az, mx, mz, cx, cz);
      } else {
        const mx = (cx + ax) * 0.5, mz = (cz + az) * 0.5;
        stack.push(ax, az, bx, bz, mx, mz, bx, bz, cx, cz, mx, mz);
      }
    }
  }
  return new Float32Array(out);
}

// Surveyed Lake Yogo (余呉湖 / 鏡湖, Nagahama, Shiga) shoreline from GSI experimental_bvmap waterarea (13/7195/3230).
const LAKE_YOGO_RING: readonly [number, number][] = [
  [35.53257,136.19193],[35.53243,136.1922],[35.532,136.19242],[35.53148,136.19315],[35.53152,136.19356],
  [35.53138,136.19401],[35.53143,136.19502],[35.53142,136.19543],[35.53124,136.1957],[35.53117,136.19625],
  [35.531,136.19657],[35.53122,136.19684],[35.5311,136.19713],[35.53085,136.19757],[35.53063,136.19777],
  [35.53048,136.1982],[35.53033,136.19875],[35.53024,136.19922],[35.53021,136.19968],[35.53016,136.20025],
  [35.53001,136.20079],[35.52975,136.20101],[35.52934,136.2013],[35.52893,136.20128],[35.52868,136.20117],
  [35.52816,136.20094],[35.52765,136.20062],[35.52724,136.20027],[35.52656,136.20017],[35.52617,136.19996],
  [35.52548,136.19916],[35.5251,136.19904],[35.52467,136.19914],[35.52382,136.19901],[35.52307,136.19914],
  [35.52276,136.19904],[35.52233,136.19886],[35.52208,136.19861],[35.52168,136.19855],[35.52119,136.19884],
  [35.52042,136.19858],[35.51998,136.19854],[35.51971,136.19856],[35.51927,136.19887],[35.51881,136.19883],
  [35.51759,136.19915],[35.51731,136.199],[35.51707,136.19869],[35.51687,136.19826],[35.51645,136.19769],
  [35.51619,136.19731],[35.51592,136.19716],[35.5155,136.19706],[35.51493,136.19644],[35.51467,136.19633],
  [35.51433,136.1963],[35.51361,136.19565],[35.51334,136.19525],[35.51333,136.1947],[35.51345,136.1938],
  [35.51337,136.19345],[35.51299,136.19265],[35.513,136.19216],[35.51317,136.19135],[35.51337,136.19105],
  [35.51351,136.19072],[35.51359,136.19039],[35.51388,136.18971],[35.51412,136.1895],[35.51453,136.18953],
  [35.51492,136.18966],[35.51546,136.18968],[35.51591,136.18972],[35.51617,136.18992],[35.51637,136.19031],
  [35.51681,136.19055],[35.51707,136.19042],[35.51733,136.18984],[35.51757,136.18945],[35.51778,136.18917],
  [35.51818,136.18906],[35.51874,136.18901],[35.51903,136.18886],[35.51945,136.1888],[35.51986,136.18911],
  [35.52017,136.18919],[35.52071,136.18891],[35.52105,136.18863],[35.52129,136.18871],[35.52137,136.18941],
  [35.52143,136.18984],[35.5216,136.19018],[35.52187,136.19028],[35.52233,136.18975],[35.52285,136.18971],
  [35.52318,136.18966],[35.52352,136.18938],[35.52388,136.18911],[35.52419,136.18862],[35.52438,136.1884],
  [35.52469,136.18829],[35.52507,136.18832],[35.52548,136.1882],[35.52599,136.18815],[35.5267,136.18827],
  [35.52695,136.18828],[35.52725,136.18828],[35.52764,136.1883],[35.52793,136.18836],[35.52816,136.18867],
  [35.52835,136.18898],[35.52868,136.18932],[35.52894,136.18932],[35.52931,136.18955],[35.52979,136.18948],
  [35.53016,136.18956],[35.53037,136.18973],[35.53105,136.18981],[35.53179,136.18987],[35.53205,136.19],
  [35.53223,136.19035],[35.53223,136.19084],[35.53214,136.19128],
];

function lakeYogoPositions(): Float32Array<ArrayBuffer> {
  const contour = LAKE_YOGO_RING.map(([lat, lon]) => {
    const p = toLocal(lat, lon);
    return new THREE.Vector2(p.x, p.z);
  });
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const raw = new Float32Array(tris.length * 9);
  let k = 0;
  for (const [i0, i1, i2] of tris) {
    const a = contour[i0], b = contour[i1], c = contour[i2];
    // Guarantee upward (+Y) CCW winding in XZ (negative 2D cross product (b-a)x(c-a) yields +Y normal)
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const p1 = cross > 0 ? c : b;
    const p2 = cross > 0 ? b : c;
    raw[k++] = a.x; raw[k++] = 132.8; raw[k++] = a.y;
    raw[k++] = p1.x; raw[k++] = 132.8; raw[k++] = p1.y;
    raw[k++] = p2.x; raw[k++] = 132.8; raw[k++] = p2.y;
  }
  return subdivideWaterTriangles(raw, 48, 132.8);
}

// The lake and the Seta reach above the weir share a surveyed 84.6 m surface, plus Lake Yogo (132.8 m).
// Conforming edge vertices to the actual terrain grid and keeping continuous surface clearance
// prevents coarse shoreline slopes from shrinking Lake Biwa up close or burying the Seta River.
export async function biwaSurface(env:Env,roads:WaterRoads,initialGround?:(x:number,z:number)=>number):Promise<BiwaSurface>{
  const bytes=await loadBinary('kansai/biwa-water.bin'),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const group=new THREE.Group() as BiwaSurface;
  group.name='lake-biwa-and-seta';
  const parts:{geometry:THREE.BufferGeometry;kind:'biwa'|'seta'|'yogo'}[]=[];
  // Seta-no-Karahashi bridge centerline endpoints in local metres (deck height = 88.37-88.43 m).
  const karaW=toLocal(34.9733849,135.9049509),karaE=toLocal(34.9727382,135.9075769);
  const karaDx=karaE.x-karaW.x,karaDz=karaE.z-karaW.z,karaLen2=karaDx*karaDx+karaDz*karaDz;
  const smooth01=(t:number)=>{const c=Math.max(0,Math.min(1,t));return c*c*(3-2*c);};
  const karahashiDist=(x:number,z:number)=>{
    const u=Math.max(-0.1,Math.min(1.1,((x-karaW.x)*karaDx+(z-karaW.z)*karaDz)/karaLen2));
    return Math.hypot(x-(karaW.x+karaDx*u),z-(karaW.z+karaDz*u));
  };
  let offset=8;
  for(const [i,profile] of [[0,[2,.83,.56]],[1,[1,-.16,.987]]] as const){
    const count=view.getUint32(4*i,true);
    let positions=new Float32Array(count*3);
    for(let n=0;n<count;n++){
      positions[n*3]=view.getFloat32(offset,true);
      positions[n*3+1]=85;
      positions[n*3+2]=view.getFloat32(offset+4,true);
      offset+=8;
    }
    const isRiver=i===1;
    // Subdivide river triangles adaptively: 24 m across coarse-DEM Seta Gorge (x > 7000) and
    // 38 m across the finer 30 m Kyoto DEM (Uji River, Three-River Confluence, upper Yodo River).
    if(isRiver)positions=subdivideWaterTriangles(positions,(x)=>x>7000?24:38,85);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    if(isRiver){
      // Suppress vertex camera-pull right underneath Seta-no-Karahashi's low 88.37 m timber/concrete deck,
      // and orient downstream flow per reach (Seta south, Uji west-northwest, Confluence/Yodo southwest).
      const vCount=positions.length/3;
      const stable=new Float32Array(vCount);
      const flow=new Float32Array(vCount*3);
      for(let n=0;n<vCount;n++){
        const vx=positions[n*3],vz=positions[n*3+2];
        const dBridge=karahashiDist(vx,vz);
        stable[n]=dBridge<76?1-smooth01((dBridge-26)/50):0;
        let fx=-0.68,fz=0.73; // Fushimi / Three-River Confluence / Yodo: southwest
        if(vx>11500 && vz<9800){fx=-0.08;fz=0.997;} // Seta upper & Nango: south
        else if(vx>1500){fx=-0.85;fz=-0.52;} // Amagase / Uji River: west-northwest
        flow[n*3]=1;flow[n*3+1]=fx;flow[n*3+2]=fz;
      }
      geometry.setAttribute('aStable',new THREE.BufferAttribute(stable,1));
      geometry.setAttribute('aWater',new THREE.BufferAttribute(flow,3));
    }
    geometry.computeBoundingSphere();
    // Keep tight near-shore uWaterBias=0.35 while uClearance & refit(ground) prevent terrain from burying the channel.
    // Lake Biwa applies polygonOffset against coarse distant shorelines; Seta-Uji-Yodo keeps default depth offset under bridges.
    const material=waterMaterial(env,roads,.35,true);
    if(!isRiver){
      material.polygonOffset=true;
      material.polygonOffsetFactor=-3;
      material.polygonOffsetUnits=-10;
      Object.assign(material.defaultAttributeValues,{aStable:[0],aWater:[...profile]});
    }
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=isRiver?'seta-river':'lake-biwa';
    if(isRiver)mesh.renderOrder=2;
    group.add(mesh);
    parts.push({geometry,kind:isRiver?'seta':'biwa'});
  }
  // Lake Yogo (余呉湖 / 鏡湖) — ultra-calm mountain-rimmed mirror lake north of Lake Biwa.
  {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(lakeYogoPositions(),3));
    geometry.computeBoundingSphere();
    const material=waterMaterial(env,roads,.35,true);
    material.polygonOffset=true;
    material.polygonOffsetFactor=-3;
    material.polygonOffsetUnits=-10;
    Object.assign(material.defaultAttributeValues,{aStable:[0.98],aWater:[2,.83,.56]});
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name='lake-yogo';
    group.add(mesh);
    parts.push({geometry,kind:'yogo'});
  }
  const refit=(ground:(x:number,z:number)=>number)=>{
    for(const {geometry,kind} of parts){
      const attr=geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr=attr.array as Float32Array;
      if(kind==='seta'){
        // Conform smoothly above terrain chords all the way from Lake Biwa (85 m) down through
        // Seta River, Nango Weir, Shishitobi Gorge, Amagase Reservoir, Uji River, Three-River
        // Confluence, and upper Yodo River (joining osaka-water.bin seamlessly at Hirakata).
        for(let i=0;i<arr.length;i+=3){
          const x=arr[i],z=arr[i+2];
          const g0=ground(x,z);
          // Sample at half the subdivided triangle edge (14 m) and bound the lift so coarse
          // 100 m DEM creases stay submerged without ever climbing steep gorge walls.
          const gx=0.5*(ground(x-14,z)+ground(x+14,z));
          const gz=0.5*(ground(x,z-14)+ground(x,z+14));
          const coarseSeta=x>7000;
          const chord=Math.min(g0+(coarseSeta?1.2:0.55),Math.max(g0,gx,gz));
          // Match Lake Biwa's 85 m floor exclusively at the upper Seta River exit (x > 11000).
          const lakeBlend=x>11000?1-smooth01((z-2400)/1800):0;
          const lift=coarseSeta?0.72:0.48;
          let y=Math.max(g0+lift,chord+(coarseSeta?0.55:0.40));
          if(lakeBlend>0)y=Math.max(y,85*lakeBlend+(g0+lift)*(1-lakeBlend));
          // Keep water cleanly below Seta-no-Karahashi's 88.37-88.43 m deck in the immediate 26 m bridge corridor.
          const dBridge=karahashiDist(x,z);
          if(dBridge<76){
            const under=Math.min(87.98,Math.max(87.65,g0+0.25));
            y=under+(y-under)*smooth01((dBridge-26)/50);
          }
          arr[i+1]=y;
        }
      }else{
        const base=kind==='yogo'?132.8:85;
        const cap=kind==='yogo'?134.8:86.2;
        const lift=kind==='yogo'?0.55:.25;
        for(let i=0;i<arr.length;i+=3){
          const g=ground(arr[i],arr[i+2]);
          arr[i+1]=Math.min(cap,Math.max(base,g+lift));
        }
      }
      attr.needsUpdate=true;
      geometry.computeBoundingSphere();
    }
  };
  if(initialGround)refit(initialGround);
  group.refit=refit;
  return group;
}

/** Persistent Osaka Bay harbor basins, Yodo/Kanzaki/Okawa/Ajigawa/Kizugawa/Yamatogawa/Mukogawa rivers & Kobe Port. */
export async function osakaWaterSurface(env:Env,roads:WaterRoads,initialGround?:(x:number,z:number)=>number):Promise<BiwaSurface>{
  const bytes=await loadBinary('kansai/osaka-water.bin'),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const bayVerts=view.getUint32(0,true);
  const riverVerts=view.getUint32(4,true);
  const group=new THREE.Group() as BiwaSurface;
  group.name='osaka-bay-and-rivers';
  const parts:{geometry:THREE.BufferGeometry;isBay:boolean}[]=[];

  let offset=8;
  // Part 0: Osaka Bay / harbor basins (code 5100) — skip offshore KIX & Kobe Airport triangles
  // where regional-ground.ts renderSea() already renders seamless open ocean without polygon color steps.
  if(bayVerts>0){
    const kept:number[]=[];
    for(let n=0;n+2<bayVerts;n+=3){
      const x0=view.getFloat32(offset,true),z0=view.getFloat32(offset+4,true);
      const x1=view.getFloat32(offset+8,true),z1=view.getFloat32(offset+12,true);
      const x2=view.getFloat32(offset+16,true),z2=view.getFloat32(offset+20,true);
      offset+=24;
      const cx=(x0+x1+x2)/3,cz=(z0+z1+z2)/3;
      if(cz>55000 || (cx<-44500 && cz>37200))continue;
      kept.push(x0,0.35,z0,x1,0.35,z1,x2,0.35,z2);
    }
    offset=8+bayVerts*8;
    if(kept.length){
      const positions=new Float32Array(kept);
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      geometry.computeBoundingSphere();
      // Flat coastal harbor water uses tight depth offset without tall camera-pull so it never pokes through seawalls or airports.
      const material=waterMaterial(env,roads,1.1,false);
      material.polygonOffset=true;
      material.polygonOffsetFactor=-1;
      material.polygonOffsetUnits=-4;
      Object.assign(material.defaultAttributeValues,{aStable:[0.95],aWater:[3,0.8,0.6]});
      const mesh=new THREE.Mesh(geometry,material);
      mesh.name='osaka-bay-harbors';
      group.add(mesh);
      parts.push({geometry,isBay:true});
    }
  }

  // Part 1: Major rivers & canals (code 5200) — directional downstream flow stored per triangle vertex.
  if(riverVerts>0){
    const positions=new Float32Array(riverVerts*3);
    const profiles=new Float32Array(riverVerts*3);
    const dirOffset=8+bayVerts*8+riverVerts*8;
    for(let n=0;n<riverVerts;n++){
      positions[n*3]=view.getFloat32(offset,true);
      positions[n*3+1]=0.4;
      positions[n*3+2]=view.getFloat32(offset+4,true);
      offset+=8;
      const fx=view.getInt8(dirOffset+n*2)/127;
      const fz=view.getInt8(dirOffset+n*2+1)/127;
      const len=Math.hypot(fx,fz)||1;
      profiles[n*3]=1;
      profiles[n*3+1]=fx/len;
      profiles[n*3+2]=fz/len;
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('aWater',new THREE.BufferAttribute(profiles,3));
    geometry.computeBoundingSphere();
    const material=waterMaterial(env,roads,1.2,false);
    material.polygonOffset=true;
    material.polygonOffsetFactor=-2;
    material.polygonOffsetUnits=-5;
    Object.assign(material.defaultAttributeValues,{aStable:[0]});
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name='osaka-rivers';
    group.add(mesh);
    parts.push({geometry,isBay:false});
  }

  const refit=(ground:(x:number,z:number)=>number)=>{
    for(const {geometry,isBay} of parts){
      const attr=geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr=attr.array as Float32Array;
      for(let i=0;i<arr.length;i+=3){
        const g=ground(arr[i],arr[i+2]);
        arr[i+1]=isBay?Math.min(1.6,Math.max(0.25,g+0.35)):Math.max(0.35,g+0.48);
      }
      attr.needsUpdate=true;
      geometry.computeBoundingSphere();
    }
  };
  if(initialGround)refit(initialGround);
  group.refit=refit;
  return group;
}

export function buildWater(env:Env,hf:Heightfield,lines:LineFeature[],roads:WaterRoads,
  regionalEdge=18,channel?:KamoChannel,regionalSurface=false) {
  const steps=waterSteps(env,hf,lines,roads,regionalEdge,channel,regionalSurface);
  for(;;){const step=steps.next();if(step.done)return step.value;}
}

/** Prepare regional water in short tasks and discard superseded work before making a mesh. */
export async function buildWaterAsync(env:Env,hf:Heightfield,lines:LineFeature[],roads:WaterRoads,
  regionalEdge:number,channel:KamoChannel|undefined,regionalSurface:boolean,current:()=>boolean) {
  const steps=waterSteps(env,hf,lines,roads,regionalEdge,channel,regionalSurface);
  try {
    while(current()){
      const deadline=performance.now()+5;
      do {const step=steps.next();if(step.done)return step.value;} while(current()&&performance.now()<deadline);
      await yieldTask();
    }
    return null;
  } finally {steps.return(undefined as never);}
}

function toVec(p: Float32Array) {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < p.length; i += 2) out.push(new THREE.Vector2(p[i], p[i + 1]));
  return out;
}
