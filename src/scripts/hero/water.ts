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
            : clamp(dist * .0095, 2.2, 7.2);
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
function subdivideWaterTriangles(raw: Float32Array, maxEdge: number, defaultY: number): Float32Array<ArrayBuffer> {
  const maxSq = maxEdge * maxEdge;
  const out: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < raw.length; i += 9) {
    stack.push(raw[i], raw[i + 2], raw[i + 3], raw[i + 5], raw[i + 6], raw[i + 8]);
    while (stack.length) {
      const cz = stack.pop()!, cx = stack.pop()!;
      const bz = stack.pop()!, bx = stack.pop()!;
      const az = stack.pop()!, ax = stack.pop()!;
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

// The lake and the Seta reach above the weir share a surveyed 84.6 m surface.
// Conforming edge vertices to the actual terrain grid and keeping continuous surface clearance
// prevents coarse shoreline slopes from shrinking Lake Biwa up close or burying the Seta River.
export async function biwaSurface(env:Env,roads:WaterRoads,initialGround?:(x:number,z:number)=>number):Promise<BiwaSurface>{
  const bytes=await loadBinary('kansai/biwa-water.bin'),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const group=new THREE.Group() as BiwaSurface;
  group.name='lake-biwa-and-seta';
  const parts:{geometry:THREE.BufferGeometry;isRiver:boolean}[]=[];
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
    // Subdivide long 100-300 m river triangles so refit(ground) conforms to channel-center DEM bulges.
    if(isRiver)positions=subdivideWaterTriangles(positions,32,85);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.computeBoundingSphere();
    // Keep tight near-shore uWaterBias=0.35 while uClearance & refit(ground) prevent coarse terrain from swallowing shores or Seta River.
    const material=waterMaterial(env,roads,.35,true);
    if(!isRiver){
      material.polygonOffset=true;
      material.polygonOffsetFactor=-3;
      material.polygonOffsetUnits=-10;
    }
    Object.assign(material.defaultAttributeValues,{aStable:[0],aWater:[...profile]});
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=isRiver?'seta-river':'lake-biwa';
    group.add(mesh);
    parts.push({geometry,isRiver});
  }
  const refit=(ground:(x:number,z:number)=>number)=>{
    for(const {geometry,isRiver} of parts){
      const attr=geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr=attr.array as Float32Array;
      // Keep water strictly below Seta-no-Karahashi (88.2 m) and shoreline roads while clearing coarse grid bulges.
      const cap=isRiver?87.9:86.2;
      const lift=isRiver?1.15:.25;
      for(let i=0;i<arr.length;i+=3){
        const g=ground(arr[i],arr[i+2]);
        arr[i+1]=Math.min(cap,Math.max(85,g+lift));
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
  // Part 0: Osaka Bay / harbor basins (code 5100) — wave/reflection profile matching open ocean & Lake Biwa.
  if(bayVerts>0){
    const positions=new Float32Array(bayVerts*3);
    for(let n=0;n<bayVerts;n++){
      positions[n*3]=view.getFloat32(offset,true);
      positions[n*3+1]=0.35;
      positions[n*3+2]=view.getFloat32(offset+4,true);
      offset+=8;
    }
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
