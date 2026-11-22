import {BoxGeometry,CylinderGeometry,SphereGeometry,Quaternion,Vector3} from 'three';

// Building footprints from OpenStreetMap ways 157804940 and 158217814, in local metres.
// +x is to the right of the uphill track and +u follows the cable toward the summit.
const stations=[
  {id:'maya-cable-station',lon:135.21612099,lat:34.71990730,heading:316.8,
    footprint:[[-1.4,16.4],[5.5,16.4],[5.5,-12.3],[-2.2,-12.3],[-2.2,-9.9],[-9.5,-9.9],[-9.5,-3.7],[-8.2,-3.7],[-8.2,-.3],[-7,-.3],[-7,1.5],[-4.9,1.5],[-4.9,-.9],[-1.4,-1]]},
  {id:'maya-cable-niji',lon:135.21221121,lat:34.72725952,heading:324.9,
    footprint:[[-6.6,11.8],[-6.6,3.4],[-5.3,3.4],[-5.4,-12.8],[3.1,-12.8],[3.2,-2.6],[10.2,-2.7],[10.2,3.3],[3.4,3.3],[3.4,11.7]]},
];
const timber=[.22,.114,.060], green=[.075,.173,.134], plaster=[.71,.68,.59];
const stone=[.32,.31,.275], trim=[.46,.40,.31], glass=[.09,.14,.145], iron=[.095,.108,.11];
const dial=[.83,.83,.74], brass=[.42,.32,.11];

export function mayaStations(){
  return stations.map((s,index)=>{
    const parts=[],angle=s.heading*Math.PI/180;
    const vertex=(x,u,y)=>new Vector3(x,y,-u);
    function put(geo,color,x,u,y){
      geo.translate(x,y,-u);
      parts.push({geo,color});
    }
    function box(x,u,y,w,d,h,color){
      put(new BoxGeometry(w,h,d),color,x,u,y);
    }
    function beam(a,b,thickness,depth,color){
      const delta=b.clone().sub(a);
      const geo=new BoxGeometry(thickness,delta.length(),depth);
      geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.normalize()));
      const middle=a.clone().lerp(b,.5);
      put(geo,color,middle.x,-middle.z,middle.y);
    }
    function platform(x,lo,hi,width,grade){
      const count=Math.ceil((hi-lo)/.9);
      for(let i=0;i<count;i++){
        const step=(hi-lo)/count,u=lo+(i+.5)*step,top=u*grade+.48;
        box(x,u,top-1.9,width,step+.02,3.8,stone);
      }
    }
    function track(x,lo,hi,grade){
      for(let u=lo;u<hi;u+=.78)box(x,u,u*grade+.23,2.15,.18,.15,timber);
      for(const offset of [-.53,0,.53])beam(vertex(x+offset,lo,lo*grade+.36),vertex(x+offset,hi,hi*grade+.36),.09,.10,iron);
    }
    function pitchedHall(x,lo,hi,width,grade,eave,rise,color){
      const across=width*.5,span=hi-lo;
      for(const side of [-1,1]){
        // Ribs and purlins stay visible through the open track portals.
        const panel=new BoxGeometry(Math.hypot(across,rise),.16,span+.6);
        panel.rotateZ(-side*Math.atan2(rise,across));
        panel.rotateX(Math.atan(grade));
        put(panel,color,x+side*across/2,(lo+hi)/2,eave+rise/2+(lo+hi)/2*grade);
        const positions=[lo,(3*lo+hi)/4,(lo+hi)/2,(lo+3*hi)/4,hi];
        for(const u of positions){
          const foot=u*grade;
          box(x+side*(across-.22),u,foot+eave/2,.27,.29,eave,timber);
          beam(vertex(x+side*across,u,foot+eave-.1),vertex(x,u,foot+eave+rise-.1),.22,.24,timber);
        }
      }
    }
    if(index===0){
      // Guide floor plan: an open timber entrance with a waiting room to the left and a narrow uphill train shed.
      const grade=.13;
      track(2.3,-10.7,16.4,grade);
      platform(-.25,-12.25,16.2,1.8,grade);
      platform(4.65,-12.25,16.2,1.45,grade);
      pitchedHall(1.7,-12.3,-1,7.8,0,4.4,1.7,green);
      pitchedHall(2.05,-1,16.4,6.9,grade,4.25,.9,green);
      box(-5.45,-6.8,.35,7.1,6.1,5.1,timber);
      box(-4.85,-2.3,.54,5.9,3.15,5.4,timber);
      box(-5.45,-6.8,3.04,7.6,6.6,.22,green);
      box(-4.85,-2.3,3.36,6.3,3.48,.22,green);
      for(const x of [-7.65,-6.04,-4.43,-2.82])box(x,-9.91,1.47,1.29,.10,1.21,glass);
      for(const x of [-1.9,5.32])box(x,-12.15,1.32,.58,.59,6.05,timber);
      box(1.70,-12.27,3.88,7.65,.47,.5,timber);
      const plaque=new SphereGeometry(1,20,8);plaque.scale(1.38,.45,.11);
      put(plaque,green,1.70,-12.57,4.53);
    }else{
      const grade=.27;
      track(-.65,-12.8,4,grade);
      platform(-3.85,-12.8,5.9,2.35,grade);
      platform(1.91,-12.8,4.4,1.90,grade);
      pitchedHall(-1.13,-12.85,3.7,8.5,grade,4.15,.75,green);
      // The central hall, transverse entrance and clock pavilion are separate roof masses.
      box(-1.60,7.64,-.06,9.94,8.20,3.65,stone);
      box(3.18,7.64,4.5,.32,8.20,5.68,plaster);
      for(const u of [3.61,11.66])box(-1.60,u,4.50,9.94,.26,5.68,plaster);
      box(-1.60,7.64,7.36,10.12,8.40,.32,plaster);
      box(6.5,.34,2.25,7.15,6.0,5.7,plaster);
      box(6.5,.34,5.24,7.35,6.22,.29,trim);
      // The transfer path meets the southwest wall. Keep the shadowed arcade open to this side.
      for(const u of [3.67,6.28,8.89,11.52]){
        box(-6.40,u,3.20,.46,.48,3.08,plaster);
        box(-6.43,u,2.16,.50,.52,.99,trim);
      }
      for(const u of [4.96,7.58,10.18])box(-2.26,u,3.26,.12,2.08,2.86,glass);
      box(-6.41,7.64,5.96,.50,8.30,2.68,plaster);
      box(-6.60,7.64,4.73,1.20,8.58,.23,stone);
      const sign=new SphereGeometry(1,20,8);sign.scale(.09,.40,1.25);
      put(sign,brass,-6.72,7.64,5.76);
      const clockX=-1.3,clockU=4.4,clockCenter=8.74;
      box(clockX,clockU,8.64,4.05,4.05,2.45,plaster);
      const cap=new CylinderGeometry(1.28,3.47,2.05,4);cap.rotateY(Math.PI/4);
      put(cap,green,clockX,clockU,10.90);
      for(let face=0;face<4;face++){
        const yaw=face*Math.PI/2,nx=Math.sin(yaw),nz=Math.cos(yaw);
        const px=clockX+nx*2.05,u=clockU-nz*2.05;
        const rim=new CylinderGeometry(.50,.50,.10,20);rim.rotateX(Math.PI/2);rim.rotateY(yaw);put(rim,brass,px,u,clockCenter);
        const disc=new CylinderGeometry(.44,.44,.11,24);disc.rotateX(Math.PI/2);disc.rotateY(yaw);put(disc,dial,px+nx*.045,u-nz*.045,clockCenter);
        const c=vertex(px+nx*.12,u-nz*.12,clockCenter);
        beam(c,c.clone().add(new Vector3(0,.32,0)),.045,.045,iron);
        beam(c,c.clone().add(new Vector3(Math.cos(yaw)*.19,.12,-Math.sin(yaw)*.19)),.05,.05,iron);
      }
    }
    for(const {geo} of parts)geo.rotateY(-angle);
    const ring=s.footprint.map(([x,u])=>[s.lon+(x*Math.cos(angle)+u*Math.sin(angle))/91594,s.lat+(u*Math.cos(angle)-x*Math.sin(angle))/110942]);
    return {...s,parts,ring};
  });
}
