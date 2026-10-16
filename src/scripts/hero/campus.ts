import * as THREE from 'three';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { CAMPUS_OUTLINE, inCampus } from './geo';
import { CLASS } from './buildings-data';
import { campusArchitecture } from './campus-architecture';

/*
 * Source-backed architecture replaces the campus's coarse PLATEAU LOD1 blocks up close.
 * Geometry is built in a common floor datum, independent of basement-inclusive LOD1 heights.
 */

/** Campus buildings that get the detailed model (the plain block is hidden while it shows). */
export function isDetailed(kind: number, h: number, x: number, z: number) {
  return (kind & 3) === CLASS.sturdy && h >= 9 && inCampus(x, z);
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
        // the plaza sits on the ground: pull it toward the camera so the terrain never covers it
        if (abs(aMat-6.)<.1){ vec3 toCam = cameraPosition - p; float d = length(toCam); p += toCam / d * min(d * .003, 6.); }
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
          vec2 id = vec2(floor(u), floor(vCell.y));
          float fres = .06 + .7 * pow(clamp(1. - dot(-v, n), 0., 1.), 4.);
          vec3 refl = skyColor(reflect(v, n));
          albedo = mix(vec3(.32,.34,.34), vec3(.025, .045, .055), mull);
          emit += refl * fres * mull * .9;
          float lit = mix(step(hash12(id + 3.1), .5),.25,tiny);
          emit += vec3(1., .9, .76) * lit * mull * .9 * uCity;
        } else if (m == 2) albedo = vec3(.55, .56, .56);
        else if (m == 3) albedo = vec3(.13, .15, .16) * (.85 + .3 * vnoise(vCell * .3));
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
          albedo=vec3(.38,.47,.47);
          emit=skyColor(reflect(v,n))*.25;
        }
        else if (m == 9) albedo=vec3(.28,.16,.09);
        else if (m == 10) albedo=vec3(.12,.19,.075);
        else if (m == 11) albedo=vec3(.15,.18,.19);
        else if (m == 12) albedo=vec3(.67,.68,.65);
        else if (m == 13){albedo=vec3(.7,.66,.5);emit=vec3(1.,.77,.42)*uCity;}
        vec3 col = shade(albedo, n, vWorld, sh);
        gl_FragColor = vec4(applyHaze(col, emit * uHighlight, vWorld), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.visible = false;
  return { mesh, count: 4 };
}

/** Trees along the inside of the campus edge, as tree positions for the forest layer. */
export function campusTreeSpots(hf: Heightfield) {
  const spots: { x: number; y: number; z: number }[] = [];
  const p = CAMPUS_OUTLINE;
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[(i + 1) % p.length];
    const len = Math.hypot(bx - ax, bz - az);
    for (let t = 4; t < len - 4; t += 9) {
      const x = ax + ((bx - ax) * t) / len;
      const z = az + ((bz - az) * t) / len;
      // step a few metres inward toward the middle
      const ix = x + (-3755 - x) * 0.04;
      const iz = z + (-700 - z) * 0.04;
      spots.push({ x: ix, y: hf.height(ix, iz), z: iz });
    }
  }
  return spots;
}
