import * as THREE from 'three';

/**
 * Art helpers. Units use the finished sprite images; the hand, shadows and
 * ground are still drawn on canvases at startup.
 */

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Every sprite texture, so the renderer can raise their anisotropy to what the GPU allows. */
const sharp: THREE.Texture[] = [];
let anisotropy = 4;

/** Sets texture filtering quality for every sprite, now and later (the GPU's max keeps art sharp at a slant). */
export function setAnisotropy(n: number) {
  anisotropy = n;
  for (const t of sharp) {
    t.anisotropy = n;
    t.needsUpdate = true;
  }
}

function sharpen<T extends THREE.Texture>(t: T): T {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  sharp.push(t);
  return t;
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  return sharpen(new THREE.CanvasTexture(c));
}

function outline(ctx: CanvasRenderingContext2D, fill: string) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1d1a14';
  ctx.stroke();
}

/** Sprite textures and their aspect (width / height). */
export interface SpriteArt {
  texture: THREE.Texture;
  aspect: number;
}

const loader = new THREE.TextureLoader();

/** A finished sprite image, cropped to the unit (see tools/import-sprites.py). */
export function imageSprite(url: string, aspect: number): SpriteArt {
  const t = loader.load(url, () => {
    const img = t.image as HTMLImageElement;
    if (img.width * img.height > 1024 * 1024) return;
    t.image = cleanEdges(img);
    t.needsUpdate = true;
  });
  return { texture: sharpen(t), aspect };
}

/**
 * Tidies a cut-out sprite's edges so it reads cleanly at a distance:
 * - nearly opaque pixels become fully opaque (alpha-to-coverage would otherwise
 *   let the ground show through the body), with a soft one-pixel edge kept;
 * - the edge colour is bled out into the clear pixels round it, so the mipmaps
 *   that draw far-off sprites blend into the outline's colour, not a halo.
 */
function cleanEdges(img: HTMLImageElement): HTMLCanvasElement {
  const [c, ctx] = canvas(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const w = c.width;
  const h = c.height;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] / 255;
    const clean = Math.max(0, Math.min(1, (a - 0.35) / 0.3));
    px[i * 4 + 3] = Math.round(clean * 255);
    solid[i] = clean > 0.5 ? 1 : 0;
  }
  // A few passes of dilation: each clear pixel takes the average colour of its solid neighbours.
  for (let pass = 0; pass < 4; pass++) {
    const grown: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!solid[j]) continue;
          r += px[j * 4];
          g += px[j * 4 + 1];
          b += px[j * 4 + 2];
          n++;
        }
        if (!n) continue;
        px[i * 4] = r / n;
        px[i * 4 + 1] = g / n;
        px[i * 4 + 2] = b / n;
        grown.push(i);
      }
    }
    for (const i of grown) solid[i] = 1;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

/**
 * Placeholder for the royal shield until its painted art arrives: a broad steel
 * shield with a rivetted rim, the royal blue field and a gold tower crest.
 */
export function metalShieldTexture(): SpriteArt {
  const w = 1024;
  const h = 440;
  const [c, ctx] = canvas(w, h);
  ctx.lineJoin = 'round';
  // A wide shield: flat top with rounded shoulders, sides curving to a blunt point.
  const shape = (inset: number) => {
    const l = 20 + inset;
    const r = w - 20 - inset;
    const t = 20 + inset;
    const b = h - 16 - inset;
    ctx.beginPath();
    ctx.moveTo(l + 40, t);
    ctx.lineTo(r - 40, t);
    ctx.quadraticCurveTo(r, t, r, t + 40);
    ctx.lineTo(r, t + (b - t) * 0.45);
    ctx.quadraticCurveTo(r - 30, b - 40, w / 2, b);
    ctx.quadraticCurveTo(l + 30, b - 40, l, t + (b - t) * 0.45);
    ctx.lineTo(l, t + 40);
    ctx.quadraticCurveTo(l, t, l + 40, t);
    ctx.closePath();
  };
  // Steel rim.
  shape(0);
  const steel = ctx.createLinearGradient(0, 0, w * 0.3, h);
  steel.addColorStop(0, '#e9eef2');
  steel.addColorStop(0.5, '#a9b3bc');
  steel.addColorStop(1, '#6d7780');
  ctx.fillStyle = steel;
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#2a2018';
  ctx.stroke();
  // Royal blue field, lit from the top left.
  shape(34);
  const blue = ctx.createLinearGradient(0, 0, w * 0.4, h);
  blue.addColorStop(0, '#3d68d0');
  blue.addColorStop(1, '#1f3c8f');
  ctx.fillStyle = blue;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#e8b730';
  ctx.stroke();
  // Rivets round the rim.
  for (let i = 0; i < 18; i++) {
    const x = 70 + (i / 17) * (w - 140);
    for (const y of [36]) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      outline(ctx, '#dfe5ea');
    }
  }
  // Gold tower crest with a crossbow bolt across it.
  ctx.save();
  ctx.translate(w / 2, h * 0.47);
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#2a2018';
  ctx.beginPath();
  ctx.moveTo(-170, 70);
  ctx.lineTo(170, -70);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(170, -70);
  ctx.lineTo(140, -48);
  ctx.lineTo(150, -78);
  ctx.closePath();
  outline(ctx, '#e8b730');
  ctx.beginPath();
  ctx.moveTo(-60, 90);
  ctx.lineTo(-60, -40);
  for (let i = 0; i < 5; i++) {
    const x = -60 + i * 30;
    ctx.lineTo(x, -80);
    ctx.lineTo(x + 15, -80);
    ctx.lineTo(x + 15, -55);
    ctx.lineTo(x + 30, -55);
  }
  ctx.lineTo(90, -80);
  ctx.lineTo(90, -40);
  ctx.lineTo(60, -40);
  ctx.lineTo(60, 90);
  ctx.closePath();
  const gold = ctx.createLinearGradient(-60, -80, 60, 90);
  gold.addColorStop(0, '#ffe07a');
  gold.addColorStop(1, '#c9921c');
  outline(ctx, '#e8b730');
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-16, 40, 32, 50, [16, 16, 0, 0]);
  outline(ctx, '#2a2018');
  ctx.restore();
  // A bright glint on the steel.
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(170, 70, 90, 16, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  return { texture: texture(c), aspect: w / h };
}

/** Soft dark disc used for blob shadows and scorch marks. */
export function blobTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return texture(c);
}

/** A lumpy white puff of smoke, tinted per sprite: a few soft blobs overlapping. */
export function puffTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(96, 96);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 7; i++) {
    const x = 48 + (rnd() - 0.5) * 34;
    const y = 48 + (rnd() - 0.5) * 34;
    const r = 18 + rnd() * 16;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
  }
  return texture(c);
}

/** A soft round glow, white in the middle, for additive halos round balls and capsules. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return texture(c);
}

/**
 * A falling capsule: a glossy pill in its colour with an emoji on it. Placeholder
 * until the capsule art (fx/capsule-<kind>.webp) arrives.
 */
export function capsuleTexture(color: string, emoji: string): THREE.CanvasTexture {
  const w = 192;
  const h = 96;
  const [c, ctx] = canvas(w, h);
  const r = h / 2 - 6;
  ctx.beginPath();
  ctx.moveTo(6 + r, 6);
  ctx.lineTo(w - 6 - r, 6);
  ctx.arc(w - 6 - r, h / 2, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(6 + r, h - 6);
  ctx.arc(6 + r, h / 2, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 6, 0, h - 6);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, color);
  g.addColorStop(1, '#1d1a14');
  outline(ctx, color);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = g;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = '58px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, w / 2, h / 2 + 3);
  return texture(c);
}

/**
 * The battlefield floor's colour. It is a live canvas, so slaps, deaths and
 * craters can stamp marks into it and the field looks worn as the run goes on.
 * Uploads to the GPU are throttled, since a big canvas is costly to send.
 */
export class GroundCanvas {
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private c: HTMLCanvasElement;
  /** The freshly painted ground, kept to wipe the marks off again. */
  private base: HTMLCanvasElement;
  private dirty = false;
  private lastUpload = 0;
  private rnd = 1;

  /** width is the canvas resolution across the ground; height follows the world's shape. paint draws the clean ground once. */
  constructor(
    readonly worldW: number,
    readonly worldH: number,
    private readonly worldMinZ: number,
    paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    width: number,
  ) {
    [this.c, this.ctx] = canvas(width, Math.round((width * worldH) / worldW));
    this.texture = texture(this.c);
    this.texture.anisotropy = 8;
    const [b, bctx] = canvas(this.c.width, this.c.height);
    paint(bctx, b.width, b.height);
    this.base = b;
    this.reset();
  }

  reset() {
    this.ctx.drawImage(this.base, 0, 0);
    this.rnd = 1;
    this.texture.needsUpdate = true;
  }

  /** Sends pending marks to the GPU, at most every `every` seconds. Call once a frame. */
  flush(time: number, every: number) {
    if (!this.dirty || time - this.lastUpload < every) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
    this.lastUpload = time;
  }

  private random() {
    this.rnd = (this.rnd * 16807) % 2147483647;
    return this.rnd / 2147483647;
  }

  /** Tramples the field a little more: dirt patches where the orcs march (call once per wave). */
  wear(fieldHalfWidth: number, fieldMinZ: number, fieldMaxZ: number) {
    for (let i = 0; i < 40; i++) {
      const x = (this.random() * 2 - 1) * fieldHalfWidth * 0.9;
      const z = fieldMinZ + this.random() * (fieldMaxZ - fieldMinZ);
      this.stamp(x, z, 1.5 + this.random() * 3.5, `rgba(${110 + this.random() * 30 | 0},${80 + this.random() * 20 | 0},45,0.12)`);
    }
  }

  private toCanvas(x: number, z: number, radius: number) {
    const { c } = this;
    return {
      px: ((x + this.worldW / 2) / this.worldW) * c.width,
      py: ((z - this.worldMinZ) / this.worldH) * c.height,
      pr: (radius / this.worldW) * c.width,
    };
  }

  /** Stamps a soft mark at a world position. */
  stamp(x: number, z: number, radius: number, color: string) {
    const { ctx } = this;
    const { px, py, pr } = this.toCanvas(x, z, radius);
    const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    this.dirty = true;
  }

  /** Stamps a decal image (a crater or scorch mark) centred at a world position. */
  decal(x: number, z: number, radius: number, img: HTMLImageElement, alpha = 1) {
    if (!img.complete || !img.naturalWidth) return;
    const { ctx } = this;
    const { px, py, pr } = this.toCanvas(x, z, radius);
    const h = (pr * 2 * img.naturalHeight) / img.naturalWidth;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, px - pr, py - h / 2, pr * 2, h);
    ctx.globalAlpha = 1;
    this.dirty = true;
  }
}

/**
 * A tiling grass-and-grit texture multiplied over the map, so the ground stays
 * crisp up close even where the painted map is stretched.
 */
export function detailTexture(): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const v = 100 + rnd() * 56;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    // Short blades and specks; drawn three times so the tile wraps without seams.
    for (const [ox, oy] of [[0, 0], [-size, 0], [0, -size]]) {
      if (rnd() < 0.5) ctx.fillRect(x + ox, y + oy, 1, 2 + rnd() * 3);
      else ctx.fillRect(x + ox, y + oy, 2, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Loads an image for canvas drawing (decals). */
export function loadImage(url: string): HTMLImageElement {
  const img = new Image();
  img.src = url;
  return img;
}
