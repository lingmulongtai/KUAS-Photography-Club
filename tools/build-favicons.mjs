import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// Resize the complete existing mark; preserve its crop, colors and transparency.
const brand = new URL('../public/brand/', import.meta.url);
const image = sharp(fileURLToPath(new URL('mark-512.webp', brand)));
const { width, height } = await image.metadata();
if (!width || width !== height || width < 96) {
  throw new Error('The favicon source must be square and at least 96 pixels wide.');
}
const output = fileURLToPath(new URL('favicon-96.png', brand));
await image.resize(96, 96, { fit: 'inside', withoutEnlargement: true })
  .png({ compressionLevel: 9 }).toFile(output);
console.log(output);
