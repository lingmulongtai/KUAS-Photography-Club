import {cache} from './sources';

const size=256;
function canvas(){
  const tile=document.createElement('canvas');tile.width=tile.height=size;
  return tile;
}
// The GSI mosaic has gaps at its finer zooms, particularly near water. Crop the
// corresponding quadrant of the closest available parent at the same coordinates.
const read=cache<HTMLCanvasElement|undefined>(72,async key=>{
  const [zoom,x,y]=key.split('/').map(Number);
  const response=await fetch('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/'+zoom+'/'+x+'/'+y+'.jpg');
  if(response.ok){
    const bitmap=await createImageBitmap(await response.blob());
    try{const tile=canvas();tile.getContext('2d')!.drawImage(bitmap,0,0,size,size);return tile;}
    finally{bitmap.close();}
  }
  if(response.status!==404)throw Error('Aerial imagery '+response.status);
  if(zoom<=10)return;
  const parent=await aerialPhoto(zoom-1,x>>1,y>>1);
  if(!parent)return;
  const tile=canvas();
  tile.getContext('2d')!.drawImage(parent,(x%2)*128,(y%2)*128,128,128,0,0,size,size);
  return tile;
});
export function aerialPhoto(zoom:number,x:number,y:number):Promise<HTMLCanvasElement|undefined>{
  return read(zoom+'/'+x+'/'+y);
}
