import * as THREE from 'three';
import type { Box } from './geo';
import { inRing, type Woodland } from './woodland';

/** Rasterize forest geometry once on the GPU; canopy shading costs one texture read. */
export function buildWoodlandTexture(renderer: THREE.WebGLRenderer, polygons: Woodland[], box: Box) {
  const vertices: number[] = [];
  for (const polygon of polygons) for (const ring of polygon.outer) {
    const outer = ring.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z));
    const holes = polygon.holes.filter(h => inRing(h[0][0], h[0][1], ring)).map(h => h.slice(0, -1).map(([x,z]) => new THREE.Vector2(x,z)));
    const points = [...outer, ...holes.flat()];
    for (const triangle of THREE.ShapeUtils.triangulateShape(outer, holes)) for (const i of triangle) vertices.push(points[i].x, points[i].y, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,depthTest:false,toneMapped:false});
  const mesh = new THREE.Mesh(geo,material);
  const camera = new THREE.OrthographicCamera(box[0],box[2],box[3],box[1],.1,10);
  camera.position.z=1;
  const target = new THREE.WebGLRenderTarget(1024,1024,{depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  const previous = renderer.getRenderTarget(), color = renderer.getClearColor(new THREE.Color()), alpha=renderer.getClearAlpha();
  renderer.setRenderTarget(target); renderer.setClearColor(0,1); renderer.clear(); renderer.render(mesh,camera);
  renderer.setRenderTarget(previous); renderer.setClearColor(color,alpha);
  geo.dispose(); material.dispose();
  return target.texture;
}
