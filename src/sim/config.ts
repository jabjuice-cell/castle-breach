/**
 * Every tuning number lives here, so balance sims can override any of them
 * without touching game code. First-pass values come from the "Buildable
 * design" page in Notion.
 *
 * Coordinates: x runs across the field, y runs away from the castle.
 * The wall's front face is at y = 0; enemies spawn near y = field.spawnY.
 * One design "tile" is about 2.2 units, so a grunt's 1 tile/s is speed 2.2.
 */
import { type Contraption, LEVEL_CONTRAPTIONS } from './contraptions';
import { LEVEL_OBSTACLES, type Obstacle } from './obstacles';

export const defaultConfig = {
  /**
   * The Breakout field: about 24 tiles wide by 40 tall, one tile = 1.67 units.
   * The tree lines at x = +-halfWidth and the top edge at y = topY are bounce edges.
   */
  field: { halfWidth: 20, topY: 68, spawnY: 70 },
  /** Real structures on each level's field (see obstacles.ts): balls bank off them, orcs go round. */
  obstacles: { levels: LEVEL_OBSTACLES as Obstacle[][] },
  /** Pinball fixtures on each level's field (layouts in contraptions.ts): bumpers, bell trios and ramps. */
  contraptions: {
    enabled: true,
    levels: LEVEL_CONTRAPTIONS as Contraption[][],
    /** A ball is reflected off the spring shield and sped up by kick (never above balls.maxSpeed). */
    bumper: { radius: 1, kick: 1.12, combo: 3, squashSeconds: 0.35 },
    /**
     * Ring count bells of a group and the castle looses a free volley of arrows at the thickest
     * crowd, from the wall below the group; the bells reset after resetSeconds.
     */
    bell: { radius: 0.55, count: 3, resetSeconds: 6, combo: 1, arrows: 30, damage: 10, spread: 2.6, flightTime: 1.7 },
    /** A ball entering a ramp flies distance up the field, then drops, hurting orcs within splashRadius. */
    ramp: { distance: 14, splashRadius: 3.5, damage: 30, knockback: 12, combo: 1 },
  },
  /**
   * War Council shaping: between waves the player places barricades and rubble (limits per level) and
   * moves bumpers and ramps anywhere between minY and maxY. Pieces keep edge off the side trees and
   * minGap (along x) clear of each other so they never wall off the road. Bumpers and ramps keep
   * |x| >= keepClearX. Downed pieces stand again after each wave when rebuild is on.
   */
  shaping: {
    enabled: true, minY: 10, maxY: 58, edge: 0.5, minGap: 1.5, keepClearX: 2,
    barricade: { hw: 1.6, hh: 0.35, hits: 3, cost: 0 },
    rubble: { r: 0.9, hits: 2 },
    levels: [{ barricade: 2, rubble: 2 }, { barricade: 3, rubble: 3 }, { barricade: 4, rubble: 4 }] as { barricade: number; rubble: number }[],
    rebuild: true,
  },
  /**
   * War Council feedback (visual only, the sim never reads it): a placed unit drops in from dropHeight over dropSeconds
   * and squashes for squashSeconds; the coverage shape pulses from pulseScale to 1 over pulseSeconds; the BATTLE READY
   * banner shows bannerSeconds; the camera sweeps up the field at sweepRate (higher is quicker); shake is the camera
   * kick on a landing (0 for none); rotateDegrees is a barricade's turn per wheel notch or R press.
   */
  setupFx: { dropHeight: 1.5, dropSeconds: 0.28, squashSeconds: 0.22, pulseSeconds: 0.5, pulseScale: 1.15, bannerSeconds: 1.5, sweepRate: 5, shake: 0.18, rotateDegrees: 15 },
  /**
   * Trees dotted over the middle of the field, count per level. A ball smashes one in a single
   * hit (it still bounces off); orcs go round them. They keep off the road down the middle.
   */
  fieldTrees: { counts: [7, 9, 10], radius: 0.75, minY: 14, maxY: 56, roadHalf: 6, apart: 4 },
  /** The run is lost when any one segment reaches 0 HP. */
  wall: { segments: 5, segmentHp: 400, depth: 2, warnBelow: 0.25 },

  // ---- enemies (the bricks) ---------------------------------------------------
  // mass divides knockback; climbSeconds 0 means it smashes the wall without climbing.
  // wallDps is damage per second once it has climbed. Speeds are for loose orcs; blocks march at march.speed.
  grunt: { hp: 10, speed: 1.8, radius: 0.45, mass: 1, wallDps: 1, meleeDps: 2, climbSeconds: 3, gold: 1, threat: 1 },
  /** Shielded from the front while its block's drummer lives; hit it from the sides or back. */
  shieldOrc: { hp: 14, speed: 1.8, radius: 0.55, mass: 2, wallDps: 1.5, meleeDps: 3, climbSeconds: 3, gold: 2, threat: 1, shieldArc: 0.35 },
  /** Beats the drum that holds a block's shields up: kill it and the formation breaks. */
  drummer: { hp: 8, speed: 1.8, radius: 0.5, mass: 1.5, wallDps: 0.5, meleeDps: 1, climbSeconds: 3, gold: 6, threat: 1 },
  /** A brick that shoots back: throws pebbles at the wall as its block marches, or (boltShare of them) fires fast bolts. */
  chucker: { hp: 10, speed: 1.8, radius: 0.5, mass: 1, wallDps: 1, meleeDps: 2, climbSeconds: 3, gold: 2, threat: 2, throwFromY: 44, throwInterval: 4, boltShare: 0.5 },
  /** Goblin runners: small, quick and fragile, sprinting down the side lanes in loose packs. */
  runner: { hp: 6, speed: 3.6, radius: 0.4, mass: 0.8, wallDps: 1, meleeDps: 2, climbSeconds: 2, gold: 1, threat: 1 },
  /** Riders zig-zag across the field in a skirmish line. */
  rider: { hp: 8, speed: 2.6, radius: 0.55, mass: 1.2, wallDps: 1, meleeDps: 3, climbSeconds: 2, gold: 2, threat: 2, zigSpeed: 4, zigRate: 1.6 },
  /** The ball source: marches at the back of a block, then parks and lobs boulders at the wall. */
  orcCatapult: {
    hp: 60, speed: 1.2, radius: 1, mass: 6, wallDps: 5, meleeDps: 5, climbSeconds: 0, gold: 15, threat: 0,
    standMinY: 46, standMaxY: 58, throwInterval: 6,
    standCreep: 0.9, creepMinY: 12,
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
  /** Boss on the last wave, riding the siege tower. Speeds up orcs around it and bats balls back down. */
  warlord: {
    hp: 2000, speed: 0.6, radius: 1.6, mass: 10, wallDps: 25, meleeDps: 60, climbSeconds: 0, gold: 100, threat: 0,
    auraRadius: 7, auraSpeed: 1.3,
  },
  /** Blocks march down the field like Space Invaders, faster as they shrink. */
  march: {
    /** 0.5 tiles/s. */
    speed: 1.25,
    growthPerWave: 0.01,
    /** A block with shrinkAt of its orcs left marches this much faster (linear in between). */
    shrinkBoost: 0.5,
    shrinkAt: 0.25,
    /** How hard orcs are pulled back into their slot in the block. */
    pull: 3,
    /** Each orc stands this share of the spacing off its slot, and sways about by sway units: a rabble, not a parade. */
    jitter: 0.3,
    sway: 0.35,
    /** Seconds between re-packing a block that has lost orcs (closing ranks). */
    regroupSeconds: 0.5,
    /** Distance between slots in a block: wide enough that each voxel orc reads on its own. */
    spacing: 2.1,
  },

  /** Enemy projectiles: what reaches the wall does wallDamage. A blocked one becomes a ball. */
  /**
   * The boss at the end of level 2 (wave 10): a tower about 5 tiles wide of 4 floors, each a row of 6 plank bricks (as in its art).
   * Balls chip the bottom standing floor; each floor that falls tips out a block of orcs.
   */
  siegeTower: {
    halfWidth: 4, depth: 3, floors: 4, planks: 6, plankHits: 2, speed: 0.33, floorOrcs: 8,
    throwInterval: 4, rampDps: 20, gold: 150,
  },

  rock: { speed: 12, wallDamage: 5, radius: 0.4 },
  /** Orc crossbow bolts: fast and straight. The shield stops them, but they don't become balls. */
  enemyBolt: { speed: 32, wallDamage: 4, radius: 0.3 },
  boulder: { speed: 13.3, wallDamage: 25, radius: 0.7 },

  // ---- the Breakout core --------------------------------------------------------
  /** A giant metal shield that follows the mouse along the battlements: the paddle. */
  shield: {
    y: 4,
    /** About 2.8 tiles wide. */
    halfWidth: 2.3,
    /** 60 tiles/s, so it can't teleport. */
    speed: 100,
    /**
     * The Hybrid bounce. The hit point runs from -1 (left edge) to +1 (right edge). Across
     * the middle (out to edgeZone) the shield is a flat mirror: angle in = angle out. The
     * edges kick the ball wide, a trick shot at trickMin to trickMax. Radians.
     */
    edgeZone: 0.8,
    trickMin: 1.134,
    trickMax: 1.309,
    /** A serve off the shield goes up at up to this angle, by where the ball sits on it. */
    serveAngle: 0.6,
    /** Moving the shield at full speed adds up to this much angle in the direction of travel (20 degrees)... */
    english: 0.35,
    /** ...and this much curve (radians per second the path bends), fading over curveSeconds: about 20 degrees in all. */
    curve: 0.3,
    curveSeconds: 1.2,
    /** Clicking this close to an impact heaves: a power hit. */
    heaveWindow: 0.15,
    /** A heave is a big effort: one every 3 seconds. */
    heaveCooldown: 3,
    heaveSpeed: 1.5,
    /**
     * The shield bash (the same click as the heave): a fresh press arms a Perfect Return for the window above,
     * and can be pressed again after this many seconds. The heave's slam and plough stay on heaveCooldown.
     */
    bashCooldown: 0.65,
    /** A Perfect Return sends the ball out this much faster, never past maxSpeed * heaveSpeed (the tunnelling-safe cap). */
    perfectSpeed: 1.3,
    /** A Perfect Return makes the ball's next damaging impact this much harder. */
    perfectDamage: 1.5,
    /** A heave ploughs through orc lines (up to lineMax orcs each) at heaveDamage each, instead of bouncing. */
    heaveLines: 3,
    heaveDamage: 20,
    lineMax: 12,
    /**
     * A heave also slams the shield into the orcs at the wall: everyone across its width from
     * the wall to slamReach in front of it. Light orcs (mass up to slamKillMass) die and go
     * flying; heavier ones take slamDamage and are knocked back slamKnock / mass.
     */
    slamReach: 2,
    slamKillMass: 1.5,
    slamDamage: 25,
    slamKnock: 40,
    /** Render only: shield hits that knock one cluster of blocks off the voxel shield (cleared each wave). */
    hitsPerChunk: 2,
    /** Speed multiplier on plain returns (not Perfect Returns or heaves). */
    returnMult: 1,
  },
  balls: {
    radius: 0.45,
    /** 12 tiles/s off the shield, +2% a bounce, up to 20 tiles/s. */
    speed: 20,
    /** The Royal Ball is quicker: about 18 tiles/s. */
    royalSpeed: 30,
    maxSpeed: 33,
    speedUp: 1.02,
    damage: 10,
    /** Orcs this close to a hit orc are knocked back and take splashDamage. */
    splashRadius: 1.33,
    splashDamage: 5,
    knockback: 9,
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
    /** Jonny took the bumpers out (25 Oct); kept switchable for tests and sims. */
    enabled: false,
    y: 5.67,
    radius: 0.67,
    mannedRadius: 1,
    /** A defender this close to a tower top counts as on it. */
    mannedDistance: 2.5,
    bankCombo: 2,
    bankDamage: 1.25,
  },
  /** What each level of a shield upgrade (bought in the town with Renown) adds. */
  shieldUpgrades: {
    width: { step: 0.42 },
    window: { step: 0.015 },
    power: { step: 1 },
    recovery: { step: 0.4 },
    plating: { step: 1 },
  },
  /** Power-ups fall from knocked-out orcs and only count if the shield catches them. */
  capsules: {
    chance: 0.04,
    maxFalling: 2,
    fallSpeed: 5,
    radius: 0.8,
    weights: { grog: 3, banner: 3, flask: 3, sticky: 0, trick: 1 },
    grogSpread: 0.35,
    bannerSeconds: 15,
    bannerWidth: 1.5,
    flaskSeconds: 10,
    flaskRadius: 2.5,
    stickyCatches: 3,
    trickSeconds: 10,
    trickWidth: 0.7,
  },

  // ---- defenders --------------------------------------------------------------
  /**
   * Archers, crossbows and catapults can be placed anywhere on the castle grounds:
   * on the wall, the towers or in the courtyard behind (y from minY up to the wall's front face).
   */
  /** Defenders on sale. At first only the crossbow; the town's upgrades unlock the rest (see meta.ts). */
  unlocks: { defenders: ['crossbow'] as string[], buildings: ['keep'] as string[] },
  castle: {
    minY: -7,
    maxY: 0,
    /** Defenders keep this far from the side edges of the field. */
    edge: 0.5,
    /** A tower top: this far either side of a wall joint. */
    towerHalf: 1.5,
    /** The wall walk reaches this far behind the wall's back face. */
    wallSlack: 0.5,
    /** Range multiplier in the courtyard (tower tops get towers.reach). */
    courtyardRange: 0.8,
    /** Each extra defender of the same kind costs this much more than the last. */
    priceGrowth: 1.25,
    /** Seconds a defender moved mid-battle spends packing up before it fires again. */
    packSeconds: 2,
    /** Moving mid-battle also costs moveGold x wave / 5. */
    moveGold: 10,
    /** The y of the tower tops, where a defender mans a turret. */
    start: { x: -4, y: -1 },
  },
  /** The call to arms from the keep: defenders fire this much faster and soldiers move this much quicker, for a while. */
  callToArms: { seconds: 6, cooldown: 45, rate: 2, run: 2.5 },
  /** Permanent boons of the town's buildings, once built (the alchemist's has no number: every ball burns). */
  buildings: {
    tavern: { dps: 1.3, run: 1.5 },
    blacksmith: { arrowDamage: 1.25 },
    chapel: { healPerSec: 6 },
    forge: { catapultDamage: 1.4 },
  },
  /**
   * Towers: the wall starts level and the player builds them on the wall walk, a storey at a time.
   * costs[n - 1] is the price of a tower's nth storey, so one tall tower costs what several low ones do.
   * reach[n - 1] is the range multiplier on top of n storeys (each storey adds less than the last).
   * Towers draw fire: a rock, bolt or boulder aimed within drawRadius of one turns on it with chance
   * drawPerStorey x storeys, and one landing within towerHalf + hitGrowth x (storeys - 1) of it hits the
   * tower, not the wall. Its top storey has storeyHp; at 0 it falls and the next one down takes the hits.
   * Standing storeys mend when a wave is cleared; fallen ones have to be bought again.
   */
  towers: { costs: [40, 70, 120], maxStoreys: 3, reach: [1.3, 1.55, 1.75], storeyHp: 50, hitGrowth: 0.4, drawPerStorey: 0.12, drawRadius: 12 },
  /**
   * Coverage: what each defender can reach decides where it is worth placing.
   * Crossbows shoot straight up a lane (tower tops can angle 15 degrees), archers cover
   * a 90 degree cone 60% up the field, catapults can't reach the first 8 tiles.
   */
  coverage: {
    crossbowLane: 1.25,
    crossbowTowerAngle: 0.262,
    /** The ballista's lane is narrow. */
    ballistaLane: 0.9,
    /** An aimed mage tower only blasts this far either side of its aim. */
    mageAimSpread: 0.6,
    archerCone: 0.785,
    archerReach: 0.6,
    catapultMin: 13.3,
    catapultMax: 50,
    /** How far round the player can aim a defender (radians): about 26 degrees, or 46 from a tower top. */
    aimWall: 0.45,
    aimTower: 0.8,
    /** An aimed catapult only reaches this far either side of its aim. */
    catapultAimSpread: 0.3,
    /** Soldiers hold their section plus this much of each neighbour. */
    soldierSpill: 4,
    /** A section counts as covered against boulders if a stopper covers this far out from it. */
    sectionCheckY: 12,
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
    /** Each volley has this chance to shoot down each enemy boulder in its cover. */
    shootDown: 0.3,
    /** Arrows do only this share of their damage to orcs climbing or hacking at the wall. */
    wallShare: 0.25,
  },
  /** The castle's own catapult lobs a fresh Royal Ball up the field: the idle player's multiball. */
  catapult: { cost: 150, interval: 10, spread: 0.5, footprint: 1.8 },
  /**
   * The soldiers are the last line of defence: companies spread along the foot of the wall
   * and rush any orc that gets close to it. With nothing to do at their post they walk, slowly,
   * to orcs on the wall elsewhere (so where they start matters). The fallen return each wave.
   */
  soldiers: { cost: 60, count: 40, footprint: 1.5, hp: 30, dps: 6, reach: 1.1, y: 2.6, guard: 4.5, heavyGuard: 2.5, speed: 4, walk: 1.2 },
  /** Mage tower (tower tops only): blasts the densest crowd in range; damage falls to edgeShare at the rim of the blast. */
  mage: { cost: 120, interval: 5, damage: 45, radius: 4, radiusPerLevel: 0.25, edgeShare: 0.5, knockback: 4, range: 40, footprint: 1.4 },
  /** Ballista: one huge bolt that pierces the whole lane. formationMult hits drummed formations and shields; plankHits is what it does to a siege tower. */
  ballista: {
    cost: 130, interval: 6, boltSpeed: 50, damage: 90, pierce: 99, pierceFalloff: 0.04, falloffStep: 0.005, knockback: 8, range: 130,
    formationMult: 2, plankHits: 3, hitRadius: 0.9, footprint: 1.4,
  },
  /** Boiling oil (wall walk only): pours on orcs climbing or hacking at the stretch of wall within halfWidth, reaching reach out from the wall. */
  oil: {
    cost: 90, interval: 6, damage: 70, halfWidth: 2.6, reach: 3, burn: 6, burnSeconds: 3,
    burnStep: 2, burnSecondsStep: 0.5, footprint: 1.3,
  },
  /** Spike trap (on the field between minY and maxY): marching orcs inside it take dps and walk at slow speed; barbs make it slower and bleed. */
  spiketrap: {
    cost: 40, footprint: 1.1, minY: 8, maxY: 34, dps: 6, slow: 0.5, slowStep: 0.04, slowMin: 0.2, bleed: 3, bleedSeconds: 1,
  },
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
  physics: { friction: 6, separation: 8 },

  // ---- run structure ----------------------------------------------------------
  /**
   * The campaign: three levels of five waves, with the town between them. Wave numbers run
   * on across levels (level 2 is waves 6 to 10), so the difficulty keeps climbing.
   * Each level starts with a fresh war chest to buy its load-out.
   */
  levels: {
    waves: 5,
    names: ['The Old Road', 'Mill Ford', 'The Black Gate'],
    warChest: [400, 550, 750],
    /** Level 1 is a narrow road; later fields are wider, behind a longer wall of more sections. */
    halfWidth: [20, 28, 28],
    segments: [5, 7, 7],
  },
  /** Bonuses from the town's permanent upgrades (meta.ts sets them; 1 and 0 mean none). */
  bonuses: {
    damage: 1,
    rate: 1,
    killGold: 1,
    /** Damage per second to every orc climbing the wall. */
    spikesDps: 0,
    /** Levels of each shield upgrade. */
    shield: { width: 0, window: 0, power: 0, recovery: 0, plating: 0 },
  },
  waves: {
    /** The lull between waves: time to repair, upgrade and buy before the next one marches. */
    previewSeconds: 30,
    /** Threat budget in grunt-equivalents: base * growth^(wave - 1). */
    budgetBase: 55,
    budgetGrowth: 1.3,
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
    blocksBase: 3,
    blocksEvery: 5,
    blocksMax: 6,
    chuckersFromWave: 1,
    chuckerShare: 0.2,
    runnersFromWave: 2,
    runnerShare: 0.12,
    ridersFromWave: 6,
    riderShare: 0.15,
    /** Orc catapults come every wave on top of the budget: base + perWave * (n - 1). */
    orcCatapultsBase: 3,
    orcCatapultsPerWave: 0.45,
    orcCatapultsMax: 14,
    ogresFromWave: 8,
    ogreShare: 0.12,
    /** Bosses: the siege tower ends level 2, and the warlord rides it at the end of level 3. */
    towerWaves: [10, 15],
    warlordWaves: [15],
    /** Catapults fire salvos that land together on different sections: size base, +1 every N waves, up to max. */
    salvoFromWave: 4,
    salvoBase: 2,
    salvoEvery: 6,
    salvoMax: 5,
    salvoInterval: 14,
    salvoFlight: 4,
    salvoSpread: 0.5,
    /** From this wave catapults aim at the section with the least boulder cover. */
    seekGapsFromWave: 8,
    /** Barrel orcs break away for the weakest section once this close to the wall. */
    barrelSeekY: 25,
    /** Barrel orcs per block: base from fromWave, +1 every N waves, up to max. */
    barrelsFromWave: 5,
    barrelsEvery: 10,
    barrelsMax: 3,
    shieldsFromWave: 3,
    shieldsMax: 8,
    shieldsEvery: 2,
    pinsFromWave: 5,
    pinsChance: 0.15,
    pinChainDepth: 3,
    pinChainDamage: 6,
    pinChainKnock: 0.6,
  },
  economy: {
    /** Gold to buy the level's load-out with (applyMeta sets it from levels.warChest and the Treasury). */
    warChest: 400,
    /** Kill gold grows this much per wave. */
    killGoldGrowth: 1.04,
    clearBase: 10,
    clearPerWave: 2,
    repairGoldPerHp: 0.5,
    /** The next wave can be called once this share of the current one is left on the field. */
    callEarlyAt: 0.15,
    /** Seconds credited for calling from the tail of a wave, on top of the skipped preview. */
    tailCallSeconds: 6,
    /** Multiplier on early-call gold; Hold the Gate sets 0. */
    earlyGoldMult: 1,
  },
  /**
   * Orc Bowling: an empowered (Perfect Return) hit sends a light orc tumbling into the next, one chain per shot.
   * Light orcs tumble, medium ones tumble for less once their armour is off, heavy ones stop the chain.
   */
  bowling: {
    /** Seconds a tumble lasts. */
    tumbleSeconds: 0.8,
    /** How far the first victim slides, in grunt widths (it slows steadily to a stop). */
    travelWidths: 3,
    /** Medium orcs (riders, unarmoured shield orcs) slide this share as far. */
    mediumTravel: 0.75,
    /** Each transfer keeps this share of the strength, up to maxTransfers, or until strength drops below minStrength. */
    transfer: 0.7,
    maxTransfers: 5,
    minStrength: 0.15,
    /** The shot direction is tipped this much away from the castle (a slight bias, 0 to 1). */
    awayBias: 0.35,
    /** Damage to an orc a tumbler runs into, times the tumbler's strength. */
    damage: 7,
    /** Modest damage when a tumbler slams into a heavy orc or an armoured shield. */
    heavyDamage: 4,
    /** A tumbler can run into this many orcs before it stops. */
    hitsPerBody: 2,
    /** Seconds a survivor lies stunned after the tumble. */
    recoverSeconds: 0.6,
    /** Shield team: when the drum falls and the shields drop, the exposed orcs topple one after another this far apart. */
    dominoDelay: 0.12,
    dominoStrength: 0.7,
    /** Bonus coins for 1, 2, 3, 4 and 5+ enemies in one chain, paid once when the chain ends. */
    bonus: [0, 1, 3, 5, 8],
    light: ['grunt', 'chucker', 'runner', 'drummer'] as string[],
    medium: ['rider', 'shieldOrc'] as string[],
    heavy: ['ogre', 'warlord', 'orcCatapult', 'barrel'] as string[],
  },
  /**
   * The town's choices for a level (town.ts): picked in the setup by clicking the war room, barracks and
   * blacksmith. applyChoices sets choices and folds the stat changes below into the level's config.
   */
  choices: { tactic: null, archers: 'fire', soldiers: 'hold', shield: 'kite', ball: 'royal' } as import('./town').Choices,
  town: {
    /** Wall strength and soldier toughness multipliers; every defender's rate multiplier. Early calls pay nothing. */
    holdGate: { wallHp: 1.4, soldierHp: 1.5, rate: 0.8 },
    /** Archer and crossbow rate multiplier, the volley's boulder shoot-down chance, burn seconds; men per company, repair cost multiplier. */
    rainOfArrows: { rate: 1.35, shootDown: 0.6, burnSeconds: 5, soldiers: 20, repairCost: 1.5 },
    /**
     * Soldiers hold a line y units up the field and chase orcs within guard of it; damage, speed and kill-gold
     * multipliers. They never go back to the wall, and only returnPerWave of each company's fallen come back.
     */
    sallyForth: { y: 10, guard: 6, dps: 1.3, speed: 1.5, killGold: 1.5, returnPerWave: 20 },
    /** Archers on Pin: damage multiplier; an orc hit walks at slow x speed for seconds; a block that is hit halts for halt seconds. */
    pin: { damage: 0.4, slow: 0.5, seconds: 2, halt: 1 },
    /** Soldiers on Repair: each company mends its nearest wall section at hps while no orc is within guard; fights at dps x. */
    repair: { hps: 4, dps: 0.5 },
    /** Shields: width and speed multipliers, extra heave cooldown and window (s), overrides, and plain-return speed. */
    shields: {
      kite: { width: 1, speed: 1, heaveCooldown: 0, heaveWindow: 0, returnMult: 1 },
      tower: { width: 1.35, speed: 0.7, heaveCooldown: 1, heaveWindow: 0, returnMult: 1 },
      buckler: { width: 0.7, speed: 1.25, heaveCooldown: 0, heaveWindow: 0.05, bashCooldown: 0.45, perfectSpeed: 1.45, returnMult: 1 },
      spiked: { width: 1, speed: 1, heaveCooldown: 0, heaveWindow: 0, slamDamage: 45, slamReach: 3, slamKillMass: 2.5, returnMult: 0.85 },
    } as Record<import('./town').ShieldKit, { width: number; speed: number; heaveCooldown: number; heaveWindow: number; returnMult: number; bashCooldown?: number; perfectSpeed?: number; slamDamage?: number; slamReach?: number; slamKillMass?: number }>,
    /**
     * The Royal Ball (served and the castle catapult's; claimed boulders and pebbles stay as they are): damage, splash
     * radius, knockback and speed multipliers, speed-up per bounce, top speed and combo step (null: the balls defaults).
     * Powder: every powderEvery-th hit blows up orcs within powderRadius for powderDamage; a miss hits the wall for missDamage.
     */
    balls: {
      royal: { damage: 1, splash: 1, knockback: 1, speed: 1, speedUp: null, maxSpeed: null, comboStep: null },
      iron: { damage: 2, splash: 1.5, knockback: 1.55, speed: 0.73, speedUp: 1, maxSpeed: null, comboStep: null },
      jester: { damage: 0.7, splash: 1, knockback: 1, speed: 1, speedUp: 1.05, maxSpeed: 38, comboStep: 0.15 },
      powder: { damage: 1, splash: 1, knockback: 1, speed: 1, speedUp: null, maxSpeed: null, comboStep: null },
    } as Record<import('./town').BallKit, { damage: number; splash: number; knockback: number; speed: number; speedUp: number | null; maxSpeed: number | null; comboStep: number | null }>,
    powder: { every: 4, radius: 2.5, damage: 25, missDamage: 25 },
  },
  renown: {
    perWaveBase: 5,
    perWave: 1,
    earlyPerSecond: 0.02,
    earlyCap: 0.5,
    bossKill: 50,
    /** For beating each level. */
    levelClear: [60, 120, 300],
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
