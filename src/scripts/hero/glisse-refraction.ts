// Adapted from Glisse by Kelvin Zhang (MIT), refraction.ts at 61c1f6c.
// License: licenses/glisse-MIT.txt. The scene itself is never copied or read back.

import { glassMap } from './glisse-map.ts';
export { glassMap } from './glisse-map.ts';

const SVG = 'http://www.w3.org/2000/svg';
const MAX_LENSES = 8;

type Lens = { filter: SVGFilterElement; filterValue: string; rim: string; users: number };
const lenses = new Map<string, Lens>();
let defs: SVGDefsElement | undefined;
let nextId = 0;

function svg(name: string, attributes: Record<string, string | number>) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function canvasMaps(width:number,height:number,radius:number){
  const map = glassMap(width, height, radius);
  if (!map) return null;
  const canvas = document.createElement('canvas');
  canvas.width = map.width; canvas.height = map.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(map.width, map.height);
  image.data.set(map.field); context.putImageData(image, 0, 0);
  const displacement = canvas.toDataURL();
  image.data.set(map.shine); context.putImageData(image, 0, 0);
  const rim = canvas.toDataURL();
  return {width:map.width,height:map.height,scale:map.scale,displacement,rim};
}

type Maps=NonNullable<ReturnType<typeof canvasMaps>>;
async function createMaps(width:number,height:number,radius:number):Promise<Maps|null>{
  if(typeof Worker==='function' && typeof OffscreenCanvas==='function'){
    let worker:Worker|undefined;
    try{
      worker=new Worker(new URL('./glisse-map.worker.ts',import.meta.url),{type:'module'});
      return await new Promise<Maps|null>((resolve,reject)=>{
        worker!.onmessage=({data}:{data:{maps:Maps|null;error?:string}})=>data.error?reject(new Error(data.error)):resolve(data.maps);
        worker!.onerror=()=>reject(new Error('Glass map worker unavailable'));
        worker!.postMessage({width,height,radius});
      });
    }catch{ /* Older browsers can still render the lens through a canvas on the page. */ }
    finally{worker?.terminate();}
  }
  return canvasMaps(width,height,radius);
}

function makeLens(map:Maps):Lens{
  const {displacement,rim}=map;
  if (!defs?.isConnected) {
    const root = svg('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
    root.style.cssText = 'position:absolute;pointer-events:none';
    defs = svg('defs', {}) as SVGDefsElement;
    root.append(defs); document.body.append(root);
  }
  const id = `kuas-glisse-${nextId++}`;
  const box = { x: 0, y: 0, width: map.width, height: map.height };
  const filter = svg('filter', { id, ...box, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }) as SVGFilterElement;
  filter.append(svg('feImage', { href: displacement, ...box, preserveAspectRatio: 'none', result: 'field' }));
  filter.append(svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'field', scale: map.scale, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }));
  filter.append(svg('feGaussianBlur', { in: 'bent', stdDeviation: .4, result: 'displaced' }));
  filter.append(svg('feColorMatrix', { in: 'displaced', type: 'saturate', values: 1.5 }));
  defs.append(filter);
  return { filter, filterValue: `url("#${id}")`, rim: `url("${rim}")`, users: 0 };
}

/** Apply a bounded, cached lens; SVG backdrop filters are supported by Chromium. */
export function mountGlassRefraction(element: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-transparency: reduce)');
  const chromium = /Chrom(?:e|ium)\//.test(navigator.userAgent);
  let active: Lens | undefined;
  let timer = 0;
  let idle = 0;
  let stopped = false,revision=0;
  const release = () => {
    if (active) active.users--;
    active = undefined;
    element.style.removeProperty('--glisse-filter');
    element.style.removeProperty('--glisse-rim');
    delete element.dataset.glisseRefraction;
  };
  const fit = async () => {
    const current=revision;
    idle = 0;
    if (stopped || reduced.matches || !element.isConnected) { release(); return; }
    const width = element.offsetWidth, height = element.offsetHeight;
    if (!width || !height) { release(); return; }
    const corner = getComputedStyle(element).borderTopLeftRadius;
    const radius = corner.endsWith('%') ? Math.min(width, height) * parseFloat(corner) / 100 : parseFloat(corner);
    const key = `${width}:${height}:${radius}`;
    let lens = lenses.get(key);
    if (!lens) {
      const maps=await createMaps(width,height,radius).catch(()=>null);
      if(stopped || current!==revision || !element.isConnected || reduced.matches)return;
      if(!maps){release();return;}
      lens=lenses.get(key);
      if(!lens){
        if (lenses.size >= MAX_LENSES) {
          const unused = [...lenses].find(([, value]) => value.users === 0);
          if (!unused) { release(); return; }
          unused[1].filter.remove(); lenses.delete(unused[0]);
        }
        try {
          lens = makeLens(maps);
        } catch {
          release();
          return;
        }
        lenses.set(key, lens);
      }
    }
    if (active !== lens) { release(); active = lens; lens.users++; }
    element.style.setProperty('--glisse-filter', lens.filterValue);
    element.style.setProperty('--glisse-rim', lens.rim);
    element.dataset.glisseRefraction = 'ready';
  };
  const cancel = () => { revision++;clearTimeout(timer); if (idle && 'cancelIdleCallback' in window) cancelIdleCallback(idle); idle = 0; };
  const schedule = () => {
    cancel();
    if (!chromium || reduced.matches || !CSS.supports('backdrop-filter', 'url("#x")')) { release(); return; }
    timer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) idle = requestIdleCallback(fit, { timeout: 1000 });
      else fit();
    }, 180);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  reduced.addEventListener('change', schedule);
  schedule();
  return () => { stopped = true; cancel(); observer.disconnect(); reduced.removeEventListener('change', schedule); release(); };
}
