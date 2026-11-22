import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {inRing, type Point, type Ring} from '../kansai/coordinates';
import {json} from '../kansai/sources';
import {toLocal} from './geo';
import type {Env} from './env';

interface Record {id:string;lon:number;lat:number;file:string;rings:Ring[]}
// These structures already use Kyoto's bespoke materials or its station cutout.
const kyoto=new Set(['station-district','kyotoTower','toji','tojiKondo','tojiKodo','tojiJikido','yasaka','kiyomizu',
  'heianTorii','heianShrine','goldenPavilion','shishinden','ryoanji','kiyomizuHall','togetsukyo','imperial-palace','nijo-castle','byodoin','inari']);

function dispose(group:THREE.Object3D){
  const geometry=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  group.traverse(obj=>{
    if(!(obj instanceof THREE.Mesh))return;
    geometry.add(obj.geometry);
    for(const m of Array.isArray(obj.material)?obj.material:[obj.material])materials.add(m);
  });
  for(const g of geometry)g.dispose();
  for(const m of materials){
    for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);
    m.dispose();
  }
  const images=new Set<ImageBitmap>();
  for(const t of textures){
    if(typeof ImageBitmap!=='undefined' && t.image instanceof ImageBitmap)images.add(t.image);
    t.dispose();
  }
  for(const image of images)image.close();
}

export async function regionalLandmarks(scene:THREE.Scene,env:Env,lights:{sun:THREE.DirectionalLight;sky:THREE.HemisphereLight},ground:(x:number,z:number)=>number,prepare:(model:THREE.Object3D)=>Promise<unknown>){
  const catalogue=await json<Record[]>('landmarks/index.json');
  const rows=catalogue.filter(row=>!kyoto.has(row.id)).map(row=>({...row,...toLocal(row.lat,row.lon),group:null as THREE.Object3D|null,
    distance:Infinity,pending:false,retry:0}));
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const {sun,sky}=lights;
  let revision=0,pending=0,next=0;
  function update(x:number,z:number,now:number){
    if(now<next)return;
    next=now+.2;
    sun.color.copy(env.uSunLight.value).add(env.uMoonLight.value);
    sun.position.copy(env.uCity.value>.8?env.uMoonDir.value:env.uSunDir.value);
    sky.color.copy(env.uMid.value).lerp(env.uHorizon.value,.4).multiplyScalar(1.15);
    sky.groundColor.copy(env.uHorizon.value).multiplyScalar(.38);
    for(const r of rows){
      r.distance=Math.hypot(r.x-x,r.z-z);
      if(r.group && r.distance>4200){
        scene.remove(r.group);dispose(r.group);r.group=null;revision++;
      }
    }
    for(const r of rows.sort((a,b)=>a.distance-b.distance)){
      if(pending>=2 || r.distance>3100)break;
      if(r.group || r.pending || r.retry>now)continue;
      r.pending=true;pending++;
      void loader.loadAsync(r.file).then(async({scene:model})=>{
        await prepare(model);
        if(r.distance>4200){dispose(model);return;}
        model.position.set(r.x,ground(r.x,r.z),r.z);
        model.name=r.id;
        scene.add(model);r.group=model;revision++;
      }).catch(e=>{r.retry=performance.now()/1000+20;console.warn('Landmark model unavailable',r.id,e);})
        .finally(()=>{r.pending=false;pending--;});
    }
  }
  return {update,get revision(){return revision;},contains(p:Point){
    return rows.some(r=>r.group && Math.abs(r.lon-p[0])<.008 && Math.abs(r.lat-p[1])<.007 && r.rings.some(ring=>inRing(p,ring)));
  }};
}
