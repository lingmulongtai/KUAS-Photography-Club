import type {Point} from './coordinates';

// Each row of the atlas is a four-direction capture of this map, north/east/south/west.
const cities:Point[]=[[135.5012,34.69345],[135.1907,34.6841],[135.76925,35.00535],[135.8662,35.0129],[135.8285,34.6832]];
export function reflectionCity([lon,lat]:Point){
  let nearest=0,distance=Infinity;
  for(let i=0;i<cities.length;i++){
    const [x,y]=cities[i],km=Math.hypot((lon-x)*91.5,(lat-y)*110.9);
    if(km<distance){distance=km;nearest=i;}
  }
  return [nearest,Math.round(Math.max(0,Math.min(1,(10-distance)/6))*32)/32] as const;
}

export const cityGlass=`
  vec3 paneReflection(vec3 world,vec3 positionEC,vec3 normalEC){
    vec3 up=normalize(world);
    vec3 east=normalize(cross(vec3(0.,0.,1.),up));
    vec3 north=cross(up,east);
    vec3 incident=normalize(positionEC);
    vec3 ray=czm_inverseViewRotation*reflect(incident,normalEC);
    vec3 d=vec3(dot(ray,east),dot(ray,north),dot(ray,up));
    float horizontal=max(abs(d.x),abs(d.y));
    float face,side;
    if(abs(d.x)>abs(d.y)){face=d.x>0.?1.:3.;side=d.x>0.?-d.y:d.y;}
    else{face=d.y>0.?0.:2.;side=d.y>0.?d.x:-d.x;}
    vec2 uv=clamp(vec2(side,d.z)/max(.001,horizontal)*.5+.5,.003,.997);
    vec3 local=texture(u_environment,vec2((face+uv.x)/4.,(4.-u_probe.x+uv.y)/5.)).rgb;
    vec3 sky=mix(vec3(.27,.36,.42),vec3(.56,.72,.85),smoothstep(-.15,.75,d.z));
    float captured=u_probe.y*(1.-smoothstep(.81,1.05,abs(d.z)/max(.001,horizontal)));
    float fresnel=pow(1.-abs(dot(incident,normalEC)),3.);
    vec3 reflected=mix(sky,local,captured)*vec3(.78,.91,1.);
    return mix(vec3(.19,.27,.32),reflected,.54+.4*fresnel);
  }`;
