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

args = [a for a in sys.argv[1:] if not a.startswith('--')]
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


# The town's buildings: a 3 x 2 sheet (tavern, alchemist, blacksmith / chapel, forge), each drawn at its own angle.
# Each cell is cropped to its pixels plus a small transparent margin. `--town-only` runs just this step.
TOWN_SHEET = Path(__file__).resolve().parents[2] / 'output' / 'imagegen' / 'town-buildings-sheet-v2.png'
TOWN_KINDS = ['tavern', 'alchemist', 'blacksmith', 'chapel', 'forge']


def import_town():
    sheet = Image.open(TOWN_SHEET).convert('RGBA')
    w, h = sheet.width // 3, sheet.height // 2
    for i, kind in enumerate(TOWN_KINDS):
        cell = sheet.crop(((i % 3) * w, (i // 3) * h, (i % 3 + 1) * w, (i // 3 + 1) * h))
        x0, y0, x1, y1 = cell.getchannel('A').getbbox()
        m = 12
        box = (max(0, x0 - m), max(0, y0 - m), min(w, x1 + m), min(h, y1 + m))
        save(cell.crop(box), f'sprites/town-{kind}.webp', 768, (0, 0, box[2] - box[0], box[3] - box[1]))


if '--town-only' in sys.argv:
    aspects = {**json.loads((OUT / 'aspects.json').read_text())}
    import_town()
    (OUT / 'aspects.json').write_text(json.dumps(aspects, indent=2) + '\n')
    sys.exit()

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
# The townsfolk: a 4 x 2 sheet of eight characters who walk about the base.
TOWNSFOLK = Image.open(ART / 'sprites/townsfolk-sheet.png').convert('RGBA')
for cell in range(8):
    w, h = TOWNSFOLK.width // 4, TOWNSFOLK.height // 2
    x, y = (cell % 4) * w, (cell // 4) * h
    save(TOWNSFOLK.crop((x, y, x + w, y + h)), f'sprites/townsfolk-{cell + 1}.webp', 256)


# ---- Batch 7 (25 Oct): the bosses' break states, capsules, the powder barrel, the angry Queen, the courtyard.
for kind in ['grog', 'banner', 'flask', 'gauntlet', 'tea', 'trick']:
    save(Image.open(ART / f'sprites/capsule-{kind}.png').convert('RGBA'), f'fx/capsule-{kind}.webp', 256)
save(Image.open(ART / 'sprites/prop-powder-barrel.png').convert('RGBA'), 'sprites/powder-barrel.webp', 256)
save(Image.open(ART / 'fx/fx-barrel-explosion.png').convert('RGBA'), 'fx/barrel-explosion.webp', 512)
save(Image.open(ART / 'fx/fx-scorch.png').convert('RGBA'), 'maps/scorch-blast.webp', 512)
save(Image.open(ART / 'characters/queen-angry.png').convert('RGBA'), 'characters/queen-angry.webp', 512)
# Siege tower stages keep their whole canvas (the renderer bottom-aligns each on its wheels).
for n in range(1, 7):
    save(Image.open(ART / f'sprites/boss/siege-tower-stage{n}.png').convert('RGBA'), f'sprites/siege-tower-stage{n}.webp', 768, (0, 0, 1024, 1536))
# The goblin who was pushing it all along: two poses side by side.
reveal = Image.open(ART / 'sprites/boss/siege-tower-reveal.png').convert('RGBA')
for i in range(2):
    save(reveal.crop((i * reveal.width // 2, 0, (i + 1) * reveal.width // 2, reveal.height)), f'sprites/goblin-push-{i + 1}.webp', 384)
# The warlord's stages share one canvas too, so his feet stay put as his armour comes off.
for n in range(1, 5):
    save(Image.open(ART / f'sprites/boss/warlord-stage{n}.png').convert('RGBA'), f'sprites/warlord-stage{n}.webp', 768, (0, 0, 1024, 1024))
save(Image.open(ART / 'sprites/boss/warlord-reveal.png').convert('RGBA'), 'sprites/warlord-reveal.webp', 512)


def cells(src, cols, rows):
    sheet = Image.open(ART / src).convert('RGBA')
    w, h = sheet.width // cols, sheet.height // rows
    return [sheet.crop(((i % cols) * w, (i // cols) * h, (i % cols + 1) * w, (i // cols + 1) * h)) for i in range(cols * rows)]


# Physics pieces: the siege tower's debris (4 x 2) and its planks (3 x 2: plank and iron brick, intact to splintered).
for i, im in enumerate(cells('fx/fx-siege-debris.png', 4, 2)):
    save(im, f'fx/siege-debris-{i}.webp', 192)
for i, im in enumerate(cells('sprites/boss/siege-tower-planks.png', 3, 2)):
    save(im, f'fx/plank-{i}.webp', 160)
# The warlord's 14 plates are laid out loosely: each is cut out as its own blob of pixels.
plates = Image.open(ART / 'sprites/boss/warlord-plates.png').convert('RGBA')
small = plates.resize((plates.width // 8, plates.height // 8))
mask = [[small.getpixel((x, y))[3] > 40 for x in range(small.width)] for y in range(small.height)]
seen = set()
blobs = []
for y0 in range(small.height):
    for x0 in range(small.width):
        if not mask[y0][x0] or (x0, y0) in seen:
            continue
        stack, pts = [(x0, y0)], []
        seen.add((x0, y0))
        while stack:
            x, y = stack.pop()
            pts.append((x, y))
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < small.width and 0 <= ny < small.height and mask[ny][nx] and (nx, ny) not in seen:
                    seen.add((nx, ny))
                    stack.append((nx, ny))
        if len(pts) > 20:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            blobs.append((min(xs) * 8, min(ys) * 8, (max(xs) + 1) * 8, (max(ys) + 1) * 8))
blobs.sort(key=lambda b: (b[1] // 300, b[0]))
for i, box in enumerate(blobs):
    save(plates.crop(box), f'fx/plate-{i}.webp', 160)
print('warlord plates:', len(blobs))
save(Image.open(ART / 'maps/courtyard-ground.png').convert('RGB'), 'maps/courtyard.jpg', 1024)

import_town()
if ONLY is not None:
    aspects = {**json.loads((OUT / 'aspects.json').read_text()), **aspects}
(OUT / 'aspects.json').write_text(json.dumps(aspects, indent=2) + '\n')
