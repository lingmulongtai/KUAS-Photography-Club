import {scheduleText} from '../lib/schedule-display';
import type {LiveSchedule} from '../lib/google-schedule';
import type {ScheduleEvent} from '../lib/schedule';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{
  const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;
};
const dayString=(date:Date)=>new Date(+date+9*3600000).toISOString().slice(0,10);
const kinds={ja:{meeting:'ミーティング',trip:'撮影会',event:'イベント',deadline:'締切',other:'お知らせ'},en:{meeting:'Meeting',trip:'Photo outing',event:'Event',deadline:'Deadline',other:'Notice'}};
for(const root of document.querySelectorAll<HTMLElement>('[data-calendar-root]')) {
  const lang=root.dataset.lang==='en'?'en':'ja',en=lang==='en',compact=root.dataset.compact==='true';
  const content=root.querySelector<HTMLElement>('[data-calendar-content]')!,status=root.querySelector<HTMLElement>('[data-calendar-status]')!;
  let last='',busy=false;
  function eventList(events:ScheduleEvent[],today:string) {
    const list=element('ol','calendar-list');
    for(const event of events) {
      const li=element('li','calendar-event k-'+event.kind+(event.date<today?' past':''));li.dataset.date=event.date;
      const date=new Date(event.date+'T00:00:00Z');
      li.append(element('span','calendar-date',new Intl.DateTimeFormat(en?'en-GB':'ja-JP',{month:'numeric',day:'numeric',weekday:'short',timeZone:'UTC'}).format(date)),element('span','calendar-kind',kinds[lang][event.kind]));
      const title=element('b','',scheduleText(event.title,event.titleEn,lang));
      title.lang=en&&event.titleEn?'en':'ja';li.append(title);
      if(event.time||event.place)li.append(element('span','calendar-meta',[event.time,event.place].filter(Boolean).join(' · ')));
      list.append(li);
    }
    return list;
  }
  function render(data:LiveSchedule) {
    const today=dayString(new Date()),key=today+JSON.stringify(data.events);
    if(key===last)return;last=key;
    const events=compact?data.events.filter(e=>e.date>=today).slice(0,Number(root.dataset.count)||4):data.events;
    const fragment=document.createDocumentFragment();
    if(compact)fragment.append(eventList(events,today));
    else {
      const months=new Map<string,ScheduleEvent[]>([[today.slice(0,7),[]]]);
      for(const e of events){const month=e.date.slice(0,7);months.set(month,[...(months.get(month)??[]),e]);}
      for(const [month,items] of [...months].sort(([a],[b])=>a.localeCompare(b))) {
        const [year,m]=month.split('-').map(Number),section=element('section','calendar-month');
        section.id='calendar-'+month;section.dataset.month=month;
        const heading=element('h2','',en?new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T00:00:00Z')):year+'年 '+m+'月');
        heading.id=section.id+'-title';section.setAttribute('aria-labelledby',heading.id);
        const layout=element('div','calendar-layout'),table=element('table','calendar-grid');table.setAttribute('aria-label',heading.textContent!);
        const header=table.createTHead().insertRow();
        for(const name of en?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:['月','火','水','木','金','土','日']){const th=element('th','',name);th.scope='col';header.append(th);}
        const body=table.createTBody(),lead=(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7,days=new Date(Date.UTC(year,m,0)).getUTCDate();
        let row=body.insertRow();
        for(let i=0;i<Math.ceil((lead+days)/7)*7;i++) {
          if(i&&i%7===0)row=body.insertRow();
          const cell=row.insertCell(),d=i-lead+1;if(d<1||d>days)continue;
          const date=month+'-'+String(d).padStart(2,'0');cell.textContent=String(d);
          cell.className=date===today?'today':i%7===5?'sat':i%7===6?'sun':'';
          const dayEvents=items.filter(e=>e.date===date);
          if(dayEvents.length){const dots=element('span','calendar-dots');for(const e of dayEvents){const dot=element('i');dot.title=e.title;dots.append(dot);}cell.append(dots);}
        }
        layout.append(table,items.length?eventList(items,today):element('p','muted',en?'No confirmed dates yet.':'確定した予定はまだありません。'));section.append(heading,layout);fragment.append(section);
      }
    }
    if(compact&&!events.length)fragment.append(element('p','muted',en?'Future plans will be announced once confirmed.':'今後の予定は、決まり次第お知らせします。'));
    content.replaceChildren(fragment);
  }
  async function refresh() {
    if(busy||document.hidden)return;busy=true;
    try {
      const response=await fetch('/api/schedule.json',{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('unavailable');
      const data=await response.json() as LiveSchedule;render(data);
      const time=new Intl.DateTimeFormat(en?'en-GB':'ja-JP',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tokyo'}).format(new Date(data.updatedAt));
      status.textContent=en?'Google Calendar · checked '+time+' JST':'Googleカレンダー連携 · '+time+' 更新';
    }catch{status.textContent=en?'Calendar could not be refreshed. Check Google Calendar for the latest dates.':'カレンダーを更新できませんでした。最新の予定はGoogleカレンダーでご確認ください。';}
    finally{busy=false;}
  }
  void refresh();
  window.setInterval(()=>void refresh(),60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
}
