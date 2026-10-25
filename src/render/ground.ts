/**
 * Paints the ground in a canvas: grass, the dirt road the orcs march down, the forest
 * floor under the trees, and the base's packed earth and cobbled square. Only the
 * ground: every tree, rock and wall on it is a real voxel structure now, so nothing
 * that looks solid is painted flat.
 */

export interface GroundArea {
  /** World width (centred on x = 0) and depth, and the z of the canvas's top edge. */
  worldW: number;
  worldH: number;
  minZ: number;
  /** The field's half width: the tree lines stand just outside it. */
  halfWidth: number;
  /** The painted courtyard tile (maps/courtyard), if it has loaded: cobbles and packed earth. */
  courtyard?: HTMLImageElement;
}

/** World size of one courtyard tile. */
const COURTYARD_TILE = 10;

/** The road's centre line at world z (it wanders a little), and its half width. */
export function roadAt(z: number): { x: number; half: number } {
  const y = -z;
  return { x: 2.6 * Math.sin(y * 0.07) + 1.4 * Math.sin(y * 0.023 + 1), half: 5.2 + 0.8 * Math.sin(y * 0.11 + 2) };
}

export function paintGround(ctx: CanvasRenderingContext2D, w: number, h: number, a: GroundArea): void {
  let s = 4242;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const ppu = w / a.worldW;
  const px = (x: number) => (x + a.worldW / 2) * ppu;
  const pz = (z: number) => (z - a.minZ) * ppu;
  const wx = (p: number) => p / ppu - a.worldW / 2;
  const wz = (p: number) => p / ppu + a.minZ;
  const blot = (x: number, z: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), r * ppu);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px(x) - r * ppu, pz(z) - r * ppu, r * ppu * 2, r * ppu * 2);
  };
  const hw = a.halfWidth;
  const baseZ = 2.2;

  // Grass, in big soft patches of different greens.
  ctx.fillStyle = '#6fa23c';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const tones = ['rgba(94,148,51,0.35)', 'rgba(132,182,74,0.3)', 'rgba(80,130,44,0.3)', 'rgba(150,190,80,0.22)'];
    blot(wx(rnd() * w), wz(rnd() * h), 1 + rnd() * 4, tones[Math.floor(rnd() * tones.length)]);
  }

  // The forest floor under the tree lines: darker, with fallen leaves.
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? 0 : px(hw + 0.4);
    const x1 = side < 0 ? px(-hw - 0.4) : w;
    const g = ctx.createLinearGradient(side < 0 ? x1 : x0, 0, side < 0 ? x1 - 3 * ppu : x0 + 3 * ppu, 0);
    g.addColorStop(0, 'rgba(60,92,36,0.0)');
    g.addColorStop(1, 'rgba(60,92,36,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), pz(baseZ - 1));
  }

  // The road down the middle of the field, and on past the top to the orc camp.
  const top = pz(a.minZ);
  const bottom = pz(baseZ);
  for (let p = top; p < bottom; p += 1) {
    const z = wz(p);
    const r = roadAt(z);
    const edge = r.half + Math.sin(z * 1.7) * 0.25;
    ctx.fillStyle = '#9c6b3a';
    ctx.fillRect(px(r.x - edge - 0.3), p, (edge + 0.3) * 2 * ppu, 1.2);
    ctx.fillStyle = '#c38a4f';
    ctx.fillRect(px(r.x - edge), p, edge * 2 * ppu, 1.2);
  }
  for (let i = 0; i < 1800; i++) {
    const z = a.minZ + rnd() * (baseZ - a.minZ);
    const r = roadAt(z);
    const x = r.x + (rnd() * 2 - 1) * r.half * 0.95;
    blot(x, z, 0.4 + rnd() * 1.4, rnd() < 0.5 ? 'rgba(220,170,110,0.35)' : 'rgba(140,96,52,0.3)');
  }
  // Cart ruts, worn by the supply wagons before the orcs came.
  for (const off of [-1.3, 1.3]) {
    ctx.strokeStyle = 'rgba(110,72,40,0.45)';
    ctx.lineWidth = Math.max(1, ppu * 0.28);
    ctx.beginPath();
    for (let z = a.minZ; z < baseZ; z += 0.5) {
      const r = roadAt(z);
      const x = r.x + off + Math.sin(z * 0.9) * 0.15;
      if (z === a.minZ) ctx.moveTo(px(x), pz(z));
      else ctx.lineTo(px(x), pz(z));
    }
    ctx.stroke();
  }
  // Pebbles along the road's edges.
  for (let i = 0; i < 1400; i++) {
    const z = a.minZ + rnd() * (baseZ - a.minZ);
    const r = roadAt(z);
    const side = rnd() < 0.5 ? -1 : 1;
    const x = r.x + side * (r.half - 0.4 + rnd() * 1.2);
    const v = 120 + Math.floor(rnd() * 60);
    ctx.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
    ctx.beginPath();
    ctx.ellipse(px(x), pz(z), (0.08 + rnd() * 0.16) * ppu, (0.06 + rnd() * 0.12) * ppu, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // The base behind the wall: packed earth, then a cobbled square round the keep and a street in front.
  ctx.fillStyle = '#b8966a';
  ctx.fillRect(0, pz(baseZ - 0.2), w, h - pz(baseZ - 0.2));
  for (let i = 0; i < 500; i++) blot(wx(rnd() * w), baseZ + rnd() * (a.minZ + a.worldH - baseZ), 0.5 + rnd() * 2, rnd() < 0.5 ? 'rgba(150,118,80,0.35)' : 'rgba(205,176,130,0.35)');
  const cobble = (x0: number, z0: number, x1: number, z1: number) => {
    const size = 0.5;
    for (let z = z0; z < z1; z += size * 0.8) {
      const row = Math.round((z - z0) / (size * 0.8));
      for (let x = x0 + (row % 2) * size * 0.5; x < x1; x += size) {
        const v = 150 + Math.floor(rnd() * 50);
        const warm = rnd() < 0.3 ? 14 : 0;
        ctx.fillStyle = `rgb(${v + warm},${v - 4 + warm / 2},${v - 14})`;
        ctx.beginPath();
        ctx.roundRect(px(x) + 1, pz(z) + 1, size * ppu - 2, size * 0.8 * ppu - 2, size * ppu * 0.25);
        ctx.fill();
      }
    }
  };
  const yard = a.courtyard;
  if (yard?.complete && yard.naturalWidth) {
    // The painted courtyard, mirror-tiled so its edges meet without a seam.
    const n = yard.naturalWidth;
    const tile = document.createElement('canvas');
    tile.width = tile.height = n * 2;
    const tctx = tile.getContext('2d')!;
    for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      tctx.setTransform(fx, 0, 0, fy, fx < 0 ? n * 2 : 0, fy < 0 ? n * 2 : 0);
      tctx.drawImage(yard, 0, 0);
    }
    const pattern = ctx.createPattern(tile, 'repeat')!;
    const k = (COURTYARD_TILE * ppu) / n;
    pattern.setTransform(new DOMMatrix([k, 0, 0, k, px(0), pz(7.6)]));
    ctx.fillStyle = pattern;
    ctx.fillRect(px(-12), pz(7.6), 24 * ppu, (a.minZ + a.worldH - 7.6) * ppu);
    ctx.fillRect(0, pz(21.5), w, 3.5 * ppu);
  } else {
    ctx.fillStyle = '#6e665a';
    ctx.fillRect(px(-12), pz(7.6), 24 * ppu, (a.minZ + a.worldH - 7.6) * ppu);
    ctx.fillRect(0, pz(21.5), w, 3.5 * ppu);
    cobble(-12, 7.6, 12, a.minZ + a.worldH);
    cobble(-a.worldW / 2, 21.5, a.worldW / 2, 25);
  }
  // Grass verges and flower beds in the corners of the base.
  for (let i = 0; i < 220; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    blot(side * (24 + rnd() * 16), baseZ + 3 + rnd() * 18, 0.8 + rnd() * 2, 'rgba(100,150,55,0.55)');
  }

  // Grass blades and flowers everywhere grass grows.
  for (let i = 0; i < 70000; i++) {
    const x = rnd() * w;
    const y = rnd() * pz(baseZ);
    const z = wz(y);
    const r = roadAt(z);
    if (Math.abs(wx(x) - r.x) < r.half - 0.2) continue;
    const light = rnd() < 0.5;
    ctx.fillStyle = light ? 'rgba(160,205,90,0.6)' : 'rgba(60,105,35,0.55)';
    ctx.fillRect(x, y, 1, 2 + rnd() * 3);
  }
  const flowers = ['#ffffff', '#ffe14a', '#ff8ab0', '#8ab4ff'];
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w;
    const y = rnd() * pz(baseZ);
    const z = wz(y);
    const r = roadAt(z);
    if (Math.abs(wx(x) - r.x) < r.half + 0.5) continue;
    ctx.fillStyle = flowers[Math.floor(rnd() * flowers.length)];
    ctx.fillRect(x, y, 2, 2);
  }
  // Leaf litter under the trees.
  for (let i = 0; i < 6000; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const x = side * (hw + 0.3 + rnd() * (a.worldW / 2 - hw));
    const z = a.minZ + rnd() * (baseZ - a.minZ);
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(140,100,40,0.6)' : 'rgba(90,120,40,0.6)';
    ctx.fillRect(px(x), pz(z), 2, 2);
  }
}

/** A small tiling grass texture for the land beyond the painted ground. */
export function paintOuterGrass(ctx: CanvasRenderingContext2D, size: number): void {
  let s = 99;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = '#5f8f34';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 6000; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(130,175,70,0.5)' : 'rgba(60,95,35,0.5)';
    for (const [ox, oy] of [[0, 0], [-size, 0], [0, -size]]) ctx.fillRect(x + ox, y + oy, 1, 2 + rnd() * 2);
  }
}
