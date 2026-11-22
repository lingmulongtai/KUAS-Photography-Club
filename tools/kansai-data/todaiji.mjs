import {BufferGeometry,CylinderGeometry,Float32BufferAttribute} from 'three';

const timber=[.135,.074,.039],endGrain=[.205,.125,.071],shadow=[.046,.032,.024];
const tile=[.070,.085,.087],plaster=[.58,.54,.45],bronze=[.18,.275,.247],stone=[.30,.29,.25];

function post(parts,x,z,r,base,height){
  const geo=new CylinderGeometry(r*.94,r,height,12);
  geo.translate(x,base+height/2,z);
  parts.push({geo,color:timber});
}

// The copper karahafu rises in the centre and curls upwards again at either end.
function copperGable(parts,block){
  const positions=[],span=8.8,sections=24;
  const profile=(x)=>20+4.25*Math.exp(-x*x/15)+1.35*(Math.abs(x)/span)**5;
  for(let i=0;i<sections;i++){
    const x=-span+i*2*span/sections,r=x+2*span/sections,y=profile(x),v=profile(r);
    const a=[x,y,33],b=[r,v,33],c=[x,y+2,22],d=[r,v+2,22];
    positions.push(...a,...b,...c,...b,...d,...c,...a,...[x,y-.65,33],...b,...b,...[x,y-.65,33],...[r,v-.65,33]);
    const h=y-19;
    block(parts,.38,h,.4,x,19+h/2,32.8,endGrain);
  }
  const geo=new BufferGeometry();
  geo.setAttribute('position',new Float32BufferAttribute(positions,3));geo.computeVertexNormals();
  parts.push({geo,color:bronze});
}

// Current hall, including the lower skirt (mokoshi). Roof outlines follow the mapped eaves.
// East/west 57.012 m, north/south 50.480 m, height 48.742 m. South faces positive Z.
export function greatBuddhaHall(block,roof){
  const parts=[],width=57.012,depth=50.480;
  block(parts,67,1.55,59,0,.775,0,stone);
  for(let i=0;i<4;i++)block(parts,25,.35,1.1,0,1.36-i*.34,29.8+i*.95,stone);
  block(parts,width,14.8,depth,0,8.95,0,timber);
  for(const side of [-1,1]){
    for(let i=0;i<=7;i++){
      const x=(i/7-.5)*width;
      post(parts,x,side*depth/2,.63,1.55,16.5);
      block(parts,2.15,1.0,2.10,x,17.0,side*depth/2,endGrain);
      if(i===7)continue;
      const cx=x+width/14;
      block(parts,6.7,7.65,.20,cx,5.5,side*(depth/2+.12),shadow);
      block(parts,6.55,3.9,.24,cx,12.2,side*(depth/2+.14),plaster);
      for(let j=-3;j<=3;j++)block(parts,.27,3.95,.27,cx+j*.89,12.2,side*(depth/2+.30),endGrain);
      for(const y of [4.6,8.4,10.2,14.15])block(parts,7,.28,.38,cx,y,side*(depth/2+.3),endGrain);
    }
    for(let i=0;i<=6;i++)post(parts,side*width*.5,(i/6-.5)*depth,.6,1.55,16.3);
  }
  roof(parts,73.8,65.4,12.1,17.6,0,tile);
  block(parts,46,13.2,36,0,25,0,timber);
  for(const side of [-1,1]){
    for(let i=-2;i<=2;i++){
      const x=i*8.5;
      block(parts,7.2,5.25,.32,x,27.5,side*18.25,plaster);
      for(let j=-2;j<=2;j++)block(parts,.30,5.35,.4,x+j*1.22,27.5,side*18.5,endGrain);
    }
    block(parts,5.3,5.35,.42,0,27.5,side*18.72,shadow);
  }
  block(parts,46.8,.7,37.4,0,30.7,0,endGrain);
  roof(parts,62.4,52.6,14.15,30.6,0,tile);
  copperGable(parts,block);
  for(const side of [-1,1]){
    for(let i=0;i<8;i++){
      const top=44.75+(i+1)*(48.742-44.75)/8;
      block(parts,1.7-i*.14,(48.742-44.75)/8,1.45-i*.10,side*(8.5+i*.21),top-(48.742-44.75)/16,0,[.73,.46,.095]);
    }
  }
  return parts;
}

// Todaiji's 18 through-columns, five bays and three open passageways. The
// geographic outline is the GSI roof, while the documented height starts at the plinth.
export function nandaimon(block,roof){
  const parts=[],base=.75,height=19.058,front=7.4;
  block(parts,34,base,18,0,base*.5,0,stone);
  for(const z of [-front,0,front]){
    for(let i=0;i<6;i++){
      const x=(i-2.5)*5.9;
      post(parts,x,z,.57,base,height);
      for(let tier=0;tier<4;tier++){
        const y=base+height-2.2+tier*.51;
        block(parts,1.65+tier*.48,.46,.56,x,y,z,endGrain);
        block(parts,.65,.50,1.9+tier*.66,x,y+.22,z,timber);
      }
    }
    for(const y of [6.2,8.1,12.8,17.3])block(parts,32,.56,.52,0,base+y,z,endGrain);
  }
  for(const side of [-1,1]){
    const x=side*11.8;
    block(parts,5.5,7.9,7.4,x,4.7,0,shadow);
    for(let i=-3;i<=3;i++)block(parts,.18,7.9,.24,x+i*.73,4.7,3.9,timber);
  }
  roof(parts,39.5,22.8,5.4,9.4,0,tile);
  roof(parts,41.1,23.6,6.402,base+height,0,tile);
  for(const {geo} of parts)geo.rotateY(.6*Math.PI/180);
  return parts;
}
