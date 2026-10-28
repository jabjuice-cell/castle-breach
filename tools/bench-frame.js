// Frame-time benchmark for the browser: npm run dev, open /?debug, paste this into the console, then `await benchFrame()`.
// Level 2, wave 10, fixed seed and load-out, on High at 1280 x 720 and pixel ratio 1. Each frame is one sim step and
// one render, timed until the GPU is done (a 1-pixel readback), after 25 s of battle to fill the field.
window.benchFrame = async function (frames = 600) {
  const { Game } = await import('/src/sim/game.ts');
  const { makeConfig } = await import('/src/sim/config.ts');
  const { planWave } = await import('/src/sim/waves.ts');
  const g = new Game(4242, makeConfig(), 1);
  g.cfg.unlocks.defenders.push('archers', 'catapult', 'crossbow');
  g.gold = 1e7;
  const want = [['archers', -8, -6], ['archers', 8, -6], ['catapult', -4, -4], ['catapult', 4, -4], ['crossbow', -12, -1], ['crossbow', 12, -1], ['soldiers', -6, -0.5], ['soldiers', 6, -0.5]];
  for (const [k, x, y] of want) {
    let ok = false;
    for (let dy = 0; dy < 12 && !ok; dy += 0.5) for (const dx of [0, 1, -1, 2, -2, 3, -3]) if (!ok && g.canPlace(k, x + dx, y - dy)) ok = g.place(k, x + dx, y - dy);
  }
  g.wave = g.cleared = g.firstWave + 8;
  g.plan = planWave(g.firstWave + 9, g.seed, g.cfg);
  g.phase = 'preview';
  g.phaseTimer = 0.01;
  const v = window.view;
  v.orcStyle = 'voxel';
  v.setGame(g);
  v.setQuality('high');
  v.renderer.setPixelRatio(1);
  v.resize(1280, 720);
  const gl = v.renderer.getContext();
  const px = new Uint8Array(4);
  const dt = 1 / 60;
  let t = 100;
  for (let i = 0; i < 25 * 60; i++) {
    g.step(dt);
    if (i % 6 === 0) v.render(dt * 6, (t += dt * 6));
  }
  v.renderer.info.autoReset = false;
  const ts = [];
  let tris = 0;
  for (let i = 0; i < frames; i++) {
    g.step(dt);
    v.renderer.info.reset();
    const a = performance.now();
    v.render(dt, (t += dt));
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    ts.push(performance.now() - a);
    tris += v.renderer.info.render.triangles;
  }
  v.renderer.info.autoReset = true;
  ts.sort((a, b) => a - b);
  const mean = ts.reduce((s, x) => s + x, 0) / ts.length;
  return { wave: g.levelWave, orcs: g.enemies.length, mean: +mean.toFixed(2), median: +ts[ts.length >> 1].toFixed(2), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(2), ktris: Math.round(tris / frames / 1000) };
};
