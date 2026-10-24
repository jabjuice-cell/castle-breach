/**
 * Headless balance runner: plays many seeded runs with the paddle bots and
 * reports how far each gets.
 * Usage: npm run sim -- [runs] ['{"group": {"key": value}}' config overrides]
 * Each bot plays a first run (crossbow only) and a veteran run (all defenders unlocked).
 */
import { type Bot, averageBot, expertBot, expertRandomBot, idleBot } from '../src/sim/bot';
import { makeConfig } from '../src/sim/config';
import { Game } from '../src/sim/game';

const runs = Number(process.argv[2] ?? 20);
const overrides = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const ALL = ['crossbow', 'archers', 'catapult', 'soldiers'];

function play(make: () => Bot, seed: number, veteran: boolean) {
  const cfg = makeConfig(overrides);
  if (veteran) cfg.unlocks.defenders = ALL;
  const game = new Game(seed, cfg);
  const bot = make();
  const limit = 60 * 60 * 60; // an hour of game time
  let wave1Blocked = -1;
  for (let i = 0; i < limit && !game.over; i++) {
    bot(game);
    game.step();
    if (wave1Blocked < 0 && game.cleared >= 1) wave1Blocked = game.blocked / Math.max(1, game.blocked + game.missed);
    game.events.length = 0;
  }
  return {
    waves: game.wavesSurvived,
    won: game.phase === 'won',
    minutes: game.time / 60,
    kills: game.kills,
    heaves: game.parries,
    blockedShare: game.blocked / Math.max(1, game.blocked + game.missed),
    wave1: Math.max(0, wave1Blocked),
    combo: game.bestCombo,
    gold: game.goldEarned,
    renown: game.renownEarned,
  };
}

type Result = ReturnType<typeof play>;

for (const veteran of [false, true]) {
  console.log(veteran ? '-- veteran (all defenders) --' : '-- first run (crossbow only) --');
  for (const [name, bot] of [['idle', idleBot], ['average', averageBot], ['expert', expertBot], ['exp+rand', expertRandomBot]] as const) {
    const results = Array.from({ length: runs }, (_, i) => play(bot, i + 1, veteran));
    const waves = results.map((r) => r.waves).sort((a, b) => a - b);
    const avg = (k: Exclude<keyof Result, 'won'>) => results.reduce((s, r) => s + r[k], 0) / runs;
    const wins = results.filter((r) => r.won).length;
    console.log(
      `${name.padEnd(8)} waves: min ${waves[0]}, median ${waves[Math.floor(runs / 2)]}, max ${waves[runs - 1]}` +
        ` | won ${wins}/${runs} | ${avg('minutes').toFixed(1)} min | ${avg('kills').toFixed(0)} kills` +
        ` | blocked ${(avg('blockedShare') * 100).toFixed(0)}% (wave 1 ${(avg('wave1') * 100).toFixed(0)}%)` +
        ` | best combo ${avg('combo').toFixed(0)} | ${avg('heaves').toFixed(0)} heaves | ${avg('gold').toFixed(0)} gold | ${avg('renown').toFixed(0)} Renown`,
    );
  }
}
