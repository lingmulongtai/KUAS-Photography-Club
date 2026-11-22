"""Combine the licensed aerial sheets for the homepage ground sampler."""
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2] / 'public' / 'kansai' / 'expo-imagery'
meta = json.loads((root / 'index.json').read_text(encoding='utf-8'))
level = 2
width, height = meta['width'], meta['height']
cols, rows = meta['columns'] << level, meta['rows'] << level
# Retain the photographic survey's transparency at the edge of the flight.
sheet = Image.new('RGBA', (width * cols, height * rows))
for x in range(cols):
    for y in range(rows):
        tile = root / str(level) / str(x) / f'{y}.webp'
        if tile.exists():
            with Image.open(tile) as photo:
                sheet.paste(photo, (x * width, y * height))
sheet.thumbnail((3072, 2048), Image.Resampling.LANCZOS)
sheet.save(root / 'home.webp', quality=89, method=6)
