import * as THREE from 'three';
import {lonLat, tileMetresPerDegree, tileXY, type Point} from '../kansai/coordinates';
import {tileQueue} from '../kansai/tile-queue';
import {type CompiledTile} from '../kansai/tile-compiler';
import {Mesh, building} from '../kansai/mesh';
import {inflate,json} from '../kansai/sources';
import {ENV_GLSL, type Env} from './env';
import {M_PER_DEG_LAT, M_PER_DEG_LON, ORIGIN, toLocal, type Box} from './geo';

type Ground=(x:number,z:number)=>number;
type Layer={x:number;y:number;zoom:number;distance:number};
type Spot=[number,number,unknown,unknown,number[][]];
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

function cityMaterial(env:Env){
  return new THREE.ShaderMaterial({
    uniforms:{...env},
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
      varying vec4 vSurface; varying vec2 vUv; varying vec3 vWorld,vNormal;
      void main(){
        vec3 n=normalize(vNormal),albedo=pow(vSurface.rgb,vec3(2.2));
        vec3 emit=vec3(0.);
        if(vSurface.a>.4 && vSurface.a<.6){
          vec2 cell=vUv/vec2(4.,3.2);
          vec2 edge=abs(fract(cell)-.5),aa=max(fwidth(cell),vec2(.01));
          vec2 pane=1.-smoothstep(vec2(.22)-aa*.5,vec2(.22)+aa*.5,edge);
          float near=1.-smoothstep(.25,1.,max(aa.x,aa.y));
          float lit=step(hash12(floor(cell)+floor(vWorld.xz/30.)),uLit);
          emit=vec3(1.15,.77,.40)*uCity*mix(.16*uLit,pane.x*pane.y*lit,near);
          albedo*=mix(1.,.76,pane.x*pane.y*near);
        }
        gl_FragColor=vec4(applyHaze(shade(seasonalSurface(albedo,n,vWorld),n,vWorld,1.),emit,vWorld),1.);
      }`});
}

function nearMesh(tile:CompiledTile,material:THREE.Material) {
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
  return mesh;
}

async function readSkyline(x:number,y:number,material:THREE.Material,ground:Ground,legacy:Box[],current:()=>boolean){
  const url='/kansai/skyline/'+x+'-'+y+'.json.gz';
  const response=await fetch(url);
  if(!response.ok)throw new Error(url+' '+response.status);
  const rows:Spot[]=JSON.parse(new TextDecoder().decode(await inflate(new Uint8Array(await response.arrayBuffer()))));
  const [lon,lat]=lonLat(x+.5,y+.5,12),center=toLocal(lat,lon);
  const meshData=new Mesh();
  const ranges:{start:number;count:number;tile:string}[]=[];
  for(let i=0;i<rows.length;i++){
    if(i%96===0){
      await new Promise(resolve=>setTimeout(resolve,0));
      if(!current())return null;
    }
    const [height,min,,,rings]=rows[i];
    const polygons=rings.map(r=>{
      const ring:Point[]=[];
      for(let k=0;k<r.length;k+=2){
        const [lo,la]=lonLat(x+r[k]/16384,y+r[k+1]/16384,12),p=toLocal(la,lo);
        ring.push([p.x-center.x,center.z-p.z]);
      }
      return ring;
    });
    const outline=polygons[0];
    if(!outline?.length)continue;
    const xs=outline.map(p=>p[0]),ys=outline.map(p=>p[1]);
    const dx=(Math.min(...xs)+Math.max(...xs))/2,dy=(Math.min(...ys)+Math.max(...ys))/2;
    const px=center.x+dx,pz=center.z-dy;
    if(legacy.some(b=>px>=b[0]&&pz>=b[1]&&px<=b[2]&&pz<=b[3]))continue;
    const base=ground(px,pz),start=meshData.positions.length/3;
    building(meshData,polygons,base+min,base+height,0,((i*16807)%997)/997,'flat',base+min);
    const [tx,ty]=tileXY(ORIGIN.lon+px/M_PER_DEG_LON,ORIGIN.lat-pz/M_PER_DEG_LAT,16).map(Math.floor);
    ranges.push({start,count:meshData.positions.length/3-start,tile:'16/'+tx+'/'+ty});
  }
  const g=meshData.buffers();
  if(!g)return null;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(g.positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(g.normals,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(g.uv,2));
  geometry.setAttribute('surface',new THREE.BufferAttribute(g.colors,4,true));
  const mesh=new THREE.Mesh(geometry,material);
  mesh.rotation.x=-Math.PI/2;
  mesh.position.set(center.x,0,center.z);
  mesh.name='regional-skyline';
  let signature='';
  const indices=new Uint32Array(g.positions.length/3);
  const index=new THREE.BufferAttribute(indices,1).setUsage(THREE.DynamicDrawUsage);
  geometry.setIndex(index);
  const mask=(near:ReadonlySet<string>)=>{
    const next=[...new Set(ranges.map(r=>r.tile).filter(k=>near.has(k)))].join(',');
    if(next===signature && index.version)return;
    signature=next;
    let count=0;
    for(const range of ranges)if(!near.has(range.tile)){
      for(let i=range.start;i<range.start+range.count;i++)indices[count++]=i;
    }
    index.needsUpdate=true;
    geometry.setDrawRange(0,count);
  };
  return {mesh,mask};
}

export async function regionalCity(scene:THREE.Scene,env:Env,ground:Ground,legacy:Box[],lite:boolean){
  const [{tiles},{prefectures}]=await Promise.all([
    json<{tiles:string[]}>('skyline/index.json'),
    json<{prefectures:Record<string,string[]>}>('network/index.json'),
  ]);
  const skyline=new Set(tiles),packs=new Set(Object.values(prefectures).flat());
  const queue=tileQueue(),material=cityMaterial(env);
  type Entry={mesh:THREE.Mesh|null;mask?:(near:ReadonlySet<string>)=>void};
  const loaded=new Map<string,Entry>(),loading=new Set<string>(),retry=new Map<string,number>();
  let wanted=new Map<string,Layer>(),last='',next=0;
  let near=new Set<string>();
  function remask(){
    near=new Set([...loaded].filter(([k,e])=>k.startsWith('16/') && e.mesh).map(([k])=>k));
    for(const entry of loaded.values())entry.mask?.(near);
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
    for(const zoom of insideKyoto?[]:[16,12]){
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
  function update(x:number,z:number,now:number){
    if(now<next)return;
    next=now+.09;
    plan(x,z);
    for(const [id,t] of wanted){
      if(loading.size>=2)break;
      if(loaded.has(id)||loading.has(id)||(retry.get(id)??0)>now)continue;
      loading.add(id);
      const job=t.zoom===16?queue.compile(t.x,t.y,sampleTile(t.x,t.y,ground))
        .then(tile=>({mesh:nearMesh(tile,material)})):
        readSkyline(t.x,t.y,material,ground,legacy,()=>wanted.has(id));
      void job.then(result=>{
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
