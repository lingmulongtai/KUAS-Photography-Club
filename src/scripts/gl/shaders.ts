import * as THREE from 'three';

/** Cheap 2D hash for grain and dithering (Dave Hoskins). */
export const HASH = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

/** Full-screen quad: positions are already in clip space. */
export const VS_QUAD = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const VS_MESH = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export function fullscreenQuad(material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * A color whose hex value is passed to shaders unchanged.
 * Demo shaders work directly in display (sRGB) values, so skip three's sRGB → linear conversion.
 */
export function rawColor(hex: string) {
  return new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);
}
