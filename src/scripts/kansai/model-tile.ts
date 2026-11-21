import type {Cartographic,CesiumWidget} from 'cesium';
import {C} from './engine';
import {lonLat} from './coordinates';
import type {PackedMesh} from './mesh';
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

function instance(mesh:PackedMesh){
  const geometry=new C.Geometry({
    attributes:Object.assign(new C.GeometryAttributes(),{
      position:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values:mesh.positions}),
      normal:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:3,values:mesh.normals}),
      color:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.UNSIGNED_BYTE,componentsPerAttribute:4,normalize:true,values:mesh.colors}),
      st:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:2,values:mesh.uv}),
    }),primitiveType:C.PrimitiveType.TRIANGLES,boundingSphere:C.BoundingSphere.fromVertices(mesh.positions as unknown as number[]),
  });
  return new C.GeometryInstance({geometry,id:mesh.id,attributes:{show:new C.ShowGeometryInstanceAttribute(true)}});
}

export async function buildTile(widget:CesiumWidget,queue:TileQueue,x:number,y:number){
  const [west,north]=lonLat(x,y,16),[east,south]=lonLat(x+1,y+1,16);
  const grid=await heights(widget,west,south,east,north);
  const {center,locations,meshes}=await queue.compile(x,y,grid);
  const instances=meshes.map(instance);
  const primitive=instances.length?new C.Primitive({geometryInstances:instances,
    modelMatrix:C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(...center)),
    appearance:localAppearance(x,y,()=>{if(!widget.isDestroyed())widget.scene.requestRender();}),
    asynchronous:false,allowPicking:false,compressVertices:false,vertexCacheOptimize:false}):undefined;
  const shown=new Uint8Array(locations.length).fill(1);
  let applied=-1,checking=-1,cursor=0;
  return {primitive,releaseMaterial(){primitive?.appearance.material?.destroy();},buildings:locations.length,refresh(surveys:Surveys,until:number){
    if(!primitive?.ready||applied===surveys.revision)return;
    if(cursor===0)checking=surveys.revision;
    // Allow another frame to present while a large municipal model is arriving.
    while(cursor<locations.length){
      if((cursor&31)===0 && performance.now()>=until)return true;
      const i=cursor++,value=surveys.contains(locations[i])?0:1;
      if(shown[i]===value)continue;
      primitive.getGeometryInstanceAttributes(String(i)).show=new Uint8Array([value]);
      shown[i]=value;
    }
    applied=checking;cursor=0;
    return applied!==surveys.revision;
  }};
}
