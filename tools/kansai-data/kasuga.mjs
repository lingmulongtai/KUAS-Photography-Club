import {BufferGeometry,CylinderGeometry,Float32BufferAttribute,Quaternion,Vector3} from 'three';
import dimensions from './kasuga-dimensions.json' with {type:'json'};

const red=[.54,.062,.031],bark=[.23,.135,.085],eave=[.34,.20,.105],white=[.83,.79,.68],
  timber=[.16,.084,.044],brass=[.77,.49,.12],black=[.053,.052,.048],stone=[.51,.49,.45];
function beam(parts,from,to,radius,color){
  const a=new Vector3(...from),b=new Vector3(...to),delta=b.clone().sub(a);
  const geo=new CylinderGeometry(radius,radius,delta.length(),10);
  geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.normalize()));
  geo.translate(...a.lerp(b,.5).toArray());parts.push({geo,color});
}
function skin(parts,a,b,c,d,color){
  const geo=new BufferGeometry();
  geo.setAttribute('position',new Float32BufferAttribute([...a,...b,...c,...a,...c,...d],3));
  geo.computeVertexNormals();parts.push({geo,color});
}
function sanctuary(block){
  const parts=[],m=dimensions['k-honden-C1'].printedMeasurementsM;
  const px=m.eastWestMainPostSpacing/2,pz=m.northSouthMainPostSpacing/2,porch=pz+m.forwardBayPostSpacing;
  const top=m.section7VerticalDimension;
  const base=(w,h,d,x,y,z,color)=>block(parts,w,h,d,x,y,z,color);
  base(2.66,.14,5.3,0,.07,.16,stone);
  base(2.45,.14,2.97,0,1.04,-.66,timber);
  base(m.eastWestMainPostSpacing,1.98,m.northSouthMainPostSpacing,0,2.14,-.66,white);
  const door=pz-.64;
  for(const s of [-1,1]){
    base(.73,1.52,.06,s*.38,2.11,door,[.036,.12,.073]);
    base(.12,1.53,.03,s*.70,2.11,door+.045,brass);
    for(const dz of [-pz,pz,porch]){
      const z=dz-.66,high=dz===porch?3.03:3.65;
      beam(parts,[s*px,.15,z],[s*px,high,z],.108,red);
      base(.36,.10,.37,s*px,high-.19,z,brass);
    }
    base(.09,.16,1.34,s*1.09,.69,1.41,red);
    beam(parts,[s*1.07,1.43,.74],[s*1.07,.36,2.48],.069,red);
    for(const z of [.77,1.50,2.41]){
      const y=1.46-(z-.77)*.59;
      base(.094,.33,.094,s*1.07,y,z,red);
      beam(parts,[s*1.07,y+.15,z],[s*1.07,y+.23,z],.067,brass);
    }
  }
  for(let i=0;i<6;i++)base(1.75,.16,.34,0,.19+i*.15,2.35-i*.29,timber);
  // The bark roof has a south-facing gable over a separate descending entrance canopy.
  // Other than the four printed dimensions, profiles, trim and colours are reconstructed.
  const leftZ=-2.63,rightZ=1.34,half=2.05;
  // Plaster gables and exposed tie beams close the roof above the raised sanctuary.
  base(2*px+.22,.42,2*pz+.24,0,3.30,-.66,white);
  for(const z of [-pz-.67,pz-.66]){
    skin(parts,[-1.28,3.44,z],[1.28,3.44,z],[.20,5.15,z],[-.20,5.15,z],white);
    base(3.05,.13,.20,0,3.48,z,red);
    base(1.79,.12,.21,0,4.13,z,red);
    base(.12,1.42,.21,0,4.18,z,red);
    for(const s of [-1,1]){
      beam(parts,[s*1.30,3.55,z],[0,5.18,z],.079,red);
      base(.44,.12,.48,s*px,3.36,z,red);
      base(.70,.10,.60,s*px,3.49,z,red);
    }
  }
  for(const s of [-1,1]){
    const point=(t,z)=>[s*half*t,top-.24-2.62*t+1.1*t*t,z];
    for(let i=0;i<10;i++){
      const t=i/10,u=(i+1)/10;
      skin(parts,point(t,leftZ),point(t,rightZ),point(u,rightZ),point(u,leftZ),bark);
      for(const z of [leftZ,rightZ]){
        const a=point(t,z),b=point(u,z);
        skin(parts,a,b,[b[0],b[1]-.22,z],[a[0],a[1]-.22,z],eave);
        beam(parts,[a[0],a[1]-.24,z],[b[0],b[1]-.24,z],.055,red);
      }
    }
    for(const z of [leftZ+.1,rightZ-.1]){
      beam(parts,[s*1.12,top-1.41,z],[-s*.59,top+.74,z],.060,timber);
      beam(parts,[-s*.51,top+.64,z],[-s*.59,top+.74,z],.063,brass);
    }
  }
  base(.19,.24,rightZ-leftZ+.22,0,top-.12,(leftZ+rightZ)/2,timber);
  for(const z of [-1.85,-.65,.55])beam(parts,[-.27,top-.06,z],[.27,top-.06,z],.07,black);
  const front=porch-.18;
  const canopy=(x,t)=>[x,3.94-1.03*t+.34*t*t,.76+(front-.76)*t];
  for(let i=0;i<7;i++){
    const a=i/7,b=(i+1)/7;
    skin(parts,canopy(-half,a),canopy(half,a),canopy(half,b),canopy(-half,b),bark);
  }
  base(2*half,.18,.13,0,3.17,front,eave);
  for(const z of [door,porch-.66])base(2.62,.16,.20,0,z===door?3.65:3.10,z,red);
  return parts;
}
function danceHall(block,w,d){
  const parts=[],base=(width,h,depth,x,y,z,c)=>block(parts,width,h,depth,x,y,z,c);
  const eaves=4.25,ridge=6.5,px=w*.408,pz=d*.37;
  base(w*.93,.24,d*.89,0,.12,0,stone);
  base(w*.84,.16,d*.76,0,.38,0,timber);
  for(const z of [-pz,pz]){
    for(let i=0;i<=5;i++){
      const x=px*(2*i/5-1);
      beam(parts,[x,.45,z],[x,eaves,z],.13,timber);
      if(i<5)base(2*px/5-.19,.8,.13,x+px/5,3.4,z,white);
    }
    base(2*px+.55,.22,.25,0,2.95,z,timber);
    base(2*px+.55,.22,.25,0,3.91,z,timber);
  }
  for(const x of [-px,px])for(const s of [-1,1])beam(parts,[x,.45,s*pz/3],[x,eaves,s*pz/3],.13,timber);
  for(const s of [-1,1]){
    const p=(side,t)=>[side*w/2,eaves+(ridge-eaves)*(.75*t+.25*t*t),s*d*(1-t)/2];
    for(let j=0;j<6;j++){
      const a=j/6,b=(j+1)/6;
      skin(parts,p(-1,a),p(1,a),p(1,b),p(-1,b),bark);
    }
    base(w,.17,.23,0,eaves-.08,s*d/2,eave);
  }
  beam(parts,[-w/2,ridge,0],[w/2,ridge,0],.19,black);
  return parts;
}

export function kasugaBuildings(features,block){
  return features.map((feature,i)=>{
    const [lon,lat]=feature.properties.center,ring=feature.geometry.coordinates[0],toM=Math.cos(lat*Math.PI/180)*111320;
    const points=ring.slice(0,-1).map(([x,y])=>[(x-lon)*toM,(y-lat)*110940]);
    const hall=feature.properties.parameterSet==='k-heiden';
    const edges=points.map(([x,y],j)=>{const b=points[(j+1)%points.length];return [b[0]-x,b[1]-y];});
    const eastward=edges.filter(([x,y])=>x>Math.abs(y))[0];
    const angle=Math.atan2(eastward[1],eastward[0]);
    const span=(a)=>{const proj=points.map(([x,y])=>x*Math.cos(a)+y*Math.sin(a));return Math.max(...proj)-Math.min(...proj);};
    const parts=hall?danceHall(block,span(angle),span(angle+Math.PI/2)):sanctuary(block);
    for(const part of parts)part.geo.rotateY(angle);
    return {id:hall?'kasuga-heiden':'kasuga-honden-'+(i+1),parts,lon,lat,ring};
  });
}
