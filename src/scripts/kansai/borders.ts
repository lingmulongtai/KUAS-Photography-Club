import type {CesiumWidget} from 'cesium';
import {C} from './engine';

// Classify the visible world position after opaque terrain, buildings, roads and
// water have drawn. The same survey line therefore cuts through crossing meshes.
export function prefectureCutout(widget:CesiumWidget,initial:string){
  const root='/kansai/borders/';
  const fragmentShader=`
    uniform sampler2D colorTexture;
    uniform sampler2D depthTexture;
    uniform sampler2D coarse;
    uniform sampler2D districts;
    uniform sampler2D edges;
    uniform float selected;
    in vec2 v_textureCoordinates;
    ivec3 readCell(sampler2D atlas,ivec2 p){
      p.y=textureSize(atlas,0).y-1-p.y;
      return ivec3(round(texelFetch(atlas,p,0).rgb*255.));
    }
    int pointer(ivec3 c){return (c.r-250)*65536+c.b*256+c.g;}
    int prefecture(vec2 offsetDegrees){
      vec2 grid=offsetDegrees*64.;
      ivec2 cell=ivec2(floor(grid));
      if(any(lessThan(cell,ivec2(0)))||any(greaterThanEqual(cell,textureSize(coarse,0))))return 0;
      ivec3 c=readCell(coarse,cell);
      if(c.r<250)return c.r;
      int block=pointer(c);
      grid=fract(grid)*32.;
      c=readCell(districts,ivec2(block%128,block/128)*32+ivec2(grid));
      if(c.r<250)return c.r;
      block=pointer(c);
      ivec2 sub=ivec2(fract(grid)*16.);
      ivec3 bytes=readCell(edges,ivec2(block%256*8,block/256*4)+sub/ivec2(2,4));
      int bits=bytes.r+(bytes.g<<8)+(bytes.b<<16);
      int code=(bits>>(3*((sub.y%4)*2+sub.x%2)))&7;
      return code==0?0:24+code;
    }
    void main(){
      vec2 uv=v_textureCoordinates;
      out_FragColor=texture(colorTexture,uv);
      float depth=texture(depthTexture,uv).r;
      if(depth>=1. || depth<=0.)return;
      vec4 eye=czm_windowToEyeCoordinates(gl_FragCoord.xy,depth);
      vec3 world=czm_viewerPositionWC+czm_inverseViewRotation*(eye.xyz/eye.w);
      // Bowring's inverse on WGS84 also locates elevated roofs and bridge decks.
      float r=length(world.xy);
      // Rotate around Kansai first. Mobile atan approximations applied to absolute
      // longitude/latitude can displace a border by tens of metres.
      vec2 cs=normalize(vec2(r,world.z*1.00336409));
      vec2 meridian=vec2(r-42697.6727*cs.x*cs.x*cs.x,world.z+42841.3115*cs.y*cs.y*cs.y);
      vec2 reference=vec2(.8191520443,.5735764364); // 35 degrees north
      float daylight=smoothstep(-.13,.08,dot(normalize(czm_viewerPositionWC),czm_sunDirectionWC));
      vec4 outside=vec4(mix(vec3(.012,.019,.029),vec3(.13,.18,.20),daylight),1.);
      float radial=world.y-world.x;
      if(radial<=0. || dot(meridian,reference)<=0.){out_FragColor=outside;return;}
      vec2 tangent=vec2(-(world.x+world.y)/radial,
        dot(meridian,vec2(-reference.y,reference.x))/dot(meridian,reference));
      if(any(greaterThan(abs(tangent),vec2(.04)))){out_FragColor=outside;return;}
      vec2 sq=tangent*tangent;
      vec2 p=vec2(1.,1.25)+degrees(tangent*(1.-sq/3.+sq*sq/5.));
      if(prefecture(p)!=int(selected))out_FragColor=outside;
    }`;
  const stage=widget.scene.postProcessStages.add(new C.PostProcessStage({
    name:'kansai-prefecture-cutout',fragmentShader,
    uniforms:{selected:Number(initial),coarse:root+'prefectures.png',districts:root+'districts.png',edges:root+'edges.png'},
  }));
  return (pref:string)=>{stage.uniforms.selected=Number(pref);widget.scene.requestRender();};
}
