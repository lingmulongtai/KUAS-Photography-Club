import * as THREE from 'three';
import {TilesRenderer} from '3d-tiles-renderer/three';
import {GLTFExtensionsPlugin,UpdateOnChangePlugin} from '3d-tiles-renderer/three/plugins';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {EXPO} from '../../data/kansai-outings';
import {ENV_GLSL,type Env} from './env';
import {toLocal} from './geo';

const anchor=toLocal(EXPO.lat,EXPO.lon);

/**
 * Reinforced architectural cedar/cypress (sugi/hinoki) timber colonnade & Nuki tie-beam grid
 * aligned to the surveyed Grand Ring (inner Ø615 m, outer Ø675 m, base +7.6 m, deck +12..20 m).
 * Ensures the wooden legs remain bold, continuous and readable from every viewing angle and range
 * instead of aliasing away to sub-pixel wisps.
 */
function buildGrandRingTimber(env:Env):THREE.Mesh{
  const pos:number[]=[],nrm:number[]=[],col:number[]=[],emit:number[]=[];
  const pushBox=(
    cx:number,cy:number,cz:number,
    ux:number,uz:number, // radial unit
    tx:number,tz:number, // tangent unit
    rSize:number,ySize:number,tSize:number,
    rgb:[number,number,number],
    em:number,
  )=>{
    const hr=rSize*.5,hy=ySize*.5,ht=tSize*.5;
    const pt=(sr:number,sy:number,st:number):[number,number,number]=>[
      cx+ux*hr*sr+tx*ht*st,
      cy+hy*sy,
      cz+uz*hr*sr+tz*ht*st,
    ];
    const quad=(
      a:[number,number,number],b:[number,number,number],
      c:[number,number,number],d:[number,number,number],
      n:[number,number,number],shadeMul:number,faceEmit:number,
    )=>{
      const r=rgb[0]*shadeMul,g=rgb[1]*shadeMul,bl=rgb[2]*shadeMul;
      for(const v of [a,b,c,a,c,d]){
        pos.push(v[0],v[1],v[2]);
        nrm.push(n[0],n[1],n[2]);
        col.push(r,g,bl);
        emit.push(faceEmit);
      }
    };
    const p000=pt(-1,-1,-1),p100=pt(1,-1,-1),p110=pt(1,1,-1),p010=pt(-1,1,-1);
    const p001=pt(-1,-1,1),p101=pt(1,-1,1),p111=pt(1,1,1),p011=pt(-1,1,1);
    quad(p100,p101,p111,p110,[ux,0,uz],1.0,em);
    quad(p001,p000,p010,p011,[-ux,0,-uz],0.92,em);
    quad(p001,p101,p100,p000,[0,-1,0],0.78,em*0.4);
    quad(p010,p110,p111,p011,[0,1,0],1.08,em*0.2);
    quad(p001,p011,p111,p101,[tx,0,tz],0.96,em*0.7);
    quad(p100,p110,p010,p000,[-tx,0,-tz],0.94,em*0.7);
  };

  // Warm Japanese cedar/cypress timber tones
  const cedarPillar:[number,number,number]=[0.56,0.39,0.23];
  const cedarBeam:[number,number,number]=[0.62,0.44,0.27];
  const cedarFascia:[number,number,number]=[0.52,0.36,0.21];

  const baseY=7.5;
  const bays=108; // Iconic closely-spaced Nuki colonnade rhythm (~19 m chord along outer ring)
  const ringRadii=[308.0,317.8,327.6,337.2];
  // Outer slope rises from ~12 m at inner edge to ~20 m at outer edge above the +7.5 m Yumeshima deck.
  const ringHeights=[12.4,14.8,17.4,19.8];

  for(let i=0;i<bays;i++){
    const a0=(i/bays)*Math.PI*2;
    const a1=((i+1)/bays)*Math.PI*2;
    const amid=(a0+a1)*.5;
    const ux=Math.cos(a0),uz=Math.sin(a0);
    const tx=-uz,tz=ux;

    // 4 concentric rows of bold timber legs/columns (1.35 m thick so they never vanish at mid-range)
    for(let r=0;r<ringRadii.length;r++){
      const rad=ringRadii[r];
      const h=ringHeights[r];
      const cx=anchor.x+ux*rad,cz=anchor.z+uz*rad;
      pushBox(cx,baseY+h*.5,cz,ux,uz,tx,tz,1.38,h,1.38,cedarPillar,r===0||r===3?0.22:0.12);
    }

    // Radial Nuki tie beams linking the 4 columns at 3 vertical tiers
    const spanR=ringRadii[3]-ringRadii[0];
    const midR=(ringRadii[0]+ringRadii[3])*.5;
    for(const tier of [0.34,0.66,0.94]){
      const y=baseY+ringHeights[0]*tier+(tier>0.8?0.4:0);
      pushBox(anchor.x+ux*midR,y,anchor.z+uz*midR,ux,uz,tx,tz,spanR,0.92,0.98,cedarBeam,0.16);
    }

    // Circumferential Nuki stringers & upper eaves fascia spanning between adjacent bays
    const mx=Math.cos(amid),mz=Math.sin(amid);
    const mtx=-mz,mtz=mx;
    for(let r=0;r<ringRadii.length;r++){
      const rad=ringRadii[r];
      const chord=2*rad*Math.sin(Math.PI/bays)+0.4;
      const h=ringHeights[r];
      const isEdge=r===0||r===3;
      const tiers=isEdge?[0.34,0.66,0.95]:[0.62,0.95];
      for(const tier of tiers){
        const beamH=tier>0.9?(isEdge?1.65:1.1):0.92;
        const beamR=isEdge?1.15:0.95;
        pushBox(
          anchor.x+mx*rad,baseY+h*tier,anchor.z+mz*rad,
          mx,mz,mtx,mtz,beamR,beamH,chord,
          tier>0.9?cedarFascia:cedarBeam,
          isEdge&&tier>0.9?0.45:0.18,
        );
      }
    }
  }

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));
  geometry.setAttribute('aColor',new THREE.Float32BufferAttribute(col,3));
  geometry.setAttribute('aEmit',new THREE.Float32BufferAttribute(emit,1));
  geometry.computeBoundingSphere();

  const material=new THREE.ShaderMaterial({
    uniforms:env,
    vertexShader:/* glsl */`
      attribute vec3 aColor;
      attribute float aEmit;
      varying vec3 vWorld,vNormal,vColor;
      varying float vEmit;
      void main(){
        vWorld=(modelMatrix*vec4(position,1.)).xyz;
        vNormal=normalize(mat3(modelMatrix)*normal);
        vColor=aColor;
        vEmit=aEmit;
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
      }
    `,
    fragmentShader:/* glsl */`
      ${ENV_GLSL}
      varying vec3 vWorld,vNormal,vColor;
      varying float vEmit;
      void main(){
        vec3 n=normalize(vNormal);
        vec3 lit=shade(seasonalSurface(vColor,n,vWorld),n,vWorld,1.);
        // Warm architectural uplighting along the wooden colonnade at night.
        vec3 emit=vec3(1.,.74,.42)*vEmit*.68*uCity;
        gl_FragColor=vec4(applyHaze(lit,emit,vWorld),1.);
      }
    `,
  });
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='expo-grand-ring-timber';
  return mesh;
}

/** Orient the archive's ECEF coordinates in the existing Kyoto camera frame with uniform LOD & crisp textures. */
export function expoGrounds(scene:THREE.Scene,env:Env,camera:THREE.PerspectiveCamera,renderer:THREE.WebGLRenderer,prepare:(model:THREE.Object3D)=>Promise<unknown>){
  const ktx=new KTX2Loader().setWorkerLimit(2).detectSupport(renderer);
  const aniso=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const ringTimber=buildGrandRingTimber(env);
  scene.add(ringTimber);
  void prepare(ringTimber);

  const enhanceTile=async (model:THREE.Object3D)=>{
    model.traverse(obj=>{
      const mesh=obj as THREE.Mesh;
      if(!mesh.isMesh)return;
      const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      for(const m of mats){
        const std=m as THREE.MeshStandardMaterial;
        if(std.map){
          std.map.anisotropy=aniso;
          std.map.needsUpdate=true;
        }
        // Thin architectural canopies and the Grand Ring lattice must never cull from opposite angles.
        std.side=THREE.DoubleSide;
        // PLATEAU LOD3 tiles ship with metallicFactor=0.5 & roughness=0.3; without a PMREM envMap that
        // turns shadowed angles dark/muddy and causes wild angle-dependent brightness swings.
        if(typeof std.metalness==='number')std.metalness=0.04;
        if(typeof std.roughness==='number')std.roughness=0.86;
      }
    });
    await prepare(model);
  };
  const sets=['bldg','frn'].map(kind=>{
    const tiles=new TilesRenderer('/kansai/expo-models/'+kind+'/tileset.json');
    tiles.registerPlugin(new GLTFExtensionsPlugin({ktxLoader:ktx,meshoptDecoder:MeshoptDecoder,metadata:false,rtc:true,autoDispose:false}));
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.registerPlugin({processTileModel:enhanceTile});
    tiles.parseQueue.maxJobs=4;
    // Calibrated to the actual geometricError scale (bldg region=1.35/leaf=0.26; frn ring=6/1.75/0.45)
    // so pavilions and the entire Grand Ring refine uniformly from every viewing angle.
    tiles.loadSiblings=true;
    tiles.errorTarget=kind==='bldg'?0.55:0.45;
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
    dispose(){
      scene.remove(ringTimber);
      ringTimber.geometry.dispose();
      (ringTimber.material as THREE.Material).dispose();
      for(const tiles of sets){scene.remove(tiles.group);tiles.dispose();}
      ktx.dispose();
    },
  };
}
