/**
 * Every tuning number lives here, so balance sims can override any of them
 * without touching game code. First-pass values come from the "Buildable
 * design" page in Notion.
 *
 * Coordinates: x runs across the field, y runs away from the castle.
 * The wall's front face is at y = 0; enemies spawn near y = field.spawnY.
 * One design "tile" is about 2.2 units, so a grunt's 1 tile/s is speed 2.2.
 */
export const defaultConfig = {
  /**
   * The Breakout field: about 24 tiles wide by 40 tall, one tile = 1.67 units.
   * The tree lines at x = +-halfWidth and the top edge at y = topY are bounce edges.
   */
  field: { halfWidth: 20, topY: 68, spawnY: 70 },
  /** The run is lost when any one segment reaches 0 HP. */
  wall: { segments: 5, segmentHp: 400, depth: 2, warnBelow: 0.25 },

  // ---- enemies (the bricks) ---------------------------------------------------
  // mass divides knockback; climbSeconds 0 means it smashes the wall without climbing.
  // wallDps is damage per second once it has climbed. Speeds are for loose orcs; blocks march at march.speed.
  grunt: { hp: 10, speed: 1.2, radius: 0.45, mass: 1, wallDps: 1, meleeDps: 2, climbSeconds: 3, gold: 1, threat: 1 },
  /** A brick that shoots back: throws pebbles at the wall as its block marches. */
  chucker: { hp: 10, speed: 1.2, radius: 0.5, mass: 1, wallDps: 1, meleeDps: 2, climbSeconds: 3, gold: 2, threat: 2, throwFromY: 44, throwInterval: 4 },
  /** Riders zig-zag across the field in a skirmish line. */
  rider: { hp: 8, speed: 1.8, radius: 0.55, mass: 1.2, wallDps: 1, meleeDps: 3, climbSeconds: 2, gold: 2, threat: 2, zigSpeed: 4, zigRate: 1.6 },
  /** The ball source: marches at the back of a block, then parks and lobs boulders at the wall. */
  orcCatapult: {
    hp: 60, speed: 1.2, radius: 1, mass: 6, wallDps: 5, meleeDps: 5, climbSeconds: 0, gold: 15, threat: 0,
    standMinY: 46, standMaxY: 58, throwInterval: 6,
  },
  /** Carries a powder barrel: a hit blows up the cluster around it, and setting off others in range. */
  barrel: {
    hp: 10, speed: 1.2, radius: 0.5, mass: 1, wallDps: 1, meleeDps: 2, climbSeconds: 3, gold: 1, threat: 1,
    /** 2.5 tiles. */
    blastRadius: 4.17, blastDamage: 30, chainDelay: 0.15, blastCombo: 3, blastGold: 2,
    /** One that reaches the wall blows a hole in that section. */
    wallDamage: 60,
  },
  /** A big 2 x 2 brick that slows balls and staggers its row when it falls. */
  ogre: {
    hp: 50, speed: 0.6, radius: 1.2, mass: 4, wallDps: 10, meleeDps: 30, climbSeconds: 0, gold: 12, threat: 12, ballSlow: 0.7,
    /** 6 tiles either side, within a row's depth. */
    staggerRadius: 10, staggerSeconds: 2, staggerDamage: 5, staggerKnock: 0.83, killCombo: 3,
  },
  /** Boss on wave 20 and the last. Speeds up orcs around it and bats balls back down. */
  warlord: {
    hp: 2000, speed: 0.6, radius: 1.6, mass: 10, wallDps: 25, meleeDps: 60, climbSeconds: 0, gold: 100, threat: 0,
    auraRadius: 7, auraSpeed: 1.3,
  },
  /** Blocks march down the field like Space Invaders, faster as they shrink. */
  march: {
    /** 0.5 tiles/s. */
    speed: 0.83,
    growthPerWave: 0.01,
    /** A block with shrinkAt of its orcs left marches this much faster (linear in between). */
    shrinkBoost: 0.5,
    shrinkAt: 0.25,
    /** How hard orcs are pulled back into their slot in the block. */
    pull: 3,
    /** Seconds between re-packing a block that has lost orcs (closing ranks). */
    regroupSeconds: 0.5,
    spacing: 1.05,
  },

  /** Enemy projectiles: what reaches the wall does wallDamage. A blocked one becomes a ball. */
  /**
   * The wave 10 boss: a tower 6 tiles wide of 5 floors, each a row of plank bricks.
   * Balls chip the bottom standing floor; each floor that falls tips out a block of orcs.
   */
  siegeTower: {
    halfWidth: 5, depth: 3, floors: 5, planks: 6, plankHits: 2, speed: 0.33, floorOrcs: 8,
    throwInterval: 4, rampDps: 20, gold: 150,
  },

  rock: { speed: 12, wallDamage: 5, radius: 0.4 },
  boulder: { speed: 13.3, wallDamage: 25, radius: 0.7 },

  // ---- the Breakout core --------------------------------------------------------
  /** A giant metal shield that follows the mouse along the battlements: the paddle. */
  shield: {
    y: 4,
    /** 4 tiles wide. */
    halfWidth: 3.33,
    /** 60 tiles/s, so it can't teleport. */
    speed: 100,
    /**
     * Angle control. The hit point runs from -1 (left edge) to +1 (right edge):
     * the centre zone goes nearly straight up, the middle rises evenly to midAngle,
     * and the edge zone is a trick shot at trickMin to trickMax. Radians.
     */
    centreZone: 0.2,
    centreAngle: 0.1745,
    midEnd: 0.8,
    midAngle: 0.96,
    edgeZone: 0.9,
    trickMin: 1.134,
    trickMax: 1.309,
    /** Moving the shield at full speed adds up to this much angle in the direction of travel. */
    english: 0.1745,
    /** Clicking this close to an impact heaves: a power hit. */
    heaveWindow: 0.15,
    heaveCooldown: 1,
    heaveSpeed: 1.5,
    /** A heave smashes through a whole orc line (up to lineMax orcs) at heaveDamage each. */
    heaveLines: 1,
    heaveDamage: 20,
    lineMax: 12,
  },
  balls: {
    radius: 0.45,
    /** 12 tiles/s off the shield, +2% a bounce, up to 20 tiles/s. */
    speed: 20,
    maxSpeed: 33,
    speedUp: 1.02,
    damage: 10,
    /** Orcs this close to a hit orc are knocked back and take splashDamage. */
    splashRadius: 1.33,
    splashDamage: 5,
    knockback: 7,
    cap: 12,
    comboStep: 0.1,
    comboMax: 5,
    /** Gold multiplier for hits behind the lines (after bouncing off the top edge). */
    behindMult: 2,
    /** Wall damage when one of your balls gets past the shield. */
    missDamage: 10,
    /** A claimed pebble is a half-strength ball. */
    pebbleShare: 0.5,
    reserveSeconds: 3,
    /** The served Royal Ball launches by itself after this long, so nobody gets stuck. */
    autoServeSeconds: 3,
    /** Balls never travel flatter than 75 degrees: this share of their speed up or down the field. */
    minVertical: 0.259,
    /** Combo milestones: a bell, "Glorious!", and the ball turns gold. */
    comboMilestones: [10, 25, 40],
    trickCombo: 1,
  },
  /**
   * Bank shots: each wall joint's tower has a jutting turret 1 tile in front of the
   * shield's lane, a round bumper. A defender on the tower makes it bigger.
   */
  bumpers: {
    y: 5.67,
    radius: 0.67,
    mannedRadius: 1,
    /** A defender this close to a tower top counts as on it. */
    mannedDistance: 2.5,
    bankCombo: 2,
    bankDamage: 1.25,
  },
  /** Shield upgrades bought in the War Council, for this run only. */
  shieldUpgrades: {
    costGrowth: 1.15,
    width: { cost: 60, step: 0.42, max: 8 },
    window: { cost: 80, step: 0.015, max: 8 },
    power: { cost: 150, step: 1, max: 2 },
    recovery: { cost: 70, step: 0.1, max: 6 },
    plating: { cost: 120, step: 1, max: 3 },
  },
  /** Power-ups fall from knocked-out orcs and only count if the shield catches them. */
  capsules: {
    chance: 0.04,
    maxFalling: 2,
    fallSpeed: 5,
    radius: 0.8,
    weights: { grog: 3, banner: 3, flask: 3, sticky: 3, tea: 2, trick: 1 },
    grogSpread: 0.35,
    bannerSeconds: 15,
    bannerWidth: 1.5,
    flaskSeconds: 10,
    flaskRadius: 2.5,
    stickyCatches: 3,
    teaSeconds: 6,
    teaSpeed: 0.5,
    trickSeconds: 10,
    trickWidth: 0.7,
  },

  // ---- defenders --------------------------------------------------------------
  /**
   * Archers, crossbows and catapults can be placed anywhere on the castle grounds:
   * on the wall, the towers or in the courtyard behind (y from minY up to the wall's front face).
   */
  /**
   * Defenders the War Council sells. Run 1 has the crossbow only; research opens
   * the rest (until the research tree lands, the game offers a "veteran" start with all four).
   */
  unlocks: { defenders: ['crossbow'] as string[] },
  castle: {
    minY: -10,
    maxY: 0,
    /** Defenders keep this far from the side edges of the field. */
    edge: 1,
    maxDefenders: 20,
    /** Each extra defender of the same kind costs this much more than the last. */
    priceGrowth: 1.3,
    /** Seconds a defender moved mid-battle spends packing up before it fires again. */
    packSeconds: 2,
    /** The y of the wall's tower tops, where defenders stand to man a turret. */
    start: { x: -4, y: -1 },
  },
  /** footprint is the radius a defender occupies; two can't overlap. */
  crossbow: { cost: 100, interval: 2.5, boltSpeed: 45, damage: 40, pierce: 5, pierceFalloff: 0.2, knockback: 5, range: 75, footprint: 1.4 },
  /**
   * A squad of archers looses a volley together at the thickest crowd in range.
   * Arrows arc high and rain down around the target; each one hits whoever it lands on.
   */
  archers: {
    cost: 80, archers: 30, interval: 4, damage: 10, range: 66, flightTime: 1.7, spread: 2.6, hitRadius: 0.75,
    burnSeconds: 3, footprint: 2.6,
  },
  /** The castle's own catapult lobs a fresh Royal Ball up the field: the idle player's multiball. */
  catapult: { cost: 150, interval: 10, spread: 0.5, footprint: 1.8 },
  /**
   * The soldiers are the last line of defence: companies spread along the foot of the wall
   * and rush any orc that gets close to it. The fallen return each wave.
   */
  soldiers: { cost: 60, count: 40, maxCompanies: 3, hp: 30, dps: 6, reach: 1.1, y: 2.6, guard: 4.5, heavyGuard: 2.5, speed: 4 },
  upgrades: {
    /** Each track's first level costs this share of the defender's price. */
    baseCostShare: 0.4,
    costGrowth: 1.15,
    /** Each level adds this much to the stat. */
    step: 0.1,
    /** Levels that double the stat. */
    milestones: [10, 25, 50],
  },

  // ---- player skills ----------------------------------------------------------
  slap: { radius: 1.6, damage: 6, impulse: 7, vigorMax: 10, vigorRegen: 2, vigorCost: 1 },
  physics: { friction: 6, separation: 8 },

  // ---- run structure ----------------------------------------------------------
  waves: {
    previewSeconds: 8,
    /** Threat budget in grunt-equivalents: base * growth^(wave - 1). */
    budgetBase: 20,
    budgetGrowth: 1.17,
    /**
     * Enemy HP grows this much per wave (bosses excluded). Grunts stay one-hit bricks,
     * so most of the growth is in how many orcs come.
     */
    hpGrowth: 1,
    /** Seconds over which a wave's blocks arrive: base + perWave * n, capped. */
    spawnBase: 8,
    spawnPerWave: 1,
    spawnMax: 30,
    /** Blocks of foot orcs per wave: base, +1 every N waves, up to max. */
    blocksBase: 2,
    blocksEvery: 5,
    blocksMax: 6,
    chuckersFromWave: 3,
    chuckerShare: 0.12,
    ridersFromWave: 6,
    riderShare: 0.15,
    /** Orc catapults come every wave on top of the budget: base + perWave * (n - 1). */
    orcCatapultsBase: 2,
    orcCatapultsPerWave: 0.3,
    orcCatapultsMax: 9,
    ogresFromWave: 12,
    ogreShare: 0.12,
    /** Bosses: the siege tower on 10, the warlord on 20, and the warlord riding the tower on the last. */
    towerWaves: [10, 25],
    warlordWaves: [20, 25],
    /** Barrel orcs per block: base from fromWave, +1 every N waves, up to max. */
    barrelsFromWave: 5,
    barrelsEvery: 10,
    barrelsMax: 3,
    /** The run is won after this wave. */
    finalWave: 25,
  },
  economy: {
    startGold: 150,
    /** Kill gold grows this much per wave. */
    killGoldGrowth: 1.04,
    clearBase: 10,
    clearPerWave: 2,
    /** War Council opens before wave 1 and after every Nth wave. */
    councilEvery: 3,
    repairGoldPerHp: 0.5,
    /** The next wave can be called once this share of the current one is left on the field. */
    callEarlyAt: 0.15,
    /** Seconds credited for calling from the tail of a wave, on top of the skipped preview. */
    tailCallSeconds: 6,
  },
  renown: {
    perWaveBase: 5,
    perWave: 1,
    earlyPerSecond: 0.02,
    earlyCap: 0.5,
    bossKill: 50,
    actClear: 500,
  },
};

export type Config = typeof defaultConfig;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function makeConfig(overrides: DeepPartial<Config> = {}): Config {
  const cfg = structuredClone(defaultConfig);
  for (const [group, values] of Object.entries(overrides)) {
    Object.assign((cfg as Record<string, object>)[group], values);
  }
  return cfg;
}
