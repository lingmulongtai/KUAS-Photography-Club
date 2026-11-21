import type {CesiumWidget} from 'cesium';
import {C} from './engine';
import {lonLat,tileXY,type Point} from './coordinates';

// Only the untextured LOD1 survey shells use this material. Actual textured meshes keep their imagery.
export function surveyMaterial(widget:CesiumWidget){
  const uniform=(bytes:Uint8Array,width:number)=>new C.TextureUniform({typedArray:bytes,width,height:width,repeat:false});
  const shader=new C.CustomShader({uniforms:{
    u_photo:{type:C.UniformType.SAMPLER_2D,value:uniform(new Uint8Array([0,0,0,0]),1)},
    u_origin:{type:C.UniformType.VEC3,value:new C.Cartesian3()},
    u_east:{type:C.UniformType.VEC3,value:new C.Cartesian3(1,0,0)},
    u_north:{type:C.UniformType.VEC3,value:new C.Cartesian3(0,1,0)},
  },fragmentShaderText:`
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material){
      vec3 p=fsInput.attributes.positionWC;
      vec3 n=normalize(cross(dFdx(fsInput.attributes.positionEC),dFdy(fsInput.attributes.positionEC)));
      float up=abs(dot(n,normalize(czm_viewRotation*normalize(p))));
      vec3 delta=p-u_origin;
      vec2 uv=vec2(dot(delta,u_east),dot(delta,u_north))+0.5;
      vec3 wall=vec3(.58,.55,.50);
      vec3 roof=vec3(.28,.29,.29);
      if(all(greaterThanEqual(uv,vec2(0.))) && all(lessThanEqual(uv,vec2(1.)))){
        vec4 photo=texture(u_photo,vec2(uv.x,1.-uv.y));
        roof=mix(roof,czm_gammaCorrect(photo.rgb),.93*photo.a);
      }
      material.diffuse*=mix(wall,roof,smoothstep(.55,.85,up));
    }`});
  let signature='',abort:AbortController|undefined;
  async function update(target:Point,altitude:number){
    const zoom=altitude<1200?16:14,[x,y]=tileXY(...target,zoom).map(Math.floor),key=[zoom,x,y].join('/');
    if(signature===key)return;
    signature=key;abort?.abort();const controller=new AbortController();abort=controller;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=768;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
    await Promise.all(Array.from({length:9},async(_,i)=>{
      const col=i%3,row=Math.floor(i/3);
      try{
        const res=await fetch('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/'+zoom+'/'+(x+col-1)+'/'+(y+row-1)+'.jpg',{signal:controller.signal});
        if(!res.ok)return;
        const img=await createImageBitmap(await res.blob());
        ctx.drawImage(img,col*256,row*256);img.close();
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
  return {shader,update,dispose(){abort?.abort();if(!shader.isDestroyed())shader.destroy();}};
}
