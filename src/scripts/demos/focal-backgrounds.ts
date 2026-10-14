import * as THREE from 'three';

/** Real depth layers make compression visible as the camera backs away with a longer lens. */
export function buildFocalBackgrounds(renderer: THREE.WebGLRenderer) {
  const forest = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: '#514737', roughness: 1 });
  const greens = ['#315747', '#496e51', '#638262'].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  for (let row = 0; row < 4; row++) {
    for (let i = -4; i <= 4; i++) {
      const x = i * 1.3 + row * .23;
      const z = -1.5 - row * 2.3;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.065, .095, 2.5, 10), bark);
      trunk.position.set(x, 1.25, z);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(.85, 14, 10), greens[(i + row + 6) % 3]);
      crown.position.set(x, 2.65 + (i % 2) * .15, z);
      crown.scale.set(1, 1.2, .9);
      forest.add(trunk, crown);
    }
  }
  const night = new THREE.Group();
  const building = new THREE.MeshStandardMaterial({ color: '#15272f', roughness: .9 });
  for (let row = 0; row < 3; row++) {
    for (const side of [-1, 1]) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.4, 4 + row, 2.4), building);
      block.position.set(side * (2.1 + row * .2), 2 + row * .5, -2.5 - row * 4);
      night.add(block);
    }
  }
  const positions: number[] = [], colors: number[] = [];
  for (let i = 0; i < 72; i++) {
    const z = -1.5 - Math.floor(i / 12) * 3;
    positions.push(((i * 17) % 13 - 6) * .38, .8 + (i % 5) * .43, z);
    const c = new THREE.Color(i % 4 === 0 ? '#69c1ce' : i % 4 === 1 ? '#ffba70' : '#ffefcf');
    colors.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const range = renderer.getContext().getParameter(renderer.getContext().ALIASED_POINT_SIZE_RANGE) as Float32Array;
  const material = new THREE.ShaderMaterial({
    uniforms: { uFocus: { value: 1 }, uK: { value: 40 }, uDpr: { value: 1 }, uMax: { value: range[1] } },
    vertexShader: /* glsl */ `
      uniform float uFocus, uK, uDpr, uMax;
      attribute vec3 color;
      varying vec3 vColor;
      varying float vGain;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        float depth = max(.01, -mv.z);
        float size = clamp(3. * uDpr + uK * abs(depth - uFocus) / depth, 3., uMax);
        gl_PointSize = size;
        vColor = color;
        vGain = clamp(6. * uDpr / size, .12, 1.);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vGain;
      void main(){
        vec2 p = gl_PointCoord * 2. - 1.;
        float r = length(p);
        float glow = (1. - smoothstep(.75, 1., r)) * (.5 + .5 * exp(-r * r * 4.));
        gl_FragColor = vec4(vColor * glow * vGain, 1.);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  night.add(new THREE.Points(geo, material));
  forest.visible = night.visible = false;
  return {
    forest, night,
    update(mm: number, focusDistance: number, pixelHeight: number, dpr: number) {
      const focal = mm / 1000;
      material.uniforms.uFocus.value = focusDistance;
      material.uniforms.uK.value = focal * focal / (2.8 * Math.max(.001, focusDistance - focal)) / .024 * pixelHeight;
      material.uniforms.uDpr.value = dpr;
    },
  };
}
