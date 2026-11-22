import * as THREE from 'three';
import {decodeTreeCover} from './tree-cover';
import {loadBinary,loadGrid, loadJSON, loadTexture, type GridMeta} from './data';
import {ENV_GLSL, type Env} from './env';
import type {Box} from './geo';
import {boundaryUniforms,HOME_BOUNDARY} from './regional-boundary';
import {regionalPhoto,type RegionalPhoto} from './regional-photo';
import {Grid,type Heightfield} from './heightfield';
import {districtImagery,type District} from './regional-districts';

interface Patch {box: Box; file: string}
interface GroundSurvey {grid: GridMeta; patches: Patch[]}
type Ground = (x:number,z:number)=>number;

export function boxDistance(x:number,z:number,b:Box) {
  return Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-z,0,z-b[3]));
}

function patchAxis(lo:number,hi:number,edge0:number,edge1:number,step:number,fine:number[][]) {
  const values = new Set([lo,hi]);
  for(let n=lo+step;n<hi;n+=step)values.add(n);
  for(const [start,end] of fine){
    for(let n=Math.max(lo,start);n<Math.min(hi,end);n+=40)values.add(n);
  }
  for(const edge of [edge0,edge1])if(edge>lo && edge<hi)values.add(edge);
  return [...values].sort((a,b)=>a-b);
}

function patchGeometry(box:Box, kyoto:Box, ground:Ground,fine:Grid[]) {
  const overlap=fine.map(g=>g.meta.box).filter(b=>b[0]<box[2] && b[2]>box[0] && b[1]<box[3] && b[3]>box[1]);
  const xs=patchAxis(box[0],box[2],kyoto[0],kyoto[2],200,overlap.map(b=>[b[0],b[2]]));
  const zs=patchAxis(box[1],box[3],kyoto[1],kyoto[3],200,overlap.map(b=>[b[1],b[3]]));
  const pos=new Float32Array(xs.length*zs.length*3),uv=new Float32Array(xs.length*zs.length*2);
  const indices:number[]=[];
  for(let j=0;j<zs.length;j++)for(let i=0;i<xs.length;i++){
    const k=j*xs.length+i,x=xs[i],z=zs[j];
    pos.set([x,ground(x,z),z],k*3);
    uv.set([(x-box[0])/(box[2]-box[0]),1-(z-box[1])/(box[3]-box[1])],k*2);
    if(i+1===xs.length || j+1===zs.length)continue;
    if(x>=kyoto[0] && xs[i+1]<=kyoto[2] && z>=kyoto[1] && zs[j+1]<=kyoto[3])continue;
    indices.push(k,k+xs.length,k+1,k+1,k+xs.length,k+xs.length+1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vWorld,vNormal;
  void main(){
    vUv=uv; vWorld=position; vNormal=normal;
    gl_Position=projectionMatrix*viewMatrix*vec4(position,1.);
  }`;
const fragmentShader = `
  uniform sampler2D uPhoto,uClose,uDistrict,uInset;
  uniform vec4 uCloseBox,uDistrictBox,uInsetBox;
  varying vec2 vUv;
  varying vec3 vWorld,vNormal;
  ${ENV_GLSL}
  ${HOME_BOUNDARY}
  vec3 overlay(vec3 base,sampler2D map,vec4 box){
    vec2 uv=(vWorld.xz-box.xy)/max(vec2(1.),box.zw-box.xy);
    if(any(lessThanEqual(uv,vec2(0.))) || any(greaterThanEqual(uv,vec2(1.))))return base;
    vec4 aerial=texture2D(map,vec2(uv.x,1.-uv.y));
    vec2 edge=min(uv,1.-uv);
    return mix(base,aerial.rgb,aerial.a*smoothstep(0.,.03,min(edge.x,edge.y)));
  }
  void main(){
    vec4 photo=texture2D(uPhoto,vUv);
    if(photo.a<.18)discard;
    int prefectureCode=owner(vWorld.xz);
    if(photo.a<.62 && prefectureCode==0){
      vec3 direction=normalize(vWorld-cameraPosition);
      float fresnel=pow(1.-clamp(-direction.y,0.,1.),3.);
      vec3 water=mix(shade(vec3(.024,.086,.105),vec3(0.,1.,0.),vWorld,1.),skyColor(reflect(direction,vec3(0.,1.,0.))),.09+.45*fresnel);
      gl_FragColor=vec4(applyHaze(water,vec3(0.),vWorld),1.);
      return;
    }
    if(prefectureCode==0)discard;
    photo.rgb=overlay(photo.rgb,uDistrict,uDistrictBox);
    photo.rgb=overlay(photo.rgb,uInset,uInsetBox);
    photo.rgb=overlay(photo.rgb,uClose,uCloseBox);
    vec3 n=normalize(vNormal);
    vec3 albedo=surveyedGroundAlbedo(photo.rgb);
    vec3 lit=shade(seasonalSurface(albedo,n,vWorld),n,vWorld,1.);
    gl_FragColor=vec4(applyHaze(lit,vec3(0.),vWorld),1.);
  }`;

export async function regionalGround(scene:THREE.Scene,env:Env,hf:Heightfield,aniso:number,legacy:Box[],onPhoto:(base:RegionalPhoto|null,detail:RegionalPhoto|null)=>void,prepare:(model:THREE.Object3D)=>Promise<unknown>) {
  const [{grid,patches},surveys]=await Promise.all([loadJSON<GroundSurvey>('kansai/ground.json'),loadJSON<District[]>('kansai/districts/index.json')]);
  const [heights,boundary,cover,fine]=await Promise.all([
    loadGrid(grid),boundaryUniforms(),loadBinary('kansai/canopy.bin').then(decodeTreeCover),
    Promise.all(surveys.flatMap(s=>s.grid?[s.grid]:[]).map(async grid=>new Grid(grid,await loadGrid(grid)))),
  ]);
  const step=(cover.box[2]-cover.box[0])/cover.width;
  function canopy(x:number,z:number){
    const col=Math.floor((x-cover.box[0])/step),row=Math.floor((z-cover.box[1])/step);
    return col<0 || row<0 || col>=cover.width || row>=cover.height ? 0 : cover.cells[row*cover.width+col]/15;
  }
  const kyoto=hf.bounds;
  const ground:Ground=(x,z)=>{
    const d=boxDistance(x,z,kyoto);
    if(d===0)return hf.height(x,z);
    const u=THREE.MathUtils.clamp((x-grid.box[0])/grid.step,0,grid.nx-1);
    const v=THREE.MathUtils.clamp((z-grid.box[1])/grid.step,0,grid.nz-1);
    const i=Math.min(Math.floor(u),grid.nx-2),j=Math.min(Math.floor(v),grid.nz-2),k=j*grid.nx+i;
    const low=THREE.MathUtils.lerp(heights[k],heights[k+1],u-i);
    const high=THREE.MathUtils.lerp(heights[k+grid.nx],heights[k+grid.nx+1],u-i);
    let h=THREE.MathUtils.lerp(low,high,v-j);
    for(const g of fine){
      const [w,n,e,s]=g.meta.box,edge=Math.min(x-w,e-x,z-n,s-z);
      if(edge>0)h=THREE.MathUtils.lerp(h,g.sample(x,z),THREE.MathUtils.smoothstep(edge,0,320));
    }
    if(d>=600)return h;
    const rim=hf.height(THREE.MathUtils.clamp(x,kyoto[0],kyoto[2]),THREE.MathUtils.clamp(z,kyoto[1],kyoto[3]));
    return THREE.MathUtils.lerp(rim,h,THREE.MathUtils.smoothstep(d,0,600));
  };

  const states=patches.map(p=>({patch:p,distance:Infinity,pending:false,retry:0,mesh:null as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>|null}));
  const uClose={value:null as THREE.Texture|null},uCloseBox={value:new THREE.Vector4()};
  const uDistrict={value:null as THREE.Texture|null},uDistrictBox={value:new THREE.Vector4()};
  const uInset={value:null as THREE.Texture|null},uInsetBox={value:new THREE.Vector4()};
  let broad:RegionalPhoto|null=null,inset:RegionalPhoto|null=null,live:RegionalPhoto|null=null;
  const districts=districtImagery(surveys,aniso,(base,detail)=>{
    broad=base;inset=detail;
    uDistrict.value=base?.photo??null;uDistrictBox.value.fromArray(base?.box??[0,0,0,0]);
    uInset.value=detail?.photo??null;uInsetBox.value.fromArray(detail?.box??[0,0,0,0]);
    onPhoto(broad,inset??live);
  });
  const photos=regionalPhoto(aniso,sheet=>{
    live=sheet;uClose.value=sheet?.photo??null;
    uCloseBox.value.fromArray(sheet?.box??[0,0,0,0]);
    onPhoto(broad,inset??live);
  });
  let shaderReady:Promise<unknown>|undefined;
  let running=0,last= -Infinity;
  function update(x:number,z:number,y:number,now:number) {
    if(now-last<.15)return;
    last=now;
    const surveyed=districts(x,z,now);
    photos(x,z,y-ground(x,z),now,!surveyed && !legacy.some(b=>boxDistance(x,z,b)===0));
    for(const state of states){
      state.distance=boxDistance(x,z,state.patch.box);
      if(state.mesh && state.distance>65000){
        scene.remove(state.mesh);
        state.mesh.geometry.dispose();
        state.mesh.material.uniforms.uPhoto.value.dispose();
        state.mesh.material.dispose();
        state.mesh=null;
      }
    }
    for(const state of states.sort((a,b)=>a.distance-b.distance)){
      if(running>=2 || state.distance>60000)break;
      if(state.mesh || state.pending || state.retry>now)continue;
      state.pending=true;
      running++;
      void loadTexture(state.patch.file,aniso).then(async photo=>{
        if(state.distance>65000){photo.dispose();return;}
        const material=new THREE.ShaderMaterial({uniforms:{...env,...boundary,uPhoto:{value:photo},uClose,uCloseBox,uDistrict,uDistrictBox,uInset,uInsetBox},vertexShader,fragmentShader});
        const mesh=new THREE.Mesh(patchGeometry(state.patch.box,kyoto,ground,fine),material);
        await (shaderReady??=prepare(mesh));
        if(state.distance>65000){mesh.geometry.dispose();material.dispose();photo.dispose();return;}
        mesh.name='regional-ground';
        state.mesh=mesh;
        scene.add(mesh);
      }).catch(()=>{state.retry=last+10;}).finally(()=>{state.pending=false;running--;});
    }
  }
  return {bounds:grid.box,ground,canopy,update};
}
