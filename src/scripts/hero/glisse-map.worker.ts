import {glassMap} from './glisse-map';

function png(canvas:OffscreenCanvas){
  return canvas.convertToBlob({type:'image/png'}).then(blob=>new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  }));
}

self.onmessage=async({data}:{data:{width:number;height:number;radius:number}})=>{
  try{
    const map=glassMap(data.width,data.height,data.radius);
    if(!map){self.postMessage({maps:null});return;}
    const canvas=new OffscreenCanvas(map.width,map.height),context=canvas.getContext('2d');
    if(!context)throw Error('Missing 2D canvas');
    context.putImageData(new ImageData(map.field,map.width,map.height),0,0);
    const displacement=await png(canvas);
    context.putImageData(new ImageData(map.shine,map.width,map.height),0,0);
    const rim=await png(canvas);
    self.postMessage({maps:{width:map.width,height:map.height,scale:map.scale,displacement,rim}});
  }catch(error){self.postMessage({error:String(error)});}
};
