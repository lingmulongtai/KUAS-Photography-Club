import * as THREE from 'three';
import {decodeTreeCover} from './tree-cover';
import {loadBinary,loadGrid, loadJSON, loadTexture, type GridMeta} from './data';
import {ENV_GLSL,SHADOW_GLSL,type Env} from './env';
import type {Box} from './geo';
import {boundaryUniforms,HOME_BOUNDARY} from './regional-boundary';
import {regionalPhoto,type RegionalPhoto} from './regional-photo';
import {Grid,type Heightfield} from './heightfield';
import {districtImagery,districtSampling,type District} from './regional-districts';
import {regionalBudgetForTier,type RegionalQualityBudget} from './adaptive-quality';
import {SHADOW_LAYER} from './shadow';

interface Patch {box: Box; file: string}
interface GroundSurvey {grid: GridMeta; patches: Patch[]}
type Ground = (x:number,z:number)=>number;

export function boxDistance(x:number,z:number,b:Box) {
  return Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-z,0,z-b[3]));
}

function patchAxis(lo:number,hi:number,edge0:number,edge1:number,step:number,fine:number[][]) {
  const values = new Set([lo,hi]);
  for(let n=lo+step;n<hi;n+=step)values.add(n);
  for(const [start,end] of fine){
    for(let n=Math.max(lo,start);n<Math.min(hi,end);n+=40)values.add(n);
  }
  for(const edge of [edge0,edge1])if(edge>lo && edge<hi)values.add(edge);
  return [...values].sort((a,b)=>a-b);
}

async function patchGeometry(box:Box, kyoto:Box, ground:Ground,fine:Grid[],current:()=>boolean) {
  const overlap=fine.map(g=>g.meta.box).filter(b=>b[0]<box[2] && b[2]>box[0] && b[1]<box[3] && b[3]>box[1]);
  const xs=patchAxis(box[0],box[2],kyoto[0],kyoto[2],200,overlap.map(b=>[b[0],b[2]]));
  const zs=patchAxis(box[1],box[3],kyoto[1],kyoto[3],200,overlap.map(b=>[b[1],b[3]]));
  const pos=new Float32Array(xs.length*zs.length*3),uv=new Float32Array(xs.length*zs.length*2);
  const columns=xs.length,rows=zs.length,vertices=rows*columns;
  const indices=vertices>65535?new Uint32Array(6*(columns-1)*(rows-1)):new Uint16Array(6*(columns-1)*(rows-1));
  const normal=new Float32Array(vertices*3);
  let offset=0,minimum=Infinity,maximum=-Infinity,deadline=performance.now()+3;
  const giveFrame=async()=>{
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    deadline=performance.now()+3;
    return current();
  };
  for(let j=0;j<rows;j++){
    for(let i=0;i<columns;i++){
      const k=j*columns+i,x=xs[i],z=zs[j],h=ground(x,z);
      pos[k*3]=x;pos[k*3+1]=h;pos[k*3+2]=z;
      uv[k*2]=(x-box[0])/(box[2]-box[0]);uv[k*2+1]=1-(z-box[1])/(box[3]-box[1]);
      minimum=Math.min(minimum,h);maximum=Math.max(maximum,h);
      if(i+1===columns || j+1===rows)continue;
      const inKyoto=x>=kyoto[0] && xs[i+1]<=kyoto[2] && z>=kyoto[1] && zs[j+1]<=kyoto[3];
      // Keep the SW corner inside Kyoto's outer bounds where Osaka Bay enters, so sea water continues seamlessly across z=36000.
      const osakaBayOverlap=xs[i+1]<-20500 && zs[j+1]>27500;
      if(inKyoto && !osakaBayOverlap)continue;
      indices.set([k,k+columns,k+1,k+1,k+columns,k+columns+1],offset);offset+=6;
    }
    if(performance.now()>=deadline && !await giveFrame())return null;
  }
  for(let j=0;j<rows;j++){
    const north=Math.max(0,j-1),south=Math.min(rows-1,j+1);
    for(let i=0;i<columns;i++){
      const west=Math.max(0,i-1),east=Math.min(columns-1,i+1);
      const dx=(pos[(j*columns+west)*3+1]-pos[(j*columns+east)*3+1])/(xs[east]-xs[west]);
      const dz=(pos[(north*columns+i)*3+1]-pos[(south*columns+i)*3+1])/(zs[south]-zs[north]);
      const inv=1/Math.hypot(dx,1,dz),k=(j*columns+i)*3;
      normal[k]=dx*inv;normal[k+1]=inv;normal[k+2]=dz*inv;
    }
    if(performance.now()>=deadline && !await giveFrame())return null;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normal,3));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0,offset),1));
  geometry.boundingSphere=new THREE.Box3(new THREE.Vector3(box[0],minimum,box[1]),new THREE.Vector3(box[2],maximum,box[3])).getBoundingSphere(new THREE.Sphere());
  return geometry;
}

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vWorld,vNormal;
  void main(){
    vUv=uv; vWorld=position; vNormal=normal;
    gl_Position=projectionMatrix*viewMatrix*vec4(position,1.);
  }`;
const fragmentShader = `
  uniform sampler2D uPhoto,uMidPhoto,uClose,uDistrict,uInset;
  uniform vec4 uMidPhotoBox,uCloseBox,uDistrictBox,uInsetBox,uKyotoBox;
  uniform float uMidPhotoMatch,uCloseMatch,uGroundFar;
  varying vec2 vUv;
  varying vec3 vWorld,vNormal;
  ${ENV_GLSL}
  ${SHADOW_GLSL}
  ${HOME_BOUNDARY}
  ${districtSampling}
  vec3 fadeHorizon(vec3 color,vec3 world){
    vec3 delta=world-cameraPosition;
    float radialDist=length(delta);
    float fade=smoothstep(uGroundFar*.84,uGroundFar,radialDist);
    return fade>0.?mix(color,skyBackground(delta/max(radialDist,1e-4)),fade):color;
  }
  float seaWave(vec2 p,vec2 drift,float med,float broad){
    const mat2 R1=mat2(.80,-.60,.60,.80);
    const mat2 R2=mat2(.54,.84,-.84,.54);
    vec2 warp=vec2(vnoise(p*.022+drift*.22),vnoise(p*.022-drift*.19+13.7))-.5;
    vec2 q0=p+warp*7.5;
    float h=0.;
    if(broad>.001){
      h+=(vnoise(R1*(q0*.038)+drift*.35)-.5)*1.2*broad;
      h+=(vnoise(R2*(q0*.082)-drift*.46+9.4)-.5)*.65*broad;
    }
    if(med>.001){
      h+=(vnoise(R1*(q0*.19)+drift*.78+24.1)-.5)*.38*med;
    }
    return h;
  }
  vec3 renderSea(vec3 wp,float fp){
    vec2 q=wp.xz;
    float broad=1.-smoothstep(2.,16.,fp);
    float med=1.-smoothstep(.4,4.5,fp);
    vec2 drift=vec2(uTime*.38,uTime*.26);
    float eps=max(.55,fp*.5);
    float h0=seaWave(q,drift,med,broad);
    float hx=seaWave(q+vec2(eps,0.),drift,med,broad);
    float hy=seaWave(q+vec2(0.,eps),drift,med,broad);
    float gust=.58+.68*vnoise(q*.0012+vec2(uTime*.014,-uTime*.01));
    vec2 slope=vec2(hx-h0,hy-h0)/eps*.11*gust;
    vec3 n=normalize(vec3(slope.x,1.,slope.y));
    vec3 view=normalize(wp-cameraPosition);
    vec3 r=reflect(view,n);
    r.y=clamp(abs(r.y)+.02,.015,1.);
    vec3 rn=normalize(r);
    float facing=clamp(dot(-view,n),0.,1.);
    float fres=.045+.88*pow(1.-facing,4.5);
    vec3 sky=skyColor(rn);
    if(rn.y>.04){
      vec2 cloudUv=q*.000035+rn.xz/max(rn.y+.18,.22)*.75+vec2(uTime*.0014,0.);
      float cMask=smoothstep(.46,.78,fbm(cloudUv*2.1))*smoothstep(.04,.28,rn.y)*(1.-smoothstep(.55,.95,rn.y));
      vec3 cCol=mix(uCloudLight*.88+uHorizon*.25,uHorizon*.45,uCity);
      sky=mix(sky,cCol,cMask*.4);
    }
    float az=atan(rn.x,rn.z);
    float ridge=.04+.035*vnoise(vec2(az*3.2+q.x*.00003,q.y*.00003+3.7));
    float sill=1.-smoothstep(ridge*.6,ridge*1.15+.015,rn.y);
    vec3 shoreCol=vec3(.09,.10,.11)*(skyLight(vec3(0.,.7,.7))+uSunLight*max(uSunDir.y,0.)*.5);
    if(uCity>.01){
      float glow=exp(-rn.y*16.)*(.45+.55*vnoise(vec2(az*12.+q.x*.0003,q.y*.0003)));
      shoreCol+=vec3(1.,.64,.32)*glow*uCity*.24;
    }
    vec3 envRefl=mix(sky,shoreCol,sill*.48);
    vec3 ambient=skyLight(vec3(0.,1.,0.))+uSunLight*max(uSunDir.y,0.);
    vec3 col=mix(vec3(.009,.031,.047)*ambient,envRefl,fres);
    float sunDot=max(dot(rn,uSunDir),0.);
    float moonDot=max(dot(rn,uMoonDir),0.);
    col+=uSunLight*(pow(sunDot,170.)*.55+pow(sunDot,24.)*.065);
    col+=uMoonLight*(pow(moonDot,170.)*2.8+pow(moonDot,24.)*.28);
    return fadeHorizon(applyHaze(col,vec3(0.),wp),wp);
  }
  void main(){
    // Evaluate screen-space derivatives and sun shadow in uniform control flow before any discard/return.
    vec3 n=normalize(vNormal);
    float sh=sunShadow(vWorld,n);
    float groundFp=max(length(dFdx(vWorld.xz)),length(dFdy(vWorld.xz)));
    vec4 photo=texture2D(uPhoto,vUv);
    int prefectureCode=owner(vWorld.xz);
    bool insideKyoto=vWorld.x>=uKyotoBox.x && vWorld.z>=uKyotoBox.y && vWorld.x<=uKyotoBox.z && vWorld.z<=uKyotoBox.w;
    // Inside Osaka Bay every prefectureCode==0 pixel is sea; never discard along coarse 50 m ground-patch
    // alpha fringes around KIX, Kobe Airport, Port Island, or Yumeshima seawalls.
    bool inOsakaBay=vWorld.x>-72000. && vWorld.x<-19500. && vWorld.z>28500. && vWorld.z<76000.;
    if(prefectureCode==0 && (inOsakaBay || (photo.a>=.18 && (photo.a<.62 || insideKyoto)))){
      gl_FragColor=vec4(renderSea(vWorld,groundFp),1.);
      return;
    }
    if(photo.a<.18 && !inOsakaBay)discard;
    if(prefectureCode==0 || insideKyoto)discard;
    vec3 baseLow=textureGrad(uPhoto,vUv,vec2(.008,0.),vec2(0.,.008)).rgb;
    photo.rgb=overlay(photo.rgb,uDistrict,uDistrictBox,vWorld.xz,.08);
    photo.rgb=overlay(photo.rgb,uInset,uInsetBox,vWorld.xz,.08);
    photo.rgb=overlayMatched(photo.rgb,uMidPhoto,uMidPhotoBox,vWorld.xz,.10,baseLow,uMidPhotoMatch);
    photo.rgb=overlayMatched(photo.rgb,uClose,uCloseBox,vWorld.xz,mix(.08,.14,uCloseMatch),baseLow,uCloseMatch);
    // Exact runway-aligned island footprints for Kobe Airport & KIX (keeps low-elevation runways/aprons
    // solidly dry and suppresses procedural streetlamps on airfields, while offshore KIX relies on its
    // surveyed 3 m seawall boundary in owner() so no color-threshold noise chews into the islands or channel).
    vec2 ukbD = vWorld.xz - vec2(-48893., 41148.);
    float ukbAlong = dot(ukbD, vec2(.996, -.094));
    float ukbAcross = dot(ukbD, vec2(.094, .996));
    bool onKobeIsland = ukbAlong > -1440. && ukbAlong < 1470. && ukbAcross > -585. && ukbAcross < 185.;
    vec2 kix1D = vWorld.xz - vec2(-47055., 63937.);
    float kix1Along = dot(kix1D, vec2(.775, -.632));
    float kix1Across = dot(kix1D, vec2(.632, .775));
    bool onKix1 = kix1Along > -2260. && kix1Along < 2360. && kix1Across > -1060. && kix1Across < 280.;
    vec2 kix2D = vWorld.xz - vec2(-48967., 62538.);
    float kix2Along = dot(kix2D, vec2(.775, -.632));
    float kix2Across = dot(kix2D, vec2(.632, .775));
    bool onKix2 = kix2Along > -2420. && kix2Along < 2620. && kix2Across > -360. && kix2Across < 1120.;
    bool onKixOffshore = vWorld.x < -43500. && vWorld.z > 58000.;
    // Restrict sea-level fallback strictly to outer harbor waters around Yumeshima & Kobe Port
    // where prefecture borders extend over sea; inland western Osaka zero-metre wards stay dry
    // and rely on surveyed osaka-water.bin for canals, rivers and harbor basins.
    bool inBayZone = !onKobeIsland && !onKixOffshore && (
      (vWorld.x < -33200. && vWorld.z > 34500.) ||
      (vWorld.x < -41000. && vWorld.z > 31000.)
    );
    if (inBayZone && vWorld.y <= .16) {
      // Open bay water at sea level (including bright white/silver sun-glare sea tiles around Kobe Airport)
      // has neutral/cool RGB (b >= r * 0.86), whereas reclaimed sand/earth is warm (r >> b).
      float coolOrNeutral = smoothstep(.82, .91, photo.b / max(photo.r, .01));
      float seaBlue = smoothstep(-.01, .025, photo.b - photo.r * .94) * (1. - smoothstep(.20, .38, photo.r));
      float darkWater = (1. - smoothstep(.10, .22, max(photo.r, max(photo.g, photo.b)))) * step(photo.r, photo.b * 1.15);
      bool flatOpenSea = vWorld.y <= .06 && coolOrNeutral > .55;
      if (flatOpenSea || max(seaBlue, darkWater) > .32) {
        gl_FragColor = vec4(renderSea(vWorld, groundFp), 1.);
        return;
      }
    }
    vec3 albedo=surveyedGroundAlbedo(photo.rgb);
    vec3 lit=shade(seasonalSurface(albedo,n,vWorld),n,vWorld,sh);
    vec3 emit=vec3(0.);
    if(uCity>.01){
      // Urban plains & waterfronts (Osaka, Kobe, Sakai, Nishinomiya, Otsu, Nara) glow brightly with
      // streetlamps, metropolitan hubs and arterial highways at night while forested slopes and
      // active airport airfields (KIX, Kobe Airport, Itami) stay dark so real airfield lighting pops.
      vec2 itmD = vWorld.xz - vec2(-29138., 24612.);
      float itmAlong = dot(itmD, vec2(-.706, -.708));
      float itmAcross = dot(itmD, vec2(.708, -.706));
      bool inItamiAirfield = itmAlong > -1720. && itmAlong < 2120. && itmAcross > -180. && itmAcross < 680.;
      float airfieldMask = (onKix1 || onKix2 || onKobeIsland || inItamiAirfield) ? 0. : 1.;
      float green=smoothstep(.005,.038,photo.g-max(photo.r,photo.b*.92));
      float luma=dot(photo.rgb,vec3(.2126,.7152,.0722));
      float chroma=max(photo.r,max(photo.g,photo.b))-min(photo.r,min(photo.g,photo.b));
      float neutral=1.-smoothstep(.03,.15,chroma);
      float flatUrban=smoothstep(.84,.965,n.y)*(1.-smoothstep(130.,340.,vWorld.y));
      float urban=(1.-green)*smoothstep(.06,.22,luma)*(.35+.65*neutral)*flatUrban*airfieldMask;
      if(urban>.01){
        vec2 p=vWorld.xz;
        float fp=groundFp;
        float dist=length(vWorld-cameraPosition);
        // Streetlamp points (18 m grid) matching Kyoto's terrain night-light grain.
        vec2 lampCell=p/18.;
        float lampSeed=hash12(floor(lampCell));
        vec2 lampAt=fract(lampCell)-.5-(vec2(lampSeed,fract(lampSeed*7.13))-.5)*.52;
        float lampAA=max(fp/18.,.025);
        float lampDot=1.-smoothstep(.20-lampAA,.20+lampAA,length(lampAt));
        float lamps=mix(lampDot*step(lampSeed,.66)/(.66*3.1416*.20*.20),1.,smoothstep(.35,1.,lampAA*2.));
        // Broader metropolitan arterial corridors & bright downtown Osaka/Kobe hubs visible from Mt. Ikoma & Mt. Maya.
        float arterialX=exp(-pow((abs(fract(p.x/240.)-.5)*240.)/16.,2.));
        float arterialZ=exp(-pow((abs(fract(p.y/240.)-.5)*240.)/16.,2.));
        float grid=max(arterialX,arterialZ)*smoothstep(.24,.64,vnoise(p*.0014+7.3));
        float hub=smoothstep(.30,.74,vnoise(p*.00065+2.1));
        // Boost metropolitan core glow across central Osaka (Umeda-Namba-Tennoji) & Kobe Sannomiya.
        float osakaMetro=exp(-dot(p-vec2(-23500.,36500.),p-vec2(-23500.,36500.))/(9500.*9500.));
        float kobeMetro=exp(-dot(p-vec2(-51800.,35000.),p-vec2(-51800.,35000.))/(5500.*5500.));
        float metro=1.+.35*max(osakaMetro,kobeMetro);
        vec3 warmCol=mix(vec3(1.,.62,.26),vec3(1.,.84,.60),step(.68,lampSeed)*.55+grid*.35);
        float gain=mix(.038,.095,smoothstep(400.,3800.,dist));
        emit=warmCol*urban*metro*(.085*lamps*gain+grid*.055+hub*.015)*uCity*cityLightShimmer(vWorld);
      }
    }
    gl_FragColor=vec4(fadeHorizon(applyHaze(lit,emit,vWorld),vWorld),1.);
  }`;

export async function regionalGround(scene:THREE.Scene,env:Env,hf:Heightfield,aniso:number,legacy:Box[],onPhoto:(base:RegionalPhoto|null,detail:RegionalPhoto|null)=>void,prepare:(model:THREE.Object3D)=>Promise<unknown>,upload:(photo:THREE.Texture,needed:()=>boolean)=>Promise<void>,onShadowDirty?:()=>void) {
  const [{grid,patches},surveys]=await Promise.all([loadJSON<GroundSurvey>('kansai/ground.json'),loadJSON<District[]>('kansai/districts/index.json')]);
  const [heights,boundary,cover,fine]=await Promise.all([
    loadGrid(grid),boundaryUniforms().then(async uniforms=>{
      // These integer lookups decide land ownership. Upload them intact before the first regional draw.
      for(const {value} of Object.values(uniforms)){
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        await upload(value,()=>true);
      }
      return uniforms;
    }),loadBinary('kansai/canopy.bin').then(decodeTreeCover),
    Promise.all(surveys.flatMap(s=>s.grid?[s.grid]:[]).map(async grid=>new Grid(grid,await loadGrid(grid)))),
  ]);
  const step=(cover.box[2]-cover.box[0])/cover.width;
  function canopy(x:number,z:number){
    const col=Math.floor((x-cover.box[0])/step),row=Math.floor((z-cover.box[1])/step);
    return col<0 || row<0 || col>=cover.width || row>=cover.height ? 0 : cover.cells[row*cover.width+col]/15;
  }
  const kyoto=hf.bounds;
  const ground:Ground=(x,z)=>{
    const d=boxDistance(x,z,kyoto);
    if(d===0)return hf.height(x,z);
    const u=THREE.MathUtils.clamp((x-grid.box[0])/grid.step,0,grid.nx-1);
    const v=THREE.MathUtils.clamp((z-grid.box[1])/grid.step,0,grid.nz-1);
    const i=Math.min(Math.floor(u),grid.nx-2),j=Math.min(Math.floor(v),grid.nz-2),k=j*grid.nx+i;
    const low=THREE.MathUtils.lerp(heights[k],heights[k+1],u-i);
    const high=THREE.MathUtils.lerp(heights[k+grid.nx],heights[k+grid.nx+1],u-i);
    let h=THREE.MathUtils.lerp(low,high,v-j);
    for(const g of fine){
      const [w,n,e,s]=g.meta.box,edge=Math.min(x-w,e-x,z-n,s-z);
      if(edge>0)h=THREE.MathUtils.lerp(h,g.sample(x,z),THREE.MathUtils.smoothstep(edge,0,320));
    }
    if(d>=600)return h;
    const rim=hf.height(THREE.MathUtils.clamp(x,kyoto[0],kyoto[2]),THREE.MathUtils.clamp(z,kyoto[1],kyoto[3]));
    return THREE.MathUtils.lerp(rim,h,THREE.MathUtils.smoothstep(d,0,600));
  };

  const states=patches.map(p=>({patch:p,distance:Infinity,pending:false,retry:0,mesh:null as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>|null}));
  const uMidPhoto={value:null as THREE.Texture|null},uMidPhotoBox={value:new THREE.Vector4()},uMidPhotoMatch={value:0};
  const uClose={value:null as THREE.Texture|null},uCloseBox={value:new THREE.Vector4()},uCloseMatch={value:0};
  const uDistrict={value:null as THREE.Texture|null},uDistrictBox={value:new THREE.Vector4()};
  const uInset={value:null as THREE.Texture|null},uInsetBox={value:new THREE.Vector4()};
  const uKyotoBox={value:new THREE.Vector4(...kyoto)};
  const uGroundFar={value:92000};
  let broad:RegionalPhoto|null=null,inset:RegionalPhoto|null=null,liveMid:RegionalPhoto|null=null,live:RegionalPhoto|null=null;
  // A first draw would upload every newly finished orthophoto at once. Keep the old
  // coverage visible and prepare at most one full-resolution sheet per animation frame.
  let uploads=Promise.resolve();
  function preparePhoto(photo:THREE.Texture,needed:()=>boolean){
    const next=uploads.then(async()=>{
      if(!needed())return false;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(!needed())return false;
      await upload(photo,needed);
      return needed();
    });
    uploads=next.then(()=>{},()=>{});
    return next;
  }
  const districts=districtImagery(surveys,aniso,preparePhoto,(base,detail)=>{
    broad=base;inset=detail;
    uDistrict.value=base?.photo??null;uDistrictBox.value.fromArray(base?.box??[0,0,0,0]);
    uInset.value=detail?.photo??null;uInsetBox.value.fromArray(detail?.box??[0,0,0,0]);
    onPhoto(broad??liveMid,inset??live);
  });
  const photos=regionalPhoto(
    aniso,
    sheet=>{
      live=sheet;uClose.value=sheet?.photo??null;
      uCloseBox.value.fromArray(sheet?.box??[0,0,0,0]);
      uCloseMatch.value=sheet?.raw?1:0;
      onPhoto(broad??liveMid,inset??live);
    },
    sheet=>{
      liveMid=sheet;uMidPhoto.value=sheet?.photo??null;
      uMidPhotoBox.value.fromArray(sheet?.box??[0,0,0,0]);
      uMidPhotoMatch.value=sheet?.raw?1:0;
      onPhoto(broad??liveMid,inset??live);
    },
  );
  let shaderReady:Promise<unknown>|undefined;
  let running=0,last= -Infinity;
  const fallbackBudget=regionalBudgetForTier(2);
  let activeUnload=fallbackBudget.groundUnload;
  function update(x:number,z:number,y:number,now:number,destination?:{x:number;z:number},dirX=0,dirZ=0,budget:RegionalQualityBudget=fallbackBudget,dirY=-0.25) {
    if(now-last<.15)return;
    last=now;
    // Smoothly approach the adaptive spherical horizon radius so tier changes never pop.
    uGroundFar.value=THREE.MathUtils.lerp(uGroundFar.value,budget.groundFar,.25);
    activeUnload=budget.groundUnload;
    const altitude=Math.max(0,y-ground(x,z));
    // When orbiting a landmark or flying to one, center orthophoto sheets squarely on the target;
    // otherwise intersect the camera's sightline with the ground plane so oblique views sharpen ahead.
    const pitchDown=Math.max(.12,-dirY);
    const ahead=destination?0:THREE.MathUtils.clamp(altitude/pitchDown,Math.min(altitude*.85,400),2400);
    const targetX=destination?.x??(x+dirX*ahead);
    const targetZ=destination?.z??(z+dirZ*ahead);
    const coveredZoom=districts(targetX,targetZ,now);
    const insideLegacy=legacy.some(b=>boxDistance(targetX,targetZ,b)===0);
    photos(targetX,targetZ,altitude,now,!insideLegacy,{
      radius:budget.photoRadius,
      maxZoom:budget.photoMaxZoom,
      coveredZoom,
      prefetch:!!destination,
    });
    for(const state of states){
      state.distance=boxDistance(x,z,state.patch.box);
      if(state.mesh && state.distance>activeUnload){
        scene.remove(state.mesh);
        state.mesh.geometry.dispose();
        state.mesh.material.uniforms.uPhoto.value.dispose();
        state.mesh.material.dispose();
        state.mesh=null;
        onShadowDirty?.();
      }
    }
    for(const state of states.sort((a,b)=>a.distance-b.distance)){
      if(running>=budget.groundConcurrency || state.distance>budget.groundLoad)break;
      if(state.mesh || state.pending || state.retry>now)continue;
      state.pending=true;
      running++;
      void loadTexture(state.patch.file,aniso).then(async photo=>{
        if(!await preparePhoto(photo,()=>state.distance<=activeUnload)){photo.dispose();return;}
        const geometry=await patchGeometry(state.patch.box,kyoto,ground,fine,()=>state.distance<=activeUnload);
        if(!geometry){photo.dispose();return;}
        const material=new THREE.ShaderMaterial({uniforms:{...env,...boundary,uPhoto:{value:photo},uMidPhoto,uMidPhotoBox,uMidPhotoMatch,uClose,uCloseBox,uCloseMatch,uGroundFar,uDistrict,uDistrictBox,uInset,uInsetBox,uKyotoBox},vertexShader,fragmentShader,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
        const mesh=new THREE.Mesh(geometry,material);
        mesh.layers.enable(SHADOW_LAYER);
        await (shaderReady??=prepare(mesh));
        if(state.distance>activeUnload){mesh.geometry.dispose();material.dispose();photo.dispose();return;}
        mesh.name='regional-ground';
        state.mesh=mesh;
        scene.add(mesh);
        onShadowDirty?.();
      }).catch(()=>{state.retry=last+10;}).finally(()=>{state.pending=false;running--;});
    }
  }
  return {bounds:grid.box,ground,canopy,update,imagery:{uDistrict,uDistrictBox,uInset,uInsetBox}};
}
