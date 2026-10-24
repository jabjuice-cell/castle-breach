import wallStatesUrl from './assets/castle/wall-damage-states.png';
import callWaveUrl from './assets/icons/call-wave.png';
import goldUrl from './assets/icons/gold.png';
import renownUrl from './assets/icons/renown.png';
import shieldUrl from './assets/icons/shield.png';
import slapUrl from './assets/icons/slap.png';
import vigorUrl from './assets/icons/vigor.png';
import queenUrl from './assets/characters/queen.png';
import { queenAdvice } from './queen';
import { BattleScene, QUALITIES, type Quality } from './render/scene';
import { Sounds } from './render/sound';
import { type DefenderKind, PLACED_KINDS, type PlacedKind, SPECIAL_NAMES, TRACKS, type Track } from './sim/defenders';
import { Game, STEP } from './sim/game';
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

// Dev aid: ?debug exposes the live game to the console and browser tests.
if (new URLSearchParams(location.search).has('debug')) {
  Object.defineProperty(window, 'game', { get: () => game });
}
const input = { x: 0, y: 30, mouseDown: false, spaceDown: false };
/** The defender being placed after a purchase, or the one being dragged to a new spot. */
let placing: PlacedKind | null = null;
let dragging: number | null = null;

/** Defenders can be picked up and moved between waves (the War Council and the preview). */
const canArrange = () => running && (game.phase === 'council' || game.phase === 'preview');

function resize() {
  view.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// ---- input -----------------------------------------------------------------

function pointerToSim(e: PointerEvent | MouseEvent) {
  const r = canvas.getBoundingClientRect();
  const hit = view.pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  if (hit) {
    input.x = hit.x;
    input.y = hit.y;
  }
}

canvas.addEventListener('pointermove', pointerToSim);
canvas.addEventListener('pointerdown', (e) => {
  pointerToSim(e);
  if (e.button === 2) {
    if (placing) cancelPlacing();
    else if (running) game.slap(input.x, input.y);
    return;
  }
  if (e.button !== 0) return;
  if (placing) {
    const kind = placing;
    if (game.place(kind, input.x, input.y)) {
      placing = null;
      toast(`${DEFENDER_INFO[kind].name} in position`);
      renderCouncil();
    } else {
      toast(game.canPlace(kind, input.x, input.y) ? 'Not enough gold' : "Can't put it there");
    }
    return;
  }
  if (canArrange()) {
    const d = game.defenderAt(input.x, input.y);
    if (d) {
      dragging = d.id;
      return;
    }
  }
  input.mouseDown = true;
});
window.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  input.mouseDown = false;
  if (dragging !== null) {
    if (!game.move(dragging, input.x, input.y)) toast("Can't put it there");
    dragging = null;
  }
});

function cancelPlacing() {
  placing = null;
  renderCouncil();
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    input.spaceDown = true;
    e.preventDefault();
  }
  if (e.code === 'KeyF' && running) game.slap(input.x, input.y);
  if (e.code === 'Escape' && placing) cancelPlacing();
  if (e.code === 'Enter' && running && game.phase !== 'council') game.callEarly();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') input.spaceDown = false;
});
window.addEventListener('blur', () => {
  input.mouseDown = false;
  input.spaceDown = false;
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
  rider: ['boar rider', 'boar riders'],
  orcCatapult: ['orc catapult', 'orc catapults'],
  ogre: ['ogre', 'ogres'],
  warlord: ['WARLORD', 'WARLORDS'],
};

const DEFENDER_INFO: Record<DefenderKind, { name: string; blurb: string }> = {
  crossbow: { name: 'Giant crossbow', blurb: 'Hunts catapults, ogres and warlords first. Bolts pierce a column.' },
  archers: { name: 'Archers', blurb: 'Thirty bowmen loose volleys high into the sky onto the thickest crowd.' },
  catapult: { name: 'Catapult', blurb: 'Lobs a stone into the thickest crowd and blows a crater.' },
  soldiers: { name: 'Soldier company', blurb: 'Forty soldiers along the foot of the wall: the last line of defence. The fallen return each wave.' },
};

const TRACK_NAMES: Record<Track, string> = { damage: 'Damage', rate: 'Rate of fire', special: '' };

function count(n: number, kind: EnemyKind) {
  return `${n} ${ENEMY_NAMES[kind][n === 1 ? 0 : 1]}`;
}

function planText() {
  const t = game.plan.totals;
  return ENEMY_KINDS.filter((k) => t[k] > 0).map((k) => count(t[k], k)).join(', ');
}

// ---- HUD -------------------------------------------------------------------

const hud = {
  wave: $('waveLabel'),
  phase: $('phaseLabel'),
  gold: $('gold'),
  kills: $('kills'),
  renown: $('renown'),
  shieldText: $('shieldText'),
  shieldBar: $('shieldBar'),
  vigor: $('vigor'),
  wallBars: $('wallBars'),
  preview: $('preview'),
  previewTitle: $('previewTitle'),
  previewText: $('previewText'),
  startNow: $('startNow'),
  callEarly: $<HTMLButtonElement>('callEarly'),
  boss: $('boss'),
  bossBar: $('bossBar'),
  markers: $('markers'),
  council: $('council'),
  toast: $('toast'),
  bottom: $('bottom'),
  queen: $('queen'),
  queenText: $('queenText'),
};

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
        el.className = `marker ${g.kind}`;
        el.textContent = g.kind === 'grunt' ? String(g.count) : count(g.count, g.kind);
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

  const s = game.shield;
  hud.shieldBar.style.transform = `scaleX(${s.energy / c.shield.maxEnergy})`;
  hud.shieldBar.classList.toggle('locked', s.locked);
  hud.shieldText.textContent = s.locked ? 'Recovering' : s.raised ? 'Raised' : 'Ready';
  game.segmentHp.forEach((hp, i) => {
    const el = hud.wallBars.children[i] as HTMLElement;
    const f = hp / c.wall.segmentHp;
    const p = view.project(-c.field.halfWidth + (i + 0.5) * game.segmentWidth(), -1, 6.2);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.classList.toggle('warn', f < c.wall.warnBelow);
    (el.firstElementChild!.firstElementChild as HTMLElement).style.transform = `scaleX(${f})`;
  });
  Array.from(hud.vigor.children).forEach((pip, i) => {
    (pip as HTMLElement).style.setProperty('--f', String(Math.max(0, Math.min(1, game.vigor - i))));
  });

  const previewing = game.phase === 'preview' && running;
  hud.preview.hidden = !previewing;
  hud.queen.hidden = !previewing;
  if (previewing) {
    hud.previewTitle.textContent = `${game.plan.boss ? 'Boss wave! ' : ''}Wave ${game.plan.number} marches in ${Math.ceil(game.phaseTimer)}`;
    hud.previewText.textContent = planText();
    hud.queenText.textContent = queenAdvice(game);
    hud.startNow.innerHTML = `${icon('call')}Start now, +${game.earlyCallGold()} gold <kbd>Enter</kbd>`;
  }

  const tail = game.phase === 'battle' && game.canCallEarly();
  hud.callEarly.hidden = !tail;
  if (tail) hud.callEarly.innerHTML = `${icon('call')}Sound the horn: call wave ${game.wave + 1} now, +${game.earlyCallGold()} gold <kbd>Enter</kbd>`;

  const lord = game.enemies.find((e) => e.kind === 'warlord');
  hud.boss.hidden = !lord;
  if (lord) hud.bossBar.style.transform = `scaleX(${Math.max(0, lord.hp / lord.maxHp)})`;

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) hud.toast.hidden = true;
  }
  updateMarkers();
}

// ---- War Council ---------------------------------------------------------

function trackEffect(kind: DefenderKind, track: Track): string {
  const lv = game.levels[kind][track];
  if (track !== 'special') return `+${Math.round((game.mult(kind, track) - 1) * 100)}%`;
  if (kind === 'crossbow') return `pierces ${game.crossbowPierce()}`;
  if (kind === 'archers') return lv ? `burns ${game.arrowBurn().toFixed(1)}/s` : 'not lit';
  if (kind === 'catapult') return `radius ${game.catapultSplash().toFixed(1)}`;
  return `${Math.round(game.soldierHp())} HP each`;
}

function councilHtml(): string {
  const gold = Math.floor(game.gold);
  const btn = (action: string, label: string, cost: number, disabled = false) =>
    `<button type="button" data-action="${action}" ${disabled || cost > gold ? 'disabled' : ''}>${label} <span class="cost">${cost}g</span></button>`;

  const full = game.defenders.length >= game.cfg.castle.maxDefenders;
  const recruits = PLACED_KINDS.map((k) => {
    const n = game.count(k);
    const label = placing === k ? 'Click the castle…' : n ? 'Place another' : 'Place';
    return `<div class="row${placing === k ? ' placing' : ''}"><div><b>${DEFENDER_INFO[k].name}</b><small>${n ? `${n} placed · ` : ''}${DEFENDER_INFO[k].blurb}</small></div>${btn(`place:${k}`, label, game.defenderCost(k), full)}</div>`;
  }).join('');
  const companies = game.companies;
  const maxCompanies = game.cfg.soldiers.maxCompanies;
  const soldiers = `<div class="row"><div><b>${DEFENDER_INFO.soldiers.name}</b><small>${companies} of ${maxCompanies} raised · ${DEFENDER_INFO.soldiers.blurb}</small></div>${
    companies < maxCompanies ? btn('soldiers', 'Raise', game.defenderCost('soldiers')) : '<small>Full</small>'}</div>`;
  const slots = `${recruits}${soldiers}<p class="tip">${placing ? 'Click anywhere on the wall, the towers or the courtyard. Right click or Esc to cancel.' : 'Drag your defenders on the castle to move them, here or while the next wave lines up.'}</p>`;

  const owned = (Object.keys(DEFENDER_INFO) as DefenderKind[]).filter((k) => game.owns(k));
  const upgrades = owned
    .map((kind) => {
      const tracks = TRACKS.filter((t) => kind !== 'soldiers' || t !== 'rate')
        .map((t) => {
          const name = t === 'special' ? SPECIAL_NAMES[kind] : TRACK_NAMES[t];
          return `<div class="track"><span>${name} <i>Lv ${game.levels[kind][t]}</i><small>${trackEffect(kind, t)}</small></span>${btn(`up:${kind}:${t}`, 'Upgrade', game.upgradeCost(kind, t))}</div>`;
        })
        .join('');
      return `<div class="def"><b>${DEFENDER_INFO[kind].name}</b><small>${DEFENDER_INFO[kind].blurb}</small>${tracks}</div>`;
    })
    .join('');

  const sides = ['Far left', 'Left', 'Gate', 'Right', 'Far right'];
  const walls = game.segmentHp
    .map((hp, i) => {
      const cost = game.repairCost(i);
      const pct = Math.round((hp / game.cfg.wall.segmentHp) * 100);
      // The four painted states: sound, chipped, cracked, crumbling.
      const state = pct > 75 ? 0 : pct > 50 ? 1 : pct > 25 ? 2 : 3;
      return `<div class="row wall"><div><i class="wallimg" style="background-position: ${state * 33.333}% 0"></i><span><b>${sides[i] ?? `Wall ${i + 1}`}</b><small>${pct}%</small></span></div>${cost > 0 ? btn(`repair:${i}`, 'Repair', Math.min(cost, Math.max(1, gold)), gold < 1) : '<small>Sound</small>'}</div>`;
    })
    .join('');

  const next = game.plan;
  return `
    <header><h2>War Council</h2><span class="purse g">${icon('gold')}${gold} gold</span></header>
    <div class="queen"><img src="${queenUrl}" alt="The Queen" /><p><b>The Queen</b>${queenAdvice(game)}</p></div>
    <p class="next">${next.boss ? '<b class="danger">Boss wave.</b> ' : ''}Wave ${next.number} brings ${planText()}.</p>
    <section><h3>Defenders</h3>${slots}</section>
    ${upgrades ? `<section><h3>Upgrades</h3>${upgrades}</section>` : ''}
    <section><h3>Walls</h3>${walls}</section>
    <button type="button" class="go" data-action="go">To battle! <kbd>Enter</kbd></button>`;
}

let councilShown = false;
function renderCouncil() {
  hud.council.innerHTML = councilHtml();
}

function updateCouncil() {
  const open = game.phase === 'council' && running;
  if (open && !councilShown) renderCouncil();
  hud.council.hidden = !open;
  hud.bottom.hidden = open;
  councilShown = open;
}

hud.council.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!el || el.disabled) return;
  const [action, a, b] = el.dataset.action!.split(':');
  if (action === 'place') {
    placing = placing === a ? null : (a as PlacedKind);
  } else if (action === 'soldiers') {
    if (game.buySoldiers()) toast('Soldiers to the wall!');
  } else if (action === 'up') {
    game.upgrade(a as DefenderKind, b as Track);
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

const sides = ['far left', 'left', 'middle', 'right', 'far right'];

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
  $('lostRenown').textContent = String(game.renownEarned);
  $('endTitle').textContent = won ? 'The castle holds!' : 'Breached!';
  $('lostText').textContent = won
    ? `All ${game.cfg.waves.finalWave} waves beaten back. The orcs are already planning something stupider.`
    : `The orcs broke through the ${sides[segment] ?? 'wall'} wall during wave ${game.wave}.`;
  const total = bankRenown(game.renownEarned);
  $('bank').textContent = `${total} Renown banked in total. The research tree to spend it on arrives in the next update.`;
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
}
buildHud();

/** The ring under the mouse while placing or dragging a defender, or over one that can be picked up. */
function updateGhost() {
  if (!canArrange() && dragging !== null) dragging = null;
  if (placing) {
    view.setGhost(input.x, input.y, game.cfg[placing].footprint, game.canPlace(placing, input.x, input.y));
    return;
  }
  const dragged = dragging !== null ? game.defenders.find((d) => d.id === dragging) : undefined;
  if (dragged) {
    view.setGhost(input.x, input.y, game.cfg[dragged.kind].footprint, game.canPlace(dragged.kind, input.x, input.y, dragged.id));
    return;
  }
  const hover = canArrange() ? game.defenderAt(input.x, input.y) : undefined;
  if (hover) view.setGhost(hover.x, hover.y, game.cfg[hover.kind].footprint, true);
  else view.hideGhost();
  canvas.style.cursor = hover ? 'grab' : '';
}

// ---- loop ------------------------------------------------------------------

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    game.setShield(input.x, (input.mouseDown && dragging === null) || input.spaceDown);
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
      if (ev.type === 'lost') showEnd(false, ev.segment);
      if (ev.type === 'won') showEnd(true);
      if (ev.type === 'deflect') sounds.clang(ev.parry);
      if (ev.type === 'waveCleared') toast(`Wave ${ev.wave} beaten back, +${ev.gold} gold`);
      if (ev.type === 'calledEarly') toast(`Early call! +${ev.gold} gold`);
      if (ev.type === 'bossKilled') toast(`The Warlord falls! +${game.cfg.renown.bossKill} Renown`);
    }
    game.events.length = 0;
  }
  updateGhost();
  view.setCursor(input.x, input.y, game.vigor >= game.cfg.slap.vigorCost, game.phase !== 'council' && !placing && dragging === null);
  view.render(dt, now / 1000);
  updateHud(dt);
  updateCouncil();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
