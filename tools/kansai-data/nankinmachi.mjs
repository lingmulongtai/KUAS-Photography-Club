import {BufferGeometry,CylinderGeometry,Float32BufferAttribute,Quaternion,Vector3} from 'three';
import inscriptions from './gate-inscriptions.json' with {type:'json'};

// Measured dimensions: Nankinmachi Shopping Street Promotion Association, /about.
// OpenStreetMap roof outlines determine alignment. Brackets and tile ribs approximate the photographs.
const marble=[.65,.61,.52], red=[.48,.038,.022], green=[.026,.16,.115], blue=[.035,.07,.17],
  amber=[.69,.26,.045], gold=[.76,.46,.105], ivory=[.73,.68,.57];

function place(parts,geo,x,y,z,color){
  geo.translate(x,y,z);parts.push({geo,color});
}
function beam(parts,a,b,r,color){
  const v=new Vector3(...a),end=new Vector3(...b),direction=end.clone().sub(v);
  const geo=new CylinderGeometry(r,r,direction.length(),8);
  geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction.normalize()));
  v.lerp(end,.5);place(parts,geo,v.x,v.y,v.z,color);
}
function tiles(parts,outline,apex,y,rise,tone){
  const positions=[];
  function point(i,u,t){
    const a=outline[i],b=outline[(i+1)%outline.length],p=apex[i],q=apex[(i+1)%apex.length];
    const x=a[0]*(1-u)+b[0]*u,z=a[1]*(1-u)+b[1]*u;
    const curl=.21*(2*u-1)**4*(1-t)**3;
    return [x*(1-t)+(p[0]*(1-u)+q[0]*u)*t, y+rise*(.22*t+.78*t*t)+curl,
      z*(1-t)+(p[1]*(1-u)+q[1]*u)*t];
  }
  const glaze=tone.map(c=>Math.min(.95,c*1.11));
  for(let i=0;i<outline.length;i++){
    const next=outline[(i+1)%outline.length];
    const strips=Math.max(3,Math.round(Math.hypot(next[0]-outline[i][0],next[1]-outline[i][1])/.42));
    for(let j=0;j<strips;j++){
      const u=j/strips,v=(j+1)/strips;
      for(let k=0;k<4;k++){
        const a=point(i,u,k/4),b=point(i,v,k/4),c=point(i,u,(k+1)/4),d=point(i,v,(k+1)/4);
        positions.push(...a,...c,...b,...b,...c,...d);
        if(Math.hypot(...a.map((n,l)=>n-c[l]))>.01)beam(parts,a,c,j===0?.064:.039,glaze);
      }
      beam(parts,point(i,u,0),point(i,v,0),.072,tone);
    }
  }
  const shell=new BufferGeometry();shell.setAttribute('position',new Float32BufferAttribute(positions,3));
  shell.computeVertexNormals();parts.push({geo:shell,color:tone});
}
function hip(parts,x,w,d,y,h,tone){
  const outline=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>[x+a*w/2,b*d/2]);
  tiles(parts,outline,outline.map(([a])=>[x+(a-x)*.64,0]),y,h,tone);
  beam(parts,[x-w*.32,y+h,0],[x+w*.32,y+h,0],.095,tone);
}
// Baked Noto Serif JP lettering. Merge adjacent ink pixels into strips in the same draw as the gate.
function inscription(parts,word,width,height,y,z,face,color){
  const panel=inscriptions[word],bits=Buffer.from(panel.rows,'base64'),stride=Math.ceil(panel.width/8);
  const verts=[],ink=(x,row)=>x<panel.width&&(bits[row*stride+(x>>3)]&(128>>(x%8)));
  for(let row=0;row<panel.height;row++){
    const top=y+height*(.5-row/panel.height),bottom=top-height/panel.height;
    for(let x=0;x<panel.width;){
      if(!ink(x,row)){x++;continue;}
      const start=x++;
      while(ink(x,row))x++;
      const l=face*(start/panel.width-.5)*width,r=face*(x/panel.width-.5)*width;
      verts.push(l,bottom,z,r,bottom,z,l,top,z,l,top,z,r,bottom,z,r,top,z);
    }
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(verts,3));
  geometry.computeVertexNormals();parts.push({geo:geometry,color});
}
function templeGate(type,w,d,h,block){
  const parts=[],stone=type==='choan',south=type==='kaiei',post=south?red:marble;
  const width=stone?w*.70:south?w*.76:w,postR=south?.27:.35;
  for(const sign of [-1,1]){
    const x=sign*width/2;
    if(south)place(parts,new CylinderGeometry(postR,postR+.06,h*.64,16),x,h*.32,0,post);
    else block(parts,postR*2,h*.72,.82,x,h*.36,0,post);
    block(parts,.92,.48,1,x,.24,0,ivory);
    block(parts,.82,.16,.92,x,.94,0,post);
    block(parts,1.05,.29,1.12,x,h*.59,0,post);
  }
  const span=width+.75,trim=stone?marble:green;
  for(const [level,thickness] of [[.57,.48],[.67,.52],[.75,.22]]){
    block(parts,span,thickness,.9,0,h*level,0,stone?marble:red);
    for(const face of [-1,1])block(parts,span,.09,.07,0,h*level+thickness*.38,face*.46,stone?ivory:gold);
  }
  const signBoard=(size,level,face)=>{
    block(parts,size+.13,.84,.12,0,level,face*.52,stone?ivory:gold);
    block(parts,size,.71,.09,0,level,face*.605,stone?marble:blue);
    const text=stone?'門安長':south?(face>0?'町京南':'翔飛'):(face>0?'門安西':'復光');
    inscription(parts,text,size*.76,.52,level,face*.653,face,stone?[.09,.087,.075]:gold);
  };
  for(const face of [-1,1])signBoard(stone?span*.79:span*.54,h*.64,face);
  const roofWidth=stone?w:Math.max(w+1.3,span*1.15), roofTone=stone?amber:south?[.34,.091,.047]:[.27,.047,.036];
  const eaves=(x,rw,depth,base,rise)=>{
    block(parts,rw*.73,.32,depth*.52,x,base-.25,0,trim);
    for(const side of [-1,1])for(let j=-3;j<=3;j++){
      const bx=x+j*rw*.10;
      block(parts,.16,.37,depth*.58,bx,base-.42,0,trim);
      beam(parts,[bx,base-.53,side*.18],[bx+.14,base-.13,side*depth*.38],.1,stone?marble:red);
    }
    hip(parts,x,rw,depth,base,rise,roofTone);
  };
  if(stone){
    for(const side of [-1,1])eaves(side*roofWidth*.32,roofWidth*.41,d,h*.715,h*.105);
    block(parts,w*.53,h*.17,1.02,0,h*.825,0,marble);
    for(const face of [-1,1]){
      block(parts,w*.47,.88,.095,0,h*.825,face*.54,ivory);
      inscription(parts,face>0?'睦敦':'愛友',w*.28,.61,h*.825,face*.59,face,[.14,.13,.12]);
    }
  }else{
    eaves(0,roofWidth,d,h*.72,h*.10);
    block(parts,roofWidth*.69,h*.096,d*.46,0,h*.829,0,trim);
  }
  eaves(0,roofWidth*(stone?.64:.83),d*(stone?.91:.82),h*.885,h*.115-.095);
  return parts;
}
function pavilion(w,h,diameter){
  const parts=[];
  const corners=Array.from({length:6},(_,j)=>[-Math.sin(j*Math.PI/3),Math.cos(j*Math.PI/3)]);
  const ring=(r)=>corners.map(([x,z])=>[x*r,z*r]);
  const posts=ring(diameter/2);
  place(parts,new CylinderGeometry(diameter*.61,diameter*.65,.24,6),0,.12,0,marble);
  for(let i=0;i<6;i++){
    const [x,z]=posts[i],[bx,bz]=posts[(i+1)%6];
    place(parts,new CylinderGeometry(.105,.12,3,12),x,1.7,z,red);
    beam(parts,[x,2.98,z],[bx,2.98,bz],.15,red);
    beam(parts,[x*1.25,3.47,z*1.25],[bx*1.25,3.47,bz*1.25],.13,red);
  }
  tiles(parts,ring(w/2),ring(.85),3.55,.98,gold);
  place(parts,new CylinderGeometry(.82,.94,.55,6),0,4.7,0,red);
  tiles(parts,ring(w*.33),ring(.14),4.99,1.25,gold);
  place(parts,new CylinderGeometry(.095,.14,h-6.24,10),0,(h+6.24)/2,0,amber);
  return parts;
}
export function districtModel(row,block){
  const {way,center:[lon,lat],ring,dimension}=row;
  const xy=ring.slice(0,-1).map(([x,y])=>[(x-lon)*111320*Math.cos(lat*Math.PI/180),(y-lat)*110940]);
  // The mapped outlines include intermediate collinear vertices. Use the principal axis of the full roof.
  const sx=xy.reduce((n,[x])=>n+x*x,0),sy=xy.reduce((n,[,y])=>n+y*y,0);
  const a=.5*Math.atan2(2*xy.reduce((n,[x,y])=>n+x*y,0),sx-sy);
  const project=(axis)=>xy.map(([x,y])=>x*Math.cos(axis)+y*Math.sin(axis));
  const width=(axis)=>Math.max(...project(axis))-Math.min(...project(axis));
  const type={'573127721':'choan','573127722':'kaiei','573127723':'seian','573127719':'pavilion'}[way];
  const h=dimension.maximumHeightM??dimension.originalHeightM;
  const parts=type==='pavilion'?pavilion(5.19,h,dimension.diameterM):
    templeGate(type,dimension.widthM??width(a),width(a+Math.PI/2),h,block);
  const orientation=type==='pavilion'?Math.atan2(-xy[0][0],xy[0][1]):a;
  for(const {geo} of parts)geo.rotateY(orientation);
  return {id:'nankinmachi-'+type,parts};
}
