/**
 * Sound effects made on the fly with Web Audio, so there are no sound files
 * to load. Placeholders until real recordings arrive.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private lastClang = 0;
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
