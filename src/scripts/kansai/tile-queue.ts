import type {TileRequest,CompiledTile} from './tile-compiler';

export function tileQueue(includeTrees=true,datum:TileRequest['datum']='ellipsoid'){
  const jobs=new Map<number,{resolve:(tile:CompiledTile)=>void;reject:(error:Error)=>void}>();
  let sequence=0,disposed=false,worker:Worker|undefined;
  let local:Promise<ReturnType<typeof import('./tile-compiler').tileCompiler>>|undefined;
  async function fallback(request:TileRequest){
    local??=import('./tile-compiler').then(m=>m.tileCompiler());
    const compile=await local;
    return compile(request);
  }
  function reset(message:string){
    worker?.terminate();worker=undefined;
    for(const job of jobs.values())job.reject(Error(message));
    jobs.clear();
  }
  if(typeof Worker==='function'&&typeof OffscreenCanvas==='function'){
    try{
      worker=new Worker(new URL('./tile.worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=({data}:{data:{id:number;result:CompiledTile;error?:string}})=>{
        const job=jobs.get(data.id);if(!job)return;
        jobs.delete(data.id);
        if(data.error)job.reject(Error(data.error));else job.resolve(data.result);
      };
      worker.onerror=()=>reset('Regional model worker is unavailable');
    }catch{/* An inline compiler uses the same geometry on browsers without module workers. */}
  }
  return {
    compile(x:number,y:number,elevations:Float64Array<ArrayBuffer>){
      if(disposed)return Promise.reject(Error('Map closed'));
      const request={id:++sequence,x,y,elevations,includeTrees,datum};
      if(!worker)return fallback(request);
      return new Promise<CompiledTile>((resolve,reject)=>{
        jobs.set(sequence,{resolve,reject});
        try{worker!.postMessage(request,[elevations.buffer]);}
        catch(error){jobs.delete(request.id);reject(error);}
      });
    },
    dispose(){disposed=true;reset('Map closed');}
  };
}
export type TileQueue=ReturnType<typeof tileQueue>;
