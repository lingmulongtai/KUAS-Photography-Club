import {C} from './engine';
import {aerialPhoto} from './aerial';

// Roofs use the photographed surface at their own map coordinates. Window pitch
// is expressed in metres, with derivative filtering before the panes get subpixel.
export function localAppearance(x:number,y:number,redraw:()=>void){
  const material=C.Material.fromType('Image');
  void aerialPhoto(16,x,y).then(image=>{
    if(image&&!material.isDestroyed()){material.uniforms.image=image;redraw();}
  }).catch(()=>{/* Keep the base roof tone when offline. */});
  return new C.Appearance({material,translucent:false,closed:false,renderState:{depthTest:{enabled:true},depthMask:true},
    vertexShaderSource:`
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in vec3 normal;
      in vec2 st;
      in vec4 color;
      in float batchId;
      out vec3 v_normal;
      out vec4 v_color;
      out vec2 v_uv;
      void main(){
        vec4 p=czm_computePosition();
        v_uv=st;
        v_color=color;
        v_normal=czm_normal*normal;
        gl_Position=czm_modelViewProjectionRelativeToEye*p;
      }`,
    fragmentShaderSource:`
      in vec3 v_normal;
      in vec4 v_color;
      in vec2 v_uv;
      void main(){
        vec3 base=v_color.rgb;
        if(v_color.a>.8){
          czm_materialInput inputData;
          inputData.st=clamp(v_uv,0.002,0.998);
          vec3 photo=czm_getMaterial(inputData).diffuse;
          // During texture streaming the engine supplies a white placeholder.
          if(min(photo.r,min(photo.g,photo.b))<.995)base=mix(base,photo,.88);
        }else if(v_color.a>.25){
          vec2 pitch=vec2(3.05,3.12);
          vec2 coord=v_uv/pitch;
          vec2 cell=abs(fract(coord)-.5);
          vec2 edge=max(fwidth(coord),vec2(.012));
          vec2 pane=1.-smoothstep(vec2(.26,.19)-edge,vec2(.26,.19)+edge,cell);
          float fade=1.-smoothstep(.18,.65,max(edge.x,edge.y));
          base=mix(base,vec3(.26,.33,.37),pane.x*pane.y*fade*.74);
        }
        float light=.77+.23*max(dot(normalize(v_normal),czm_lightDirectionEC),0.);
        out_FragColor=vec4(base*light,1.);
      }`
  });
}
