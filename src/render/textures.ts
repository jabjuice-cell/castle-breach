import * as THREE from 'three';

/**
 * Art helpers. Units use the finished sprite images; the hand, shadows and
 * ground are still drawn on canvases at startup.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { texture: t, aspect };
}

/** The giant open hand that comes down for a slap. */
export function handTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.lineJoin = 'round';
  ctx.translate(128, 140);
  const fingers: [number, number, number][] = [[-62, -40, -0.5], [-30, -88, -0.15], [4, -96, 0], [38, -86, 0.15], [66, -58, 0.4]];
  for (const [x, y, a] of fingers) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.roundRect(-15, -40, 30, 80, 15);
    outline(ctx, '#f0c39a');
    ctx.restore();
  }
  ctx.beginPath();
  ctx.ellipse(0, 10, 78, 70, 0, 0, Math.PI * 2);
  outline(ctx, '#f0c39a');
  return texture(c);
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

/**
 * The battlefield floor. It is a live canvas, so slaps and deaths can stamp
 * marks into it and the field looks worn as the run goes on.
 */
export class GroundCanvas {
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private c: HTMLCanvasElement;
  private base = new Image();
  private worn = new Image();

  /** The base map is painted over the whole field; the worn map is blended in as the run goes on. */
  constructor(
    readonly worldW: number,
    readonly worldH: number,
    private readonly worldMinZ: number,
    baseUrl: string,
    wornUrl: string,
  ) {
    [this.c, this.ctx] = canvas(1024, Math.round((1024 * worldH) / worldW));
    this.texture = texture(this.c);
    this.base.onload = () => this.reset();
    this.base.src = baseUrl;
    this.worn.src = wornUrl;
    this.reset();
  }

  reset() {
    const { ctx, c } = this;
    ctx.fillStyle = '#7fb046';
    ctx.fillRect(0, 0, c.width, c.height);
    if (this.base.complete && this.base.naturalWidth) ctx.drawImage(this.base, 0, 0, c.width, c.height);
    this.texture.needsUpdate = true;
  }

  /** Blends a little more of the trampled, cratered map in (call once per wave). */
  wear(amount: number) {
    if (!this.worn.complete || !this.worn.naturalWidth) return;
    this.ctx.globalAlpha = amount;
    this.ctx.drawImage(this.worn, 0, 0, this.c.width, this.c.height);
    this.ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
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
    this.texture.needsUpdate = true;
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
    this.texture.needsUpdate = true;
  }
}

/** Loads an image for canvas drawing (decals). */
export function loadImage(url: string): HTMLImageElement {
  const img = new Image();
  img.src = url;
  return img;
}
