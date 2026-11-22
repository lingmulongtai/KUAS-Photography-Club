import type {CesiumWidget,ImageryLayer} from 'cesium';
import {C} from './engine';

// The original photo records asphalt across the river. Reveal the neighbouring
// photographed water only while the two replacement bridge meshes are in view.
export function setaWater(widget:CesiumWidget){
  const scene=widget.scene,layers=widget.imageryLayers;
  let layer:ImageryLayer|undefined,loading=false,visible=false,closed=false,retry=0;
  async function load(){
    loading=true;
    try{
      const provider=await C.SingleTileImageryProvider.fromUrl('/kansai/landmarks/seta-water.png',{
        rectangle:C.Rectangle.fromDegrees(135.90484,34.97261,135.90769,34.97351),
        credit:'国土地理院（全国最新写真・水域の補間）',
      });
      if(closed||widget.isDestroyed())return;
      layer=layers.addImageryProvider(provider);apply();
    }catch{retry=Date.now()+30000;}
    finally{loading=false;}
  }
  function apply(){
    if(!layer)return;
    const brightness=layers.get(0).brightness;
    if(layer.show===visible&&layer.brightness===brightness)return;
    layer.brightness=brightness;layer.show=visible;scene.requestRender();
  }
  return {
    update(tiles:ReadonlySet<string>){
      visible=tiles.has('57508/25964')&&tiles.has('57509/25964');
      if(visible&&!layer&&!loading&&Date.now()>=retry)void load();
      apply();
    },
    dispose(){closed=true;if(layer)layers.remove(layer);},
  };
}
