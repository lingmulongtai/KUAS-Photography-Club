"""A closer GSI photo of the Muko streets and rail yard in the western basin."""
import json
from pathlib import Path

from PIL import Image
from build_basin_atlas import balance, neutral_ground, photo
from build_higashiyama import save
from common import OUT

BOX = (-7950, 4250, -2500, 10350)


if __name__ == '__main__':
    size = (2048, 2048)
    path = Path(OUT, 'terrain.json')
    meta = json.loads(path.read_text(encoding='utf-8'))
    with Image.open(Path(OUT, meta['aerialCity']['file'])) as city:
        image = balance(photo(BOX, 16, size), neutral_ground(city.convert('RGB')))
    entry = {'box': BOX, 'zoom': 16}
    for target, pixels, name, budget in [
        (entry, image, 'aerial-otokuni.webp', 920000),
        (entry.setdefault('mobile', {}), image.resize((1024, 1024), Image.Resampling.LANCZOS),
         'aerial-otokuni-mobile.webp', 265000),
    ]:
        _, count = save(pixels, name, budget)
        target.update(file=name, size=pixels.size, bytes=count)
    meta['otokuni'] = entry
    path.write_text(json.dumps(meta, indent=1) + '\n', encoding='utf-8')
