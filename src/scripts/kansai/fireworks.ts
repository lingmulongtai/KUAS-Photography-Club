import type {CesiumWidget} from 'cesium';
import {BIWA_FIREWORKS,OUTINGS} from '../../data/kansai-outings';
import {C} from './engine';

const river=OUTINGS.find(p=>p.id==='setagawa')!;
const lake=BIWA_FIREWORKS;

// One static vertex buffer per venue. Only the elapsed time changes during a show.
function showGeometry(wide:boolean){
  const positions:number[]=[],directions:number[]=[],stages:number[]=[];
  const shells=wide?5:2,sparks=wide?96:72;
  function vertex(shell:number,kind:number,index:number,tail:number,dx=0,dy=0,dz=0){
    positions.push((shell-(shells-1)/2)*(wide?131:29),wide?25*Math.cos(shell*2.3):0,0);
    directions.push(dx,dy,dz);stages.push(shell,kind,index,tail);
  }
  for(let shell=0;shell<shells;shell++){
    for(let i=0;i<10;i++)vertex(shell,0,i,0);
    for(let i=0;i<sparks;i++){
      const z=1-2*(i+.5)/sparks,angle=i*2.39996323,r=Math.sqrt(1-z*z);
      for(let tail=0;tail<7;tail++)vertex(shell,1,i,tail,Math.cos(angle)*r,Math.sin(angle)*r,z);
    }
    for(let i=0;i<60;i++)vertex(shell,2,i,0);
  }
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
      vec3 palette(float index){
        if(index<1.)return vec3(1.,.65,.24);
        if(index<2.)return vec3(.36,.76,1.);
        if(index<3.)return vec3(1.,.34,.48);
        if(index<4.)return vec3(.53,1.,.78);
        if(index<5.)return vec3(.86,.51,1.);
        return vec3(1.,.85,.57);
      }
      void main(){
        const bool lake=${wide?'true':'false'};
        const float shells=${wide?'5.':'2.'}, period=${wide?'6.6':'6.'};
        float shell=sparkStage.x,kind=sparkStage.y,i=sparkStage.z,tail=sparkStage.w;
        float clock=u_elapsed+period*shell/shells;
        float wave=floor(clock/period),phase=mod(clock,period);
        bool fan=lake && mod(wave,3.)>1.5 && abs(shell-2.)>.5;
        float lift=fan?.76:1.1;
        float variation=.5+.5*sin(wave*2.43+shell*1.78);
        float apex=fan?46.+variation*26.:(lake?112.:69.)+variation*(lake?97.:43.);
        float radius=(fan?44.:(lake?69.:43.))*(1.+variation*.42);
        float age=phase-lift,life=fan?2.10:2.87;
        vec3 rgb=palette(mod(wave*2.+shell+(lake?1.:0.),6.));
        vec3 offset=vec3(0.);
        float alpha=0.,size=1.;
        v_water=0.;
        if(kind<.5 && age<0.){
          float t=max(0.,(phase-i*.022)/lift);
          offset.z=apex*(1.-pow(1.-t,1.5));
          rgb=vec3(1.,.82,.53);size=5.-i*.24;alpha=(1.-i/10.)*.9;
        }else if(kind>.5 && age>=0. && age<life){
          bool willow=mod(wave,3.)==1.;
          if(kind<1.5){
            float t=age-tail*(willow?.060:.040);
            float distance=radius*(.91+.09*sin(i*13.4+shell))*(1.-exp(-1.9*max(t,0.)));
            vec3 direction=sparkDirection;if(fan)direction.z=abs(direction.z);
            offset=direction*distance+vec3(2.*t,0.,apex-(willow?9.:5.)*t*t);
            if(t>=0. && offset.z>1.)alpha=pow(1.-age/life,.64)*(1.-tail/8.)*(.89+.11*sin(i+age*8.));
            if(willow && tail>1.)rgb=vec3(1.,.80,.52);
            size=(tail<.5?5.5:4.1)*(1.-.32*age/life);
          }else{
            v_water=1.;
            vec2 viewer=czm_encodedCameraPositionMCHigh.xy+czm_encodedCameraPositionMCLow.xy-position3DHigh.xy-position3DLow.xy;
            vec2 toward=viewer/max(1.,length(viewer));
            float f=(i+.5)/60.;
            offset.xy=toward*f*(lake?100.:33.)+vec2(-toward.y,toward.x)*sin(i*19.2+shell*7.+u_elapsed*1.8)*(lake?16.:5.)*(1.+f);
            offset.z=1.45;
            alpha=min(1.,age*4.5)*(1.-age/life)*(.33+.15*sin(i*2.+u_elapsed*3.));
            size=(lake?14.:9.)*(1.-.35*f);
          }
        }
        v_color=vec4(rgb,alpha);
        vec4 point=czm_computePosition();
        point.xyz+=offset;
        gl_Position=alpha>.012?czm_modelViewProjectionRelativeToEye*point:vec4(2.,2.,2.,1.);
        gl_PointSize=size*czm_pixelRatio;
      }`,
    fragmentShaderSource:`
      in vec4 v_color;
      in float v_water;
      void main(){
        vec2 p=(gl_PointCoord-.5)*2.;
        p.y*=mix(1.,5.5,v_water);
        float d=dot(p,p);if(d>=1.)discard;
        float intensity=exp(-3.6*d)*(1.-smoothstep(.72,1.,d));
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
