import { panoramaVisibility, type CitySurface, type Eye } from './panorama-visibility';

self.onmessage = ({ data }: MessageEvent<{ sources: CitySurface[]; eye: Eye }>) => {
  const result = panoramaVisibility(data.sources, data.eye);
  const transfer: Transferable[] = [];
  for (const surface of result) {
    if ('indices' in surface) transfer.push(surface.indices.buffer);
    else for (const batch of surface.batches) transfer.push(batch.houses.buffer, batch.indices.buffer);
  }
  self.postMessage(result, { transfer });
};
