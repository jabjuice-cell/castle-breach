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
  (g) => (g.plan.tower ? [
    "A siege tower, darling! Knock the planks off the bottom floor and the whole thing drops a storey. Like my uncle at weddings.",
    "They've built a tower. Aim your balls at its bottom planks; each floor that gives way spills out a fresh block of orcs. Rude, but satisfying.",
  ] : null),
  (g) => (g.plan.boss ? [
    "A Warlord, darling! Big, green and frightfully rude. Shoot the big one. Or the small ones. One of those.",
    "The Warlord is coming. I've had the good china put away. Your crossbows do rather like a large target.",
  ] : null),
  (g) => {
    const worst = g.segmentHp.indexOf(Math.min(...g.segmentHp));
    if (g.segmentHp[worst] > g.cfg.wall.segmentHp * 0.5) return null;
    const side = SIDES[worst] ?? 'one';
    return g.shopOpen
      ? [`The ${side} wall looks rather crumbly. Have you tried asking it nicely? Or clicking it and paying the masons, I suppose.`]
      : [`The ${side} wall is wobbling. If it falls we lose, apparently. Nobody tells me anything.`];
  },
  (g) => {
    if (g.defenders.length === 0) return null;
    const blind = g.segmentHp.findIndex((_, i) => g.sectionCover(i) === 0);
    if (blind < 0) return null;
    return [
      `Nobody is watching the ${SIDES[blind]} wall. See the red stripes? That's where the boulders will sail straight in. I'd put someone there. I'd put a lot of someones there.`,
      `The ${SIDES[blind]} section is a blind spot, darling. Orcs can smell those. So can I, frankly.`,
    ];
  },
  (g) => (g.phase === 'setup' && g.defenders.length === 0 ? [
    "Put a crossbow on a tower top. It shoots straight up its lane and angles across to the next one. The towers are taller, so they see further. Like me.",
  ] : null),
  (g) => (g.phase === 'setup' && g.unlocked('archers') && !g.owns('archers') ? [
    "Have you thought about archers? Thirty of them, for a pittance. They shoot boulders out of the sky before they reach you. Science!",
  ] : null),
  (g) => (g.plan.totals.barrel > 0 ? [
    "Some of them carry barrels. Of what, I couldn't say, but a ball in the right place and the whole block goes up. Do aim for the barrels.",
    "Barrel orcs! Hit one in the middle of a crowd. It's like a party popper, only with orcs.",
  ] : null),
  (g) => (g.plan.totals.orcCatapult >= 4 ? [
    `${g.plan.totals.orcCatapult} catapults! Every boulder you block becomes one of your balls. More rocks, more balls. I believe that's called economics.`,
    "So many rocks this time. Click just as a ball lands on the shield and it smashes through a whole line. I read that on a tapestry.",
  ] : null),
  (g) => (g.plan.totals.rider > 0 ? [
    "Pigs! Orcs riding pigs! They come down the edge lanes. Bank a ball off the corner tower and see how they like it.",
  ] : null),
  (g) => (g.shopOpen && g.gold >= 250 ? [
    `You have ${Math.floor(g.gold)} gold just lying about! In my day we spent it on gowns. Click a defender to upgrade it. Upgrades are the gowns of war.`,
  ] : null),
  (g) => (g.plan.totals.chucker > 0 ? [
    "Some of them throw rocks. At my castle! Block them and the rocks bounce back as little pebbles. Petty, but effective.",
  ] : null),
];

const IDLE = [
  "Remember, orcs are mostly stupid. Mostly.",
  "Do keep the wall in one piece, darling. There's a ball on Thursday. A real one, not the bouncing kind.",
  "If we lose, we simply go back to town, spend our Renown on something shiny and try again. That's what Renown is for. And gowns.",
  "I've drawn up a battle plan. It's a lovely drawing of a horse.",
  "Sound the horn early and the treasury pays a bonus. I love a bonus. I love a horn.",
  "Hit lots of orcs without the ball touching the shield. The gold piles up. That's how I run the court.",
  "Hit the shield with the edge and the ball goes sideways. Hit it with the very tip and it goes absolutely silly.",
  "Don't catch the red capsules. Trust me on this.",
];

/** Picks this moment's advice. Stable for a given wave and phase, so it doesn't flicker. */
export function queenAdvice(game: Game): string {
  const key = game.plan.number * 7 + (game.phase === 'setup' ? 1 : 0) + game.seed;
  const hit = RULES.findIndex((r) => r(game));
  // Bosses and crumbling walls always get a mention; otherwise she sometimes just rambles.
  const lines = hit >= 0 && (hit < 3 || key % 4 !== 0) ? RULES[hit](game)! : IDLE;
  return lines[key % lines.length];
}

/** She's cross when the wall is crumbling or a boss is at the gates. */
export function queenCross(game: Game): boolean {
  return Boolean(game.plan.boss || game.plan.tower) || game.segmentHp.some((hp) => hp < game.cfg.wall.segmentHp * 0.5);
}
