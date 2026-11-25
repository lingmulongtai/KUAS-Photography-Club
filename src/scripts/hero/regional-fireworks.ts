import * as THREE from 'three';
import {BIWA_FIREWORKS, EXPO} from '../../data/kansai-outings';
import {particles,simulation,pointShape} from '../kansai/firework-particles';
import type {Env} from './env';
import {toLocal} from './geo';

/** Seta River launch point: midway over the river between Seta-no-Karahashi and the next bridge toward Lake Biwa. */
const SETAGAWA_LAUNCH = { id: 'setagawa', lat: 34.9760, lon: 135.9074, wide: false } as const;
/** Expo 2025 Yumeshima nightly fireworks: over the southern Water Plaza / seafront beside the Grand Ring. */
const EXPO_LAUNCH = { id: EXPO.id, lat: 34.6448, lon: 135.3820, wide: true } as const;

export function regionalFireworks(scene:THREE.Scene,env:Env,ground:(x:number,z:number)=>number,reducedMotion:boolean,prepare:(model:THREE.Object3D)=>Promise<unknown>){
  const venues = [
    SETAGAWA_LAUNCH,
    { id: BIWA_FIREWORKS.id, lat: BIWA_FIREWORKS.lat, lon: BIWA_FIREWORKS.lon, wide: true },
    EXPO_LAUNCH,
  ];
  const shows=venues.map((place,idx)=>{
    const wide=place.wide,p=toLocal(place.lat,place.lon);
    const anchor=new THREE.Vector3(p.x,ground(p.x,p.z)+1,p.z);
    const data=particles(wide);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
    geometry.setAttribute('sparkDirection',new THREE.Float32BufferAttribute(data.directions,3));
    geometry.setAttribute('sparkStage',new THREE.Float32BufferAttribute(data.stages,4));
    geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,100,0),wide?550:245);
    const uniforms={u_elapsed:{value:2.35+idx*1.7},uAnchor:{value:anchor},uCity:env.uCity,uPixels:{value:1}};
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
      points.visible=env.uCity.value>.15 && camera.position.distanceToSquared(points.position)<8500**2;
      if(!points.visible)continue;
      if(!reducedMotion)uniforms.u_elapsed.value+=dt;
      uniforms.uPixels.value=pixels;
    }
  };
}
