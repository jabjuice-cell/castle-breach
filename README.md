# Castle Breach

Castle-defence incremental game: TypeScript + Three.js, in the browser.

The design lives in Notion (Castle Breach → Design guide, Buildable design).

## Layout

- `src/sim/` is the whole game simulation. It contains no rendering code, so it runs in the browser and headless.
- `src/render/` draws the sim in 2.5D: a voxel castle, sprite orcs and placeholder art drawn on canvases.
- `src/main.ts` handles input, the HUD and the game loop.
- `tools/sim.ts` is the headless balance runner, which plays seeded runs with scripted bots.

## Commands

```sh
npm install
npm run dev      # play locally
npm test         # sim tests
npm run sim      # balance report: idle vs skilled bot
npm run build    # single-file build in dist/index.html
```

All tuning numbers are in `src/sim/config.ts`.
