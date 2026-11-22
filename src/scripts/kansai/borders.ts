import {BOUNDARY_LOOKUP} from './boundary-lookup';
import type {CesiumWidget} from 'cesium';
import {C} from './engine';

// Classify the visible world position after opaque terrain, buildings, roads and
// water have drawn. The same survey line therefore cuts through crossing meshes.
export async function prefectureCutout(widget:CesiumWidget,initial:string){
  // Present the first frame with the same administrative cut as every later frame.
  const {canvas}=widget.scene;
  canvas.style.visibility='hidden';
  if(!widget.scene.pickPositionSupported)throw new Error('The prefecture boundary needs a depth texture.');
  const [coarse,districts,edges,islets]=await Promise.all(['prefectures','districts','edges','islets'].map(async name=>{
    const image=new Image();image.src='/kansai/borders/'+name+'.png';
    await image.decode();return image;
  }));
  if(widget.isDestroyed())return ()=>{};
  const fragmentShader=`
    uniform sampler2D colorTexture;
    uniform sampler2D depthTexture;
    uniform sampler2D coarse;
    uniform sampler2D districts;
    uniform sampler2D edges;
    uniform sampler2D islets;
    uniform mat3 eyeToENU;
    uniform vec2 cameraCell;
    uniform vec2 cameraFraction;
    uniform vec4 curvature;
    uniform float curvatureSlope;
    uniform float selected;
    in vec2 v_textureCoordinates;
    ${BOUNDARY_LOOKUP}
    void main(){
      vec2 uv=v_textureCoordinates;
      out_FragColor=texture(colorTexture,uv);
      float depth=texture(depthTexture,uv).r;
      if(depth>=1. || depth<=0.)return;
      vec4 eye=czm_windowToEyeCoordinates(gl_FragCoord.xy,depth);
      vec3 ray=eye.xyz/eye.w;
      float daylight=smoothstep(-.13,.08,dot(normalize(czm_viewerPositionWC),czm_sunDirectionWC));
      vec4 outside=vec4(mix(vec3(.012,.019,.029),vec3(.13,.18,.20),daylight),1.);
      if(dot(ray,ray)<25e6 && all(greaterThan(cameraCell,vec2(-160.)))
          && all(lessThan(cameraCell,vec2(5280.,4512.)))){
        // Keep camera-relative precision near small rocks. Reconstructing absolute ECEF in a float loses decimetres.
        vec3 enu=eyeToENU*ray;
        float radial=curvature.x+enu.z*curvature.z-enu.y*curvature.w;
        float bulge=enu.x*enu.x/(length(vec2(radial,enu.x))+radial);
        float meridian=curvature.y+enu.z+curvature.z*bulge;
        vec2 t=vec2(enu.x/radial,(enu.y-curvature.w*bulge)/meridian),sq=t*t;
        vec2 delta=t*(1.-sq/3.+sq*sq/5.);
        delta.y-=curvatureSlope/meridian*delta.y*delta.y;
        vec2 grid=cameraFraction+degrees(delta)*2048.;
        if(prefecture(ivec2(cameraCell)+ivec2(floor(grid)),fract(grid))!=int(selected))out_FragColor=outside;
        return;
      }
      vec3 world=czm_viewerPositionWC+czm_inverseViewRotation*ray;
      // Bowring's inverse on WGS84 also locates elevated roofs and bridge decks.
      float r=length(world.xy);
      // Rotate around Kansai first. Mobile atan approximations applied to absolute
      // longitude/latitude can displace a border by tens of metres.
      vec2 cs=normalize(vec2(r,world.z*1.00336409));
      vec2 meridian=vec2(r-42697.6727*cs.x*cs.x*cs.x,world.z+42841.3115*cs.y*cs.y*cs.y);
      vec2 reference=vec2(.8191520443,.5735764364); // 35 degrees north
      float radial=world.y-world.x;
      if(radial<=0. || dot(meridian,reference)<=0.){out_FragColor=outside;return;}
      vec2 tangent=vec2(-(world.x+world.y)/radial,
        dot(meridian,vec2(-reference.y,reference.x))/dot(meridian,reference));
      if(any(greaterThan(abs(tangent),vec2(.04)))){out_FragColor=outside;return;}
      vec2 sq=tangent*tangent;
      vec2 p=vec2(1.,1.25)+degrees(tangent*(1.-sq/3.+sq*sq/5.));
      vec2 grid=p*2048.;
      if(prefecture(ivec2(floor(grid)),fract(grid))!=int(selected))out_FragColor=outside;
    }`;
  const eyeToENU=new C.Matrix3(),enu=new C.Matrix4(),basis=new C.Matrix3(),view=new C.Matrix3();
  const cameraCell=new C.Cartesian2(),cameraFraction=new C.Cartesian2(),curvature=new C.Cartesian4();
  let curvatureSlope=0;
  function updateCamera(){
    const camera=widget.camera,p=camera.positionCartographic;
    C.Transforms.eastNorthUpToFixedFrame(camera.positionWC,C.Ellipsoid.WGS84,enu);
    C.Matrix4.getMatrix3(enu,basis);C.Matrix3.transpose(basis,basis);
    C.Matrix4.getMatrix3(camera.inverseViewMatrix,view);C.Matrix3.multiply(basis,view,eyeToENU);
    const x=(C.Math.toDegrees(p.longitude)-134)*2048,y=(C.Math.toDegrees(p.latitude)-33.75)*2048;
    cameraCell.x=Math.floor(x);cameraCell.y=Math.floor(y);
    cameraFraction.x=x-cameraCell.x;cameraFraction.y=y-cameraCell.y;
    const cos=Math.cos(p.latitude),sin=Math.sin(p.latitude),e2=.0066943799901413165,w=1-e2*sin*sin;
    const vertical=6378137/Math.sqrt(w),meridian=vertical*(1-e2)/w;
    curvature.x=(vertical+p.height)*cos;curvature.y=meridian+p.height;curvature.z=cos;curvature.w=sin;
    curvatureSlope=1.5*meridian*e2*sin*cos/w;
  }
  updateCamera();
  widget.scene.preRender.addEventListener(updateCamera);
  const stage=widget.scene.postProcessStages.add(new C.PostProcessStage({
    name:'kansai-prefecture-cutout',fragmentShader,
    uniforms:{selected:Number(initial),coarse,districts,edges,islets,
      eyeToENU:()=>eyeToENU,cameraCell:()=>cameraCell,cameraFraction:()=>cameraFraction,
      curvature:()=>curvature,curvatureSlope:()=>curvatureSlope},
  }));
  let readyLastFrame=false;
  const stop=widget.scene.postRender.addEventListener(()=>{
    if(readyLastFrame&&stage.ready){canvas.style.visibility='';stop();return;}
    readyLastFrame=stage.ready;
    widget.scene.requestRender();
  });
  widget.scene.requestRender();
  return (pref:string)=>{stage.uniforms.selected=Number(pref);widget.scene.requestRender();};
}
