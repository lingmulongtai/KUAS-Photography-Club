import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { toLocal } from './geo';

const center=toLocal(35.0230738,135.804312);
/*
 * Offsets in metres (+x east, uphill; +z south) from the crossing, traced from the mown strips in
 * the GSI aerial photo: 一 runs north-south through the crossing, 丿 comes down from above it and
 * sweeps north-west, 乀 runs south-west. Lengths follow the published 80 / 160 / 120 m.
 */
const STROKE_OFFSETS=[[[5,-42],[5,42]],[[45,-12],[3,0]],[[3,0],[-70,-72]],[[3,4],[-105,58]]] as const;
/** The strokes of 大 in local metres, [ax, az, bx, bz], for the mown strips seen by day. */
export const STROKES=STROKE_OFFSETS.map(([a,b])=>[center.x+a[0],center.z+a[1],center.x+b[0],center.z+b[1]] as const);
/** Representative fire-bed strokes on the west-facing slope; not a survey of individual beds. */
export const FIRE_BEDS: {x:number;z:number}[]=[];
for(const [a,b] of STROKE_OFFSETS) {
  const steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/4);
  for(let i=0;i<=steps;i++) FIRE_BEDS.push({x:center.x+a[0]+(b[0]-a[0])*i/steps,z:center.z+a[1]+(b[1]-a[1])*i/steps});
}
export const fireClearing=(x:number,z:number)=>Math.abs(x-center.x)<120&&Math.abs(z-center.z)<120&&FIRE_BEDS.some(p=>(p.x-x)**2+(p.z-z)**2<700);

/** A static night-time illustration of the Gozan bonfires, explicitly labelled as an image. */
export function buildDaimonji(env:Env,hf:Heightfield) {
  const positions=FIRE_BEDS.flatMap(p=>[p.x,hf.height(p.x,p.z)+4,p.z]);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const material=new THREE.ShaderMaterial({uniforms:env,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`${ENV_GLSL}
      varying vec3 vWorld;
      void main(){vWorld=position;vec4 p=viewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;
        gl_PointSize=clamp(6000./max(20.,-p.z),2.,32.);}`,
    fragmentShader:`${ENV_GLSL}
      varying vec3 vWorld;
      void main(){float r=length(gl_PointCoord-.5)*2.;float light=exp(-r*r*6.);
        gl_FragColor=vec4(vec3(2.4,.015,.004)*light,light*uCity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Points(geometry,material);
}
