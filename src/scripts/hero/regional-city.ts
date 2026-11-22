import {districtSampling,type DistrictUniforms} from './regional-districts';
import {regionalNeighborhoods} from './regional-neighborhoods';
import * as THREE from 'three';
import {lonLat, tileMetresPerDegree, tileXY, type Point} from '../kansai/coordinates';
import {tileQueue} from '../kansai/tile-queue';
import {type CompiledTile} from '../kansai/tile-compiler';
import {boundaryUniforms,HOME_BOUNDARY} from './regional-boundary';
import {regionalLandmarks} from './regional-landmarks';
import {skylineReader} from './regional-skyline';
import type {Skyline} from './regional-skyline-data';
import {json} from '../kansai/sources';
import {ENV_GLSL, type Env} from './env';
import {M_PER_DEG_LAT, M_PER_DEG_LON, ORIGIN, toLocal, type Box} from './geo';

type Ground=(x:number,z:number)=>number;
type Layer={x:number;y:number;zoom:number;distance:number};
const key=(t:Layer)=>t.zoom+'/'+t.x+'/'+t.y;

function sampleTile(x:number,y:number,ground:Ground){
  const [west,north]=lonLat(x,y,16),[east,south]=lonLat(x+1,y+1,16);
  const grid=new Float64Array(13*13);
  for(let j=0;j<=12;j++)for(let i=0;i<=12;i++){
    const p=toLocal(south+(north-south)*j/12,west+(east-west)*i/12);
    grid[j*13+i]=ground(p.x,p.z);
  }
  return grid;
}

function cityMaterial(env:Env,boundary:Awaited<ReturnType<typeof boundaryUniforms>>,imagery:DistrictUniforms){
  return new THREE.ShaderMaterial({
    uniforms:{...env,...boundary,...imagery},
    vertexShader:`
      attribute vec4 surface;
      varying vec4 vSurface; varying vec2 vUv; varying vec3 vWorld,vNormal;
      void main(){
        vWorld=(modelMatrix*vec4(position,1.)).xyz;
        vNormal=mat3(modelMatrix)*normal;
        vSurface=surface; vUv=uv;
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
      }`,
    fragmentShader:`
      ${ENV_GLSL}
      ${HOME_BOUNDARY}
      uniform sampler2D uDistrict,uInset;
      uniform vec4 uDistrictBox,uInsetBox;
      ${districtSampling}
      varying vec4 vSurface; varying vec2 vUv; varying vec3 vWorld,vNormal;
      void main(){
        if(owner(vWorld.xz)==0)discard;
        vec3 n=normalize(vNormal),albedo=pow(vSurface.rgb,vec3(2.2));
        vec3 emit=vec3(0.);
        if(vSurface.a>.9){
          vec3 surveyed=overlay(albedo/.68,uDistrict,uDistrictBox,vWorld.xz);
          surveyed=overlay(surveyed,uInset,uInsetBox,vWorld.xz);
          // The aerial already contains daylight; calibrate it to the terrain reflectance first.
          albedo=mix(albedo,surveyed*.68,.62);
        }
        if(vSurface.a>.39 && vSurface.a<.72){
          bool surveyed=abs(vSurface.a-.502)>.035;
          float office=step(.65,vSurface.a), midrise=step(.58,vSurface.a);
          vec2 pitch=surveyed?mix(vec2(2.9,2.9),mix(vec2(3.45,3.12),vec2(2.15,3.62),office),midrise):vec2(4.,3.2);
          vec2 cell=vUv/pitch;
          vec2 edge=abs(fract(cell)-.5),aa=max(fwidth(cell),vec2(.01));
          vec2 opening=surveyed?mix(vec2(.29,.26),vec2(.444,.35),office):vec2(.22);
          vec2 pane=1.-smoothstep(opening-aa*.5,opening+aa*.5,edge);
          float near=1.-smoothstep(.25,1.,max(aa.x,aa.y));
          float lit=step(hash12(floor(cell)+floor(vWorld.xz/30.)),uLit);
          emit=vec3(1.15,.77,.40)*uCity*mix(.16*uLit,pane.x*pane.y*lit,near);
          // Keep the dark window-to-wall ratio even when individual panes fall below one pixel.
          float glass=mix(4.*opening.x*opening.y,pane.x*pane.y,near);
          if(surveyed){
            // Shadow beneath each sill and mullions between office panes. Blend to their average when unresolved.
            float floorJoint=1.-smoothstep(.022-aa.y*.5,.022+aa.y*.5,abs(fract(cell.y+.41)-.5));
            float mullion=1.-smoothstep(.021-aa.x*.5,.021+aa.x*.5,edge.x);
            albedo*=1.-.26*mix(.044,floorJoint,near);
            glass*=1.-office*.68*mix(.042,mullion,near);
            albedo=mix(albedo,albedo*vec3(.23,.31,.37),glass);
          }else albedo*=1.-.47*glass;
          vec3 incident=normalize(vWorld-cameraPosition);
          float fresnel=.035+.17*pow(1.-max(dot(-incident,n),0.),4.);
          vec3 reflection=reflect(incident,n);
          emit+=glass*fresnel*mix(uHorizon*.36,skyColor(reflection),smoothstep(0.,.45,reflection.y));
        }
        gl_FragColor=vec4(applyHaze(shade(seasonalSurface(albedo,n,vWorld),n,vWorld,1.),emit,vWorld),1.);
      }`});
}

function nearMesh(tile:CompiledTile,material:THREE.Material,contains:(p:Point)=>boolean) {
  const g=tile.geometry;
  if(!g)return null;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(g.positions instanceof Float32Array?g.positions:new Float32Array(g.positions),3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(g.normals,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(g.uv,2));
  geometry.setAttribute('surface',new THREE.BufferAttribute(g.colors,4,true));
  const mesh=new THREE.Mesh(geometry,material);
  const [mx,my]=tileMetresPerDegree(tile.center[1]),p=toLocal(tile.center[1],tile.center[0]);
  mesh.rotation.x=-Math.PI/2;
  mesh.scale.set(M_PER_DEG_LON/mx,M_PER_DEG_LAT/my,1);
  mesh.position.set(p.x,0,p.z);
  mesh.name='regional-streets';
  let masked='';
  function mask(){
    const hidden=new Set(tile.locations.flatMap((p,i)=>contains(p)?[i+1]:[]));
    const signature=[...hidden].join(',');
    if(masked===signature)return;
    masked=signature;
    if(!hidden.size){geometry.setIndex(null);return;}
    const indices=[];
    for(let i=0;i<g!.ids.length;i++)if(!hidden.has(g!.ids[i]))indices.push(i);
    geometry.setIndex(indices);
  }
  mask();
  return {mesh,mask};
}

function skylineMesh(g:Skyline,material:THREE.Material){
  const {center,bounds,ranges}=g;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(g.positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(g.normals,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(g.uv,2));
  geometry.setAttribute('surface',new THREE.BufferAttribute(g.colors,4,true));
  const mesh=new THREE.Mesh(geometry,material);
  mesh.rotation.x=-Math.PI/2;
  mesh.position.set(center.x,0,center.z);
  mesh.name='regional-skyline';
  geometry.boundingSphere=new THREE.Box3(new THREE.Vector3(bounds[0],bounds[1],bounds[2]),
    new THREE.Vector3(bounds[3],bounds[4],bounds[5])).getBoundingSphere(new THREE.Sphere());
  const children=[...new Set(ranges.map(r=>r.tile))];
  let signature='';
  const indices=new Uint32Array(g.positions.length/3);
  const index=new THREE.BufferAttribute(indices,1).setUsage(THREE.DynamicDrawUsage);
  const mask=(near:ReadonlySet<string>)=>{
    const next=children.filter(k=>near.has(k)).join(',');
    if(next===signature)return;
    signature=next;
    if(!next){geometry.setIndex(null);geometry.setDrawRange(0,Infinity);return;}
    geometry.setIndex(index);
    let count=0;
    for(const range of ranges)if(!near.has(range.tile)){
      for(let i=range.start;i<range.start+range.count;i++)indices[count++]=i;
    }
    index.needsUpdate=true;
    geometry.setDrawRange(0,count);
  };
  return {mesh,mask};
}

export async function regionalCity(scene:THREE.Scene,env:Env,lights:{sun:THREE.DirectionalLight;sky:THREE.HemisphereLight},ground:Ground,legacy:Box[],lite:boolean,imagery:DistrictUniforms,prepare:(model:THREE.Object3D)=>Promise<unknown>){
  const [{tiles},{prefectures},architecture,boundary,neighborhoods]=await Promise.all([
    json<{tiles:string[]}>('skyline/index.json'),
    json<{prefectures:Record<string,string[]>}>('network/index.json'),
    regionalLandmarks(scene,env,lights,ground,prepare),boundaryUniforms(),regionalNeighborhoods(scene,env,ground,lite,prepare),
  ]);
  const skyline=new Set(tiles),packs=new Set(Object.values(prefectures).flat());
  const readSkyline=skylineReader(ground);
  const queue=tileQueue(false,'orthometric'),material=cityMaterial(env,boundary,imagery);
  let shaderReady:Promise<unknown>|undefined;
  type Entry={mesh:THREE.Mesh|null;mask?:(near:ReadonlySet<string>)=>void};
  const loaded=new Map<string,Entry>(),loading=new Set<string>(),retry=new Map<string,number>();
  let wanted=new Map<string,Layer>(),last='',next=0;
  let near=new Set<string>(),landmarkRevision=0;
  function remask(){
    near=new Set([...loaded].filter(([k,e])=>k.startsWith('16/') && e.mesh).map(([k])=>k));
    neighborhoods.setNear(near);
    for(const [id,entry] of loaded)if(id.startsWith('12/'))entry.mask?.(near);
  }
  function plan(px:number,pz:number){
    const lo=ORIGIN.lon+px/M_PER_DEG_LON,la=ORIGIN.lat-pz/M_PER_DEG_LAT;
    const [cx,cy]=tileXY(lo,la,16).map(Math.floor);
    const signature=cx+'/'+cy;
    if(last===signature)return;
    last=signature;
    const jobs:Layer[]=[];
    const insideKyoto=legacy.some(b=>px>b[0]+1400 && px<b[2]-1400 && pz>b[1]+1400 && pz<b[3]-1400);
    const radius=lite?2:3;
    for(const zoom of insideKyoto?[12]:[16,12]){
      const r=zoom===16?radius:2;
      const [ax,ay]=zoom===16?[cx,cy]:[cx>>4,cy>>4];
      for(let j=-r;j<=r;j++)for(let i=-r;i<=r;i++){
        const x=ax+i,y=ay+j;
        if(zoom===12 ? !skyline.has(x+'/'+y) : !packs.has((x>>4)+'/'+(y>>4)))continue;
        const [w,n]=lonLat(x,y,zoom),[e,s]=lonLat(x+1,y+1,zoom);
        const a=toLocal(n,w),b=toLocal(s,e);
        if(legacy.some(box=>a.x>=box[0] && a.z>=box[1] && b.x<=box[2] && b.z<=box[3]))continue;
        jobs.push({x,y,zoom,distance:i*i+j*j+(zoom===12?2:0)});
      }
    }
    wanted=new Map(jobs.sort((a,b)=>a.distance-b.distance).map(t=>[key(t),t]));
    for(const [id,entry] of loaded)if(!wanted.has(id)){
      if(entry.mesh){scene.remove(entry.mesh);entry.mesh.geometry.dispose();}
      loaded.delete(id);
    }
    for(const id of retry.keys())if(!wanted.has(id))retry.delete(id);
    remask();
  }
  function update(x:number,z:number,dirX:number,dirZ:number,now:number,detail:Box|null){
    if(now<next)return;
    next=now+.09;
    architecture.update(x,z,now);
    neighborhoods.update(x,z,dirX,dirZ,now,detail);
    if(landmarkRevision!==architecture.revision){
      landmarkRevision=architecture.revision;
      for(const [id,entry] of loaded)if(id.startsWith('16/'))entry.mask?.(near);
    }
    plan(x,z);
    for(const [id,t] of wanted){
      if(loading.size>=2)break;
      if(loaded.has(id)||loading.has(id)||(retry.get(id)??0)>now)continue;
      loading.add(id);
      const job=t.zoom===16?queue.compile(t.x,t.y,sampleTile(t.x,t.y,ground))
        .then(tile=>nearMesh(tile,material,architecture.contains)):
        readSkyline({x:t.x,y:t.y,legacy},()=>wanted.has(id)).then(data=>data && wanted.has(id)?skylineMesh(data,material):null);
      void job.then(async result=>{
        if(result?.mesh)await (shaderReady??=prepare(result.mesh));
        if(!wanted.has(id)){result?.mesh?.geometry.dispose();return;}
        loaded.set(id,result??{mesh:null});
        if(result?.mesh){
          scene.add(result.mesh);
          if(t.zoom===16)remask();else loaded.get(id)?.mask?.(near);
        }
      }).catch(error=>{if(!retry.has(id))console.warn('Regional buildings unavailable',id,error);retry.set(id,performance.now()/1000+20);})
        .finally(()=>loading.delete(id));
    }
  }
  return {update};
}
