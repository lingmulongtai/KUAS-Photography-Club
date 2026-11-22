import * as THREE from 'three';
import {loadGrid, loadJSON, loadTexture, type GridMeta} from './data';
import {ENV_GLSL, type Env} from './env';
import type {Box} from './geo';
import type {Heightfield} from './heightfield';

interface Patch {box: Box; file: string}
interface GroundSurvey {grid: GridMeta; patches: Patch[]}
type Ground = (x:number,z:number)=>number;

export function boxDistance(x:number,z:number,b:Box) {
  return Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-z,0,z-b[3]));
}

function patchAxis(lo:number,hi:number,edge0:number,edge1:number,step:number) {
  const values = new Set([lo,hi]);
  for(let n=lo+step;n<hi;n+=step)values.add(n);
  for(const edge of [edge0,edge1])if(edge>lo && edge<hi)values.add(edge);
  return [...values].sort((a,b)=>a-b);
}

function patchGeometry(box:Box, kyoto:Box, ground:Ground) {
  const xs=patchAxis(box[0],box[2],kyoto[0],kyoto[2],200);
  const zs=patchAxis(box[1],box[3],kyoto[1],kyoto[3],200);
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
  uniform sampler2D uPhoto;
  varying vec2 vUv;
  varying vec3 vWorld,vNormal;
  ${ENV_GLSL}
  void main(){
    vec4 photo=texture2D(uPhoto,vUv);
    if(photo.a<.5)discard;
    vec3 lit=shade(photo.rgb,normalize(vNormal),vWorld,1.);
    gl_FragColor=vec4(applyHaze(lit,vec3(0.),vWorld),1.);
  }`;

export async function regionalGround(scene:THREE.Scene,env:Env,hf:Heightfield,aniso:number) {
  const {grid,patches}=await loadJSON<GroundSurvey>('kansai/ground.json');
  const heights=await loadGrid(grid);
  const kyoto=hf.bounds;
  const ground:Ground=(x,z)=>{
    const d=boxDistance(x,z,kyoto);
    if(d===0)return hf.height(x,z);
    const u=THREE.MathUtils.clamp((x-grid.box[0])/grid.step,0,grid.nx-1);
    const v=THREE.MathUtils.clamp((z-grid.box[1])/grid.step,0,grid.nz-1);
    const i=Math.min(Math.floor(u),grid.nx-2),j=Math.min(Math.floor(v),grid.nz-2),k=j*grid.nx+i;
    const low=THREE.MathUtils.lerp(heights[k],heights[k+1],u-i);
    const high=THREE.MathUtils.lerp(heights[k+grid.nx],heights[k+grid.nx+1],u-i);
    const h=THREE.MathUtils.lerp(low,high,v-j);
    if(d>=600)return h;
    const rim=hf.height(THREE.MathUtils.clamp(x,kyoto[0],kyoto[2]),THREE.MathUtils.clamp(z,kyoto[1],kyoto[3]));
    return THREE.MathUtils.lerp(rim,h,THREE.MathUtils.smoothstep(d,0,600));
  };

  const states=patches.map(p=>({patch:p,distance:Infinity,pending:false,retry:0,mesh:null as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>|null}));
  let running=0,last= -Infinity;
  function update(x:number,z:number,now:number) {
    if(now-last<.15)return;
    last=now;
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
      void loadTexture(state.patch.file,aniso).then(photo=>{
        if(state.distance>65000){photo.dispose();return;}
        const material=new THREE.ShaderMaterial({uniforms:{...env,uPhoto:{value:photo}},vertexShader,fragmentShader});
        const mesh=new THREE.Mesh(patchGeometry(state.patch.box,kyoto,ground),material);
        mesh.name='regional-ground';
        state.mesh=mesh;
        scene.add(mesh);
      }).catch(()=>{state.retry=last+10;}).finally(()=>{state.pending=false;running--;});
    }
  }
  return {bounds:grid.box,ground,update};
}
