import * as THREE from 'three';

/** Camera-facing quads retain fractional pixel centres; one-pixel GL_POINTS snap as they move. */
export function lightSpriteGeometry(centres:THREE.InstancedBufferAttribute) {
  const geo=new THREE.InstancedBufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0],3));
  geo.setAttribute('aLightPosition',centres);
  geo.setIndex([0,1,2,0,2,3]);
  geo.instanceCount=centres.count;
  return geo;
}

export const LIGHT_SPRITE_VERTEX=/* glsl */ `
  attribute vec3 aLightPosition;
  uniform float uScale;
  /** device pixels per CSS pixel: sizes below are CSS pixels, so a light carries the same
   *  brightness and glow on every screen density */
  uniform float uDpr;
  varying vec2 vLightUv;
  vec4 lightSprite(vec4 mv, float pixels){
    vLightUv=position.xy*2.;
    mv.xy+=position.xy*pixels*uDpr*max(-mv.z, .01)/uScale;
    return projectionMatrix*mv;
  }
`;

export const LIGHT_SPRITE_FRAGMENT=/* glsl */ `
  varying vec3 vColor;
  varying vec2 vLightUv;
  void main(){
    float r2=dot(vLightUv,vLightUv);
    if(r2>=1. || dot(vColor,vec3(1.))<.0001) discard;
    // A wide, smoothly truncated Gaussian changes continuously across subpixel positions.
    float a=max(exp(-3.*r2)-exp(-3.),0.);
    gl_FragColor=vec4(vColor*a,1.);
  }
`;
