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

export function waterMaterial(env:Env,roads:WaterRoads,bias:number){
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...roads,uWaterBias:{value:bias} },
    vertexShader: /* glsl */ `
      attribute float aStable;
      attribute vec3 aWater;
      uniform float uWaterBias;
      varying float vStable;
      varying vec3 vWater;
      varying vec3 vWorld;
      void main(){
        vec3 p = position;
        vWorld = p;
        vStable=aStable;vWater=aWater;
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
      varying vec3 vWater;
      void main(){
        vec2 q = vWorld.xz;
        float footprint=max(length(dFdx(q)),length(dFdy(q)));
        Road road = roadAt(q);
        if (road.edge <= 0. && vStable<.001) discard;
        bool lake=vWater.x>1.5,river=vWater.x>.5&&!lake;
        vec2 axis=normalize(vWater.yz),crosswind=vec2(-axis.y,axis.x);
        vec2 along=vec2(dot(q,axis),dot(q,crosswind));
        float t=uTime*(lake?.42:river?.60:.15);
        vec2 phase=along*(lake?vec2(.22,.43):river?vec2(.38,.92):vec2(.18,.22));
        float broad=1.-smoothstep(.6,5.,footprint),fine=1.-smoothstep(.18,1.3,footprint);
        float envelope=vnoise(q*.015);
        float a=sin(phase.x+2.8*envelope-t)*broad;
        float b=sin(phase.y+.65*phase.x+4.*envelope+t*.73)*fine;
        float ripple=lake?.050:river?.038:.012;
        vec2 slope=ripple*(axis*a+crosswind*b*.63);
        vec3 n=normalize(vec3(slope.x,1.,slope.y));
        vec3 view=normalize(vWorld-cameraPosition),r=reflect(view,n);
        r.y=clamp(abs(r.y)+(lake?.05:river?.085:.018),.02,1.);
        float facing=clamp(dot(-view,n),0.,1.);
        float fres=.025+.83*pow(1.-facing,4.5);
        vec3 deep=lake?vec3(.009,.033,.044):river?vec3(.023,.041,.034):vec3(.019,.034,.025);
        vec3 ambient=skyLight(vec3(0.,1.,0.))+uSunLight*max(uSunDir.y,0.);
        vec3 col=mix(deep*ambient,skyColor(normalize(r)),fres);
        float gloss=lake?100.:river?68.:150.;
        float glint=pow(max(dot(normalize(r),uSunDir),0.),gloss);
        col+=uSunLight*glint*.35+uMoonLight*pow(max(dot(normalize(r),uMoonDir),0.),gloss)*2.5;
        gl_FragColor=vec4(applyHaze(col,vec3(0.),vWorld),1.);
      }
    `,
  });
}

// The lake and the Seta reach above the weir share a surveyed 84.6 m surface.
// Its small lift matches the detailed water in the basin, with no per-tile camera bias.
export async function biwaSurface(env:Env,roads:WaterRoads){
  const bytes=await loadBinary('kansai/biwa-water.bin'),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const group=new THREE.Group();
  group.name='lake-biwa-and-seta';
  let offset=8;
  for(const [i,profile] of [[0,[2,.83,.56]],[1,[1,-.16,.987]]] as const){
    const count=view.getUint32(4*i,true);
    const positions=new Float32Array(count*3);
    for(let n=0;n<count;n++){
      positions[n*3]=view.getFloat32(offset,true);
      positions[n*3+1]=85;
      positions[n*3+2]=view.getFloat32(offset+4,true);
      offset+=8;
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.computeBoundingSphere();
    const material=waterMaterial(env,roads,.35);
    Object.assign(material.defaultAttributeValues,{aStable:[0],aWater:[...profile]});
    group.add(new THREE.Mesh(geometry,material));
  }
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
