import {BufferGeometry,Float32BufferAttribute,ShapeUtils,Vector2,Vector3} from 'three';

// Local metres east/south at the museum. The GSI footprint crosses two vector tiles.
export const maritimeMuseum={lon:135.188300,lat:34.682700,
  outline:[[47.7,-44.4],[30.4,-57.8],[30,-62.6],[-46,-52.8],[-46,-53.5],[-52.1,-53],[-51.5,-46.4],[-64.1,-29.6],
    [-60.8,-5.5],[-44,7.4],[-43.1,13.5],[-37.6,12.8],[-37.7,11.7],[-14.6,9],[2.1,21.7],[5.2,21.3],
    [18.5,4.4],[33.6,2.5],[33.6,3.3],[38.8,2.7],[38,-3.6],[50.8,-20.6]]};

function geometry(points,indices){
  const geo=new BufferGeometry();
  geo.setAttribute('position',new Float32BufferAttribute(points,3));
  if(indices)geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function pavilion(parts){
  const ring=maritimeMuseum.outline,points=ring.map(([x,z])=>new Vector2(x,z));
  const roof=[];
  for(const face of ShapeUtils.triangulateShape(points,[])){
    for(const i of face.toReversed())roof.push(ring[i][0],8.7,ring[i][1]);
  }
  parts.push({geo:geometry(roof),color:[.39,.42,.39]});
  const plaster=[],glass=[],frames=[];
  function panel(target,a,b,lo,hi){
    target.push(a[0],lo,a[1],a[0],hi,a[1],b[0],lo,b[1],b[0],lo,b[1],a[0],hi,a[1],b[0],hi,b[1]);
  }
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];
    panel(plaster,a,b,-.5,3.3);panel(glass,a,b,3.3,6.8);panel(plaster,a,b,6.8,8.7);
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const bays=Math.max(1,Math.round(length/4.4));
    for(let j=0;j<bays;j++){
      const at=t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
      const shift=p=>[p[0]+.08*(a[1]-b[1])/length,p[1]+.08*(b[0]-a[0])/length];
      panel(frames,shift(at(j/bays)),shift(at(Math.min(1,j/bays+.38/length))),3.3,6.8);
    }
  }
  for(const [positions,color] of [[plaster,[.60,.57,.49]],[glass,[.065,.13,.15]],[frames,[.58,.59,.53]]]){
    parts.push({geo:geometry(positions),color});
  }
}

export function museumParts(){
  const parts=[],positions=[],indices=[];
  pavilion(parts);
  function beam(a,b,r){
    const e=new Vector3(...a),f=new Vector3(...b),axis=f.clone().sub(e);
    if(axis.lengthSq()<.04)return;
    axis.normalize();
    const u=new Vector3(0,1,0);
    if(Math.abs(u.dot(axis))>.96)u.set(1,0,0);
    u.cross(axis).normalize();const v=axis.clone().cross(u);
    const start=positions.length/3;
    for(const end of [e,f])for(let i=0;i<5;i++){
      const theta=2*Math.PI*i/5;
      positions.push(...end.clone().addScaledVector(u,r*Math.cos(theta)).addScaledVector(v,r*Math.sin(theta)).toArray());
    }
    for(let i=0;i<5;i++){
      const p=start+i,q=start+(i+1)%5;indices.push(p,q,p+5,q,q+5,p+5);
    }
  }
  // Each section gives ridge x, ridge z, measured height, and half width.
  // The central tip is set to the documented 45 m. Its two side sails peak at the north end.
  const sails=[
    [[-4,-46,23.7,12],[-2,-30,24.1,17],[1,-14,27.9,18],[3,2,34.4,13],[5,14,39.8,8],[6,31,45,0]],
    [[-33,7,19,10],[-35,-2,20,13],[-37,-18,24.1,14],[-39,-30,29.4,8],[-41,-42,33.5,0]],
    [[34,-13,18,7],[33,-22,17.4,10],[32,-30,19.5,11],[30,-42,24.3,7],[29,-53,29.5,0]],
  ];
  for(const sections of sails){
    const samples=[];
    for(let i=0;i<sections.length-1;i++){
      const a=sections[i],b=sections[i+1],n=Math.ceil(Math.abs(b[1]-a[1])/3.4);
      for(let j=0;j<n;j++)samples.push(a.map((value,k)=>value+(b[k]-value)*j/n));
    }
    samples.push(sections.at(-1));
    let last;
    for(const [x,z,h,width] of samples){
      const row=[];
      for(let col=-4;col<=4;col++){
        const t=col/4,edge=Math.abs(t);
        const p=[x+t*width,h-(h-9.3)*edge**1.32*Math.min(1,width/7),z-t*width*.125];
        row.push(p);
        if(col>-4)beam(row.at(-2),p,.095);
      }
      if(last)for(let i=0;i<row.length;i++){
        beam(last[i],row[i],i===4||i===0||i===8?.25:.135);
        if(i+1<row.length)beam(last[i],row[i+1],.095);
      }
      last=row;
    }
  }
  parts.push({geo:geometry(positions,indices),color:[.80,.83,.81]});
  return parts;
}
