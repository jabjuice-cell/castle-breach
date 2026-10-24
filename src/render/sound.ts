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
}
