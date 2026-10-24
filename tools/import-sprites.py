"""
Imports finished sprites from the art folder into the game.

Each source is a 1024 x 1024 transparent PNG where the unit fills the canvas,
so it is cropped to its visible pixels and shrunk to a game-sized PNG. Unit
sizes come from the scale table in the renderer, not from the image size.

Usage: python3 tools/import-sprites.py [art/sprites folder]
"""
import json
import sys
from pathlib import Path

from PIL import Image

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '/mnt/project-files/art/sprites')
OUT = Path(__file__).resolve().parent.parent / 'src' / 'assets' / 'sprites'
# Longest side in pixels; big units get more so they stay crisp on screen.
MAX_SIDE = {'enemy-ogre': 384, 'enemy-warlord': 384, 'enemy-catapult': 384}
DEFAULT_SIDE = 256

OUT.mkdir(parents=True, exist_ok=True)
aspects = {}
for src in sorted(SRC.glob('*.png')):
    im = Image.open(src).convert('RGBA')
    box = im.getchannel('A').getbbox()
    if not box:
        continue
    im = im.crop(box)
    side = MAX_SIDE.get(src.stem, DEFAULT_SIDE)
    scale = side / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    im.save(OUT / src.name, optimize=True)
    aspects[src.stem] = round(im.width / im.height, 4)
    print(f'{src.name}: {im.size}')

(OUT / 'aspects.json').write_text(json.dumps(aspects, indent=2) + '\n')
