import {BoxGeometry,BufferGeometry,Float32BufferAttribute,IcosahedronGeometry,ShapeUtils,Vector2} from 'three';

// The hall dimensions and twin ridge ornaments follow https://www.todaiji.or.jp/information/daibutsuden/.
// The larger eaves follow the mapped outer roof of OSM way 43558119. Joinery and colours are illustrative.
export function greatBuddhaHall(templeHall){
  const parts=templeHall(73.8,65.4,45,true);
  for(const p of parts){
    if(p.color[0]===.045)p.color=[.072,.079,.075];
  }
  for(const side of [-1,1]){
    for(let i=0;i<7;i++){
      const geo=new BoxGeometry(.95-.07*i,.68,1.2-i*.09);
      geo.translate(side*(7.5+i*.42),44.55+i*.6,0);parts.push({geo,color:[.72,.40,.055]});
    }
  }
  return parts;
}

// Hikone City's preservation plan, figures 2.2.1–2.2.2, and the outer roof in OSM way 363244224.
// The three floors, white plaster and changing eaves sit on the stone platform in the terrain.
export function hikoneKeep(block,roof){
  const parts=[],plaster=[.71,.69,.61],tile=[.077,.084,.089],wood=[.11,.087,.063];
  function storey(w,d,h,base,roofHeight){
    block(parts,w,h,d,0,base+h/2,0,plaster);
    for(const side of [-1,1]){
      for(let i=-2;i<=2;i++){
        block(parts,.8,h*.38,.10,i*w*.165,base+h*.55,side*(d*.5+.02),wood);
      }
      for(const x of [-w*.49,w*.49])block(parts,.10,h*.36,.65,x,base+h*.52,side*d*.24,wood);
    }
    roof(parts,w*1.15,d*1.18,roofHeight,base+h,0,tile);
  }
  storey(20.3,12.3,4.25,0,2.9);
  storey(15.7,9.75,3.1,5.65,2.3);
  storey(10.8,7.4,3.3,9.85,3.65);
  for(const part of parts)part.geo.rotateY(-38.25*Math.PI/180);
  // Lower attached turrets run north and east from the keep.
  const wing=(w,d,x,z,angle)=>{
    const group=[];block(group,w,4,d,0,2,0,plaster);roof(group,w+.9,d+1,2.5,4,0,tile);
    for(let i=0;i<Math.floor(w/3);i++)block(group,.48,.64,.16,(i+.5)*3-w*.5,2.6,d*.5,wood);
    for(const part of group){part.geo.rotateY(angle);part.geo.translate(x,0,z);parts.push(part);}
  };
  wing(23,5.3,16,-13,.10);wing(10,7,2,-12,.10);
  return parts;
}

// The surveyed height sections retain the taper and terraces of the fourteen-storey waterfront hotel.
export function harborHotel(data){
  const parts=[],white=[.79,.78,.73],glass=[.14,.23,.27],step=data.height/data.floorOutlines.length;
  function slab(ring,low,high,color){
    const verts=[],outline=ring.map(([x,z])=>new Vector2(x,z));
    for(const tri of ShapeUtils.triangulateShape(outline,[]))for(const i of tri.reverse())verts.push(ring[i][0],high,ring[i][1]);
    ring.forEach(([x,z],i)=>{
      const [bx,bz]=ring[(i+1)%ring.length];
      verts.push(x,low,z,bx,high,bz,bx,low,bz,x,low,z,x,high,z,bx,high,bz);
    });
    const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(verts,3));geo.computeVertexNormals();
    parts.push({geo,color});
  }
  data.floorOutlines.forEach((ring,i)=>{
    const c=ring.reduce(([a,b],[x,z])=>[a+x/ring.length,b+z/ring.length],[0,0]);
    const inset=ring.map(([x,z])=>[c[0]+.95*(x-c[0]),c[1]+.94*(z-c[1])]);
    slab(inset,i*step,(i+1)*step,glass);
    slab(ring,i*step-.16,i*step+.82,white);
    if(i===data.floorOutlines.length-1)slab(ring,(i+1)*step-.9,(i+1)*step,white);
  });
  return parts;
}

// Real bed outlines; individual shrubs, blossom colours and spring growth are illustrative.
export function roseGarden(beds,lon,lat){
  const parts=[],flowers=[[.64,.034,.085],[.81,.32,.40],[.81,.71,.57],[.62,.14,.26],[.83,.59,.18]];
  for(const {way,ring} of beds){
    const outline=ring.map(([x,y])=>new Vector2((x-lon)*91635,(lat-y)*110946));
    const xs=outline.map(p=>p.x),zs=outline.map(p=>p.y);
    const w=Math.min(...xs),e=Math.max(...xs),s=Math.min(...zs),n=Math.max(...zs);
    const verts=[],top=.24;
    for(const tri of ShapeUtils.triangulateShape(outline,[]))for(const i of tri.reverse()){
      verts.push(outline[i].x,top,outline[i].y);
    }
    outline.forEach((a,i)=>{
      const b=outline[(i+1)%outline.length];
      verts.push(a.x,top,a.y,b.x,top,b.y,b.x,-.45,b.y,a.x,top,a.y,b.x,-.45,b.y,a.x,-.45,a.y);
    });
    const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(verts,3));geo.computeVertexNormals();
    parts.push({geo,color:[.15,.105,.060]});
    const inside=(x,z)=>outline.reduce((v,a,i)=>{
      const b=outline[(i+1)%outline.length];
      return (a.y>z)!==(b.y>z)&&x<(b.x-a.x)*(z-a.y)/(b.y-a.y)+a.x?!v:v;
    },false);
    let plant=0;
    for(let x=w+.27;x<e;x+=.70)for(let z=s+.27;z<n;z+=.72){
      if(!inside(x,z))continue;
      const crown=new IcosahedronGeometry(1,0);crown.scale(.36,.39,.36);crown.translate(x,.54,z);
      parts.push({geo:crown,color:[.075,.19,.061]});
      for(let i=0;i<4;i++){
        const a=i*1.57+plant,h=i%2?.85:.76;
        const bloom=new IcosahedronGeometry(.107,0);bloom.translate(x+.18*Math.cos(a),h,z+.18*Math.sin(a));
        parts.push({geo:bloom,color:flowers[way%flowers.length]});
      }
      plant++;
    }
  }
  return parts;
}
