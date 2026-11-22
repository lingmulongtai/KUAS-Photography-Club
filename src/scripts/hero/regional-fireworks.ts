import * as THREE from 'three';
import {BIWA_FIREWORKS, OUTINGS} from '../../data/kansai-outings';
import {particles,simulation,pointShape} from '../kansai/firework-particles';
import type {Env} from './env';
import {toLocal} from './geo';

export function regionalFireworks(scene:THREE.Scene,env:Env,ground:(x:number,z:number)=>number,reducedMotion:boolean,prepare:(model:THREE.Object3D)=>Promise<unknown>){
  const river=OUTINGS.find(p=>p.id==='setagawa')!;
  const shows=[river,BIWA_FIREWORKS].map(place=>{
    const wide=place===BIWA_FIREWORKS,p=toLocal(place.lat,place.lon);
    const anchor=new THREE.Vector3(p.x,ground(p.x,p.z)+1,p.z);
    const data=particles(wide);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
    geometry.setAttribute('sparkDirection',new THREE.Float32BufferAttribute(data.directions,3));
    geometry.setAttribute('sparkStage',new THREE.Float32BufferAttribute(data.stages,4));
    geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,100,0),wide?550:245);
    const uniforms={u_elapsed:{value:2.35},uAnchor:{value:anchor},uCity:env.uCity,uPixels:{value:1}};
    const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`
        attribute vec3 sparkDirection;attribute vec4 sparkStage;
        uniform float u_elapsed,uPixels; uniform vec3 uAnchor;
        varying vec4 v_color;varying float v_water;
        vec2 viewFromLaunch(){return (cameraPosition.xz-uAnchor.xz)*vec2(1.,-1.)-position.xy;}
        ${simulation(wide)}
        void main(){
          vec3 offset;float size,alpha;
          simulate(offset,size,alpha);
          vec3 local=position+offset;
          vec4 eye=viewMatrix*vec4(uAnchor+vec3(local.x,local.z,-local.y),1.);
          gl_Position=alpha>.012?projectionMatrix*eye:vec4(2.,2.,2.,1.);
          gl_PointSize=clamp(size*uPixels/max(280.,-eye.z),1.,15.);
        }`,
      fragmentShader:`
        varying vec4 v_color; varying float v_water; uniform float uCity;
        void main(){${pointShape}
          gl_FragColor=vec4(v_color.rgb*2.4,v_color.a*intensity*smoothstep(.15,.6,uCity));
        }`});
    const points=new THREE.Points(geometry,material);
    points.position.copy(anchor);points.name=place.id;points.visible=false;
    const show={points,uniforms,ready:false};
    void prepare(points).then(()=>{show.ready=true;scene.add(points);});
    return show;
  });
  return (camera:THREE.PerspectiveCamera,dt:number,pixels:number)=>{
    for(const {points,uniforms,ready} of shows){
      if(!ready)continue;
      points.visible=env.uCity.value>.15 && camera.position.distanceToSquared(points.position)<6000**2;
      if(!points.visible)continue;
      if(!reducedMotion)uniforms.u_elapsed.value+=dt;
      uniforms.uPixels.value=pixels;
    }
  };
}
