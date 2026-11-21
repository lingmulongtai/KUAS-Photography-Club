// Build the same log-depth globe shaders that Cesium uses in our WebGL2 scene.
// Reuse its shader generator so an engine update also updates the warm-up sources.
import {gzipSync} from 'node:zlib';
import {readFile,writeFile} from 'node:fs/promises';
import GlobeShaders from '@cesium/engine/Source/Scene/GlobeSurfaceShaderSet.js';
import DerivedCommand from '@cesium/engine/Source/Scene/DerivedCommand.js';
import DrawCommand from '@cesium/engine/Source/Renderer/DrawCommand.js';
import ShaderSource from '@cesium/engine/Source/Renderer/ShaderSource.js';
import GlobeFS from '@cesium/engine/Source/Shaders/GlobeFS.js';
import GlobeVS from '@cesium/engine/Source/Shaders/GlobeVS.js';
import AtmosphereCommon from '@cesium/engine/Source/Shaders/AtmosphereCommon.js';
import GroundAtmosphere from '@cesium/engine/Source/Shaders/GroundAtmosphere.js';
import SceneMode from '@cesium/engine/Source/Scene/SceneMode.js';

export function terrainPrograms(){
  const attributes={position3DAndHeight:0,textureCoordAndEncodedNormals:1,geodeticSurfaceNormal:2};
  const context={webgl2:true,textureFloatLinear:true,floatingPointTexture:true,
    shaderCache:{
      getShaderProgram:options=>({...options,_attributeLocations:options.attributeLocations}),
      getDerivedShaderProgram:()=>undefined,
      createDerivedShaderProgram:(_parent,_name,options)=>options,
    }};
  const surface=new GlobeShaders(),atmosphere=[AtmosphereCommon,GroundAtmosphere];
  surface.baseVertexShaderSource=new ShaderSource({sources:[...atmosphere,GlobeVS]});
  surface.baseFragmentShaderSource=new ShaderSource({sources:[...atmosphere,GlobeFS]});
  const encoding={quantization:0,getAttributeLocations:()=>attributes};
  const chunks=[],lookup=new Map(),programs=[];
  function split(source){
    return source.split('#line 0').map(segment=>{
      if(!lookup.has(segment)){lookup.set(segment,chunks.length);chunks.push(segment);}
      return lookup.get(segment);
    });
  }
  for(const textures of [2,3,4,6,1,7,8,5]){
    for(const night of [false,true]){
      for(const fog of [false,true]){
        for(const underground of (night&&!fog?[false,true]:[false])){
          const shaderProgram=surface.getShaderProgram({
            frameState:{context,mode:SceneMode.SCENE3D},surfaceTile:{renderedMesh:{encoding}},
            numberOfDayTextures:textures,applyBrightness:night,enableLighting:night,hasVertexNormals:night,
            dynamicAtmosphereLighting:true,showGroundAtmosphere:true,enableFog:fog,showUndergroundColor:underground,
          });
          const derived=DerivedCommand.createLogDepthCommand(new DrawCommand({shaderProgram}),context).command.shaderProgram;
          const vertex=split(derived.vertexShaderSource.createCombinedVertexShader(context));
          const fragment=split(derived.fragmentShaderSource.createCombinedFragmentShader(context));
          programs.push({night,vertex,fragment});
        }
      }
    }
  }
  return {attributes,chunks,programs};
}

export async function writeTerrainPrograms(destination){
  const file=gzipSync(Buffer.from(JSON.stringify(terrainPrograms())),{level:9});
  const existing=await readFile(destination).catch(()=>undefined);
  if(!existing?.equals(file))await writeFile(destination,file);
}
