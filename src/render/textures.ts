import * as THREE from 'three';

/**
 * Placeholder art, drawn on canvases at startup so the build has no image
 * files. Swap these for real sprites later without touching the sim.
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

interface OrcStyle {
  skin: string;
  cloth: string;
  weapon: 'axe' | 'rock' | 'club' | 'sword';
  headgear: 'pot' | 'hood' | 'horns' | 'none';
  /** Wider body, smaller head: ogres. */
  bulk?: boolean;
  cape?: boolean;
}

/** Draws a squat cartoon orc into a 128 x 160 box at the current transform. */
function drawOrc(ctx: CanvasRenderingContext2D, o: OrcStyle) {
  ctx.lineJoin = 'round';
  if (o.cape) {
    ctx.beginPath();
    ctx.moveTo(26, 70);
    ctx.lineTo(10, 150);
    ctx.lineTo(118, 150);
    ctx.lineTo(102, 70);
    ctx.closePath();
    outline(ctx, '#8c2f22');
  }
  // Feet
  for (const fx of [44, 84]) {
    ctx.beginPath();
    ctx.ellipse(fx, 148, 14, 8, 0, 0, Math.PI * 2);
    outline(ctx, '#3b2a1a');
  }
  // Body
  ctx.beginPath();
  ctx.ellipse(64, 108, o.bulk ? 52 : 40, o.bulk ? 44 : 38, 0, 0, Math.PI * 2);
  outline(ctx, o.bulk ? o.skin : o.cloth);
  // Belt or loincloth
  ctx.fillStyle = o.bulk ? o.cloth : '#2a2018';
  ctx.fillRect(o.bulk ? 18 : 28, 112, o.bulk ? 92 : 72, o.bulk ? 16 : 9);

  // Weapon
  if (o.weapon === 'axe') {
    ctx.beginPath();
    ctx.moveTo(104, 140);
    ctx.lineTo(116, 60);
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#4a3420';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(112, 58);
    ctx.quadraticCurveTo(136, 70, 120, 92);
    ctx.lineTo(114, 72);
    ctx.closePath();
    outline(ctx, '#b9c0c4');
  } else if (o.weapon === 'rock') {
    ctx.beginPath();
    ctx.moveTo(100, 120);
    ctx.quadraticCurveTo(122, 70, 106, 40);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#3b2a1a';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(106, 38, 9, 0, Math.PI * 2);
    outline(ctx, '#8e8e86');
  } else if (o.weapon === 'club') {
    ctx.beginPath();
    ctx.moveTo(108, 140);
    ctx.lineTo(116, 72);
    ctx.lineTo(126, 30);
    ctx.lineTo(104, 30);
    ctx.lineTo(102, 72);
    ctx.closePath();
    outline(ctx, '#7a5530');
  } else {
    ctx.beginPath();
    ctx.moveTo(104, 130);
    ctx.lineTo(112, 22);
    ctx.lineTo(122, 22);
    ctx.lineTo(116, 130);
    ctx.closePath();
    outline(ctx, '#c7ccd0');
    ctx.fillStyle = '#d9a640';
    ctx.fillRect(98, 124, 26, 8);
  }

  // Head
  const hy = o.bulk ? 66 : 58;
  const hr = o.bulk ? 28 : 36;
  ctx.beginPath();
  ctx.ellipse(64, hy, hr, hr * 0.9, 0, 0, Math.PI * 2);
  outline(ctx, o.skin);
  // Eyes: slightly crossed, for a dim look
  const k = hr / 36;
  for (const [ex, px] of [[50, 54], [78, 74]]) {
    ctx.beginPath();
    ctx.arc(64 + (ex - 64) * k, hy - 2, 9 * k, 0, Math.PI * 2);
    outline(ctx, '#fff7d6');
    ctx.beginPath();
    ctx.arc(64 + (px - 64) * k, hy, 4 * k, 0, Math.PI * 2);
    ctx.fillStyle = '#1d1a14';
    ctx.fill();
  }
  // Mouth and tusks
  ctx.beginPath();
  ctx.moveTo(64 - 18 * k, hy + 18 * k);
  ctx.quadraticCurveTo(64, hy + 28 * k, 64 + 18 * k, hy + 18 * k);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1d1a14';
  ctx.stroke();
  for (const tx of [-14, 14]) {
    ctx.beginPath();
    ctx.moveTo(64 + tx * k - 4, hy + 20 * k);
    ctx.lineTo(64 + tx * k, hy + 8 * k);
    ctx.lineTo(64 + tx * k + 4, hy + 20 * k);
    outline(ctx, '#fff7d6');
  }

  // Headgear
  ctx.beginPath();
  if (o.headgear === 'pot') {
    ctx.moveTo(26, 46);
    ctx.quadraticCurveTo(64, 0, 102, 46);
    ctx.closePath();
    outline(ctx, '#8b9297');
    ctx.beginPath();
    ctx.arc(64, 20, 6, 0, Math.PI * 2);
    outline(ctx, '#8b9297');
  } else if (o.headgear === 'hood') {
    ctx.moveTo(24, 62);
    ctx.quadraticCurveTo(30, 14, 64, 16);
    ctx.quadraticCurveTo(98, 14, 104, 62);
    ctx.quadraticCurveTo(64, 34, 24, 62);
    outline(ctx, '#6b4a2e');
  } else if (o.headgear === 'horns') {
    ctx.moveTo(26, 46);
    ctx.quadraticCurveTo(64, 4, 102, 46);
    ctx.closePath();
    outline(ctx, '#3d3a36');
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(64 + side * 30, 36);
      ctx.quadraticCurveTo(64 + side * 62, 24, 64 + side * 52, -2);
      ctx.quadraticCurveTo(64 + side * 46, 20, 64 + side * 20, 26);
      ctx.closePath();
      outline(ctx, '#efe2c2');
    }
  }
}

const ORC_STYLES: Record<'grunt' | 'chucker' | 'ogre' | 'warlord', OrcStyle> = {
  grunt: { skin: '#6f9a3c', cloth: '#7a5a34', weapon: 'axe', headgear: 'pot' },
  chucker: { skin: '#8a9a42', cloth: '#5b4630', weapon: 'rock', headgear: 'hood' },
  ogre: { skin: '#8d9a6a', cloth: '#7a3a26', weapon: 'club', headgear: 'none', bulk: true },
  warlord: { skin: '#5d8a34', cloth: '#7a2e22', weapon: 'sword', headgear: 'horns', cape: true },
};

/** Sprite textures and their aspect (width / height). */
export interface SpriteArt {
  texture: THREE.CanvasTexture;
  aspect: number;
}

/** A squat cartoon orc of one of the walking kinds. */
export function orcTexture(kind: keyof typeof ORC_STYLES): SpriteArt {
  const [c, ctx] = canvas(128, 160);
  drawOrc(ctx, ORC_STYLES[kind]);
  return { texture: texture(c), aspect: 128 / 160 };
}

/** An orc on a war boar. */
export function riderTexture(): SpriteArt {
  const [c, ctx] = canvas(192, 192);
  ctx.lineJoin = 'round';
  // Boar legs and body, seen from the front-ish.
  for (const lx of [56, 82, 110, 136]) {
    ctx.beginPath();
    ctx.roundRect(lx - 8, 140, 16, 44, 6);
    outline(ctx, '#4a3324');
  }
  ctx.beginPath();
  ctx.ellipse(96, 138, 70, 38, 0, 0, Math.PI * 2);
  outline(ctx, '#6d4a32');
  // Snout and tusks at the front (bottom of the screen)
  ctx.beginPath();
  ctx.ellipse(96, 160, 26, 18, 0, 0, Math.PI * 2);
  outline(ctx, '#8a5e42');
  for (const tx of [76, 116]) {
    ctx.beginPath();
    ctx.moveTo(tx, 160);
    ctx.quadraticCurveTo(tx + (tx < 96 ? -14 : 14), 150, tx + (tx < 96 ? -10 : 10), 134);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fff7d6';
    ctx.stroke();
  }
  for (const ex of [82, 110]) {
    ctx.beginPath();
    ctx.arc(ex, 140, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#d23a1e';
    ctx.fill();
  }
  // Rider on top
  ctx.save();
  ctx.translate(48, 4);
  ctx.scale(0.75, 0.75);
  drawOrc(ctx, { skin: '#6f9a3c', cloth: '#8c3a26', weapon: 'axe', headgear: 'pot' });
  ctx.restore();
  return { texture: texture(c), aspect: 1 };
}

/** A rickety orc siege catapult. */
export function siegeTexture(): SpriteArt {
  const [c, ctx] = canvas(192, 192);
  ctx.lineJoin = 'round';
  // Arm with a loaded bucket, leaning back.
  ctx.beginPath();
  ctx.moveTo(90, 120);
  ctx.lineTo(70, 30);
  ctx.lineTo(84, 26);
  ctx.lineTo(104, 118);
  ctx.closePath();
  outline(ctx, '#7a5530');
  ctx.beginPath();
  ctx.arc(74, 26, 18, 0, Math.PI * 2);
  outline(ctx, '#5a3e24');
  ctx.beginPath();
  ctx.arc(74, 20, 12, 0, Math.PI * 2);
  outline(ctx, '#8e8e86');
  // Frame
  ctx.beginPath();
  ctx.roundRect(30, 116, 132, 28, 6);
  outline(ctx, '#6b4a2b');
  ctx.beginPath();
  ctx.moveTo(60, 120);
  ctx.lineTo(96, 76);
  ctx.lineTo(132, 120);
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#1d1a14';
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#6b4a2b';
  ctx.stroke();
  // Wheels
  for (const wx of [46, 146]) {
    ctx.beginPath();
    ctx.arc(wx, 156, 24, 0, Math.PI * 2);
    outline(ctx, '#5a3e24');
    ctx.beginPath();
    ctx.arc(wx, 156, 6, 0, Math.PI * 2);
    outline(ctx, '#8b9297');
  }
  // Crude red war banner
  ctx.beginPath();
  ctx.moveTo(150, 116);
  ctx.lineTo(150, 40);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#3b2a1a';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(150, 42);
  ctx.lineTo(184, 52);
  ctx.lineTo(150, 66);
  ctx.closePath();
  outline(ctx, '#a8321e');
  return { texture: texture(c), aspect: 1 };
}

/** A castle soldier seen from behind: royal blue tabard, gold trim, spear up. */
export function soldierTexture(): SpriteArt {
  const [c, ctx] = canvas(128, 160);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(98, 150);
  ctx.lineTo(106, 6);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#5a3e24';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(100, 14);
  ctx.lineTo(106, -2);
  ctx.lineTo(112, 14);
  ctx.closePath();
  outline(ctx, '#c7ccd0');
  for (const fx of [48, 80]) {
    ctx.beginPath();
    ctx.ellipse(fx, 150, 12, 7, 0, 0, Math.PI * 2);
    outline(ctx, '#3b2a1a');
  }
  ctx.beginPath();
  ctx.roundRect(30, 72, 68, 76, 18);
  outline(ctx, '#2f56b0');
  ctx.fillStyle = '#e0b84a';
  ctx.fillRect(58, 76, 12, 70);
  // Round shield slung on the back
  ctx.beginPath();
  ctx.arc(60, 108, 26, 0, Math.PI * 2);
  outline(ctx, '#2a4a98');
  ctx.beginPath();
  ctx.arc(60, 108, 9, 0, Math.PI * 2);
  outline(ctx, '#e0b84a');
  // Helmet from behind
  ctx.beginPath();
  ctx.arc(64, 54, 26, 0, Math.PI * 2);
  outline(ctx, '#b9c0c4');
  ctx.beginPath();
  ctx.moveTo(64, 26);
  ctx.lineTo(64, 82);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#e0b84a';
  ctx.stroke();
  return { texture: texture(c), aspect: 128 / 160 };
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
