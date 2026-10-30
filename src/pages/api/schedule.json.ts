import type { APIRoute } from 'astro';
import { fetchGoogleSchedule, type LiveSchedule } from '../../lib/google-schedule';
import {createScheduleTranslator} from '../../lib/schedule-translation';

export const prerender=false;
let cached:LiveSchedule|null=null;
let pending:Promise<LiveSchedule>|null=null;
const translator=createScheduleTranslator();
let translated:{source:LiveSchedule;data:LiveSchedule}|null=null;
let translating:{source:LiveSchedule;promise:Promise<LiveSchedule>}|null=null;
export const GET:APIRoute=async({url})=>{
  try {
    if(!cached||Date.now()-Date.parse(cached.updatedAt)>60000) {
      pending??=fetchGoogleSchedule().finally(()=>{pending=null;});
      cached=await pending;
    }
    let data=cached;
    if(url.searchParams.get('lang')==='en') {
      if(translated?.source!==cached) {
        const source=cached;
        if(translating?.source!==source) {
          const promise=translator.translate(source.events).then(result=>{
            const data={...source,...result};
            if(result.translationStatus==='complete'&&cached===source)translated={source,data};
            return data;
          }).finally(()=>{if(translating?.promise===promise)translating=null;});
          translating={source,promise};
        }
        data=await translating.promise;
      } else data=translated.data;
    }
    return Response.json(data,{headers:{
      'Cache-Control':data.translationStatus==='partial'?'no-store':'public, max-age=0, s-maxage=60, stale-while-revalidate=60',
      'X-Content-Type-Options':'nosniff',
    }});
  }catch{
    // Never pass upstream responses or calendar metadata into an error message.
    return Response.json({error:'calendar_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
};
