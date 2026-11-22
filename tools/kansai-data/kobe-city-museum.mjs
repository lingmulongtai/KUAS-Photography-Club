import {BoxGeometry,BufferGeometry,Float32BufferAttribute} from 'three';

// The former Yokohama Specie Bank faces Kyomachi-suji at 91.9 degrees; +x is toward the street.
export const cityMuseum={lon:135.19292572,lat:34.68728169};
const skew=1.9*Math.PI/180;
const stone=[.52,.497,.449],light=[.65,.615,.55],shadow=[.38,.355,.315];
const granite=[.36,.344,.319],glass=[.046,.062,.066],bronze=[.107,.127,.121];
const verdigris=[.116,.249,.216],copperSeam=[.15,.287,.245];

export function cityMuseumParts(){
  const parts=[];
  function add(geo,color,x,y,z){
    geo.translate(x,y,z);
    geo.rotateY(-skew);
    parts.push({geo,color});
  }
  function box(x,y,z,w,h,d,color){add(new BoxGeometry(w,h,d),color,x,y,z);}
  function surface(vertices,indices,color){
    const geo=new BufferGeometry();
    geo.setAttribute('position',new Float32BufferAttribute(vertices,3));
    geo.setIndex(indices);geo.computeVertexNormals();add(geo,color,0,0,0);
  }
  // The six engaged columns have a slight entasis and shallow longitudinal flutes.
  function column(z){
    const x=25.87,sections=72;
    const profile=[[.94,1.04],[1.15,1.04],[1.41,.82],[3.6,.825],[8.9,.756],[11.74,.702],[11.88,.73],[12.21,.93]];
    const vertices=[],indices=[];
    for(const [y,radius] of profile){
      for(let i=0;i<=sections;i++){
        const a=-Math.PI/2+Math.PI*i/sections;
        const r=radius-(y>1.16&&y<11.75?.037*(.5-.5*Math.cos(a*24)):0);
        vertices.push(x+r*Math.cos(a),y,z+r*Math.sin(a));
      }
    }
    for(let j=0;j<profile.length-1;j++)for(let i=0;i<sections;i++){
      const a=j*(sections+1)+i,b=a+sections+1;
      indices.push(a,b,a+1,a+1,b,b+1);
    }
    surface(vertices,indices,light);
    box(x-.08,12.31,z,1.95,.22,2.08,light);
    box(x-.08,.78,z,2.06,.30,2.12,granite);
  }
  function eastWindow(x,y,z,width,height){
    box(x,y,z,.12,height,width,bronze);
    box(x+.075,y,z,.06,height-.22,width-.24,glass);
    box(x+.13,y,z,.12,height-.20,.095,bronze);
    box(x+.13,y+.13*height,z,.12,.10,width-.20,bronze);
    box(x+.16,y-height/2-.06,z,.35,.16,width+.29,light);
  }
  // An actual recess between the end piers gives the portico depth in oblique views.
  box(-1.2,6.57,0,50.9,14.34,51.56,stone);
  for(const side of [-1,1]){
    box(25.33,6.81,side*22.0,2.86,14.82,7.77,stone);
    for(const [y,h] of [[2.83,2.90],[7.14,3.17],[11.53,2.68]])eastWindow(26.81,y,side*22.01,2.25,h);
    for(let y=1.19;y<13.7;y+=.64)box(26.78,y,side*22.0,.065,.036,7.76,shadow);
    box(25.63,14.05,side*22.0,2.69,.36,8.19,light);
    box(25.37,14.68,side*22.0,2.80,.24,7.96,light);
    // Side pilasters frame the three storeys of tall windows in the historic wing.
    for(let i=0;i<10;i++){
      const xx=-23.12+5.13*i,zz=side*25.84;
      box(xx-2.13,7.03,zz,.54,11.88,.60,light);
      for(const [y,h] of [[2.75,2.83],[7.25,3.38],[11.54,2.64]]){
        box(xx,y,zz,2.53,h,.15,bronze);
        box(xx,y,zz+side*.10,2.29,h-.23,.09,glass);
        box(xx,y,zz+side*.15,.09,h-.18,.09,bronze);
        box(xx,y-h*.5-.1,zz,2.85,.17,.56,light);
      }
    }
    box(0,13.35,side*25.8,53.51,.55,.73,light);
    box(0,14.38,side*25.7,53.67,.24,.87,light);
  }
  for(const z of [-15,-9,-3,3,9,15])column(z);
  for(const z of [-17.42,-12,-6,0,6,12,17.42]){
    const w=Math.abs(z)>16?2.47:3.86;
    eastWindow(24.34,2.63,z,w,3.12);
    eastWindow(24.34,7.34,z,w,3.22);
    eastWindow(24.34,10.47,z,w,2.55);
  }
  for(let i=0;i<4;i++)box(25.23+i*.43,.60-i*.15,0,3.24-i*.34,.34,8.24,granite);
  box(25.19,4.52,0,3.11,.22,5.61,bronze);
  box(25.31,12.85,0,2.65,.99,36.39,stone);
  box(25.42,13.48,0,3.05,.28,36.74,light);
  for(let z=-17.68;z<18;z+=.57)box(26.72,13.83,z,.31,.47,.24,light);
  box(25.36,14.30,0,3.31,.46,36.69,light);
  box(-.62,14.35,0,51.76,.42,51.08,granite);
  // West extension: north-south barrel roof. Airborne heights place the crest 11.8 m above the old roof.
  const west=-25,east=-7,north=-24,south=11,spring=20.25,rise=6.23;
  box((west+east)/2,17.31,(south+north)/2,east-west,5.98,south-north,stone);
  const vertices=[],indices=[],steps=34;
  for(let i=0;i<=steps;i++){
    const a=Math.PI*i/steps,xx=(west+east)/2+Math.cos(a)*(east-west)/2,yy=spring+rise*Math.sin(a);
    vertices.push(xx,yy,north,xx,yy,south);
    if(i<steps){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
  }
  surface(vertices,indices,verdigris);
  for(const zz of [north,south]){
    const center=(west+east)/2,vertices=[center,spring-.02,zz],indices=[];
    for(let i=0;i<=steps;i++){
      const a=Math.PI*i/steps;
      vertices.push(center+Math.cos(a)*(east-west)/2,spring+rise*Math.sin(a),zz);
      if(i>0)indices.push(0,...(zz===south?[i,i+1]:[i+1,i]));
    }
    surface(vertices,indices,stone);
  }
  for(let z=north+.7;z<south;z+=1.45){
    const vertices=[],indices=[];
    for(let i=0;i<=steps;i++){
      const a=Math.PI*i/steps,xx=-16+9.02*Math.cos(a),yy=spring+6.26*Math.sin(a);
      vertices.push(xx,yy,z-.037,xx,yy,z+.037);
      if(i<steps){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
    }
    surface(vertices,indices,copperSeam);
  }
  return parts;
}

export function cityMuseumRing(){
  return [[-26.84,-25.9],[26.83,-25.91],[26.84,25.89],[-26.83,25.91]].map(([x,z])=>[
    cityMuseum.lon+(x*Math.cos(skew)-z*Math.sin(skew))/91644,
    cityMuseum.lat-(x*Math.sin(skew)+z*Math.cos(skew))/110940
  ]);
}
