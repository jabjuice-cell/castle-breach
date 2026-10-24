"""
Imports finished art from the project art folder into the game.

Sources are big transparent PNGs where the subject fills the canvas, so each
is cropped to its visible pixels and shrunk to a game-sized file. On-screen
sizes come from the renderer (the art guide's scale table), not the images.
Writes src/assets/<group>/<name> plus src/assets/aspects.json (width / height).

Usage: python3 tools/import-art.py [art folder]
"""
import json
import sys
from pathlib import Path

from PIL import Image

ART = Path(sys.argv[1] if len(sys.argv) > 1 else '/mnt/project-files/art')
OUT = Path(__file__).resolve().parent.parent / 'src' / 'assets'

# (source, destination, longest side in pixels)
ITEMS = [
    *[(f'sprites/{n}.png', f'sprites/{n}.png', 256) for n in [
        'enemy-grunt', 'enemy-chucker', 'enemy-rider', 'enemy-monk', 'defender-soldier', 'defender-archer']],
    *[(f'sprites/{n}.png', f'sprites/{n}.png', 384) for n in [
        'enemy-ogre', 'enemy-warlord', 'enemy-catapult', 'defender-catapult']],
    ('castle/tower-crossbow.png', 'castle/tower-crossbow.png', 384),
    ('castle/wall-damage-states.png', 'castle/wall-damage-states.png', 640),
    *[(f'fx/fx-{n}.png', f'fx/{n}.png', 160) for n in [
        'arrow', 'boulder', 'rock', 'stone', 'explosion', 'impact', 'shield-arc']],
    *[(f'icons/icon-{n}.png', f'icons/{n}.png', 96) for n in [
        'gold', 'renown', 'shield', 'slap', 'vigor', 'call-wave']],
]

# Background maps are opaque, so they go in as JPEG at a size that keeps the voxel detail.
MAPS = [('maps/forest-background.png', 'maps/forest.jpg'), ('maps/forest-background-worn.png', 'maps/forest-worn.jpg')]
# Props sheet: a 4 x 2 grid; we use the crater and the scorch mark.
PROPS = [('maps/forest-props.png', 'maps/crater.png', 6), ('maps/forest-props.png', 'maps/scorch.png', 7)]

aspects = {}


def save(im: Image.Image, dest: str, side: int) -> None:
    box = im.getchannel('A').getbbox() if im.mode == 'RGBA' else None
    if box:
        im = im.crop(box)
    scale = min(1, side / max(im.size))
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    path = OUT / dest
    path.parent.mkdir(parents=True, exist_ok=True)
    if dest.endswith('.jpg'):
        im.convert('RGB').save(path, quality=85, optimize=True)
    else:
        im.save(path, optimize=True)
    aspects[Path(dest).stem] = round(im.width / im.height, 4)
    print(f'{dest}: {im.size}')


for src, dest, side in ITEMS:
    save(Image.open(ART / src).convert('RGBA'), dest, side)
for src, dest in MAPS:
    save(Image.open(ART / src).convert('RGB'), dest, 1400)
for src, dest, cell in PROPS:
    sheet = Image.open(ART / src).convert('RGBA')
    w, h = sheet.width // 4, sheet.height // 2
    x, y = (cell % 4) * w, (cell // 4) * h
    save(sheet.crop((x, y, x + w, y + h)), dest, 192)

(OUT / 'aspects.json').write_text(json.dumps(aspects, indent=2) + '\n')
