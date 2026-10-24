/**
 * Headless balance runner: plays many seeded runs with scripted bots and
 * reports how far each gets.
 * Usage: npm run sim -- [runs] ['{"group": {"key": value}}' config overrides]
 */
import { type Bot, builderBot, idleBot, skilledBot } from '../src/sim/bot';
import { makeConfig } from '../src/sim/config';
import { Game } from '../src/sim/game';

const runs = Number(process.argv[2] ?? 20);
const overrides = process.argv[3] ? JSON.parse(process.argv[3]) : {};

function play(bot: Bot, seed: number) {
  const game = new Game(seed, makeConfig(overrides));
  const limit = 60 * 60 * 60; // an hour of game time
  for (let i = 0; i < limit && !game.over; i++) {
    bot(game);
    game.step();
    game.events.length = 0;
  }
  return {
    waves: game.wavesSurvived,
    won: game.phase === 'won',
    minutes: game.time / 60,
    kills: game.kills,
    parries: game.parries,
    gold: game.goldEarned,
    renown: game.renownEarned,
  };
}

type Result = ReturnType<typeof play>;

for (const [name, bot] of [['idle', idleBot], ['builder', builderBot], ['skilled', skilledBot]] as const) {
  const results = Array.from({ length: runs }, (_, i) => play(bot, i + 1));
  const waves = results.map((r) => r.waves).sort((a, b) => a - b);
  const avg = (k: Exclude<keyof Result, 'won'>) => results.reduce((s, r) => s + r[k], 0) / runs;
  const wins = results.filter((r) => r.won).length;
  console.log(
    `${name.padEnd(8)} waves: min ${waves[0]}, median ${waves[Math.floor(runs / 2)]}, max ${waves[runs - 1]}` +
      ` | won ${wins}/${runs} | ${avg('minutes').toFixed(1)} min | ${avg('kills').toFixed(0)} kills` +
      ` | ${avg('gold').toFixed(0)} gold | ${avg('renown').toFixed(0)} Renown | ${avg('parries').toFixed(0)} parries`,
  );
}
