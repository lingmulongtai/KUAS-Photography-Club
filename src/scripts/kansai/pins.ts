import type {CesiumWidget} from 'cesium';
import {C} from './engine';
import {OUTINGS} from '../../data/kansai-outings';

export async function outingPins(widget:CesiumWidget,en:boolean,visit:(id:string)=>void){
  const labels=new C.LabelCollection({scene:widget.scene});
  const points=OUTINGS.map(place=>C.Cartographic.fromDegrees(place.lon,place.lat));
  if(widget.terrainProvider.availability){
    try{await C.sampleTerrainMostDetailed(widget.terrainProvider,points);}catch{/* Use visible terrain heights below. */}
  }
  if(widget.isDestroyed()){labels.destroy();return;}
  widget.scene.primitives.add(labels);
  for(let i=0;i<OUTINGS.length;i++){
    const place=OUTINGS[i],p=points[i];
    labels.add({id:place.id,text:place[en?'en':'ja'],position:C.Cartesian3.fromDegrees(place.lon,place.lat,
      (p.height||widget.scene.globe.getHeight(p)||0)+24),
      font:'600 14px system-ui',style:C.LabelStyle.FILL_AND_OUTLINE,outlineWidth:3,
      fillColor:C.Color.WHITE,outlineColor:C.Color.fromCssColorString('#163d43'),verticalOrigin:C.VerticalOrigin.BOTTOM,
      pixelOffset:new C.Cartesian2(0,-5),distanceDisplayCondition:new C.DistanceDisplayCondition(0,5000),
      disableDepthTestDistance:3500});
  }
  widget.screenSpaceEventHandler.setInputAction((e:{position:InstanceType<typeof C.Cartesian2>})=>{
    const id=widget.scene.pick(e.position)?.id;
    if(typeof id==='string'&&OUTINGS.some(p=>p.id===id))visit(id);
  },C.ScreenSpaceEventType.LEFT_CLICK);
  widget.scene.requestRender();
}
