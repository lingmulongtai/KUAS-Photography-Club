import type {PackedMesh} from './mesh';

/** Preserve each triangle and its building identity while preparing one GPU upload per tile. */
export function combineTileMeshes(meshes:PackedMesh[]){
  if(!meshes.length)return;
  const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];
  let vertices=0;
  for(const {positions} of meshes){
    vertices+=positions.length/3;
    for(let i=0;i<positions.length;i+=3){
      for(let axis=0;axis<3;axis++){
        const value=positions[i+axis];
        minimum[axis]=Math.min(minimum[axis],value);
        maximum[axis]=Math.max(maximum[axis],value);
      }
    }
  }
  // Cesium encodes large coordinates in two floats at multiples of 65536.
  // Within a local survey tile its high component is normally exactly zero.
  const local=minimum.every(v=>v>-65536)&&maximum.every(v=>v<65536);
  const positions=local?new Float32Array(vertices*3):new Float64Array(vertices*3);
  const normals=new Float32Array(vertices*3),colors=new Uint8Array(vertices*4),uv=new Float32Array(vertices*2);
  const ids=meshes.length<65536?new Uint16Array(vertices):new Float32Array(vertices);
  let offset=0;
  for(const mesh of meshes){
    const count=mesh.positions.length/3;
    positions.set(mesh.positions,offset*3);
    normals.set(mesh.normals,offset*3);
    colors.set(mesh.colors,offset*4);
    uv.set(mesh.uv,offset*2);
    if(mesh.id!==undefined)ids.fill(Number(mesh.id)+1,offset,offset+count);
    offset+=count;
  }
  const center=minimum.map((v,i)=>(v+maximum[i])/2);
  let radiusSquared=0;
  for(let i=0;i<positions.length;i+=3){
    const x=positions[i]-center[0],y=positions[i+1]-center[1],z=positions[i+2]-center[2];
    radiusSquared=Math.max(radiusSquared,x*x+y*y+z*z);
  }
  return {positions,normals,colors,uv,ids,center,radius:Math.sqrt(radiusSquared)+.001};
}

export type TileGeometry=NonNullable<ReturnType<typeof combineTileMeshes>>;
