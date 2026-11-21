import {C} from './engine';
import {aerialPhoto} from './aerial';
import {lonLat} from './coordinates';

// Roofs use the photographed surface at their own map coordinates. Window pitch
// is expressed in metres, with derivative filtering before the panes get subpixel.
export function localAppearance(x:number,y:number,redraw:()=>void){
  const material=C.Material.fromType('Image');
  void aerialPhoto(16,x,y).then(image=>{
    if(image&&!material.isDestroyed()){material.uniforms.image=image;redraw();}
  }).catch(()=>{/* Keep the base roof tone when offline. */});
  const latitude=lonLat(x+.5,y+.5,16)[1]*Math.PI/180;
  const uniforms={u_tileWidth:Math.cos(latitude)*40075017/65536};
  return Object.assign(new C.Appearance({material,translucent:false,closed:false,renderState:{depthTest:{enabled:true},depthMask:true},
    vertexShaderSource:`
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in vec3 normal;
      in vec2 st;
      in vec4 color;
      in float batchId;
      uniform float u_tileWidth;
      out vec3 v_normal;
      out vec4 v_color;
      out vec2 v_uv;
      out vec3 v_eye;
      out vec2 v_map;
      void main(){
        vec4 p=czm_computePosition();
        v_uv=st;
        v_color=color;
        v_normal=czm_normal*normal;
        v_eye=(czm_modelViewRelativeToEye*p).xyz;
        v_map=(position3DHigh.xy+position3DLow.xy)/u_tileWidth+.5;
        gl_Position=czm_modelViewProjectionRelativeToEye*p;
      }`,
    fragmentShaderSource:`
      in vec3 v_normal;
      in vec4 v_color;
      in vec2 v_uv;
      in vec3 v_eye;
      in vec2 v_map;
      void main(){
        vec3 base=v_color.rgb;
        vec3 up=normalize(czm_viewerPositionWC);
        float day=smoothstep(-.14,.10,dot(up,czm_sunDirectionWC));
        float windowLight=0.;
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
          float window=pane.x*pane.y*fade;
          if(window>.01){
            vec3 ray=czm_inverseViewRotation*reflect(normalize(v_eye),normalize(v_normal));
            vec3 east=normalize(cross(vec3(0.,0.,1.),up)),north=cross(up,east);
            czm_materialInput inputData;
            inputData.st=clamp(v_map+vec2(dot(ray,east),dot(ray,north))*.18,.002,.998);
            vec3 nearby=czm_getMaterial(inputData).diffuse;
            vec3 reflection=mix(nearby*vec3(.59,.64,.68),vec3(.43,.58,.72),smoothstep(-.1,.35,dot(up,ray)));
            base=mix(base,mix(vec3(.18,.24,.27),reflection,.56),window*.8);
            vec2 cellId=floor(coord);
            windowLight=window*smoothstep(.74,.82,fract(sin(dot(cellId,vec2(32.83,71.19)))*4375.11));
          }
        }
        float light=.77+.23*max(dot(normalize(v_normal),czm_lightDirectionEC),0.);
        vec3 lit=base*light*mix(vec3(.10,.13,.18),vec3(1.),day);
        out_FragColor=vec4(lit+(1.-day)*windowLight*vec3(.87,.67,.37),1.);
      }`
  }),{uniforms});
}
