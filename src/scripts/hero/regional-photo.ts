import * as THREE from 'three';
import {lonLat,tileXY} from '../kansai/coordinates';
import expo from '../../../public/kansai/expo-imagery/index.json';
import {M_PER_DEG_LAT,M_PER_DEG_LON,ORIGIN,toLocal,type Box} from './geo';

export interface RegionalPhoto {photo:THREE.Texture;box:Box;raw?:boolean}
export interface RegionalPhotoOptions {
  radius?: 1 | 2;
  maxZoom?: 16 | 17;
  /** Zoom level already covered by a harmonized local district sheet at the target. */
  coveredZoom?: number;
  /** True while flying to a destination: prefetch at z16 without dropping to z15. */
  prefetch?: boolean;
}

const TILE_PX = 256;

/** Fetch a GSI seamlessphoto tile, falling back to cropping the parent quadrant on 404 (e.g. open water). */
function createTileCache(limit = 64) {
  const blobs = new Map<string, Blob | null>();
  function remember(key: string, value: Blob | null) {
    blobs.delete(key);
    blobs.set(key, value);
    if (blobs.size > limit) blobs.delete(blobs.keys().next().value!);
  }
  async function loadBlob(zoom: number, x: number, y: number, signal: AbortSignal): Promise<Blob | null> {
    const k = `${zoom}/${x}/${y}`;
    if (blobs.has(k)) {
      const hit = blobs.get(k)!;
      remember(k, hit);
      return hit;
    }
    const url = `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${zoom}/${x}/${y}.jpg`;
    const res = await fetch(url, { signal });
    if (res.status === 404) {
      remember(k, null);
      return null;
    }
    if (!res.ok) throw new Error('Regional aerial photo: ' + res.status);
    const blob = await res.blob();
    remember(k, blob);
    return blob;
  }
  async function drawTile(
    ctx: CanvasRenderingContext2D,
    destX: number,
    destY: number,
    zoom: number,
    x: number,
    y: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    let z = zoom, tx = x, ty = y;
    let sx = 0, sy = 0, sw = TILE_PX;
    while (z >= 14) {
      if (signal.aborted) return false;
      const blob = await loadBlob(z, tx, ty, signal);
      if (blob) {
        if (signal.aborted) return false;
        const bitmap = await createImageBitmap(blob);
        try {
          if (!signal.aborted) ctx.drawImage(bitmap, sx, sy, sw, sw, destX, destY, TILE_PX, TILE_PX);
        } finally {
          bitmap.close();
        }
        return !signal.aborted;
      }
      // Step up to parent tile and narrow source crop to the matching child quadrant.
      const half = sw * 0.5;
      sx = (tx & 1) * 128 + sx * 0.5;
      sy = (ty & 1) * 128 + sy * 0.5;
      sw = half;
      tx >>= 1;
      ty >>= 1;
      z--;
    }
    return false;
  }
  return { drawTile };
}

/** Choose live GSI orthophoto zoom from camera altitude and quality tier ceiling. */
export function selectRegionalPhotoZoom(height: number, fast: boolean, maxZoom: 16 | 17, prefetch = false): number {
  if (prefetch) return Math.min(maxZoom, 16);
  if (fast) return 15;
  if (height < 380) return maxZoom;
  if (height < 1150) return 16;
  return 15;
}

/** One orthophoto sampler follows the camera look-ahead target, including across prefecture lines. */
export function regionalPhoto(aniso:number,onChange:(sheet:RegionalPhoto|null)=>void){
  let controller:AbortController|undefined,active:RegionalPhoto|null=null;
  let requested='',candidate='',since=0,retryAt=0;
  let lastX=NaN,lastZ=NaN,lastTime=0,fastUntil=0;
  const tileCache = createTileCache(72);

  function install(sheet:RegionalPhoto|null){
    const previous=active;active=sheet;onChange(sheet);previous?.photo.dispose();
  }
  async function prepare(cx:number,cy:number,zoom:number,radius:1|2,signal:AbortSignal){
    const grid = radius * 2 + 1;
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=grid*TILE_PX;
    const context=canvas.getContext('2d')!;
    const west=cx-radius,north=cy-radius;
    const tiles:{x:number;y:number}[]=[];
    for(let y=0;y<grid;y++)for(let x=0;x<grid;x++)tiles.push({x,y});
    tiles.sort((a,b)=>Math.hypot(a.x-radius,a.y-radius)-Math.hypot(b.x-radius,b.y-radius));
    let count=0;
    async function read(){
      while(!signal.aborted && tiles.length){
        const {x,y}=tiles.shift()!;
        if(await tileCache.drawTile(context,x*TILE_PX,y*TILE_PX,zoom,west+x,north+y,signal))count++;
      }
    }
    const workers = radius >= 2 ? [read(),read(),read(),read()] : [read(),read(),read()];
    await Promise.all(workers);
    if(signal.aborted || !count)return;
    const photo=new THREE.CanvasTexture(canvas);
    photo.colorSpace=THREE.SRGBColorSpace;
    photo.anisotropy=aniso;
    const a=lonLat(west,north,zoom),b=lonLat(west+grid,north+grid,zoom);
    const nw=toLocal(a[1],a[0]),se=toLocal(b[1],b[0]);
    install({photo,box:[nw.x,nw.z,se.x,se.z],raw:true});
  }
  return (x:number,z:number,height:number,now:number,enabled:boolean,options:RegionalPhotoOptions={})=>{
    if(!enabled){
      controller?.abort();controller=undefined;
      candidate=requested='';lastX=NaN;
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
    if(now>lastTime && !options.prefetch && Math.hypot(x-lastX,z-lastZ)>(now-lastTime)*320)fastUntil=now+0.9;
    lastX=x;lastZ=z;lastTime=now;
    const maxZoom = options.maxZoom ?? 17;
    const zoom = selectRegionalPhotoZoom(height, now < fastUntil, maxZoom, !!options.prefetch);
    // If a harmonized local district sheet already matches or exceeds this zoom, keep it cleanly.
    if ((options.coveredZoom ?? 0) >= zoom) {
      controller?.abort();controller=undefined;
      candidate=requested='';
      if(active)install(null);
      return;
    }
    const radius: 1 | 2 = options.radius ?? 2;
    const [cx,cy]=tileXY(lon,lat,zoom).map(Math.floor);
    const key=zoom+'/'+radius+'/'+cx+'/'+cy;
    if(candidate!==key){candidate=key;since=now;}
    if(requested===key || now-since<.15 || now<retryAt)return;
    controller?.abort();
    controller=new AbortController();
    const signal=controller.signal;
    requested=key;
    void prepare(cx,cy,zoom,radius,signal).catch(()=>{
      if(!signal.aborted){requested='';retryAt=performance.now()/1000+8;}
    });
  };
}
