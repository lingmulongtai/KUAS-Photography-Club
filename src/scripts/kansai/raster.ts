/** Read a source raster without moving its decoded pixels between threads. */
export function rasterPixels(bitmap:ImageBitmap){
  try{
    const canvas=typeof OffscreenCanvas==='function'?
      new OffscreenCanvas(bitmap.width,bitmap.height):document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
    ctx.drawImage(bitmap,0,0);
    return ctx.getImageData(0,0,bitmap.width,bitmap.height);
  }finally{bitmap.close();}
}
