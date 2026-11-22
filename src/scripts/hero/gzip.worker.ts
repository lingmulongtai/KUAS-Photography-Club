import {expandGzip} from './gzip';

self.onmessage=async({data}:{data:{id:number;bytes:Uint8Array<ArrayBuffer>}})=>{
  try{
    const bytes=await expandGzip(data.bytes);
    self.postMessage({id:data.id,bytes},{transfer:[bytes.buffer]});
  }catch(error){self.postMessage({id:data.id,error:String(error)});}
};
