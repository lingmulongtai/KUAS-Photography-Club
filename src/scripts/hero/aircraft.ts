import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {ENV_GLSL,type Env} from './env';
import {AIRCRAFT_PATHS,aircraftPose} from './aircraft-path';

/** A few small illustrative airliners in one instanced draw; no live flight data. */
export function buildAircraft(env:Env) {
  const fuselage=new THREE.CapsuleGeometry(1.8,31,3,8);fuselage.rotateX(Math.PI/2);
  const wings=new THREE.BoxGeometry(33,.45,7);wings.rotateY(-.17);
  const tail=new THREE.BoxGeometry(12,.35,3);tail.translate(0,1,-14);
  const fin=new THREE.BoxGeometry(.5,5,4);fin.translate(0,3,-14);
  const parts=[fuselage,wings,tail,fin];
  const geometry=mergeGeometries(parts);for(const part of parts)part.dispose();
  const material=new THREE.ShaderMaterial({uniforms:env,
    vertexShader:`varying vec3 vWorld;varying vec3 vNormal;
      void main(){vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.);vWorld=wp.xyz;
        vNormal=normalize(mat3(modelMatrix*instanceMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader:`${ENV_GLSL} varying vec3 vWorld;varying vec3 vNormal;
      void main(){vec3 n=normalize(vNormal);vec3 col=shade(vec3(.55,.59,.62),n,vWorld,1.);
        gl_FragColor=vec4(applyHaze(col,vec3(.012,.014,.016)*uCity,vWorld),1.);}`});
  const mesh=new THREE.InstancedMesh(geometry,material,AIRCRAFT_PATHS.length);
  mesh.name='illustrative-aircraft';mesh.frustumCulled=false;
  const dummy=new THREE.Object3D();let elapsed=0;
  const update=(dt:number)=>{
    elapsed+=Math.max(0,dt);
    AIRCRAFT_PATHS.forEach((path,i)=>{const p=aircraftPose(path,elapsed);dummy.position.set(p.x,p.y,p.z);
      dummy.rotation.set(0,p.yaw,0);dummy.scale.setScalar(p.visible?1:0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
    mesh.instanceMatrix.needsUpdate=true;
  };
  update(0);return {mesh,update};
}
