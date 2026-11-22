import * as THREE from 'three';
import {loadBinary, loadJSON} from './data';
import {ENV_GLSL, SHADOW_GLSL, type Env} from './env';
import {ROAD_GLSL} from './roads';
import type {buildTerrain} from './terrain';
import {BANK, PADDY, RELIEF_CELL, groundSheet, readGroundSheet, type GroundFeature, type GroundIndex} from './ground-relief-data';
import {addBank, addField, addPaddyBanks, GroundGeometry, type Elevation} from './ground-relief-geometry';
import {createFieldInteriors} from './field-interiors';
import {yieldTask} from './task-yield';

type RoadUniforms = Pick<ReturnType<typeof buildTerrain>['uniforms'],
  'uRoads'|'uRoadBox'|'uRoadsOn'|'uRegionRoads'|'uRegionRoadBox'|'uRegionRoadsOn'>;

function groundMaterial(env: Env, roads: RoadUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, uRoads:roads.uRoads, uRoadBox:roads.uRoadBox, uRoadsOn:roads.uRoadsOn,
      uRegionRoads:roads.uRegionRoads, uRegionRoadBox:roads.uRegionRoadBox, uRegionRoadsOn:roads.uRegionRoadsOn },
    side: THREE.DoubleSide, transparent: true, forceSinglePass: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: /* glsl */ `
      attribute vec4 aSurface;
      uniform float uSpring;
      uniform float uSnow;
      varying vec4 vSurface;
      varying vec3 vWorld;
      void main(){
        vWorld = position;
        vSurface = aSurface;
        if(aSurface.x>6.5)vWorld.y-=.28*max(uSpring,uSnow);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld,1.);
      }`,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SHADOW_GLSL}
      ${ROAD_GLSL}
      varying vec4 vSurface;
      varying vec3 vWorld;
      void main(){
        vec2 p=vWorld.xz;
        float kind=vSurface.x, seed=vSurface.y, across=vSurface.z;
        float dist=length(cameraPosition-vWorld);
        vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
        float shadow=sunShadow(vWorld,n);
        Road rd=roadAt(p);
        float coverage=smoothstep(.12,.9,min(rd.edge,rd.rail));
        float farFade=kind<2.5 ? 1.-smoothstep(1800.,2350.,dist) : 1.-smoothstep(960.,1320.,dist);
        float ridgeFade=1.-smoothstep(225.,360.,dist);
        bool row=kind>3.5 && kind<4.5;
        float alpha=coverage*((row||kind>6.5)?ridgeFade:farFade);
        float fp=max(length(dFdx(p)),length(dFdy(p)));
        float line=cos(6.2831853*across/3.15)*(1.-smoothstep(.65,2.,fwidth(across)));
        float rowGap=abs(fract(across/2.45+.5)-.5)*2.45;
        float aa=max(.025,fwidth(across)*.65);
        float plants=1.-smoothstep(.28-aa,.45+aa,rowGap);
        float along=vSurface.w;
        float alongAA=max(.025,fwidth(along)*.65);
        float clump=1.-smoothstep(.61-alongAA,.76+alongAA,abs(fract(along/1.8+seed)-.5)*1.8);
        if(kind>6.5)alpha*=mix(.76,clump,1.-smoothstep(.3,1.,fp))*(1.-uSnow*.97);
        if(alpha<.005)discard;
        float grain=mix(.5,vnoise((floor(p/1.3)+.5)*.67),1.-smoothstep(.5,2.,fp));
        float soilTone=vnoise(p*.047);
        vec3 col;
        if(kind<1.5){
          vec3 leaves=mix(vec3(.107,.182,.055),vec3(.21,.27,.083),seed);
          leaves=mix(leaves,vec3(.32,.235,.082)*(.83+.25*seed),uAutumn);
          vec3 wet=mix(vec3(.11,.135,.093),vec3(.18,.205,.164),seed);
          col=mix(leaves,wet,uSpring*.82);
          col=mix(col,vec3(.176,.134,.082),uSnow*.72);
          float stripe=mix(.37,plants,1.-smoothstep(.38,1.35,fp));
          col*=.89+.16*stripe+.07*(soilTone-.5);
        }else if(kind<2.5){
          col=mix(vec3(.134,.086,.052),vec3(.244,.174,.093),seed)*(.91+.10*line+.13*soilTone);
        }else if(kind<3.5){
          col=mix(vec3(.158,.176,.069),vec3(.252,.237,.123),seed)*(.81+.29*grain);
        }else if(kind<4.5){
          col=mix(vec3(.167,.105,.059),vec3(.26,.18,.096),seed)*(.85+.18*grain+.10*soilTone);
        }else if(kind<5.5){
          col=mix(vec3(.122,.122,.103),vec3(.29,.256,.181),.44*grain+.56*soilTone);
        }else if(kind<6.5){
          col=mix(vec3(.161,.175,.091),vec3(.278,.256,.151),soilTone)*(.9+.18*grain);
        }else{
          col=mix(vec3(.135,.215,.052),vec3(.224,.297,.077),seed);
          col=mix(col,vec3(.319,.243,.070),uAutumn);
          col*=.89+.19*grain;
        }
        col*=.76+.24*max(n.y,0.);
        vec3 lit=shade(seasonalSurface(col,n,vWorld),n,vWorld,shadow);
        if(kind<1.5 && uSpring>.01){
          vec3 view=normalize(vWorld-cameraPosition);
          float fresnel=.025+.14*pow(1.-clamp(-view.y,0.,1.),3.);
          lit+=skyColor(reflect(view,vec3(0.,1.,0.)))*fresnel*uSpring;
        }
        gl_FragColor=vec4(applyHaze(lit,vec3(0.),vWorld),alpha);
      }`,
  });
}

interface Cell {
  key: string;
  cx: number;
  cz: number;
  layer: 'surface'|'edges'|'rows';
  distance: number;
  sheet: ReturnType<typeof groundSheet>;
}

/** A camera can cross sheets during a fetch. Keep only current cells, keep
 * their inputs in a bounded cache, and build them in short main-thread tasks. */
export function createGroundRelief(env: Env, roads: RoadUniforms, ground: Elevation, bankGround: Elevation, fieldsChanged: () => void,prepare:(mesh:THREE.Object3D)=>Promise<unknown>) {
  const group = new THREE.Group();
  group.name = 'ground-relief';
  const material = groundMaterial(env,roads);
  // Link against the actual HDR pass while the survey downloads, before exposing its first field.
  // Three includes the presence of the position attribute in its shader-program key.
  // Warm the field variant that the first real patch will draw.
  const layout=new THREE.BufferGeometry();
  layout.setAttribute('position',new THREE.Float32BufferAttribute([],3));
  layout.setAttribute('aSurface',new THREE.Float32BufferAttribute([],4));
  const program=prepare(new THREE.Mesh(layout,material)).finally(()=>layout.dispose());
  const sheets = new Map<string, ReturnType<typeof readGroundSheet>>();
  const failed = new Map<string,number>();
  const fields=createFieldInteriors();
  let notifyFields: ReturnType<typeof setTimeout> | undefined;
  const visible = new Map<string, THREE.Mesh|null>();
  let index: GroundIndex | undefined, desired = new Map<string,Cell>(), running=false;
  let lastX=Infinity,lastZ=Infinity, retryAt=Infinity, manifestRetry=0;

  async function build(cell: Cell) {
    const sheet = cell.sheet;
    let data = sheets.get(sheet.key);
    if (!data) data = readGroundSheet(await loadBinary('ground-relief/'+sheet.key+'.bin'),sheet.x,sheet.z);
    sheets.delete(sheet.key);
    sheets.set(sheet.key,data);
    if (sheets.size>12) sheets.delete(sheets.keys().next().value!);
    if (!desired.has(cell.key)) return;
    const out = new GroundGeometry();
    const parcels:GroundFeature['paths'][]=[];
    let deadline = performance.now()+4;
    for (const feature of data.features(sheet.cell)) {
      if(cell.layer==='edges') {
        if(feature.kind===BANK)addBank(out,feature,bankGround);
        if(feature.kind===PADDY)addPaddyBanks(out,feature,ground);
      } else if(feature.kind!==BANK) {
        addField(out,feature,ground,cell.layer==='rows',false);
        if(cell.layer==='surface')parcels.push(feature.paths);
      }
      if (performance.now()>=deadline) {
        await yieldTask();
        if (!desired.has(cell.key)) return;
        deadline=performance.now()+4;
      }
    }
    await program;
    if(!desired.has(cell.key))return;
    const geometry=out.geometry();
    const mesh=geometry ? new THREE.Mesh(geometry,material) : null;
    if(mesh) {
      mesh.name='ground-'+cell.layer;
      // Ground writes depth before additive lights and falling snow are blended.
      mesh.renderOrder=cell.layer==='surface'?-3:cell.layer==='edges'?-2:-1;
      group.add(mesh);
    }
    visible.set(cell.key,mesh);
    if(cell.layer==='surface' && fields.addCell(cell.key,parcels)){
      clearTimeout(notifyFields);
      notifyFields=setTimeout(fieldsChanged,350);
    }
  }

  async function pump() {
    if (running || performance.now()<manifestRetry) return;
    running=true;
    try {
      index ??= await loadJSON<GroundIndex>('ground-relief/index.json');
      for (;;) {
        const now=performance.now();
        const cell=[...desired.values()].find(c=>!visible.has(c.key) && (failed.get(c.sheet.key)??0)<=now);
        if (!cell) return;
        try {
          await build(cell);
          failed.delete(cell.sheet.key);
        } catch(error) {
          failed.set(cell.sheet.key,performance.now()+5000);
          console.warn('Ground sheet unavailable: '+cell.sheet.key,error);
        }
        await yieldTask();
      }
    } catch (error) {
      manifestRetry=performance.now()+5000;
      console.warn('Ground detail unavailable',error);
    } finally {
      retryAt=Math.min(Infinity,...failed.values());
      running=false;
    }
  }

  function update(x: number, z: number) {
    if (!index) { void pump(); return; }
    if (Math.abs(x-lastX)<48 && Math.abs(z-lastZ)<48) {
      if (performance.now()>=retryAt) { retryAt=Infinity; void pump(); }
      return;
    }
    lastX=x; lastZ=z;
    const cells: Cell[]=[];
    const radius=2450;
    for(let cx=Math.floor((x-radius)/RELIEF_CELL); cx<=Math.floor((x+radius)/RELIEF_CELL); cx++){
      for(let cz=Math.floor((z-radius)/RELIEF_CELL); cz<=Math.floor((z+radius)/RELIEF_CELL); cz++){
        const sheet=groundSheet(cx,cz);
        if (!index[sheet.key]?.includes(sheet.cell)) continue;
        const dx=Math.max(0,cx*RELIEF_CELL-x,x-(cx+1)*RELIEF_CELL);
        const dz=Math.max(0,cz*RELIEF_CELL-z,z-(cz+1)*RELIEF_CELL);
        const distance=Math.hypot(dx,dz);
        if (distance>radius) continue;
        const key=cx+','+cz;
        cells.push({key,cx,cz,sheet,distance,layer:'surface'});
        if (distance<1400) cells.push({key:key+'/edges',cx,cz,sheet,distance:distance+16,layer:'edges'});
        if (distance<445) cells.push({key:key+'/rows',cx,cz,sheet,distance:distance+32,layer:'rows'});
      }
    }
    cells.sort((a,b)=>a.distance-b.distance);
    desired=new Map(cells.map(c=>[c.key,c]));
    for(const key of failed.keys()) if (!cells.some(c=>c.sheet.key===key)) failed.delete(key);
    for(const [key,mesh] of visible) if (!desired.has(key)) {
      if(mesh){group.remove(mesh);mesh.geometry.dispose();}
      visible.delete(key);
    }
    void pump();
  }
  return {group,update,containsField:fields.contains};
}
