// =============================================================================
//  BATTLEFIELD TERRAIN: forests, rivers, swamps, snow, dunes, lava, crystals, walls.
//  The field is a grid of 8x8 cells. Every cell has a ground kind, which sets
//  how fast units move through it and how much cover it gives from arrows and
//  spells. The layout comes from the town's `terrain` and `walls` in data.js,
//  seeded by the town's name so the same town always looks the same.
// =============================================================================
const GROUND = { grass: 0, forest: 1, water: 2, ford: 3, mud: 4, wall: 5, snow: 6, ice: 7, sand: 8, lava: 9, rock: 10 };

class Terrain {
  constructor(spotId, W, H) {
    const s = DATA.spots[spotId] || {};
    this.W = W; this.H = H; this.C = 8;
    this.cols = Math.ceil(W / this.C); this.rows = Math.ceil(H / this.C);
    this.kind = new Uint8Array(this.cols * this.rows);
    this.cover = new Float32Array(this.cols * this.rows);
    this.type = s.terrain || 'plains';
    this.walls = !!s.walls;
    this.region = s.region || 'free';
    // trees used for forests and the tree lines at the edges of the field
    this.trees = { frost: ['snowpine'], darkwood: ['darktree', 'darktree', 'tree_pine'], ember: ['deadpine', 'ashrock'],
      shadow: ['deadpine', 'tree_pine'], bog: ['tree_round', 'mushroom'], azure: ['palm', 'crystal'], sun: ['palm', 'cactus'] }[this.region]
      || ['tree_round', 'tree_pine'];
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
    const name = { plains: 'Open plains', forest: 'Forest', river: 'River', swamp: 'Swamp', snow: 'Snowfield',
      dunes: 'Dunes', lava: 'Lava field', crystal: 'Crystal shore' }[this.type] || this.type;
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

  // n clumps of ground kind k, scattered over the middle of the field. n is given for
  // the old 480x270 field and scaled up with the field's area.
  clumps(n, k, rMin, rMax) {
    const rng = this.rng, A = this.W * this.H / (480 * 270);
    const count = Math.round(n * A * 0.55);
    for (let i = 0; i < count; i++)
      this.setCircle(this.W * (0.18 + rng() * 0.64), this.H * (0.08 + rng() * 0.84), (rMin + rng() * (rMax - rMin)) * 1.4, k);
  }

  generate() {
    const rng = this.rng, C = this.C, W = this.W, H = this.H;
    if (this.type === 'river') {
      // A winding river across the middle, with shallow fords.
      const x0 = W * (0.44 + rng() * 0.12), phase = rng() * 6, amp = 20 + rng() * 30;
      const fords = [0.2, 0.5, 0.8].map(f => H * (f + (rng() - 0.5) * 0.1));
      for (let y = 0; y < this.rows; y++) {
        const py = y * C + 4, cx = x0 + Math.sin(py / 70 + phase) * amp;
        const ford = fords.some(f => Math.abs(py - f) < 16);
        for (let x = 0; x < this.cols; x++) {
          const px = x * C + 4;
          if (Math.abs(px - cx) < 18) this.kind[y * this.cols + x] = ford ? GROUND.ford : GROUND.water;
        }
      }
      this.clumps(2, GROUND.forest, 14, 22);
    } else if (this.type === 'snow') {
      this.clumps(7, GROUND.snow, 16, 30);                                  // deep drifts
      this.clumps(2, GROUND.ice, 14, 22);                                   // slippery frozen ponds
      this.clumps(2, GROUND.forest, 12, 18);
    } else if (this.type === 'dunes') {
      this.clumps(8, GROUND.sand, 16, 30);
      this.clumps(2, GROUND.rock, 5, 8);
    } else if (this.type === 'lava') {
      this.clumps(4, GROUND.lava, 9, 15);                                   // molten pools: walk around
      this.clumps(4, GROUND.rock, 5, 8);
    } else if (this.type === 'crystal') {
      this.clumps(7, GROUND.rock, 5, 9);                                    // crystal pillars
      this.clumps(2, GROUND.water, 14, 22);
    } else if (this.type === 'forest') {
      this.clumps(6, GROUND.forest, 18, 32);
    } else if (this.type === 'swamp') {
      this.clumps(7, GROUND.mud, 16, 30);
      this.clumps(2, GROUND.forest, 12, 20);
    } else {
      this.clumps(3, GROUND.forest, 12, 20);
    }

    if (this.walls) {
      // The town sits behind a stone wall with two open gates.
      this.wallX = W - 280;
      const wx = Math.floor(this.wallX / C);
      const gates = [H * 0.3, H * 0.7].map(g => Math.round((g + (rng() - 0.5) * 60) / 8) * 8);
      this.gates = gates;
      for (let y = 0; y < this.rows; y++) {
        const py = y * C + 4;
        const i = y * this.cols + wx;
        if (py < 12 || py > H - 12) continue;
        if (gates.some(g => Math.abs(py - g) < 12)) { this.kind[i] = GROUND.grass; continue; }
        this.kind[i] = GROUND.wall;
        for (let k = 1; k <= 6; k++) this.cover[i + k] = DATA.ground.wall.behindCover;  // shelter behind the wall
      }
      // inside the walls: clear ground for the town
      for (let y = 0; y < this.rows; y++) for (let x = wx + 1; x < this.cols; x++) this.kind[y * this.cols + x] = GROUND.grass;
    }
    // never block the starting areas
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const i = y * this.cols + x;
      const k = this.kind[i];
      if ((x * C < 200 || x * C > W - 200) && k !== GROUND.wall && k !== GROUND.forest && k !== GROUND.snow && k !== GROUND.sand) this.kind[i] = GROUND.grass;
    }
  }

  // ---------------------------------------------------------------- drawing
  // Draws the ground onto the battle background (under the units).
  draw(ctx) {
    const C = this.C, T = Assets.img, rng = makeRng(99);
    const trees = [], rocks = [];
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const k = this.kind[y * this.cols + x], px = x * C, py = y * C;
      const n = (r, g, b, j) => { const v = Math.floor((rng() - 0.5) * j); return `rgb(${r + v},${g + v},${b + v})`; };
      if (k === GROUND.forest) {
        ctx.fillStyle = n(46, 92, 42, 14); ctx.fillRect(px, py, C, C);
        if ((x + y * 3) % 2 === 0 && rng() < 0.7) trees.push([px - 4 + rng() * 4, py - 10 + rng() * 4]);
      } else if (k === GROUND.water || k === GROUND.ford) {
        rng(); rng();                                     // drawn below as smooth shapes (keep the random sequence)
      } else if (k === GROUND.snow) {
        ctx.fillStyle = n(236, 242, 250, 8); ctx.fillRect(px, py, C, C);
        if (rng() < 0.3) { ctx.fillStyle = '#c4d4e6'; ctx.fillRect(px + Math.floor(rng() * 5), py + Math.floor(rng() * 6), 3, 1); }
      } else if (k === GROUND.ice) {
        ctx.fillStyle = n(176, 214, 238, 8); ctx.fillRect(px, py, C, C);
        if (rng() < 0.25) { ctx.fillStyle = '#ffffff'; ctx.fillRect(px + 1 + Math.floor(rng() * 4), py + 1 + Math.floor(rng() * 4), 2, 1); }
      } else if (k === GROUND.sand) {
        ctx.fillStyle = n(238, 210, 140, 10); ctx.fillRect(px, py, C, C);
        if ((x + y) % 3 === 0) { ctx.fillStyle = '#c8a050'; ctx.fillRect(px, py + 5, C, 1); ctx.fillStyle = '#fae6a8'; ctx.fillRect(px, py + 4, C, 1); }
      } else if (k === GROUND.lava) {
        ctx.fillStyle = rng() < 0.5 ? '#e8501e' : '#ff7a2a'; ctx.fillRect(px, py, C, C);
        if (rng() < 0.3) { ctx.fillStyle = '#ffd04a'; ctx.fillRect(px + Math.floor(rng() * 5), py + Math.floor(rng() * 5), 3, 2); }
      } else if (k === GROUND.rock) {
        rocks.push([px + 4, py + 8]);
      } else if (k === GROUND.mud) {
        ctx.fillStyle = n(92, 76, 44, 16); ctx.fillRect(px, py, C, C);
        if (rng() < 0.2) { ctx.fillStyle = '#4c6a3a'; ctx.fillRect(px + 2, py + 2, 2, 2); }
      }
    }
    // dark crust around lava pools
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      if (this.kind[y * this.cols + x] !== GROUND.lava) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k2 = this.kind[(y + dy) * this.cols + x + dx];
        if (k2 !== undefined && k2 !== GROUND.lava) { ctx.fillStyle = '#2a1a14'; ctx.fillRect((x + dx) * C, (y + dy) * C, C, C); }
      }
    }
    this.drawWater(ctx);
    trees.sort((a, b) => a[1] - b[1]);
    for (const [x, y] of trees) {
      const im = Art.deco(this.trees[Math.floor(rng() * this.trees.length)]);
      if (im && im.width) HD.draw(ctx, im, Math.round(x), Math.round(y - (im.height - 16)));
    }
    // solid rocks: crystal pillars by the lakes, boulders elsewhere
    const rockArt = this.region === 'azure' || this.type === 'crystal' ? 'crystal' : this.region === 'frost' ? 'icerock' : this.region === 'ember' ? 'ashrock' : 'boulder';
    for (const [x, y] of rocks.sort((a, b) => a[1] - b[1])) {
      const im = Art.deco(rockArt);
      HD.draw(ctx, im, Math.round(x - 8), Math.round(y - im.height + 2));
    }
    if (this.walls) {
      this.drawWall(ctx);
      // the town itself, behind the wall
      const style = (DATA.regions[this.region] || DATA.regions.free).building;
      const r2 = makeRng(7);
      for (let i = 0; i < 7; i++) {
        const im = Art.building(style, i === 0 ? 2 : (i % 3 === 0 ? 1 : 0));
        const x = this.wallX + 70 + (i % 3) * 70 + r2() * 20, y = this.H * (0.18 + Math.floor(i / 3) * 0.32) + r2() * 30 + 40;
        HD.draw(ctx, im, Math.round(x - 24), Math.round(y - 34));
      }
    }
  }

  // Rivers, lakes and fords as smooth shapes: the cell grid is blended into a soft
  // field and cut at the halfway line, so banks curve instead of stepping. Gameplay
  // still uses the cells; the drawn edge moves by at most half a cell.
  drawWater(ctx) {
    const C = this.C, cols = this.cols, rows = this.rows, S = 2;          // 2 pixels per world pixel
    const wet = new Float32Array(cols * rows), ford = new Float32Array(cols * rows);
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const k = this.kind[y * cols + x];
      if (k !== GROUND.water && k !== GROUND.ford) continue;
      wet[y * cols + x] = 1; if (k === GROUND.ford) ford[y * cols + x] = 1;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x1 < 0) return;
    // soften the cell staircase: two passes of a small blur, then the field is cut at 0.5
    const blur = a => {
      for (let pass = 0; pass < 2; pass++) {
        const t = new Float32Array(a.length);
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
          t[y * cols + x] = (a[y * cols + Math.max(0, x - 1)] + 2 * a[y * cols + x] + a[y * cols + Math.min(cols - 1, x + 1)]) / 4;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
          a[y * cols + x] = (t[Math.max(0, y - 1) * cols + x] + 2 * t[y * cols + x] + t[Math.min(rows - 1, y + 1) * cols + x]) / 4;
      }
    };
    blur(wet); blur(ford);
    for (let i = 0; i < wet.length; i++) if (this.kind[i] === GROUND.water || this.kind[i] === GROUND.ford) wet[i] = Math.max(wet[i], 0.62);   // no cell of water vanishes
    const at = (a, x, y) => a[Math.max(0, Math.min(rows - 1, y)) * cols + Math.max(0, Math.min(cols - 1, x))];
    const field = (a, wx, wy) => {                                    // smooth (bilinear, eased) blend of the cells
      const u = wx / C - 0.5, v = wy / C - 0.5, ix = Math.floor(u), iy = Math.floor(v);
      let tx = u - ix, ty = v - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      return (at(a, ix, iy) * (1 - tx) + at(a, ix + 1, iy) * tx) * (1 - ty) + (at(a, ix, iy + 1) * (1 - tx) + at(a, ix + 1, iy + 1) * tx) * ty;
    };
    const noise = makeNoise(77);
    const px0 = Math.max(0, (x0 - 1) * C), py0 = Math.max(0, (y0 - 1) * C);
    const pw = Math.min(this.W, (x1 + 2) * C) - px0, ph = Math.min(this.H, (y1 + 2) * C) - py0;
    const cv = document.createElement('canvas'); cv.width = pw * S; cv.height = ph * S;
    const c = cv.getContext('2d'), img = c.createImageData(cv.width, cv.height), d = img.data;
    const put = (i, r, g, b, a = 255) => { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; };
    const hash = (x, y) => { let h = Math.imul(x * 374761393 + y * 668265263, 1274126177); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
    for (let Y = 0; Y < cv.height; Y++) for (let X = 0; X < cv.width; X++) {
      const wx = px0 + X / S, wy = py0 + Y / S;
      const wob = (noise(wx / 9, wy / 9) - 0.5) * 0.22;
      const w = field(wet, wx, wy) + wob, i = (Y * cv.width + X) * 4;
      if (w < 0.4) continue;
      if (w < 0.5) { put(i, 46, 62, 30, Math.round(150 * (w - 0.4) / 0.1)); continue; }   // damp, dark bank
      const f = field(ford, wx, wy) + wob * 0.5;
      if (f > 0.5) {                                                  // ford: wet sand with ripples
        const n = noise(wx / 5, wy / 5) * 18 - 9;
        if (hash(Math.floor(wx / 4 + Math.sin(wy / 4) * 2), Math.floor(wy / 1.5)) < 0.05) put(i, 120, 160, 196);
        else put(i, 182 + n, 156 + n, 104 + n);
        continue;
      }
      const depth = Math.min(1, (w - 0.5) / 0.3);                    // shallow near the bank, deeper in the middle
      const n = (noise(wx / 14 + 30, wy / 14) - 0.5) * 14;
      let r = 92 - depth * 44 + n, g = 156 - depth * 50 + n, b = 222 - depth * 34 + n;
      if (w < 0.56) { r = 150; g = 200; b = 236; }                   // bright waterline
      if (depth > 0.3 && hash(Math.floor(wx / 5 + Math.sin(wy / 3)), Math.floor(wy)) < 0.035) { r = 150; g = 200; b = 242; }   // glints
      put(i, r, g, b);
    }
    c.putImageData(img, 0, 0);
    ctx.drawImage(cv, px0, py0, pw, ph);
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
    for (const g of this.gates) for (const gy of [g - 22, g + 12]) {
      ctx.fillStyle = '#2a2630'; ctx.fillRect(x - 2, gy - 2, C + 4, 12);
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(x - 1, gy - 1, C + 2, 10);
      ctx.fillStyle = '#8a6438'; ctx.fillRect(x - 1, gy - 1, C + 2, 1);
    }
  }
}
const GROUND_NAMES = Object.keys(GROUND);
