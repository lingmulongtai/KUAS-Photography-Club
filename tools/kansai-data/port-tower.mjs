import {CylinderGeometry,Quaternion,Vector3} from 'three';

// Registered tower, 108 m. Straight steel tubes form the hyperboloid.
// https://kunishitei.bunka.go.jp/bsys/maindetails/101/00010322
export function portTower(){
  const parts=[],red=[.69,.051,.019],white=[.76,.74,.66],glass=[.13,.23,.29];
  const drum=(low,high,bottom,top,color)=>{
    const geo=new CylinderGeometry(top,bottom,high-low,48);geo.translate(0,(low+high)/2,0);parts.push({geo,color});
  };
  drum(0,11.5,14,12.5,white);drum(11.5,71,5.5,4.2,white);
  for(let i=0;i<5;i++){
    const y=71+i*5.7,r=10.8+i*.39;
    drum(y,y+4.4,r,r+.28,glass);drum(y+4.4,y+5.7,r+.28,r+.39,white);
  }
  drum(99.5,102.3,14.2,12.6,red);drum(102.3,108,10,6.1,white);
  const up=new Vector3(0,1,0);
  for(let i=0;i<16;i++)for(const sign of [-1,1]){
    const angle=i*Math.PI/8,b=angle+sign*2.24;
    const a=new Vector3(14.8*Math.cos(angle),2,14.8*Math.sin(angle));
    const end=new Vector3(13.4*Math.cos(b),102,13.4*Math.sin(b));
    const dir=end.clone().sub(a),mid=a.clone().add(end).multiplyScalar(.5);
    const geo=new CylinderGeometry(.32,.42,dir.length(),8);
    geo.applyQuaternion(new Quaternion().setFromUnitVectors(up,dir.normalize()));geo.translate(mid.x,mid.y,mid.z);
    parts.push({geo,color:red});
  }
  return parts;
}
