import {compileSkyline,type Request,type Skyline} from './regional-skyline-data';

type Job={sample:(points:Float32Array)=>Float32Array<ArrayBuffer>;resolve:(result:Skyline|null)=>void;reject:(e:Error)=>void};

// Exact same terrain function for street tiles, landmarks and the far skyline.
export function skylineReader(ground:(x:number,z:number)=>number){
  const jobs=new Map<number,Job>();
  let worker:Worker|undefined,id=0;
  if(typeof Worker==='function')try{
    worker=new Worker(new URL('./regional-skyline.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=({data}:{data:{id:number;centers?:Float32Array;result:Skyline|null;error?:string}})=>{
      const job=jobs.get(data.id);
      if(!job)return;
      if(data.centers){
        const values=job.sample(data.centers);
        worker!.postMessage({id:data.id,values},[values.buffer]);
        return;
      }
      jobs.delete(data.id);
      if(data.error)job.reject(new Error(data.error));else job.resolve(data.result);
    };
    worker.onerror=()=>{
      worker?.terminate();worker=undefined;
      for(const job of jobs.values())job.reject(new Error('Skyline worker stopped'));
      jobs.clear();
    };
  }catch{/* Use the time-sliced local compiler on browsers without module workers. */}
  return (request:Request,current:()=>boolean)=>{
    const sample=(points:Float32Array)=>{
      if(!current())return new Float32Array();
      const h=new Float32Array(points.length/2);
      for(let j=0;j<h.length;j++)h[j]=ground(points[j*2],points[j*2+1]);
      return h;
    };
    if(!worker)return compileSkyline(request,async p=>sample(p),async()=>{
      await new Promise(resolve=>setTimeout(resolve,0));return current();
    });
    return new Promise<Skyline|null>((resolve,reject)=>{
      jobs.set(++id,{resolve,reject,sample});worker!.postMessage({id,request});
    });
  };
}
