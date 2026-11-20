import { panoramaVisibility, type CitySurface, type Eye, type PanoramaTerrain } from './panorama-visibility';

self.onmessage = ({ data }: MessageEvent<{ sources: CitySurface[]; eye: Eye; terrain?: PanoramaTerrain }>) => {
  const result = panoramaVisibility(data.sources, data.eye, data.terrain);
  const transfer: Transferable[] = [];
  for (const surface of result) {
    if ('indices' in surface) transfer.push(surface.indices.buffer);
    else for (const batch of surface.batches) transfer.push(batch.houses.buffer, batch.indices.buffer);
  }
  self.postMessage(result, { transfer });
};
