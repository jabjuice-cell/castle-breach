import type { Game } from './game';

/**
 * The guided first wave: one gentle wave with no orc catapults and a wall that cannot fall,
 * while the Queen walks a new player through serving the ball, heaving and timing a Perfect Return.
 * It lives in the sim so it can be tested without a screen.
 */

export const TUTORIAL_STEPS = ['serve', 'heave', 'perfect', 'done'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** Seconds a step waits before moving on anyway, so nobody is stuck on a hint. */
const PATIENCE = 30;

const LINES: Record<TutorialStep, string> = {
  serve: 'Darling, slide the shield about with the mouse. Do click to serve the ball up the field. It will not go by itself.',
  heave: 'Now catch the ball as it comes back and click just as it lands. That is a heave, and it makes the ball hit harder.',
  perfect: 'Rather good! Click a hair before the ball touches the shield for a PERFECT return: a loud clang and a very cross ball.',
  done: 'Splendid. The wall is yours now, and the orcs are rather more serious. Do try to keep it up.',
};

export class Tutorial {
  step: TutorialStep = 'serve';
  private since = 0;

  /** Makes the game gentle: no orc catapults this wave, and a wall that holds. */
  static begin(game: Game): Tutorial {
    const plan = game.plan;
    plan.totals.orcCatapult = 0;
    for (const g of plan.groups) g.members = g.members.filter((m) => m.kind !== 'orcCatapult');
    plan.groups = plan.groups.filter((g) => g.members.length > 0);
    game.forgiving = true;
    const t = new Tutorial();
    t.since = game.time;
    return t;
  }

  get done(): boolean {
    return this.step === 'done';
  }

  get text(): string {
    return LINES[this.step];
  }

  /** Watches the game and moves to the next step. Returns true on the call that finishes the tutorial. */
  update(game: Game): boolean {
    if (this.done) return false;
    const before = this.step;
    const served = game.balls.some((b) => !b.stuck);
    const timedOut = game.time - this.since > PATIENCE;
    if (this.step === 'serve' && (served || game.phase === 'battle' && game.parries > 0)) this.step = 'heave';
    else if (this.step === 'heave' && (game.parries > 0 || timedOut)) this.step = 'perfect';
    else if (this.step === 'perfect' && (game.perfects > 0 || timedOut)) this.step = 'done';
    // The first wave ending closes the tutorial whatever step it was on.
    if (!this.done && (game.over || (game.phase === 'preview' && game.wave >= game.firstWave))) this.step = 'done';
    if (this.step !== before) this.since = game.time;
    if (this.done) game.forgiving = false;
    return this.done;
  }
}
