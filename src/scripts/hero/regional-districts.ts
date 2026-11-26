import type * as THREE from 'three';
import {loadTexture,type GridMeta} from './data';
import type {Box} from './geo';
import type {RegionalPhoto} from './regional-photo';

export interface District {id:string;box:Box;file:string;zoom:number;grid?:GridMeta}

export interface DistrictUniforms {
  uDistrict:{value:THREE.Texture|null};uDistrictBox:{value:THREE.Vector4};
  uInset:{value:THREE.Texture|null};uInsetBox:{value:THREE.Vector4};
}

export const districtSampling=`
  vec3 overlay(vec3 base,sampler2D map,vec4 box,vec2 p,float feather){
    if(box.z<=box.x || box.w<=box.y)return base;
    vec2 uv=(p-box.xy)/(box.zw-box.xy);
    if(any(lessThanEqual(uv,vec2(0.))) || any(greaterThanEqual(uv,vec2(1.))))return base;
    vec4 aerial=texture2D(map,vec2(uv.x,1.-uv.y));
    vec2 edge=min(uv,1.-uv);
    return mix(base,aerial.rgb,aerial.a*smoothstep(0.,feather,min(edge.x,edge.y)));
  }
  vec3 overlayMatched(vec3 base,sampler2D map,vec4 box,vec2 p,float feather,vec3 baseLow,float matchTone){
    if(box.z<=box.x || box.w<=box.y)return base;
    vec2 uv=(p-box.xy)/(box.zw-box.xy);
    if(any(lessThanEqual(uv,vec2(0.))) || any(greaterThanEqual(uv,vec2(1.))))return base;
    vec2 texUv=vec2(uv.x,1.-uv.y);
    vec4 aerial=texture2D(map,texUv);
    if(aerial.a<.02)return base;
    vec3 rgb=aerial.a<.99?clamp(aerial.rgb/aerial.a,0.,1.):aerial.rgb;
    if(matchTone>.5){
      vec4 mapLow=textureGrad(map,texUv,vec2(.045,0.),vec2(0.,.045));
      float valid=smoothstep(.82,.99,mapLow.a);
      vec3 gain=mix(vec3(1.),clamp((baseLow+.05)/(mapLow.rgb+.05),vec3(.74),vec3(1.36)),valid);
      rgb=clamp(rgb*gain,0.,1.);
    }
    vec2 edge=min(uv,1.-uv);
    return mix(base,rgb,aerial.a*smoothstep(0.,feather,min(edge.x,edge.y)));
  }`;

export function districtImagery(districts:District[],aniso:number,prepare:(photo:THREE.Texture,needed:()=>boolean)=>Promise<boolean>,onChange:(broad:RegionalPhoto|null,inset:RegionalPhoto|null)=>void){
  const entries=districts.map(record=>({...record,sheet:null as RegionalPhoto|null,pending:false,retry:0,distance:Infinity}));
  let broad:RegionalPhoto|null=null,inset:RegionalPhoto|null=null;
  return (x:number,z:number,now:number)=>{
    for(const e of entries){
      const [w,n,r,s]=e.box;
      e.distance=Math.hypot(Math.max(0,w-x,x-r),Math.max(0,n-z,z-s));
    }
    entries.sort((a,b)=>a.distance-b.distance);
    const wide=entries.find(e=>e.zoom<=15 && e.distance<14500);
    const close=entries.find(e=>e.zoom>15 && e.distance<3000);
    for(const e of [wide,close]){
      if(!e||e.sheet||e.pending||now<e.retry)continue;
      e.pending=true;
      void loadTexture(e.file,aniso).then(async photo=>{
        try{
          if(await prepare(photo,()=>e.distance<(e.zoom>15?6500:19000)))e.sheet={photo,box:e.box};
          else photo.dispose();
        }catch(error){photo.dispose();throw error;}
      })
        .catch(()=>{e.retry=performance.now()/1000+12;}).finally(()=>{e.pending=false;});
    }
    if(broad!==(wide?.sheet??null)||inset!==(close?.sheet??null)){
      broad=wide?.sheet??null;inset=close?.sheet??null;onChange(broad,inset);
    }
    for(const e of entries)if(e.sheet && e.distance>(e.zoom>15?6500:19000)){
      e.sheet.photo.dispose();e.sheet=null;
    }
    return close && close.distance<150 ? close.zoom : (wide && wide.distance===0 ? wide.zoom : 0);
  };
}
