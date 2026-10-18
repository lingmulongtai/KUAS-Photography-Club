import * as THREE from 'three';
import {ENV_GLSL,type Env} from './env';
import {rng} from './util';

/** Lightweight seasonal snow: one untextured draw, clock frozen by reduced motion. */
export function buildSnow(env:Env,quality:number){
  const random=rng(1842),count=quality>.75?900:360,positions=[];
  for(let i=0;i<count;i++)positions.push(random(),random(),random());
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const uniforms={...env,uSnowScale:{value:600}};
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,
    vertexShader:`uniform float uTime;uniform float uSnowScale;varying vec3 vWorld;varying float vFade;
      void main(){vec3 p=position*vec3(800.,420.,800.);p.y=mod(p.y-uTime*6.,420.);p.x+=sin(uTime*.15+position.z*20.)*12.;
        vWorld=cameraPosition+p-vec3(400.,220.,400.);vec4 mv=viewMatrix*vec4(vWorld,1.);vFade=clamp(-mv.z/20.,0.,1.);
        gl_PointSize=clamp(uSnowScale*(.15+position.x*.18)/max(10.,-mv.z),1.,4.);gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`${ENV_GLSL}varying vec3 vWorld;varying float vFade;
      void main(){float r=length(gl_PointCoord-.5);if(r>.5||uSnow<.01)discard;
        vec3 col=mix(vec3(.65,.74,.86),vec3(.95),clamp(uSunDir.y,0.,1.));
        gl_FragColor=vec4(col,(1.-smoothstep(.1,.5,r))*uSnow*vFade*.65);}`});
  const points=new THREE.Points(geometry,material);points.frustumCulled=false;return {points,uniforms};
}
