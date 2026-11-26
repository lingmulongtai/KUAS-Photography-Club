import type {CesiumWidget} from 'cesium';
import {BIWA_FIREWORKS,OUTINGS} from '../../data/kansai-outings';
import {C} from './engine';
import {particles,simulation,pointShape} from './firework-particles';

const river=OUTINGS.find(p=>p.id==='setagawa')!;
const lake=BIWA_FIREWORKS;

// One static vertex buffer per venue. Only the elapsed time changes during a show.
function showGeometry(wide:boolean){
  const {positions,directions,stages}=particles(wide);
  const attr=(values:number[],size:number)=>new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,
    componentsPerAttribute:size,values:new Float32Array(values)});
  return new C.Geometry({primitiveType:C.PrimitiveType.POINTS,
    attributes:Object.assign(new C.GeometryAttributes(),{
      position:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values:new Float64Array(positions)}),
      sparkDirection:attr(directions,3),sparkStage:attr(stages,4),
    }),boundingSphere:new C.BoundingSphere(new C.Cartesian3(0,0,95),wide?520:195)});
}

function displayPrimitive(wide:boolean){
  const uniforms={u_elapsed:2.35};
  const appearance=Object.assign(new C.Appearance({translucent:true,closed:false,
    renderState:{depthTest:{enabled:true},depthMask:false,blending:C.BlendingState.ADDITIVE_BLEND},
    vertexShaderSource:`
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in vec3 sparkDirection;
      in vec4 sparkStage;
      in float batchId;
      uniform float u_elapsed;
      out vec4 v_color;
      out float v_water;
      vec2 viewFromLaunch(){return czm_encodedCameraPositionMCHigh.xy+czm_encodedCameraPositionMCLow.xy-position3DHigh.xy-position3DLow.xy;}
      float cameraHeight(){return max(4.,czm_encodedCameraPositionMCHigh.z+czm_encodedCameraPositionMCLow.z-position3DHigh.z-position3DLow.z);}
      ${simulation(wide)}
      void main(){
        vec3 offset; float size,alpha;
        simulate(offset,size,alpha);
        vec4 point=czm_computePosition();
        point.xyz+=offset;
        gl_Position=alpha>.012?czm_modelViewProjectionRelativeToEye*point:vec4(2.,2.,2.,1.);
        gl_PointSize=size*czm_pixelRatio;
      }`,
    fragmentShaderSource:`
      in vec4 v_color;
      in float v_water;
      void main(){
        ${pointShape}
        out_FragColor=vec4(v_color.rgb,v_color.a*intensity);
      }`,
  }),{uniforms});
  const primitive=new C.Primitive({geometryInstances:new C.GeometryInstance({geometry:showGeometry(wide)}),appearance,
    asynchronous:false,compressVertices:false,allowPicking:false,vertexCacheOptimize:false});
  return {primitive,uniforms};
}

// Locations match the venues. Choreography is original and is not tied to one festival year.
export function fireworks(widget:CesiumWidget,button:HTMLButtonElement,en:boolean){
  const {scene}=widget,day=widget.clock.currentTime.clone(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const evening=C.JulianDate.fromIso8601('2025-08-08T11:05:00Z');
  let active:ReturnType<typeof displayPrimitive>|undefined,id='',paused=false,elapsed=2.35,previous=0;
  let sampleHeight:(()=>void)|undefined;
  function label(){
    button.hidden=!id;
    button.textContent=paused?(en?'Play fireworks':'花火を再生'):(en?'Pause fireworks':'花火を一時停止');
    button.setAttribute('aria-pressed',String(!paused));
  }
  function dark(on:boolean){
    widget.clock.currentTime=on?evening:day;scene.globe.enableLighting=on;
    if(scene.imageryLayers.length)scene.imageryLayers.get(0).brightness=on?.34:1;
    scene.requestRender();
  }
  function stop(){
    if(active)scene.primitives.remove(active.primitive);
    active=undefined;id='';sampleHeight=undefined;previous=0;dark(false);label();
  }
  const removeUpdate=scene.preUpdate.addEventListener(()=>{
    if(!active||paused||document.hidden){previous=0;return;}
    const now=performance.now();
    if(previous)elapsed+=Math.min(.15,(now-previous)/1000);
    previous=now;active.uniforms.u_elapsed=elapsed;
    scene.requestRender();
  });
  const removeTerrain=scene.globe.terrainProviderChanged.addEventListener(()=>sampleHeight?.());
  const arm=()=>{previous=0;if(active)scene.requestRender();};
  document.addEventListener('visibilitychange',arm);
  function select(next:string){
    const place=next===lake.id?lake:next===river.id?river:undefined;
    if(!place){if(id)stop();return;}
    if(id===place.id)return;
    if(id)stop();
    id=place.id;elapsed=2.35;paused=reduced.matches;
    const anchor=C.Cartographic.fromDegrees(place.lon,place.lat),current=displayPrimitive(id===lake.id);
    function setHeight(height:number){
      if(current!==active||widget.isDestroyed())return;
      current.primitive.modelMatrix=C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromRadians(anchor.longitude,anchor.latitude,height));
      scene.requestRender();
    }
    active=current;setHeight(scene.globe.getHeight(anchor)??121);scene.primitives.add(current.primitive);
    sampleHeight=()=>{if(widget.terrainProvider.availability)void C.sampleTerrainMostDetailed(widget.terrainProvider,[anchor])
      .then(([p])=>setHeight(p.height??121)).catch(()=>{});};
    sampleHeight();dark(true);label();
  }
  button.onclick=()=>{paused=!paused;label();arm();};
  return {select,dispose(){document.removeEventListener('visibilitychange',arm);removeUpdate();removeTerrain();
    button.onclick=null;stop();}};
}
