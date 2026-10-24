import * as THREE from 'three';

/**
 * The "fireworks show": every hit, clang, heave, blast and combo throws glowing
 * particles. They are one pooled THREE.Points cloud with additive blending, so
 * thousands cost one draw call. The CPU only moves them; size and fade happen in
 * the shader.
 */

export interface BurstOptions {
  /** Particle count before the detail multiplier. */
  count: number;
  /** Colours to pick from, per particle. */
  colors: string[];
  speed: number;
  /** Seconds each particle lives (randomised up to +60%). */
  life?: number;
  /** Size in world units. */
  size?: number;
  /** Gravity: positive pulls down. Fireworks trail down slowly; sparks drop fast. */
  gravity?: number;
  /** Air drag per second. */
  drag?: number;
  /** Bias the burst upward (0 = a sphere, 1 = a fountain). */
  up?: number;
  /** Flat ring instead of a sphere (shockwaves). */
  ring?: boolean;
  /** Twinkle: particles flicker as they fade. */
  twinkle?: boolean;
}

const VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  uniform float scale;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    // A hot white core with a soft coloured glow round it.
    float core = smoothstep(0.45, 0.0, d);
    float glow = pow(1.0 - d, 1.6);
    vec3 col = mix(vTint, vec3(1.0), core * 0.7);
    gl_FragColor = vec4(col * (glow + core) * vAlpha, 1.0);
  }
`;

export class Fireworks {
  readonly points: THREE.Points;
  private max: number;
  private n = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private tint: Float32Array;
  private size: Float32Array;
  private baseSize: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private gravity: Float32Array;
  private drag: Float32Array;
  private twinkle: Uint8Array;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  /** Scales every burst's particle count (the Detail setting). */
  amount = 1;
  private color = new THREE.Color();

  constructor(max: number) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.tint = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.twinkle = new Uint8Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Point sizes are in world units; this converts them to pixels for the current viewport. */
  setViewport(heightPx: number, fovDeg: number) {
    this.mat.uniforms.scale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  get count(): number {
    return this.n;
  }

  /** Throws a burst of particles from (x, y, z). */
  burst(x: number, y: number, z: number, o: BurstOptions) {
    // Rounded at random, so small bursts still show up now and then at low detail.
    const want = o.count * this.amount;
    const count = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    const life = o.life ?? 0.8;
    const size = o.size ?? 0.35;
    for (let k = 0; k < count; k++) {
      // When full, overwrite a random old particle rather than drop the new burst.
      const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
      let vx: number;
      let vy: number;
      let vz: number;
      if (o.ring) {
        const a = Math.random() * Math.PI * 2;
        vx = Math.cos(a);
        vy = 0.05 + Math.random() * 0.1;
        vz = Math.sin(a);
      } else {
        // A uniform direction on the sphere, pushed upward by `up`.
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        vx = r * Math.cos(a);
        vy = u * (1 - (o.up ?? 0)) + (o.up ?? 0) * (0.6 + Math.random() * 0.6);
        vz = r * Math.sin(a);
      }
      const sp = o.speed * (0.45 + Math.random() * 0.75);
      this.pos.set([x, y, z], i * 3);
      this.vel.set([vx * sp, vy * sp, vz * sp], i * 3);
      this.color.set(o.colors[Math.floor(Math.random() * o.colors.length)]);
      this.tint.set([this.color.r, this.color.g, this.color.b], i * 3);
      this.baseSize[i] = size * (0.6 + Math.random() * 0.8);
      this.maxLife[i] = this.life[i] = life * (1 + Math.random() * 0.6);
      this.gravity[i] = o.gravity ?? 6;
      this.drag[i] = o.drag ?? 1.5;
      this.twinkle[i] = o.twinkle ? 1 : 0;
    }
  }

  /** A line of sparks from (x0, z0) to (x1, z1): the heave smashing through an orc line. */
  streak(x0: number, x1: number, y: number, z: number, colors: string[], density = 3) {
    const len = Math.max(1, Math.abs(x1 - x0));
    const n = Math.round(len * density);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / Math.max(1, n);
      this.burst(x, y, z, { count: 2, colors, speed: 3, life: 0.6, size: 0.5, gravity: -1, up: 0.8, twinkle: true });
    }
  }

  update(dt: number) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      // Compact: keep the live ones packed at the front.
      if (w !== i) {
        this.pos.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.vel.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.tint.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.baseSize[w] = this.baseSize[i];
        this.maxLife[w] = this.maxLife[i];
        this.gravity[w] = this.gravity[i];
        this.drag[w] = this.drag[i];
        this.twinkle[w] = this.twinkle[i];
      }
      this.life[w] = life;
      const d = Math.exp(-this.drag[w] * dt);
      const j = w * 3;
      this.vel[j] *= d;
      this.vel[j + 1] = this.vel[j + 1] * d - this.gravity[w] * dt;
      this.vel[j + 2] *= d;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] = Math.max(0.05, this.pos[j + 1] + this.vel[j + 1] * dt);
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const t = life / this.maxLife[w];
      // Fade out over the last part of life; twinklers flicker.
      let a = Math.min(1, t * 2.2);
      if (this.twinkle[w] && t < 0.6) a *= 0.4 + 0.6 * Math.abs(Math.sin(life * 40 + w));
      this.alpha[w] = a;
      this.size[w] = this.baseSize[w] * (0.5 + 0.5 * t);
      w++;
    }
    this.n = w;
    this.geo.setDrawRange(0, w);
    for (const name of ['position', 'tint', 'size', 'alpha']) {
      const attr = this.geo.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, w * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  clear() {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }
}
