/** World-anchored, full-circle vegetation candidates; sparse outer rings bound the GPU cost. */
export function* forestCells(eye: { x: number; z: number }, quality: number) {
  const bands = quality > .75 ? [[32, 650, 8], [650, 1900, 18], [1900, 4800, 48], [4800,10000,128]] : [[40, 450, 12], [450, 1500, 27], [1500, 4200, 64], [4200,10000,192]];
  for (let lod = 0; lod < bands.length; lod++) {
    const [inner, outer, step] = bands[lod];
    for (let ix = Math.floor((eye.x - outer) / step); ix <= Math.ceil((eye.x + outer) / step); ix++) {
      for (let iz = Math.floor((eye.z - outer) / step); iz <= Math.ceil((eye.z + outer) / step); iz++) {
        const seed = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
        const u = seed - Math.floor(seed);
        const v = Math.sin(seed) * 15731.7;
        const x = (ix + .1 + u * .8) * step;
        const z = (iz + .1 + (v - Math.floor(v)) * .8) * step;
        const distance = Math.hypot(x - eye.x, z - eye.z);
        if (distance >= inner && distance < outer) yield { x, z, lod, seed: u };
      }
    }
  }
}

/** Raw sRGB aerial colours: accept mixed canopy, reject pale roofs and blue water. */
export function woodland(c: number[]) {
  const [r, g, b] = c;
  return g > r * .98 && g > b * 1.06 && g - Math.min(r, b) > .025 && (r + g + b) / 3 < .62;
}
