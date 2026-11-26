// =============================================================================
//  BATTLEFIELD TERRAIN: hills, forests, rivers, streams, lakes, swamps, snow,
//  dunes, lava, crystals and town walls.
//  The field is a grid of 8x8 cells. Every cell has a ground kind (how fast units
//  move through it, how much cover it gives) and a height (0 = low ground, about
//  1 = a hilltop). High ground lets shooters reach further and see further, gives
//  melee the edge downhill and slows anyone climbing; forests hide the units in them.
//  The layout comes from the town's `terrain` (see FIELD_RECIPES) and region, and
//  `walls`, seeded by the town's id so the same town always gives the same field.
// =============================================================================
const GROUND = { grass: 0, forest: 1, water: 2, ford: 3, mud: 4, wall: 5, snow: 6, ice: 7, sand: 8, lava: 9, rock: 10, stream: 11, bridge: 12 };

// What each battlefield type is made of. Counts are for the whole field.
//   hills: number of hills (ridge: long thin dune ridges), forests: forest blobs,
//   river: chance of a big river across the middle (riverKind: water, ice or lava),
//   streams: thin shallow streams, lakes: ponds, rocks: boulder / pillar clusters,
//   clumps: [kind, count, min radius, max radius] patches of slow ground.
const FIELD_RECIPES = {
  plains:  { hills: 4, forests: 7, forestR: [45, 95], river: 0.35, streams: 1, lakes: 0, rocks: 4 },
  forest:  { hills: 3, forests: 15, forestR: [60, 130], river: 0.3, streams: 1, lakes: 0, rocks: 2 },
  river:   { hills: 3, forests: 7, forestR: [45, 95], river: 1, streams: 1, lakes: 0, rocks: 3 },
  swamp:   { hills: 2, forests: 6, forestR: [40, 80], river: 0, streams: 3, lakes: 4, rocks: 1, clumps: [['mud', 11, 45, 90]] },
  snow:    { hills: 6, forests: 5, forestR: [40, 85], river: 0.6, riverKind: 'ice', streams: 0, lakes: 0, rocks: 4, clumps: [['snow', 9, 45, 95], ['ice', 2, 30, 55]] },
  dunes:   { hills: 7, ridge: true, forests: 1, forestR: [25, 45], river: 0, streams: 0, lakes: 1, rocks: 7, clumps: [['sand', 10, 55, 110]] },
  lava:    { hills: 5, forests: 2, forestR: [35, 60], river: 0.8, riverKind: 'lava', streams: 0, lakes: 0, rocks: 8, clumps: [['lava', 8, 25, 50]] },
  crystal: { hills: 2, forests: 4, forestR: [35, 70], river: 0.25, streams: 1, lakes: 4, rocks: 10 },
};
// Regional flavour on top of the recipe: extra (or fewer) forests and streams.
const REGION_FIELD = { darkwood: { forests: 5 }, bog: { streams: 1, lakes: 1 }, sun: { forests: -3 }, ember: { forests: -2 }, frost: { hills: 1 }, shadow: { rocks: 3 } };

class Terrain {
  constructor(spotId, W, H) {
    const s = DATA.spots[spotId] || {};
    this.W = W; this.H = H; this.C = 8;
    this.cols = Math.ceil(W / this.C); this.rows = Math.ceil(H / this.C);
    this.kind = new Uint8Array(this.cols * this.rows);
    this.cover = new Float32Array(this.cols * this.rows);
    this.height = new Float32Array(this.cols * this.rows);
    this.type = s.terrain || 'plains';
    this.walls = !!s.walls;
    this.region = s.region || 'free';
    this.features = [];                     // what the field has, for the HUD (hills, river with fords...)
    // trees used for forests and the tree lines at the edges of the field
    this.trees = { frost: ['snowpine'], darkwood: ['darktree', 'darktree', 'tree_pine'], ember: ['deadpine', 'ashrock'],
      shadow: ['deadpine', 'tree_pine'], bog: ['tree_round', 'mushroom'], azure: ['palm', 'crystal'], sun: ['palm', 'cactus'] }[this.region]
      || ['tree_round', 'tree_pine'];
    let seed = 7; for (const ch of spotId || 'x') seed = seed * 31 + ch.charCodeAt(0);
    this.rng = makeRng(seed);
    this.noise = makeNoise((seed >>> 0) & 0xffff);
    this.generate();
  }

  // ---------------------------------------------------------------- lookups
  idx(x, y) {
    const cx = Math.floor(x / this.C), cy = Math.floor(y / this.C);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }
  kindAt(x, y) { const i = this.idx(x, y); return i < 0 ? 0 : this.kind[i]; }
  groundAt(x, y) { return DATA.ground[GROUND_NAMES[this.kindAt(x, y)]]; }
  footingAt(x, y) { const f = this.groundAt(x, y).footing; return f == null ? 1 : f; }
  speedAt(x, y) { return this.groundAt(x, y).speed; }
  passable(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H && this.speedAt(x, y) > 0; }
  coverAt(x, y) {
    const i = this.idx(x, y); if (i < 0) return 0;
    return Math.max(this.cover[i], DATA.ground[GROUND_NAMES[this.kind[i]]].cover || 0);
  }
  // Units standing in a forest can only be spotted from close by.
  hidesAt(x, y) { return this.kindAt(x, y) === GROUND.forest; }
  // Ground height at a point (smoothly between cell centres): 0 low ground, ~1 a hilltop.
  heightAt(x, y) {
    const C = this.C, u = clamp(x / C - 0.5, 0, this.cols - 1.001), v = clamp(y / C - 0.5, 0, this.rows - 1.001);
    const ix = Math.floor(u), iy = Math.floor(v), tx = u - ix, ty = v - iy, h = this.height, c = this.cols, i = iy * c + ix;
    const ix1 = Math.min(this.cols - 1, ix + 1) - ix, iy1 = (Math.min(this.rows - 1, iy + 1) - iy) * c;
    return (h[i] * (1 - tx) + h[i + ix1] * tx) * (1 - ty) + (h[i + iy1] * (1 - tx) + h[i + iy1 + ix1] * tx) * ty;
  }
  // Speed factor for walking from (x, y) in direction (dx, dy): slower uphill, a little faster downhill.
  slopeFactor(x, y, dx, dy) {
    const d = Math.hypot(dx, dy); if (!d) return 1;
    const look = 10, rise = (this.heightAt(x + dx / d * look, y + dy / d * look) - this.heightAt(x, y)) / look * 100;   // height per 100 px
    return clamp(1 - rise * DATA.battle.hills.climb, 0.65, 1.12);
  }
  // The nearest spot units can stand on (for teleports and deployment), searching outward.
  nearestOpen(x, y) {
    if (this.passable(x, y)) return [x, y];
    for (let r = 8; r < 240; r += 8) for (let a = 0; a < 16; a++) {
      const px = x + Math.cos(a / 16 * Math.PI * 2) * r, py = y + Math.sin(a / 16 * Math.PI * 2) * r;
      if (this.passable(px, py)) return [px, py];
    }
    return [clamp(x, 8, this.W - 8), clamp(y, 16, this.H - 8)];
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
    const extra = this.features.filter(f => !name.toLowerCase().includes(f.split(' ')[0])).slice(0, 2);
    return [name, ...extra].join(', ') + (this.walls ? ', walled town' : '');
  }
  // What is under a point, for the battle's ground readout.
  infoAt(x, y) {
    const k = GROUND_NAMES[this.kindAt(x, y)], G = DATA.ground[k], h = this.heightAt(x, y), HB = DATA.battle.hills;
    const parts = [{ grass: 'Open ground', forest: 'Forest - hides troops, cover', water: 'Deep water - slow, poor footing', ford: 'Ford - shallow crossing',
      mud: 'Mud - slow', wall: 'Wall', snow: 'Snowdrift - slow', ice: 'Ice - fast, slippery', sand: 'Sand - slow', lava: 'Lava - impassable',
      rock: 'Rocks - impassable', stream: 'Stream - shallow', bridge: 'Bridge' }[k] || k];
    if (h > 0.2) parts.push(`${h > 0.7 ? 'Hilltop' : 'Slope'}: shooters +${Math.round(h * HB.range * 100)}% range`);
    if (G.cover && k !== 'forest') parts.push(`${Math.round(G.cover * 100)}% cover`);
    return parts.join(' | ');
  }

  // ---------------------------------------------------------------- generation
  // A blob of ground kind k with a ragged, noisy edge, laid only over the `only` kinds.
  blob(cx, cy, r, k, only = [GROUND.grass], stretch = 1.15) {
    const C = this.C, n = this.noise, off = this.rng() * 100;
    const x0 = Math.max(0, Math.floor((cx - r * 1.4) / C)), x1 = Math.min(this.cols - 1, Math.ceil((cx + r * 1.4) / C));
    const y0 = Math.max(0, Math.floor((cy - r * 1.4) / C)), y1 = Math.min(this.rows - 1, Math.ceil((cy + r * 1.4) / C));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x * C + 4, py = y * C + 4, i = y * this.cols + x;
      const d = Math.hypot(px - cx, (py - cy) * stretch) / r + (n(px / 38 + off, py / 38) - 0.5) * 0.7;
      if (d < 1 && only.includes(this.kind[i])) this.kind[i] = k;
    }
  }
  // Cells near a point have their ground height pressed down (river valleys, lake beds).
  flatten(px, py, i, inner, outer, dist) {
    const t = clamp((dist - inner) / (outer - inner), 0, 1);
    this.height[i] *= t * t * (3 - 2 * t);
  }

  // Hills: smooth mounds with flattish tops, spread so each third of the field gets some.
  genHills(n, ridge) {
    const rng = this.rng, C = this.C, W = this.W, H = this.H;
    for (let k = 0; k < n; k++) {
      const zone = [1, 0, 2][k % 3];                                  // the middle first, then each side
      const cx = W * (0.06 + zone * 0.3 + rng() * 0.28), cy = H * (0.1 + rng() * 0.8);
      const rx = ridge ? 160 + rng() * 160 : 110 + rng() * 140, ry = ridge ? rx * (0.18 + rng() * 0.12) : rx * (0.45 + rng() * 0.5);
      const ang = ridge ? (rng() - 0.5) * 0.8 + Math.PI / 2 * (rng() < 0.5 ? 0 : 1) : rng() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);
      const peak = 0.65 + rng() * 0.45, R = Math.max(rx, ry);
      const x0 = Math.max(0, Math.floor((cx - R) / C)), x1 = Math.min(this.cols - 1, Math.ceil((cx + R) / C));
      const y0 = Math.max(0, Math.floor((cy - R) / C)), y1 = Math.min(this.rows - 1, Math.ceil((cy + R) / C));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x * C + 4 - cx, dy = y * C + 4 - cy, lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
        const d = Math.hypot(lx / rx, ly / ry) + (this.noise(x / 6 + k * 13, y / 6) - 0.5) * 0.25;
        if (d >= 1) continue;
        const f = clamp((1 - d) / 0.6, 0, 1), h = peak * f * f * (3 - 2 * f);   // plateau in the middle
        const i = y * this.cols + x; this.height[i] = Math.max(this.height[i], h);
      }
    }
    // gentle swells everywhere so the ground never looks perfectly flat
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const i = y * this.cols + x;
      this.height[i] = Math.max(0, this.height[i] + (this.noise(x / 14 + 50, y / 14) - 0.5) * 0.12);
    }
    if (n) this.features.push(ridge ? 'dune ridges' : n >= 5 ? 'rolling hills' : 'hills');
  }

  // A river winding from the top of the field to the bottom through the middle, with
  // crossings (fords and a bridge; stone causeways over lava; none needed on ice).
  genRiver(kindName) {
    const rng = this.rng, C = this.C, W = this.W, H = this.H, G = GROUND, k = G[kindName];
    const x0 = W * (0.43 + rng() * 0.14), a1 = 40 + rng() * 60, a2 = 12 + rng() * 22, p1 = rng() * 6, p2 = rng() * 6;
    const half = kindName === 'lava' ? 15 + rng() * 5 : 19 + rng() * 7;
    const cx = y => x0 + Math.sin(y / 190 + p1) * a1 + Math.sin(y / 70 + p2) * a2;
    const n = kindName === 'ice' ? 0 : kindName === 'lava' ? 3 : 2 + (rng() < 0.6 ? 1 : 0);
    const crossings = [];
    for (let i = 0; i < n; i++) {
      const y = H * (0.12 + 0.76 * (i + 0.5) / n) + (rng() - 0.5) * 70;
      crossings.push({ y, bridge: kindName === 'lava' || (i === 1 && n === 3) || (n === 2 && i === 0 && rng() < 0.5) });
    }
    for (let y = 0; y < this.rows; y++) {
      const py = y * C + 4, c = cx(py);
      for (let x = 0; x < this.cols; x++) {
        const px = x * C + 4, i = y * this.cols + x, d = Math.abs(px - c);
        const w = half + (this.noise(px / 30, py / 30) - 0.5) * 8;
        this.flatten(px, py, i, w, w + 70, d);
        if (d >= w) continue;
        const cr = crossings.find(q => Math.abs(py - q.y) < (q.bridge ? 10 : 22));
        this.kind[i] = cr ? (cr.bridge ? G.bridge : G.ford) : k;
      }
    }
    this.river = { cx, crossings, kind: kindName };
    const nb = crossings.filter(q => q.bridge).length, nf = crossings.length - nb;
    this.features.push(kindName === 'ice' ? 'frozen river' : kindName === 'lava' ? `lava river (${nb} causeways)`
      : `river (${[nf ? `${nf} ford${nf > 1 ? 's' : ''}` : '', nb ? `${nb} bridge` : ''].filter(Boolean).join(', ')})`);
  }

  // A thin, shallow stream that wanders across the field.
  genStream() {
    const rng = this.rng, C = this.C, W = this.W, H = this.H;
    const vertical = rng() < 0.6, base = (vertical ? W : H) * (0.25 + rng() * 0.5), amp = 30 + rng() * 60, ph = rng() * 6, half = 5 + rng() * 3;
    const tilt = (rng() - 0.5) * 0.5;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const px = x * C + 4, py = y * C + 4, i = y * this.cols + x;
      const along = vertical ? py : px, across = vertical ? px : py;
      const d = Math.abs(across - (base + Math.sin(along / 120 + ph) * amp + (along - (vertical ? H : W) / 2) * tilt));
      this.flatten(px, py, i, half, half + 40, d);
      if (d < half && [GROUND.grass, GROUND.mud, GROUND.snow, GROUND.sand].includes(this.kind[i])) this.kind[i] = GROUND.stream;
    }
    if (!this.features.includes('streams')) this.features.push('streams');
  }

  genLake() {
    const rng = this.rng, C = this.C, cx = this.W * (0.25 + rng() * 0.5), cy = this.H * (0.12 + rng() * 0.76), r = 40 + rng() * 55;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const px = x * C + 4, py = y * C + 4, d = Math.hypot(px - cx, (py - cy) * 1.3);
      if (d < r + 90) this.flatten(px, py, y * this.cols + x, r, r + 90, d);
    }
    this.blob(cx, cy, r, GROUND.water, [GROUND.grass, GROUND.mud, GROUND.sand, GROUND.snow, GROUND.forest], 1.3);
    if (!this.features.includes('lakes')) this.features.push('lakes');
  }

  // The middle of the field, where blobs and features go (not the deployment edges).
  midPoint(edge = 0.08) { return [this.W * (edge + this.rng() * (1 - edge * 2)), this.H * (0.05 + this.rng() * 0.9)]; }

  generate() {
    const rng = this.rng, C = this.C, W = this.W, H = this.H, G = GROUND;
    const R = { ...FIELD_RECIPES[this.type] || FIELD_RECIPES.plains };
    for (const [k, v] of Object.entries(REGION_FIELD[this.region] || {})) R[k] = Math.max(0, (R[k] || 0) + v);

    this.genHills(R.hills, R.ridge);
    for (const [kind, n, r0, r1] of R.clumps || [])                  // patches of slow ground (mud, snow, sand...)
      for (let i = 0; i < n; i++) { const [x, y] = this.midPoint(0.04); this.blob(x, y, r0 + rng() * (r1 - r0), G[kind]); }
    for (let i = 0; i < R.lakes; i++) this.genLake();
    if (rng() < R.river) this.genRiver(R.riverKind || 'water');
    for (let i = 0; i < R.streams; i++) this.genStream();
    const soft = [G.grass, G.snow, G.sand, G.mud];
    for (let i = 0; i < R.forests; i++) {                             // forests: a big blob with a smaller one or two beside it
      const [x, y] = this.midPoint(0.05), r = R.forestR[0] + rng() * (R.forestR[1] - R.forestR[0]);
      this.blob(x, y, r, G.forest, soft);
      if (rng() < 0.6) this.blob(x + (rng() - 0.5) * r * 2, y + (rng() - 0.5) * r * 1.6, r * 0.55, G.forest, soft);
    }
    if (R.forests >= 3) this.features.push(R.forests >= 10 ? 'thick woods' : 'woods');
    for (let i = 0; i < R.rocks; i++) {                               // boulders / pillars, mostly on slopes
      let [x, y] = this.midPoint(0.12);
      for (let t = 0; t < 4 && this.heightAt(x, y) < 0.3; t++) [x, y] = this.midPoint(0.12);
      for (let j = 0, m = 2 + Math.floor(rng() * 3); j < m; j++) this.blob(x + (rng() - 0.5) * 70, y + (rng() - 0.5) * 50, 10 + rng() * 12, G.rock, soft);
    }

    if (this.walls) {
      // The town sits behind a stone wall with open gates, on flat ground.
      this.wallX = W - 300;
      const wx = Math.floor(this.wallX / C);
      const gates = [H * 0.22, H * 0.5, H * 0.78].map(g => Math.round((g + (rng() - 0.5) * 60) / 8) * 8);
      this.gates = gates;
      for (let y = 0; y < this.rows; y++) {
        const py = y * C + 4;
        for (let x = wx - 6; x < this.cols; x++) {                     // clear ground in front of the wall and inside
          const i = y * this.cols + x;
          this.kind[i] = G.grass;
          if (x > wx) this.height[i] = 0; else this.height[i] *= (wx - x) / 6;
        }
        const i = y * this.cols + wx;
        if (py < 12 || py > H - 12) continue;
        if (gates.some(g => Math.abs(py - g) < 12)) continue;
        this.kind[i] = G.wall;
        for (let k = 1; k <= 6; k++) this.cover[i + k] = DATA.ground.wall.behindCover;  // shelter behind the wall
      }
    }
    // never block the starting areas: no water, lava or rocks where armies deploy
    const blocks = [G.water, G.lava, G.rock, G.ice];
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const i = y * this.cols + x;
      if ((x * C < 300 || x * C > W - 300) && blocks.includes(this.kind[i])) this.kind[i] = G.grass;
    }
  }

  // ---------------------------------------------------------------- drawing
  // Draws the ground onto the battle background (under the units).
  draw(ctx) {
    const C = this.C, rng = makeRng(99);
    const trees = [], rocks = [];
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const k = this.kind[y * this.cols + x], px = x * C, py = y * C;
      if (k === GROUND.forest && (x + y * 3) % 2 === 0 && rng() < 0.7) trees.push([px - 4 + rng() * 4, py - 10 + rng() * 4]);
      else if (k === GROUND.rock && (x + y) % 2 === 0) rocks.push([px + 4, py + 8]);
    }
    this.drawGround(ctx);
    this.drawHills(ctx);
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
      this.drawTown(ctx);
      this.drawWall(ctx);
    }
  }

  // Hills: soft light from the top left, shade on the far slopes, a touch of brightness
  // on high ground, and thin contour lines every fifth of a hill's height, so the
  // lie of the land reads at a glance from far above.
  drawHills(ctx) {
    const W = this.W, H = this.H, hs = new Float32Array(W * H);
    let any = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const h = this.heightAt(x, y); hs[y * W + x] = h; if (h > 0.15) any = true; }
    if (!any) return;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), img = c.createImageData(W, H), d = img.data, STEP = 0.2;
    const solid = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = this.kindAt(x, y); solid[y * W + x] = k === GROUND.water || k === GROUND.lava || k === GROUND.ice || k === GROUND.bridge ? 1 : 0; }
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x, h = hs[i];
      if (solid[i]) continue;
      const gx = (hs[i + 2] - hs[i - 2]) / 4 * 100, gy = (hs[i + 2 * W] - hs[i - 2 * W]) / 4 * 100;   // rise per 100 px
      const lit = clamp((-gx * 0.7 - gy * 0.9) * 0.55, -1, 1);
      let r = 0, g = 0, b = 0, a = 0;
      if (lit > 0) { r = 255; g = 250; b = 225; a = lit * 60 + h * 24; }   // high ground slightly paler
      else { r = 30; g = 36; b = 70; a = -lit * (this.region === 'frost' || this.type === 'snow' ? 55 : 75); }
      const band = Math.floor(h / STEP);
      if (h > 0.12 && (band !== Math.floor(hs[i + 1] / STEP) || band !== Math.floor(hs[i + W] / STEP))) { r = 40; g = 34; b = 24; a = 95; }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = clamp(a, 0, 120);
    }
    c.putImageData(img, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, 0, 0, W, H); ctx.restore();
  }

  // Every kind of ground is drawn as a smooth shape instead of square cells: each
  // kind's cells are lightly blurred into a field and traced at the halfway line, with
  // gently wobbling edges. Gameplay still uses the cells; a drawn edge moves by at
  // most half a cell. Layers go bottom to top so water sits over sand, and so on.
  drawGround(ctx) {
    const G = GROUND;
    const cl = v => Math.max(0, Math.min(255, Math.round(v)));
    // forest floor in the region's own colours (ash under burnt trees, snow under pines...)
    const FLOOR = { ember: [74, 58, 52], frost: [196, 210, 222], sun: [150, 128, 74], bog: [52, 70, 36], shadow: [56, 60, 70],
      darkwood: [34, 70, 40], azure: [52, 120, 104] }[this.region] || [46, 92, 42];
    this.layer(ctx, [G.forest], { edge: [FLOOR[0] * 0.65, FLOOR[1] * 0.65, FLOOR[2] * 0.65, 120], paint: (wx, wy, w, n) => {
      const v = (n(wx / 10, wy / 10) - 0.5) * 18 + (n(wx / 3 + 9, wy / 3) > 0.72 ? -10 : 0);
      return [FLOOR[0] + v, FLOOR[1] + v, FLOOR[2] + v * 0.6]; } });
    this.layer(ctx, [G.mud], { edge: [74, 62, 36, 140], paint: (wx, wy, w, n, h) => {
      const v = (n(wx / 9, wy / 9) - 0.5) * 20, pool = n(wx / 14 + 20, wy / 14);
      if (pool > 0.66) return h(wx, wy) < 0.03 ? [150, 170, 160] : [62 + v * 0.5, 58 + v * 0.5, 40];      // puddles
      return [92 + v, 76 + v, 44 + v * 0.6]; } });
    this.layer(ctx, [G.sand], { edge: [204, 172, 104, 150], paint: (wx, wy, w, n) => {
      const v = (n(wx / 12, wy / 12) - 0.5) * 14, dune = Math.sin(wy / 3.2 + n(wx / 16, wy / 16) * 7);
      if (dune > 0.9) return [250, 232, 172];                              // ripple crests
      if (dune < -0.93) return [206, 166, 92];                             // ripple shadows
      return [238 + v, 210 + v, 140 + v]; } });
    this.layer(ctx, [G.snow], { edge: [196, 212, 230, 150], paint: (wx, wy, w, n) => {
      const v = (n(wx / 14, wy / 14) - 0.5) * 12, drift = Math.sin(wx / 5 + n(wx / 20, wy / 20) * 8);
      if (drift > 0.94) return [204, 218, 234];
      return [236 + v, 242 + v, 250 + v * 0.3]; } });
    this.layer(ctx, [G.ice], { edge: [120, 160, 196, 200], rim: [228, 244, 255], paint: (wx, wy, w, n, h) => {
      const v = (n(wx / 12, wy / 12) - 0.5) * 16, crack = Math.abs(n(wx / 7 + 5, wy / 7) - 0.5) < 0.02;
      if (crack) return [140, 180, 214];
      if (h(Math.floor(wx / 3), Math.floor(wy)) < 0.02) return [255, 255, 255];
      return [176 + v, 214 + v, 238 + v * 0.4]; } });
    const stone = this.river && this.river.kind === 'lava';
    this.layer(ctx, stone ? [G.lava, G.bridge] : [G.lava], { edge: [42, 26, 20, 255], edgeFrom: 0.3, rim: [120, 40, 20], paint: (wx, wy, w, n) => {
      const f = n(wx / 8, wy / 8) * 0.6 + n(wx / 3 + 7, wy / 3) * 0.4, hot = Math.min(1, (w - 0.5) / 0.3);
      if (f > 0.68 && hot > 0.5) return [255, 220, 90];                  // bright veins
      return [cl(220 + 30 * f), cl(70 + 80 * f * hot), cl(24 + 20 * f)]; } });
    this.layer(ctx, [G.stream], { edge: [46, 62, 30, 110], rim: [170, 210, 236], paint: (wx, wy, w, n, h) => {
      const v = (n(wx / 8 + 3, wy / 8) - 0.5) * 14;
      if (h(Math.floor(wx / 4 + Math.sin(wy / 4) * 2), Math.floor(wy / 1.5)) < 0.05) return [190, 225, 248];
      return [106 + v, 168 + v, 222 + v]; } });
    this.layer(ctx, stone ? [G.water, G.ford] : [G.water, G.ford, G.bridge], { edge: [46, 62, 30, 150], rim: [150, 200, 236], sub: G.ford, paint: (wx, wy, w, n, h, f) => {
      if (f > 0.5) {                                                      // ford: wet sand with ripples
        const v = n(wx / 5, wy / 5) * 18 - 9;
        if (h(Math.floor(wx / 4 + Math.sin(wy / 4) * 2), Math.floor(wy / 1.5)) < 0.05) return [120, 160, 196];
        return [182 + v, 156 + v, 104 + v];
      }
      const depth = Math.min(1, (w - 0.5) / 0.3), v = (n(wx / 14 + 30, wy / 14) - 0.5) * 14;
      if (depth > 0.3 && h(Math.floor(wx / 5 + Math.sin(wy / 3)), Math.floor(wy)) < 0.035) return [150, 200, 242];   // glints
      return [92 - depth * 44 + v, 156 - depth * 50 + v, 222 - depth * 34 + v]; } });
    // bridges: wooden planks over water, dark stone causeways over lava
    this.layer(ctx, [G.bridge], { edge: [30, 22, 16, 255], edgeFrom: 0.42, rim: stone ? [70, 60, 60] : [96, 62, 34], paint: (wx, wy, w, n) => {
      const v = (n(wx / 6, wy / 6) - 0.5) * 16;
      if (stone) return (Math.floor(wx / 5) + Math.floor(wy / 4)) % 3 === 0 ? [70, 62, 62] : [110 + v, 100 + v, 98 + v];
      return Math.floor(wx) % 4 === 0 ? [92, 60, 34] : [168 + v, 120 + v, 72 + v]; } });
  }

  // One smooth layer for the cells of `kinds`. opts.paint(wx, wy, w, noise, hash, subField)
  // gives the colour inside; opts.edge is an [r,g,b,a] band just outside the shape
  // (from opts.edgeFrom to 0.5); opts.rim a thin line just inside it; opts.sub a kind
  // whose own field is passed to paint (fords inside a river).
  layer(ctx, kinds, opts) {
    const C = this.C, cols = this.cols, rows = this.rows, S = 2;          // 2 pixels per world pixel
    const main = new Float32Array(cols * rows), sub = new Float32Array(cols * rows);
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const k = this.kind[y * cols + x];
      if (!kinds.includes(k)) continue;
      main[y * cols + x] = 1; if (k === opts.sub) sub[y * cols + x] = 1;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x1 < 0) return;
    // soften the cell staircase: two passes of a small blur
    const blur = a => {
      for (let pass = 0; pass < 2; pass++) {
        const t = new Float32Array(a.length);
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
          t[y * cols + x] = (a[y * cols + Math.max(0, x - 1)] + 2 * a[y * cols + x] + a[y * cols + Math.min(cols - 1, x + 1)]) / 4;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
          a[y * cols + x] = (t[Math.max(0, y - 1) * cols + x] + 2 * t[y * cols + x] + t[Math.min(rows - 1, y + 1) * cols + x]) / 4;
      }
    };
    blur(main); if (opts.sub != null) blur(sub);
    for (let i = 0; i < main.length; i++) if (kinds.includes(this.kind[i])) main[i] = Math.max(main[i], 0.62);   // no cell vanishes
    const at = (a, x, y) => a[Math.max(0, Math.min(rows - 1, y)) * cols + Math.max(0, Math.min(cols - 1, x))];
    const field = (a, wx, wy) => {
      const u = wx / C - 0.5, v = wy / C - 0.5, ix = Math.floor(u), iy = Math.floor(v);
      let tx = u - ix, ty = v - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      return (at(a, ix, iy) * (1 - tx) + at(a, ix + 1, iy) * tx) * (1 - ty) + (at(a, ix, iy + 1) * (1 - tx) + at(a, ix + 1, iy + 1) * tx) * ty;
    };
    const noise = makeNoise(77 + kinds[0]);
    const hash = (x, y) => { const h = Math.imul(Math.floor(x) * 374761393 + Math.floor(y) * 668265263, 1274126177); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
    const px0 = Math.max(0, (x0 - 1) * C), py0 = Math.max(0, (y0 - 1) * C);
    const pw = Math.min(this.W, (x1 + 2) * C) - px0, ph = Math.min(this.H, (y1 + 2) * C) - py0;
    const cv = document.createElement('canvas'); cv.width = pw * S; cv.height = ph * S;
    const c = cv.getContext('2d'), img = c.createImageData(cv.width, cv.height), d = img.data;
    const e0 = opts.edgeFrom != null ? opts.edgeFrom : 0.4;
    // only visit cells the shape can reach (big fields are mostly empty for any one kind)
    for (let cy = Math.floor(py0 / C); cy * C < py0 + ph; cy++) for (let cx = Math.floor(px0 / C); cx * C < px0 + pw; cx++) {
      let m = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) m = Math.max(m, at(main, cx + ox, cy + oy));
      if (m < e0 - 0.12) continue;
      const X0 = (cx * C - px0) * S, Y0 = (cy * C - py0) * S;
      for (let Y = Math.max(0, Y0); Y < Math.min(cv.height, Y0 + C * S); Y++) for (let X = Math.max(0, X0); X < Math.min(cv.width, X0 + C * S); X++) {
        const wx = px0 + X / S, wy = py0 + Y / S;
        const wob = (noise(wx / 9, wy / 9) - 0.5) * 0.22;
        const w = field(main, wx, wy) + wob, i = (Y * cv.width + X) * 4;
        if (w < e0) continue;
        let col, a = 255;
        if (w < 0.5) {
          if (!opts.edge) continue;
          col = opts.edge; a = opts.edge[3] === 255 ? 255 : Math.round(opts.edge[3] * (w - e0) / (0.5 - e0));
        } else if (opts.rim && w < 0.56 && !(opts.sub != null && field(sub, wx, wy) + wob * 0.5 > 0.5)) col = opts.rim;
        else col = opts.paint(wx, wy, w, noise, hash, opts.sub != null ? field(sub, wx, wy) + wob * 0.5 : 0);
        d[i] = Math.max(0, Math.min(255, col[0])); d[i + 1] = Math.max(0, Math.min(255, col[1])); d[i + 2] = Math.max(0, Math.min(255, col[2])); d[i + 3] = a;
      }
    }
    c.putImageData(img, 0, 0);
    ctx.drawImage(cv, px0, py0, pw, ph);
  }

  // The town behind the wall: cobbled streets from each gate to a main street, a
  // plaza with the town's keep, and houses in the region's style drawn 1.5x-1.9x
  // with ground shadows. Kept back from the wall so the defenders' ground stays clear.
  drawTown(ctx) {
    const style = (DATA.regions[this.region] || DATA.regions.free).building;
    const wx = this.wallX, H = this.H, W = this.W, street = wx + 132, mid = H / 2;
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
    const ROAD = { frost: ['#8ea2b8', '#c4d2e0'], ember: ['#4a3e3a', '#6e605a'], sun: ['#c8a468', '#e6cc96'], darkwood: ['#6a5236', '#8a6c48'],
      azure: ['#c8b890', '#efe4c4'], shadow: ['#6a6a7a', '#8e8ea0'], bog: ['#6a5a3a', '#8a7650'] }[this.region] || ['#9a8a6a', '#bcae8c'];
    const cobble = (x, y, w, h) => {
      ctx.fillStyle = 'rgba(30,24,18,0.3)'; rr(x - 1.5, y - 1.5, w + 3, h + 3, 4); ctx.fill();
      ctx.fillStyle = ROAD[0]; rr(x, y, w, h, 3); ctx.fill();
      ctx.fillStyle = ROAD[1];
      for (let yy = y + 1; yy < y + h - 1.5; yy += 3) for (let xx = x + 1 + ((yy - y) % 6 ? 1.5 : 0); xx < x + w - 2; xx += 3) ctx.fillRect(xx, yy, 2, 1.8);
    };
    // streets: in from each gate, then the main street, then the plaza
    for (const g of this.gates || []) cobble(wx + 4, g - 6, street - wx + 2, 12);
    cobble(street - 6, 20, 12, H - 40);
    ctx.save(); ctx.beginPath(); ctx.ellipse(wx + 205, mid + 6, 56, 34, 0, 0, Math.PI * 2); ctx.clip();
    cobble(wx + 145, mid - 30, 120, 74); ctx.restore();
    ctx.strokeStyle = 'rgba(30,24,18,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(wx + 205, mid + 6, 56, 34, 0, 0, Math.PI * 2); ctx.stroke();
    cobble(street, mid - 5, 40, 10);

    // houses: two staggered columns above and below the plaza, the keep in the middle
    const r2 = makeRng(7), spots = [];
    for (let y = 70; y < H - 30; y += 78) {
      if (Math.abs(y - mid) < 70) continue;
      spots.push([wx + 172 + (r2() - 0.5) * 8, y + (r2() - 0.5) * 10, r2() < 0.3 ? 1 : 0, 56]);
      spots.push([wx + 240 + (r2() - 0.5) * 6, y + 34 + (r2() - 0.5) * 10, r2() < 0.3 ? 1 : 0, 56]);
    }
    spots.push([wx + 205, mid + 16, 2, 82]);
    spots.sort((a, b) => a[1] - b[1]);
    for (const [x, y, size, want] of spots) {               // want: drawn width of the building itself
      if (y > H - 4) continue;
      const im = Art.building(style, size), bw = im.box.x1 - im.box.x0 + 1;
      const sc = Math.min(3.2, want / bw), half = bw * sc / 2;
      ctx.fillStyle = 'rgba(20,16,30,0.32)';
      ctx.beginPath(); ctx.ellipse(x + 3, y + 1, half * 0.95, half * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      HD.draw(ctx, im, Math.round(x - 24 * sc), Math.round(y - 38 * sc), 48 * sc, 40 * sc);
    }
  }

  // The town wall as continuous ramparts: rounded stone runs with brick courses and
  // battlements on the attackers' side, round towers flanking each gate and along
  // the wall, a cobbled gateway with open doors, and a soft shadow on the town side.
  // Gameplay still uses the wall cells; this only draws them.
  drawWall(ctx) {
    const C = this.C, col = Math.floor(this.wallX / C), x = col * C, w = C, LIFT = 5;
    const segs = [];
    let start = null;
    for (let y = 0; y <= this.rows; y++) {
      const on = y < this.rows && this.kind[y * this.cols + col] === GROUND.wall;
      if (on && start == null) start = y;
      if (!on && start != null) { segs.push([start * C, y * C]); start = null; }
    }
    const rr = (rx, ry, rw, rh, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(rx, ry, rw, rh, r) : ctx.rect(rx, ry, rw, rh); };
    const OUT = '#2a2630';

    // gateways: cobbles across the gap, worn into the ground
    for (let k = 0; k + 1 < segs.length; k++) {
      const a = segs[k][1], b = segs[k + 1][0];
      ctx.fillStyle = 'rgba(40,32,24,0.35)'; rr(x - 10, a - 1, w + 20, b - a + 2, 4); ctx.fill();
      ctx.fillStyle = '#a8987a'; rr(x - 8, a, w + 16, b - a, 3); ctx.fill();
      for (let yy = a + 1.5; yy < b - 1; yy += 2.5) for (let xx = x - 7 + ((yy * 2) % 2 ? 1.2 : 0); xx < x + w + 7; xx += 2.5) {
        ctx.fillStyle = (xx * 7 + yy * 3) % 5 < 2 ? '#8a7a5e' : '#c0b090'; ctx.fillRect(xx, yy, 1.6, 1.4);
      }
    }

    for (const [y0, y1] of segs) {
      // shadow cast on the town side
      const sh = ctx.createLinearGradient(x + w, 0, x + w + 12, 0);
      sh.addColorStop(0, 'rgba(20,16,30,0.4)'); sh.addColorStop(1, 'rgba(20,16,30,0)');
      ctx.fillStyle = sh; ctx.fillRect(x + w, y0 - 2, 12, y1 - y0 + 4);
      // body: outline, then stone shaded from the lit outer face to the inner face
      ctx.fillStyle = OUT; rr(x - 1.5, y0 - LIFT - 1, w + 3, y1 - y0 + LIFT + 2, 2.5); ctx.fill();
      const body = ctx.createLinearGradient(x, 0, x + w, 0);
      body.addColorStop(0, '#c2becc'); body.addColorStop(0.35, '#a29eae'); body.addColorStop(1, '#787484');
      ctx.fillStyle = body; rr(x - 0.5, y0 - LIFT, w + 1, y1 - y0 + LIFT, 2); ctx.fill();
      // brick courses with staggered joints
      ctx.fillStyle = 'rgba(58,54,72,0.5)';
      for (let yy = y0 - LIFT + 2.5, r = 0; yy < y1 - 0.5; yy += 2.5, r++) {
        ctx.fillRect(x, yy, w, 0.5);
        for (let xx = x + (r % 2 ? 1.5 : 3.5); xx < x + w - 0.5; xx += 4) ctx.fillRect(xx, yy - 2, 0.5, 2);
      }
      // wall-walk along the top, and the shaded foot of the wall
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 2, y0 - LIFT + 1, 2.5, y1 - y0 + LIFT - 2);
      ctx.fillStyle = 'rgba(30,26,40,0.35)'; ctx.fillRect(x - 0.5, y1 - 1.5, w + 1, 1.5);
      // battlements on the outer (attackers') edge
      for (let yy = y0 - LIFT + 1; yy < y1 - 2; yy += 4) {
        ctx.fillStyle = OUT; rr(x - 3, yy - 0.5, 3.5, 3, 0.8); ctx.fill();
        ctx.fillStyle = '#d4d0de'; ctx.fillRect(x - 2.5, yy, 2.5, 1.2);
        ctx.fillStyle = '#9894a6'; ctx.fillRect(x - 2.5, yy + 1.2, 2.5, 1.3);
      }
    }

    // round towers: at both ends of every run (so each gate is flanked) and along long runs
    const tower = (cx, cy) => {
      ctx.fillStyle = 'rgba(20,16,30,0.35)'; ctx.beginPath(); ctx.ellipse(cx + 4, cy + 3, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = OUT; rr(cx - 7.5, cy - 9, 15, 13, 4); ctx.fill();                       // drum
      const g = ctx.createLinearGradient(cx - 7, 0, cx + 7, 0);
      g.addColorStop(0, '#c6c2d0'); g.addColorStop(0.4, '#a6a2b2'); g.addColorStop(1, '#6e6a7a');
      ctx.fillStyle = g; rr(cx - 6.5, cy - 8, 13, 11, 3.5); ctx.fill();
      ctx.fillStyle = 'rgba(58,54,72,0.45)';
      for (let yy = cy - 5; yy < cy + 2; yy += 2.5) ctx.fillRect(cx - 6, yy, 12, 0.5);
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(cx, cy - 9, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill();   // top
      ctx.fillStyle = '#b8b4c4'; ctx.beginPath(); ctx.ellipse(cx, cy - 9, 7, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6a6678'; ctx.beginPath(); ctx.ellipse(cx, cy - 9, 4.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      for (let a = 0; a < 8; a++) {                                                               // crenellations round the rim
        const t = a / 8 * Math.PI * 2, mx = cx + Math.cos(t) * 6.3, my = cy - 9 + Math.sin(t) * 3.1;
        ctx.fillStyle = OUT; rr(mx - 1.3, my - 1.6, 2.6, 2.6, 0.6); ctx.fill();
        ctx.fillStyle = Math.sin(t) < 0 || Math.cos(t) < 0 ? '#dcd8e6' : '#a8a4b4'; ctx.fillRect(mx - 0.8, my - 1.1, 1.6, 1.4);
      }
    };
    const doors = (cx, cy, dir) => {                                     // a wooden door swung open toward the town
      ctx.fillStyle = OUT; rr(cx + 4, cy + dir * 1 - 1.5, 9, 3, 0.8); ctx.fill();
      ctx.fillStyle = '#7a5430'; ctx.fillRect(cx + 4.5, cy + dir * 1 - 1, 8, 2);
      ctx.fillStyle = '#a07040'; ctx.fillRect(cx + 4.5, cy + dir * 1 - 1, 8, 0.6);
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(cx + 7, cy + dir * 1 - 1, 0.5, 2); ctx.fillRect(cx + 10, cy + dir * 1 - 1, 0.5, 2);
    };
    const cx = x + w / 2, spots = [];
    for (let k = 0; k < segs.length; k++) {
      const [y0, y1] = segs[k];
      spots.push(y0 + 3, y1 - 1);
      const n = Math.floor((y1 - y0) / 110);
      for (let i = 1; i <= n; i++) spots.push(Math.round(y0 + (y1 - y0) * i / (n + 1)));
      if (k + 1 < segs.length) { doors(cx, y1 + 1, 1); doors(cx, segs[k + 1][0] - 2, -1); }
    }
    for (const y of spots.sort((a, b) => a - b)) tower(cx, y);
  }
}
const GROUND_NAMES = Object.keys(GROUND);
