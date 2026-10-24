import { BattleScene } from './render/scene';
import { Game, STEP } from './sim/game';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('game');
let game = new Game(Math.floor(Math.random() * 1e9));
const view = new BattleScene(canvas, game);

let running = false;
const input = { x: 0, y: 30, mouseDown: false, spaceDown: false };

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
  if (e.button === 0) input.mouseDown = true;
  if (e.button === 2 && running) game.slap(input.x, input.y);
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 0) input.mouseDown = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    input.spaceDown = true;
    e.preventDefault();
  }
  if (e.code === 'KeyF' && running) game.slap(input.x, input.y);
  if (e.code === 'Enter' && running) game.skipPreview();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') input.spaceDown = false;
});
window.addEventListener('blur', () => {
  input.mouseDown = false;
  input.spaceDown = false;
});

$('play').addEventListener('click', () => {
  $('intro').hidden = true;
  running = true;
});
$('startNow').addEventListener('click', () => game.skipPreview());
$('again').addEventListener('click', () => {
  game = new Game(Math.floor(Math.random() * 1e9));
  view.setGame(game);
  buildHud();
  $('lost').hidden = true;
  running = true;
});

// ---- HUD -------------------------------------------------------------------

const hud = {
  wave: $('waveLabel'),
  phase: $('phaseLabel'),
  gold: $('gold'),
  kills: $('kills'),
  shieldText: $('shieldText'),
  shieldBar: $('shieldBar'),
  vigor: $('vigor'),
  wallBars: $('wallBars'),
  preview: $('preview'),
  previewTitle: $('previewTitle'),
  previewText: $('previewText'),
  markers: $('markers'),
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

let markerPlan = -1;
function updateMarkers() {
  const show = game.phase === 'preview';
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
        el.textContent = `${g.count}${g.kind === 'chucker' ? ' chucker' : ''}`;
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

function updateHud() {
  const c = game.cfg;
  hud.wave.textContent = `Wave ${Math.max(1, game.phase === 'preview' ? game.plan.number : game.wave)}`;
  hud.phase.textContent = game.phase === 'preview' ? 'Incoming' : game.phase === 'battle' ? `${game.enemies.length} orcs on the field` : game.phase === 'won' ? 'Victory' : 'Breached';
  hud.gold.textContent = `${game.gold} gold`;
  hud.kills.textContent = `${game.kills} slain`;

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
  if (previewing) {
    const t = game.plan.totals;
    hud.previewTitle.textContent = `Wave ${game.plan.number} marches in ${Math.ceil(game.phaseTimer)}`;
    hud.previewText.textContent = [plural(t.grunt, 'grunt'), t.chucker ? plural(t.chucker, 'chucker') : ''].filter(Boolean).join(' and ');
  }
  updateMarkers();
}

const sides = ['far left', 'left', 'middle', 'right', 'far right'];

function showEnd(won: boolean, segment = 0) {
  $('lostWaves').textContent = String(game.wavesSurvived);
  $('lostKills').textContent = String(game.kills);
  $('lostParries').textContent = String(game.parries);
  $('endTitle').textContent = won ? 'The castle holds!' : 'Breached!';
  $('lostText').textContent = won
    ? `All ${game.cfg.waves.finalWave} waves beaten back. The orcs are already planning something stupider.`
    : `The orcs broke through the ${sides[segment] ?? 'wall'} wall during wave ${game.wave}.`;
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
}
buildHud();

// ---- loop ------------------------------------------------------------------

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    game.setShield(input.x, input.mouseDown || input.spaceDown);
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
    }
    game.events.length = 0;
  }
  view.setCursor(input.x, input.y, game.vigor >= game.cfg.slap.vigorCost);
  view.render(dt, now / 1000);
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
