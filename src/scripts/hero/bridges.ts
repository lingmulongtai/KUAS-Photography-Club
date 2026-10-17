import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {ENV_GLSL,SHADOW_GLSL,type Env} from './env.ts';
import type {Heightfield} from './heightfield';
import type {LineFeature} from './lines-data';
import type {KamoChannel} from './kamo-channel';

/** Sanjo: Kyoto City R5 bridge plan; Gojo: J-BEC bridge archive.
 * Other spans are simplified representations aligned to GSI road axes.
 * Angle is east toward south in the local x/z plane.
 */
export const KAMO_BRIDGES=[
  {id:'sanjo',x:1115.45,z:-604.86,angle:-6.876,length:73.3,width:16.7,timber:true},
  {id:'gojo',x:767.86,z:877.58,angle:9.823,length:67.2,width:35,timber:false},
  {id:'north-east',x:1378.03,z:-3406.76,angle:22.521,length:76,width:12},
  {id:'delta-east',x:1169.95,z:-2981.36,angle:16.547,length:62,width:12},
  {id:'delta-west',x:1056.62,z:-2976.53,angle:-22.642,length:62,width:8},
  {id:'kamo-ohashi',x:1114.17,z:-2818.07,angle:7.078,length:108,width:28},
  {id:'kojin',x:1087.22,z:-1977.77,angle:-1.712,length:92,width:18},
  {id:'marutamachi',x:1115.52,z:-1550.03,angle:.614,length:92,width:28},
  {id:'nijo',x:1106.46,z:-1065.75,angle:-1.424,length:90,width:18},
  {id:'oike',x:1117.51,z:-815.87,angle:-.667,length:95,width:28},
  {id:'shijo',x:1099.73,z:-24.61,angle:-.699,length:100,width:28},
  {id:'donguri',x:1043.27,z:156.89,angle:23.039,length:72,width:8},
  {id:'matsubara',x:885.04,z:526.49,angle:-2.102,length:78,width:8},
  {id:'shomen',x:702.91,z:1315.88,angle:-16.557,length:105,width:8},
];
export type Bridge=typeof KAMO_BRIDGES[number]&{deck:number;ramps:[number,number]};

export function bridgeFrame(b:{x:number;z:number;angle:number},x:number,z:number) {
  const a=b.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),dx=x-b.x,dz=z-b.z;
  return {along:dx*c+dz*s,across:-dx*s+dz*c};
}

export function buildBridges(env:Env,hf:Heightfield,lines:LineFeature[],channel:KamoChannel) {
  const definitions=[...KAMO_BRIDGES];
  // Small road crossings over side channels also need a deck once water is
  // continuous underneath them. Bound their number and keep major spans unique.
  for(const f of lines)if(f.kind===0&&(f.attr&15)>=1)for(let i=0;i<f.pts.length-2;i+=2) {
    if(definitions.length>=180)break;
    const ax=f.pts[i],az=f.pts[i+1],dx=f.pts[i+2]-ax,dz=f.pts[i+3]-az,len=Math.hypot(dx,dz);
    if(len<8||Math.abs(dx)<Math.abs(dz)*.7||!channel.inBounds((ax+f.pts[i+2])/2,(az+f.pts[i+3])/2))continue;
    let start=-1,end=-1;
    for(let t=0;t<=len;t+=2)if(channel.contains(ax+dx*t/len,az+dz*t/len)){if(start<0)start=t;end=t;}
    if(end-start<6||end-start>180)continue;
    const x=ax+dx*(start+end)/2/len,z=az+dz*(start+end)/2/len;
    if(definitions.some(b=>{const p=bridgeFrame(b,x,z);return Math.abs(p.along)<b.length/2+20&&Math.abs(p.across)<b.width/2+12;}))continue;
    definitions.push({id:'channel-'+definitions.length,x,z,angle:Math.atan2(dz,dx)*180/Math.PI,
      length:end-start+12,width:[3,6,11,18,28][Math.min(4,f.attr&15)]});
  }
  const geos:THREE.BufferGeometry[]=[],bridges:Bridge[]=[];
  const solid=(b:Bridge,w:number,h:number,d:number,x:number,y:number,z:number,color:number[],slope=0)=>{
    const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();
    if(slope) {
      const p=g.getAttribute('position');for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+p.getX(i)*slope);
      g.computeVertexNormals();
    }
    g.translate(x,y,z);g.rotateY(-b.angle*Math.PI/180);g.translate(b.x,b.deck,b.z);g.deleteAttribute('uv');
    const colors=new Float32Array(g.getAttribute('position').count*3);
    for(let i=0;i<colors.length;i+=3)colors.set(color,i);
    g.setAttribute('aColor',new THREE.BufferAttribute(colors,3));geos.push(g);
  };
  for(const def of definitions) {
    const a=def.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    let deck=channel.level(def.z)+1.3;
    for(let i=0;i<=12;i++) {
      const x=(i/12-.5)*def.length;
      deck=Math.max(deck,hf.height(def.x+c*x,def.z+s*x)+.25);
    }
    const ramps=[-1,1].map(end=>{
      const x=end*(def.length/2+8);return hf.height(def.x+c*x,def.z+s*x);
    }) as [number,number];
    const b={...def,deck,ramps};bridges.push(b);
    const stone=[.22,.22,.2],metal=[.1,.105,.11],wood=[.17,.09,.04];
    solid(b,b.length,.7,b.width,0,-.41,0,stone);
    solid(b,b.length,.09,Math.max(3,b.width-4),0,-.045,0,[.065,.07,.075]);
    for(const end of [-1,1]) {
      const h=b.ramps[end<0?0:1]-b.deck;
      solid(b,8,.2,b.width,end*(b.length/2+4),h/2-.1,0,[.065,.07,.075],end*h/8);
    }
    for(const side of [-1,1]) {
      solid(b,b.length,.12,1.65,0,.06,side*(b.width/2-.85),[.32,.3,.26]);
      const rail=b.timber?wood:metal,n=Math.ceil(b.length/2.2);
      for(let i=0;i<=n;i++)solid(b,.14,1.15,.14,(i/n-.5)*b.length,.67,side*(b.width/2-.16),rail);
      for(const y of [.45,1.18])solid(b,b.length,.12,.12,0,y,side*(b.width/2-.16),rail);
      solid(b,b.length,.6,.4,0,-.7,side*(b.width/2-.4),b.timber?wood:stone);
    }
    // Gojo's three spans; other bridge piers are illustrative, not a survey.
    for(const x of [-b.length/6,b.length/6]) {
      const bottom=channel.level(b.z)-3,top=b.deck-.6,h=Math.max(2,top-bottom);
      solid(b,1.6,h,b.width*.72,x,-.6-h/2,0,stone);
      solid(b,2.3,.6,b.width*.85,x,-.9,0,stone);
    }
    // A small centre marking; broad surfaces do not rely on a flickering texture.
    if(b.width>12)solid(b,b.length*.94,.012,.12,0,.008,0,[.42,.36,.16]);
  }
  const geometry=mergeGeometries(geos);geos.forEach(g=>g.dispose());
  const material=new THREE.ShaderMaterial({uniforms:env,
    vertexShader:`attribute vec3 aColor;varying vec3 vWorld;varying vec3 vNormal;varying vec3 vColor;
      void main(){vWorld=position;vNormal=normal;vColor=aColor;gl_Position=projectionMatrix*viewMatrix*vec4(position,1.);}`,
    fragmentShader:`${ENV_GLSL}\n${SHADOW_GLSL}
      varying vec3 vWorld;varying vec3 vNormal;varying vec3 vColor;
      void main(){vec3 n=normalize(vNormal);vec3 col=shade(vColor,n,vWorld,sunShadow(vWorld,n));
        gl_FragColor=vec4(applyHaze(col,vec3(.015,.01,.004)*uCity,vWorld),1.);}`});
  const mesh=new THREE.Mesh(geometry,material);
  // Cars query this every frame, so index the spans instead of searching all bridges.
  const cells=new Map<string,Bridge[]>();
  for(const b of bridges) {
    const r=(b.length+b.width)/2+10;
    for(let x=Math.floor((b.x-r)/100);x<=Math.floor((b.x+r)/100);x++)for(let z=Math.floor((b.z-r)/100);z<=Math.floor((b.z+r)/100);z++) {
      const key=x+','+z,list=cells.get(key)??[];list.push(b);cells.set(key,list);
    }
  }
  const heightAt=(x:number,z:number)=>{
    for(const b of cells.get(Math.floor(x/100)+','+Math.floor(z/100))??[]) {
      const p=bridgeFrame(b,x,z);
      if(Math.abs(p.across)>b.width/2||Math.abs(p.along)>b.length/2+8)continue;
      const t=THREE.MathUtils.clamp((Math.abs(p.along)-b.length/2)/8,0,1);
      return b.deck+(b.ramps[p.along<0?0:1]-b.deck)*t;
    }
    return hf.height(x,z);
  };
  return {mesh,bridges,heightAt};
}
