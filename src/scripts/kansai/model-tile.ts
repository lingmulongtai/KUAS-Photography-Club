import type {Cartographic,CesiumWidget} from 'cesium';
import {C} from './engine';
import {lonLat,tileMetresPerDegree,type Box} from './coordinates';
import {landmarkCutout} from './landmark-cutout';
import type {TileGeometry} from './tile-geometry';
import type {TileQueue} from './tile-queue';
import type {Surveys} from './surveys';
import {localAppearance} from './material';

async function heights(widget:CesiumWidget,west:number,south:number,east:number,north:number){
  const n=12,points:Cartographic[]=[];
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)
    points.push(C.Cartographic.fromDegrees(west+(east-west)*i/n,south+(north-south)*j/n));
  if(widget.terrainProvider.availability)await C.sampleTerrainMostDetailed(widget.terrainProvider,points);
  else for(const p of points)p.height=widget.scene.globe.getHeight(p)??0;
  return Float64Array.from(points,p=>p.height||0);
}

function instance(mesh:TileGeometry){
  const geometry=new C.Geometry({
    attributes:Object.assign(new C.GeometryAttributes(),{
      position:new C.GeometryAttribute({componentDatatype:mesh.positions instanceof Float32Array?C.ComponentDatatype.FLOAT:C.ComponentDatatype.DOUBLE,
        componentsPerAttribute:3,values:mesh.positions}),
      featureId:new C.GeometryAttribute({componentDatatype:mesh.ids instanceof Uint16Array?C.ComponentDatatype.UNSIGNED_SHORT:C.ComponentDatatype.FLOAT,
        componentsPerAttribute:1,values:mesh.ids}),
      normal:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:3,values:mesh.normals}),
      color:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.UNSIGNED_BYTE,componentsPerAttribute:4,normalize:true,values:mesh.colors}),
      st:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:2,values:mesh.uv}),
    }),primitiveType:C.PrimitiveType.TRIANGLES,boundingSphere:new C.BoundingSphere(C.Cartesian3.fromArray(mesh.center),mesh.radius),
  });
  return new C.GeometryInstance({geometry});
}

export async function buildTile(widget:CesiumWidget,queue:TileQueue,x:number,y:number){
  const [west,north]=lonLat(x,y,16),[east,south]=lonLat(x+1,y+1,16);
  const grid=await heights(widget,west,south,east,north);
  const {center,locations,geometry}=await queue.compile(x,y,grid);
  const primitive=geometry?new C.Primitive({geometryInstances:instance(geometry),
    modelMatrix:C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(...center)),
    appearance:localAppearance(x,y,geometry.positions instanceof Float32Array,()=>{if(!widget.isDestroyed())widget.scene.requestRender();}),
    asynchronous:false,allowPicking:false,compressVertices:false,vertexCacheOptimize:false}):undefined;
  const shown=new Uint8Array(locations.length).fill(1);
  let applied=-1,checking=-1,cursor=0,dirty=false,landmarks=-1;
  const scale=tileMetresPerDegree(center[1]),box=geometry?.extent;
  const bounds:Box|undefined=box&&[center[0]+box[0]/scale[0],center[1]+box[1]/scale[1],
    center[0]+box[2]/scale[0],center[1]+box[3]/scale[1]];
  function publishVisibility(){
    if(!dirty||!primitive)return;
    const width=Math.min(256,locations.length+1),height=Math.ceil((locations.length+1)/width);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d')!;
    const pixels=ctx.createImageData(width,height);
    pixels.data.fill(255);
    for(let i=0;i<shown.length;i++)pixels.data[(i+1)*4]=shown[i]*255;
    ctx.putImageData(pixels,0,0);
    primitive.appearance.material.uniforms.visibility=canvas;
    dirty=false;widget.scene.requestRender();
  }
  return {primitive,releaseMaterial(){primitive?.appearance.material?.destroy();},buildings:locations.length,refresh(surveys:Surveys,until:number){
    if(!primitive?.ready)return;
    if(landmarks!==surveys.landmarkRevision&&bounds&&locations.length){
      if(performance.now()>=until)return true;
      landmarks=surveys.landmarkRevision;
      const mask=landmarkCutout(surveys.landmarkRings(bounds),center,scale,box!);
      const u=primitive.appearance.material.uniforms;
      u.landmarks=mask?.canvas??C.Material.DefaultImageId;
      u.landmarkExtent=mask?C.Cartesian4.fromArray(mask.extent):new C.Cartesian4();
      if(mask||applied>=0)widget.scene.requestRender();
    }
    if(applied===surveys.revision)return;
    if(cursor===0)checking=surveys.revision;
    // Allow another frame to present while a large municipal model is arriving.
    while(cursor<locations.length){
      if((cursor&31)===0 && performance.now()>=until)return true;
      const i=cursor++,value=surveys.contains(locations[i])?0:1;
      if(shown[i]===value)continue;
      shown[i]=value;dirty=true;
    }
    publishVisibility();applied=checking;cursor=0;
    return applied!==surveys.revision;
  }};
}
