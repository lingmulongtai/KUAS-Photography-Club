import type {Billboard, CesiumWidget} from 'cesium';
import {C} from './engine';
import {MAP_PLACES} from '../../data/kansai-outings';

// Rasterize each name in a single pass. Native canvas shaping also preserves
// kerning and compound glyphs without reading a separate image back per letter.
function pinImage(text:string){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
  const font='600 14px system-ui',pad=3;
  ctx.font=font;
  const metrics=ctx.measureText(text);
  const ascent=Math.ceil(metrics.actualBoundingBoxAscent),descent=Math.ceil(metrics.actualBoundingBoxDescent);
  const width=Math.ceil(Math.max(metrics.width,metrics.actualBoundingBoxRight))+pad*2;
  const height=ascent+descent+pad*2,ratio=Math.max(2,Math.ceil(window.devicePixelRatio||1));
  canvas.width=width*ratio;canvas.height=height*ratio;
  ctx.scale(ratio,ratio);ctx.font=font;ctx.lineJoin='round';ctx.lineWidth=3;
  ctx.strokeStyle='#163d43';ctx.fillStyle='white';
  ctx.strokeText(text,pad,pad+ascent);ctx.fillText(text,pad,pad+ascent);
  return {image:canvas,width,height};
}

export function outingPins(widget:CesiumWidget,en:boolean,visit:(id:string)=>void,prefecture:()=>string){
  const scene=widget.scene,pins=scene.primitives.add(new C.BillboardCollection({scene})) as InstanceType<typeof C.BillboardCollection>;
  const places=MAP_PLACES.map(place=>({place,base:C.Cartesian3.fromDegrees(place.lon,place.lat)}));
  const added=new Map<string,Billboard>(),lastEye=new C.Cartesian3();
  let lastPref='';
  scene.preRender.addEventListener(()=>{
    const pref=prefecture(),eye=scene.camera.positionWC;
    if(pref===lastPref&&C.Cartesian3.distanceSquared(eye,lastEye)<200*200)return;
    lastPref=pref;C.Cartesian3.clone(eye,lastEye);
    const nearby:{point:InstanceType<typeof C.Cartographic>;label:Billboard}[]=[];
    for(const {place,base} of places){
      const show=place.pref===pref,pin=added.get(place.id);
      if(pin){pin.show=show;continue;}
      // 5 km display range plus headroom for mountain elevations and camera motion.
      if(!show||C.Cartesian3.distanceSquared(eye,base)>8000*8000)continue;
      const point=C.Cartographic.fromDegrees(place.lon,place.lat);
      const label=pins.add({...pinImage(place[en?'en':'ja']),id:place.id,
        position:C.Cartesian3.fromRadians(point.longitude,point.latitude,(scene.globe.getHeight(point)??0)+24),
        horizontalOrigin:C.HorizontalOrigin.LEFT,verticalOrigin:C.VerticalOrigin.BOTTOM,
        pixelOffset:new C.Cartesian2(-3,-2),distanceDisplayCondition:new C.DistanceDisplayCondition(0,5000),
        disableDepthTestDistance:3500});
      added.set(place.id,label);nearby.push({point,label});
    }
    if(!nearby.length)return;
    scene.requestRender();
    if(widget.terrainProvider.availability){
      void C.sampleTerrainMostDetailed(widget.terrainProvider,nearby.map(entry=>entry.point)).then(samples=>{
        if(widget.isDestroyed())return;
        for(const [i,p] of samples.entries())if(Number.isFinite(p.height))
          nearby[i].label.position=C.Cartesian3.fromRadians(p.longitude,p.latitude,p.height+24);
        scene.requestRender();
      }).catch(()=>{/* Retain the elevation from the visible terrain. */});
    }
  });
  widget.screenSpaceEventHandler.setInputAction((e:{position:InstanceType<typeof C.Cartesian2>})=>{
    const id=scene.pick(e.position)?.id;
    if(typeof id==='string'&&added.has(id))visit(id);
  },C.ScreenSpaceEventType.LEFT_CLICK);
  scene.requestRender();
}
