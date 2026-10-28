import * as THREE from 'three';
import {ENV_GLSL,SHADOW_GLSL,type Env} from './env';
import {CampusBuilder,CM} from './campus-architecture';
import {createCampusMesh} from './campus';
import {railwayPath,trainSections,serviceTrainProgress,type RailwayRoute} from './railway-path';
import {SHADOW_LAYER} from './shadow';

/** Bounded route groups, one static track draw and one instanced vehicle draw.
 * Vehicle speeds, station shelters and vertical alignment are illustrative. */
export function buildRailways(env:Env,ground:(x:number,z:number)=>number,routes:RailwayRoute[]){
  const group=new THREE.Group();group.name='kyoto-railways';
  const positions:number[]=[],sides:number[]=[],along:number[]=[],trackCounts:number[]=[];
  const structures=new CampusBuilder(0,{x:0,z:0},0);
  const paths=routes.map(route=>railwayPath(route,ground));
  routes.forEach((route,r)=>{
    const path=paths[r];
    for(let i=0;i<route.points.length-1;i++){
      const a=path.at(path.distances[i]+.001),b=path.at(path.distances[i+1]-.001);
      if(!a.visible)continue;
      const width=a.tracks===2?5.6:3.1;
      for(const [p,side,distance] of [[a,-1,path.distances[i]],[a,1,path.distances[i]],[b,1,path.distances[i+1]],
        [a,-1,path.distances[i]],[b,1,path.distances[i+1]],[b,-1,path.distances[i+1]]] as const){
        positions.push(p.x-p.dz*side*width/2,p.y,p.z+p.dx*side*width/2);
        sides.push(side*width/2);along.push(distance);trackCounts.push(a.tracks);
      }
      if(a.state===1){
        const start:[number,number,number]=[a.x,a.y-.55,a.z],end:[number,number,number]=[b.x,b.y-.55,b.z];
        structures.beam(start,end,width,.9,CM.concrete);
        if(Math.floor(path.distances[i]/60)!==Math.floor(path.distances[i+1]/60)){
          const y=ground(a.x,a.z);if(a.y-y>1)structures.box(a.x-.65,a.x+.65,a.z-.65,a.z+.65,y,a.y-.6,CM.concrete);
        }
      }
    }
    for(const station of route.stations){
      const p=path.at(station.distance),short=route.id.startsWith('randen'),len=short?18:82;
      if(!p.visible)continue;
      for(const side of [-1,1]){
        const point=(d:number,offset:number,y:number):[number,number,number]=>[p.x+p.dx*d-p.dz*offset,y,p.z+p.dz*d+p.dx*offset];
        const offset=side*(p.tracks===2?4.2:2.5);
        structures.beam(point(-len/2,offset,p.y+.4),point(len/2,offset,p.y+.4),short?1.6:2.8,.6,CM.concrete);
        structures.beam(point(-len*.4,offset,p.y+3.4),point(len*.4,offset,p.y+3.4),short?2:3.5,.2,CM.roof);
        for(const d of [-len*.35,0,len*.35])structures.beam(point(d,offset,p.y+.7),point(d,offset,p.y+3.3),.14,.14,CM.metal);
      }
    }
  });
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('aSide',new THREE.Float32BufferAttribute(sides,1));geometry.setAttribute('aAlong',new THREE.Float32BufferAttribute(along,1));
  geometry.setAttribute('aTracks',new THREE.Float32BufferAttribute(trackCounts,1));geometry.computeBoundingSphere();
  const trackMaterial=new THREE.ShaderMaterial({uniforms:env,
    vertexShader:`attribute float aSide;attribute float aAlong;attribute float aTracks;varying float vSide;varying float vAlong;flat varying float vTracks;varying vec3 vWorld;
      void main(){vSide=aSide;vAlong=aAlong;vTracks=aTracks;vWorld=position;gl_Position=projectionMatrix*viewMatrix*vec4(position,1.);}`,
    fragmentShader:`${ENV_GLSL}${SHADOW_GLSL}
      varying float vSide;varying float vAlong;flat varying float vTracks;varying vec3 vWorld;
      void main(){float centre=vTracks>1.5?abs(vSide)-1.45:vSide;float rail=abs(abs(centre)-.72);
        float steel=1.-smoothstep(.045,.045+max(fwidth(vSide),.015),rail);
        float sleepers=(1.-smoothstep(.13,.13+fwidth(vAlong),abs(fract(vAlong/1.1)-.5)))*(1.-smoothstep(1.2,1.4,abs(centre)));
        vec3 alb=mix(vec3(.10,.085,.07),vec3(.16,.105,.065),sleepers);alb=mix(alb,vec3(.34,.36,.36),steel);
        gl_FragColor=vec4(applyHaze(shade(alb,vec3(0.,1.,0.),vWorld,sunShadow(vWorld,vec3(0.,1.,0.))),vec3(0.),vWorld),1.);}`});
  const trackMesh=new THREE.Mesh(geometry,trackMaterial),structureMesh=createCampusMesh({...env,uHighlight:{value:1}},structures.geometry());
  trackMesh.layers.enable(SHADOW_LAYER);structureMesh.layers.enable(SHADOW_LAYER);group.add(trackMesh,structureMesh);
  const services=routes.map((route,r)=>trainSections(paths[r].length,route.cars*(route.carLength+1)));
  const count=routes.reduce((n,r,i)=>n+r.cars*services[i],0),base=new THREE.BoxGeometry(1,1,1).toNonIndexed();
  const vehicles=new THREE.InstancedBufferGeometry();vehicles.setAttribute('position',base.getAttribute('position'));vehicles.setAttribute('normal',base.getAttribute('normal'));
  const pos=new THREE.InstancedBufferAttribute(new Float32Array(count*3),3),direction=new THREE.InstancedBufferAttribute(new Float32Array(count*3),3),colors=new THREE.InstancedBufferAttribute(new Float32Array(count*3),3),styles=new THREE.InstancedBufferAttribute(new Float32Array(count),1),noses=new THREE.InstancedBufferAttribute(new Float32Array(count),1);
  vehicles.setAttribute('iPos',pos);vehicles.setAttribute('iDirection',direction);vehicles.setAttribute('iColor',colors);vehicles.setAttribute('iStyle',styles);vehicles.setAttribute('iNose',noses);vehicles.instanceCount=count;
  let index=0;routes.forEach((route,r)=>{const c=new THREE.Color(route.color),style=route.id==='jr-shinkansen'?3:route.id.startsWith('jr-')?1:route.id==='kintetsu'?2:0;
    for(let i=0;i<route.cars*services[r];i++){const car=i%route.cars;colors.setXYZ(index,c.r,c.g,c.b);styles.setX(index,style);
      noses.setX(index++,style===3?(car===0?-1:car===route.cars-1?1:0):0);}});
  const vehicleMaterial=new THREE.ShaderMaterial({uniforms:env,
    vertexShader:`attribute vec3 iPos;attribute vec3 iDirection;attribute vec3 iColor;attribute float iStyle;attribute float iNose;varying vec3 vWorld;varying vec3 vNormal;varying vec3 vLocal;flat varying vec3 vColor;flat varying float vVisible;flat varying float vStyle;
      void main(){vec3 p=position*vec3(2.7,3.1,iDirection.z);if(iNose*position.z>.4){p.x*=.45;p.y-=.35;}vLocal=p;vColor=iColor;vStyle=iStyle;vVisible=step(.01,iDirection.z);vec2 d=iDirection.xy;
        vWorld=iPos+vec3(d.y*p.x+d.x*p.z,p.y,-d.x*p.x+d.y*p.z);vNormal=vec3(d.y*normal.x+d.x*normal.z,normal.y,-d.x*normal.x+d.y*normal.z);
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
    fragmentShader:`${ENV_GLSL}${SHADOW_GLSL}
      varying vec3 vWorld;varying vec3 vNormal;varying vec3 vLocal;flat varying vec3 vColor;flat varying float vVisible;flat varying float vStyle;
      void main(){if(vVisible<.5)discard;vec3 n=normalize(vNormal);float side=step(1.3,abs(vLocal.x));float band=step(-.3,vLocal.y)*step(vLocal.y,1.05)*side;
        float pane=step(.17,fract((vLocal.z+100.)/1.65))*band;vec3 alb=mix(vColor,vec3(.22,.25,.26),step(1.1,vLocal.y));
        if(vStyle>.5 && vStyle<1.5){alb=mix(vec3(.42,.45,.46),vColor,side*step(-1.1,vLocal.y)*step(vLocal.y,-.65));alb=mix(alb,vec3(.22,.25,.26),step(1.1,vLocal.y));}
        if(vStyle>1.5){alb=mix(vColor,vec3(.67,.62,.51),step(-.25,vLocal.y));alb=mix(alb,vec3(.22,.25,.26),step(1.1,vLocal.y));}
        if(vStyle>2.5){alb=mix(vec3(.73,.76,.78),vColor,side*step(-.9,vLocal.y)*step(vLocal.y,-.48));}
        alb=mix(alb,vec3(.035,.06,.075),pane);vec3 emit=vec3(.8,.61,.32)*pane*uCity*.5;
        gl_FragColor=vec4(applyHaze(shade(alb,n,vWorld,sunShadow(vWorld,n)),emit,vWorld),1.);}`});
  const trainMesh=new THREE.Mesh(vehicles,vehicleMaterial);trainMesh.frustumCulled=false;group.add(trainMesh);
  let clock=0;
  function update(dt:number){
    clock+=dt;let index=0;
    routes.forEach((route,r)=>{
      const path=paths[r],span=route.cars*(route.carLength+1),sections=services[r],bothWays=route.tracks.every(t=>t===2);
      for(let service=0;service<sections;service++){
      const backwards=bothWays&&service%2===1,directionSign=backwards?-1:1;
      const perDirection=bothWays?(backwards?Math.floor(sections/2):Math.ceil(sections/2)):sections;
      const order=bothWays?Math.floor(service/2):service;
      const progress=serviceTrainProgress(clock+r*97,path.length,span,route.id.startsWith('randen')?7:route.id==='jr-shinkansen'?38:20,order,perDirection,directionSign);
      for(let car=0;car<route.cars;car++){
        const d=progress.distance+(car-(route.cars-1)/2)*(route.carLength+1)*progress.direction,p=path.at(d);
        const side=p.tracks===2?1.45*progress.direction:0;
        pos.setXYZ(index,p.x-p.dz*side,p.y+1.65,p.z+p.dx*side);
        direction.setXYZ(index,p.dx*progress.direction,p.dz*progress.direction,p.visible&&progress.visible?route.carLength:0);index++;
      }
      }
    });pos.needsUpdate=direction.needsUpdate=true;
  }
  update(0);return {group,update};
}
