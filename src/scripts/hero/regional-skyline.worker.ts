import {compileSkyline,type Request} from './regional-skyline-data';

const heights=new Map<number,(values:Float32Array<ArrayBuffer>)=>void>();
self.onmessage=async({data}:{data:{id:number;request?:Request;values?:Float32Array<ArrayBuffer>}})=>{
  const {id,request,values}=data;
  if(values){heights.get(id)?.(values);heights.delete(id);return;}
  if(!request)return;
  try{
    const result=await compileSkyline(request,centers=>new Promise(resolve=>{
      heights.set(id,resolve);self.postMessage({id,centers},{transfer:[centers.buffer]});
    }),async()=>true);
    const transfer=result?[result.positions.buffer,result.normals.buffer,result.uv.buffer,result.colors.buffer,result.identity.buffer,result.beaconPos.buffer,result.beaconMeta.buffer]:[];
    self.postMessage({id,result},{transfer});
  }catch(error){self.postMessage({id,error:String(error)});}
};
