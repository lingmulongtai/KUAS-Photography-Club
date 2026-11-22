"""Pack the N03 prefecture polygons into lossless, sparse textures for WebGL2.

A one-byte value identifies land ownership. Cells intersecting a border point to
a finer block. The final sample spacing is 1/32768 degree (about 2.8 x 3.4 m).
The PNGs use south-to-north rows just like the lookup grid; texelFetch reverses
the image upload's vertical flip. No IDs pass through colour interpolation.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from affine import Affine
from rasterio.features import rasterize
from shapely import STRtree, box, get_parts, intersects, prepare, union_all
from shapely.geometry import shape
from islet_mask import pack_islets

DATA = Path(__file__).resolve().parents[2] / 'public/kansai'
WEST, SOUTH, WIDTH, HEIGHT = 134, 33.75, 160, 136
SCALE, MID, FINE = 64, 32, 16
BLOCKS_PER_ROW = 128


def block_id(n):
    return (250 + (n >> 16), n % 256, (n >> 8) % 256)


def atlas(path, blocks, columns):
    height, width, _ = blocks[0].shape
    rows = (len(blocks) + columns - 1) // columns
    image = np.zeros((rows * height, columns * width, 3), dtype=np.uint8)
    for n, block in enumerate(blocks):
        x, y = n % columns * width, n // columns * height
        image[y:y+height, x:x+width] = block
    Image.fromarray(image).save(path, optimize=True)


def main():
    features = json.loads((DATA / 'prefectures.json').read_text(encoding='utf-8'))['features']
    parts = [(p, int(f['properties']['code'])) for f in features for p in get_parts(shape(f['geometry']))]
    transform = Affine.translation(WEST, SOUTH) * Affine.scale(1/SCALE)
    # Rasterizing a line with all_touched can miss a cell that just grazes its
    # corner. An exact intersection keeps those slivers and small offshore islets.
    boundary = union_all([p.boundary for p, _ in parts])
    prepare(boundary)
    row, col = np.indices((HEIGHT, WIDTH))
    boxes = box(WEST+col/SCALE, SOUTH+row/SCALE, WEST+(col+1)/SCALE, SOUTH+(row+1)/SCALE)
    edges = intersects(boundary, boxes)
    coarse = np.zeros((HEIGHT, WIDTH, 3), dtype='uint8')
    coarse[:, :, 0] = rasterize(parts, (HEIGHT, WIDTH), transform=transform, dtype='uint8')
    tree = STRtree([p for p, _ in parts])
    detail, fine = [], []
    size = MID * FINE
    for cy, cx in np.argwhere(edges):
        w, s = WEST + cx/SCALE, SOUTH + cy/SCALE
        cell = box(w, s, w+1/SCALE, s+1/SCALE)
        # Clipping before scan conversion keeps even the long Hyogo coastline inexpensive.
        rings = [(geom, parts[i][1]) for i in sorted(tree.query(cell, predicate='intersects'))
                 for geom in get_parts(parts[i][0].intersection(cell)) if geom.area > 0]
        transform = Affine.translation(w, s) * Affine.scale(1/(size*SCALE))
        pixels = rasterize(rings, (size, size), transform=transform, dtype='uint8') if rings else np.zeros((size,size), dtype='uint8')
        if pixels.min() == pixels.max():
            coarse[cy,cx] = (pixels[0,0], 0, 0)
            continue
        coarse[cy,cx] = block_id(len(detail))
        blocks = pixels.reshape(MID,FINE,MID,FINE).transpose(0,2,1,3)
        mid = np.zeros((MID,MID,3), dtype='uint8')
        mid[:,:,0] = blocks[:,:,0,0]
        for y,x in np.argwhere(blocks.min(axis=(2,3)) != blocks.max(axis=(2,3))):
            mid[y,x] = block_id(len(fine))
            # Eight 3-bit ownership samples per RGB pixel (two columns by four rows).
            codes = np.maximum(0, blocks[y,x].astype('int32')-24)
            groups = codes.reshape(4,4,8,2).transpose(0,2,1,3).reshape(4,8,8)
            bits = (groups << (3*np.arange(8))).sum(axis=2)
            fine.append(np.stack([bits, bits >> 8, bits >> 16], axis=2).astype('uint8'))
        detail.append(mid)
    assert max(len(detail), len(fine)) < 6 * 65536
    out = DATA / 'borders'
    out.mkdir(exist_ok=True)
    Image.fromarray(coarse).save(out / 'prefectures.png')
    atlas(out / 'districts.png', detail, BLOCKS_PER_ROW)
    atlas(out / 'edges.png', fine, 256)
    pack_islets(out, parts)
    print(len(detail), 'boundary cells and', len(fine), 'survey edge blocks')


if __name__ == '__main__':
    main()
