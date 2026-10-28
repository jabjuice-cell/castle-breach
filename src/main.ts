import wallStatesUrl from './assets/castle/wall-damage-states.webp';
import callWaveUrl from './assets/icons/call-wave.png';
import goldUrl from './assets/icons/gold.png';
import renownUrl from './assets/icons/renown.png';
import shieldUrl from './assets/icons/shield.png';
import gruntPortrait from './assets/sprites/enemy-grunt.webp';
import chuckerPortrait from './assets/sprites/enemy-chucker.webp';
import runnerPortrait from './assets/sprites/enemy-runner.webp';
import riderPortrait from './assets/sprites/enemy-rider.webp';
import catapultPortrait from './assets/sprites/enemy-catapult.webp';
import ogrePortrait from './assets/sprites/enemy-ogre.webp';
import warlordPortrait from './assets/sprites/enemy-warlord.webp';
import barrelPortrait from './assets/sprites/powder-barrel.webp';
import queenUrl from './assets/characters/queen.webp';
import queenAngryUrl from './assets/characters/queen-angry.webp';
import { queenAdvice, queenCross, queenVerdict } from './queen';
import { BattleScene, CAPSULE_LOOK, type PlanPreview, QUALITIES, type Quality } from './render/scene';
import { Sounds } from './render/sound';
import { defenderPortraits } from './render/portraits';
import { BUILDINGS } from './render/world';
import { DEFENDER_KINDS, type DefenderKind, type Ground, type PlacedKind, SPECIAL_NAMES, type Track, USEFUL_TRACKS, groundAt, stackAt } from './sim/defenders';
import { BUILDING_KINDS, type BuildingKind, type TerrainKind, Game, STEP } from './sim/game';
import {
  ARCHER_ROLE_INFO, BALL_KIT_INFO, SHIELD_KIT_INFO, SOLDIER_ROLE_INFO, TACTIC_INFO,
  type ChoiceBuilding, type Choices, type Option, hasChoiceBuilding, optionNeeds, optionOpen, sanitizeChoices,
} from './sim/town';
import { contact } from './sim/obstacles';
import { Tutorial } from './sim/tutorial';
import { META_GROUPS, META_UPGRADES, type MetaGroup, type Progress, applyMeta, buyMeta, metaCost, metaDepth, metaLocked, metaUpgrade, newProgress } from './sim/meta';
import { ENEMY_KINDS, type EnemyKind } from './sim/waves';
import { KEEP_CELLS, PIECES, PLOT_H, PLOT_W, type PieceId, type Placed, activePairs, autoPack, canPlace, effectiveMeta, landBounds, pieceCells, sanitizePlot, yard } from './sim/plot';

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
/** The guided first wave, while a brand-new player has not finished it. */
let tutorial: Tutorial | null = null;
let game = newLevel();
const view = new BattleScene(canvas, game, quality);
view.setPlot(progress.plot, progress.meta.land ?? 0);
/** The building in your hand, and where you grabbed it (tiles from its corner). */
let held: { p: Placed; dx: number; dy: number } | null = null;
let plotHover: { x: number; y: number } | null = null;

if (location.search.includes("debug")) Object.defineProperty(window, "__dbg", { get: () => ({ game, scene: view }) });

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

/** Camera shake is optional; it starts off for players who ask their system for reduced motion. */
const shakeSetting = loadSetting('shake');
let shakeOn = shakeSetting === null ? !window.matchMedia('(prefers-reduced-motion: reduce)').matches : shakeSetting === '1';
function showShake() {
  view.shakeScale = shakeOn ? 1 : 0;
  $('shake').textContent = shakeOn ? 'Shake: On' : 'Shake: Off';
}
$('shake').addEventListener('click', () => {
  shakeOn = !shakeOn;
  saveSetting('shake', shakeOn ? '1' : '0');
  showShake();
});
showShake();

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

/** War Council shaping: the barricade or rubble being placed, a barricade's turn (radians), and a bumper or ramp being dragged. */
let shaping: TerrainKind | null = null;
let shapeAngle = 0;
let dragFix: { index: number; dx: number; dy: number; sx: number; sy: number } | null = null;
const SHAPE_NAMES: Record<TerrainKind, string> = { barricade: 'Barricade', rubble: 'Rubble' };

function rotateShape(dir: number) {
  shapeAngle += (dir * game.cfg.setupFx.rotateDegrees * Math.PI) / 180;
  if (shapeAngle > Math.PI) shapeAngle -= Math.PI * 2;
  if (shapeAngle < -Math.PI) shapeAngle += Math.PI * 2;
}

/** The bumper or ramp (bells stay put) under (x, y) while the shop is open, or -1. */
function fixtureAt(x: number, y: number): number {
  if (!game.shopOpen) return -1;
  const bumper = game.cfg.contraptions.bumper.radius;
  return game.contraptions.findIndex((c) => c.kind !== 'bell' && !!contact(
    c.kind === 'bumper' ? { look: 'stone', x: c.x, y: c.y, r: bumper } : { look: 'ruin', x: c.x, y: c.y, hw: c.hw ?? 2, hh: c.hh ?? 1.5, angle: c.angle ?? 0 }, x, y, 0.2));
}

/** The placed barricade or rubble (obstacle index) under (x, y) while the shop is open, or -1. */
function terrainAt(x: number, y: number): number {
  return game.shopOpen ? game.obstacles.findIndex((o) => o.placed && !o.removed && !o.down && !!contact(o, x, y, 0.3)) : -1;
}

/** BATTLE READY: the camera is held up the field for the first preview's countdown. */
let ready = false;
let bannerT = 0;

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
    trayKey = '';
    return;
  }
  toast(game.canPlace(kind, input.x, input.y) ? 'Not enough gold' : whyNot(kind, input.x, input.y));
}

/** Sets a barricade or a heap of rubble down where the mouse is (the sound and dust come from the sim's event). */
function tryShape(kind: TerrainKind) {
  if (game.placeTerrain(kind, input.x, input.y, shapeAngle)) {
    if (game.shapeLeft(kind) <= 0) shaping = null;
    trayKey = '';
    return;
  }
  const s = game.cfg.shaping;
  toast(game.shapeLeft(kind) <= 0 ? `No ${kind} left`
    : input.y < s.minY || input.y > s.maxY ? `Shape the field between ${s.minY} and ${s.maxY} up from the wall`
      : 'Not there: keep clear of the trees, the edges and other pieces, and leave gaps');
}

/** Why a defender can't stand at (x, y): off the castle grounds, or on top of another one. */
function whyNot(kind: PlacedKind, x: number, y: number): string {
  const c = game.cfg.castle;
  const hw = game.cfg.field.halfWidth - c.edge;
  if (kind === 'spiketrap') {
    const t = game.cfg.spiketrap;
    if (x < -hw || x > hw || y < t.minY || y > t.maxY) return 'Traps go on the path, up the field from the wall';
    if (game.obstacles.some((o) => !o.down && contact(o, x, y, t.footprint))) return 'Something is in the way: traps need clear ground';
    return 'Too close to another defender or a bumper';
  }
  if (x < -hw || x > hw || y < c.minY || y > c.maxY) return 'Put it on the castle: the wall, a tower top or the courtyard';
  const ground = groundAt(game.cfg, x, y, game.stacks);
  if (kind === 'mage' && ground !== 'tower') return 'Mages stand on towers';
  if (kind === 'oil' && ground === 'courtyard') return 'Oil goes on the wall';
  return `Too close to another defender${kind === 'archers' ? ': a squad of archers needs room' : ''}`;
}

/** What standing at (x, y) does for a defender, for the label that follows the ghost. */
const GROUND_NOTE: Record<Ground, string> = {
  tower: 'Tower top: +30% range',
  wall: 'Wall walk',
  courtyard: 'Courtyard: safe, but 20% less range',
};

// On the window, so the shield and an aim keep following the mouse over the HUD panels too.
window.addEventListener('pointermove', (e) => {
  pointerToSim(e);
  hovered = e.target === canvas && !placing && !aiming && !building ? buildingAt(e) : null;
  if (hovered && hovered !== 'keep' && game.phase !== 'setup') hovered = null;
  canvas.style.cursor = hovered ? 'pointer' : '';
});

// ---- the town buildings you can click -------------------------------

/** The building under the mouse, lit up while it's there. */
let hovered: BuildingKind | null = null;

const CHOICE_BUILDINGS: ChoiceBuilding[] = ['warroom', 'barracks', 'blacksmith', 'watchtower'];
/** A building you make choices in (outside the battle itself, so clicks there still heave). */
function buildingAt(e: PointerEvent | MouseEvent): BuildingKind | null {
  const r = canvas.getBoundingClientRect();
  const b = view.pickBuilding(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  return b && (CHOICE_BUILDINGS as string[]).includes(b) && game.phase !== 'battle' ? b : null;
}

canvas.addEventListener('pointerdown', (e) => {
  pointerToSim(e);
  sounds.unlock();
  if (e.button === 2) {
    townOpen = null;
    if (placing) cancelPlacing();
    if (aiming) cancelAiming();
    building = false;
    shaping = null;
    dragFix = null;
    trayKey = '';
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
    const aimed = game.defenders.find((o) => o.id === aiming!.id);
    if (aimed) view.pulse(aimed.x, aimed.y);
    selected = aiming.id;
    aiming = null;
    return;
  }
  if (placing) {
    tryPlace(placing);
    return;
  }
  if (shaping) {
    tryShape(shaping);
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
  if (running && game.shopOpen) {
    // Bumpers and ramps are dragged to a new spot; a placed barricade or rubble pile is taken back with a click.
    const fi = fixtureAt(input.x, input.y);
    if (fi >= 0) {
      const c = game.contraptions[fi];
      dragFix = { index: fi, dx: c.x - input.x, dy: c.y - input.y, sx: input.x, sy: input.y };
      return;
    }
    const ti = terrainAt(input.x, input.y);
    if (ti >= 0) {
      const name = SHAPE_NAMES[game.obstacles[ti].look as TerrainKind] ?? 'Piece';
      if (game.removeTerrain(ti)) toast(`${name} taken back`);
      trayKey = '';
      return;
    }
  }
  selected = null;
  const b = buildingAt(e);
  if (b && running) {
    clickTownBuilding(b as ChoiceBuilding);
    return;
  }
  if (running) game.heave();
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 0 && dragFix) {
    const f = dragFix;
    dragFix = null;
    // Barely moved: nothing to do. Otherwise it goes there if it fits, and snaps back if not.
    if (Math.hypot(input.x - f.sx, input.y - f.sy) >= 0.6 && !game.moveContraption(f.index, input.x + f.dx, input.y + f.dy)) {
      toast(`Can't go there: keep ${game.cfg.shaping.keepClearX} from the middle, within ${game.cfg.shaping.minY}-${game.cfg.shaping.maxY} up the field, clear of other things`);
    }
    return;
  }
  if (e.button !== 0 || dragging === null) return;
  const id = dragging;
  dragging = null;
  // Barely moved: a click, which opens the defender's card.
  if (Math.hypot(input.x - pressAt.x, input.y - pressAt.y) < 0.6) {
    selected = game.shopOpen ? id : null;
    if (selected !== null) townOpen = null;
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
  // Dev aid (?debug): P lobs a practice boulder at the shield, Shift+P one off to the side, to try Perfect Returns.
  if (e.code === 'KeyP' && params.has('debug') && running && !e.repeat) game.practiceBall(e.shiftKey ? 6 : 0);
  // Dev aid (?debug): O sets up a column of grunts with an empowered ball heading for them (Shift+O: shield-team orcs), to try Orc Bowling.
  if (e.code === 'KeyO' && params.has('debug') && running && !e.repeat) game.practiceBowling(4, e.shiftKey ? 'shieldOrc' : 'grunt');
  if (e.code === 'Escape') {
    townOpen = null;
    if (placing) cancelPlacing();
    if (aiming) cancelAiming();
    building = false;
    shaping = null;
    dragFix = null;
    selected = null;
    trayKey = '';
  }
  if (e.code === 'KeyR' && shaping === 'barricade' && !e.repeat) rotateShape(e.shiftKey ? -1 : 1);
  if (e.code === 'Enter' && running) {
    e.preventDefault();
    if (intro) endIntro();
    else if (game.phase === 'setup') startBattle();
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
$('startNow').addEventListener('click', () => {
  if (intro) endIntro();
  else if (game.phase === 'setup') startBattle();
  else game.callEarly();
});
$('callEarly').addEventListener('click', () => game.callEarly());
$('again').addEventListener('click', () => showTown());

// ---- looking up the field at the coming horde -------------------------------

/**
 * A level opens on the waiting horde; the first Enter (or click) pans the camera down
 * to the play view. In the setup and between waves the mouse wheel looks up the field and back.
 */
let tour = -1;
const TOUR = { up: 0.4, back: 3.4 };
/** Seconds the opening pan from the enemy view down to the play view takes. */
const INTRO_PAN = 1.2;
let intro = false;
let panLeft = 0;
function startTour() {
  tour = -1;
  panLeft = 0;
  intro = !calm;
  if (intro) view.snapLook(1);
}
function endIntro() {
  intro = false;
  panLeft = INTRO_PAN;
}
function updateLook(dt: number) {
  if (!running) intro = false;
  if (panLeft > 0) panLeft -= dt;
  if (!running || !game.shopOpen) {
    tour = -1;
    peek = false;
  }
  // Pressing To battle sweeps the camera up to the horde; it holds through the countdown and glides back when the battle starts.
  if (!running || game.phase !== 'preview') ready = false;
  if (tour >= 0) {
    tour += dt;
    if (tour > TOUR.back + 1.5) tour = -1;
  }
  const touring = tour >= TOUR.up && tour < TOUR.back;
  view.lookAhead = intro || touring || peek || ready ? 1 : 0;
  view.lookRate = ready ? game.cfg.setupFx.sweepRate : 2.2;
  view.lookSeconds = panLeft > 0 ? INTRO_PAN : 0;
}
let peek = false;
window.addEventListener('wheel', (e) => {
  if (!running || !game.shopOpen) return;
  // While placing a barricade the wheel turns it instead of looking up the field.
  if (shaping === 'barricade') {
    rotateShape(e.deltaY < 0 ? -1 : 1);
    return;
  }
  peek = e.deltaY < 0;
  tour = -1;
  if (!peek) ready = false;
}, { passive: true });
window.addEventListener('pointerdown', () => {
  if (intro) endIntro();
  if (tour >= 0) tour = -1;
  ready = false;
}, { capture: true });

/** The big BATTLE READY! banner: shown for setupFx.bannerSeconds, then hidden. */
function showBanner(text: string) {
  const el = $('banner');
  el.textContent = text;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  el.style.animationDuration = `${game.cfg.setupFx.bannerSeconds}s`;
  el.hidden = false;
  bannerT = game.cfg.setupFx.bannerSeconds;
}

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
  shieldOrc: ['Shield Orc', 'Shield Orcs'],
  drummer: ['Drummer', 'Drummers'],
};

const DEFENDER_INFO: Record<DefenderKind, { name: string; blurb: string }> = {
  crossbow: { name: 'Giant crossbow', blurb: 'Fires straight up its lane, piercing a column, and hunts catapults first. On a tower it also angles across into the next lanes.' },
  archers: { name: 'Archers', blurb: 'Thirty bowmen. Their cone shoots boulders out of the sky and rains volleys on the crowd. Leave a section without them and it is a blind spot.' },
  catapult: { name: 'Catapult', blurb: 'Lobs extra gold balls far up the field, but can\'t reach anything close to the wall.' },
  soldiers: { name: 'Soldier company', blurb: 'Forty soldiers hold the foot of the wall in their section and a little either side.' },
  mage: { name: 'Mage tower', blurb: 'Tower tops only. Blasts the thickest crowd in range; taller towers reach further.' },
  ballista: { name: 'Ballista', blurb: 'Slow, huge range. One great bolt skewers everything in its lane.' },
  oil: { name: 'Boiling oil', blurb: 'Wall walk only. Pours on orcs climbing or hacking at the wall below.' },
  spiketrap: { name: 'Spike trap', blurb: 'Set on the field. Hurts and slows marching orcs; the ball bounces off it.' },
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
  shieldOrc: 'Shields stop balls head-on. Bank a shot around the side or behind.',
  drummer: 'Kill the drummer and the formation breaks: shields drop and the block scatters.',
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
  townPop: $('townPop'),
  toast: $('toast'),
  bottom: $('bottom'),
  queen: $('queen'),
  queenText: $('queenText'),
  coach: $('coach'),
  coachText: $('coachText'),
  buildTags: $('buildTags'),
};

/** Lane markers over the spawn line while the next wave lines up: what is coming down each lane. */
/** The plan the labels were made for (the object, not its number: a restarted level plans the same wave number afresh). */
let markerPlan: object | null = null;
/** The portrait on each wave label: the group's lead enemy. */
const PORTRAITS: Partial<Record<string, string>> = {
  grunt: gruntPortrait, shieldOrc: gruntPortrait, drummer: gruntPortrait, chucker: chuckerPortrait, runner: runnerPortrait, rider: riderPortrait,
  orcCatapult: catapultPortrait, ogre: ogrePortrait, warlord: warlordPortrait, barrel: barrelPortrait,
};
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
        const portrait = PORTRAITS[lead];
        if (portrait) {
          const img = document.createElement('img');
          img.src = portrait;
          img.alt = '';
          el.append(img);
        }
        el.append(g.members.length === 1 && g.members[0].kind !== 'grunt' ? count(total, lead) : `${total}${g.members.some((m) => m.kind === 'orcCatapult') ? ' + catapults' : ''}`);
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
/** The label that follows the mouse over the field. */
function showTag(text: string, x: number, y: number, height: number, bad: boolean) {
  const tag = hud.placeTag;
  tag.hidden = false;
  tag.classList.toggle('bad', bad);
  if (tag.textContent !== text) tag.textContent = text;
  const p = view.project(x, y, height);
  tag.style.left = `${p.x}px`;
  tag.style.top = `${p.y}px`;
}

function updatePlaceTag(kind: PlacedKind | undefined, ok: boolean, ignoreId: number) {
  const tag = hud.placeTag;
  if (!kind) {
    tag.hidden = true;
    return;
  }
  tag.hidden = false;
  const storeys = stackAt(game.cfg, game.stacks, input.x, input.y)?.storeys ?? 1;
  const bonus = Math.round((game.cfg.towers.reach[storeys - 1] - 1) * 100);
  const ground = groundAt(game.cfg, input.x, input.y, game.stacks);
  const note = kind === 'spiketrap' ? 'Spike trap: hurts and slows marchers, bounces the ball'
    : kind === 'oil' ? 'Pours on orcs climbing this stretch of wall'
    : ground === 'tower' && storeys > 1 ? `Tower top, ${storeys} storeys: +${bonus}% range` : GROUND_NOTE[ground];
  const text = ok ? note : game.canPlace(kind, input.x, input.y, ignoreId) ? 'Not enough gold' : whyNot(kind, input.x, input.y);
  if (tag.textContent !== text) tag.textContent = text;
  tag.classList.toggle('bad', !ok);
  const p = view.project(input.x, input.y, view.standHeight(input.x, -input.y) + (kind === 'crossbow' || kind === 'ballista' ? 5 : kind === 'spiketrap' ? 1.5 : 3.2));
  tag.style.left = `${p.x}px`;
  tag.style.top = `${p.y}px`;
}


/** Floating text over the field: combos, capsules, line smashes. */
const floaters: { el: HTMLElement; x: number; y: number; t: number; life: number }[] = [];
function floater(text: string, x: number, y: number, cls = '', life = 1.2) {
  if (floaters.length > 16) floaters.shift()!.el.remove();
  return addFloater(text, x, y, cls, life);
}
function addFloater(text: string, x: number, y: number, cls: string, life: number) {
  const el = document.createElement('div');
  el.className = `floater ${cls}`;
  el.textContent = text;
  hud.floaters.appendChild(el);
  const f = { el, x, y, t: 0, life };
  floaters.push(f);
  return f;
}

/** One popup per bowling chain, updated as the chain grows: DOUBLE!, TRIPLE!, then ORC BOWLING!. */
const bowlPopups = new Map<number, ReturnType<typeof addFloater>>();
const BOWL_WORDS = ['', '', 'DOUBLE!', 'TRIPLE!', 'ORC BOWLING!'];
let lastBowlSound = 0;
let lastVoice = 0;
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
let lastStartHtml = '';
let lastEarlyHtml = '';

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
  hud.preview.hidden = !previewing || (view.lookAhead > 0 && !ready);
  hud.queen.hidden = !previewing;
  updateCoach();
  if (previewing) {
    const setup = game.phase === 'setup';
    const wave = `${game.plan.boss ? 'Boss wave! ' : ''}Wave ${game.levelWave}`;
    hud.previewTitle.textContent = setup ? `Level ${game.level + 1}: ${c.levels.names[game.level]}` : `${wave} marches in ${Math.ceil(game.phaseTimer)}`;
    // At the level's start the panel is just the title and the button.
    hud.previewText.hidden = setup;
    if (!setup) hud.previewText.textContent = `${planText()}, down ${laneText()}. ${trickText()}${game.levelWave === 1 ? ' Scroll up to look at them.' : ''}`;
    hud.queenText.textContent = queenAdvice(game);
    const face = queenCross(game) ? queenAngryUrl : queenUrl;
    const portrait = hud.queen.querySelector('img')!;
    if (!portrait.src.endsWith(face)) portrait.src = face;
    const startHtml = setup ? 'To battle! <kbd>Enter</kbd>' : `${icon('call')}Ready, +${game.earlyCallGold()} gold <kbd>Enter</kbd>`;
    if (startHtml !== lastStartHtml) hud.startNow.innerHTML = lastStartHtml = startHtml;
  }

  // Over each town building: its name and perk, once built.
  BUILDING_KINDS.forEach((kind, i) => {
    const el = hud.buildTags.children[i] as HTMLElement;
    const b = BUILDINGS[kind];
    const p = view.project(b.x, -b.z, b.top);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.hidden = !running || view.lookAhead > 0 || kind === 'keep' || !game.hasBuilding(kind);
    if (el.hidden) return;
    const built = game.hasBuilding(kind);
    const span = el.firstElementChild as HTMLElement;
    const bar = el.lastElementChild!.firstElementChild as HTMLElement;
    const html = built ? `<b>${b.name}</b> ${b.power}` : `${b.name}: build it in the town`;
    if (span.innerHTML !== html) span.innerHTML = html;
    el.className = `btag${built ? ' ready' : ' locked'}`;
    bar.style.transform = 'scaleX(0)';
  });
  if (hovered) view.hoverBuilding(hovered);

  const tail = game.phase === 'battle' && game.canCallEarly();
  hud.callEarly.hidden = !tail;
  if (tail) {
    const earlyHtml = `${icon('call')}Sound the horn: call wave ${game.wave + 1} now, +${game.earlyCallGold()} gold <kbd>Enter</kbd>`;
    if (earlyHtml !== lastEarlyHtml) hud.callEarly.innerHTML = lastEarlyHtml = earlyHtml;
  }

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
  if (kind === 'mage') return `blast radius ${game.mageRadius().toFixed(1)}`;
  if (kind === 'ballista') return `loses ${(game.ballistaFalloff() * 100).toFixed(0)}% per orc`;
  if (kind === 'oil') return `burns ${game.cfg.oil.burn + game.cfg.oil.burnStep * lv}/s for ${game.cfg.oil.burnSeconds + game.cfg.oil.burnSecondsStep * lv}s`;
  if (kind === 'spiketrap') return `slows to ${Math.round(Math.max(game.cfg.spiketrap.slowMin, game.cfg.spiketrap.slow - game.cfg.spiketrap.slowStep * lv) * 100)}%`;
  return `${Math.round(game.soldierHp())} HP each`;
}

/** The stat line on a shop card for the newer defenders. */
function cardStats(k: DefenderKind): string {
  const c = game.cfg;
  switch (k) {
    case 'mage': return `${c.mage.damage} dmg blast, radius ${c.mage.radius}, every ${c.mage.interval}s`;
    case 'ballista': return `${c.ballista.damage} dmg, pierces all, every ${c.ballista.interval}s`;
    case 'oil': return `${c.oil.damage} dmg + burn, every ${c.oil.interval}s`;
    case 'spiketrap': return `${c.spiketrap.dps}/s, slows to ${Math.round(c.spiketrap.slow * 100)}%`;
    default: return '';
  }
}

/** Voxel portraits of the defenders (and a tower), drawn once, for the shop cards. */
let portraits: Record<string, string> | null = null;
function portrait(kind: DefenderKind | 'tower'): string {
  const url = (portraits ??= defenderPortraits())[kind];
  return url ? `<img class="portrait" src="${url}" alt="">` : '';
}

const costBtn = (action: string, label: string, cost: number, disabled = false) =>
  `<button type="button" data-action="${action}" ${disabled || cost > game.gold ? 'disabled' : ''}>${label} <span class="cost">${Number.isFinite(cost) ? `${cost}g` : ''}</span></button>`;

/** The tray in the corner while the shop is open: defenders to buy, and the button to start. */
function trayHtml(): string {
  const gold = Math.floor(game.gold);
  const setup = game.phase === 'setup';
  const buy = DEFENDER_KINDS.map((k) => {
    if (!game.unlocked(k)) return '';
    const cost = game.defenderCost(k);
    return `<button type="button" data-action="place:${k}" class="${placing === k ? 'on' : ''}" title="${DEFENDER_INFO[k].blurb}" ${cost > gold ? 'disabled' : ''}>${portrait(k)}<b>${DEFENDER_INFO[k].name}</b><small>${cost} gold${game.count(k) ? ` · ${game.count(k)} placed` : ''}</small>${cardStats(k) ? `<small>${cardStats(k)}</small>` : ''}</button>`;
  }).join('');
  const storey = game.storeyCost();
  const tower = `<button type="button" data-action="tower" class="${building ? 'on' : ''}" ${storey > gold ? 'disabled' : ''}>${portrait('tower')}<b>Tower storey</b><small>${game.cfg.towers.costs.join(' / ')} gold, by height</small><small>Tall: more reach, draws fire</small></button>`;
  const shape = game.cfg.shaping.enabled
    ? (['barricade', 'rubble'] as const).map((k) => {
      const n = game.shapeLeft(k);
      const tip = k === 'barricade' ? 'Orcs have to go round it and balls bank off it. R or the wheel turns it.' : 'A heap of stone: slows nothing, but orcs go round it and balls bank off it.';
      return `<button type="button" data-action="shape:${k}" class="${shaping === k ? 'on' : ''}" title="${tip} Click a placed piece to take it back." ${n <= 0 && shaping !== k ? 'disabled' : ''}><b>${SHAPE_NAMES[k]} (${n} left)</b><small>${k === 'barricade' ? 'Crossed stakes' : 'Stone pile'}</small></button>`;
    }).join('')
    : '';
  const again = setup && progress.lastLoadout.length && !game.defenders.length
    ? `<button type="button" class="again" data-action="again">Put back last level's defenders</button>`
    : '';
  const tip = building
    ? `Click the wall walk to build a tower, or a tower to stack another storey on it (up to 3). Whoever stands on top reaches ${game.cfg.towers.reach.map((r) => `+${Math.round((r - 1) * 100)}%`).join(', ')} further. Tall towers draw the orcs' fire and lose storeys; several low ones spread it.`
    : placing
    ? `${placing === 'spiketrap' ? 'Click the path up the field to set the trap.' : placing === 'mage' ? 'Click a tower top to put the mage down.' : placing === 'oil' ? 'Click the wall walk or a tower to put the cauldron down.' : 'Click the castle to put it down: the wall, a tower top or the courtyard.'} Right click or Esc to cancel.`
    : setup
      ? 'Spend your war chest on defenders and put them anywhere on the castle. Click one to upgrade or sell it (full refund until the battle starts); drag it to move it.'
      : 'Between waves: click a defender to upgrade it, a wall\'s Repair tag to patch it, or buy more. The next wave won\'t wait.';
  const choices = setup ? choicesLine() : '';
  return `
    <header><h3>${setup ? 'Load-out' : 'Between waves'}</h3><span class="purse">${icon('gold')}${gold} gold</span></header>
    <div class="buy">${buy}${tower}${shape}</div>${again}
    <p class="tip">${shaping ? `Click the field to place ${shaping === 'barricade' ? 'a barricade (R or the mouse wheel turns it)' : 'rubble'}. Right click or Esc to cancel.` : tip}</p>
    <p class="tip">Gold: covered by your defenders.${game.cfg.shaping.enabled ? ' Drag bumpers and ramps to move them. Click a placed barricade or rubble pile to take it back.' : ''}</p>${choices}
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
  const plural = { crossbow: 'crossbows', archers: 'archer squads', catapult: 'catapults', soldiers: 'companies', mage: 'mage towers', ballista: 'ballistas', oil: 'cauldrons', spiketrap: 'spike traps' }[kind];
  const def = game.defenders.find((o) => o.id === d.id)!;
  const aim = game.aimable(def)
    ? `<div class="track"><span>Aim<small>${def.heading === null ? 'straight ahead' : `${Math.round(Math.abs(def.heading) * 57.3)}° ${def.heading < 0 ? 'left' : 'right'}`}</small></span><span><button type="button" data-action="aim:${d.id}">Aim</button>${def.heading !== null ? ` <button type="button" data-action="unaim:${d.id}">Straight</button>` : ''}</span></div>`
    : '';
  return `<h3>${portrait(kind)}${DEFENDER_INFO[kind].name}</h3><small>Upgrades apply to all your ${plural}.</small>${aim}${tracks}
    <footer><button type="button" data-action="sell:${d.id}">Sell for ${game.sellValue(d.id)}g</button><button type="button" data-action="close">Done</button></footer>`;
}

/** The tray's one-line summary of the town's choices (only for buildings the town has). */
function choicesLine(): string {
  const m = progress.meta;
  const c = game.choices;
  const name = <T extends string>(list: Option<T>[], id: T) => list.find((o) => o.id === id)!.name;
  const parts: string[] = [];
  if (hasChoiceBuilding(m, 'warroom')) parts.push(`Tactic: ${c.tactic ? name(TACTIC_INFO, c.tactic) : 'None'}`);
  if (hasChoiceBuilding(m, 'barracks')) parts.push(`Archers: ${name(ARCHER_ROLE_INFO, c.archers)}`, `Soldiers: ${name(SOLDIER_ROLE_INFO, c.soldiers)}`);
  if (hasChoiceBuilding(m, 'blacksmith')) parts.push(`Shield: ${name(SHIELD_KIT_INFO, c.shield)}`, `Ball: ${name(BALL_KIT_INFO, c.ball)}`);
  if (!parts.length) return '';
  return `<p class="tip"><b>${parts.join(' · ')}</b><br>Click the war room, barracks, blacksmith or watchtower to change</p>`;
}

// ---- the town popover: choices made by clicking the town's buildings ----------

let townOpen: ChoiceBuilding | null = null;
let lastPinned = -1;
const TOWN_NAMES: Record<string, string> = {
  grunt: 'Grunts', shieldOrc: 'Shield orcs', drummer: 'Drummers', chucker: 'Chuckers', runner: 'Goblin runners',
  rider: 'Riders', ogre: 'Ogres', barrel: 'Powder barrels', orcCatapult: 'Catapults', warlord: 'Warlord',
};

function clickTownBuilding(b: ChoiceBuilding) {
  const name = BUILDINGS[b].name;
  if (!hasChoiceBuilding(townMeta(), b)) toast(`${name}: build it in the town with Renown`);
  else if (game.phase !== 'setup') toast(`${name}: choose before the battle, in the setup`);
  else {
    townOpen = b;
    selected = null;
    building = false;
    shaping = null;
    if (placing) cancelPlacing();
    hud.townPop.dataset.key = '';
  }
}

function optionRows(building: ChoiceBuilding, field: keyof Choices, list: Option<string>[], none?: boolean): string {
  const cur = game.choices[field] ?? 'none';
  const row = (o: { id: string; name: string; good: string; bad: string }, open: boolean, needs: string[]) => {
    const btn = !open
      ? `<small class="need">Needs ${needs.map((id) => metaUpgrade(id).name).join(', ')}</small>`
      : `<button type="button" data-action="choose:${field}:${o.id}" ${cur === o.id ? 'disabled' : ''}>${cur === o.id ? 'Chosen' : 'Choose'}</button>`;
    return `<div class="opt${open ? '' : ' locked'}${cur === o.id ? ' on' : ''}"><div class="row"><b>${o.name}</b>${btn}</div><small>${o.good}</small>${o.bad ? `<small class="bad">${o.bad}</small>` : ''}</div>`;
  };
  const rows = list.map((o) => row(o, optionOpen(townMeta(), building, o), optionNeeds(progress.meta, o)));
  if (none) rows.push(row({ id: 'none', name: 'No tactic', good: 'Fight the level as it comes.', bad: '' }, true, []));
  return rows.join('');
}

function townPopHtml(b: ChoiceBuilding): string {
  const done = '<footer><button type="button" data-action="close">Done</button></footer>';
  if (b === 'warroom') return `<h3>The War Room – one tactic for this level</h3>${optionRows(b, 'tactic', TACTIC_INFO, true)}${done}`;
  if (b === 'barracks') {
    const archers = (townMeta().archers ?? 0) > 0 ? optionRows(b, 'archers', ARCHER_ROLE_INFO) : '<small>Unlock archers first</small>';
    return `<h3>The Barracks</h3><h4>Archers</h4>${archers}<h4>Soldiers</h4>${optionRows(b, 'soldiers', SOLDIER_ROLE_INFO)}${done}`;
  }
  if (b === 'blacksmith') return `<h3>The Blacksmith</h3><h4>Shield</h4>${optionRows(b, 'shield', SHIELD_KIT_INFO)}<h4>Royal Ball</h4>${optionRows(b, 'ball', BALL_KIT_INFO)}${done}`;
  const rows = game
    .scoutReport()
    .map((w) => {
      const counts = (Object.entries(w.enemies) as [string, number][])
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${TOWN_NAMES[k] ?? k}`)
        .join(', ');
      const boss = w.boss ? `<b class="boss">${w.boss === 'warlord' ? 'Warlord on the siege tower!' : 'Siege tower!'}</b>` : '';
      return `<tr><td>${w.wave}</td><td>${counts}</td><td>${boss}</td></tr>`;
    })
    .join('');
  return `<h3>The Watchtower – what's coming</h3><table class="scout"><tr><th>Wave</th><th>Orcs</th><th>Boss</th></tr>${rows}</table>${done}`;
}

function townAction(action: string) {
  const [verb, field, id] = action.split(':');
  if (verb === 'close') {
    townOpen = null;
    return;
  }
  if (verb !== 'choose') return;
  const c = { ...game.choices, [field]: id === 'none' ? null : id } as Choices;
  if (!game.setChoices(c)) return;
  progress.choices = c;
  saveProgress();
  sounds.thunk();
  const all = [...TACTIC_INFO, ...ARCHER_ROLE_INFO, ...SOLDIER_ROLE_INFO, ...SHIELD_KIT_INFO, ...BALL_KIT_INFO] as Option<string>[];
  toast(`${id === 'none' ? 'No tactic' : all.find((o) => o.id === id)?.name} chosen`);
  hud.townPop.dataset.key = '';
  trayKey = '';
}

function updateTownPop() {
  if (townOpen && !(running && game.phase === 'setup')) townOpen = null;
  hud.townPop.hidden = !townOpen;
  if (!townOpen) return;
  const key = `${townOpen}|${JSON.stringify(game.choices)}`;
  if (hud.townPop.dataset.key !== key) {
    hud.townPop.dataset.key = key;
    hud.townPop.innerHTML = townPopHtml(townOpen);
  }
  // Under the building (projected like its tag), kept on screen.
  const b = BUILDINGS[townOpen];
  const p = view.project(b.x, -b.z, 0);
  const w = hud.townPop.offsetWidth;
  hud.townPop.style.left = `${Math.min(window.innerWidth - w / 2 - 8, Math.max(w / 2 + 8, p.x))}px`;
  hud.townPop.style.top = `${Math.max(8, Math.min(p.y + 8, window.innerHeight - hud.townPop.offsetHeight - 8))}px`;
}
hud.townPop.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (btn && !btn.disabled) townAction(btn.dataset.action!);
});

let trayKey = '';
let selected: number | null = null;
function updateShop() {
  if (selected !== null) townOpen = null;
  updateTownPop();
  const open = running && game.shopOpen;
  hud.tray.hidden = !open;
  if (open) {
    // Re-render only when something it shows has changed, so the buttons stay clickable.
    const key = [game.phase, Math.floor(game.gold), placing, building, shaping, game.shapeLeft('barricade'), game.shapeLeft('rubble'), game.defenders.length, progress.lastLoadout.length, JSON.stringify(game.choices)].join('|');
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
    shaping = null;
    selected = null;
  } else if (verb === 'tower') {
    building = !building;
    placing = null;
    shaping = null;
    selected = null;
  } else if (verb === 'shape') {
    shaping = shaping === a ? null : (a as TerrainKind);
    placing = null;
    building = false;
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
  shaping = null;
  dragFix = null;
  selected = null;
  // The sweep up the field belongs to the battleReady event; cut the level-start tour short so they don't add up.
  tour = -1;
  game.endSetup();
}

hud.buildTags.addEventListener('click', (e) => {
  const tag = (e.target as HTMLElement).closest<HTMLElement>('[data-building]');
  if (tag && (CHOICE_BUILDINGS as string[]).includes(tag.dataset.building ?? '')) clickTownBuilding(tag.dataset.building as ChoiceBuilding);
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
    // A save from before the tutorial belongs to someone who has already played.
    if (saved) {
      const parsed = JSON.parse(saved);
      const loaded: Progress = { ...p, tutorialDone: true, ...parsed };
      if ('plot' in parsed) {
        loaded.plot = sanitizePlot(loaded.meta, parsed.plot);
      } else {
        // A save from before the town plot: pack what it owns, with the land it needs for free.
        const packed = autoPack(loaded.meta);
        loaded.plot = packed.layout;
        if (packed.land > (loaded.meta.land ?? 0)) loaded.meta.land = packed.land;
      }
      return loaded;
    }
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

/** The meta-upgrades whose buildings actually stand on the plot (one in the builders' yard does nothing). */
function townMeta() {
  return effectiveMeta(progress.meta, progress.plot);
}

function newLevel(): Game {
  const level = progress.levelsBeaten;
  const g = new Game(Math.floor(Math.random() * 1e9), applyMeta(progress.meta, level, undefined, progress.plot), level, sanitizeChoices(townMeta(), progress.choices));
  tutorial = !progress.tutorialDone && level === 0 ? Tutorial.begin(g) : null;
  return g;
}

/** Shows the Queen's coaching line over the battle, and banks the tutorial as done when it ends. */
function updateCoach() {
  const coaching = tutorial !== null && running && game.phase === 'battle';
  if (tutorial && running && tutorial.update(game)) {
    progress.tutorialDone = true;
    saveProgress();
    toast('Tutorial done. The real orcs are coming!');
    tutorial = null;
  }
  hud.coach.hidden = !(coaching && tutorial);
  if (coaching && tutorial) {
    const line = tutorial.text;
    if (hud.coachText.textContent !== line) hud.coachText.textContent = line;
  }
}

function startLevel() {
  game = newLevel();
  placing = null;
  shaping = null;
  dragFix = null;
  ready = false;
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
    // Roots first, each branch indented under what it grows from.
    const ups = META_UPGRADES.filter((u) => u.group === g)
      .sort((a, b) => metaDepth(a.id) - metaDepth(b.id))
      .map((u) => {
        const lv = progress.meta[u.id] ?? 0;
        const cost = metaCost(progress.meta, u.id);
        const locked = metaLocked(progress.meta, u.id);
        const pips = u.costs.map((_, i) => (i < lv ? '◆' : '◇')).join('');
        const btn = !Number.isFinite(cost)
          ? '<small>Done</small>'
          : locked
            ? '<small class="need">Locked</small>'
            : `<button type="button" data-meta="${u.id}" ${cost > progress.renown ? 'disabled' : ''}>${icon('renown')}${cost}</button>`;
        const need = locked && Number.isFinite(cost) ? `<small class="need">Needs ${locked}</small>` : '';
        return `<div class="up${locked && !lv ? ' locked' : ''}" style="--depth:${metaDepth(u.id)}"><div class="row"><b>${u.name}</b>${btn}</div><small>${u.blurb}</small>${need}<span class="pips">${pips}</span></div>`;
      })
      .join('');
    return `<section><h2>${GROUP_NAMES[g]}</h2>${ups}</section>`;
  }).join('');
  const fresh = next === 0;
  return `<div class="scroll">
    <header><div><h1>The Town</h1><p class="sub">${fresh ? 'Spend Renown on upgrades that last for ever, then march out. A run is three levels; lose one and it starts again from the first.' : `Level ${next} held! Spend your Renown, then march on to level ${next + 1}.`}</p></div>
    <span class="purse">${icon('renown')}${Math.floor(progress.renown)} Renown</span></header>
    <div class="levels">${levels}</div>
    <div id="plotBox" class="plot">${plotHtml()}</div>
    <div class="groups">${groups}</div>
    <button type="button" class="march" data-march>March to ${names[next]}!</button>
    <p class="tag">Between levels: spend Renown here, lay out the town plot, then click the war room, barracks, blacksmith and watchtower in the town before the battle.</p>
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
  const id = up?.dataset.meta;
  if (up && !up.disabled && id) {
    const isPiece = id in PIECES && !(progress.meta[id] ?? 0);
    if (isPiece && !fitsSomewhere(id as PieceId)) toast(`No room: ${PIECES[id as PieceId].name} will wait in the builders' yard.`);
    if (buyMeta(progress, id)) {
      saveProgress();
      sounds.chime(1);
      // A new building goes straight into your hand, ready to put down.
      if (isPiece) held = { p: { id: id as PieceId, x: 0, y: 0, rot: 0 }, dx: 0, dy: 0 };
      showTown();
      if (isPiece) $('plotBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (id === 'land') view.setPlot(progress.plot, progress.meta.land ?? 0);
    }
    return;
  }
  const yardBtn = el.closest<HTMLElement>('[data-yard]');
  if (yardBtn) {
    held = { p: { id: yardBtn.dataset.yard as PieceId, x: 0, y: 0, rot: 0 }, dx: 0, dy: 0 };
    renderPlot();
    return;
  }
  if (el.closest('[data-drop]')) {
    held = null;
    renderPlot();
    return;
  }
  const cell = el.closest<HTMLElement>('[data-cell]');
  if (cell) {
    clickPlot(Number(cell.dataset.x), Number(cell.dataset.y));
    return;
  }
  if (el.closest('button[data-march]')) {
    held = null;
    const waiting = yard(progress.meta, progress.plot);
    if (waiting.length) toast(`Still in the builders' yard, doing nothing: ${waiting.map((w) => PIECES[w].name).join(', ')}.`);
    startLevel();
  }
});

// ---- the town plot ------------------------------------------------------------

/** Placeholder colours for each building on the plot (the voxel pieces use the same feel). */
const PIECE_COLOR: Record<PieceId, string> = {
  archers: '#6fae4a', soldiers: '#8f8a82', catapult: '#a0703a', mage: '#7a5ab8', ballista: '#7a4a24', oil: '#4a4a52', spiketrap: '#b0a070',
  fletching: '#d8c070', drill: '#c8a878', masonry: '#e7d8b4', tavern: '#d9572b', alchemist: '#3a8a5a', blacksmith: '#5a5a62', chapel: '#4a5878',
  forge: '#8a3a2a', warroom: '#c8322a', watchtower: '#9a6a3a', treasury: '#e8b730', market: '#ec7440', guild: '#3d66d6',
};

/** Can this building go anywhere on the open land as it stands now? */
function fitsSomewhere(id: PieceId): boolean {
  const land = progress.meta.land ?? 0;
  const lb = landBounds(land);
  const others = progress.plot.filter((q) => q.id !== id);
  for (let rot = 0; rot < 4; rot++) {
    for (let y = lb.y0; y <= lb.y1; y++) {
      for (let x = lb.x0; x <= lb.x1; x++) if (canPlace(others, { id, x, y, rot: rot as Placed['rot'] }, land)) return true;
    }
  }
  return false;
}

/** The held building where it would land under the mouse. */
function heldAt(): Placed | null {
  if (!held || !plotHover) return null;
  return { ...held.p, x: plotHover.x - held.dx, y: plotHover.y - held.dy };
}

function clickPlot(x: number, y: number) {
  const land = progress.meta.land ?? 0;
  if (held) {
    const at = heldAt();
    if (at && canPlace(progress.plot, at, land)) {
      progress.plot = [...progress.plot.filter((q) => q.id !== at.id), at];
      held = null;
      saveProgress();
      sounds.chime(0.6);
      view.setPlot(progress.plot, land);
    } else toast("It doesn't fit there.");
    renderPlot();
    return;
  }
  // Pick up the building under the mouse (it leaves the plot until it is put down again).
  const p = progress.plot.find((q) => pieceCells(q).some(([cx, cy]) => cx === x && cy === y));
  if (!p) return;
  progress.plot = progress.plot.filter((q) => q !== p);
  held = { p, dx: x - p.x, dy: y - p.y };
  saveProgress();
  view.setPlot(progress.plot, land);
  renderPlot();
}

function rotateHeld() {
  if (!held) return;
  held = { p: { ...held.p, rot: ((held.p.rot + 1) % 4) as Placed['rot'] }, dx: 0, dy: 0 };
  renderPlot();
}

function renderPlot() {
  const box = document.getElementById('plotBox');
  if (box) box.innerHTML = plotHtml();
}

function plotHtml(): string {
  const land = progress.meta.land ?? 0;
  const lb = landBounds(land);
  const owner = new Map<string, PieceId | 'keep'>();
  for (const [x, y] of KEEP_CELLS) owner.set(`${x},${y}`, 'keep');
  for (const p of progress.plot) for (const [x, y] of pieceCells(p)) owner.set(`${x},${y}`, p.id);
  const ghost = heldAt();
  const ghostCells = new Set(ghost ? pieceCells(ghost).map(([x, y]) => `${x},${y}`) : []);
  const ghostOk = ghost ? canPlace(progress.plot, ghost, land) : false;
  // What would light up if the held building went down here.
  const pairs = activePairs(ghost && ghostOk ? [...progress.plot, ghost] : progress.plot);
  const seams = new Map<string, string>();
  for (const pr of pairs) for (const [x, y, side] of pr.edges) seams.set(`${x},${y},${side}`, pr.kind);
  const labelled = new Set<string>();
  let cells = '';
  for (let y = 0; y < PLOT_H; y++) {
    for (let x = 0; x < PLOT_W; x++) {
      const k = `${x},${y}`;
      const o = owner.get(k);
      const open = x >= lb.x0 && x <= lb.x1 && y >= lb.y0 && y <= lb.y1;
      const cls = ['cell', open ? 'open' : 'closed'];
      let style = '';
      let label = '';
      if (o) {
        cls.push(o === 'keep' ? 'keep' : 'piece');
        style = `--c:${o === 'keep' ? '#cdbb92' : PIECE_COLOR[o]};`;
        // Outline each building: a dark edge wherever the next tile isn't the same building.
        const edge = (nx: number, ny: number) => (owner.get(`${nx},${ny}`) === o ? 'transparent' : 'rgba(43,33,22,0.75)');
        style += `border-color:${edge(x, y - 1)} ${edge(x + 1, y)} ${edge(x, y + 1)} ${edge(x - 1, y)};`;
        if (!labelled.has(o)) {
          labelled.add(o);
          label = `<span>${o === 'keep' ? 'Keep' : PIECES[o].name}</span>`;
        }
      }
      if (ghostCells.has(k)) cls.push(ghostOk ? 'ghost' : 'ghost bad');
      const se = seams.get(`${k},e`);
      const ss = seams.get(`${k},s`);
      if (se) cls.push(`seam-e-${se}`);
      if (ss) cls.push(`seam-s-${ss}`);
      const title = o === 'keep' ? 'The keep (fixed)' : o ? `${PIECES[o].name}: click to pick up` : open ? 'Open land' : 'Needs a land grant';
      cells += `<div class="${cls.join(' ')}" style="${style}" data-cell data-x="${x}" data-y="${y}" title="${title}">${label}</div>`;
    }
  }
  const waiting = yard(progress.meta, progress.plot).filter((id) => id !== held?.p.id);
  const yardHtml = waiting.length
    ? waiting.map((id) => `<button type="button" data-yard="${id}" style="--c:${PIECE_COLOR[id]}">${PIECES[id].name}</button>`).join('')
    : '<small>Empty: every building stands on the plot.</small>';
  const pairHtml = pairs.length
    ? pairs.map((pr) => `<li class="${pr.kind}">${pr.text}</li>`).join('')
    : '<li><small>Put related buildings side by side for bonuses.</small></li>';
  const hand = held
    ? `<p class="hand">In your hand: <b>${PIECES[held.p.id].name}</b>. Click the plot to put it down, <kbd>R</kbd> or right-click to turn it. <button type="button" data-drop>Put it in the yard</button></p>`
    : '<p class="hand"><small>Click a building to pick it up. Buildings only work while they stand on the plot.</small></p>';
  return `<h2>The town plot</h2>${hand}
    <div class="plotgrid" style="--w:${PLOT_W};--h:${PLOT_H}">${cells}</div>
    <div class="plotside"><div><h3>Builders' yard</h3><div class="yard">${yardHtml}</div></div><div><h3>Neighbours</h3><ul class="pairs">${pairHtml}</ul></div></div>`;
}

$('town').addEventListener('mouseover', (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
  const next = cell ? { x: Number(cell.dataset.x), y: Number(cell.dataset.y) } : null;
  if (next?.x === plotHover?.x && next?.y === plotHover?.y) return;
  plotHover = next;
  if (held) renderPlot();
});
$('town').addEventListener('contextmenu', (e) => {
  if (!held || !(e.target as HTMLElement).closest('.plotgrid')) return;
  e.preventDefault();
  rotateHeld();
});
window.addEventListener('keydown', (e) => {
  if ($('town').hidden || !held) return;
  if (e.code === 'KeyR') rotateHeld();
  if (e.code === 'Escape') {
    held = null;
    renderPlot();
  }
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
  $('lostParries').textContent = String(game.parries);
  $('lostPerfects').textContent = String(game.perfects);
  $('lostGold').textContent = String(Math.round(game.goldEarned));
  $('lostQueen').textContent = queenVerdict(game, won);
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
  if (!game.shopOpen) {
    shaping = null;
    dragFix = null;
  }
  let terrainGhost: Parameters<typeof view.setTerrainGhost>[0] = null;
  let fixGhost: Parameters<typeof view.dragFixture>[0] = null;
  if (building) {
    view.hideGhost();
    const plan = game.towerPlan(input.x, input.y);
    const cost = game.storeyCostAt(input.x, input.y);
    const ok = plan.ok && game.gold >= cost;
    const tag = hud.placeTag;
    tag.hidden = false;
    tag.classList.toggle('bad', !ok);
    const reach = (n: number) => Math.round((game.cfg.towers.reach[n - 1] - 1) * 100);
    const text = !plan.ok ? plan.why : !ok ? `Not enough gold (${cost})` : plan.stack ? `Raise to ${plan.stack.storeys + 1} storeys, ${cost} gold: +${reach(plan.stack.storeys + 1)}% reach on top` : `Build a tower here, ${cost} gold: +${reach(1)}% reach on top`;
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
  } else if (shaping) {
    view.hideGhost();
    const ok = game.canPlaceTerrain(shaping, input.x, input.y, shapeAngle);
    terrainGhost = { kind: shaping, x: input.x, y: input.y, angle: shapeAngle, ok };
    const s = game.cfg.shaping;
    showTag(ok ? `${SHAPE_NAMES[shaping]}: click to place, ${game.shapeLeft(shaping)} left${shaping === 'barricade' ? ' · R / wheel turns' : ''}`
      : game.shapeLeft(shaping) <= 0 ? 'None left' : input.y < s.minY || input.y > s.maxY ? 'Too near the wall or too far up the field' : 'Blocked: keep clear of trees, edges and other pieces', input.x, input.y, 1.5, !ok);
    canvas.style.cursor = 'none';
  } else if (dragFix) {
    view.hideGhost();
    const x = input.x + dragFix.dx;
    const y = input.y + dragFix.dy;
    const ok = game.canMoveContraption(dragFix.index, x, y);
    fixGhost = { index: dragFix.index, x, y, ok };
    showTag(ok ? 'Release to move it here' : "Can't go here: it will snap back", x, y, 2, !ok);
    canvas.style.cursor = 'grabbing';
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
    const hover = planning ? game.defenderAt(input.x, input.y) : undefined;
    const fi = running && !hover ? fixtureAt(input.x, input.y) : -1;
    const ti = running && !hover && fi < 0 ? terrainAt(input.x, input.y) : -1;
    if (fi >= 0) showTag('Drag to move (bumpers and ramps)', input.x, input.y, 2, false);
    else if (ti >= 0) showTag(`Click to take ${SHAPE_NAMES[game.obstacles[ti].look as TerrainKind] ?? 'it'} back`, input.x, input.y, 1.5, false);
    else updatePlaceTag(undefined, false, -1);
    canvas.style.cursor = hover ? 'grab' : fi >= 0 ? 'grab' : ti >= 0 ? 'pointer' : '';
  }
  view.setTerrainGhost(terrainGhost);
  view.dragFixture(fixGhost);
  view.setPlanning(planning, preview, game.shopOpen);
  // The gold aim shape: while aiming, and for the defender whose card is open.
  const shown = aiming?.id ?? selected;
  view.showAim(running && shown !== null ? game.defenders.find((d) => d.id === shown) ?? null : null);
  // Clicks while aiming or building go through the wave banner to the field.
  hud.preview.style.pointerEvents = aiming || building || placing || shaping ? 'none' : '';
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
          // No hit-stop on a Perfect Return: freezing the sim would make the other balls harder to track.
          if (ev.parry && !ev.perfect) hitStop = Math.max(hitStop, 0.04);
          if (ev.parry || ev.trick) sounds.clang(ev.parry);
          else sounds.clink();
          if (ev.trick) floater('Trick shot!', ev.x, game.cfg.shield.y, 'trick', 0.9);
          break;
        case 'perfect':
          // Heave timed just right: a second, heavier clang layered over the parry's.
          sounds.clang(true);
          floater('PERFECT!', ev.x, game.cfg.shield.y, 'trick', 0.9);
          break;
        case 'bowl':
          if (ev.count < 2) break;
          {
            const text = BOWL_WORDS[Math.min(ev.count, BOWL_WORDS.length - 1)];
            const pop = bowlPopups.get(ev.chain);
            if (pop && floaters.includes(pop)) {
              pop.el.textContent = text;
              pop.el.className = `floater bowling b${Math.min(ev.count, 4)}`;
              pop.x = ev.x;
              pop.y = ev.y;
              pop.t = 0.05;
              pop.life = 1.4;
            } else {
              bowlPopups.set(ev.chain, floater(text, ev.x, ev.y, `bowling b${Math.min(ev.count, 4)}`, 1.4));
            }
          }
          break;
        case 'bowlHit': {
          // Limit the thuds so a big chain (or several balls) doesn't pile up sounds.
          const now = performance.now();
          if (now - lastBowlSound > 90) {
            lastBowlSound = now;
            if (ev.armoured) sounds.clang(false);
            else sounds.thunk();
          }
          break;
        }
        case 'bowlEnd':
          bowlPopups.delete(ev.chain);
          if (ev.bonus > 0) {
            floater(`+${ev.bonus}`, ev.x, ev.y - 1.5, 'smash', 1.1);
            sounds.chime(Math.min(1, ev.count / 5));
          }
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
        case 'clang':
          sounds.clang(false);
          break;
        case 'formationBreak':
          sounds.thunk();
          floater('FORMATION BROKEN!', ev.x, ev.y + 1.5, 'smash', 1);
          break;
        case 'bumper':
          sounds.clang(false);
          floater('BUMP!', ev.x, ev.y + 1.5, 'bank', 0.8);
          break;
        case 'bell':
          sounds.bell(ev.rung);
          floater('DING!', ev.x, ev.y + 1.5, 'trick', 0.8);
          break;
        case 'bellVolley':
          sounds.chime(2);
          floater('VOLLEY!', ev.x, ev.y + 4, 'smash', 1.2);
          break;
        case 'rampLaunch':
          sounds.thunk();
          break;
        case 'rampLand':
          sounds.boom();
          floater('DROP!', ev.x, ev.y + 1, 'smash', 1);
          break;
        case 'treeDown':
          sounds.crunch(12);
          break;
        case 'defenderPlaced':
          // The unit drops in: a shout as it falls, the thunk as it lands (the scene's drop takes dropSeconds).
          if (now - lastVoice > 120) {
            lastVoice = now;
            sounds.voice(ev.kind);
          }
          setTimeout(() => sounds.thunk(), game.cfg.setupFx.dropSeconds * 1000);
          break;
        case 'terrainPlaced':
          if (ev.kind === 'rubble') sounds.crunch(6);
          else sounds.thunk();
          break;
        case 'terrainRemoved':
          sounds.rattle();
          break;
        case 'contraptionMoved':
          sounds.thunk();
          break;
        case 'obstacle':
          if (game.obstacles[ev.index]?.placed) sounds.thunk();
          break;
        case 'battleReady':
          sounds.horn();
          showBanner('BATTLE READY!');
          ready = true;
          tour = -1;
          break;
        case 'line':
          hitStop = Math.max(hitStop, 0.06);
          floater('SMASH!', (ev.x0 + ev.x1) / 2, ev.y, 'smash', 0.9);
          break;
        case 'combo':
          floater(`×${ev.combo} COMBO!`, ev.x, ev.y, `c${ev.combo}`, 1.4);
          sounds.chime(ev.combo >= 40 ? 3 : ev.combo >= 25 ? 2 : 1);
          break;
        case 'pinned':
          if (game.time - lastPinned >= 0.5 || game.time < lastPinned) {
            lastPinned = game.time;
            floater('Pinned', ev.x, ev.y + 1, 'bad', 0.7);
          }
          break;
        case 'powderBlast':
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
        case 'mageBlast':
          sounds.mage();
          break;
        case 'ballistaFired':
          sounds.ballista();
          break;
        case 'oilPour':
          sounds.oil();
          break;
        case 'spikeHit':
          sounds.spike();
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
  if (bannerT > 0 && (bannerT -= dt) <= 0) $('banner').hidden = true;
  updateGhost();
  sounds.scrape(running && game.phase === 'battle' ? Math.abs(game.shield.vx) / game.cfg.shield.speed : 0);
  // The horde swells with the crowd on the field (and mutters while it waits up the far end).
  const crowd = running && !game.over ? (game.phase === 'battle' ? game.enemies.length : 0) : 0;
  sounds.horde(Math.sqrt(Math.min(1, crowd / 500)));
  view.render(dt, now / 1000);
  updateHud(dt);
  updateShop();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
