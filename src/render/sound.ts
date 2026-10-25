/**
 * Sound effects made on the fly with Web Audio, so there are no sound files
 * to load. Placeholders until real recordings arrive.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private lastClang = 0;
  private lastClink = 0;
  private lastCrunch = 0;
  private scrapeGain: GainNode | null = null;
  private scrapeBand: BiquadFilterNode | null = null;
  muted = false;

  /** Browsers only allow audio after a click, so call this from one. */
  unlock() {
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /**
   * A heavy metal clang: a thump, a burst of filtered noise for the impact and
   * a few out-of-tune ringing partials, like something big hitting a steel shield.
   * A perfect parry rings higher and longer.
   */
  clang(parry: boolean) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastClang < 0.05) return;
    this.lastClang = now;
    const out = ctx.createGain();
    out.gain.value = parry ? 0.5 : 0.35;
    out.connect(ctx.destination);

    const pitch = (parry ? 1.25 : 1) * (0.94 + Math.random() * 0.12);
    const ring = parry ? 1.1 : 0.6;
    for (const [f, amp, decay] of [[310, 0.5, 1], [740, 0.35, 0.8], [1187, 0.25, 0.6], [1873, 0.18, 0.45], [2716, 0.1, 0.3]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f * pitch;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + ring * decay);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + ring * decay + 0.05);
    }

    // The hit itself: a short crack of noise through a band-pass.
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2400 * pitch;
    band.Q.value = 0.8;
    noise.connect(band).connect(out);
    noise.start(now);

    // A low thump so it feels heavy.
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(140, now);
    thump.frequency.exponentialRampToValueAtTime(50, now + 0.15);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.8, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thump.connect(tg).connect(out);
    thump.start(now);
    thump.stop(now + 0.2);
  }

  /**
   * A light metallic clink for an ordinary bounce off the shield: a bright tick
   * and a few short, high, inharmonic partials. The heavy clang is kept for heaves.
   */
  clink() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastClink < 0.03) return;
    this.lastClink = now;
    const out = ctx.createGain();
    out.gain.value = 0.22;
    out.connect(ctx.destination);
    const pitch = 0.9 + Math.random() * 0.2;
    for (const [f, amp, decay] of [[1480, 0.5, 0.22], [2350, 0.35, 0.16], [3720, 0.25, 0.1], [5210, 0.12, 0.06]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f * pitch;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + decay);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + decay + 0.03);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise(0.02, 1);
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 4000;
    noise.connect(high).connect(out);
    noise.start(now);
  }

  /** A crunch of stone when something smashes into the wall: louder for bigger hits. */
  crunch(damage: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastCrunch < 0.06) return;
    this.lastCrunch = now;
    const level = Math.min(1, 0.25 + damage / 30);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise(0.35, 2.5);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 900 + Math.random() * 400;
    const g = ctx.createGain();
    g.gain.value = 0.55 * level;
    noise.connect(low).connect(g).connect(ctx.destination);
    noise.start(now);
    // Rubble rattling down after it.
    for (let i = 0; i < 3 + level * 4; i++) this.tone(300 + Math.random() * 500, now + 0.05 + Math.random() * 0.25, 0.05, 0.05 * level, 'square');
  }

  /**
   * The scrape of the shield's rim dragging along the battlements: a looping gritty hiss
   * that swells with the shield's speed (0 to 1). Call every frame.
   */
  scrape(level: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.scrapeGain) {
      const src = ctx.createBufferSource();
      src.buffer = this.grit();
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 3200;
      band.Q.value = 1.4;
      this.scrapeBand = band;
      this.scrapeGain = ctx.createGain();
      this.scrapeGain.gain.value = 0;
      src.connect(band).connect(this.scrapeGain).connect(ctx.destination);
      src.start();
    }
    const v = this.muted ? 0 : Math.min(1, Math.max(0, level));
    // Only a real drag scrapes; a nudge stays quiet.
    const target = v < 0.15 ? 0 : 0.05 + 0.2 * v;
    this.scrapeGain.gain.setTargetAtTime(target, ctx.currentTime, 0.04);
    this.scrapeBand!.frequency.setTargetAtTime(2400 + 2400 * v, ctx.currentTime, 0.05);
  }

  /** White noise with a falling envelope (shape: how fast it falls). */
  private noise(seconds: number, shape: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** shape;
    return buf;
  }

  /** A second of hiss with sparse sharp crackles in it: metal grinding on stone. */
  private grit(): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let crackle = 0;
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.0015) crackle = 1;
      crackle *= 0.995;
      data[i] = (Math.random() * 2 - 1) * (0.35 + crackle * 0.9);
    }
    return buf;
  }

  /** A short tone with a fast attack and an exponential tail. */
  private tone(freq: number, start: number, length: number, gain: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + length);
    o.connect(g).connect(ctx.destination);
    o.start(start);
    o.stop(start + length + 0.05);
  }

  /** A rising chime for a combo milestone or a caught capsule: more notes for bigger combos. */
  chime(level: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const notes = [784, 988, 1175, 1568, 1976];
    for (let i = 0; i < 2 + level; i++) this.tone(notes[i % notes.length], now + i * 0.07, 0.35, 0.12, 'triangle');
  }

  /** The call to arms: a brassy two-note horn over a drum roll. */
  horn() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    for (const [freq, at, len] of [[196, 0, 0.32], [294, 0.3, 0.7]] as const) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(freq * 0.97, now + at);
        o.frequency.linearRampToValueAtTime(freq, now + at + 0.06);
        o.detune.value = detune;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now + at);
        g.gain.exponentialRampToValueAtTime(0.09, now + at + 0.05);
        g.gain.setValueAtTime(0.09, now + at + len - 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, now + at + len);
        o.connect(f).connect(g).connect(ctx.destination);
        o.start(now + at);
        o.stop(now + at + len + 0.02);
      }
    }
    // Drums under it.
    for (let i = 0; i < 6; i++) this.tone(70 + (i % 2) * 15, now + i * 0.11, 0.12, 0.35, 'sine');
  }

  /** A deep boom for barrels and collapsing tower floors. */
  boom() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, now);
    o.frequency.exponentialRampToValueAtTime(30, now + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(now);
    o.stop(now + 0.65);
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 700;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    noise.connect(low).connect(ng).connect(ctx.destination);
    noise.start(now);
  }

  /** A wooden thunk when a defender is set down. */
  thunk() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.tone(180, ctx.currentTime, 0.12, 0.3, 'square');
  }
}
