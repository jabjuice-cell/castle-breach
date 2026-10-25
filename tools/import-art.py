"""
Imports finished art from the project art folder into the game.

Sources are big transparent PNGs where the subject fills the canvas, so each
is cropped to its visible pixels and shrunk to a game-sized file. On-screen
sizes come from the renderer (the art guide's scale table), not the images.
Writes src/assets/<group>/<name> plus src/assets/aspects.json (width / height).

Usage: python3 tools/import-art.py [art folder] [--only dest,dest,...]
(--only re-imports just those destination files and keeps the rest of aspects.json.)
"""
import json
import sys
from pathlib import Path

from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith('--only')]
ONLY = next((set(a.split('=', 1)[1].split(',')) for a in sys.argv[1:] if a.startswith('--only=')), None)
ART = Path(args[0] if args else '/mnt/project-files/art')
OUT = Path(__file__).resolve().parent.parent / 'src' / 'assets'

# (source, destination, longest side in pixels). Sizes are about twice the largest
# on-screen size at 1440p, so sprites stay sharp on high-DPI screens; WebP keeps the build small.
ITEMS = [
    *[(f'sprites/{n}.png', f'sprites/{n}.webp', 512) for n in [
        'enemy-grunt', 'enemy-chucker', 'enemy-rider', 'enemy-monk', 'enemy-runner', 'defender-soldier', 'defender-archer']],
    *[(f'sprites/{n}.png', f'sprites/{n}.webp', 768) for n in [
        'enemy-ogre', 'enemy-warlord', 'enemy-catapult', 'defender-catapult']],
    ('castle/tower-crossbow.png', 'castle/tower-crossbow.webp', 768),
    ('castle/keep.png', 'castle/keep.webp', 1024),
    ('castle/town-tavern.png', 'castle/tavern.webp', 768),
    ('fx/fx-bolt.png', 'fx/bolt.webp', 256),
    ('fx/fx-enemy-bolt.png', 'fx/enemy-bolt.webp', 256),
    ('fx/fx-royal-shield.png', 'fx/royal-shield.webp', 1024),
    ('fx/fx-royal-shield-hit.png', 'fx/royal-shield-hit.webp', 1024),
    ('characters/queen-neutral.png', 'characters/queen.webp', 512),
    ('castle/wall-damage-states.png', 'castle/wall-damage-states.webp', 1024),
    *[(f'fx/fx-{n}.png', f'fx/{n}.webp', 320) for n in [
        'arrow', 'boulder', 'rock', 'stone', 'explosion', 'impact', 'shield-arc', 'fireball']],
    *[(f'icons/icon-{n}.png', f'icons/{n}.png', 128) for n in [
        'gold', 'renown', 'shield', 'slap', 'vigor', 'call-wave']],
]

# Background maps are opaque, so they go in as JPEG at a size that keeps the voxel detail.
MAPS = [
    ('maps/forest-background-hd.png', 'maps/forest.jpg', 3072),
]
# Props sheet: a 4 x 2 grid; we use the crater and the scorch mark.
PROPS = [('maps/forest-props.png', 'maps/crater.webp', 6), ('maps/forest-props.png', 'maps/scorch.webp', 7)]

aspects = {}


# Images with faint alpha noise round the subject: cropped to the pixels that really show.
NOISY = {'fx/enemy-bolt.webp'}


def visible(im: Image.Image):
    """The box round the pixels that show, ignoring faint alpha noise."""
    return im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()


def save(im: Image.Image, dest: str, side: int, box=None) -> None:
    if ONLY is not None and dest not in ONLY:
        return
    if box is None and im.mode == 'RGBA':
        box = visible(im) if dest in NOISY else im.getchannel('A').getbbox()
    if box:
        im = im.crop(box)
    scale = min(1, side / max(im.size))
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    path = OUT / dest
    path.parent.mkdir(parents=True, exist_ok=True)
    if dest.endswith('.jpg'):
        im.convert('RGB').save(path, quality=85, optimize=True)
    elif dest.endswith('.webp'):
        im.save(path, quality=88, method=6)
    else:
        im.save(path, optimize=True)
    aspects[Path(dest).stem] = round(im.width / im.height, 4)
    print(f'{dest}: {im.size}')


for src, dest, side in ITEMS:
    save(Image.open(ART / src).convert('RGBA'), dest, side)
# The shield's hit flash is drawn over the shield at the same size and place, so it is cut with the shield's box.
shield = Image.open(ART / 'fx/fx-royal-shield.png').convert('RGBA')
save(Image.open(ART / 'fx/fx-royal-shield-hit-overlay.png').convert('RGBA'), 'fx/royal-shield-hit-overlay.webp', 1024, shield.getchannel('A').getbbox())
# The siege tower keeps its whole canvas: every stage is drawn on the same one, and the
# renderer cuts it into floors by fixed fractions of its height.
save(Image.open(ART / 'sprites/boss/siege-tower-stage1.png').convert('RGBA'), 'sprites/siege-tower-1.webp', 1024, (0, 0, 1024, 1536))
for src, dest, side in MAPS:
    save(Image.open(ART / src).convert('RGB'), dest, side)
for src, dest, cell in PROPS:
    sheet = Image.open(ART / src).convert('RGBA')
    w, h = sheet.width // 4, sheet.height // 2
    x, y = (cell % 4) * w, (cell // 4) * h
    save(sheet.crop((x, y, x + w, y + h)), dest, 384)

if ONLY is not None:
    aspects = {**json.loads((OUT / 'aspects.json').read_text()), **aspects}
(OUT / 'aspects.json').write_text(json.dumps(aspects, indent=2) + '\n')
