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
  private hordeGain: GainNode | null = null;
  private hordeVoice: BiquadFilterNode | null = null;
  private nextDrum = 0;
  private drumBeat = 0;
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
   * The ring of a big steel plate: a low body tone with inharmonic overtones (a beaten plate,
   * not a bell), each pair slightly detuned so it shimmers, all through a lowpass so nothing
   * is thin or tinny. size scales the pitch down and the ring out.
   */
  private plate(now: number, out: AudioNode, base: number, ring: number, level: number) {
    const ctx = this.ctx!;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    tone.Q.value = 0.5;
    tone.connect(out);
    for (const [ratio, amp, decay] of [[1, 0.55, 1], [1.59, 0.4, 0.8], [2.13, 0.3, 0.65], [2.98, 0.2, 0.5], [3.9, 0.12, 0.35], [5.2, 0.06, 0.2]]) {
      for (const detune of [-0.004, 0.004]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = base * ratio * (1 + detune);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(amp * level * 0.5, now + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0008, now + ring * decay);
        o.connect(g).connect(tone);
        o.start(now);
        o.stop(now + ring * decay + 0.05);
      }
    }
  }

  /** A low thud: a sine dropping in pitch, for the weight of a blow. */
  private thud(now: number, out: AudioNode, from: number, to: number, length: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(from, now);
    o.frequency.exponentialRampToValueAtTime(to, now + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + length * 1.2);
    o.connect(g).connect(out);
    o.start(now);
    o.stop(now + length * 1.3);
  }

  /** The smack of impact itself: a short burst of noise, darker for a bigger hit. */
  private smack(now: number, out: AudioNode, freq: number, length: number, level: number) {
    const ctx = this.ctx!;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise(length, 2);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq;
    band.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = level;
    noise.connect(band).connect(g).connect(out);
    noise.start(now);
  }

  /**
   * A heave: the whole shield slammed into a ball (or the orcs). A deep, heavy CLANG: a thump
   * you feel, a dark smack and a big plate ringing on for over a second. A perfect parry rings brighter.
   */
  clang(parry: boolean) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastClang < 0.05) return;
    this.lastClang = now;
    const out = ctx.createGain();
    out.gain.value = parry ? 0.6 : 0.5;
    out.connect(ctx.destination);
    const pitch = (parry ? 1.15 : 1) * (0.95 + Math.random() * 0.1);
    this.thud(now, out, 110, 38, 0.28, 1);
    this.smack(now, out, 900 * pitch, 0.07, 0.9);
    this.plate(now, out, 132 * pitch, parry ? 1.8 : 1.3, 1);
  }

  /**
   * An ordinary ball off the shield: still a big steel shield, so a solid, low "dong" with a
   * short ring and a thump under it, varied a little each time so a rally doesn't drone.
   */
  clink() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastClink < 0.03) return;
    this.lastClink = now;
    const out = ctx.createGain();
    out.gain.value = 0.32;
    out.connect(ctx.destination);
    const pitch = 0.9 + Math.random() * 0.22;
    this.thud(now, out, 160 * pitch, 60, 0.12, 0.7);
    this.smack(now, out, 1300 * pitch, 0.04, 0.6);
    this.plate(now, out, 196 * pitch, 0.55, 0.8);
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

  /** A bell ring: a bright strike with a bronze overtone, a step higher for each bell of the set already rung. */
  bell(n: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const f = 523 * 2 ** ((Math.max(1, n) - 1) * 0.25);
    this.tone(f, now, 0.9, 0.16, 'sine');
    this.tone(f * 2.76, now, 0.5, 0.07, 'sine');
    this.tone(f * 0.5, now, 0.7, 0.08, 'triangle');
  }

  /** The battle-ready horn: a brassy two-note horn over a drum roll. */
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

  /**
   * The horde: a rumble of feet, a growling murmur from hundreds of throats and the orcs'
   * war drums, all swelling with how many of them are on the field (level 0 to 1), with
   * the odd yell over the top. Call every frame.
   */
  horde(level: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.hordeGain) {
      this.hordeGain = ctx.createGain();
      this.hordeGain.gain.value = 0;
      this.hordeGain.connect(ctx.destination);
      // Feet: a loop of irregular low thuds.
      const feet = ctx.createBufferSource();
      feet.buffer = this.stomps();
      feet.loop = true;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 420;
      feet.connect(low).connect(this.hordeGain);
      feet.start();
      // The murmur: low growling saws through an "oh" vowel, wobbling slowly.
      const voice = ctx.createBiquadFilter();
      voice.type = 'bandpass';
      voice.frequency.value = 480;
      voice.Q.value = 1.6;
      this.hordeVoice = voice;
      const vg = ctx.createGain();
      vg.gain.value = 0.16;
      voice.connect(vg).connect(this.hordeGain);
      for (const f of [82, 97, 110, 123, 138]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.15 + Math.random() * 0.3;
        const depth = ctx.createGain();
        depth.gain.value = f * 0.04;
        lfo.connect(depth).connect(o.frequency);
        o.connect(voice);
        o.start();
        lfo.start();
      }
      const crowd = ctx.createBufferSource();
      crowd.buffer = this.grit();
      crowd.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 650;
      band.Q.value = 0.7;
      const cg = ctx.createGain();
      cg.gain.value = 0.05;
      crowd.connect(band).connect(cg).connect(this.hordeGain);
      crowd.start();
    }
    const v = this.muted ? 0 : Math.min(1, Math.max(0, level));
    const now = ctx.currentTime;
    this.hordeGain.gain.setTargetAtTime(v < 0.02 ? 0 : 0.06 + 0.3 * v, now, 0.6);
    this.hordeVoice!.frequency.setTargetAtTime(420 + 160 * v, now, 0.5);
    if (v < 0.05) {
      this.nextDrum = now;
      return;
    }
    // War drums: BOOM boom, BOOM boom, slightly ragged.
    this.nextDrum = Math.max(this.nextDrum, now);
    while (this.nextDrum < now + 0.25) {
      const strong = this.drumBeat % 2 === 0;
      this.drum(this.nextDrum, (strong ? 0.5 : 0.3) * (0.4 + 0.6 * v), strong ? 62 : 74);
      this.nextDrum += (strong ? 0.28 : 0.52) + Math.random() * 0.03;
      this.drumBeat++;
    }
    // Now and then a yell from the crowd.
    if (Math.random() < 0.012 * v) this.yell(now + Math.random() * 0.2, 0.05 + 0.05 * v);
  }

  private drum(at: number, gain: number, freq: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.6, at);
    o.frequency.exponentialRampToValueAtTime(freq, at + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    o.connect(g).connect(this.hordeGain ?? ctx.destination);
    o.start(at);
    o.stop(at + 0.5);
  }

  /** One orc bellowing: a gravelly saw that rises and falls through a vowel. */
  private yell(at: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = 130 + Math.random() * 90;
    const len = 0.4 + Math.random() * 0.4;
    o.frequency.setValueAtTime(f * 0.8, at);
    o.frequency.linearRampToValueAtTime(f * 1.25, at + len * 0.3);
    o.frequency.linearRampToValueAtTime(f * 0.7, at + len);
    const vowel = ctx.createBiquadFilter();
    vowel.type = 'bandpass';
    vowel.frequency.setValueAtTime(600, at);
    vowel.frequency.linearRampToValueAtTime(1000, at + len * 0.4);
    vowel.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(vowel).connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + len + 0.05);
  }

  /** Two seconds of heavy, uneven footfalls. */
  private stomps(): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let env = 0;
    for (let i = 0; i < len; i++) {
      if (Math.random() < 30 / ctx.sampleRate) env = 0.6 + Math.random() * 0.4;
      env *= 0.9993;
      data[i] = (Math.random() * 2 - 1) * (0.15 + env);
    }
    return buf;
  }

  /** A mage's blast: a rising arcane zap into a low, shimmering thump. */
  mage() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.35;
    out.connect(ctx.destination);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(240, now);
    o.frequency.exponentialRampToValueAtTime(1400, now + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    o.connect(g).connect(out);
    o.start(now);
    o.stop(now + 0.3);
    this.thud(now + 0.18, out, 150, 45, 0.3, 1);
    this.tone(880, now + 0.18, 0.4, 0.12, 'sine');
  }

  /** The ballista loosed: a deep twang of the arms and a whoosh. */
  ballista() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);
    this.thud(now, out, 120, 40, 0.25, 1);
    this.smack(now, out, 700, 0.12, 0.8);
    this.tone(95, now, 0.5, 0.3, 'triangle');
  }

  /** Boiling oil sloshing down the wall: a hiss and a bubbling splash. */
  oil() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise(0.8, 1);
    const band = ctx.createBiquadFilter();
    band.type = 'highpass';
    band.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    noise.connect(band).connect(g).connect(ctx.destination);
    noise.start(now);
    for (let i = 0; i < 6; i++) this.tone(180 + Math.random() * 220, now + 0.1 + Math.random() * 0.5, 0.06, 0.08, 'sine');
  }

  /** A ball glancing off a spike trap: a sharp metallic tick. */
  spike() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(1800, now, 0.06, 0.12, 'square');
    this.tone(1200, now + 0.02, 0.1, 0.08, 'triangle');
  }

  /** A wooden thunk when a defender is set down. */
  thunk() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.tone(180, ctx.currentTime, 0.12, 0.3, 'square');
  }

  /**
   * A short voice-like grunt or shout: a sawtooth with a quick pitch bend through two bandpass
   * filters (vowel formants). Soldiers bark low and long, archers shout higher and shorter.
   */
  voice(kind?: string) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const soldier = kind === 'soldiers';
    const archer = kind === 'archers';
    const base = soldier ? 100 : archer ? 150 : kind === 'mage' ? 175 : kind === 'catapult' || kind === 'ballista' ? 90 : 120;
    const pitch = base * (0.92 + Math.random() * 0.16);
    const len = soldier ? 0.34 : archer ? 0.24 : 0.28;
    const [f1, f2] = soldier ? [520, 950] : archer ? [720, 1700] : [640, 1200];
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch * 0.85, now);
    o.frequency.exponentialRampToValueAtTime(pitch * 1.25, now + 0.05);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.7, now + len);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.28, now + 0.03);
    out.gain.exponentialRampToValueAtTime(0.0001, now + len);
    out.connect(ctx.destination);
    for (const [freq, level] of [[f1, 1], [f2, 0.6]] as const) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(freq * 0.9, now);
      band.frequency.linearRampToValueAtTime(freq * 1.1, now + len);
      band.Q.value = 6;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(band).connect(g).connect(out);
    }
    o.start(now);
    o.stop(now + len + 0.05);
  }

  /** A soldier company on the march: "hut hut hut", three short low barks in rhythm with a slight pitch wobble. */
  hut() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const now = t0 + i * 0.17;
      const len = 0.1;
      const pitch = 95 * (0.93 + Math.random() * 0.14) * (i === 2 ? 1.12 : 1);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(pitch * 1.2, now);
      o.frequency.exponentialRampToValueAtTime(pitch * 0.75, now + len);
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, now);
      out.gain.exponentialRampToValueAtTime(0.26, now + 0.015);
      out.gain.exponentialRampToValueAtTime(0.0001, now + len);
      out.connect(ctx.destination);
      for (const [freq, level] of [[480, 1], [900, 0.5]] as const) {
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = freq;
        band.Q.value = 5;
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(band).connect(g).connect(out);
      }
      o.start(now);
      o.stop(now + len + 0.05);
    }
  }

  /** Wood and stone knocked about: a quick rattle of ticks (taking a barricade or rubble back). */
  rattle() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 6; i++) this.tone(260 + Math.random() * 320, now + i * 0.045, 0.06, 0.1, i % 2 ? 'square' : 'triangle');
  }
}
