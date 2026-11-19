import sharp from 'sharp';
import {fileURLToPath} from 'node:url';

// Derivatives of the existing 3D preview; retain the source JPEG and all photography.
const brand=new URL('../public/brand/',import.meta.url);
for(const width of [640,960,1250]){
  const output=new URL(`kyoto-preview-${width}.webp`,brand);
  await sharp(fileURLToPath(new URL('kyoto-thumbnail.jpg',brand)))
    .resize({width,withoutEnlargement:true}).webp({quality:82,effort:5}).toFile(fileURLToPath(output));
  console.log(fileURLToPath(output));
}
