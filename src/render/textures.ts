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

  constructor(
    readonly worldW: number,
    readonly worldH: number,
    private readonly worldMinZ: number,
  ) {
    [this.c, this.ctx] = canvas(512, Math.round((512 * worldH) / worldW));
    this.reset();
    this.texture = texture(this.c);
  }

  reset() {
    const { ctx, c } = this;
    ctx.fillStyle = '#5f8a3a';
    ctx.fillRect(0, 0, c.width, c.height);
    // Grass tufts and patches, from a fixed pattern so every run starts the same.
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(40,70,25,0.18)' : 'rgba(150,180,80,0.14)';
      ctx.beginPath();
      ctx.arc(r() * c.width, r() * c.height, 2 + r() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
    // A worn dirt road down the middle towards the gate.
    ctx.fillStyle = 'rgba(120,95,55,0.35)';
    ctx.beginPath();
    ctx.ellipse(c.width / 2, c.height / 2, c.width * 0.12, c.height * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.texture) this.texture.needsUpdate = true;
  }

  /** Stamps a mark at a world position. */
  stamp(x: number, z: number, radius: number, color: string) {
    const { ctx, c } = this;
    const px = ((x + this.worldW / 2) / this.worldW) * c.width;
    const py = ((z - this.worldMinZ) / this.worldH) * c.height;
    const pr = (radius / this.worldW) * c.width;
    const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    this.texture.needsUpdate = true;
  }
}
