import type { Game } from './sim/game';

/**
 * The Queen's advice between waves. She thinks she is terribly helpful. She
 * mostly isn't, but each line does point at something real about the coming
 * wave or the castle, so a new player picks up a hint or two.
 */

const SIDES = ['far left', 'left', 'gate', 'right', 'far right'];

/** A situation she might comment on, checked in order; the first that applies wins. */
type Rule = (game: Game) => string[] | null;

const RULES: Rule[] = [
  (g) => (g.plan.boss ? [
    "A Warlord, darling! Big, green and frightfully rude. Shoot the big one. Or the small ones. One of those.",
    "The Warlord is coming. I've had the good china put away. Your crossbows do rather like a large target.",
  ] : null),
  (g) => {
    const worst = g.segmentHp.indexOf(Math.min(...g.segmentHp));
    if (g.segmentHp[worst] > g.cfg.wall.segmentHp * 0.5) return null;
    const side = SIDES[worst] ?? 'one';
    return g.phase === 'council'
      ? [`The ${side} wall looks rather crumbly. Have you tried asking it nicely? Or paying the masons, I suppose.`]
      : [`The ${side} wall is wobbling. If it falls we lose, apparently. Nobody tells me anything.`];
  },
  (g) => (g.phase === 'council' && !g.owns('archers') ? [
    "Have you thought about archers? Thirty of them, for a pittance. They shoot up into the sky and it lands on orcs. Science!",
  ] : null),
  (g) => (g.phase === 'council' && !g.owns('soldiers') ? [
    "My soldiers are desperate to stand at the foot of the wall and be heroic. It costs a little gold. They insist.",
  ] : null),
  (g) => (g.plan.totals.orcCatapult >= 3 ? [
    `${g.plan.totals.orcCatapult} catapults! When a boulder comes, hold up the royal shield. That's what it's for, I think. Mother used hers as a tea tray.`,
    "So many rocks this time. Raise the shield just as one lands and it flies back three times as hard. I read that on a tapestry.",
  ] : null),
  (g) => (g.plan.totals.rider > 0 ? [
    "Pigs! Orcs riding pigs! Archers are good against quick things, I'm told. Or was that cheese?",
  ] : null),
  (g) => (g.phase === 'council' && g.gold >= 250 ? [
    `You have ${Math.floor(g.gold)} gold just lying about! In my day we spent it on gowns. Perhaps a catapult? Catapults are the gowns of war.`,
  ] : null),
  (g) => (g.plan.totals.chucker > 0 ? [
    "Some of them throw rocks. At my castle! Archers love a target that stands still, apparently.",
  ] : null),
];

const IDLE = [
  "Remember, orcs are mostly stupid. Mostly.",
  "Do keep the castle un-breached, darling. There's a ball on Thursday.",
  "I've drawn up a battle plan. It's a lovely drawing of a horse.",
  "Sound the horn early and the treasury pays a bonus. I love a bonus. I love a horn.",
  "You can drag your defenders about between waves. I do the same with the furniture.",
  "If in doubt, slap it. That's how I run the court.",
];

/** Picks this moment's advice. Stable for a given wave and phase, so it doesn't flicker. */
export function queenAdvice(game: Game): string {
  const key = game.plan.number * 7 + (game.phase === 'council' ? 1 : 0) + game.seed;
  const hit = RULES.findIndex((r) => r(game));
  // Bosses and crumbling walls always get a mention; otherwise she sometimes just rambles.
  const lines = hit >= 0 && (hit < 2 || key % 4 !== 0) ? RULES[hit](game)! : IDLE;
  return lines[key % lines.length];
}
