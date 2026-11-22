import * as THREE from 'three';

/** Keep the original bitmap for context restoration. Publish the texture after its full mip chain exists. */
export async function uploadPhoto(renderer:THREE.WebGLRenderer,texture:THREE.Texture,needed:()=>boolean){
  const image=texture.image;
  if(typeof ImageBitmap==='undefined'||!(image instanceof ImageBitmap)||texture.flipY||image.width*image.height<=1024*1024){
    renderer.initTexture(texture);
    return;
  }
  // Allocate all levels but defer the pixels. A single 4096-wide port photo can otherwise block a frame.
  texture.source.dataReady=false;
  try{renderer.initTexture(texture);}finally{texture.source.dataReady=true;}
  const generate=texture.generateMipmaps,rows=Math.max(1,Math.floor(512*1024/image.width));
  const offset=new THREE.Vector2(),region=new THREE.Box2();
  const source=new THREE.Texture(image);
  try{
    for(let y=0;y<image.height;y+=rows){
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(!needed())return;
      const height=Math.min(rows,image.height-y);
      // Both textures use the already flipped bitmap, so row zero is the southern edge.
      region.min.set(0,y);region.max.set(image.width,y+height);
      texture.generateMipmaps=generate && y+height===image.height;
      renderer.copyTextureToTexture(source,texture,region,offset.set(0,y));
    }
  }catch{
    if(!needed())return;
    // Fall back to a complete upload if the driver cannot copy subregions.
    texture.generateMipmaps=generate;
    texture.needsUpdate=true;
    renderer.initTexture(texture);
  }finally{texture.generateMipmaps=generate;source.dispose();}
}
