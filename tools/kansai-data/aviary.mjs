import {BufferGeometry,Float32BufferAttribute,Vector3} from 'three';

// Tennoji Zoo's 1987 opening record, pp.10–11: 40 m and 27 m cages, maximum height 20 m.
// Centre fits use the circular parts of OSM way 219830343. The saddle, ribs and minor dome height
// are reconstructed from the outline, GSI imagery and Daido Steel's photograph of the completed frame.
export function flightAviary(){
  const west=[135.50809484,34.64903655],east=[135.50880826,34.64878670];
  const dx=(east[0]-west[0])*91667,dz=(west[1]-east[1])*110947,length=Math.hypot(dx,dz);
  const dirX=dx/length,dirZ=dz/length,parts=[];
  function point(along,left,y){
    return new Vector3(along*dirX+left*dirZ,y,along*dirZ-left*dirX);
  }
  const steel=[.21,.25,.24],net=[.11,.14,.13],base=[.23,.24,.21];
  const tubes=new Map();
  function rod(a,b,radius,colour){
    const direction=b.clone().sub(a);
    if(direction.lengthSq()<1e-8)return;
    direction.normalize();
    const guide=Math.abs(direction.y)>.88?new Vector3(1,0,0):new Vector3(0,1,0);
    const u=new Vector3().crossVectors(direction,guide).normalize(),v=new Vector3().crossVectors(direction,u);
    if(!tubes.has(colour))tubes.set(colour,{positions:[],normals:[],indices:[]});
    const {positions,normals,indices}=tubes.get(colour),start=positions.length/3,sides=6;
    for(const centre of [a,b])for(let i=0;i<sides;i++){
      const theta=i*2*Math.PI/sides,n=u.clone().multiplyScalar(Math.cos(theta)).addScaledVector(v,Math.sin(theta));
      normals.push(n.x,n.y,n.z);
      positions.push(centre.x+radius*n.x,centre.y+radius*n.y,centre.z+radius*n.z);
    }
    for(let i=0;i<sides;i++){
      const j=(i+1)%sides;
      indices.push(start+i,start+j,start+i+sides,start+j,start+j+sides,start+i+sides);
    }
  }
  function dome(x,r,wall,top,count){
    const levels=4,tau=2*Math.PI;
    function node(i,k){
      const theta=i*tau/count,angle=k*Math.PI/(2*levels),radius=r*Math.cos(angle);
      return point(x+radius*Math.cos(theta),radius*Math.sin(theta),wall+(top-wall)*Math.sin(angle));
    }
    for(let i=0;i<count;i++){
      const angle=i*tau/count,ax=x+r*Math.cos(angle),left=r*Math.sin(angle);
      rod(point(ax,left,-.6),node(i,0),.17,steel);
      const j=(i+1)*tau/count,bx=x+r*Math.cos(j),right=r*Math.sin(j);
      for(const h of [.28,wall*.55,wall])rod(point(ax,left,h),point(bx,right,h),h===.28?.14:.095,h===.28?base:steel);
      rod(point(ax,left,.5),point(bx,right,wall-.2),.046,net);
      rod(point(ax,left,wall-.2),point(bx,right,.5),.046,net);
      for(let k=0;k<levels;k++){
        rod(node(i,k),node(i,k+1),.11,steel);
        if(k>0)rod(node(i,k),node(i+1,k),.075,steel);
        if(k<levels-1)rod(node(i,k),node(i+1,k+1),.043,net);
      }
    }
  }
  dome(0,20,10,20,20);
  dome(length,13.5,7.6,14.4,16);
  // The long outer side follows the south path. The northern side curves inward between the cages.
  const sections=[
    [6,-19.1,14.7,11.1],[15,-19.9,5.7,10.6],[23,-20,-1.3,10.2],
    [32,-20.5,-1.6,9.9],[41,-18,-1,9.6],[50,-16.8,1.6,9.1],
    [58,-15.5,4.7,8.5],[66,-14,8.4,8.2],
  ];
  const grid=sections.map(([x,outside,inside,h])=>Array.from({length:7},(_,i)=>{
    const f=i/6;return point(x,outside+(inside-outside)*f,h+1.8*Math.sin(Math.PI*f));
  }));
  sections.forEach(([x,outside,inside],j)=>{
    const row=grid[j];
    for(let i=1;i<row.length;i++)rod(row[i-1],row[i],.082,steel);
    if(j===0)return;
    for(let i=0;i<row.length;i++){
      rod(grid[j-1][i],row[i],i===0||i===6?.10:.054,i===0||i===6?steel:net);
      if(i<6)rod(grid[j-1][i],row[i+1],.038,net);
    }
    for(const side of [0,6]){
      const left=side===0?outside:inside;
      rod(point(x,left,-.5),row[side],.15,steel);
      const [prevX,a,b]=sections[j-1],prevLeft=side===0?a:b;
      rod(point(prevX,prevLeft,.4),point(x,left,.4),.14,base);
      rod(point(prevX,prevLeft,.4),row[side],.052,net);
      rod(point(x,left,.4),grid[j-1][side],.052,net);
    }
  });
  for(const [color,{positions,normals,indices}] of tubes){
    const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(positions,3));
    geo.setAttribute('normal',new Float32BufferAttribute(normals,3));geo.setIndex(indices);parts.push({geo,color});
  }
  return {parts,lon:west[0],lat:west[1]};
}
