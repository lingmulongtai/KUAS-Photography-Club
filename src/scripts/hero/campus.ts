import * as THREE from 'three';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { CAMPUS_OUTLINE, inCampus } from './geo';
import { CLASS } from './buildings-data';
import { campusArchitecture, CampusBuilder, CAMPUS_TREES } from './campus-architecture';

/*
 * Source-backed architecture replaces the campus's coarse PLATEAU LOD1 blocks up close.
 * Geometry is built in a common floor datum, independent of basement-inclusive LOD1 heights.
 */

/** Campus buildings that get the detailed model (the plain block is hidden while it shows). */
export function isDetailed(kind: number, h: number, x: number, z: number) {
  const futureCenter=h>=7 && x < -3838 && z < -759;
  return inCampus(x,z) && (futureCenter || ((kind & 3)===CLASS.sturdy && h>=9 && x < -3680));
}

export function buildCampus(env: Env, hf: Heightfield) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const mat: number[] = [];
  const cell: number[] = [];
  // the plaza: the campus outline, paved
  const plaza = CAMPUS_OUTLINE.map(([x, z]) => new THREE.Vector2(x, z));
  for (const t of THREE.ShapeUtils.triangulateShape(plaza, [])) {
    const [a, b, c] = t.map((k) => plaza[k]);
    const tri = [a, b, c].map((p) => [p.x, hf.height(p.x, p.y) + 0.25, p.y]);
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (const v of cross < 0 ? tri : [tri[0], tri[2], tri[1]]) {
      pos.push(...v);
      nrm.push(0, 1, 0);
      mat.push(6);
      cell.push(v[0], v[2]);
    }
  }

  const architecture=campusArchitecture(hf.height(-3755,-700)+.25);
  for(const [target,name] of [[pos,'position'],[nrm,'normal'],[mat,'aMat'],[cell,'aCell']] as const)
    for(const value of architecture.getAttribute(name).array)target.push(value);
  architecture.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
  geo.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 2));
  const mesh=createCampusMesh(env,geo);
  mesh.visible=false;
  return {mesh,count:4};
}

/** The same architectural material and transparent guardrails serve both campuses. */
export function createCampusMesh(env:Env,geo:THREE.BufferGeometry){
  // Sort the draw ranges once, so glass guardrails use depth-tested transparency without
  // putting the opaque building into the transparent render queue. Two static draw calls.
  const opaque:number[]=[],glass:number[]=[];
  const mat=geo.getAttribute('aMat').array;
  for(let i=0;i<mat.length;i++)(mat[i]===8?glass:opaque).push(i);
  const indices=new Uint32Array(opaque.length+glass.length);indices.set(opaque);indices.set(glass,opaque.length);
  geo.setIndex(new THREE.BufferAttribute(indices,1));
  geo.addGroup(0,opaque.length,0);geo.addGroup(opaque.length,glass.length,1);
  geo.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    uniforms: env,
    vertexShader: /* glsl */ `
      attribute float aMat;
      attribute vec2 aCell;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vMat;
      varying vec2 vCell;
      void main(){
        vWorld = position;
        vNormal = normal;
        vMat = aMat;
        vCell = aCell;
        vec3 p = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${SHADOW_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vMat;
      varying vec2 vCell;
      void main(){
        vec3 n = normalize(vNormal);
        float sh = sunShadow(vWorld, n);
        vec2 cellWidth = max(fwidth(vCell),vec2(.001));
        vec3 v = normalize(vWorld - cameraPosition);
        int m = int(vMat + .5);
        vec3 albedo = vec3(.58, .52, .42);
        vec3 emit = vec3(0.);
        if (m == 1){
          // glass: mullions every 1.6 m, sky reflection by day, lit rooms at night
          float u = vCell.x / 1.6;
          float fw=cellWidth.x/1.6;
          float mull = smoothstep(.04-fw,.04+fw,fract(u)) * (1.-smoothstep(.96-fw,.96+fw,fract(u)));
          float tiny=smoothstep(.12,.35,fw);
          mull=mix(mull,.92,tiny);
          vec2 id = vec2(floor(u), floor(vCell.y/4.));
          float fres = .06 + .7 * pow(clamp(1. - dot(-v, n), 0., 1.), 4.);
          vec3 refl = skyColor(reflect(v, n));
          albedo = mix(vec3(.32,.34,.34), vec3(.025, .045, .055), mull);
          emit += refl * fres * mull * .9;
          float lit = mix(step(hash12(id + 3.1), .5),.25,tiny);
          emit += vec3(1., .9, .76) * lit * mull * .9 * uCity;
        } else if (m == 2) albedo = vec3(.55, .56, .56);
        else if (m == 3){
          float seam=abs(fract(vCell.x/.45)-.5),fw=fwidth(vCell.x/.45);
          float line=1.-smoothstep(.015-fw,.015+fw,seam);
          line=mix(line,.03,smoothstep(.1,.4,fw));
          albedo = vec3(.13, .15, .16) * (.95 + .1 * vnoise(vCell * .3))*(1.-line*.2);
        }
        else if (m == 4) albedo = vec3(.42, .43, .43);
        else if (m == 5) albedo = vec3(.43,.46,.47);
        else if (m == 6){
          // paving: big light slabs with fine joints
          vec2 g = fract(vCell / 3.);
          vec2 fw=cellWidth/3.;
          float joint = smoothstep(.015-fw.x,.015+fw.x,g.x) * smoothstep(.015-fw.y,.015+fw.y,g.y);
          joint=mix(joint,.98,smoothstep(.08,.25,max(fw.x,fw.y)));
          albedo = vec3(.44, .43, .41) * (.85 + .15 * joint) * (.9 + .2 * vnoise(vCell * .2));
        }
        else if (m == 7){
          vec2 brick=vec2(vCell.x/.23+mod(floor(vCell.y/.075),2.)*.5,vCell.y/.075);
          vec2 fw=fwidth(brick),g=fract(brick);
          float joint=smoothstep(.04-fw.x,.04+fw.x,g.x)*smoothstep(.07-fw.y,.07+fw.y,g.y);
          joint=mix(joint,.9,smoothstep(.2,.7,max(fw.x,fw.y)));
          albedo=vec3(.61,.55,.44)*mix(.83,1.,joint);
        }
        else if (m == 8){
          albedo=vec3(.22,.32,.33);
          emit=skyColor(reflect(v,n))*.35;
        }
        else if (m == 9) albedo=vec3(.28,.16,.09);
        else if (m == 10) albedo=vec3(.12,.19,.075);
        else if (m == 11) albedo=vec3(.15,.18,.19);
        else if (m == 12) albedo=vec3(.67,.68,.65);
        else if (m == 13){albedo=vec3(.7,.66,.5);emit=vec3(1.,.77,.42)*uCity;}
        else if (m == 14) albedo=vec3(.18,.29,.1)*(.92+.16*vnoise(vCell*1.5));
        vec3 col = shade(albedo, n, vWorld, sh);
        gl_FragColor = vec4(applyHaze(col, emit * uHighlight, vWorld), m==8?.22:1.);
      }
    `,
  });
  const guardrail=material.clone();guardrail.uniforms=env;
  guardrail.transparent=true;guardrail.depthWrite=false;guardrail.side=THREE.DoubleSide;guardrail.forceSinglePass=true;
  const mesh = new THREE.Mesh(geo, [material,guardrail]);
  mesh.userData.depthMaterial=new THREE.ShaderMaterial({
    vertexShader:`attribute float aMat;varying float vMat;void main(){vMat=aMat;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying float vMat;void main(){if(abs(vMat-8.)<.1)discard;gl_FragColor=vec4(1.);}`,
  });
  return mesh;
}

/** Source-backed planting positions, clear of the architecture and the central stair axis. */
export function campusTreeSpots(hf: Heightfield) {
  const frame=new CampusBuilder(0);
  return CAMPUS_TREES.map(([u,v])=>{
    const [x,,z]=frame.point([u,0,v]);
    return {x,y:hf.height(x,z),z};
  });
}
