import {KANSAI} from '../../data/kansai';
import {EXPO,MAP_PLACES} from '../../data/kansai-outings';
import {C} from './engine';
import {json} from './sources';
import {attachSurveys} from './surveys';
import {attachModels} from './stream';
import {distantModels} from './skyline';
import {outingPins} from './pins';
import {architecturalModels} from './architecture';
import {fireworks} from './fireworks';
import {prefectureCutout} from './borders';

export async function startMap(root:HTMLElement){
  const en=root.lang==='en',status=root.querySelector<HTMLElement>('[role=status]')!;
  const prefecture=root.querySelector<HTMLSelectElement>('#map-prefecture')!,outing=root.querySelector<HTMLSelectElement>('#map-outing')!;
  const container=root.querySelector<HTMLElement>('.globe')!;
  const expoLink=root.querySelector<HTMLAnchorElement>('[data-expo-view]')!;
  const cameraTargets=[...KANSAI.map(p=>({...p,id:p.code,pref:p.code})),...MAP_PLACES];
  const byId=(id:string)=>cameraTargets.find(p=>p.id===id);
  let sequence=0,ready=false,renderFailed=false,userMoved=false,close:undefined|(()=>void);
  const imagery=new C.UrlTemplateImageryProvider({url:'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    rectangle:C.Rectangle.fromDegrees(133.7,33.4,137,36.4),minimumLevel:2,maximumLevel:18,credit:'国土地理院（全国最新写真）'});
  const widget=new C.CesiumWidget(container,{baseLayer:new C.ImageryLayer(imagery),scene3DOnly:true,requestRenderMode:true,
    maximumRenderTimeChange:Infinity,shouldAnimate:false,showRenderLoopErrors:false});
  const scene=widget.scene;
  // The Expo archive captures the six surveyed ground sheets during the fair.
  void json<{bounds:[number,number,number,number];columns:number;rows:number;width:number;height:number;maximumLevel:number}>('expo-imagery/index.json')
    .then(photo=>{
      if(widget.isDestroyed())return;
      const rectangle=C.Rectangle.fromDegrees(...photo.bounds);
      widget.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({
        rectangle,tilingScheme:new C.GeographicTilingScheme({rectangle,numberOfLevelZeroTilesX:photo.columns,numberOfLevelZeroTilesY:photo.rows}),
        tileWidth:photo.width,tileHeight:photo.height,maximumLevel:photo.maximumLevel,
        url:'/kansai/expo-imagery/{z}/{x}/{y}.webp',credit:'2025年大阪・関西万博会場（国土交通省都市局・Project PLATEAU）',
      }));
      scene.requestRender();
    }).catch(()=>{/* The base aerial continues to cover Yumeshima. */});
  scene.globe.depthTestAgainstTerrain=true;scene.globe.maximumScreenSpaceError=1.5;
  scene.globe.baseColor=C.Color.fromCssColorString('#6b8479');
  scene.screenSpaceCameraController.minimumZoomDistance=12;
  scene.screenSpaceCameraController.maximumZoomDistance=460000;
  widget.clock.currentTime=C.JulianDate.fromIso8601('2026-05-15T04:30:00Z');
  const display=fireworks(widget,root.querySelector<HTMLButtonElement>('[data-fireworks]')!,en);
  let selected=byId(new URLSearchParams(location.search).get('view')??'26')??byId('26')!;
  const showPrefecture=prefectureCutout(widget,selected.pref);
  function frame(place:typeof selected,height:number){
    const focus=height+('targetHeight' in place?place.targetHeight:0);
    scene.camera.lookAt(C.Cartesian3.fromDegrees(place.lon,place.lat,focus),new C.HeadingPitchRange(
      C.Math.toRadians(place.heading),C.Math.toRadians('pitch' in place?place.pitch:-25),place.range));
    scene.camera.lookAtTransform(C.Matrix4.IDENTITY);scene.requestRender();
  }
  async function visit(place:typeof selected){
    selected=place;userMoved=false;const token=++sequence;
    expoLink.hidden=place.id!==EXPO.id;
    showPrefecture(place.pref);
    display.select(place.id);
    prefecture.value=place.pref;outing.value=place.id===place.pref?'':place.id;
    const url=new URL(location.href);url.searchParams.set('view',place.id);history.replaceState(null,'',url);
    const point=C.Cartographic.fromDegrees(place.lon,place.lat);
    frame(place,scene.globe.getHeight(point)??0);
    if(ready && widget.terrainProvider.availability){
      try{const [sample]=await C.sampleTerrainMostDetailed(widget.terrainProvider,[point]);
        if(token===sequence&&!userMoved&&!widget.isDestroyed())frame(place,sample.height??0);
      }catch{/* The current terrain mesh still supplies a navigation height. */}
    }
  }
  prefecture.onchange=()=>{const place=byId(prefecture.value);if(place)void visit(place);};
  outing.onchange=()=>{const place=byId(outing.value);if(place)void visit(place);};
  for(const event of ['pointerdown','wheel'])container.addEventListener(event,()=>{userMoved=true;},{passive:true});
  void visit(selected);
  const dispose=()=>{
    sequence++;
    const release=close;close=undefined;
    try{display.dispose();release?.();}finally{if(!widget.isDestroyed())widget.destroy();}
  };
  window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();});
  scene.renderError.addEventListener((_scene:unknown,error:unknown)=>{
    if(renderFailed)return;
    renderFailed=true;queueMicrotask(dispose);
    console.error(error);status.textContent=en?'The 3D view could not be rendered.':'3D描画を続けられませんでした。';
  });
  const terrain=C.CesiumTerrainProvider.fromUrl('https://tile.plateauview.mlit.go.jp/terrain',{requestVertexNormals:true})
    .then(provider=>{if(widget.isDestroyed())return;widget.terrainProvider=provider;ready=true;void visit(selected);})
    .catch(()=>{status.textContent=en?'Elevation is unavailable. Showing aerial imagery.':'標高を取得できません。航空写真を表示しています。';});
  let surveyFailed=false;
  await terrain;if(widget.isDestroyed())return;
  const architecture=await architecturalModels(widget);
  const surveys=await attachSurveys(widget,()=>{surveyFailed=true;},[selected.lon,selected.lat],architecture);
  if(widget.isDestroyed())return;

  void outingPins(widget,en,id=>{const place=byId(id);if(place)void visit(place);},()=>selected.pref);
  const distant=await distantModels(widget,surveys);
  if(widget.isDestroyed()){distant.dispose();return;}
  close=attachModels(widget,surveys,distant,count=>{
    if(renderFailed)return;
    const note=!ready?(en?' · Elevation is unavailable':'・標高データを取得できません'):
      surveyFailed?(en?' · Some survey tiles are unavailable':'・一部の実測モデルは取得待ち'):'';
    status.textContent=(en?'Local model tiles: '+count:'周辺のモデル '+count+' タイル')+note;
  });
  scene.requestRender();
}
