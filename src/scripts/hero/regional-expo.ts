import * as THREE from 'three';
import {TilesRenderer} from '3d-tiles-renderer/three';
import {GLTFExtensionsPlugin,UpdateOnChangePlugin} from '3d-tiles-renderer/three/plugins';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {EXPO} from '../../data/kansai-outings';
import {toLocal} from './geo';

const anchor=toLocal(EXPO.lat,EXPO.lon);

/** Orient the archive's ECEF coordinates in the existing Kyoto camera frame. */
export function expoGrounds(scene:THREE.Scene,camera:THREE.PerspectiveCamera,renderer:THREE.WebGLRenderer,prepare:(model:THREE.Object3D)=>Promise<unknown>){
  const ktx=new KTX2Loader().setWorkerLimit(2).detectSupport(renderer);
  const sets=['bldg','frn'].map(kind=>{
    const tiles=new TilesRenderer('/kansai/expo-models/'+kind+'/tileset.json');
    tiles.registerPlugin(new GLTFExtensionsPlugin({ktxLoader:ktx,meshoptDecoder:MeshoptDecoder,metadata:false,rtc:true,autoDispose:false}));
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.registerPlugin({processTileModel:prepare});
    tiles.parseQueue.maxJobs=1;
    tiles.errorTarget=kind==='bldg'?3:5;
    tiles.setCamera(camera);
    // GSI Geoid 2024 at 34.649017 N, 135.383485 E (orthometric zero).
    const frame=new THREE.Matrix4();
    tiles.ellipsoid.getEastNorthUpFrame(EXPO.lat*Math.PI/180,EXPO.lon*Math.PI/180,37.4038,frame);
    tiles.group.matrixAutoUpdate=false;
    tiles.group.matrix.makeTranslation(anchor.x,0,anchor.z)
      .multiply(new THREE.Matrix4().makeRotationX(-Math.PI/2))
      .multiply(frame.invert());
    tiles.group.matrixWorldNeedsUpdate=true;
    scene.add(tiles.group);
    tiles.group.updateMatrixWorld(true);
    return tiles;
  });
  return {
    update(){
      for(const tiles of sets){
        tiles.setResolutionFromRenderer(camera,renderer);
        tiles.update();
      }
    },
    dispose(){for(const tiles of sets){scene.remove(tiles.group);tiles.dispose();}ktx.dispose();},
  };
}
