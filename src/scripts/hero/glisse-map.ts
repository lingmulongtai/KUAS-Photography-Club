// Adapted from Glisse by Kelvin Zhang (MIT), refraction.ts at 61c1f6c.
// License: licenses/glisse-MIT.txt. The scene itself is never copied or read back.

const MAX_PIXELS = 40_000;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Glisse's glass profile and rim map, at one sample per CSS pixel. */
export function glassMap(width: number, height: number, radius: number) {
  width = Math.round(width); height = Math.round(height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(radius) || width < 1 || height < 1 || width * height > MAX_PIXELS) return null;
  radius = clamp(radius, 0, Math.min(width, height) / 2);
  const bezel = clamp(Math.min(width, height) * .12, 4, 10);
  const thickness = clamp(Math.min(width, height) * .2, 8, 24);
  const samples = new Float32Array(128);
  let maximum = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = Math.max(.001, i / (samples.length - 1));
    const surface = (1 - (1 - t) ** 4) ** .25;
    const incident = Math.atan((1 - t) ** 3 / surface ** 3);
    const refracted = Math.asin(Math.sin(incident) / 1.5);
    samples[i] = Math.tan(incident - refracted) * (thickness + surface * bezel);
    maximum = Math.max(maximum, samples[i]);
  }
  const field = new Uint8ClampedArray(width * height * 4);
  const shine = new Uint8ClampedArray(field.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x + .5 - width / 2, py = y + .5 - height / 2;
    const qx = Math.abs(px) - (width / 2 - radius), qy = Math.abs(py) - (height / 2 - radius);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), length = Math.hypot(ox, oy);
    const distance = radius - (length + Math.min(Math.max(qx, qy), 0));
    const nx = length > 0 ? ox / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
    const ny = length > 0 ? oy / length * Math.sign(py) : qx > qy ? 0 : Math.sign(py);
    let shift = 0;
    if (distance >= 0 && distance < bezel) {
      const sample = distance / bezel * (samples.length - 1), lower = Math.floor(sample);
      shift = samples[lower] + (samples[Math.min(lower + 1, samples.length - 1)] - samples[lower]) * (sample - lower);
    }
    const i = (y * width + x) * 4;
    field[i] = Math.round(127.5 - nx * shift / maximum * 127.5);
    field[i + 1] = Math.round(127.5 - ny * shift / maximum * 127.5);
    field[i + 2] = 128; field[i + 3] = 255;
    const light = -(nx + ny) * Math.SQRT1_2;
    const glint = Math.max(light, 0) ** 3, reflected = Math.max(-light, 0) ** 3;
    const rim = Math.exp(-(((distance - .4) / .38) ** 2));
    const bloom = Math.exp(-((distance / (bezel * .22)) ** 2));
    shine[i] = shine[i + 1] = shine[i + 2] = 255;
    shine[i + 3] = distance >= 0 ? Math.round(clamp(rim * (.045 + .52 * glint + .2 * reflected) + bloom * .02 * glint, 0, 1) * 255) : 0;
  }
  return { width, height, field, shine, scale: maximum * 2 };
}
