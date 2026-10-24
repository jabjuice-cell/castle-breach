/**
 * Wave-by-wave trace of one headless run, for balance work.
 * Usage: npm run trace -- [idle|builder|skilled] [seed]
 */
import { builderBot, idleBot, skilledBot } from '../src/sim/bot';
import { Game } from '../src/sim/game';
const bots = { idle: idleBot, builder: builderBot, skilled: skilledBot };
const bot = bots[(process.argv[2] ?? 'builder') as keyof typeof bots];
const game = new Game(Number(process.argv[3] ?? 1));
let minHp = 1e9; let waveStart = 0; let maxEnemies = 0;
for (let i = 0; i < 60 * 60 * 60 && !game.over; i++) {
  bot(game); game.step();
  minHp = Math.min(minHp, ...game.segmentHp);
  maxEnemies = Math.max(maxEnemies, game.enemies.length);
  for (const ev of game.events) {
    if (ev.type === 'waveStart') waveStart = game.time;
    if (ev.type === 'waveCleared' || ev.type === 'lost') {
      console.log(`w${game.wave} ${ev.type} t=${(game.time - waveStart).toFixed(0)}s minWall=${minHp.toFixed(0)} gold=${game.gold.toFixed(0)} peak=${maxEnemies} defs=${game.defenders.map((d) => d.kind[0]).join('')}+${game.companies}s lv=${Object.entries(game.levels).map(([k, v]) => `${k} ${Object.values(v).join('/')}`).join(', ')}`);
      minHp = 1e9; maxEnemies = 0;
    }
  }
  game.events.length = 0;
}
console.log(game.phase, (game.time / 60).toFixed(1), 'min');
