import wallStatesUrl from './assets/castle/wall-damage-states.webp';
import callWaveUrl from './assets/icons/call-wave.png';
import goldUrl from './assets/icons/gold.png';
import renownUrl from './assets/icons/renown.png';
import shieldUrl from './assets/icons/shield.png';
import queenUrl from './assets/characters/queen.webp';
import queenAngryUrl from './assets/characters/queen-angry.webp';
import { queenAdvice, queenCross } from './queen';
import { BattleScene, CAPSULE_LOOK, type PlanPreview, QUALITIES, type Quality } from './render/scene';
import { Sounds } from './render/sound';
import { BUILDINGS } from './render/world';
import { DEFENDER_KINDS, type DefenderKind, type Ground, type PlacedKind, SPECIAL_NAMES, type Track, USEFUL_TRACKS, groundAt, stackAt } from './sim/defenders';
import { BUILDING_KINDS, type BuildingKind, Game, STEP } from './sim/game';
import { META_GROUPS, META_UPGRADES, type MetaGroup, type Progress, applyMeta, buyMeta, metaCost, newProgress } from './sim/meta';
import { ENEMY_KINDS, type EnemyKind, planSize } from './sim/waves';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ICONS: Record<string, string> = { gold: goldUrl, renown: renownUrl, shield: shieldUrl, call: callWaveUrl };
const icon = (name: string) => `<img class="ico" src="${ICONS[name]}" alt="" />`;
document.querySelectorAll<HTMLImageElement>('img[data-icon]').forEach((img) => (img.src = ICONS[img.dataset.icon!]));
document.documentElement.style.setProperty('--wall-states', `url(${wallStatesUrl})`);
document.querySelectorAll<HTMLImageElement>('img[data-queen]').forEach((img) => (img.src = queenUrl));

/** Per-viewer settings kept in the browser; the game works the same without them. */
function loadSetting(key: string): string | null {
  try {
    return localStorage.getItem(`castle-breach:${key}`);
  } catch {
    return null;
  }
}
function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(`castle-breach:${key}`, value);
  } catch {
    // Private windows can refuse storage; the setting just won't stick.
  }
}

const QUALITY_NAMES: Record<Quality, string> = { low: 'Low', medium: 'Medium', high: 'High' };
let quality: Quality = QUALITIES.includes(loadSetting('quality') as Quality) ? (loadSetting('quality') as Quality) : 'medium';
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = $<HTMLCanvasElement>('game');
const progress = loadProgress();
let game = newLevel();
const view = new BattleScene(canvas, game, quality);

const sounds = new Sounds();
sounds.muted = loadSetting('muted') === '1';
function showSound() {
  $('sound').textContent = sounds.muted ? 'Sound: Off' : 'Sound: On';
}
$('sound').addEventListener('click', () => {
  sounds.muted = !sounds.muted;
  sounds.unlock();
  saveSetting('muted', sounds.muted ? '1' : '0');
  showSound();
});
showSound();

function showQuality() {
  $('quality').textContent = `Detail: ${QUALITY_NAMES[quality]}`;
}
$('quality').addEventListener('click', () => {
  quality = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length];
  saveSetting('quality', quality);
  view.setQuality(quality);
  showQuality();
});
showQuality();

// Wall health bars: off unless the player turns them on.
let wallBars = loadSetting('wallBars') === '1';
function showBars() {
  $('bars').textContent = wallBars ? 'Wall bars: On' : 'Wall bars: Off';
  hud.wallBars.classList.toggle('nobars', !wallBars);
}
$('bars').addEventListener('click', () => {
  wallBars = !wallBars;
  saveSetting('wallBars', wallBars ? '1' : '0');
  showBars();
});

// Voxel orcs or painted sprites (Jonny is comparing the two).
function showOrcStyle() {
  $('orcStyle').textContent = view.orcStyle === 'voxel' ? 'Orcs: Voxel' : 'Orcs: Sprite';
}
view.orcStyle = loadSetting('orcStyle') === 'sprite' ? 'sprite' : 'voxel';
$('orcStyle').addEventListener('click', () => {
  view.orcStyle = view.orcStyle === 'voxel' ? 'sprite' : 'voxel';
  saveSetting('orcStyle', view.orcStyle);
  showOrcStyle();
});
showOrcStyle();

let running = false;

// Dev aid: ?debug exposes the live game to the console and browser tests; ?debug&auto plays the shield by itself.
const params = new URLSearchParams(location.search);
if (params.has('debug')) {
  Object.defineProperty(window, 'game', { get: () => game });
  Object.defineProperty(window, 'view', { get: () => view });
  Object.defineProperty(window, 'progress', { get: () => progress });
}
const autoplay = params.has('debug') && params.has('auto');

/** The autoplay shield: chases whatever will land first and heaves as it arrives. */
function autoShield() {
  const sy = game.cfg.shield.y;
  let best: { x: number; t: number } | null = null;
  for (const o of [...game.balls, ...game.projectiles.filter((p) => !p.friendly)]) {
    if (o.vy >= 0 || o.y < sy) continue;
    const t = (o.y - sy) / -o.vy;
    if (!best || t < best.t) best = { x: o.x + o.vx * t, t };
  }
  if (best) input.shieldX = Math.max(-game.cfg.field.halfWidth, Math.min(game.cfg.field.halfWidth, best.x + Math.sin(game.time) * 1.5));
  if ((best && best.t < 0.05) || game.balls.some((b) => b.stuck)) game.heave();
}
/** The mouse on the ground (for placing) and along the shield's line. */
const input = { x: 0, y: 30, shieldX: 0 };
/** The defender being placed after a purchase, or the one being dragged to a new spot. */
let placing: PlacedKind | null = null;
let dragging: number | null = null;

/** True while the player is choosing where to build a tower storey. */
let building = false;

/** The defender being aimed with the mouse, and its aim before, to put back on cancel. */
let aiming: { id: number; before: number | null } | null = null;

/** Where the last press on a defender started, to tell a click (open its card) from a drag (move it). */
let pressAt = { x: 0, y: 0 };

/** Defenders can be picked up and moved freely between waves; mid-battle it costs gold (hold Shift). */
const canArrange = (e?: { shiftKey: boolean }) => running && (game.shopOpen || (game.phase === 'battle' && !!e?.shiftKey));

function resize() {
  view.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// ---- input -----------------------------------------------------------------

function pointerToSim(e: PointerEvent | MouseEvent) {
  const r = canvas.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  const hit = view.pick(nx, ny);
  if (hit) {
    input.x = hit.x;
    input.y = hit.y;
  }
  const sx = view.shieldX(nx, ny);
  if (sx !== null) input.shieldX = sx;
}

/** Places the defender being bought exactly where the mouse is on the castle. */
function tryPlace(kind: PlacedKind) {
  if (game.place(kind, input.x, input.y)) {
    placing = null;
    toast(`${DEFENDER_INFO[kind].name} in position`);
    sounds.thunk();
    trayKey = '';
    return;
  }
  toast(game.canPlace(kind, input.x, input.y) ? 'Not enough gold' : whyNot(kind, input.x, input.y));
}

/** Why a defender can't stand at (x, y): off the castle grounds, or on top of another one. */
function whyNot(kind: PlacedKind, x: number, y: number): string {
  const c = game.cfg.castle;
  const hw = game.cfg.field.halfWidth - c.edge;
  if (x < -hw || x > hw || y < c.minY || y > c.maxY) return 'Put it on the castle: the wall, a tower top or the courtyard';
  return `Too close to another defender${kind === 'archers' ? ': a squad of archers needs room' : ''}`;
}

/** What standing at (x, y) does for a defender, for the label that follows the ghost. */
const GROUND_NOTE: Record<Ground, string> = {
  tower: 'Tower top: +25% range',
  wall: 'Wall walk',
  courtyard: 'Courtyard: safe, but 20% less range',
};

// On the window, so the shield and an aim keep following the mouse over the HUD panels too.
window.addEventListener('pointermove', (e) => {
  pointerToSim(e);
  hovered = e.target === canvas && !placing && !aiming && !building ? buildingAt(e) : null;
  canvas.style.cursor = hovered ? 'pointer' : '';
});

// ---- the town's buildings: click one (or press its key) for its power ----------

const POWER_KEYS: Record<string, BuildingKind> = { KeyQ: 'keep', KeyW: 'tavern', KeyE: 'alchemist' };
const POWER_KEY: Record<BuildingKind, string> = { keep: 'Q', tavern: 'W', alchemist: 'E' };
/** The building under the mouse, lit up while it's there. */
let hovered: BuildingKind | null = null;

function buildingAt(e: PointerEvent | MouseEvent): BuildingKind | null {
  const r = canvas.getBoundingClientRect();
  return view.pickBuilding(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function usePower(kind: BuildingKind) {
  if (!game.usePower(kind)) toast(`${BUILDINGS[kind].name}: ${game.whyNotPower(kind)}`);
}
canvas.addEventListener('pointerdown', (e) => {
  pointerToSim(e);
  sounds.unlock();
  if (e.button === 2) {
    if (placing) cancelPlacing();
    if (aiming) cancelAiming();
    building = false;
    return;
  }
  if (e.button !== 0) return;
  if (building) {
    const plan = game.towerPlan(input.x, input.y);
    if (game.buildTower(input.x, input.y)) {
      building = false;
      sounds.thunk();
      toast(plan.ok && plan.stack ? `Tower raised to ${plan.stack.storeys} storeys` : 'Tower built');
    } else {
      toast(plan.ok ? 'Not enough gold' : plan.why);
    }
    trayKey = '';
    return;
  }
  if (aiming) {
    // The aim follows the mouse; a click sets it.
    sounds.thunk();
    selected = aiming.id;
    aiming = null;
    return;
  }
  if (placing) {
    tryPlace(placing);
    return;
  }
  if (canArrange(e)) {
    const d = game.defenderAt(input.x, input.y);
    if (d) {
      dragging = d.id;
      pressAt = { x: input.x, y: input.y };
      return;
    }
  }
  selected = null;
  // A click on the keep, tavern or alchemist uses its power instead of heaving.
  const b = buildingAt(e);
  if (b && running) {
    usePower(b);
    return;
  }
  if (running) game.heave();
});
window.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || dragging === null) return;
  const id = dragging;
  dragging = null;
  // Barely moved: a click, which opens the defender's card.
  if (Math.hypot(input.x - pressAt.x, input.y - pressAt.y) < 0.6) {
    selected = game.shopOpen ? id : null;
    return;
  }
  const cost = game.moveCost();
  const moved = game.defenders.find((d) => d.id === id);
  if (moved && !game.move(id, input.x, input.y)) toast(game.gold < cost ? `Moving costs ${cost} gold mid-battle` : whyNot(moved.kind, input.x, input.y));
  else if (cost > 0) toast(`Moved for ${cost} gold: it packs up for a moment`);
  trayKey = '';
});

function cancelPlacing() {
  placing = null;
  trayKey = '';
}

function cancelAiming() {
  if (!aiming) return;
  const d = game.defenders.find((o) => o.id === aiming!.id);
  const h = aiming.before;
  if (d) game.aim(d.id, h === null ? null : { x: d.x + Math.sin(h) * 30, y: d.y + Math.cos(h) * 30 });
  selected = aiming.id;
  aiming = null;
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (running && !e.repeat) game.heave();
  }
  if (e.code === 'Escape') {
    if (placing) cancelPlacing();
    if (aiming) cancelAiming();
    building = false;
    selected = null;
  }
  const power = POWER_KEYS[e.code];
  if (power && running) usePower(power);
  if (e.code === 'Enter' && running) {
    e.preventDefault();
    if (game.phase === 'setup') startBattle();
    else game.callEarly();
  }
});

$('play').addEventListener('click', () => {
  sounds.unlock();
  $('intro').hidden = true;
  // A brand-new player goes straight to the first level; anyone with Renown or a run under way sees the town first.
  const fresh = progress.renown < 1 && progress.levelsBeaten === 0 && Object.keys(progress.meta).length === 0;
  if (fresh) {
    running = true;
    startTour();
  } else showTown();
});
$('startNow').addEventListener('click', () => (game.phase === 'setup' ? startBattle() : game.callEarly()));
$('callEarly').addEventListener('click', () => game.callEarly());
$('again').addEventListener('click', () => showTown());

// ---- looking up the field at the coming horde -------------------------------

/**
 * At the start of a level the camera glides up the field to the waiting horde, holds,
 * and comes back. Any click or key cuts it short. In the setup and between waves the
 * mouse wheel looks up the field and back.
 */
let tour = -1;
const TOUR = { up: 0.4, back: 3.4 };
function startTour() {
  tour = calm ? -1 : 0;
}
function updateLook(dt: number) {
  if (!running || !game.shopOpen) {
    tour = -1;
    peek = false;
  }
  if (tour >= 0) {
    tour += dt;
    if (tour > TOUR.back + 1.5) tour = -1;
  }
  const touring = tour >= TOUR.up && tour < TOUR.back;
  view.lookAhead = touring || peek ? 1 : 0;
}
let peek = false;
window.addEventListener('wheel', (e) => {
  if (!running || !game.shopOpen) return;
  peek = e.deltaY < 0;
  tour = -1;
}, { passive: true });
window.addEventListener('pointerdown', () => {
  if (tour >= 0) tour = -1;
}, { capture: true });

// ---- names -----------------------------------------------------------------

const ENEMY_NAMES: Record<EnemyKind, [string, string]> = {
  grunt: ['grunt', 'grunts'],
  chucker: ['chucker', 'chuckers'],
  barrel: ['barrel orc', 'barrel orcs'],
  runner: ['goblin runner', 'goblin runners'],
  rider: ['boar rider', 'boar riders'],
  orcCatapult: ['orc catapult', 'orc catapults'],
  ogre: ['ogre', 'ogres'],
  warlord: ['WARLORD', 'WARLORDS'],
};

const DEFENDER_INFO: Record<DefenderKind, { name: string; blurb: string }> = {
  crossbow: { name: 'Giant crossbow', blurb: 'Fires straight up its lane, piercing a column, and hunts catapults first. On a tower it also angles across into the next lanes.' },
  archers: { name: 'Archers', blurb: 'Thirty bowmen. Their cone shoots boulders out of the sky and rains volleys on the crowd. Leave a section without them and it is a blind spot.' },
  catapult: { name: 'Catapult', blurb: 'Lobs extra gold balls far up the field, but can\'t reach anything close to the wall.' },
  soldiers: { name: 'Soldier company', blurb: 'Forty soldiers hold the foot of the wall in their section and a little either side.' },
};

const TRACK_NAMES: Record<Track, string> = { damage: 'Damage', rate: 'Rate of fire', special: '' };
const LANES = ['far left', 'left', 'gate', 'right', 'far right'];

/** What each kind of orc does, for the horde preview: the special abilities to plan around. */
const ENEMY_TRICKS: Partial<Record<EnemyKind, string>> = {
  chucker: 'chuckers throw rocks, or fast bolts, as they march',
  barrel: 'barrel orcs blow up their friends, or a hole in the wall',
  runner: 'goblin runners sprint down the side lanes',
  rider: 'boar riders zig-zag down the edges',
  orcCatapult: 'catapults lob boulders: block them to get balls',
  ogre: 'ogres take a beating and stun their row when they fall',
  warlord: 'the Warlord bats balls back and hurries his orcs',
};

function trickText() {
  const t = game.plan.totals;
  const tricks = ENEMY_KINDS.filter((k) => t[k] > 0 && ENEMY_TRICKS[k]).map((k) => ENEMY_TRICKS[k]!);
  if (game.plan.tower) tricks.unshift('the siege tower drops a storey for each row of planks knocked out');
  return tricks.length ? `Watch out: ${tricks.join('; ')}.` : '';
}

function count(n: number, kind: EnemyKind) {
  return `${n} ${ENEMY_NAMES[kind][n === 1 ? 0 : 1]}`;
}

function planText() {
  const t = game.plan.totals;
  const parts = ENEMY_KINDS.filter((k) => t[k] > 0).map((k) => count(t[k], k));
  if (game.plan.tower) parts.unshift('a SIEGE TOWER');
  return parts.join(', ');
}

/** Which lanes the next wave comes down, by name. */
function laneText() {
  const lanes = [...new Set(game.plan.groups.map((g) => g.lane))].sort((a, b) => a - b);
  return lanes.length >= LANES.length ? 'every lane' : `the ${lanes.map((l) => LANES[l]).join(', ')} lane${lanes.length === 1 ? '' : 's'}`;
}

// ---- HUD -------------------------------------------------------------------

const hud = {
  wave: $('waveLabel'),
  phase: $('phaseLabel'),
  gold: $('gold'),
  kills: $('kills'),
  renown: $('renown'),
  heaveText: $('heaveText'),
  heaveBar: $('heaveBar'),
  balls: $('balls'),
  combo: $('combo'),
  effects: $('effects'),
  wallBars: $('wallBars'),
  preview: $('preview'),
  previewTitle: $('previewTitle'),
  previewText: $('previewText'),
  startNow: $('startNow'),
  callEarly: $<HTMLButtonElement>('callEarly'),
  boss: $('boss'),
  bossName: $('bossName'),
  bossBar: $('bossBar'),
  markers: $('markers'),
  placeTag: $('placeTag'),
  floaters: $('floaters'),
  flash: $('flash'),
  tray: $('tray'),
  defPop: $('defPop'),
  toast: $('toast'),
  bottom: $('bottom'),
  queen: $('queen'),
  queenText: $('queenText'),
  buildTags: $('buildTags'),
};

/** Lane markers over the spawn line while the next wave lines up: what is coming down each lane. */
/** The plan the labels were made for (the object, not its number: a restarted level plans the same wave number afresh). */
let markerPlan: object | null = null;
function updateMarkers() {
  const show = game.phase === 'preview' || game.phase === 'setup';
  if (!show) {
    if (markerPlan) hud.markers.replaceChildren();
    markerPlan = null;
    return;
  }
  // Rebuild labels once per plan, then just reposition them (the camera can move on resize/shake).
  if (markerPlan !== game.plan) {
    markerPlan = game.plan;
    hud.markers.replaceChildren(
      ...game.plan.groups.map((g) => {
        const el = document.createElement('div');
        const lead = g.members.find((m) => m.kind !== 'grunt')?.kind ?? 'grunt';
        const total = g.members.reduce((s, m) => s + m.count, 0);
        el.className = `marker ${lead}`;
        el.textContent = g.members.length === 1 && g.members[0].kind !== 'grunt' ? count(total, lead) : `${total}${g.members.some((m) => m.kind === 'orcCatapult') ? ' + catapults' : ''}`;
        return el;
      }),
    );
  }
  game.plan.groups.forEach((g, i) => {
    const p = view.project(g.x, game.cfg.field.spawnY - 4, 1.5);
    const el = hud.markers.children[i] as HTMLElement;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y - (i % 3) * 18}px`;
  });
}

/** A tag over the ghost while placing: what the ground there gives, or why it won't fit. */
function updatePlaceTag(kind: PlacedKind | undefined, ok: boolean, ignoreId: number) {
  const tag = hud.placeTag;
  if (!kind) {
    tag.hidden = true;
    return;
  }
  tag.hidden = false;
  const storeys = stackAt(game.cfg, game.stacks, input.x, input.y)?.storeys ?? 1;
  const ground = groundAt(game.cfg, input.x, input.y, game.stacks);
  const note = ground === 'tower' && storeys > 1 ? `Tower top, ${storeys} storeys: +${storeys * 25}% range` : GROUND_NOTE[ground];
  const text = ok ? note : game.canPlace(kind, input.x, input.y, ignoreId) ? 'Not enough gold' : whyNot(kind, input.x, input.y);
  if (tag.textContent !== text) tag.textContent = text;
  tag.classList.toggle('bad', !ok);
  const p = view.project(input.x, input.y, view.standHeight(input.x, -input.y) + (kind === 'crossbow' ? 5 : 3.2));
  tag.style.left = `${p.x}px`;
  tag.style.top = `${p.y}px`;
}


/** Floating text over the field: combos, capsules, line smashes. */
const floaters: { el: HTMLElement; x: number; y: number; t: number; life: number }[] = [];
function floater(text: string, x: number, y: number, cls = '', life = 1.2) {
  if (floaters.length > 16) floaters.shift()!.el.remove();
  const el = document.createElement('div');
  el.className = `floater ${cls}`;
  el.textContent = text;
  hud.floaters.appendChild(el);
  floaters.push({ el, x, y, t: 0, life });
}
function updateFloaters(dt: number) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    if (f.t >= f.life) {
      f.el.remove();
      floaters.splice(i, 1);
      continue;
    }
    const p = view.project(f.x, f.y, 3 + f.t * 3);
    const u = f.t / f.life;
    // Punch in past full size, settle, then drift up and fade.
    const pop = u < 0.08 ? 0.4 + (u / 0.08) * 1.0 : u < 0.2 ? 1.4 - ((u - 0.08) / 0.12) * 0.4 : 1;
    f.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${pop})`;
    f.el.style.opacity = String(u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
  }
}

let toastTimer = 0;
function toast(text: string) {
  hud.toast.textContent = text;
  hud.toast.hidden = false;
  toastTimer = 1.6;
}

/** Wall bars: how long the red chunk holds after a hit, and how fast it drains (share of a bar per second). */
const BAR_HOLD = 0.45;
const BAR_DRAIN = 0.5;
let wallLag: { frac: number; hold: number }[] = [];

function updateHud(dt: number) {
  const c = game.cfg;
  hud.wave.textContent = `Level ${game.level + 1} · Wave ${game.levelWave} of ${c.levels.waves}`;
  hud.phase.textContent =
    game.phase === 'setup' ? `${c.levels.names[game.level]}: setting up`
    : game.phase === 'preview' ? 'Incoming'
    : game.phase === 'battle' ? `${game.enemies.length} orcs on the field`
    : game.phase === 'won' ? 'Victory'
    : 'Breached';
  hud.gold.textContent = `${Math.floor(game.gold)} gold`;
  hud.kills.textContent = `${game.kills} slain`;
  hud.renown.textContent = `${game.renownEarned} Renown`;

  // The heave: a bar that refills after each heave.
  const s = game.shield;
  const cd = game.heaveCooldown();
  const f = game.canHeave ? 1 : Math.max(0, 1 - (s.readyAt - game.time) / cd);
  hud.heaveBar.style.transform = `scaleX(${f})`;
  hud.heaveBar.classList.toggle('locked', !game.canHeave);
  const serving = game.balls.some((b) => b.stuck);
  hud.heaveText.textContent = serving ? 'Click to serve!' : game.canHeave ? 'Heave ready' : 'Recovering';
  const best = game.balls.reduce((m, b) => Math.max(m, b.combo), 0);
  hud.balls.textContent = `${game.ballCount} ball${game.ballCount === 1 ? '' : 's'}`;
  hud.combo.textContent = best >= 2 ? `Combo ×${best}` : '';
  hud.combo.className = best >= 40 ? 'combo c40' : best >= 25 ? 'combo c25' : best >= 10 ? 'combo c10' : 'combo';
  const fx: string[] = [];
  const left = (until: number) => Math.ceil(until - game.time);
  if (game.time < game.effects.banner) fx.push(`${CAPSULE_LOOK.banner.emoji} ${left(game.effects.banner)}s`);
  if (game.time < game.effects.flask) fx.push(`${CAPSULE_LOOK.flask.emoji} ${left(game.effects.flask)}s`);
  if (game.time < game.effects.tea) fx.push(`${CAPSULE_LOOK.tea.emoji} ${left(game.effects.tea)}s`);
  if (game.time < game.effects.trick) fx.push(`${CAPSULE_LOOK.trick.emoji} ${left(game.effects.trick)}s`);
  if (game.stickyCatches > 0) fx.push(`${CAPSULE_LOOK.sticky.emoji} ×${game.stickyCatches}`);
  const fxText = fx.join('  ');
  if (hud.effects.textContent !== fxText) hud.effects.textContent = fxText;

  game.segmentHp.forEach((hp, i) => {
    const el = hud.wallBars.children[i] as HTMLElement;
    const frac = Math.max(0, hp / c.wall.segmentHp);
    const p = view.project(-c.field.halfWidth + (i + 0.5) * game.segmentWidth(), -1, 6.2);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.classList.toggle('warn', frac < c.wall.warnBelow);
    // The red chunk holds for a moment after a hit, then drains down to the yellow.
    const lag = wallLag[i] ?? { frac, hold: 0 };
    if (frac >= lag.frac) {
      lag.frac = frac;
      lag.hold = 0;
    } else if (lag.hold < BAR_HOLD) {
      lag.hold += dt;
    } else {
      lag.frac = Math.max(frac, lag.frac - dt * BAR_DRAIN);
    }
    wallLag[i] = lag;
    el.classList.toggle('hit', lag.hold > 0 && lag.hold < 0.12);
    const [red, yellow] = el.firstElementChild!.children as unknown as HTMLElement[];
    red.style.transform = `scaleX(${lag.frac})`;
    yellow.style.transform = `scaleX(${frac})`;
    // Between waves a damaged section shows what patching it costs; clicking the tag repairs it.
    const fix = el.lastElementChild as HTMLButtonElement;
    const cost = game.repairCost(i);
    fix.hidden = !(running && game.shopOpen && cost > 0);
    if (!fix.hidden) {
      const html = `Repair <span class="cost">${Math.min(cost, Math.max(1, Math.floor(game.gold)))}g</span>`;
      if (fix.innerHTML !== html) fix.innerHTML = html;
      fix.disabled = game.gold < 1;
    }
  });

  const previewing = (game.phase === 'preview' || game.phase === 'setup') && running;
  // Out of the way while the camera looks up the field at the horde.
  hud.preview.hidden = !previewing || view.lookAhead > 0;
  hud.queen.hidden = !previewing;
  if (previewing) {
    const setup = game.phase === 'setup';
    const wave = `${game.plan.boss ? 'Boss wave! ' : ''}Wave ${game.levelWave}`;
    hud.previewTitle.textContent = setup ? `Level ${game.level + 1}: ${c.levels.names[game.level]}` : `${wave} marches in ${Math.ceil(game.phaseTimer)}`;
    const tricks = trickText();
    hud.previewText.textContent = `${setup ? `${wave} brings ` : ''}${planText()}, down ${laneText()}. ${tricks}${setup || game.levelWave === 1 ? ' Scroll up to look at them.' : ''}`;
    hud.queenText.textContent = queenAdvice(game);
    const face = queenCross(game) ? queenAngryUrl : queenUrl;
    const portrait = hud.queen.querySelector('img')!;
    if (!portrait.src.endsWith(face)) portrait.src = face;
    hud.startNow.innerHTML = setup ? 'To battle! <kbd>Enter</kbd>' : `${icon('call')}Start now, +${game.earlyCallGold()} gold <kbd>Enter</kbd>`;
  }

  // Over each building: its power, its key, and a bar that refills while it rests.
  BUILDING_KINDS.forEach((kind, i) => {
    const el = hud.buildTags.children[i] as HTMLElement;
    const b = BUILDINGS[kind];
    const p = view.project(b.x, -b.z, b.top);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.hidden = !running || view.lookAhead > 0;
    if (el.hidden) return;
    const built = game.hasBuilding(kind);
    const pw = game.powers[kind];
    const t = game.powerTiming(kind);
    const live = game.powerActive(kind);
    const rest = Math.max(0, pw.readyAt - game.time);
    const ready = game.canUse(kind);
    const html = !built
      ? `${b.name}: build it in the town`
      : live
        ? `<b>${b.power}!</b> ${Math.ceil(pw.until - game.time)}s`
        : game.phase !== 'battle'
          ? `<b>${b.power}</b> <kbd>${POWER_KEY[kind]}</kbd>`
          : rest > 0
            ? `${b.power}: rests ${Math.ceil(rest)}s`
            : ready
              ? `<b>${b.power}</b> <kbd>${POWER_KEY[kind]}</kbd>`
              : `${b.power}: ${game.whyNotPower(kind)}`;
    const span = el.firstElementChild as HTMLElement;
    if (span.innerHTML !== html) span.innerHTML = html;
    el.className = `btag${!built ? ' locked' : live ? ' live' : ready ? ' ready' : ''}${hovered === kind ? ' hover' : ''}`;
    const bar = el.lastElementChild!.firstElementChild as HTMLElement;
    bar.style.transform = `scaleX(${!built ? 0 : live ? (pw.until - game.time) / t.seconds : 1 - rest / t.cooldown})`;
  });
  if (hovered) view.hoverBuilding(hovered);

  const tail = game.phase === 'battle' && game.canCallEarly();
  hud.callEarly.hidden = !tail;
  if (tail) hud.callEarly.innerHTML = `${icon('call')}Sound the horn: call wave ${game.wave + 1} now, +${game.earlyCallGold()} gold <kbd>Enter</kbd>`;

  const lord = game.enemies.find((e) => e.kind === 'warlord');
  const tower = game.tower;
  hud.boss.hidden = !lord && !tower;
  if (tower) {
    hud.bossName.textContent = `The Siege Tower: ${tower.floors.length} floor${tower.floors.length === 1 ? '' : 's'} left`;
    hud.bossBar.style.transform = `scaleX(${tower.floors.length / c.siegeTower.floors})`;
  } else if (lord) {
    hud.bossName.textContent = 'The Warlord';
    hud.bossBar.style.transform = `scaleX(${Math.max(0, lord.hp / lord.maxHp)})`;
  }

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) hud.toast.hidden = true;
  }
  hud.flash.style.opacity = String(view.flashLevel * (calm ? 0.25 : 0.6));
  hud.flash.style.setProperty('--flash', view.flashColor);
  updateMarkers();
  updateFloaters(dt);
}

// ---- the shop over the battlefield ------------------------------------------

function trackEffect(kind: DefenderKind, track: Track): string {
  const lv = game.levels[kind][track];
  if (track !== 'special') return `+${Math.round((game.mult(kind, track) - 1) * 100)}%`;
  if (kind === 'crossbow') return `pierces ${game.crossbowPierce()}`;
  if (kind === 'archers') return lv ? `burns ${game.arrowBurn().toFixed(1)}/s` : 'not lit';
  return `${Math.round(game.soldierHp())} HP each`;
}

const costBtn = (action: string, label: string, cost: number, disabled = false) =>
  `<button type="button" data-action="${action}" ${disabled || cost > game.gold ? 'disabled' : ''}>${label} <span class="cost">${Number.isFinite(cost) ? `${cost}g` : ''}</span></button>`;

/** The tray in the corner while the shop is open: defenders to buy, and the button to start. */
function trayHtml(): string {
  const gold = Math.floor(game.gold);
  const setup = game.phase === 'setup';
  const buy = DEFENDER_KINDS.map((k) => {
    if (!game.unlocked(k)) return `<button type="button" class="locked" disabled><b>${DEFENDER_INFO[k].name}</b><small>🔒 Unlock in the town</small></button>`;
    const cost = game.defenderCost(k);
    return `<button type="button" data-action="place:${k}" class="${placing === k ? 'on' : ''}" ${cost > gold ? 'disabled' : ''}><b>${DEFENDER_INFO[k].name}</b><small>${cost} gold${game.count(k) ? ` · ${game.count(k)} placed` : ''}</small></button>`;
  }).join('');
  const storey = game.storeyCost();
  const tower = `<button type="button" data-action="tower" class="${building ? 'on' : ''}" ${storey > gold ? 'disabled' : ''}><b>Tower storey</b><small>${storey} gold · on the wall, or on top of a tower</small></button>`;
  const again = setup && progress.lastLoadout.length && !game.defenders.length
    ? `<button type="button" class="again" data-action="again">Put back last level's defenders</button>`
    : '';
  const tip = building
    ? 'Click the wall walk to build a tower, or a tower to stack another storey on it (up to 3). Each storey adds 25% reach to whoever stands on top.'
    : placing
    ? 'Click the castle to put it down: the wall, a tower top or the courtyard. Right click or Esc to cancel.'
    : setup
      ? 'Spend your war chest on defenders and put them anywhere on the castle. Click one to upgrade or sell it (full refund until the battle starts); drag it to move it.'
      : 'Between waves: click a defender to upgrade it, a wall\'s Repair tag to patch it, or buy more. The next wave won\'t wait.';
  return `
    <header><h3>${setup ? 'Load-out' : 'Between waves'}</h3><span class="purse">${icon('gold')}${gold} gold</span></header>
    <div class="buy">${buy}${tower}</div>${again}
    <p class="tip">${tip}</p>
    ${setup ? '<button type="button" class="go" data-action="go">To battle! <kbd>Enter</kbd></button>' : ''}`;
}

/** The card over a clicked defender: its kind's upgrades, and selling it. */
function popHtml(d: { id: number; kind: DefenderKind }): string {
  const kind = d.kind;
  const tracks = USEFUL_TRACKS[kind]
    .map((t) => {
      const name = t === 'special' ? SPECIAL_NAMES[kind] : TRACK_NAMES[t];
      return `<div class="track"><span>${name} <i>Lv ${game.levels[kind][t]}</i><small>${trackEffect(kind, t)}</small></span>${costBtn(`up:${kind}:${t}`, 'Upgrade', game.upgradeCost(kind, t))}</div>`;
    })
    .join('');
  const plural = { crossbow: 'crossbows', archers: 'archer squads', catapult: 'catapults', soldiers: 'companies' }[kind];
  const def = game.defenders.find((o) => o.id === d.id)!;
  const aim = game.aimable(def)
    ? `<div class="track"><span>Aim<small>${def.heading === null ? 'straight ahead' : `${Math.round(Math.abs(def.heading) * 57.3)}° ${def.heading < 0 ? 'left' : 'right'}`}</small></span><span><button type="button" data-action="aim:${d.id}">Aim</button>${def.heading !== null ? ` <button type="button" data-action="unaim:${d.id}">Straight</button>` : ''}</span></div>`
    : '';
  return `<h3>${DEFENDER_INFO[kind].name}</h3><small>Upgrades apply to all your ${plural}.</small>${aim}${tracks}
    <footer><button type="button" data-action="sell:${d.id}">Sell for ${game.sellValue(d.id)}g</button><button type="button" data-action="close">Done</button></footer>`;
}

let trayKey = '';
let selected: number | null = null;
function updateShop() {
  const open = running && game.shopOpen;
  hud.tray.hidden = !open;
  if (open) {
    // Re-render only when something it shows has changed, so the buttons stay clickable.
    const key = [game.phase, Math.floor(game.gold), placing, building, game.defenders.length, progress.lastLoadout.length].join('|');
    if (key !== trayKey) {
      trayKey = key;
      hud.tray.innerHTML = trayHtml();
    }
  } else {
    trayKey = '';
  }
  const d = selected !== null && open ? game.defenders.find((o) => o.id === selected) : undefined;
  if (!d) selected = null;
  hud.defPop.hidden = !d;
  if (d) {
    const key = `${d.id}|${Math.floor(game.gold)}|${Object.values(game.levels[d.kind]).join(',')}|${game.phase}|${d.heading}`;
    if (hud.defPop.dataset.key !== key) {
      hud.defPop.dataset.key = key;
      hud.defPop.innerHTML = popHtml(d);
    }
    const p = view.project(d.x, d.y, view.standHeight(d.x, -d.y) + 3);
    hud.defPop.style.left = `${Math.min(window.innerWidth - 135, Math.max(135, p.x))}px`;
    hud.defPop.style.top = `${Math.max(250, p.y)}px`;
  }
}

function shopAction(action: string) {
  const [verb, a, b] = action.split(':');
  if (verb === 'place') {
    placing = placing === a ? null : (a as PlacedKind);
    building = false;
    selected = null;
  } else if (verb === 'tower') {
    building = !building;
    placing = null;
    selected = null;
  } else if (verb === 'up') {
    if (game.upgrade(a as DefenderKind, b as Track)) sounds.thunk();
  } else if (verb === 'sell') {
    if (game.sell(Number(a))) toast('Sold');
    selected = null;
  } else if (verb === 'close') {
    selected = null;
  } else if (verb === 'aim') {
    const d = game.defenders.find((o) => o.id === Number(a));
    if (d) aiming = { id: d.id, before: d.heading };
    selected = null;
  } else if (verb === 'unaim') {
    game.aim(Number(a), null);
  } else if (verb === 'repair') {
    const hp = game.repair(Number(a));
    if (hp > 0) {
      sounds.thunk();
      floater(`+${Math.round(hp)} wall`, -game.cfg.field.halfWidth + (Number(a) + 0.5) * game.segmentWidth(), 2, 'good', 1);
    }
  } else if (verb === 'again') {
    const n = game.restoreLoadout(progress.lastLoadout);
    toast(n < progress.lastLoadout.length ? `${n} of ${progress.lastLoadout.length} put back: the war chest ran out` : 'Defenders back in position');
  } else if (verb === 'go') {
    startBattle();
  }
  trayKey = '';
  hud.defPop.dataset.key = '';
}

function startBattle() {
  placing = null;
  selected = null;
  game.endSetup();
}

hud.buildTags.addEventListener('click', (e) => {
  const tag = (e.target as HTMLElement).closest<HTMLElement>('[data-building]');
  if (tag) usePower(tag.dataset.building as BuildingKind);
});

for (const el of [hud.tray, hud.defPop, hud.wallBars]) {
  el.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (btn && !btn.disabled) shopAction(btn.dataset.action!);
  });
}

// ---- progress, the town and the end of a level --------------------------------

/** What the player keeps between runs: Renown, the town's upgrades and how far this run has got. */
function loadProgress(): Progress {
  const p = newProgress();
  try {
    const saved = localStorage.getItem('castle-breach:progress');
    if (saved) return { ...p, ...JSON.parse(saved) };
    // Renown banked before the town existed carries over.
    p.renown = Number(localStorage.getItem('castle-breach:renown') ?? 0) || 0;
  } catch {
    // No storage: a fresh start every visit.
  }
  return p;
}
function saveProgress() {
  saveSetting('progress', JSON.stringify(progress));
}

function newLevel(): Game {
  const level = progress.levelsBeaten;
  return new Game(Math.floor(Math.random() * 1e9), applyMeta(progress.meta, level), level);
}

function startLevel() {
  game = newLevel();
  placing = null;
  dragging = null;
  selected = null;
  view.setGame(game);
  buildHud();
  $('town').hidden = true;
  $('lost').hidden = true;
  running = true;
  startTour();
}

const GROUP_NAMES: Record<MetaGroup, string> = { defence: 'Defence', wall: 'The wall', shield: 'The royal shield', town: 'The town' };

function townHtml(): string {
  const names = game.cfg.levels.names;
  const next = progress.levelsBeaten;
  const levels = names
    .map((n, i) => `<span class="${i < next ? 'done' : i === next ? 'next' : ''}">${i + 1}. ${n}</span>`)
    .join('');
  const groups = META_GROUPS.map((g) => {
    const ups = META_UPGRADES.filter((u) => u.group === g)
      .map((u) => {
        const lv = progress.meta[u.id] ?? 0;
        const cost = metaCost(progress.meta, u.id);
        const pips = u.costs.map((_, i) => (i < lv ? '◆' : '◇')).join('');
        const btn = Number.isFinite(cost)
          ? `<button type="button" data-meta="${u.id}" ${cost > progress.renown ? 'disabled' : ''}>${icon('renown')}${cost}</button>`
          : '<small>Done</small>';
        return `<div class="up"><div class="row"><b>${u.name}</b>${btn}</div><small>${u.blurb}</small><span class="pips">${pips}</span></div>`;
      })
      .join('');
    return `<section><h2>${GROUP_NAMES[g]}</h2>${ups}</section>`;
  }).join('');
  const fresh = next === 0;
  return `<div class="scroll">
    <header><div><h1>The Town</h1><p class="sub">${fresh ? 'Spend Renown on upgrades that last for ever, then march out. A run is three levels; lose one and it starts again from the first.' : `Level ${next} held! Spend your Renown, then march on to level ${next + 1}.`}</p></div>
    <span class="purse">${icon('renown')}${Math.floor(progress.renown)} Renown</span></header>
    <div class="levels">${levels}</div>
    <div class="groups">${groups}</div>
    <button type="button" class="march" data-march>March to ${names[next]}!</button>
    <p class="tag">The town itself, with its buildings and townsfolk, is coming. For now the upgrades live on this page.</p>
  </div>`;
}

function showTown() {
  running = false;
  $('lost').hidden = true;
  $('intro').hidden = true;
  const town = $('town');
  town.innerHTML = townHtml();
  town.hidden = false;
}

$('town').addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const up = el.closest<HTMLButtonElement>('button[data-meta]');
  if (up && !up.disabled && buyMeta(progress, up.dataset.meta!)) {
    saveProgress();
    sounds.chime(1);
    showTown();
  }
  if (el.closest('button[data-march]')) startLevel();
});

function showEnd(won: boolean, segment = 0) {
  const names = game.cfg.levels.names;
  progress.renown += game.renownEarned;
  const finale = won && game.level >= names.length - 1;
  if (won) {
    progress.lastLoadout = game.loadout();
    progress.levelsBeaten = finale ? 0 : game.level + 1;
  } else {
    progress.levelsBeaten = 0;
  }
  saveProgress();
  $('lostWaves').textContent = String(game.wavesSurvived);
  $('lostKills').textContent = String(game.kills);
  $('lostCombo').textContent = String(game.bestCombo);
  $('lostRenown').textContent = String(game.renownEarned);
  $('endTitle').textContent = finale ? 'The wall holds!' : won ? `${names[game.level]} held!` : 'Breached!';
  $('lostText').textContent = finale
    ? 'All three levels beaten back. The orcs are already planning something stupider. A new run starts from level 1, with every upgrade you bought.'
    : won
      ? `All ${game.cfg.levels.waves} waves of level ${game.level + 1} beaten back. On to ${names[game.level + 1]}, once you have been to the town.`
      : `The orcs broke through the ${LANES[segment] ?? ''} wall during wave ${game.levelWave} of level ${game.level + 1}. Back to the town: spend your Renown, then the next run starts from level 1.`;
  $('bank').textContent = `${Math.floor(progress.renown)} Renown to spend in the town.`;
  $('lost').hidden = false;
  running = false;
}

function buildHud() {
  wallLag = [];
  hud.wallBars.replaceChildren(
    ...game.segmentHp.map(() => {
      const el = document.createElement('div');
      el.className = 'seg';
      el.innerHTML = '<div class="bar"><b></b><i></i></div><button type="button" class="fix" hidden></button>';
      return el;
    }),
  );
  hud.buildTags.replaceChildren(
    ...BUILDING_KINDS.map((kind) => {
      const el = document.createElement('div');
      el.className = 'btag';
      el.dataset.building = kind;
      el.innerHTML = '<span></span><div class="bar"><i></i></div>';
      return el;
    }),
  );
  trayKey = '';
}
buildHud();
showBars();

/** The see-through defender under the mouse while placing or dragging one, and the planning overlay with its coverage preview. */
function updateGhost() {
  if (dragging !== null && !game.defenders.some((d) => d.id === dragging)) dragging = null;
  const planning = running && (game.shopOpen || dragging !== null);
  let preview: PlanPreview | null = null;
  const dragged = dragging !== null ? game.defenders.find((d) => d.id === dragging) : undefined;
  const kind = placing ?? dragged?.kind;
  if (aiming && !(game.shopOpen && game.defenders.some((d) => d.id === aiming!.id))) aiming = null;
  if (building && !game.shopOpen) building = false;
  if (building) {
    view.hideGhost();
    const plan = game.towerPlan(input.x, input.y);
    const ok = plan.ok && game.gold >= game.storeyCost();
    const tag = hud.placeTag;
    tag.hidden = false;
    tag.classList.toggle('bad', !ok);
    const text = !plan.ok ? plan.why : !ok ? 'Not enough gold' : plan.stack ? `Raise to ${plan.stack.storeys + 1} storeys: +${(plan.stack.storeys + 1) * 25}% reach on top` : 'Build a tower here';
    if (tag.textContent !== text) tag.textContent = text;
    const p = view.project(input.x, input.y, view.standHeight(input.x, -input.y) + 1);
    tag.style.left = `${p.x}px`;
    tag.style.top = `${p.y}px`;
    canvas.style.cursor = 'copy';
  } else if (aiming) {
    // Turn it to face the mouse as it moves; the coverage overlay follows.
    game.aim(aiming.id, { x: input.x, y: input.y });
    view.hideGhost();
    const d = game.defenders.find((o) => o.id === aiming!.id)!;
    const tag = hud.placeTag;
    tag.hidden = false;
    tag.classList.remove('bad');
    const text = `Click to aim ${DEFENDER_INFO[d.kind].name.toLowerCase()} · right click to cancel`;
    if (tag.textContent !== text) tag.textContent = text;
    const p = view.project(input.x, input.y, 1);
    tag.style.left = `${p.x}px`;
    tag.style.top = `${p.y - 10}px`;
    canvas.style.cursor = 'crosshair';
  } else if (kind) {
    const ignore = dragged?.id ?? -1;
    const gold = placing ? game.defenderCost(kind) : game.moveCost();
    const ok = game.canPlace(kind, input.x, input.y, ignore) && game.gold >= gold;
    view.setGhost(kind, input.x, input.y, ok);
    if (ok) preview = { kind, x: input.x, y: input.y };
    updatePlaceTag(kind, ok, ignore);
    canvas.style.cursor = 'none';
  } else {
    view.hideGhost();
    updatePlaceTag(undefined, false, -1);
    const hover = planning ? game.defenderAt(input.x, input.y) : undefined;
    canvas.style.cursor = hover ? 'grab' : '';
  }
  view.setPlanning(planning, preview, game.shopOpen);
  // The gold aim shape: while aiming, and for the defender whose card is open.
  const shown = aiming?.id ?? selected;
  view.showAim(running && shown !== null ? game.defenders.find((d) => d.id === shown) ?? null : null);
  // Clicks while aiming or building go through the wave banner to the field.
  hud.preview.style.pointerEvents = aiming || building || placing ? 'none' : '';
}

// ---- loop ------------------------------------------------------------------

let last = performance.now();
let acc = 0;
let hitStop = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    if (autoplay) autoShield();
    game.setShield(input.shieldX);
    // Hit-stop: the action freezes for a few frames on a big hit, so it lands with weight.
    if (hitStop > 0) hitStop -= dt;
    else acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      game.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 6) acc = 0;
    view.handleEvents(game.events);
    for (const ev of game.events) {
      switch (ev.type) {
        case 'lost':
          showEnd(false, ev.segment);
          break;
        case 'won':
          showEnd(true);
          break;
        case 'deflect':
          // A light clink for a bounce; the full clang for a heave or a trick shot off the rim.
          if (ev.parry) hitStop = Math.max(hitStop, 0.04);
          if (ev.parry || ev.trick) sounds.clang(ev.parry);
          else sounds.clink();
          if (ev.trick) floater('Trick shot!', ev.x, game.cfg.shield.y, 'trick', 0.9);
          break;
        case 'rebound':
          floater('REBOUND!', ev.x, ev.y - 3, 'rebound', 1.1);
          sounds.clink();
          break;
        case 'bank':
          floater('BANK!', ev.x, ev.y + 1, 'bank', 0.8);
          break;
        case 'hit':
          // The running combo pops off each hit; the milestones get their own big banner.
          if (ev.combo !== undefined && ev.combo >= 3 && !game.cfg.balls.comboMilestones.includes(ev.combo)) {
            floater(`${ev.combo} COMBO`, ev.x, ev.y, ev.combo >= 10 ? 'chain hot' : 'chain', 0.7);
          }
          break;
        case 'wallHit':
          if (ev.damage >= 3) sounds.crunch(ev.damage);
          break;
        case 'segmentDestroyed':
          floater('BREACH!', -game.cfg.field.halfWidth + (ev.segment + 0.5) * game.segmentWidth(), 2, 'breach', 1.6);
          sounds.boom();
          break;
        case 'slam':
          // The shield bash: a heavy clang, and a callout when it flattens a crowd at the wall.
          if (ev.hits > 0) {
            sounds.clang(false);
            hitStop = Math.max(hitStop, 0.05);
            if (ev.hits >= 3) floater(`SLAM! ×${ev.hits}`, ev.x, game.cfg.shield.y + 1, 'smash', 0.9);
          }
          break;
        case 'treeDown':
          sounds.crunch(12);
          break;
        case 'line':
          hitStop = Math.max(hitStop, 0.06);
          floater('SMASH!', (ev.x0 + ev.x1) / 2, ev.y, 'smash', 0.9);
          break;
        case 'combo':
          floater(`×${ev.combo} COMBO!`, ev.x, ev.y, `c${ev.combo}`, 1.4);
          sounds.chime(ev.combo >= 40 ? 3 : ev.combo >= 25 ? 2 : 1);
          break;
        case 'blast':
        case 'floorDown':
          hitStop = Math.max(hitStop, 0.05);
          sounds.boom();
          break;
        case 'caught':
          floater(CAPSULE_LOOK[ev.kind].name, ev.x, game.cfg.shield.y + 2, ev.kind === 'trick' ? 'bad' : 'good', 1.6);
          sounds.chime(1);
          break;
        case 'salvo':
          toast(`Salvo! ${ev.size} boulders incoming`);
          break;
        case 'ballLost':
          if (ev.kind === 'royal') toast('The Royal Ball hit the wall! Click to serve it again');
          break;
        case 'waveCleared':
          toast(`Wave ${ev.wave} beaten back, +${ev.gold} gold`);
          break;
        case 'power':
          if (ev.kind === 'keep') {
            sounds.horn();
            toast('To arms!');
          } else if (ev.kind === 'tavern') {
            sounds.cheer();
            toast('A round on the house! The soldiers are back on their feet');
          } else {
            sounds.brew();
            toast('Fire brew! Every ball burns');
          }
          break;
        case 'calledEarly':
          toast(`Early call! +${ev.gold} gold`);
          break;
        case 'bossKilled':
          toast(`${game.plan.tower ? 'The siege tower falls!' : 'The Warlord falls!'} +${game.cfg.renown.bossKill} Renown`);
          break;
        default:
          break;
      }
    }
    game.events.length = 0;
  }
  updateLook(dt);
  updateGhost();
  sounds.scrape(running && game.phase === 'battle' ? Math.abs(game.shield.vx) / game.cfg.shield.speed : 0);
  // The horde swells with the crowd on the field (and mutters while it waits up the far end).
  const crowd = running && !game.over ? (game.phase === 'battle' ? game.enemies.length : 0.3 * planSize(game.plan)) : 0;
  sounds.horde(Math.sqrt(Math.min(1, crowd / 500)));
  view.render(dt, now / 1000);
  updateHud(dt);
  updateShop();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
