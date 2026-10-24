import wallStatesUrl from './assets/castle/wall-damage-states.webp';
import callWaveUrl from './assets/icons/call-wave.png';
import goldUrl from './assets/icons/gold.png';
import renownUrl from './assets/icons/renown.png';
import shieldUrl from './assets/icons/shield.png';
import slapUrl from './assets/icons/slap.png';
import vigorUrl from './assets/icons/vigor.png';
import queenUrl from './assets/characters/queen.webp';
import { queenAdvice } from './queen';
import { BattleScene, CAPSULE_LOOK, type PlanPreview, QUALITIES, type Quality } from './render/scene';
import { Sounds } from './render/sound';
import { DEFENDER_KINDS, type DefenderKind, type PlacedKind, SPECIAL_NAMES, type Track, USEFUL_TRACKS } from './sim/defenders';
import { Game, SHIELD_TRACKS, STEP, type ShieldTrack } from './sim/game';
import { ENEMY_KINDS, type EnemyKind } from './sim/waves';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ICONS: Record<string, string> = { gold: goldUrl, renown: renownUrl, shield: shieldUrl, slap: slapUrl, vigor: vigorUrl, call: callWaveUrl };
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
let game = new Game(Math.floor(Math.random() * 1e9));
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

let running = false;

// Dev aid: ?debug exposes the live game to the console and browser tests; ?debug&auto plays the shield by itself.
const params = new URLSearchParams(location.search);
if (params.has('debug')) {
  Object.defineProperty(window, 'game', { get: () => game });
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
/** The mouse on the ground (for slaps and placing) and along the shield's line. */
const input = { x: 0, y: 30, shieldX: 0 };
/** The defender being placed after a purchase, or the one being dragged to a new spot. */
let placing: PlacedKind | null = null;
let dragging: number | null = null;

/** Defenders can be picked up and moved freely between waves; mid-battle it costs gold (hold Shift). */
const canArrange = (e?: { shiftKey: boolean }) =>
  running && (game.phase === 'council' || game.phase === 'preview' || (game.phase === 'battle' && !!e?.shiftKey));

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

/** Places the defender being bought: on the open spot under the mouse, or opens a closed one first if gold allows. */
function tryPlace(kind: PlacedKind) {
  if (game.place(kind, input.x, input.y)) {
    placing = null;
    toast(`${DEFENDER_INFO[kind].name} in position`);
    sounds.thunk();
    renderCouncil();
    return;
  }
  const closed = nearestSpot(input.x, input.y, false);
  if (closed !== undefined && game.gold >= game.spotCost() + game.defenderCost(kind)) {
    const spot = game.spots[closed];
    game.openSpot(closed);
    if (game.place(kind, spot.x, spot.y)) {
      placing = null;
      toast(`Spot opened, ${DEFENDER_INFO[kind].name.toLowerCase()} in position`);
      sounds.thunk();
      renderCouncil();
      return;
    }
  }
  toast(closed !== undefined ? 'Not enough gold to open that spot' : game.canPlace(kind, input.x, input.y) ? 'Not enough gold' : 'Pick an open spot on the castle');
}

/** The nearest spot to (x, y) within snapping distance that is open (or closed), if any. */
function nearestSpot(x: number, y: number, open: boolean): number | undefined {
  let best: number | undefined;
  let bestD = game.cfg.castle.snap;
  for (const s of game.spots) {
    if (game.openSpots[s.id] !== open) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      best = s.id;
      bestD = d;
    }
  }
  return best;
}

canvas.addEventListener('pointermove', pointerToSim);
canvas.addEventListener('pointerdown', (e) => {
  pointerToSim(e);
  sounds.unlock();
  if (e.button === 2) {
    if (placing) cancelPlacing();
    else if (running) game.slap(input.x, input.y);
    return;
  }
  if (e.button !== 0) return;
  if (placing) {
    tryPlace(placing);
    return;
  }
  if (canArrange(e)) {
    const d = game.defenderAt(input.x, input.y);
    if (d) {
      dragging = d.id;
      return;
    }
  }
  if (running) game.heave();
});
window.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || dragging === null) return;
  const cost = game.moveCost();
  if (!game.move(dragging, input.x, input.y)) toast(game.gold < cost ? `Moving costs ${cost} gold mid-battle` : "Can't put it there");
  else if (cost > 0) toast(`Moved for ${cost} gold: it packs up for a moment`);
  dragging = null;
  renderCouncilIfOpen();
});

function cancelPlacing() {
  placing = null;
  renderCouncil();
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (running && !e.repeat) game.heave();
  }
  if (e.code === 'KeyF' && running) game.slap(input.x, input.y);
  if (e.code === 'Escape' && placing) cancelPlacing();
  if (e.code === 'Enter' && running && game.phase !== 'council') game.callEarly();
});

$('play').addEventListener('click', () => {
  sounds.unlock();
  $('intro').hidden = true;
  running = true;
});
$('startNow').addEventListener('click', () => game.callEarly());
$('callEarly').addEventListener('click', () => game.callEarly());
$('again').addEventListener('click', () => {
  game = new Game(Math.floor(Math.random() * 1e9));
  placing = null;
  dragging = null;
  view.setGame(game);
  buildHud();
  $('lost').hidden = true;
  running = true;
});

// ---- names -----------------------------------------------------------------

const ENEMY_NAMES: Record<EnemyKind, [string, string]> = {
  grunt: ['grunt', 'grunts'],
  chucker: ['chucker', 'chuckers'],
  barrel: ['barrel orc', 'barrel orcs'],
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
const SHIELD_NAMES: Record<ShieldTrack, string> = { width: 'Width', window: 'Heave timing', power: 'Heave power', recovery: 'Recovery', plating: 'Plating' };
const LANES = ['far left', 'left', 'gate', 'right', 'far right'];

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
  vigor: $('vigor'),
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
  spotLabels: $('spotLabels'),
  floaters: $('floaters'),
  flash: $('flash'),
  council: $('council'),
  toast: $('toast'),
  bottom: $('bottom'),
  queen: $('queen'),
  queenText: $('queenText'),
};

/** Lane markers over the spawn line while the next wave lines up: what is coming down each lane. */
let markerPlan = -1;
function updateMarkers() {
  const show = game.phase === 'preview' || game.phase === 'council';
  if (!show) {
    if (markerPlan !== -1) hud.markers.replaceChildren();
    markerPlan = -1;
    return;
  }
  // Rebuild labels once per plan, then just reposition them (the camera can move on resize/shake).
  if (markerPlan !== game.plan.number) {
    markerPlan = game.plan.number;
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

/** Price tags on the closed spots during the War Council: click one to open it. */
let spotLabelsShown = false;
function updateSpotLabels() {
  const show = running && game.phase === 'council';
  if (!show) {
    if (spotLabelsShown) hud.spotLabels.replaceChildren();
    spotLabelsShown = false;
    return;
  }
  const cost = game.spotCost();
  if (!spotLabelsShown || hud.spotLabels.children.length !== game.spots.length) {
    spotLabelsShown = true;
    hud.spotLabels.replaceChildren(
      ...game.spots.map((s) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'spot';
        el.dataset.spot = String(s.id);
        return el;
      }),
    );
  }
  game.spots.forEach((s, i) => {
    const el = hud.spotLabels.children[i] as HTMLButtonElement;
    el.hidden = game.openSpots[i];
    if (el.hidden) return;
    const p = view.project(s.x, s.y, view.standHeight(s.x, -s.y) + 0.6);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    const label = `🔒 ${cost}g`;
    if (el.textContent !== label) el.textContent = label;
    el.disabled = game.gold < cost;
    el.title = `Open this ${s.kind === 'tower' ? 'tower top (+25% range)' : s.kind === 'courtyard' ? 'courtyard spot (safe, but 20% less range)' : 'wall spot'} for ${cost} gold`;
  });
}
hud.spotLabels.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-spot]');
  if (!el || el.disabled) return;
  if (game.openSpot(Number(el.dataset.spot))) {
    toast('Spot opened');
    sounds.thunk();
    renderCouncil();
  }
});

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
    f.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${u < 0.15 ? 0.6 + u * 2.7 : 1})`;
    f.el.style.opacity = String(u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
  }
}

let toastTimer = 0;
function toast(text: string) {
  hud.toast.textContent = text;
  hud.toast.hidden = false;
  toastTimer = 1.6;
}

function updateHud(dt: number) {
  const c = game.cfg;
  const shownWave = game.phase === 'preview' || game.phase === 'council' ? game.plan.number : game.wave;
  hud.wave.textContent = `Wave ${Math.max(1, shownWave)} of ${c.waves.finalWave}`;
  hud.phase.textContent =
    game.phase === 'council' ? 'War Council'
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
    const frac = hp / c.wall.segmentHp;
    const p = view.project(-c.field.halfWidth + (i + 0.5) * game.segmentWidth(), -1, 6.2);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.classList.toggle('warn', frac < c.wall.warnBelow);
    (el.firstElementChild!.firstElementChild as HTMLElement).style.transform = `scaleX(${frac})`;
  });
  Array.from(hud.vigor.children).forEach((pip, i) => {
    (pip as HTMLElement).style.setProperty('--f', String(Math.max(0, Math.min(1, game.vigor - i))));
  });

  const previewing = game.phase === 'preview' && running;
  hud.preview.hidden = !previewing;
  hud.queen.hidden = !previewing;
  if (previewing) {
    hud.previewTitle.textContent = `${game.plan.boss ? 'Boss wave! ' : ''}Wave ${game.plan.number} marches in ${Math.ceil(game.phaseTimer)}`;
    hud.previewText.textContent = `${planText()}, down ${laneText()}.`;
    hud.queenText.textContent = queenAdvice(game);
    hud.startNow.innerHTML = `${icon('call')}Start now, +${game.earlyCallGold()} gold <kbd>Enter</kbd>`;
  }

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
  updateSpotLabels();
  updateFloaters(dt);
}

// ---- War Council ---------------------------------------------------------

function trackEffect(kind: DefenderKind, track: Track): string {
  const lv = game.levels[kind][track];
  if (track !== 'special') return `+${Math.round((game.mult(kind, track) - 1) * 100)}%`;
  if (kind === 'crossbow') return `pierces ${game.crossbowPierce()}`;
  if (kind === 'archers') return lv ? `burns ${game.arrowBurn().toFixed(1)}/s` : 'not lit';
  return `${Math.round(game.soldierHp())} HP each`;
}

function shieldEffect(track: ShieldTrack): string {
  switch (track) {
    case 'width':
      return `${((game.shieldHalfWidth() * 2) / 1.67).toFixed(1)} tiles wide`;
    case 'window':
      return `${Math.round(game.heaveWindow() * 1000)} ms window`;
    case 'power':
      return `smashes ${game.heaveLines()} line${game.heaveLines() === 1 ? '' : 's'}`;
    case 'recovery':
      return `${game.heaveCooldown().toFixed(2)} s between heaves`;
    case 'plating':
      return `shrugs off ${game.shieldLevels.plating} orc trick${game.shieldLevels.plating === 1 ? '' : 's'} a wave`;
  }
}

function councilHtml(): string {
  const gold = Math.floor(game.gold);
  const btn = (action: string, label: string, cost: number, disabled = false) =>
    `<button type="button" data-action="${action}" ${disabled || cost > gold ? 'disabled' : ''}>${label} <span class="cost">${Number.isFinite(cost) ? `${cost}g` : ''}</span></button>`;

  const freeSpots = game.spots.filter((s) => game.openSpots[s.id] && !game.defenders.some((d) => d.spot === s.id)).length;
  const closedSpots = game.openSpots.filter((o) => !o).length;
  const recruits = DEFENDER_KINDS.map((k) => {
    if (!game.unlocked(k)) return `<div class="row locked"><div><b>${DEFENDER_INFO[k].name}</b><small>Unlocks with Renown in a later run.</small></div><small>🔒</small></div>`;
    const n = game.count(k);
    const label = placing === k ? 'Click a spot…' : n ? 'Place another' : 'Place';
    return `<div class="row${placing === k ? ' placing' : ''}"><div><b>${DEFENDER_INFO[k].name}</b><small>${n ? `${n} placed · ` : ''}${DEFENDER_INFO[k].blurb}</small></div>${btn(`place:${k}`, label, game.defenderCost(k))}</div>`;
  }).join('');
  const tip = placing
    ? 'Click a gold ring on the castle. A grey one opens first if you can afford both. Right click or Esc to cancel.'
    : `${freeSpots} open spot${freeSpots === 1 ? '' : 's'} free, ${closedSpots} still locked (click a 🔒 tag to open one for ${game.spotCost()}g). Tower tops reach 25% further; courtyard spots 20% less. The ground shows what each defender covers; red hatching is a blind spot. Drag defenders to move them.`;
  const slots = `${recruits}<p class="tip">${tip}</p>`;

  const shield = SHIELD_TRACKS.map((t) => {
    const cost = game.shieldCost(t);
    return `<div class="track"><span>${SHIELD_NAMES[t]} <i>Lv ${game.shieldLevels[t]}</i><small>${shieldEffect(t)}</small></span>${Number.isFinite(cost) ? btn(`shield:${t}`, 'Upgrade', cost) : '<small>Max</small>'}</div>`;
  }).join('');

  const owned = DEFENDER_KINDS.filter((k) => game.owns(k));
  const upgrades = owned
    .map((kind) => {
      const tracks = USEFUL_TRACKS[kind]
        .map((t) => {
          const name = t === 'special' ? SPECIAL_NAMES[kind] : TRACK_NAMES[t];
          return `<div class="track"><span>${name} <i>Lv ${game.levels[kind][t]}</i><small>${trackEffect(kind, t)}</small></span>${btn(`up:${kind}:${t}`, 'Upgrade', game.upgradeCost(kind, t))}</div>`;
        })
        .join('');
      return `<div class="def"><b>${DEFENDER_INFO[kind].name}</b>${tracks}</div>`;
    })
    .join('');

  const sides = ['Far left', 'Left', 'Gate', 'Right', 'Far right'];
  const walls = game.segmentHp
    .map((hp, i) => {
      const cost = game.repairCost(i);
      const pct = Math.round((hp / game.cfg.wall.segmentHp) * 100);
      // The four painted states: sound, chipped, cracked, crumbling.
      const state = pct > 75 ? 0 : pct > 50 ? 1 : pct > 25 ? 2 : 3;
      const blind = game.sectionCover(i) === 0 ? ' <b class="danger">blind spot</b>' : '';
      return `<div class="row wall"><div><i class="wallimg" style="background-position: ${state * 33.333}% 0"></i><span><b>${sides[i] ?? `Wall ${i + 1}`}</b><small>${pct}%${blind}</small></span></div>${cost > 0 ? btn(`repair:${i}`, 'Repair', Math.min(cost, Math.max(1, gold)), gold < 1) : '<small>Sound</small>'}</div>`;
    })
    .join('');

  const next = game.plan;
  return `
    <header><h2>War Council</h2><span class="purse g">${icon('gold')}${gold} gold</span></header>
    <div class="queen"><img src="${queenUrl}" alt="The Queen" /><p><b>The Queen</b>${queenAdvice(game)}</p></div>
    <p class="next">${next.boss ? '<b class="danger">Boss wave.</b> ' : ''}Wave ${next.number} brings ${planText()}, down ${laneText()}.</p>
    <section><h3>Defenders</h3>${slots}</section>
    <section><h3>Royal shield</h3><div class="def">${shield}</div></section>
    ${upgrades ? `<section><h3>Defender upgrades</h3>${upgrades}</section>` : ''}
    <section><h3>Walls</h3>${walls}</section>
    <button type="button" class="go" data-action="go">To battle! <kbd>Enter</kbd></button>`;
}

let councilShown = false;
function renderCouncil() {
  const scroll = hud.council.scrollTop;
  hud.council.innerHTML = councilHtml();
  hud.council.scrollTop = scroll;
}
function renderCouncilIfOpen() {
  if (game.phase === 'council') renderCouncil();
}

function updateCouncil() {
  const open = game.phase === 'council' && running;
  if (open && !councilShown) renderCouncil();
  hud.council.hidden = !open;
  hud.bottom.hidden = open;
  // The council lists the walls itself; the bars over them would cover the spots.
  hud.wallBars.hidden = open;
  councilShown = open;
}

hud.council.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!el || el.disabled) return;
  const [action, a, b] = el.dataset.action!.split(':');
  if (action === 'place') {
    placing = placing === a ? null : (a as PlacedKind);
  } else if (action === 'up') {
    game.upgrade(a as DefenderKind, b as Track);
  } else if (action === 'shield') {
    game.upgradeShield(a as ShieldTrack);
  } else if (action === 'repair') {
    game.repair(Number(a));
  } else if (action === 'go') {
    placing = null;
    game.closeCouncil();
  }
  renderCouncil();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && running && game.phase === 'council') {
    e.preventDefault();
    placing = null;
    game.closeCouncil();
  }
});

// ---- end of run ----------------------------------------------------------

function bankRenown(earned: number): number {
  try {
    const total = Number(localStorage.getItem('castle-breach:renown') ?? 0) + earned;
    localStorage.setItem('castle-breach:renown', String(total));
    return total;
  } catch {
    return earned;
  }
}

function showEnd(won: boolean, segment = 0) {
  $('lostWaves').textContent = String(game.wavesSurvived);
  $('lostKills').textContent = String(game.kills);
  $('lostCombo').textContent = String(game.bestCombo);
  $('lostRenown').textContent = String(game.renownEarned);
  $('endTitle').textContent = won ? 'The wall holds!' : 'Breached!';
  $('lostText').textContent = won
    ? `All ${game.cfg.waves.finalWave} waves beaten back. The orcs are already planning something stupider.`
    : `The orcs broke through the ${LANES[segment] ?? ''} wall during wave ${game.wave}.`;
  const total = bankRenown(game.renownEarned);
  $('bank').textContent = `${total} Renown banked in total. The research tree to spend it on arrives in a later update.`;
  $('again').textContent = won ? 'Play again' : 'Try again';
  $('lost').hidden = false;
  running = false;
}

function buildHud() {
  hud.wallBars.replaceChildren(
    ...game.segmentHp.map(() => {
      const el = document.createElement('div');
      el.className = 'seg';
      el.innerHTML = '<div class="bar"><i></i></div>';
      return el;
    }),
  );
  hud.vigor.replaceChildren(...Array.from({ length: game.cfg.slap.vigorMax }, () => document.createElement('i')));
  councilShown = false;
  spotLabelsShown = false;
}
buildHud();

/** The ring under the mouse while placing or dragging a defender, and the planning overlay with its coverage preview. */
function updateGhost() {
  if (dragging !== null && !game.defenders.some((d) => d.id === dragging)) dragging = null;
  const planning = running && (game.phase === 'council' || game.phase === 'preview' || dragging !== null);
  let preview: PlanPreview | null = null;
  const dragged = dragging !== null ? game.defenders.find((d) => d.id === dragging) : undefined;
  const kind = placing ?? dragged?.kind;
  if (kind) {
    const spot = game.spotAt(input.x, input.y, dragged?.id ?? -1);
    const closed = placing ? nearestSpot(input.x, input.y, false) : undefined;
    const target = spot ?? (closed !== undefined ? game.spots[closed] : undefined);
    if (target) {
      view.setGhost(target.x, target.y, game.cfg[kind].footprint, !!spot || game.gold >= game.spotCost() + game.defenderCost(kind));
      preview = { kind, spot: target.id };
    } else {
      view.setGhost(input.x, input.y, game.cfg[kind].footprint, false);
    }
  } else {
    const hover = planning ? game.defenderAt(input.x, input.y) : undefined;
    if (hover) view.setGhost(hover.x, hover.y, game.cfg[hover.kind].footprint, true);
    else view.hideGhost();
    canvas.style.cursor = hover ? 'grab' : '';
  }
  view.setPlanning(planning, preview, game.phase === 'preview' || game.phase === 'council');
}

// ---- loop ------------------------------------------------------------------

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    if (autoplay) autoShield();
    game.setShield(input.shieldX);
    acc += dt;
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
          sounds.clang(ev.parry);
          if (ev.trick) floater('Trick shot!', ev.x, game.cfg.shield.y, 'trick', 0.9);
          break;
        case 'line':
          floater('SMASH!', (ev.x0 + ev.x1) / 2, ev.y, 'smash', 0.9);
          break;
        case 'combo':
          floater(`×${ev.combo} COMBO!`, ev.x, ev.y, `c${ev.combo}`, 1.4);
          sounds.chime(ev.combo >= 40 ? 3 : ev.combo >= 25 ? 2 : 1);
          break;
        case 'blast':
        case 'floorDown':
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
  updateGhost();
  view.setCursor(input.x, input.y, game.vigor >= game.cfg.slap.vigorCost, false);
  view.render(dt, now / 1000);
  updateHud(dt);
  updateCouncil();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
