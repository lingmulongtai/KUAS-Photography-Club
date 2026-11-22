import * as THREE from 'three';
import {lonLat,tileXY} from '../kansai/coordinates';
import {inflate,json} from '../kansai/sources';
import {ENV_GLSL,type Env} from './env';
import {ORIGIN,M_PER_DEG_LAT,M_PER_DEG_LON,toLocal,type Box} from './geo';

type Tile={key:string;x:number;y:number};
type Batch={count:number;mesh:THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;mask:THREE.DataTexture};
const district=(x:number,y:number)=>x+'/'+y;

// A district uses one instanced draw and an 8-byte record per mapped roof.
export async function regionalNeighborhoods(scene:THREE.Scene,env:Env,ground:(x:number,z:number)=>number,
  lite:boolean,prepare:(model:THREE.Object3D)=>Promise<unknown>){
  const {tiles}=await json<{tiles:Record<string,number>}>('neighborhoods/index.json');
  const block=new THREE.BoxGeometry(1,1,1),activeBox={value:new THREE.Vector4(1,1,0,0)};
  const loaded=new Map<string,Batch>(),pending=new Set<string>(),retry=new Map<string,number>();
  let wanted=new Map<string,Tile>(),previous='',next=0,near=new Set<string>(),ready:Promise<unknown>|undefined;
  const maskFor=({x,y}:Tile,mask:THREE.DataTexture)=>{
    const data=mask.image.data as Uint8Array;
    for(let i=0;i<256;i++)data[i]=near.has('16/'+(x*16+i%16)+'/'+(y*16+(i>>4)))?255:0;
    mask.needsUpdate=true;
  };
  async function create(t:Tile){
    const res=await fetch('/kansai/neighborhoods/'+t.x+'-'+t.y+'.bin.gz');
    if(!res.ok)throw new Error('Roof survey '+res.status);
    const bytes=new Uint8Array(await inflate(new Uint8Array(await res.arrayBuffer())));
    if(!wanted.has(t.key))return;
    const count=tiles[t.key],data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(bytes.length!==count*8)throw new Error('Incomplete roof survey '+t.key);
    const centers=new Float32Array(count*4),sizes=new Float32Array(count*4);
    const bounds=new THREE.Box3(),p=new THREE.Vector3();
    // Scatter the prefix uniformly so far LOD retains streets throughout the district.
    let stride=1597;
    function gcd(a:number,b:number):number{return b?gcd(b,a%b):a;}
    while(gcd(stride,count)!==1)stride++;
    for(let i=0;i<count;i++){
      const k=((i*stride)%count)*8,u=data.getUint16(k,true)/65535,v=data.getUint16(k+2,true)/65535;
      const [lon,lat]=lonLat(t.x+u,t.y+v,12),{x,z}=toLocal(lat,lon);
      const h=bytes[k+6],w=bytes[k+4],d=bytes[k+5],base=ground(x,z);
      centers.set([x,base+h/2,z,Math.min(15,Math.floor(v*16))*16+Math.min(15,Math.floor(u*16))],i*4);
      sizes.set([w,h,d,bytes[k+7]*Math.PI/256],i*4);
      const radius=Math.hypot(w,d)*.5;
      bounds.expandByPoint(p.set(x-radius,base,z-radius));bounds.expandByPoint(p.set(x+radius,base+h,z+radius));
      if(i%2048===2047){await new Promise(r=>setTimeout(r,0));if(!wanted.has(t.key))return;}
    }
    const mask=new THREE.DataTexture(new Uint8Array(256),16,16,THREE.RedFormat);
    mask.minFilter=mask.magFilter=THREE.NearestFilter;
    const geometry=new THREE.InstancedBufferGeometry();
    geometry.index=block.index;
    geometry.setAttribute('position',block.getAttribute('position'));geometry.setAttribute('normal',block.getAttribute('normal'));
    geometry.setAttribute('roofCenter',new THREE.InstancedBufferAttribute(centers,4));
    geometry.setAttribute('roofSize',new THREE.InstancedBufferAttribute(sizes,4));
    geometry.instanceCount=count;geometry.boundingSphere=bounds.getBoundingSphere(new THREE.Sphere());
    const material=new THREE.ShaderMaterial({uniforms:{...env,uNearby:{value:mask},uDetail:activeBox},vertexShader:`
      attribute vec4 roofCenter,roofSize;
      uniform sampler2D uNearby;uniform vec4 uDetail;
      varying vec3 vWorld,vNormal;varying float vTint;
      void main(){
        vec2 center=roofCenter.xz;
        vec2 maskUv=(vec2(mod(roofCenter.w,16.),floor(roofCenter.w/16.))+.5)/16.;
        bool hidden=texture2D(uNearby,maskUv).r>.5 ||
          (all(greaterThanEqual(center,uDetail.xy)) && all(lessThan(center,uDetail.zw)));
        float c=cos(roofSize.w),s=sin(roofSize.w);
        mat2 rotation=mat2(c,s,-s,c);
        vec3 pos=position*roofSize.xyz;
        pos.xz=rotation*pos.xz;vWorld=roofCenter.xyz+pos;
        vNormal=vec3(normal);vNormal.xz=rotation*normal.xz;
        vTint=fract(roofSize.w*7.31+roofSize.x*.53);
        gl_Position=hidden?vec4(2.,2.,2.,1.):projectionMatrix*viewMatrix*vec4(vWorld,1.);
      }`,fragmentShader:`${ENV_GLSL}
        varying vec3 vWorld,vNormal;varying float vTint;
        void main(){
          float roof=step(.5,vNormal.y);
          vec3 surface=mix(mix(vec3(.22,.195,.17),vec3(.38,.36,.32),vTint),
                           mix(vec3(.052,.067,.077),vec3(.16,.14,.12),vTint),roof);
          vec3 emit=vec3(.23,.145,.071)*uCity*uLit*(1.-roof)*(.35+.65*vTint);
          gl_FragColor=vec4(applyHaze(shade(surface,vNormal,vWorld,1.),emit,vWorld),1.);
        }`});
    const mesh=new THREE.Mesh(geometry,material);mesh.name='regional-neighborhood-'+t.key;
    try{await (ready??=prepare(mesh));}catch(error){ready=undefined;geometry.dispose();material.dispose();mask.dispose();throw error;}
    if(!wanted.has(t.key)){geometry.dispose();material.dispose();mask.dispose();return;}
    maskFor(t,mask);scene.add(mesh);loaded.set(t.key,{mesh,mask,count});
  }
  function setNear(keys:Set<string>){
    near=keys;
    for(const [key,b] of loaded){const t=wanted.get(key);if(t)maskFor(t,b.mask);}
  }
  function update(x:number,z:number,dirX:number,dirZ:number,now:number,detail:Box|null){
    if(now<next)return;
    next=now+.18;
    activeBox.value.set(...(detail??[1,1,0,0] as Box));
    const [tx,ty]=tileXY(ORIGIN.lon+x/M_PER_DEG_LON,ORIGIN.lat-z/M_PER_DEG_LAT,12);
    const heading=Math.atan2(dirX,-dirZ),signature=[Math.floor(tx*4),Math.floor(ty*4),Math.round(heading*5)].join('/');
    if(signature!==previous){
      previous=signature;
      const jobs:{t:Tile;score:number}[]=[];
      for(let j=-4;j<=4;j++)for(let i=-4;i<=4;i++){
        const a=Math.floor(tx)+i,b=Math.floor(ty)+j,key=district(a,b);
        if(!tiles[key])continue;
        const dx=a+.5-tx,dz=b+.5-ty,distance=Math.hypot(dx,dz);
        const forward=(dx*dirX+dz*dirZ)/Math.max(.01,distance);
        if(distance>(lite?2.7:3.65) || (distance>1.55 && forward<.15))continue;
        jobs.push({t:{key,x:a,y:b},score:distance*(1-.4*forward)});
      }
      wanted=new Map(jobs.sort((a,b)=>a.score-b.score).map(({t})=>[t.key,t]));
      for(const [key,b] of loaded)if(!wanted.has(key)){
        const [a,row]=key.split('/').map(Number);
        if(Math.hypot(a+.5-tx,row+.5-ty)<(lite?3.3:4.4)){b.mesh.visible=false;continue;}
        scene.remove(b.mesh);b.mesh.geometry.dispose();b.mesh.material.dispose();b.mask.dispose();loaded.delete(key);
      }
      for(const key of wanted.keys()){const b=loaded.get(key);if(b){b.mesh.visible=true;maskFor(wanted.get(key)!,b.mask);}}
    }
    for(const t of wanted.values()){
      const batch=loaded.get(t.key);
      if(!batch)continue;
      const distance=Math.max(0,Math.hypot(t.x+.5-tx,t.y+.5-ty)-.65);
      batch.mesh.geometry.instanceCount=Math.max(1,Math.ceil(batch.count/(1+distance*distance*(lite?2.2:1.4))));
    }
    for(const t of wanted.values()){
      if(pending.size>=2)break;
      if(loaded.has(t.key)||pending.has(t.key)||(retry.get(t.key)??0)>now)continue;
      pending.add(t.key);
      void create(t).catch(error=>{retry.set(t.key,performance.now()/1000+15);console.warn('Distant neighborhood unavailable',t.key,error);})
        .finally(()=>pending.delete(t.key));
    }
  }
  return {update,setNear};
}
