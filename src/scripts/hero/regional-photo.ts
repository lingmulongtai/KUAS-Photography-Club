import * as THREE from 'three';
import {lonLat,tileXY} from '../kansai/coordinates';
import expo from '../../../public/kansai/expo-imagery/index.json';
import {M_PER_DEG_LAT,M_PER_DEG_LON,ORIGIN,toLocal,type Box} from './geo';

export interface RegionalPhoto {photo:THREE.Texture;box:Box}
const radius=1,size=(radius*2+1)*256;

/** One orthophoto sampler follows the camera, including when crossing an internal prefecture line. */
export function regionalPhoto(aniso:number,onChange:(sheet:RegionalPhoto|null)=>void){
  let controller:AbortController|undefined,active:RegionalPhoto|null=null;
  let requested='',candidate='',since=0,retryAt=0;
  function install(sheet:RegionalPhoto|null){
    const previous=active;active=sheet;onChange(sheet);previous?.photo.dispose();
  }
  async function prepare(cx:number,cy:number,zoom:number,signal:AbortSignal){
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=size;
    const context=canvas.getContext('2d')!;
    const west=cx-radius,north=cy-radius;
    const tiles:{x:number;y:number}[]=[];
    for(let y=0;y<=2*radius;y++)for(let x=0;x<=2*radius;x++)tiles.push({x,y});
    tiles.sort((a,b)=>Math.hypot(a.x-radius,a.y-radius)-Math.hypot(b.x-radius,b.y-radius));
    let count=0;
    async function read(){
      while(!signal.aborted && tiles.length){
        const {x,y}=tiles.shift()!;
        const url='https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/'+zoom+'/'+(west+x)+'/'+(north+y)+'.jpg';
        const res=await fetch(url,{signal});
        if(res.status===404)continue;
        if(!res.ok)throw new Error('Regional aerial photo: '+res.status);
        const image=await createImageBitmap(await res.blob());
        if(!signal.aborted){context.drawImage(image,x*256,y*256);count++;}
        image.close();
      }
    }
    await Promise.all([read(),read(),read()]);
    if(signal.aborted || !count)return;
    const photo=new THREE.CanvasTexture(canvas);
    photo.colorSpace=THREE.SRGBColorSpace;
    photo.anisotropy=aniso;
    const a=lonLat(west,north,zoom),b=lonLat(west+2*radius+1,north+2*radius+1,zoom);
    const nw=toLocal(a[1],a[0]),se=toLocal(b[1],b[0]);
    install({photo,box:[nw.x,nw.z,se.x,se.z]});
  }
  return (x:number,z:number,height:number,now:number,enabled:boolean)=>{
    if(!enabled){
      controller?.abort();controller=undefined;
      candidate=requested='';
      if(active)install(null);
      return;
    }
    const lon=ORIGIN.lon+x/M_PER_DEG_LON,lat=ORIGIN.lat-z/M_PER_DEG_LAT;
    const [w,s,e,n]=expo.bounds;
    if(lon>=w && lon<=e && lat>=s && lat<=n){
      if(requested==='expo' || now<retryAt)return;
      controller?.abort();
      requested=candidate='expo';
      void new THREE.TextureLoader().loadAsync('/kansai/expo-imagery/home.webp').then(photo=>{
        if(requested!=='expo'){photo.dispose();return;}
        photo.colorSpace=THREE.SRGBColorSpace;photo.anisotropy=aniso;
        const nw=toLocal(n,w),se=toLocal(s,e);
        install({photo,box:[nw.x,nw.z,se.x,se.z]});
      }).catch(()=>{if(requested==='expo'){requested='';retryAt=performance.now()/1000+8;}});
      return;
    }
    const zoom=height>450?15:16;
    const [cx,cy]=tileXY(ORIGIN.lon+x/M_PER_DEG_LON,ORIGIN.lat-z/M_PER_DEG_LAT,zoom).map(Math.floor);
    const key=zoom+'/'+cx+'/'+cy;
    if(candidate!==key){candidate=key;since=now;}
    if(requested===key || now-since<.18 || now<retryAt)return;
    controller?.abort();
    controller=new AbortController();
    const signal=controller.signal;
    requested=key;
    void prepare(cx,cy,zoom,signal).catch(()=>{
      if(!signal.aborted){requested='';retryAt=performance.now()/1000+8;}
    });
  };
}
