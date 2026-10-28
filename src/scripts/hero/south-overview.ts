import * as THREE from 'three';
import {ENV_GLSL,type Env} from './env';
import type {Box} from './geo';

export type OverviewBuilding = [number,number,number,number,number,number,number];

/** A compact sample of buildings, visible until detailed regional data replaces it. */
export async function buildSouthOverview(env:Env,buildings:OverviewBuilding[],ground:(x:number,z:number)=>number) {
  const geometry=new THREE.BoxGeometry(1,1,1);
  const uniforms={...env,uDetailBox:{value:new THREE.Vector4()},uDetailOn:{value:0}};
  const material=new THREE.ShaderMaterial({uniforms,
    vertexShader:`varying vec3 vWorld;varying vec3 vNormal;varying vec3 vLocal;
      void main(){vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.);vWorld=wp.xyz;vLocal=position;
        vNormal=normalize(mat3(modelMatrix*instanceMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader:`${ENV_GLSL} uniform vec4 uDetailBox;uniform float uDetailOn;
      varying vec3 vWorld;varying vec3 vNormal;varying vec3 vLocal;
      void main(){if(uDetailOn>.5&&vWorld.x>=uDetailBox.x&&vWorld.z>=uDetailBox.y&&vWorld.x<uDetailBox.z&&vWorld.z<uDetailBox.w)discard;
        vec3 n=normalize(vNormal);vec3 albedo=mix(vec3(.16,.16,.15),vec3(.22,.21,.19),step(.5,fract(sin(dot(floor(vWorld.xz/12.),vec2(12.9898,78.233)))*43758.5453)));
        vec3 col=shade(albedo,n,vWorld,1.);float wall=1.-step(.5,abs(n.y));
        float window=step(.35,fract(vWorld.y/3.))*step(.4,fract((vWorld.x+vWorld.z)/5.))*wall;
        vec3 emit=vec3(.23,.15,.075)*window*uCity*uLit*cityLightShimmer(vWorld);
        gl_FragColor=vec4(applyHaze(col,emit,vWorld),1.);}`});
  const mesh=new THREE.InstancedMesh(geometry,material,buildings.length);mesh.name='south-overview';
  const dummy=new THREE.Object3D();
  for(let i=0;i<buildings.length;i++){
    const [x,z,w,d,h,angle,offset]=buildings[i];dummy.position.set(x,ground(x,z)+offset+h/2,z);
    dummy.rotation.set(0,-angle,0);dummy.scale.set(w,h,d);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    if(i && i%500===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  mesh.instanceMatrix.needsUpdate=true;
  mesh.computeBoundingSphere();
  return {mesh,setDetailBox(box:Box|null){
    uniforms.uDetailOn.value=box?1:0;if(box)uniforms.uDetailBox.value.set(...box);
    // The overview spans several regions; a partial detail box only hides overlapping blocks.
    mesh.visible=true;
  }};
}
