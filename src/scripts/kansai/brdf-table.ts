import type {CesiumWidget} from 'cesium';
import {C} from './engine';
import {inflate} from './sources';

type Texture=object;
type Generator={colorTexture?:Texture;_colorTexture?:Texture};
type NativeScene={context:object;_brdfLutGenerator?:Generator};
type NativeEngine={VERSION:string;Sampler:{NEAREST:object};Texture:new(options:{
  context:object;source:{width:number;height:number;arrayBufferView:Uint8Array};sampler:object;flipY:boolean;
})=>Texture};

// Cesium 1.133 integrates these same 65,536 texels on the first PBR model.
// Its scene generator owns and destroys the texture; native update remains the fallback.
export async function loadBrdfTable(widget:CesiumWidget){
  const engine=C as unknown as NativeEngine;
  const scene=widget.scene as unknown as NativeScene,generator=scene._brdfLutGenerator;
  if(engine.VERSION!=='1.133'||!generator||!Object.hasOwn(generator,'_colorTexture')||generator.colorTexture)return;
  try{
    const r=await fetch('/kansai/lighting/brdf-1.133.rgba.gz');
    if(!r.ok)return;
    const bytes=new Uint8Array(await inflate(new Uint8Array(await r.arrayBuffer())));
    if(bytes.length!==256*256*4||widget.isDestroyed()||generator.colorTexture)return;
    generator._colorTexture=new engine.Texture({context:scene.context,
      source:{width:256,height:256,arrayBufferView:bytes},sampler:engine.Sampler.NEAREST,flipY:false});
    widget.scene.requestRender();
  }catch{/* Native integration remains available when the table cannot be installed. */}
}
