# Castle Breach

Castle-defence incremental game: TypeScript + Three.js, in the browser.

The design lives in Notion (Castle Breach → Design guide, Buildable design).

## Layout

- `src/sim/` is the whole game simulation. It contains no rendering code, so it runs in the browser and headless.
- `src/render/` draws the sim in 2.5D: a voxel castle with towers, a 3D battlefield that craters under explosions (`terrain.ts`), sprite units, canvas-drawn effects and synthesized sounds (`sound.ts`). Low / Medium / High detail changes render resolution, ground texture size and terrain smoothness.
- `src/queen.ts` picks the Queen's between-wave advice from the game state.
- `src/assets/` holds the game art: unit sprites, the crossbow tower, wall damage states, effects, icons and the forest map. Re-import it from the art folder with `python3 tools/import-art.py`, which crops each image to its subject and shrinks it. Unit sizes come from `SIZE` in `scene.ts`, not from the images. Walk cycles are a bob, waddle and squash done in code.
- `src/main.ts` handles input, the HUD and the game loop.
- `tools/sim.ts` is the headless balance runner, which plays seeded runs with scripted bots
  (idle: cheapest purchases, no skills; builder: planned purchases, no skills; skilled: planned purchases, parries, slaps and early calls).
- `tools/trace.ts` prints one run wave by wave.

## The run loop

A run is 25 waves. The War Council opens before wave 1 and after every third wave: place archers (squads of 30
that loose volleys), catapults and crossbows anywhere on the castle grounds, raise soldier companies that hold the
foot of the wall, raise each defender's damage, rate and special track, and repair walls. Defenders can be dragged
to new spots between waves. Orc catapults come every wave, so the shield is busy. Kills and wave clears pay gold; calling a wave early pays bonus gold and Renown.
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
