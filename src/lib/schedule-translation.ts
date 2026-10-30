import type {ScheduleEvent} from './schedule.ts';

const JAPANESE=/[\u3040-\u30ff\u3400-\u9fff]/u;
const known=new Map([
  ['写真部ミーティング','Photography Club Meeting'],
  // KUAS uses the romanized festival name, not its literal translation.
  ['龍尾祭','Ryubisai Festival'],
  ['写真部ミーティング 休み','Photography Club Meeting cancelled'],
  ['写真部ミーティング　休み','Photography Club Meeting cancelled'],
]);

/** Translate only sanitized public calendar titles. Keep a small success-only cache. */
export function createScheduleTranslator(request:typeof fetch=fetch,now:()=>number=Date.now) {
  const cache=new Map<string,{text:string;expires:number}>();
  const inFlight=new Map<string,Promise<string|undefined>>();
  const one=(title:string,signal:AbortSignal):Promise<string|undefined>=>{
    if(known.has(title))return Promise.resolve(known.get(title));
    const hit=cache.get(title);if(hit&&hit.expires>now())return Promise.resolve(hit.text);
    const pending=inFlight.get(title);if(pending)return pending;
    if(new TextEncoder().encode(title).length>500)return Promise.resolve(undefined);
    const work=(async()=>{
      try {
        const url=new URL('https://api.mymemory.translated.net/get');
        url.searchParams.set('q',title);url.searchParams.set('langpair','ja|en');
        const response=await request(url,{signal,redirect:'error'});
        if(!response.ok)return undefined;
        const data=await response.json() as {responseStatus?:number;quotaFinished?:boolean;responseData?:{translatedText?:unknown}};
        if(data.responseStatus!==200||data.quotaFinished||typeof data.responseData?.translatedText!=='string')return undefined;
        const text=data.responseData.translatedText.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
        if(!text||text.length>500||JAPANESE.test(text)||/[<>]/.test(text))return undefined;
        // A mistranslated cancellation can send someone to an event that is not taking place.
        if(/休会|中止|休み/.test(title)&&!/cancel|no (?:meeting|session|event)|not (?:held|taking place)/i.test(text))return undefined;
        if(/延期/.test(title)&&!/postpon|reschedul|defer/i.test(text))return undefined;
        cache.delete(title);cache.set(title,{text,expires:now()+24*60*60*1000});
        if(cache.size>256)cache.delete(cache.keys().next().value!);
        return text;
      }catch{return undefined;}
    })();
    inFlight.set(title,work);void work.finally(()=>{if(inFlight.get(title)===work)inFlight.delete(title);});
    return work;
  };
  return {
    async translate(events:ScheduleEvent[],timeoutMs=3500) {
      const unique=[...new Set(events.filter(e=>!e.titleEn&&JAPANESE.test(e.title)).map(e=>e.title))];
      const results=new Map<string,string>();let cursor=0;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      const worker=async()=>{while(!controller.signal.aborted){
        const title=unique[cursor++];if(title===undefined)return;
        const value=await one(title,controller.signal);if(value)results.set(title,value);
      }};
      try {
        await Promise.race([Promise.all(Array.from({length:Math.min(4,unique.length)},worker)),
          new Promise<void>(resolve=>controller.signal.addEventListener('abort',()=>resolve(),{once:true}))]);
      } finally {clearTimeout(timer);controller.abort();}
      const translated=events.map(e=>e.titleEn||!results.has(e.title)?e:{...e,titleEn:results.get(e.title)});
      return {events:translated,translationStatus:unique.every(title=>results.has(title))?'complete' as const:'partial' as const};
    },
  };
}
