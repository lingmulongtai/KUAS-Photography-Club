import type {CesiumWidget} from 'cesium';
import {C} from './engine';
import {aerialPhoto} from './aerial';
import {cityGlass,reflectionCity} from './glass';
import {lonLat,tileXY,type Point,type Ring} from './coordinates';

// Municipal catalogues with detailed landmarks also contain plain survey shells.
// Choose a surface treatment for each glTF primitive, independent of catalogue LOD.
export function surveyMaterial(widget:CesiumWidget){
  const uniform=(bytes:Uint8Array,width:number)=>new C.TextureUniform({typedArray:bytes,width,height:width,repeat:false});
  const maskUniforms=()=>({
    u_environment:{type:C.UniformType.SAMPLER_2D,value:new C.TextureUniform({url:'/kansai/city-reflections.webp',repeat:false})},
    u_probe:{type:C.UniformType.VEC2,value:new C.Cartesian2(0,0)},
    u_mask:{type:C.UniformType.SAMPLER_2D,value:uniform(new Uint8Array(4),1)},
    u_centre:{type:C.UniformType.VEC3,value:new C.Cartesian3()},
    u_maskE:{type:C.UniformType.VEC3,value:new C.Cartesian3()},
    u_maskN:{type:C.UniformType.VEC3,value:new C.Cartesian3()},
  });
  const clip=`
    vec3 local=fsInput.attributes.positionWC-u_centre;
    vec2 m=vec2(dot(local,u_maskE),dot(local,u_maskN))+.5;
    if(all(greaterThan(m,vec2(0.))) && all(lessThan(m,vec2(1.)))){
      vec3 ink=texture(u_mask,m).rgb;
      if(ink.r-ink.g>.5) discard;
    }`;
  const authoredGlass=`
      vec3 p=fsInput.attributes.positionWC,eye=fsInput.attributes.positionEC;
      vec3 n=normalize(cross(dFdx(eye),dFdy(eye)));
      float vertical=1.-smoothstep(.2,.65,abs(dot(n,czm_viewRotation*normalize(p))));
      vec3 color=material.diffuse;
      float glass=vertical*smoothstep(.025,.13,color.b-color.r)*(1.-smoothstep(.45,.82,material.roughness));
      if(glass>.01)material.diffuse=mix(color,paneReflection(p,eye,n),glass*.32);`;
  const detailed=new C.CustomShader({uniforms:{...maskUniforms()},fragmentShaderText:`
    ${cityGlass}
    void fragmentMain(FragmentInput fsInput,inout czm_modelMaterial material){
      ${clip}
      ${authoredGlass}
    }`});
  const shader=new C.CustomShader({uniforms:{
    ...maskUniforms(),
    u_photo:{type:C.UniformType.SAMPLER_2D,value:uniform(new Uint8Array([0,0,0,0]),1)},
    u_origin:{type:C.UniformType.VEC3,value:new C.Cartesian3()},
    u_east:{type:C.UniformType.VEC3,value:new C.Cartesian3(1,0,0)},
    u_north:{type:C.UniformType.VEC3,value:new C.Cartesian3(0,1,0)},
  },fragmentShaderText:`
    ${cityGlass}
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material){
      ${clip}
      #if defined(HAS_BASE_COLOR_TEXTURE) || defined(HAS_DIFFUSE_TEXTURE) || defined(HAS_COLOR_0)
      ${authoredGlass}
      #else
      vec3 source=material.diffuse;
      if(max(source.r,max(source.g,source.b))-min(source.r,min(source.g,source.b))>.045)return;
      vec3 p=fsInput.attributes.positionWC;
      vec3 n=normalize(cross(dFdx(fsInput.attributes.positionEC),dFdy(fsInput.attributes.positionEC)));
      float up=abs(dot(n,normalize(czm_viewRotation*normalize(p))));
      vec3 delta=p-u_origin;
      vec2 uv=vec2(dot(delta,u_east),dot(delta,u_north))+0.5;
      vec3 wall=vec3(.58,.55,.50);
      // Reconstruct window spacing in metres on the untextured survey walls.
      // Use tile-local positions to keep the pattern attached while the camera moves.
      vec3 vertical=normalize(p);
      vec3 horizontal=cross(vertical,czm_inverseViewRotation*n);
      vec3 tileLocal=mat3(czm_model)*fsInput.attributes.positionMC;
      vec2 grid=vec2(dot(tileLocal,horizontal/max(.001,length(horizontal)))/3.05,
                     dot(tileLocal,vertical)/3.12);
      vec2 pixel=max(fwidth(grid),vec2(.012));
      vec2 pane=1.-smoothstep(vec2(.25,.19)-pixel,vec2(.25,.19)+pixel,abs(fract(grid)-.5));
      float visible=1.-smoothstep(.18,.65,max(pixel.x,pixel.y));
      float glazing=pane.x*pane.y*visible*(1.-smoothstep(.45,.75,up));
      if(glazing>.01)wall=mix(wall,paneReflection(p,fsInput.attributes.positionEC,n),glazing*.77);
      vec3 roof=vec3(.28,.29,.29);
      if(all(greaterThanEqual(uv,vec2(0.))) && all(lessThanEqual(uv,vec2(1.)))){
        vec4 photo=texture(u_photo,vec2(uv.x,1.-uv.y));
        roof=mix(roof,czm_gammaCorrect(photo.rgb),.93*photo.a);
      }
      material.diffuse*=mix(wall,roof,smoothstep(.55,.85,up));
      #endif
    }`});
  let signature='',abort:AbortController|undefined;
  // A single raster for all active replacements. Allocate according to their
  // footprint extent, instead of a 4096-square float distance field per tileset.
  function setMasks(rings:Ring[]){
    let texture=uniform(new Uint8Array(4),1);
    if(rings.length){
      const points=rings.flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      const w=Math.min(...xs)-.00003,e=Math.max(...xs)+.00003,s=Math.min(...ys)-.00003,n=Math.max(...ys)+.00003;
      const mid:Point=[(w+e)/2,(s+n)/2],origin=C.Cartesian3.fromDegrees(...mid);
      const enu=C.Transforms.eastNorthUpToFixedFrame(origin);
      const dx=C.Cartesian3.distance(C.Cartesian3.fromDegrees(w,mid[1]),C.Cartesian3.fromDegrees(e,mid[1]));
      const dy=C.Cartesian3.distance(C.Cartesian3.fromDegrees(mid[0],s),C.Cartesian3.fromDegrees(mid[0],n));
      const side=Math.min(2048,Math.max(64,2**Math.ceil(Math.log2(Math.max(dx,dy)/2))));
      const canvas=document.createElement('canvas');canvas.width=canvas.height=side;
      const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.fillStyle='#f00';
      for(const ring of rings){
        ctx.beginPath();ring.forEach(([lon,lat],i)=>{
          const x=(lon-w)/(e-w)*side,y=(lat-s)/(n-s)*side;
          if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
        });ctx.closePath();ctx.fill();
      }
      texture=uniform(new Uint8Array(ctx.getImageData(0,0,side,side).data.buffer),side);
      for(const sh of [shader,detailed]){
        sh.setUniform('u_centre',origin);
        sh.setUniform('u_maskE',new C.Cartesian3(enu[0]/dx,enu[1]/dx,enu[2]/dx));
        sh.setUniform('u_maskN',new C.Cartesian3(enu[4]/dy,enu[5]/dy,enu[6]/dy));
      }
    }
    for(const sh of [shader,detailed])sh.setUniform('u_mask',texture);
    widget.scene.requestRender();
  }
  async function update(target:Point,altitude:number){
    const zoom=altitude<1200?16:14,[x,y]=tileXY(...target,zoom).map(Math.floor),key=[zoom,x,y].join('/');
    if(signature===key)return;
    signature=key;abort?.abort();const controller=new AbortController();abort=controller;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=768;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
    await Promise.all(Array.from({length:9},async(_,i)=>{
      const col=i%3,row=Math.floor(i/3);
      try{
        const img=await aerialPhoto(zoom,x+col-1,y+row-1);
        if(img&&!controller.signal.aborted)ctx.drawImage(img,col*256,row*256);
      }catch{/* The calibrated roof tone covers missing aerial photographs. */}
    }));
    if(controller.signal.aborted||widget.isDestroyed())return;
    const centre=lonLat(x+.5,y+.5,zoom),origin=C.Cartesian3.fromDegrees(...centre);
    const enu=C.Transforms.eastNorthUpToFixedFrame(origin);
    const span=(x0:number,y0:number,x1:number,y1:number)=>C.Cartesian3.distance(
      C.Cartesian3.fromDegrees(...lonLat(x0,y0,zoom)),C.Cartesian3.fromDegrees(...lonLat(x1,y1,zoom)));
    const axis=(column:number,length:number)=>C.Cartesian3.divideByScalar(
      new C.Cartesian3(enu[column*4],enu[column*4+1],enu[column*4+2]),length,new C.Cartesian3());
    shader.setUniform('u_origin',origin);
    shader.setUniform('u_east',axis(0,span(x-1,y+.5,x+2,y+.5)));
    shader.setUniform('u_north',axis(1,span(x+.5,y-1,x+.5,y+2)));
    const rgba=ctx.getImageData(0,0,768,768).data;
    shader.setUniform('u_photo',uniform(new Uint8Array(rgba.buffer),768));
    widget.scene.requestRender();
  }
  let lastProbe='';
  function selectCity(p:Point){
    const [index,strength]=reflectionCity(p),key=index+'/'+strength;
    if(key===lastProbe)return;
    lastProbe=key;
    for(const sh of [shader,detailed])sh.setUniform('u_probe',new C.Cartesian2(index,strength));
  }
  return {shader,detailed,setMasks,update,selectCity,dispose(){
    abort?.abort();for(const sh of [shader,detailed])if(!sh.isDestroyed())sh.destroy();
  }};
}
