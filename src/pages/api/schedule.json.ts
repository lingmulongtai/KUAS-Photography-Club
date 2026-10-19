import type { APIRoute } from 'astro';
import { fetchGoogleSchedule, type LiveSchedule } from '../../lib/google-schedule';

export const prerender=false;
let cached:LiveSchedule|null=null;
let pending:Promise<LiveSchedule>|null=null;
export const GET:APIRoute=async()=>{
  try {
    if(!cached||Date.now()-Date.parse(cached.updatedAt)>60000) {
      pending??=fetchGoogleSchedule().finally(()=>{pending=null;});
      cached=await pending;
    }
    return Response.json(cached,{headers:{
      'Cache-Control':'public, max-age=0, s-maxage=60, stale-while-revalidate=60',
      'X-Content-Type-Options':'nosniff',
    }});
  }catch{
    // Never pass upstream responses or calendar metadata into an error message.
    return Response.json({error:'calendar_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
};
