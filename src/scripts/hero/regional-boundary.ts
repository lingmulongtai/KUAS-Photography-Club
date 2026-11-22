import * as THREE from 'three';
import {decodedTexture} from './data';
import {BOUNDARY_LOOKUP} from '../kansai/boundary-lookup';
import {M_PER_DEG_LAT,M_PER_DEG_LON,ORIGIN} from './geo';

const names={coarse:'prefectures',districts:'districts',edges:'edges',islets:'islets'};
async function textures(){
  const entries=await Promise.all(Object.entries(names).map(async([key,name])=>{
    const texture=await decodedTexture('/kansai/borders/'+name+'.png');
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

/** Apply the administrative boundary to the same city material used inside Kyoto. */
export function clipCityMaterial(material:THREE.ShaderMaterial, boundary:Awaited<ReturnType<typeof boundaryUniforms>>){
  material.uniforms={...material.uniforms,...boundary};
  material.fragmentShader=HOME_BOUNDARY+'\n'+material.fragmentShader.replace('gl_FragColor =','if(owner(vWorld.xz)==0) discard; gl_FragColor =');
  return material;
}
