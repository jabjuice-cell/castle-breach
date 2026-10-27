/**
 * Headless balance runner: plays seeded campaigns with the paddle bots and reports
 * how they get on.
 * Usage: npm run sim -- [campaigns] ['{"group": {"key": value}}' config overrides]
 *
 * Fresh: level 1 with no town upgrades at all (it should be lost).
 * Campaign: runs of levels 1 to 3 in order. After each level the bot banks its Renown
 * and spends it in the town (the cheapest upgrade each time). A lost level ends the run
 * and the next run starts again from level 1, until the bot beats all three or runs out of runs.
 */
import { type Bot, averageBot, expertBot, expertRandomBot, idleBot } from '../src/sim/bot';
import { makeConfig } from '../src/sim/config';
import { Game } from '../src/sim/game';
import { META_UPGRADES, type Progress, applyMeta, buyMeta, metaCost, metaLocked, newProgress } from '../src/sim/meta';

const runs = Number(process.argv[2] ?? 10);
const overrides = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const MAX_RUNS = 25;
const LEVELS = makeConfig().levels.names.length;

function playLevel(make: () => Bot, seed: number, progress: Progress) {
  const level = progress.levelsBeaten;
  const game = new Game(seed, applyMeta(progress.meta, level, makeConfig(overrides)), level);
  const bot = make();
  const limit = 60 * 60 * 30; // half an hour of game time
  for (let i = 0; i < limit && !game.over; i++) {
    bot(game);
    game.step();
    game.events.length = 0;
  }
  return game;
}

/** Unlocks the bots can't use, so the town doesn't waste their Renown on them. */
const BOT_BLIND = ['mage', 'ballista', 'oil', 'spiketrap'];

/** The town: buys the cheapest upgrade it can, over and over. */
function shop(p: Progress) {
  for (;;) {
    const options = META_UPGRADES.filter((u) => u.id !== 'plating' && !BOT_BLIND.includes(u.id) && metaCost(p.meta, u.id) <= p.renown && !metaLocked(p.meta, u.id));
    if (!options.length) return;
    options.sort((a, b) => metaCost(p.meta, a.id) - metaCost(p.meta, b.id));
    buyMeta(p, options[0].id);
  }
}

function campaign(make: () => Bot, seed: number) {
  const p = newProgress();
  // The run on which the bot first beat each level.
  const firstBeat: number[] = [];
  let run = 0;
  let plays = 0;
  while (firstBeat.length < LEVELS && run < MAX_RUNS) {
    run++;
    // One run: levels in order until one is lost (a loss starts the next run from level 1).
    p.levelsBeaten = 0;
    while (p.levelsBeaten < LEVELS) {
      const game = playLevel(make, seed * 1000 + plays++, p);
      p.renown += game.renownEarned;
      shop(p);
      if (game.phase !== 'won') break;
      p.levelsBeaten++;
      if (firstBeat.length < p.levelsBeaten) firstBeat.push(run);
    }
  }
  const spent = META_UPGRADES.reduce((n, u) => n + (p.meta[u.id] ?? 0), 0);
  return { firstBeat, upgrades: spent };
}

const median = (xs: number[]) => {
  if (!xs.length) return '-';
  const s = [...xs].sort((a, b) => a - b);
  return String(s[Math.floor(s.length / 2)]);
};

const BOTS = [['idle', idleBot], ['average', averageBot], ['expert', expertBot], ['exp+rand', expertRandomBot]] as const;

console.log('-- fresh: level 1 with no town upgrades --');
for (const [name, bot] of BOTS) {
  const games = Array.from({ length: runs }, (_, i) => playLevel(bot, i + 1, newProgress()));
  const waves = games.map((g) => g.wavesSurvived);
  const wins = games.filter((g) => g.phase === 'won').length;
  const renown = games.reduce((s, g) => s + g.renownEarned, 0) / runs;
  console.log(`${name.padEnd(8)} waves held: median ${median(waves)}, max ${Math.max(...waves)} | won ${wins}/${runs} | ${renown.toFixed(0)} Renown`);
}

console.log(`-- campaign: the run on which each level was first beaten (median), up to ${MAX_RUNS} runs --`);
for (const [name, bot] of BOTS) {
  const results = Array.from({ length: runs }, (_, i) => campaign(bot, i + 1));
  const per = Array.from({ length: LEVELS }, (_, l) => results.filter((r) => r.firstBeat.length > l).map((r) => r.firstBeat[l]));
  console.log(
    `${name.padEnd(8)} ` + per.map((xs, l) => `L${l + 1}: run ${median(xs)} (${xs.length}/${runs})`).join(' | ') +
      ` | ${median(results.map((r) => r.upgrades))} upgrades bought`,
  );
}
