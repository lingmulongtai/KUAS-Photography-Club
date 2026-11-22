import * as THREE from 'three';
import {BOUNDARY_LOOKUP} from '../kansai/boundary-lookup';
import {M_PER_DEG_LAT,M_PER_DEG_LON,ORIGIN} from './geo';

const names={coarse:'prefectures',districts:'districts',edges:'edges',islets:'islets'};
async function textures(){
  const entries=await Promise.all(Object.entries(names).map(async([key,name])=>{
    const texture=await new THREE.TextureLoader().loadAsync('/kansai/borders/'+name+'.png');
    texture.magFilter=texture.minFilter=THREE.NearestFilter;
    texture.generateMipmaps=false;
    return [key,{value:texture}] as const;
  }));
  return Object.fromEntries(entries);
}
let pending:ReturnType<typeof textures>|undefined;
export const boundaryUniforms=()=>pending??=textures().catch(error=>{pending=undefined;throw error;});

export const HOME_BOUNDARY=`
  uniform sampler2D coarse,districts,edges,islets;
  ${BOUNDARY_LOOKUP}
  int owner(vec2 metre){
    vec2 grid=vec2(${(ORIGIN.lon-134)*2048},${(ORIGIN.lat-33.75)*2048})
      +metre*vec2(${2048/M_PER_DEG_LON},${-2048/M_PER_DEG_LAT});
    return prefecture(ivec2(floor(grid)),fract(grid));
  }`;
