import {BUILDING_FS,aviationBeaconMaterial,aviationBeaconPoints,buildCityAsync,prepareCityMaterials} from './buildings';
import type {BoxBuilding,PolyBuilding} from './buildings-data';
import {regionalNeighborhoods} from './regional-neighborhoods';
import * as THREE from 'three';
import {lonLat, tileMetresPerDegree, tileXY, type Point} from '../kansai/coordinates';
import {tileQueue} from '../kansai/tile-queue';
import {type CompiledTile} from '../kansai/tile-compiler';
import {buildSacredGeometry,sacredMaterial} from '../kansai/sacred-models';
import {boundaryUniforms,clipCityMaterial,HOME_BOUNDARY} from './regional-boundary';
import {regionalLandmarks} from './regional-landmarks';
import {skylineReader} from './regional-skyline';
import type {Skyline} from './regional-skyline-data';
import {json} from '../kansai/sources';
import {SHADOW_LAYER} from './shadow';
import {ENV_GLSL,SHADOW_GLSL,type Env} from './env';
import {M_PER_DEG_LAT, M_PER_DEG_LON, ORIGIN, toLocal, type Box} from './geo';
import {regionalBudgetForTier,type RegionalQualityBudget} from './adaptive-quality';
import {inOsakaLandmarkMask} from './osaka-landmarks';
import {inAirportBuildingMask} from './airports-data';

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

type Boundary=Awaited<ReturnType<typeof boundaryUniforms>>;
type Architecture=Awaited<ReturnType<typeof regionalLandmarks>>;
type Eye={x:number;y:number;z:number};
type ScheduleDetail=(distance:number,build:()=>void)=>void;
type Entry={mesh:THREE.Object3D|null;cityMaterials?:THREE.Material[];mask?:(near:ReadonlySet<string>)=>void;dispose?:()=>void;lod?:(eye:Eye,schedule:ScheduleDetail)=>boolean};

function streetMaterial(env:Env,boundary:Boundary){
  return new THREE.ShaderMaterial({
    uniforms:{...env,...boundary},
    vertexShader:`
      attribute vec4 surface;
      varying vec3 vWorld,vNormal,vColor;
      void main(){
        vWorld=(modelMatrix*vec4(position,1.)).xyz;
        vNormal=mat3(modelMatrix)*normal;vColor=surface.rgb;
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
      }`,
    fragmentShader:`${ENV_GLSL} ${SHADOW_GLSL} ${HOME_BOUNDARY}
      varying vec3 vWorld,vNormal,vColor;
      void main(){
        // Allow bridges, viaducts and piers crossing Osaka Bay harbors and Lake Biwa (where land owner == 0)
        // so coastal bay spans are never sawtooth-clipped at the shoreline raster edge.
        bool inKansaiWater=(vWorld.x>-76000. && vWorld.x<-18000. && vWorld.z>27000. && vWorld.z<68000.)
                        || (vWorld.x>8000. && vWorld.x<48000. && vWorld.z>-42000. && vWorld.z<8000.);
        if(owner(vWorld.xz)==0 && !inKansaiWater)discard;
        vec3 n=normalize(vNormal);
        vec3 color=shade(seasonalSurface(pow(vColor,vec3(2.2)),n,vWorld),n,vWorld,sunShadow(vWorld,n));
        vec3 emit=vec3(0.);
        if(uCity>.01 && n.y>.5){
          // Warm pools of streetlamp light along regional avenues, viaducts & waterfront promenades at night.
          vec2 p=vWorld.xz;
          float fp=max(length(dFdx(p)),length(dFdy(p)));
          vec2 cell=p/24.;
          float s=hash12(floor(cell));
          vec2 d=fract(cell)-.5;
          float pool=exp(-dot(d,d)*14.)*step(.35,s);
          float soft=mix(pool,.38,smoothstep(4.,14.,fp));
          vec3 lampCol=mix(vec3(1.,.68,.36),vec3(1.,.84,.62),step(.68,s));
          emit=lampCol*(.010+.038*soft)*uCity*cityLightShimmer(vWorld);
        }
        gl_FragColor=vec4(applyHaze(color,emit,vWorld),1.);
      }`});
}

/** Surveyed setbacks, courtyards and irregular ridges retain their triangles. Feed them
 * the same wall coordinates, class, roof roles and window shader as a Kyoto polygon. */
function surveyedMaterial(env:Env,boundary:Boundary){
  return clipCityMaterial(new THREE.ShaderMaterial({uniforms:env,fragmentShader:BUILDING_FS,vertexShader:`
    attribute vec4 surface;
    attribute vec3 identity;
    varying vec3 vWorld,vNormal;
    varying vec2 vWall;
    flat varying vec4 vInfo;
    void main(){
      vWorld=(modelMatrix*vec4(position,1.)).xyz;
      vNormal=normalize(mat3(modelMatrix)*normal);
      bool roof=surface.a>.9;
      vWall=roof?vWorld.xz:uv;
      vInfo=vec4(identity.x,identity.y/65535.,identity.z*.25,roof?(vNormal.y<.998?1.:3.):0.);
      gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
    }`}),boundary);
}

function streetMesh(tile:CompiledTile,materials:THREE.Material[],contains:(p:Point)=>boolean) {
  const g=tile.geometry;
  if(!g)return null;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(g.positions instanceof Float32Array?g.positions:new Float32Array(g.positions),3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(g.normals,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(g.uv,2));
  geometry.setAttribute('surface',new THREE.BufferAttribute(g.colors,4,true));
  const identity=new Uint16Array(g.ids.length*3);
  let buildings=0;
  // The compiler appends the ground after all building meshes.
  while(buildings<g.ids.length && g.ids[buildings]){
    identity.set(tile.facades![g.ids[buildings]-1],buildings*3);buildings++;
  }
  geometry.setAttribute('identity',new THREE.BufferAttribute(identity,3));
  const mesh=new THREE.Mesh(geometry,materials);
  const [mx,my]=tileMetresPerDegree(tile.center[1]),p=toLocal(tile.center[1],tile.center[0]);
  mesh.rotation.x=-Math.PI/2;
  mesh.scale.set(M_PER_DEG_LON/mx,M_PER_DEG_LAT/my,1);
  mesh.position.set(p.x,0,p.z);
  mesh.name='regional-streets';
  let masked:string|undefined;
  function mask(){
    const hidden=new Set(tile.locations.flatMap((p,i)=>contains(p)?[i+1]:[]));
    const signature=[...hidden].join(',');
    if(masked===signature)return;
    masked=signature;
    let visible=buildings;
    geometry.clearGroups();
    if(!hidden.size)geometry.setIndex(null);
    else{
      const indices=[];
      for(let i=0;i<buildings;i++)if(!hidden.has(g!.ids[i]))indices.push(i);
      visible=indices.length;
      for(let i=buildings;i<g!.ids.length;i++)indices.push(i);
      geometry.setIndex(indices);
    }
    if(visible)geometry.addGroup(0,visible,0);
    if(g!.ids.length>buildings)geometry.addGroup(visible,g!.ids.length-buildings,1);
  }
  mask();
  return {mesh,mask};
}

async function nearMesh(tile:CompiledTile,materials:THREE.Material[],sacredMat:THREE.Material,env:Env,boundary:Boundary,ground:Ground,
  architecture:Architecture,lite:boolean,current:()=>boolean):Promise<Entry|null>{
  const maskedPoint=(p:Point)=>{
    if(architecture.contains(p))return true;
    const lp=toLocal(p[1],p[0]);
    return inOsakaLandmarkMask(lp.x,lp.z)||inAirportBuildingMask(lp.x,lp.z);
  };
  const group=new THREE.Group(),street=streetMesh(tile,materials,maskedPoint);
  if(street){group.add(street.mesh);street.mesh.layers.enable(SHADOW_LAYER);}
  type Site=ReturnType<Architecture['siteAt']>;
  const sites=new Map<Site,{boxes:BoxBuilding[];polys:PolyBuilding[]}>();
  for(const b of tile.city??[]){
    const isBox='x' in b;
    const x=isBox?b.x:b.ring[0],z=isBox?b.z:b.ring[1];
    let cx=x,cz=z;
    if(!isBox){
      let west=x,east=x,north=z,south=z;
      for(let i=2;i<b.ring.length;i+=2){
        west=Math.min(west,b.ring[i]);east=Math.max(east,b.ring[i]);
        north=Math.min(north,b.ring[i+1]);south=Math.max(south,b.ring[i+1]);
      }
      cx=(west+east)*.5;cz=(north+south)*.5;
    }
    if(inOsakaLandmarkMask(cx,cz)||inAirportBuildingMask(cx,cz))continue;
    const site=architecture.siteAt([ORIGIN.lon+cx/M_PER_DEG_LON,ORIGIN.lat-cz/M_PER_DEG_LAT]);
    let data=sites.get(site);
    if(!data){data={boxes:[],polys:[]};sites.set(site,data);}
    b.ground-=ground(x,z);
    if(isBox)data.boxes.push(b);else data.polys.push(b);
  }
  const sacredBySite=new Map<Site,NonNullable<CompiledTile['sacred']>>();
  for(const s of tile.sacred??[]){
    const site=architecture.siteAt([s.lon,s.lat]);
    let list=sacredBySite.get(site);
    if(!list){list=[];sacredBySite.set(site,list);}
    list.push(s);
  }
  const sacredMeshes:{site:Site;mesh:THREE.Mesh}[]=[];
  for(const [site,list] of sacredBySite){
    const geo=buildSacredGeometry(list,ground);
    if(!geo)continue;
    const mesh=new THREE.Mesh(geo,sacredMat);
    mesh.name='regional-sacred-buildings';
    mesh.layers.enable(SHADOW_LAYER);
    group.add(mesh);
    sacredMeshes.push({site,mesh});
  }
  const cities:{site:Site;city:NonNullable<Awaited<ReturnType<typeof buildCityAsync>>>}[]=[];
  const dispose=()=>{
    street?.mesh.geometry.dispose();
    for(const {mesh} of sacredMeshes)mesh.geometry.dispose();
    for(const {city} of cities)city.dispose();
  };
  try{
    for(const [site,data] of sites){
      const city=await buildCityAsync(env,{height:ground},data,()=>true,lite ? .6 : 1,current,()=>false,undefined,undefined,false);
      if(!city){dispose();return null;}
      cities.push({site,city});
      for(const mat of city.materials)clipCityMaterial(mat,boundary);
      city.group.traverse(o=>{if(o.userData.depthMaterial)o.layers.enable(SHADOW_LAYER);});
      city.group.name='regional-kyoto-buildings';
      group.add(city.group);
    }
    const mask=()=>{
      street?.mask();
      for(const {site,city} of cities)city.group.visible=!site?.group;
      for(const {site,mesh} of sacredMeshes)mesh.visible=!site?.group;
    };
    mask();
    return group.children.length?{mesh:group,cityMaterials:cities[0]?.city.materials,mask,dispose,lod:(eye,schedule)=>{
      let changed=false;
      for(const {city} of cities)if(city.group.visible)changed=city.updateLod(eye,0,schedule)||changed;
      return changed;
    }}:null;
  }catch(error){dispose();throw error;}
}

function skylineMesh(g:Skyline,material:THREE.Material,beaconMat:THREE.ShaderMaterial){
  const {center,bounds,ranges}=g;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(g.positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(g.normals,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(g.uv,2));
  geometry.setAttribute('surface',new THREE.BufferAttribute(g.colors,4,true));
  geometry.setAttribute('identity',new THREE.BufferAttribute(g.identity,3));
  const mesh=new THREE.Mesh(geometry,material);
  mesh.rotation.x=-Math.PI/2;
  mesh.position.set(center.x,0,center.z);
  mesh.name='regional-skyline';
  geometry.boundingSphere=new THREE.Box3(new THREE.Vector3(bounds[0],bounds[1],bounds[2]),
    new THREE.Vector3(bounds[3],bounds[4],bounds[5])).getBoundingSphere(new THREE.Sphere());
  const beacons=aviationBeaconPoints(g.beaconPos,g.beaconMeta,beaconMat);
  if(beacons)mesh.add(beacons);
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
  return {mesh,mask,dispose:()=>{geometry.dispose();beacons?.geometry.dispose();}};
}

export async function regionalCity(scene:THREE.Scene,env:Env,lights:{sun:THREE.DirectionalLight;sky:THREE.HemisphereLight},ground:Ground,legacy:Box[],lite:boolean,prepare:(model:THREE.Object3D)=>Promise<unknown>,invalidateShadow:()=>void){
  const [{tiles},{prefectures},architecture,boundary,neighborhoods]=await Promise.all([
    json<{tiles:string[]}>('skyline/index.json'),
    json<{prefectures:Record<string,string[]>}>('network/index.json'),
    regionalLandmarks(scene,env,lights,ground,prepare),boundaryUniforms(),regionalNeighborhoods(scene,env,ground,lite,prepare),
  ]);
  const skyline=new Set(tiles),packs=new Set(Object.values(prefectures).flat());
  const readSkyline=skylineReader(ground);
  const queue=tileQueue(false,'orthometric'),material=surveyedMaterial(env,boundary);
  const beaconMat=aviationBeaconMaterial(env);
  const streetMaterials=[material,streetMaterial(env,boundary)];
  const sacredMat=sacredMaterial(env,boundary);
  const warmStreetMaterials=[...streetMaterials,sacredMat];
  let shadowDirty=false,nextShadow=0;
  let skylineReady:Promise<unknown>|undefined,streetReady:Promise<unknown>|undefined,cityReady:Promise<unknown>|undefined;

  const loaded=new Map<string,Entry>(),loading=new Set<string>(),retry=new Map<string,number>();
  let wanted=new Map<string,Layer>(),last='',next=0;
  let near=new Set<string>(),landmarkRevision=0;
  function remask(){
    near=new Set([...loaded].filter(([k,e])=>k.startsWith('16/') && e.mesh).map(([k])=>k));
    neighborhoods.setNear(near);
    for(const [id,entry] of loaded)if(id.startsWith('12/'))entry.mask?.(near);
  }
  const defaultBudget=regionalBudgetForTier(lite?0:2);
  function plan(px:number,pz:number,dirX:number,dirZ:number,eye:Eye,budget:RegionalQualityBudget){
    const lo=ORIGIN.lon+px/M_PER_DEG_LON,la=ORIGIN.lat-pz/M_PER_DEG_LAT;
    const [tx16,ty16]=tileXY(lo,la,16);
    const [ex16,ey16]=tileXY(ORIGIN.lon+eye.x/M_PER_DEG_LON,ORIGIN.lat-eye.z/M_PER_DEG_LAT,16);
    const cx=Math.floor(tx16),cy=Math.floor(ty16),ex=Math.floor(ex16),ey=Math.floor(ey16);
    const heading=Math.round(Math.atan2(dirX,-dirZ)*4);
    const signature=[cx,cy,ex,ey,heading,budget.tier].join('/');
    if(last===signature)return;
    last=signature;
    const jobs:Layer[]=[];
    const insideKyoto=legacy.some(b=>px>b[0]+1400 && px<b[2]-1400 && pz>b[1]+1400 && pz<b[3]-1400);
    for(const zoom of insideKyoto?[12]:[16,12]){
      const maxR=zoom===16?budget.detailRadius:budget.skylineRadius;
      const span=Math.ceil(maxR);
      const [ftx,fty]=zoom===16?[tx16,ty16]:[tx16/16,ty16/16];
      const ax=Math.floor(ftx),ay=Math.floor(fty);
      for(let j=-span;j<=span;j++)for(let i=-span;i<=span;i++){
        const x=ax+i,y=ay+j;
        if(zoom===12 ? !skyline.has(x+'/'+y) : !packs.has((x>>4)+'/'+(y>>4)))continue;
        // Isotropic Euclidean circle so turning the camera never shows farther at screen edges than center.
        const dx=x+.5-ftx,dz=y+.5-fty,radial=Math.hypot(dx,dz);
        if(radial>maxR)continue;
        const [w,n]=lonLat(x,y,zoom),[e,s]=lonLat(x+1,y+1,zoom);
        const a=toLocal(n,w),b=toLocal(s,e);
        if(legacy.some(box=>a.x>=box[0] && a.z>=box[1] && b.x<=box[2] && b.z<=box[3]))continue;
        const forward=(dx*dirX+dz*dirZ)/Math.max(.01,radial);
        // Load tiles straight ahead first while keeping the outer boundary strictly circular.
        jobs.push({x,y,zoom,distance:radial*(1-.35*Math.max(0,forward))+(zoom===12?2.2:0)});
      }
    }
    const previous=wanted;
    wanted=new Map(jobs.sort((a,b)=>a.distance-b.distance).map(t=>[key(t),t]));
    // Keep already-loaded tiles inside a slightly larger circular hysteresis band or around the departure eye.
    for(const [id,t] of previous){
      if(wanted.has(id) || !loaded.has(id))continue;
      const keepR=(t.zoom===16?budget.detailRadius+.75:budget.skylineRadius+.55);
      const [ftx,fty]=t.zoom===16?[tx16,ty16]:[tx16/16,ty16/16];
      const [fex,fey]=t.zoom===16?[ex16,ey16]:[ex16/16,ey16/16];
      if(Math.hypot(t.x+.5-ftx,t.y+.5-fty)<=keepR || Math.hypot(t.x+.5-fex,t.y+.5-fey)<=keepR)wanted.set(id,t);
    }
    for(const [id,entry] of loaded)if(!wanted.has(id)){
      if(entry.mesh)scene.remove(entry.mesh);
      if(id.startsWith('16/') && entry.mesh)shadowDirty=true;
      entry.dispose?.();
      loaded.delete(id);
    }
    for(const id of retry.keys())if(!wanted.has(id))retry.delete(id);
    remask();
  }
  function update(x:number,z:number,dirX:number,dirZ:number,now:number,detail:Box|null,eye:Eye,budget:RegionalQualityBudget=defaultBudget){
    let pick: {distance:number;build?:()=>void}={distance:Infinity};
    const schedule:ScheduleDetail=(distance,build)=>{if(distance<pick.distance)pick={distance,build};};
    for(const entry of loaded.values())if(entry.lod?.(eye,schedule))shadowDirty=true;
    pick.build?.();
    if(shadowDirty && now>=nextShadow){invalidateShadow();shadowDirty=false;nextShadow=now+.25;}
    if(now<next)return;
    next=now+.09;
    architecture.update(eye.x,eye.z,now);
    neighborhoods.update(x,z,dirX,dirZ,now,detail,eye,budget);
    if(landmarkRevision!==architecture.revision){
      landmarkRevision=architecture.revision;shadowDirty=true;
      for(const [id,entry] of loaded)if(id.startsWith('16/'))entry.mask?.(near);
    }
    plan(x,z,dirX,dirZ,eye,budget);
    for(const [id,t] of wanted){
      if(loading.size>=budget.buildingConcurrency)break;
      if(loaded.has(id)||loading.has(id)||(retry.get(id)??0)>now)continue;
      loading.add(id);
      const job=t.zoom===16?queue.compile(t.x,t.y,sampleTile(t.x,t.y,ground))
        .then(tile=>wanted.has(id)?nearMesh(tile,streetMaterials,sacredMat,env,boundary,ground,architecture,lite,()=>wanted.has(id)):null):
        readSkyline({x:t.x,y:t.y,legacy},()=>wanted.has(id)).then(data=>data && wanted.has(id)?skylineMesh(data,material,beaconMat):null);
      void job.then(async result=>{
        if(result?.mesh){
          if(t.zoom===16){
            await (streetReady??=prepareCityMaterials(warmStreetMaterials,prepare));
            if('cityMaterials' in result && result.cityMaterials)await (cityReady??=prepareCityMaterials(result.cityMaterials,prepare));
          }else await (skylineReady??=prepare(result.mesh));
        }
        if(!wanted.has(id)){result?.dispose?.();return;}
        if(t.zoom===16 && result){result.mask?.(near);shadowDirty=true;}
        loaded.set(id,result??{mesh:null});
        if(result?.mesh){
          scene.add(result.mesh);
          if(t.zoom===16)remask();else loaded.get(id)?.mask?.(near);
        }
      }).catch(error=>{if(!retry.has(id))console.warn('Regional buildings unavailable',id,error);retry.set(id,performance.now()/1000+20);})
        .finally(()=>loading.delete(id));
    }
  }
  return {update,excludesTree:architecture.excludesTree};
}
