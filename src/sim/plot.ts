import { defaultConfig } from './config';
import type { MetaLevels } from './meta';

/**
 * The town plot: pieces on a 15 x 6 grid beside the fixed keep, with neighbour bonuses and clashes.
 * No rendering in here. x runs 0..14 left to right; y 0 is the front row touching the castle.
 * Every number (land sizes, bonus values, search limit) is under `plot` in config.ts.
 */

export type PieceId =
  | 'archers' | 'soldiers' | 'catapult' | 'mage' | 'ballista' | 'oil' | 'spiketrap' | 'fletching' | 'drill' | 'masonry'
  | 'tavern' | 'alchemist' | 'blacksmith' | 'chapel' | 'forge' | 'warroom' | 'watchtower' | 'treasury' | 'market' | 'guild';

export const PIECE_IDS: PieceId[] = [
  'archers', 'soldiers', 'catapult', 'mage', 'ballista', 'oil', 'spiketrap', 'fletching', 'drill', 'masonry',
  'tavern', 'alchemist', 'blacksmith', 'chapel', 'forge', 'warroom', 'watchtower', 'treasury', 'market', 'guild',
];

export const PLOT_W = 15;
export const PLOT_H = 6;

export const KEEP_CELLS: [number, number][] = [];
for (let y = 0; y < 3; y++) for (let x = 6; x < 9; x++) KEEP_CELLS.push([x, y]);

export interface PieceInfo { id: PieceId; name: string; cells: [number, number][] }

/** Rows of a shape: '#' is a cell and the row is y. */
function shape(id: PieceId, name: string, rows: string[]): PieceInfo {
  const cells: [number, number][] = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') cells.push([x, y]); }));
  return { id, name, cells };
}

export const PIECES: Record<PieceId, PieceInfo> = {
  archers: shape('archers', 'Archery butts', ['####']),
  soldiers: shape('soldiers', 'Barracks', ['#.', '#.', '#.', '##']),
  catapult: shape('catapult', 'Siege workshop', ['###', '.#.']),
  mage: shape('mage', 'Mage college', ['.#.', '###', '.#.']),
  ballista: shape('ballista', 'Ballista works', ['###']),
  oil: shape('oil', 'Oil cauldrons', ['##']),
  spiketrap: shape('spiketrap', "Sapper's yard", ['.##', '##.']),
  fletching: shape('fletching', 'Fletchers', ['##', '#.']),
  drill: shape('drill', 'Drill yard', ['##', '##']),
  masonry: shape('masonry', 'Masons', ['#.', '#.', '##']),
  tavern: shape('tavern', 'The Rusty Tankard', ['###', '.#.']),
  alchemist: shape('alchemist', "Alchemist's workshop", ['##.', '.##']),
  blacksmith: shape('blacksmith', 'Blacksmith', ['.#', '.#', '##']),
  chapel: shape('chapel', 'Chapel', ['###', '.#.', '.#.']),
  forge: shape('forge', 'Siege Forge', ['##', '##', '##']),
  warroom: shape('warroom', 'War room', ['##', '##']),
  watchtower: shape('watchtower', 'Watchtower', ['#']),
  treasury: shape('treasury', 'Treasury', ['##']),
  market: shape('market', 'Market', ['#.#', '###']),
  guild: shape('guild', "Merchants' guild", ['##', '##', '#.']),
};

export interface Placed { id: PieceId; x: number; y: number; rot: 0 | 1 | 2 | 3 }
export type Layout = Placed[];

export function landBounds(land: number): { x0: number; x1: number; y0: number; y1: number } {
  const l = defaultConfig.plot.land;
  return { ...l[Math.max(0, Math.min(l.length - 1, Math.floor(land) || 0))] };
}

/** A shape turned 90 degrees clockwise (screen coordinates, y down) rot times, min x and y at 0, in row-major order. */
function rotated(id: PieceId, rot: number): [number, number][] {
  let cells = PIECES[id].cells;
  for (let i = 0; i < rot; i++) cells = cells.map(([x, y]) => [-y, x] as [number, number]);
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my] as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export function pieceCells(p: Placed): [number, number][] {
  return rotated(p.id, p.rot).map(([x, y]) => [x + p.x, y + p.y]);
}

const keepKey = new Set(KEEP_CELLS.map(([x, y]) => x + y * PLOT_W));

export function canPlace(layout: Layout, p: Placed, land: number): boolean {
  const b = landBounds(land);
  const taken = new Set<number>();
  for (const o of layout) if (o.id !== p.id) for (const [x, y] of pieceCells(o)) taken.add(x + y * PLOT_W);
  return pieceCells(p).every(([x, y]) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && !keepKey.has(x + y * PLOT_W) && !taken.has(x + y * PLOT_W));
}

export function ownedPieces(meta: MetaLevels): PieceId[] {
  return PIECE_IDS.filter((id) => (meta[id] ?? 0) > 0);
}

export function yard(meta: MetaLevels, layout: Layout): PieceId[] {
  return ownedPieces(meta).filter((id) => !layout.some((p) => p.id === id));
}

export interface Pair { a: PieceId | 'keep'; b: PieceId | 'keep'; id: string; kind: 'bonus' | 'clash'; text: string; edges: [x: number, y: number, side: 'e' | 's'][] }

type PairDef = Omit<Pair, 'edges'>;
const bonus = (id: string, a: PairDef['a'], b: PairDef['b'], text: string): PairDef => ({ a, b, id, kind: 'bonus', text });
const clash = (id: string, a: PairDef['a'], b: PairDef['b'], text: string): PairDef => ({ a, b, id, kind: 'clash', text });

/** Ids match the keys of config.plot.bonuses and config.plot.clashes. */
const PAIR_DEFS: PairDef[] = [
  bonus('blacksmithSoldiers', 'blacksmith', 'soldiers', 'Soldier companies cost 20% less gold'),
  bonus('fletchingArchers', 'fletching', 'archers', 'Archers +15% damage'),
  bonus('drillSoldiers', 'drill', 'soldiers', 'Soldiers +20% toughness'),
  bonus('tavernSoldiers', 'tavern', 'soldiers', 'Companies muster 10 more men'),
  bonus('workshopForge', 'catapult', 'forge', 'Castle catapult reloads 15% faster'),
  bonus('blacksmithBallista', 'blacksmith', 'ballista', 'Ballista bolts hit 15% harder'),
  bonus('masonryKeep', 'masonry', 'keep', 'Repairs cost 15% less'),
  bonus('chapelMasonry', 'chapel', 'masonry', 'Wall sections +10% strength'),
  bonus('spiketrapMasonry', 'spiketrap', 'masonry', 'Spike traps cost 25% less'),
  bonus('alchemistOil', 'alchemist', 'oil', 'Boiling oil burns 2 s longer'),
  bonus('alchemistMage', 'alchemist', 'mage', 'Mage blasts 15% wider'),
  bonus('watchtowerArchers', 'watchtower', 'archers', 'Archers +10% range'),
  bonus('marketTreasury', 'market', 'treasury', "+40 gold in each level's war chest"),
  bonus('marketGuild', 'market', 'guild', 'Kills pay +10% gold'),
  bonus('tavernMarket', 'tavern', 'market', 'Calling a wave early pays +25% gold'),
  clash('tavernChapel', 'tavern', 'chapel', 'Chapel mends the wall 25% slower'),
  clash('alchemistTreasury', 'alchemist', 'treasury', "-30 gold in each level's war chest"),
  clash('drillMage', 'drill', 'mage', 'Mage blasts 10% narrower'),
];

export function activePairs(layout: Layout): Pair[] {
  const cells = (id: PieceId | 'keep'): [number, number][] => {
    if (id === 'keep') return KEEP_CELLS;
    const p = layout.find((q) => q.id === id);
    return p ? pieceCells(p) : [];
  };
  const out: Pair[] = [];
  for (const d of PAIR_DEFS) {
    const cb = new Set(cells(d.b).map(([x, y]) => `${x},${y}`));
    const edges: Pair['edges'] = [];
    for (const [x, y] of cells(d.a)) {
      if (cb.has(`${x + 1},${y}`)) edges.push([x, y, 'e']);
      if (cb.has(`${x - 1},${y}`)) edges.push([x - 1, y, 'e']);
      if (cb.has(`${x},${y + 1}`)) edges.push([x, y, 's']);
      if (cb.has(`${x},${y - 1}`)) edges.push([x, y - 1, 's']);
    }
    if (edges.length) out.push({ ...d, edges });
  }
  return out;
}

export function sanitizePlot(meta: MetaLevels, layout: unknown): Layout {
  const out: Layout = [];
  if (!Array.isArray(layout)) return out;
  const land = meta.land ?? 0;
  for (const raw of layout) {
    const p = raw as Partial<Placed> | null;
    if (!p || typeof p !== 'object') continue;
    if (!PIECE_IDS.includes(p.id as PieceId) || (meta[p.id as PieceId] ?? 0) <= 0) continue;
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !(p.rot === 0 || p.rot === 1 || p.rot === 2 || p.rot === 3)) continue;
    if (out.some((o) => o.id === p.id)) continue;
    const clean: Placed = { id: p.id as PieceId, x: p.x as number, y: p.y as number, rot: p.rot };
    if (canPlace(out, clean, land)) out.push(clean);
  }
  return out;
}

/** Pieces ordered so bonus partners follow each other: biggest first, then its partners. */
function packOrder(ids: PieceId[]): PieceId[] {
  const partners = (id: PieceId) => PAIR_DEFS.filter((d) => d.kind === 'bonus' && (d.a === id || d.b === id)).map((d) => (d.a === id ? d.b : d.a));
  const left = new Set(ids);
  const order: PieceId[] = [];
  const take = (id: PieceId) => {
    if (!left.delete(id)) return;
    order.push(id);
    for (const q of partners(id)) if (left.has(q as PieceId)) take(q as PieceId);
  };
  const byWeight = [...ids].sort((a, b) => PIECES[b].cells.length - PIECES[a].cells.length || PIECE_IDS.indexOf(a) - PIECE_IDS.indexOf(b));
  for (const id of byWeight) take(id);
  return order;
}

/** The buildings that clash with this one as neighbours. */
function clashPartners(id: PieceId): string[] {
  return PAIR_DEFS.filter((d) => d.kind === 'clash' && (d.a === id || d.b === id)).map((d) => (d.a === id ? d.b : d.a));
}

/**
 * Tries to place every id round the fixed pieces on the given land; returns the new placements, or null.
 * With avoid set, no building goes down next to one it clashes with.
 */
function pack(fixed: Layout, ids: PieceId[], land: number, avoid = false): Layout | null {
  const b = landBounds(land);
  const grid = new Array<boolean>(PLOT_W * PLOT_H).fill(true);
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) grid[x + y * PLOT_W] = false;
  for (const k of keepKey) grid[k] = true;
  for (const p of fixed) for (const [x, y] of pieceCells(p)) grid[x + y * PLOT_W] = true;
  const free = grid.filter((g) => !g).length;
  const need = ids.reduce((n, id) => n + PIECES[id].cells.length, 0);
  if (need > free) return null;
  const rots = new Map<PieceId, { rot: 0 | 1 | 2 | 3; cells: [number, number][] }[]>();
  for (const id of ids) {
    const seen = new Set<string>();
    const list: { rot: 0 | 1 | 2 | 3; cells: [number, number][] }[] = [];
    for (const rot of [0, 1, 2, 3] as const) {
      const cells = rotated(id, rot);
      const key = cells.join(';');
      if (!seen.has(key)) { seen.add(key); list.push({ rot, cells }); }
    }
    rots.set(id, list);
  }
  const order = packOrder(ids);
  const used = new Set<PieceId>();
  const placed: Layout = [];
  let spare = free - need;
  let nodes = 0;
  const solve = (from: number): boolean => {
    if (used.size === order.length) return true;
    let i = from;
    while (i < grid.length && grid[i]) i++;
    if (i >= grid.length || ++nodes > defaultConfig.plot.packNodes) return false;
    const cx = i % PLOT_W;
    const cy = Math.floor(i / PLOT_W);
    for (const id of order) {
      if (used.has(id)) continue;
      for (const { rot, cells } of rots.get(id)!) {
        const ox = cx - cells[0][0];
        if (!cells.every(([x, y]) => { const px = x + ox; const py = y + cy; return px >= 0 && px < PLOT_W && py < PLOT_H && !grid[px + py * PLOT_W]; })) continue;
        if (avoid && clashesNear(id, cells.map(([x, y]) => [x + ox, y + cy]), [...fixed, ...placed])) continue;
        for (const [x, y] of cells) grid[x + ox + (y + cy) * PLOT_W] = true;
        used.add(id);
        placed.push({ id, x: ox, y: cy, rot });
        if (solve(i + 1)) return true;
        placed.pop();
        used.delete(id);
        for (const [x, y] of cells) grid[x + ox + (y + cy) * PLOT_W] = false;
      }
    }
    if (spare > 0) {
      spare--;
      grid[i] = true;
      if (solve(i + 1)) return true;
      grid[i] = false;
      spare++;
    }
    return false;
  };
  return solve(0) ? placed : null;
}

/** Would these cells for this building touch a building it clashes with? */
function clashesNear(id: PieceId, cells: [number, number][], others: Layout): boolean {
  const foes = clashPartners(id);
  const near = new Set<string>();
  for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) near.add(`${x + dx},${y + dy}`);
  return others.some((o) => foes.includes(o.id) && pieceCells(o).some(([x, y]) => near.has(`${x},${y}`)));
}

export function autoPack(meta: MetaLevels, layout: Layout = []): { layout: Layout; land: number } {
  const land0 = Math.max(0, Math.min(3, meta.land ?? 0));
  const owned = ownedPieces(meta);
  const keep = layout.filter((p) => owned.includes(p.id));
  const waiting = owned.filter((id) => !keep.some((p) => p.id === id));
  // Clashing neighbours kept apart if at all possible, then packed regardless.
  for (const avoid of [true, false]) {
    for (let land = land0; land <= 3; land++) {
      if (!keep.every((p) => canPlace(keep, p, land))) continue;
      const added = pack(keep, waiting, land, avoid);
      if (added) return { layout: [...keep, ...added], land };
    }
    for (let land = land0; land <= 3; land++) {
      const all = pack([], owned, land, avoid);
      if (all) return { layout: all, land };
    }
  }
  return { layout: keep, land: 3 };
}

export function effectiveMeta(meta: MetaLevels, layout: Layout): MetaLevels {
  const m = { ...meta };
  for (const id of PIECE_IDS) if (m[id] && !layout.some((p) => p.id === id)) m[id] = 0;
  return m;
}
