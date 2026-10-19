import * as THREE from 'three';
import {ENV_GLSL,type Env} from './env';
import {toLocal} from './geo';

/** Mountain-side placement inferred from the official night photograph and precinct
 * map, not a surveyed lamp position. Keep it independent of the pagoda/map pin.
 * https://www.kiyomizudera.or.jp/assets/img/event/night_ph_07.jpg
 * https://www.kiyomizudera.or.jp/map.php */
export const KIYOMIZU_BEAM_ORIGIN=toLocal(34.9950,135.7860);

/** The temple's blue night beam, inspired by its official special-night-viewing imagery.
 * This is a visual interpretation, not an assertion that an event is on tonight.
 * https://www.kiyomizudera.or.jp/event/yakan.php */
export function buildKiyomizuBeam(env:Env,ground:(x:number,z:number)=>number){
  const origin=KIYOMIZU_BEAM_ORIGIN,length=4500;
  const geometry=new THREE.CylinderGeometry(25,1,length,16,1,true).translate(0,length/2,0);
  const material=new THREE.ShaderMaterial({uniforms:env,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:`varying vec3 vWorld;varying vec3 vNormal;varying float vAlong;
      void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;vNormal=mat3(modelMatrix)*normal;vAlong=position.y/4500.;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
    fragmentShader:`${ENV_GLSL}varying vec3 vWorld;varying vec3 vNormal;varying float vAlong;
      void main(){float facing=abs(dot(normalize(vNormal),normalize(cameraPosition-vWorld)));
        float a=uCity*.09*pow(max(0.,1.-vAlong),1.3)*sqrt(facing);gl_FragColor=vec4(vec3(.045,.19,1.8),a);}`});
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(origin.x,ground(origin.x,origin.z)+10,origin.z);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(-.85,.4,-.35).normalize());return mesh;
}
