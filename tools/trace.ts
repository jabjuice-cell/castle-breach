/**
 * Wave-by-wave trace of one headless run, for balance work.
 * Usage: npm run trace -- [idle|average|expert] [seed] [veteran]
 */
import { averageBot, expertBot, expertRandomBot, idleBot } from '../src/sim/bot';
import { makeConfig } from '../src/sim/config';
import { Game } from '../src/sim/game';
const bots = { idle: idleBot, average: averageBot, expert: expertBot, random: expertRandomBot };
const bot = bots[(process.argv[2] ?? 'average') as keyof typeof bots]();
const cfg = makeConfig();
if (process.argv[4] === 'veteran') cfg.unlocks.defenders = ['crossbow', 'archers', 'catapult', 'soldiers'];
const game = new Game(Number(process.argv[3] ?? 1), cfg);
let minHp = 1e9; let waveStart = 0; let maxEnemies = 0; let maxBalls = 0;
for (let i = 0; i < 60 * 60 * 60 && !game.over; i++) {
  bot(game); game.step();
  minHp = Math.min(minHp, ...game.segmentHp);
  maxEnemies = Math.max(maxEnemies, game.enemies.length);
  maxBalls = Math.max(maxBalls, game.balls.length);
  for (const ev of game.events) {
    if (ev.type === 'waveStart') waveStart = game.time;
    if (ev.type === 'waveCleared' || ev.type === 'lost') {
      console.log(`w${game.wave} ${ev.type} t=${(game.time - waveStart).toFixed(0)}s minWall=${minHp.toFixed(0)} gold=${game.gold.toFixed(0)} peak=${maxEnemies} balls=${maxBalls} blocked=${game.blocked}/${game.blocked + game.missed} lost=${game.ballsLost} combo=${game.bestCombo} defs=${game.defenders.map((d) => d.kind[0] + d.spot).join(',')} shield=${Object.values(game.shieldLevels).join('/')}`);
      minHp = 1e9; maxEnemies = 0; maxBalls = 0;
    }
  }
  game.events.length = 0;
}
console.log(game.phase, (game.time / 60).toFixed(1), 'min', Object.entries(game.wallDamage).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
