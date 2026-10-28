import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { LINE, type LineFeature } from './lines-data';
import { ROAD_GLSL } from './roads';
import {refineWaterSurfaceSteps} from './water-surface';
import {toLocal} from './geo';
import type {KamoChannel} from './kamo-channel';

const senkoji=toLocal(35.0157751,135.6655983);

/**
 * Rivers, the castle moat and ponds from the GSI water areas. The surface mirrors the sky,
 * glitters toward the sun and, after dark, shimmers with the lights along its banks.
 * Vertices are pulled a few metres toward the camera so the coarse terrain mesh, which
 * smooths over narrow channels, never hides them; buildings still do.
 */
type WaterRoads = {
  uRoads: { value: THREE.Texture | null };
  uRoadBox: { value: THREE.Vector4 };
  uRoadsOn: { value: number };
  uRegionRoads:{value:THREE.Texture};
  uRegionRoadBox:{value:THREE.Vector4};
  uRegionRoadsOn:{value:number};
};

function* waterSteps(env: Env, hf: Heightfield, lines: LineFeature[], roads: WaterRoads,
  regionalEdge=18,channel?:KamoChannel,regionalSurface=false) {
  const pos: number[] = [];
  const stable:number[]=[];
  let trianglesBuilt=0;
  for (let i = 0; i < lines.length; i++) {
    if(i && i%128===0)yield;
    const f = lines[i];
    if (f.kind !== LINE.water) continue;
    const ring = toVec(f.pts);
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
        try {refined=yield* refineWaterSurfaceSteps(all,tris,edge,40000,f.attr===1?{x:senkoji.x,y:senkoji.z}:undefined);break;} catch { /* retry coarser, never drop water */ }
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
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aStable',new THREE.Float32BufferAttribute(stable,1));
  geo.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...roads,uWaterBias:{value:regionalSurface?.35:30} },
    vertexShader: /* glsl */ `
      attribute float aStable;
      uniform float uWaterBias;
      varying float vStable;
      varying vec3 vWorld;
      void main(){
        vec3 p = position;
        vWorld = p;
        vStable=aStable;
        vec3 toCam = cameraPosition - p;
        float dist = length(toCam);
        p += toCam / max(dist,.01) * min(dist * .004, uWaterBias) * (1.-aStable);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${ROAD_GLSL}
      varying vec3 vWorld;
      varying float vStable;
      void main(){
        vec2 q = vWorld.xz;
        float footprint=max(length(dFdx(q)),length(dFdy(q)));
        float fine=1.-smoothstep(.2,.65,footprint);
        float broad=1.-smoothstep(.8,2.,footprint);
        // Sample before discarding so the road texture's mip level remains well defined.
        // The road painted on the terrain and its cars must remain visible across rivers.
        Road road = roadAt(q);
        if (road.edge <= 0. && vStable<.001) discard;
        float t = uTime;
        vec2 w = vec2(vnoise(q * .35 + vec2(t * .3, 0.)) - .5, vnoise(q * .35 + vec2(0., t * .25) + 9.) - .5);
        w *= broad;
        w += fine * .25 * vec2(vnoise(q * 1.4 - t * .5) - .5, vnoise(q * 1.4 + 3. + t * .4) - .5);
        vec3 n = normalize(vec3(w.x * .07, 1., w.y * .07));
        vec3 v = normalize(vWorld - cameraPosition);
        vec3 r = reflect(v, n);
        r.y = abs(r.y);
        float fres = .03 + .97 * pow(clamp(1. - dot(-v, n), 0., 1.), 5.);
        vec3 deep = vec3(.006, .014, .014);
        vec3 col = deep * (uSunLight * max(uSunDir.y, 0.) + skyLight(vec3(0., 1., 0.))) + skyColor(r) * fres;
        // glints break up on the ripples instead of lighting a whole narrow moat or pond
        col += uSunLight * pow(max(dot(r, uSunDir), 0.), 160.) * 1.4 * mix(1., .35 + 1.3 * vnoise(q * .6 + t * .4), broad);
        col += uMoonLight * pow(max(dot(r, uMoonDir), 0.), 120.) * 30.;
        // reflected bank lights: vertical streaks that break up with the ripples
        float streak = vnoise(vec2(q.x * .25 + q.y * .25, t * .6) + w * 4.);
        vec3 emit = vec3(1., .66, .34) * mix(.12,smoothstep(.55, .95, streak),broad) * .35 * uCity;
        gl_FragColor = vec4(applyHaze(col, emit, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
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
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    return null;
  } finally {steps.return(undefined as never);}
}

function toVec(p: Float32Array) {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < p.length; i += 2) out.push(new THREE.Vector2(p[i], p[i + 1]));
  return out;
}
