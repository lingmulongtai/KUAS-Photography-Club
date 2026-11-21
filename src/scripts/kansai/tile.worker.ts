import {tileCompiler,type TileRequest} from './tile-compiler';

const scope=self as unknown as Worker;
const compile=tileCompiler();
scope.addEventListener('message',async({data}:{data:TileRequest})=>{
  try{
    const result=await compile(data);
    const transfer=result.meshes.flatMap(mesh=>[mesh.positions.buffer,mesh.normals.buffer,mesh.colors.buffer,mesh.uv.buffer]);
    scope.postMessage({id:data.id,result},transfer);
  }catch(error){
    scope.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});
  }
});
