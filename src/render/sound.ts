/**
 * Sound effects made on the fly with Web Audio, so there are no sound files
 * to load. Placeholders until real recordings arrive.
 */
/**
 * The shield's plate voices: [overtone ratio, level, decay] for a beaten steel plate. Each hit picks one,
 * so a long rally never sounds like the same sample: the plain face, a dented gong-ish patch, the bright
 * rim, and the strapped centre where a second plate doubles the body tone.
 */
const PLATES: [number, number, number][][] = [
  [[1, 0.55, 1], [1.59, 0.4, 0.8], [2.13, 0.3, 0.65], [2.98, 0.2, 0.5], [3.9, 0.12, 0.35], [5.2, 0.06, 0.2]],
  [[1, 0.5, 1], [1.47, 0.45, 0.9], [2.31, 0.28, 0.6], [2.76, 0.22, 0.55], [4.07, 0.12, 0.3], [5.6, 0.05, 0.2]],
  [[1, 0.4, 0.7], [1.71, 0.42, 0.7], [2.53, 0.32, 0.55], [3.42, 0.22, 0.4], [4.6, 0.14, 0.3], [6.1, 0.08, 0.18]],
  [[1, 0.5, 1], [1.08, 0.3, 0.9], [1.83, 0.3, 0.6], [2.67, 0.2, 0.5], [3.6, 0.12, 0.35], [4.9, 0.06, 0.2]],
];
/** The plate voices across the shield's face (the rim, 2, is kept for edge hits). */
const FACE_PLATES = [0, 1, 3];

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
  /** Everything plays through one gentle compressor, so a big combo's pile of bangs doesn't clip. */
  private master: AudioNode | null = null;

  /** Browsers only allow audio after a click, so call this from one. */
  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.knee.value = 8;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        comp.connect(this.ctx.destination);
        this.master = comp;
      }
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private get dest(): AudioNode {
    return this.master ?? this.ctx!.destination;
  }

  /**
   * The ring of a big steel plate: a low body tone with inharmonic overtones (a beaten plate,
   * not a bell), each pair slightly detuned so it shimmers, all through a lowpass so nothing
   * is thin or tinny. size scales the pitch down and the ring out.
   */
  private plate(now: number, out: AudioNode, base: number, ring: number, level: number, profile = 0) {
    const ctx = this.ctx!;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = profile === 2 ? 3400 : 2600;
    tone.Q.value = 0.5;
    tone.connect(out);
    for (const [ratio, amp, decay] of PLATES[profile] ?? PLATES[0]) {
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

  /** The last plate voice used, so two hits in a row never ring the same. */
  private lastPlate = -1;

  /** Picks one of the shield's plate voices: the rim always rings bright; across the face it varies hit to hit. */
  private pickPlate(rim: boolean): number {
    if (rim) return 2;
    let p = 0;
    do p = FACE_PLATES[(Math.random() * FACE_PLATES.length) | 0];
    while (p === this.lastPlate);
    this.lastPlate = p;
    return p;
  }

  /**
   * A heave: the whole shield slammed into a ball (or the orcs). A deep, heavy CLANG: a thump
   * you feel, a dark smack and a big plate ringing on for over a second. A perfect parry rings brighter.
   * offset: where on the shield it struck, -1 (left edge) to +1 (right edge). The middle is deep,
   * the rim higher and brighter. A heave also wobbles the whole sheet of steel: "wubwubwub".
   */
  clang(parry: boolean, offset = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastClang < 0.05) return;
    this.lastClang = now;
    const out = ctx.createGain();
    out.gain.value = parry ? 0.6 : 0.5;
    out.connect(this.dest);
    const off = Math.min(1, Math.abs(offset));
    const rim = off > 0.8;
    const pitch = (parry ? 1.15 : 1) * (0.93 + Math.random() * 0.14) * (1 + 0.16 * off);
    this.thud(now, out, 110, 38, 0.28, 1);
    this.smack(now, out, (rim ? 1500 : 900) * pitch, 0.07, 0.9);
    this.plate(now, out, 132 * pitch, parry ? 1.8 : 1.3, 1, this.pickPlate(rim));
    if (parry) this.wobble(now, out, 64 * pitch, 1.1, 0.3);
  }

  /**
   * An ordinary ball off the shield: still a big steel shield, so a solid, low "dong" with a
   * short ring and a thump under it, varied a little each time so a rally doesn't drone.
   * offset as for clang: the rim rings higher, and now and then the rivets rattle.
   */
  clink(offset = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastClink < 0.03) return;
    this.lastClink = now;
    const out = ctx.createGain();
    // A satisfying return (Jonny, 7 Nov): more body under the ring, and a sub-bass punch.
    out.gain.value = 0.4;
    out.connect(this.dest);
    const off = Math.min(1, Math.abs(offset));
    const rim = off > 0.8;
    const pitch = (0.9 + Math.random() * 0.22) * (1 + 0.14 * off);
    this.thud(now, out, 120 * pitch, 40, 0.18, 1);
    this.thud(now, out, 260 * pitch, 90, 0.07, 0.5);
    this.smack(now, out, (rim ? 1600 : 1100) * pitch, 0.05, 0.75);
    this.plate(now, out, 176 * pitch, rim ? 0.55 : 0.7, 0.85, this.pickPlate(rim));
    // One hit in five shakes the rivets and straps on the back of the shield.
    if (Math.random() < 0.2) for (let i = 0; i < 4; i++) this.smack(now + 0.04 + i * 0.03 + Math.random() * 0.015, out, 3200 + Math.random() * 1500, 0.012, 0.35);
  }

  /** A big sheet of steel flexing after a heavy blow: a low tone wobbling in pitch and level, slowing as it settles. */
  private wobble(now: number, out: AudioNode, freq: number, length: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(11, now);
    lfo.frequency.exponentialRampToValueAtTime(4, now + length);
    const bend = ctx.createGain();
    bend.gain.value = freq * 0.1;
    lfo.connect(bend).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + length);
    const trem = ctx.createGain();
    trem.gain.value = level * 0.6;
    lfo.connect(trem).connect(g.gain);
    o.connect(g).connect(out);
    o.start(now);
    lfo.start(now);
    o.stop(now + length + 0.05);
    lfo.stop(now + length + 0.05);
  }

  /** The "ding!" on a perfectly timed heave: a bright little bell over the clang. */
  ding() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(2093, now + 0.02, 0.5, 0.09, 'triangle');
    this.tone(3136, now + 0.07, 0.6, 0.07, 'triangle');
    this.tone(4186, now + 0.07, 0.3, 0.03, 'sine');
  }

  private lastTonk = 0;

  /** A helmet knocked off an orc: a tinny pot-lid "tonk" and a cartoon pop as it flies. */
  tonk() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastTonk < 0.07) return;
    this.lastTonk = now;
    const out = ctx.createGain();
    out.gain.value = 0.3;
    out.connect(this.dest);
    const pitch = 0.9 + Math.random() * 0.25;
    this.plate(now, out, 430 * pitch, 0.28, 0.8, 2);
    this.smack(now, out, 2600 * pitch, 0.02, 0.7);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(380 * pitch, now + 0.02);
    o.frequency.exponentialRampToValueAtTime(1100 * pitch, now + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.25, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g).connect(out);
    o.start(now + 0.02);
    o.stop(now + 0.15);
  }

  private lastChunk = 0;
  private lastWall = 0;

  /**
   * A chunky hit on an orc (Jonny, 7 Nov: "more sound effects that are chunky"): a punchy low body blow, a wet
   * squelch and a crack of bone or armour. kill: the orc goes down, so heavier; big: an ogre or bigger.
   */
  chunk(kill: boolean, big = false) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastChunk < (kill ? 0.045 : 0.03)) return;
    this.lastChunk = now;
    const out = ctx.createGain();
    out.gain.value = kill ? (big ? 0.7 : 0.45) : 0.28;
    out.connect(this.dest);
    const pitch = (big ? 0.6 : 1) * (0.85 + Math.random() * 0.3);
    this.thud(now, out, 150 * pitch, 42 * pitch, kill ? 0.16 : 0.09, 1);
    this.smack(now, out, 520 * pitch, kill ? 0.07 : 0.04, 1);
    if (!kill) return;
    // The squelch: noise through a band sweeping down, then a crack.
    const ctx2 = ctx;
    const n = ctx2.createBufferSource();
    n.buffer = this.noise(0.18, 1.5);
    const band = ctx2.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 3;
    band.frequency.setValueAtTime(1400 * pitch, now);
    band.frequency.exponentialRampToValueAtTime(260 * pitch, now + 0.16);
    const g = ctx2.createGain();
    g.gain.value = 0.9;
    n.connect(band).connect(g).connect(out);
    n.start(now + 0.01);
    this.smack(now + 0.02, out, 2600 * pitch, 0.025, 0.6);
  }

  /** Something hits the wall (Jonny, 7 Nov: make it impactful): a deep stone thud you feel, the crack, and rubble. */
  wallHit(damage: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastWall < 0.07) return;
    this.lastWall = now;
    const level = Math.min(1, 0.35 + damage / 25);
    const out = ctx.createGain();
    out.gain.value = 0.75 * level;
    out.connect(this.dest);
    this.thud(now, out, 95, 30, 0.35, 1.2);
    this.thud(now + 0.01, out, 210, 70, 0.12, 0.6);
    this.smack(now, out, 700, 0.12, 1);
    this.lastCrunch = 0;
    this.crunch(damage);
  }

  /** A countdown tick: a wooden knock and a short note, higher on the last one. */
  tick(n: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.4;
    out.connect(this.dest);
    this.thud(now, out, 400, 160, 0.06, 0.8);
    this.smack(now, out, 1800, 0.03, 0.8);
    this.tone(n === 1 ? 880 : 660, now, 0.18, 0.12, 'triangle');
  }

  /** A ball shot into an orbit rail: a rising whoosh and the rattle of iron wheels. */
  railIn() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noise(0.6, 1);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2;
    band.frequency.setValueAtTime(300, now);
    band.frequency.exponentialRampToValueAtTime(2400, now + 0.55);
    const g = ctx.createGain();
    g.gain.value = 0.35;
    n.connect(band).connect(g).connect(this.dest);
    n.start(now);
    for (let i = 0; i < 8; i++) this.tone(900 + i * 60, now + i * 0.06, 0.04, 0.04, 'square');
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
    noise.connect(low).connect(g).connect(this.dest);
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
      src.connect(band).connect(this.scrapeGain).connect(this.dest);
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
    o.connect(g).connect(this.dest);
    o.start(start);
    o.stop(start + length + 0.05);
  }

  /** A short note for an orc hit by a ball: climbs a major pentatonic scale with the ball's combo (1 is the first hit, reset at the shield). */
  hitNote(combo: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const step = Math.min(Math.max(1, combo) - 1, 14);
    const degrees = [0, 2, 4, 7, 9];
    const semis = degrees[step % 5] + 12 * Math.floor(step / 5);
    const f = 392 * 2 ** (semis / 12);
    const now = ctx.currentTime;
    this.tone(f, now, 0.14, 0.09, 'triangle');
    this.tone(f * 2, now, 0.08, 0.03, 'sine');
  }

  /** A rising chime for a combo milestone or a caught capsule: more notes for bigger combos. */
  chime(level: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const notes = [784, 988, 1175, 1568, 1976];
    for (let i = 0; i < 2 + level; i++) this.tone(notes[i % notes.length], now + i * 0.07, 0.35, 0.12, 'triangle');
  }

  /** A coin caught: a short bright two-note ping. */
  coin() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    this.tone(1319, now, 0.12, 0.1, 'triangle');
    this.tone(1976, now + 0.06, 0.25, 0.1, 'triangle');
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
        o.connect(f).connect(g).connect(this.dest);
        o.start(now + at);
        o.stop(now + at + len + 0.02);
      }
    }
    // Drums under it.
    for (let i = 0; i < 6; i++) this.tone(70 + (i % 2) * 15, now + i * 0.11, 0.12, 0.35, 'sine');
  }

  /** A deep boom for barrels and collapsing tower floors. */
  boom(delay = 0, level = 1) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, now);
    o.frequency.exponentialRampToValueAtTime(30, now + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7 * level, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    o.connect(g).connect(this.dest);
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
    ng.gain.value = 0.5 * level;
    noise.connect(low).connect(ng).connect(this.dest);
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
      this.hordeGain.connect(this.dest);
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
    o.connect(g).connect(this.hordeGain ?? this.dest);
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
    o.connect(vowel).connect(g).connect(this.dest);
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
    out.connect(this.dest);
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
    out.connect(this.dest);
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
    noise.connect(band).connect(g).connect(this.dest);
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
  /**
   * A ball off a shield team's big wooden shield: a dull wooden-iron THUNK, not the castle's ringing clang.
   * A low knock, a dark smack of planks and a short dead ring of the iron bands. splinter: it gives way, with cracking.
   */
  woodThunk(splinter: boolean) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = splinter ? 0.55 : 0.4;
    out.connect(this.dest);
    const pitch = 0.9 + Math.random() * 0.2;
    this.thud(now, out, 140 * pitch, 55, 0.16, 1);
    this.smack(now, out, 420 * pitch, 0.08, 1);
    this.plate(now, out, 240 * pitch, 0.18, 0.35);
    if (!splinter) return;
    // Planks cracking apart.
    for (let i = 0; i < 6; i++) this.smack(now + 0.03 + i * 0.035 + Math.random() * 0.02, out, 1500 + Math.random() * 1500, 0.03, 0.7);
  }

  /** The warlord's roar at half health: a long, deep, growling bellow. */
  roar() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const len = 1.3;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, now);
    o.frequency.exponentialRampToValueAtTime(95, now + 0.25);
    o.frequency.exponentialRampToValueAtTime(55, now + len);
    // A growl: the level shudders about 28 times a second.
    const growl = ctx.createOscillator();
    growl.frequency.value = 28;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.5, now + 0.08);
    out.gain.setValueAtTime(0.5, now + len * 0.6);
    out.gain.exponentialRampToValueAtTime(0.0001, now + len);
    growl.connect(depth).connect(out.gain);
    out.connect(this.dest);
    for (const [freq, level] of [[420, 1], [900, 0.5]] as const) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freq;
      band.Q.value = 3;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(band).connect(g).connect(out);
    }
    o.start(now);
    growl.start(now);
    o.stop(now + len + 0.05);
    growl.stop(now + len + 0.05);
  }

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
    out.connect(this.dest);
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
      out.connect(this.dest);
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

  // ---- Fireworks -------------------------------------------------------------------------

  private lastLaunch = 0;
  private lastBurst = 0;
  private crackleBuf: AudioBuffer | null = null;

  /** A sound placed left or right with the x position on the field (the field is about ±16 wide). */
  private panned(x: number, gain: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.8, Math.min(0.8, x / 20));
      g.connect(pan).connect(this.dest);
    } else g.connect(this.dest);
    return g;
  }

  /** A firework rocket going up: a cartoon whistle that climbs, with the fizz of the fuse. size: the rocket's size (about 0.8 to 1.4). */
  rocketLaunch(x: number, size: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastLaunch < 0.07) return;
    this.lastLaunch = now;
    const out = this.panned(x, 0.11);
    const len = 0.6 + Math.random() * 0.25;
    const from = 700 + Math.random() * 300;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(from, now);
    o.frequency.exponentialRampToValueAtTime(from * (2.6 + Math.random() * 0.6), now + len);
    const vib = ctx.createOscillator();
    vib.frequency.value = 18;
    const depth = ctx.createGain();
    depth.gain.value = 25;
    vib.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.6 * Math.min(1.2, size), now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    o.connect(g).connect(out);
    o.start(now);
    vib.start(now);
    o.stop(now + len + 0.05);
    vib.stop(now + len + 0.05);
    const fizz = ctx.createBufferSource();
    fizz.buffer = this.noise(len, 0.6);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const fg = ctx.createGain();
    fg.gain.value = 0.5;
    fizz.connect(hp).connect(fg).connect(out);
    fizz.start(now);
  }

  /** A firework bursting: a sharp BANG, a low boom for the big ones and a long crackle of glitter falling. */
  rocketBurst(x: number, size: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastBurst < 0.05) return;
    this.lastBurst = now;
    const out = this.panned(x, 0.3 * Math.min(1.3, size));
    this.smack(now, out, 1600 + Math.random() * 800, 0.06, 1);
    this.thud(now, out, 140, 45, 0.18 + 0.12 * size, 0.9);
    this.crackleBuf ??= this.crackles();
    const c = ctx.createBufferSource();
    c.buffer = this.crackleBuf;
    c.playbackRate.value = 0.85 + Math.random() * 0.3;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const cg = ctx.createGain();
    cg.gain.value = 0.45 * size;
    c.connect(hp).connect(cg).connect(out);
    c.start(now + 0.08);
  }

  /** A second and a half of glitter crackle: sparse sharp pops, thinning out as the sparks fall. */
  private crackles(): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let pop = 0;
    for (let i = 0; i < len; i++) {
      const left = 1 - i / len;
      if (Math.random() < 0.0016 * left) pop = 0.5 + Math.random() * 0.5;
      pop *= 0.985;
      data[i] = (Math.random() * 2 - 1) * pop * left;
    }
    return buf;
  }

  /** One brassy note: two detuned saws through a lowpass, swelling in like a herald's trumpet. */
  private brass(freq: number, at: number, len: number, gain: number, out: AudioNode) {
    const ctx = this.ctx!;
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq * 0.97, at);
      o.frequency.linearRampToValueAtTime(freq, at + 0.05);
      o.detune.value = detune;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, at);
      f.frequency.linearRampToValueAtTime(2600, at + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.04);
      g.gain.setValueAtTime(gain, at + Math.max(0.05, len - 0.08));
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(f).connect(g).connect(out);
      o.start(at);
      o.stop(at + len + 0.02);
    }
  }

  /** A cymbal crash: a long shimmer of bright noise. */
  private crash(at: number, out: AudioNode, length: number, level: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise(length, 2.2);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const g = ctx.createGain();
    g.gain.value = level;
    n.connect(hp).connect(g).connect(out);
    n.start(at);
  }

  /**
   * A combo milestone's fanfare, grander with each tier: tier 1 a "ta-DA!", tier 2 a rising three-note
   * call with a crash, tier 3 the full royal flourish ending on a held chord, a big crash and a timpani roll.
   */
  fanfare(tier: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(this.dest);
    const G4 = 392, C5 = 523.3, E5 = 659.3, G5 = 784, C6 = 1046.5;
    if (tier <= 1) {
      this.brass(G4, now, 0.12, 0.08, out);
      this.brass(C5, now + 0.13, 0.45, 0.09, out);
      this.tone(C6, now + 0.13, 0.4, 0.05, 'triangle');
      return;
    }
    if (tier === 2) {
      this.brass(G4, now, 0.1, 0.08, out);
      this.brass(C5, now + 0.11, 0.1, 0.08, out);
      this.brass(E5, now + 0.22, 0.55, 0.09, out);
      this.brass(C5, now + 0.22, 0.55, 0.05, out);
      this.crash(now + 0.22, out, 1.2, 0.18);
      return;
    }
    // Tier 3: da-da-da-DAAAA on a C major chord, with drums under it.
    const steps: [number, number, number][] = [[G4, 0, 0.09], [G4, 0.1, 0.09], [C5, 0.2, 0.09], [E5, 0.3, 0.12]];
    for (const [f, at, len] of steps) this.brass(f, now + at, len, 0.08, out);
    for (const f of [C5, E5, G5]) this.brass(f, now + 0.44, 0.9, 0.06, out);
    this.tone(C6, now + 0.44, 0.9, 0.05, 'triangle');
    this.crash(now + 0.44, out, 1.8, 0.25);
    for (let i = 0; i < 8; i++) this.drumHit(now + i * 0.055, out, 0.15 + i * 0.04);
    this.drumHit(now + 0.44, out, 0.6);
  }

  /** A timpani-ish hit: a low tone bending down. */
  private drumHit(at: number, out: AudioNode, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, at);
    o.frequency.exponentialRampToValueAtTime(70, at + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.35);
  }

  // ---- Bosses: the Warlord's armour --------------------------------------------------------

  private lastTink = 0;

  /** A ball dinging a plate of the Warlord's armour: a hard, short armour "TANG". left: hits that plate can still take. */
  armourTink(left: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastTink < 0.04) return;
    this.lastTink = now;
    const out = ctx.createGain();
    out.gain.value = 0.35;
    out.connect(this.dest);
    // A plate near breaking sounds looser: lower and buzzier.
    const pitch = (left <= 1 ? 0.8 : 1) * (0.92 + Math.random() * 0.16);
    this.smack(now, out, 2400 * pitch, 0.03, 0.9);
    this.thud(now, out, 200 * pitch, 70, 0.08, 0.6);
    this.plate(now, out, 300 * pitch, left <= 1 ? 0.25 : 0.4, 0.8, 2);
    if (left <= 1) this.tone(150 * pitch, now, 0.12, 0.05, 'square');
  }

  /**
   * A plate of armour torn off and flung away: a big CLANK as it breaks loose, a whoosh as it flies,
   * then it lands and bounces like a dropped pot lid, clank, clank-clank-clatter-tink.
   */
  armourOff(x = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = this.panned(x, 0.5);
    const pitch = 0.9 + Math.random() * 0.2;
    this.thud(now, out, 130, 45, 0.22, 1);
    this.smack(now, out, 1300 * pitch, 0.06, 1);
    this.plate(now, out, 190 * pitch, 0.7, 0.9, 1);
    this.whoosh(now + 0.05, out, 0.4, 0.5);
    // The bounces: each one sooner and quieter than the last.
    let t = 0.5;
    let gap = 0.24;
    let level = 0.7;
    for (let i = 0; i < 6; i++) {
      this.plate(now + t, out, (260 + i * 15) * pitch, 0.12 + level * 0.15, level, 2);
      this.smack(now + t, out, 2000 * pitch, 0.02, level);
      t += gap;
      gap *= 0.62;
      level *= 0.68;
    }
  }

  /** Air rushing past: noise through a band sweeping down. */
  private whoosh(at: number, out: AudioNode, length: number, level: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise(length, 0.8);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.5;
    band.frequency.setValueAtTime(2800, at);
    band.frequency.exponentialRampToValueAtTime(500, at + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + length * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    n.connect(band).connect(g).connect(out);
    n.start(at);
  }

  /** The Warlord's belt snaps: a twang and a big cartoon "BOI-OI-OING" of the buckle springing loose. */
  sproing() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.45;
    out.connect(this.dest);
    this.smack(now, out, 1800, 0.04, 1);
    const len = 0.9;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(330, now + 0.12);
    o.frequency.exponentialRampToValueAtTime(220, now + len);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(14, now);
    lfo.frequency.exponentialRampToValueAtTime(6, now + len);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(90, now);
    depth.gain.exponentialRampToValueAtTime(10, now + len);
    lfo.connect(depth).connect(o.frequency);
    // A twangy "mouth" on it, like a jaw harp.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2;
    band.frequency.setValueAtTime(1600, now);
    band.frequency.exponentialRampToValueAtTime(500, now + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.9, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    o.connect(g);
    g.connect(out);
    g.connect(band).connect(out);
    o.start(now);
    lfo.start(now);
    o.stop(now + len + 0.05);
    lfo.stop(now + len + 0.05);
  }

  /** A row of the Warlord's armour cracks open: a splitting crunch of steel and a heavy clang. */
  armourCrack() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(this.dest);
    this.thud(now, out, 100, 35, 0.3, 1);
    for (let i = 0; i < 5; i++) this.smack(now + i * 0.025, out, 2200 + Math.random() * 1600, 0.02, 0.8);
    this.plate(now, out, 150, 1.1, 1, 1);
    this.plate(now + 0.03, out, 205, 0.6, 0.6, 2);
  }

  /**
   * The Warlord's last plate goes and out steps a scrawny orc on stilts: the armour bursts apart with a
   * boom and a cascade of clanking plates, a long deflating slide whistle, a tiny "eep!", and the
   * clack-clack-clack of stilts legging it off the field.
   */
  warlordReveal(x = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = this.panned(x, 0.55);
    this.boom(0, 0.9);
    for (let i = 0; i < 7; i++) {
      const t = 0.08 + i * 0.09 + Math.random() * 0.05;
      this.plate(now + t, out, 200 + Math.random() * 160, 0.3, 0.7 - i * 0.06, i % 3);
      this.smack(now + t, out, 1500 + Math.random() * 1000, 0.03, 0.6);
    }
    this.slideWhistle(now + 0.8, out, 1500, 260, 0.9, 0.35);
    this.eep(now + 1.85, out, 1.6);
    this.stilts(now + 2.1, out, 12);
  }

  /** A slide whistle gliding from one pitch to another, with a little wobble. */
  private slideWhistle(at: number, out: AudioNode, from: number, to: number, length: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + length);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.value = 12;
    vib.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.04);
    g.gain.setValueAtTime(level, at + length * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    o.connect(g).connect(out);
    o.start(at);
    vib.start(at);
    o.stop(at + length + 0.05);
    vib.stop(at + length + 0.05);
  }

  /** A tiny squeaky voice: "eep!" (pitch scales it). */
  private eep(at: number, out: AudioNode, pitch: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420 * pitch, at);
    o.frequency.exponentialRampToValueAtTime(700 * pitch, at + 0.07);
    o.frequency.exponentialRampToValueAtTime(560 * pitch, at + 0.16);
    const vowel = ctx.createBiquadFilter();
    vowel.type = 'bandpass';
    vowel.frequency.value = 2400;
    vowel.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.7, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    o.connect(vowel).connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.22);
  }

  /** Wooden stilts clacking away, fast and fading into the distance. */
  private stilts(at: number, out: AudioNode, steps: number) {
    for (let i = 0; i < steps; i++) {
      const t = at + i * 0.11;
      const level = 0.6 * (1 - i / steps);
      this.thud(t, out, i % 2 ? 620 : 520, 300, 0.04, level);
      this.smack(t, out, i % 2 ? 2100 : 1800, 0.015, level);
    }
  }

  // ---- Bosses: the siege tower ---------------------------------------------------------

  private lastPlank = 0;

  /** A plank of the siege tower smashed: a sharp crack of splitting wood and a few splinters. */
  woodCrack() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastPlank < 0.04) return;
    this.lastPlank = now;
    const out = ctx.createGain();
    out.gain.value = 0.4;
    out.connect(this.dest);
    const pitch = 0.85 + Math.random() * 0.3;
    this.smack(now, out, 2200 * pitch, 0.03, 1);
    this.thud(now, out, 240 * pitch, 90, 0.08, 0.8);
    this.smack(now + 0.01, out, 650 * pitch, 0.06, 0.6);
    for (let i = 0; i < 3; i++) this.smack(now + 0.04 + i * 0.03 + Math.random() * 0.02, out, 2800 + Math.random() * 1500, 0.012, 0.4);
  }

  /** A timber groaning as it gives: a low, creaky saw scraping through a narrow band. */
  private creak(at: number, out: AudioNode, length: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, at);
    o.frequency.linearRampToValueAtTime(75, at + length * 0.4);
    o.frequency.linearRampToValueAtTime(42, at + length);
    // The stick-slip judder of the wood.
    const judder = ctx.createOscillator();
    judder.type = 'square';
    judder.frequency.value = 23;
    const jd = ctx.createGain();
    jd.gain.value = 0.5;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 7;
    band.frequency.setValueAtTime(700, at);
    band.frequency.linearRampToValueAtTime(420, at + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    judder.connect(jd).connect(g.gain);
    o.connect(band).connect(g).connect(out);
    o.start(at);
    judder.start(at);
    o.stop(at + length + 0.05);
    judder.stop(at + length + 0.05);
  }

  /** Beams and planks landing in a heap: hollow wooden knocks bouncing to a stop. */
  private timbers(at: number, out: AudioNode, count: number, level: number) {
    for (let i = 0; i < count; i++) {
      const t = at + i * 0.07 + Math.random() * 0.06;
      const l = level * (1 - (i / count) * 0.7);
      const p = 0.7 + Math.random() * 0.6;
      this.thud(t, out, 220 * p, 80 * p, 0.09, l);
      this.smack(t, out, 900 * p, 0.04, l * 0.7);
    }
  }

  /** A storey of the siege tower gives way: a splintering crack, the boom, a long groan as it slumps, and a heap of timbers. */
  floorCollapse(x = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = this.panned(x, 0.55);
    for (let i = 0; i < 6; i++) this.smack(now + i * 0.02, out, 1800 + Math.random() * 1400, 0.03, 0.9);
    this.boom(0.03, 0.9);
    this.creak(now + 0.15, out, 0.8, 0.5);
    this.timbers(now + 0.3, out, 8, 0.7);
  }

  /**
   * The siege tower comes down for good: the crack and boom, a long rumble of it all falling in, the timbers,
   * and then, once the dust settles, the one goblin who hasn't noticed: "hup! hup!" ... "huh?"
   */
  towerFalls(x = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = this.panned(x, 0.6);
    for (let i = 0; i < 8; i++) this.smack(now + i * 0.02, out, 1600 + Math.random() * 1600, 0.03, 1);
    this.boom(0, 1);
    this.boom(0.35, 0.7);
    this.creak(now + 0.1, out, 1.1, 0.55);
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise(2.2, 1.4);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 260;
    const rg = ctx.createGain();
    rg.gain.value = 1.1;
    rumble.connect(low).connect(rg).connect(out);
    rumble.start(now);
    this.timbers(now + 0.4, out, 14, 0.8);
    // The goblin, still pushing.
    this.grunt(now + 2.2, out, 1, 0.9);
    this.grunt(now + 2.6, out, 1.05, 0.9);
    this.huh(now + 3.15, out);
  }

  /** A little effort grunt: "hup!" (pitch scales it). */
  private grunt(at: number, out: AudioNode, pitch: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(260 * pitch, at);
    o.frequency.exponentialRampToValueAtTime(200 * pitch, at + 0.12);
    const vowel = ctx.createBiquadFilter();
    vowel.type = 'bandpass';
    vowel.frequency.value = 800;
    vowel.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    o.connect(vowel).connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.16);
  }

  /** A puzzled "huh?": a nasal voice gliding up like a question. */
  private huh(at: number, out: AudioNode) {
    const ctx = this.ctx!;
    const len = 0.42;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(230, at);
    o.frequency.exponentialRampToValueAtTime(210, at + 0.1);
    o.frequency.exponentialRampToValueAtTime(420, at + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.7, at + 0.04);
    g.gain.setValueAtTime(0.7, at + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    g.connect(out);
    for (const [freq, level] of [[700, 1], [1250, 0.6]] as const) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freq;
      band.Q.value = 6;
      const bg = ctx.createGain();
      bg.gain.value = level;
      o.connect(band).connect(bg).connect(g);
    }
    o.start(at);
    o.stop(at + len + 0.05);
  }
}
