import * as THREE from 'three';
import { ENV_GLSL, type Env } from './env';
import { lightSpriteGeometry, LIGHT_SPRITE_FRAGMENT, LIGHT_SPRITE_VERTEX } from './light-sprites';
import { AMBER_SECONDS, GREEN_SECONDS, HALF_CYCLE, type Approach } from './traffic-signals';

export function buildSignalHeads(approaches: readonly Approach[], width: readonly number[],
  height: (x: number, z: number) => number, uniforms: Env & { uScale: { value: number }; uDpr: { value: number } }) {
  const group = new THREE.Group();
  if (!approaches.length) return group;
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vWorld, vNormal, vColor;
      void main(){
        vWorld = (instanceMatrix * vec4(position, 1.)).xyz;
        vNormal = normalize(mat3(instanceMatrix) * normal);
        vColor = instanceColor;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }`,
    fragmentShader: `${ENV_GLSL}
      varying vec3 vWorld, vNormal, vColor;
      void main(){ gl_FragColor = vec4(applyHaze(shade(vColor, normalize(vNormal), vWorld, 1.), vec3(0.), vWorld),1.); }`,
  });
  // Posts, cantilevers, the housing and a stop line across the inbound lanes.
  const structures = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, approaches.length * 4);
  const fixture = new THREE.Object3D(), colour = new THREE.Color();
  let count = 0;
  function box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, tint: number) {
    fixture.position.set(x, y, z); fixture.scale.set(sx, sy, sz); fixture.rotation.y = yaw;
    fixture.updateMatrix();
    structures.setMatrixAt(count, fixture.matrix); structures.setColorAt(count++, colour.setHex(tint));
  }

  const positions: number[] = [], directions: number[] = [], phaseAspect: number[] = [];
  for (const arm of approaches) {
    const { x, z, dx, dz } = arm;
    const lx = -dz, lz = dx, yaw = Math.atan2(-lz, lx);
    const half = width[arm.rank] / 2, curb = half + .7, overLane = half * .62;
    const headX = x - dx * 3 + lx * overLane, headZ = z - dz * 3 + lz * overLane;
    const poleX = x - dx * 3 + lx * curb, poleZ = z - dz * 3 + lz * curb;
    const ground = height(poleX, poleZ), level = ground + 4.8;
    box(poleX, ground + 2.45, poleZ, .14, 4.9, .14, yaw, 0x656b68);
    box((poleX + headX) / 2, level, (poleZ + headZ) / 2, curb - overLane, .10, .10, yaw, 0x727878);
    box(headX, level, headZ, 1.13, .42, .25, yaw, 0x253530);
    const lineX = x + dx * arm.line + lx * half * .51, lineZ = z + dz * arm.line + lz * half * .51;
    box(lineX, height(lineX,lineZ) + .19, lineZ, half * .92, .045, .49, yaw, 0xe0ddd1);
    for (let aspect = 0; aspect < 3; aspect++) {
      positions.push(headX + dx * .153 + lx * (1 - aspect) * .35, level, headZ + dz * .153 + lz * (1 - aspect) * .35);
      directions.push(dx, dz); phaseAspect.push(arm.phase, aspect);
    }
  }
  structures.name = 'traffic-signal-posts-and-stop-lines';
  const inst = (values: number[], size: number) => new THREE.InstancedBufferAttribute(new Float32Array(values), size);
  const geo = lightSpriteGeometry(inst(positions, 3));
  geo.setAttribute('aFacing', inst(directions, 2)); geo.setAttribute('aPhaseAspect', inst(phaseAspect, 2));
  const lights = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `${ENV_GLSL}
      ${LIGHT_SPRITE_VERTEX}
      attribute vec2 aFacing, aPhaseAspect;
      varying vec3 vColor;
      void main(){
        float t = mod(uTime + aPhaseAspect.x, ${(2 * HALF_CYCLE).toFixed(1)});
        float aspect = t < ${GREEN_SECONDS.toFixed(1)} ? 0. : (t < ${(GREEN_SECONDS + AMBER_SECONDS).toFixed(1)} ? 1. : 2.);
        vec4 mv = viewMatrix * vec4(aLightPosition,1.);
        float size = .37 * uScale / (uDpr * max(-mv.z,.01));
        float pixels = clamp(size * 2., 2., 24.);
        float facing = smoothstep(.03,.45,dot(vec3(aFacing.x,0.,aFacing.y), normalize(cameraPosition - aLightPosition)));
        vec3 lamp = aspect < .5 ? vec3(.025,1.,.48) : (aspect < 1.5 ? vec3(1.,.53,.008) : vec3(1.,.027,.009));
        float lit = abs(aspect - aPhaseAspect.y) < .5 ? 1. : 0.;
        vColor = lamp * (2.6 + 2.2*uCity) * facing * lit * clamp(size*size,.006,1.) * hazeTransmittance(aLightPosition);
        gl_Position = lightSprite(mv,pixels);
      }`,
    fragmentShader: LIGHT_SPRITE_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  // Sprite centres live in an instanced attribute; the quad's base bounds are at the origin.
  lights.frustumCulled = false; lights.name = 'traffic-signal-lenses';
  group.add(structures, lights);
  return group;
}
