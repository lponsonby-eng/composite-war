// =============================================================================
//  BATTLEFIELD TERRAIN: forests, rivers, swamps and town walls.
//  The field is a grid of 8x8 cells. Every cell has a ground kind, which sets
//  how fast units move through it and how much cover it gives from arrows and
//  spells. The layout comes from the town's `terrain` and `walls` in data.js,
//  seeded by the town's name so the same town always looks the same.
// =============================================================================
const GROUND = { grass: 0, forest: 1, water: 2, ford: 3, mud: 4, wall: 5 };

class Terrain {
  constructor(spotId, W, H) {
    const s = DATA.spots[spotId] || {};
    this.W = W; this.H = H; this.C = 8;
    this.cols = Math.ceil(W / this.C); this.rows = Math.ceil(H / this.C);
    this.kind = new Uint8Array(this.cols * this.rows);
    this.cover = new Float32Array(this.cols * this.rows);
    this.type = s.terrain || 'plains';
    this.walls = !!s.walls;
    let seed = 7; for (const ch of spotId || 'x') seed = seed * 31 + ch.charCodeAt(0);
    this.rng = makeRng(seed);
    this.generate();
  }

  // ---------------------------------------------------------------- lookups
  idx(x, y) {
    const cx = Math.floor(x / this.C), cy = Math.floor(y / this.C);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }
  kindAt(x, y) { const i = this.idx(x, y); return i < 0 ? 0 : this.kind[i]; }
  footingAt(x, y) { const f = DATA.ground[GROUND_NAMES[this.kindAt(x, y)]].footing; return f == null ? 1 : f; }
  speedAt(x, y) { return DATA.ground[GROUND_NAMES[this.kindAt(x, y)]].speed; }
  coverAt(x, y) {
    const i = this.idx(x, y); if (i < 0) return 0;
    return Math.max(this.cover[i], DATA.ground[GROUND_NAMES[this.kind[i]]].cover || 0);
  }
  // Where a unit at (x, y) should head to get past the wall towards (tx, ty), or null.
  gateWaypoint(x, y, tx, ty) {
    if (!this.walls) return null;
    const wx = this.wallX + 4;
    if ((x < wx) === (tx < wx)) return null;                  // same side: no need
    const g = this.gates.reduce((a, b) => Math.abs(b - y) + Math.abs(b - ty) < Math.abs(a - y) + Math.abs(a - ty) ? b : a);
    if (Math.abs(y - g) > 4 || Math.abs(x - wx) > 14) return [wx + (x < wx ? -10 : 10), g];   // line up with the gate
    return [wx + (x < wx ? 16 : -16), g];                                                     // walk through it
  }

  // Short description for the HUD and the attack dialog.
  describe() {
    const name = { plains: 'Open plains', forest: 'Forest', river: 'River', swamp: 'Swamp' }[this.type] || this.type;
    return this.walls ? `${name}, walled town` : name;
  }

  // ---------------------------------------------------------------- generation
  setCircle(cx, cy, r, k, only = [GROUND.grass]) {
    const rng = this.rng;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const px = x * this.C + 4, py = y * this.C + 4;
      const d = Math.hypot(px - cx, (py - cy) * 1.15);
      if (d < r * (0.8 + rng() * 0.35) && only.includes(this.kind[y * this.cols + x])) this.kind[y * this.cols + x] = k;
    }
  }

  clumps(n, k, rMin, rMax) {
    const rng = this.rng;
    for (let i = 0; i < n; i++)
      this.setCircle(110 + rng() * 260, 50 + rng() * 190, rMin + rng() * (rMax - rMin), k);
  }

  generate() {
    const rng = this.rng, C = this.C;
    if (this.type === 'river') {
      // A winding river down the middle, with two shallow fords.
      const x0 = 215 + rng() * 50, phase = rng() * 6, amp = 10 + rng() * 14;
      const fords = [60 + rng() * 50, 160 + rng() * 60];
      for (let y = 0; y < this.rows; y++) {
        const py = y * C + 4, cx = x0 + Math.sin(py / 38 + phase) * amp;
        const ford = fords.some(f => Math.abs(py - f) < 13);
        for (let x = 0; x < this.cols; x++) {
          const px = x * C + 4;
          if (Math.abs(px - cx) < 13) this.kind[y * this.cols + x] = ford ? GROUND.ford : GROUND.water;
        }
      }
      this.clumps(2, GROUND.forest, 14, 22);
    } else if (this.type === 'forest') {
      this.clumps(6, GROUND.forest, 18, 32);
    } else if (this.type === 'swamp') {
      this.clumps(7, GROUND.mud, 16, 30);
      this.clumps(2, GROUND.forest, 12, 20);
    } else {
      this.clumps(2, GROUND.forest, 12, 20);
    }

    if (this.walls) {
      // A stone wall in front of the defenders, with one open gate.
      this.wallX = this.W - 112;
      const wx = Math.floor(this.wallX / C);
      const gates = [128 + Math.floor(rng() * 4) * 8];                   // one gate: attackers must squeeze through
      this.gates = gates;
      for (let y = 0; y < this.rows; y++) {
        const py = y * C + 4;
        const i = y * this.cols + wx;
        if (py < 30 || py > 262) continue;
        if (gates.some(g => Math.abs(py - g) < 10)) { this.kind[i] = GROUND.grass; continue; }
        this.kind[i] = GROUND.wall;
        for (let k = 1; k <= 5; k++) this.cover[i + k] = DATA.ground.wall.behindCover;  // shelter behind the wall
      }
      // keep the ground right behind the wall clear so defenders can stand there
      for (let y = 0; y < this.rows; y++) for (let x = wx + 1; x < this.cols; x++)
        if (this.kind[y * this.cols + x] !== GROUND.grass && x < wx + 6) this.kind[y * this.cols + x] = GROUND.grass;
    }
    // never block the starting areas
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++)
      if ((x * C < 96 || x * C > this.W - 96) && this.kind[y * this.cols + x] === GROUND.water) this.kind[y * this.cols + x] = GROUND.grass;
  }

  // ---------------------------------------------------------------- drawing
  // Draws the ground onto the battle background (under the units).
  draw(ctx) {
    const C = this.C, T = Assets.img, rng = makeRng(99);
    const trees = [];
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const k = this.kind[y * this.cols + x], px = x * C, py = y * C;
      const n = (r, g, b, j) => { const v = Math.floor((rng() - 0.5) * j); return `rgb(${r + v},${g + v},${b + v})`; };
      if (k === GROUND.forest) {
        ctx.fillStyle = n(46, 92, 42, 14); ctx.fillRect(px, py, C, C);
        if ((x + y * 3) % 2 === 0 && rng() < 0.7) trees.push([px - 4 + rng() * 4, py - 10 + rng() * 4]);
      } else if (k === GROUND.water) {
        ctx.fillStyle = n(52, 110, 190, 10); ctx.fillRect(px, py, C, C);
        if (rng() < 0.25) { ctx.fillStyle = '#8fc4f0'; ctx.fillRect(px + 1 + Math.floor(rng() * 4), py + 2 + Math.floor(rng() * 4), 3, 1); }
      } else if (k === GROUND.ford) {
        ctx.fillStyle = n(176, 150, 98, 14); ctx.fillRect(px, py, C, C);
        if (rng() < 0.35) { ctx.fillStyle = 'rgba(80,140,210,0.6)'; ctx.fillRect(px + Math.floor(rng() * 4), py + Math.floor(rng() * 6), 4, 1); }
      } else if (k === GROUND.mud) {
        ctx.fillStyle = n(92, 76, 44, 16); ctx.fillRect(px, py, C, C);
        if (rng() < 0.2) { ctx.fillStyle = '#4c6a3a'; ctx.fillRect(px + 2, py + 2, 2, 2); }
      }
    }
    // soft dark edge where water meets land
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const k = this.kind[y * this.cols + x];
      if (k !== GROUND.water) continue;
      const nb = (dx) => this.kind[y * this.cols + x + dx];
      ctx.fillStyle = 'rgba(20,40,80,0.45)';
      if (x > 0 && nb(-1) !== GROUND.water && nb(-1) !== GROUND.ford) ctx.fillRect(x * C, y * C, 1, C);
      if (x < this.cols - 1 && nb(1) !== GROUND.water && nb(1) !== GROUND.ford) ctx.fillRect(x * C + C - 1, y * C, 1, C);
    }
    trees.sort((a, b) => a[1] - b[1]);
    for (const [x, y] of trees) {
      const im = T[rng() < 0.5 ? 'tile:tree_round' : 'tile:tree_pine'];
      if (im && im.width) ctx.drawImage(im, Math.round(x), Math.round(y));
    }
    if (this.walls) this.drawWall(ctx);
  }

  drawWall(ctx) {
    const C = this.C, x = Math.floor(this.wallX / C) * C;
    for (let y = 0; y < this.rows; y++) {
      if (this.kind[y * this.cols + Math.floor(this.wallX / C)] !== GROUND.wall) continue;
      const py = y * C;
      ctx.fillStyle = '#2a2630'; ctx.fillRect(x - 1, py - 4, C + 2, C + 4);      // outline + height
      ctx.fillStyle = (y % 2) ? '#9a96a4' : '#8a8694'; ctx.fillRect(x, py - 3, C, C + 2);
      ctx.fillStyle = '#b8b4c2'; ctx.fillRect(x, py - 3, C, 1);                  // lit top edge
      ctx.fillStyle = '#5e5a68'; ctx.fillRect(x, py + 2, C, 1);                  // mortar line
      ctx.fillRect(x + (y % 2 ? 2 : 5), py - 3, 1, 5);
    }
    // gate posts
    for (const g of this.gates) for (const gy of [g - 18, g + 8]) {
      ctx.fillStyle = '#2a2630'; ctx.fillRect(x - 2, gy - 2, C + 4, 12);
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(x - 1, gy - 1, C + 2, 10);
      ctx.fillStyle = '#8a6438'; ctx.fillRect(x - 1, gy - 1, C + 2, 1);
    }
  }
}
const GROUND_NAMES = Object.keys(GROUND);
