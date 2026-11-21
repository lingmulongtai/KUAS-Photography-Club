"""Pack survey photographs for Blender. Requires Pillow in the host Python."""
import json
import sys
from pathlib import Path

from PIL import Image

SIZE = 2048
GUTTER = 4


def pack(folder, compact):
    items = json.loads((folder / "photos.json").read_text())
    rects = []
    for name, limit in items.items():
        with Image.open(folder / name) as image:
            ratio = min(1, limit / max(image.size))
            width, height = (max(1, round(v * ratio)) for v in image.size)
            rects.append((height, width, name))
    pages, shelves, positions = [], [], {}
    for h, w, name in sorted(rects, reverse=True):
        width, height = w + 2 * GUTTER, h + 2 * GUTTER
        for page, rows in enumerate(shelves):
            row = next((r for r in rows if width <= SIZE - r[0] and height <= r[2]), None)
            if row is None and rows[-1][1] + rows[-1][2] + height <= SIZE:
                row = [0, rows[-1][1] + rows[-1][2], height]
                rows.append(row)
            if row is not None:
                break
        else:
            page = len(pages)
            pages.append(Image.new("RGB", (SIZE, SIZE)))
            row = [0, 0, height]
            shelves.append([row])

        x, y = row[0] + GUTTER, row[1] + GUTTER
        row[0] += width
        with Image.open(folder / name) as source:
            photo = source.convert("RGB").resize((w, h), Image.Resampling.LANCZOS)
        # Extend boundary texels into the gutter, including all four corners.
        tile = Image.new("RGB", (width, height))
        tile.paste(photo, (GUTTER, GUTTER))
        for dst, edge in [(0, 0), (w + GUTTER, w - 1)]:
            tile.paste(photo.crop((edge, 0, edge + 1, h)).resize((GUTTER, h)), (dst, GUTTER))
        for dst, edge in [(0, GUTTER), (h + GUTTER, h + GUTTER - 1)]:
            tile.paste(tile.crop((0, edge, width, edge + 1)).resize((width, GUTTER)), (0, dst))
        pages[page].paste(tile, (x - GUTTER, y - GUTTER))
        positions[name] = [page, (x + .5) / SIZE, 1 - (y + h - .5) / SIZE,
                           (w - 1) / SIZE, (h - 1) / SIZE]
    for page, image in enumerate(pages):
        if compact:
            image = image.resize((SIZE // 2, SIZE // 2), Image.Resampling.LANCZOS)
        image.save(folder / f"district-{page}.png")
    (folder / "layout.json").write_text(json.dumps(positions))


if __name__ == "__main__":
    pack(Path(sys.argv[1]), "--compact" in sys.argv[2:])
