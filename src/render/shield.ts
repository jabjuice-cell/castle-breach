import * as THREE from 'three';
import { canvas } from './textures';

/**
 * The royal shield as a real object: a giant steel-rimmed heater shield standing in front
 * of the wall, its painted face turned to the orcs. From the castle we see its back: riveted
 * steel plates, iron braces, the leather straps the shield-bearers hold it by,
 * a riveted patch over an old dent, chalk tallies of orcs knocked flat and the Queen's
 * blue-and-gold favour tied to a strap.
 *
 * Built one unit wide (x from -0.5 to 0.5), standing on y = 0, its back toward +z.
 */

/** Height for a width of one. */
export const SHIELD_SHAPE_H = 0.62;
const DEPTH = 0.05;
/** How far the middle bows out toward the orcs (a slight curve, like a real heater shield). */
const BOW = 0.06;

/** The outline, drawn by any pen with these moves (a THREE.Shape or a canvas path). */
interface Pen {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
}

function outline(p: Pen, inset = 0): void {
  const H = SHIELD_SHAPE_H;
  const w = 0.5 - inset;
  const top = H - inset;
  const corner = 0.06;
  p.moveTo(-w, top - corner);
  p.quadraticCurveTo(-w, top - 0.01, -w + corner, top - 0.01);
  // A gently arched top edge.
  p.quadraticCurveTo(0, top + 0.02, w - corner, top - 0.01);
  p.quadraticCurveTo(w, top - 0.01, w, top - corner);
  p.lineTo(w, H * 0.5);
  // Down the sides into a rounded point.
  p.bezierCurveTo(w, H * 0.22 + inset * 0.3, 0.2, 0.04 + inset, 0, inset * 1.4);
  p.bezierCurveTo(-0.2, 0.04 + inset, -w, H * 0.22 + inset * 0.3, -w, H * 0.5);
  p.lineTo(-w, top - corner);
}

/** The back of the shield, painted on a canvas: u runs across, v up, as the shape's own (x + 0.5, y / H). */
function backTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = Math.round(W * SHIELD_SHAPE_H);
  const [c, ctx] = canvas(W, H);
  let s = 811;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // Shape units to canvas pixels (canvas y runs down).
  const X = (x: number) => (x + 0.5) * W;
  const Y = (y: number) => H - (y / SHIELD_SHAPE_H) * H;
  const pen: Pen = {
    moveTo: (x, y) => ctx.moveTo(X(x), Y(y)),
    lineTo: (x, y) => ctx.lineTo(X(x), Y(y)),
    quadraticCurveTo: (cx, cy, x, y) => ctx.quadraticCurveTo(X(cx), Y(cy), X(x), Y(y)),
    bezierCurveTo: (a, b, cc, d, x, y) => ctx.bezierCurveTo(X(a), Y(b), X(cc), Y(d), X(x), Y(y)),
  };
  const path = (inset: number) => {
    ctx.beginPath();
    outline(pen, inset);
    ctx.closePath();
  };

  // The steel shell, hammered: a cool gradient with dents.
  const steel = ctx.createLinearGradient(0, 0, W, H);
  steel.addColorStop(0, '#9aa1a8');
  steel.addColorStop(0.5, '#7d848c');
  steel.addColorStop(1, '#6a7078');
  ctx.fillStyle = steel;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.ellipse(rnd() * W, rnd() * H, 6 + rnd() * 14, 4 + rnd() * 10, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Inside the rim: steel plates riveted edge to edge, each beaten to its own shade, with an old scorch.
  ctx.save();
  path(0.045);
  ctx.clip();
  const plates = 5;
  for (let i = 0; i < plates; i++) {
    const x0 = (i / plates) * W;
    const pw = W / plates;
    const g = ctx.createLinearGradient(x0, 0, x0 + pw, H);
    const tone = ['#7c848d', '#6f7780', '#858d96', '#747c85', '#7a8189'][i];
    g.addColorStop(0, tone);
    g.addColorStop(1, '#5a6068');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, pw, H);
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
      ctx.beginPath();
      ctx.ellipse(x0 + rnd() * pw, rnd() * H, 5 + rnd() * 12, 3 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // The seam and its rivets.
    ctx.fillStyle = 'rgba(30,32,36,0.8)';
    ctx.fillRect(x0 + pw - 3, 0, 3, H);
    for (let y = 18; y < H; y += 46) {
      ctx.fillStyle = '#9aa2aa';
      ctx.beginPath();
      ctx.arc(x0 + pw - 10, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const scorch = ctx.createRadialGradient(W * 0.78, H * 0.7, 4, W * 0.78, H * 0.7, 70);
  scorch.addColorStop(0, 'rgba(30,22,16,0.55)');
  scorch.addColorStop(1, 'rgba(30,22,16,0)');
  ctx.fillStyle = scorch;
  ctx.fillRect(0, 0, W, H);

  // Iron braces across the back, riveted.
  const brace = (y: number, h: number) => {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#5a5e64');
    g.addColorStop(0.5, '#3c3f44');
    g.addColorStop(1, '#2a2c30');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, h);
    for (let x = 30; x < W; x += 74) {
      ctx.fillStyle = '#7d838a';
      ctx.beginPath();
      ctx.arc(x, y + h / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(x - 2, y + h / 2 - 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  brace(H * 0.2, H * 0.06);
  brace(H * 0.62, H * 0.06);

  // A riveted patch over an old dent, low on the left.
  ctx.fillStyle = '#8c939a';
  ctx.fillRect(W * 0.18, H * 0.74, W * 0.12, H * 0.1);
  ctx.strokeStyle = '#4a4e54';
  ctx.lineWidth = 3;
  ctx.strokeRect(W * 0.18, H * 0.74, W * 0.12, H * 0.1);
  for (const [px, py] of [[0.19, 0.755], [0.29, 0.755], [0.19, 0.825], [0.29, 0.825]]) {
    ctx.fillStyle = '#5a5e64';
    ctx.beginPath();
    ctx.arc(W * px, H * py, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Chalk tallies: orcs knocked flat, in fives, up on the right.
  ctx.strokeStyle = 'rgba(240,236,220,0.85)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let grp = 0; grp < 4; grp++) {
    const gx = W * 0.66 + grp * 52;
    const gy = H * 0.09;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(gx + k * 9, gy);
      ctx.lineTo(gx + k * 9 + 2, gy + 40);
      ctx.stroke();
    }
    if (grp < 3) {
      ctx.beginPath();
      ctx.moveTo(gx - 6, gy + 32);
      ctx.lineTo(gx + 36, gy + 6);
      ctx.stroke();
    }
  }

  // The leather straps the bearers hold it by, with stitching and brass buckles.
  const strap = (x: number) => {
    ctx.fillStyle = '#5a3418';
    ctx.fillRect(x - 26, H * 0.12, 52, H * 0.66);
    ctx.fillStyle = '#6e4220';
    ctx.fillRect(x - 26, H * 0.12, 8, H * 0.66);
    ctx.strokeStyle = 'rgba(230,200,150,0.7)';
    ctx.setLineDash([8, 7]);
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 20, H * 0.13, 40, H * 0.64);
    ctx.setLineDash([]);
    ctx.fillStyle = '#d4a23a';
    ctx.fillRect(x - 30, H * 0.42, 60, 30);
    ctx.fillStyle = '#5a3418';
    ctx.fillRect(x - 20, H * 0.42 + 7, 40, 16);
    ctx.fillStyle = '#f0d27a';
    ctx.fillRect(x - 30, H * 0.42, 60, 5);
  };
  strap(W * 0.36);
  strap(W * 0.64);
  // The padded hand grip between them.
  const grip = ctx.createLinearGradient(0, H * 0.48, 0, H * 0.56);
  grip.addColorStop(0, '#8a5a30');
  grip.addColorStop(0.5, '#6a4020');
  grip.addColorStop(1, '#3e2410');
  ctx.fillStyle = grip;
  ctx.fillRect(W * 0.36, H * 0.48, W * 0.28, H * 0.08);
  for (let x = W * 0.37; x < W * 0.63; x += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, H * 0.48, 3, H * 0.08);
  }

  // The Queen's favour: a blue-and-gold ribbon knotted round the left strap, its tails hanging.
  ctx.fillStyle = '#2a4fb0';
  ctx.beginPath();
  ctx.moveTo(W * 0.33, H * 0.3);
  ctx.lineTo(W * 0.39, H * 0.3);
  ctx.lineTo(W * 0.42, H * 0.44);
  ctx.lineTo(W * 0.4, H * 0.45);
  ctx.lineTo(W * 0.37, H * 0.34);
  ctx.lineTo(W * 0.33, H * 0.47);
  ctx.lineTo(W * 0.31, H * 0.46);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8b730';
  ctx.beginPath();
  ctx.ellipse(W * 0.36, H * 0.3, 22, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a4fb0';
  ctx.beginPath();
  ctx.ellipse(W * 0.36, H * 0.3, 9, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The steel rim, bright on its edge, with rivets all the way round.
  ctx.save();
  path(0);
  ctx.lineWidth = W * 0.07;
  ctx.strokeStyle = '#a9b0b7';
  ctx.stroke();
  ctx.lineWidth = W * 0.012;
  ctx.strokeStyle = '#d8dee4';
  path(0.03);
  ctx.stroke();
  ctx.restore();
  const pts = new THREE.Shape();
  outline(pts, 0.022);
  for (const p of pts.getSpacedPoints(46)) {
    ctx.fillStyle = '#4e5358';
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e6ebf0';
    ctx.beginPath();
    ctx.arc(X(p.x) - 2, Y(p.y) - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class ShieldModel {
  readonly group = new THREE.Group();
  private back: THREE.MeshLambertMaterial;
  private rim: THREE.MeshPhongMaterial;
  private face: THREE.MeshLambertMaterial;

  /** front: the painted royal shield art, turned to the orcs. */
  constructor(front: THREE.Texture) {
    const shape = new THREE.Shape();
    outline(shape);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 18 });
    // Caps (group 0) come as the front lid (z = 0) then the back lid: split them so each gets its own picture.
    const caps = geo.groups[0];
    geo.clearGroups();
    geo.addGroup(caps.start, caps.count / 2, 0);
    geo.addGroup(caps.start + caps.count / 2, caps.count / 2, 2);
    geo.addGroup(caps.start + caps.count, Infinity, 1);
    // The cap UVs are the shape's own coordinates: map them to 0..1 over the shield.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      uv.setXY(i, x + 0.5, y / SHIELD_SHAPE_H);
      // Bow the middle toward the orcs.
      pos.setZ(i, pos.getZ(i) - BOW * (1 - (2 * x) ** 2));
    }
    geo.computeVertexNormals();
    front.colorSpace = THREE.SRGBColorSpace;
    this.face = new THREE.MeshLambertMaterial({ map: front });
    this.back = new THREE.MeshLambertMaterial({ map: backTexture() });
    this.rim = new THREE.MeshPhongMaterial({ color: '#c3c9cf', specular: '#ffffff', shininess: 60 });
    const mesh = new THREE.Mesh(geo, [this.face, this.rim, this.back]);
    this.group.add(mesh);
  }

  /** A hit glint (0 to 1) and how bright it is (1 normally, dimmer while it recovers from a heave). */
  shade(glint: number, light: number): void {
    for (const m of [this.back, this.rim, this.face]) {
      m.emissive.setRGB(glint * 0.7, glint * 0.65, glint * 0.45);
      m.color.setScalar(m === this.rim ? light * 0.85 : light);
    }
  }
}
