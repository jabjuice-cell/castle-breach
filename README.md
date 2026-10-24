# Castle Breach

Castle-defence incremental game: TypeScript + Three.js, in the browser.

The design lives in Notion (Castle Breach → Design guide, Buildable design).

## Layout

- `src/sim/` is the whole game simulation. It contains no rendering code, so it runs in the browser and headless.
- `src/render/` draws the sim in 2.5D: a voxel castle, sprite units and canvas-drawn effects.
- `src/assets/sprites/` holds the unit sprites. Re-import them from the art folder with `python3 tools/import-sprites.py` (crops each to the unit and shrinks it; unit sizes come from `SIZE` in `scene.ts`).
- `src/main.ts` handles input, the HUD and the game loop.
- `tools/sim.ts` is the headless balance runner, which plays seeded runs with scripted bots
  (idle: cheapest purchases, no skills; builder: planned purchases, no skills; skilled: planned purchases, parries, slaps and early calls).
- `tools/trace.ts` prints one run wave by wave.

## The run loop

A run is 25 waves. The War Council opens before wave 1 and after every third wave: buy archers, catapults,
crossbows and a soldier line into fixed slots, raise each defender's damage, rate and special track, and
repair walls. Kills and wave clears pay gold; calling a wave early pays bonus gold and Renown.
Warlords lead waves 10, 20 and 25. Renown is banked at the end of a run (spending it comes with the research tree).

## Commands

```sh
npm install
npm run dev      # play locally
npm test         # sim tests
npm run sim      # balance report for the three bots (optional: runs, JSON config overrides)
npm run trace    # one run, wave by wave
npm run build    # single-file build in dist/index.html
```

All tuning numbers are in `src/sim/config.ts`.
