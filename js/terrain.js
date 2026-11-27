// =============================================================================
//  BATTLEFIELD TERRAIN: hills, forests, rivers, streams, lakes, swamps, snow,
//  dunes, lava, crystals and town walls.
//  The field is a grid of 8x8 cells. Every cell has a ground kind (how fast units
//  move through it, how much cover it gives) and a height (0 = low ground, about
//  1 = a hilltop). High ground lets shooters reach further (and see further with fog), gives
//  melee the edge downhill and slows anyone climbing; forests hide the units in them.
//  The layout comes from the town's `terrain` (see FIELD_RECIPES) and region, and
//  `walls`, seeded by the town's id so the same town always gives the same field.
// =============================================================================
const GROUND = { grass: 0, forest: 1, water: 2, ford: 3, mud: 4, wall: 5, snow: 6, ice: 7, sand: 8, lava: 9, rock: 10, stream: 11, bridge: 12, gate: 13, cliff: 14, deep: 15 };

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
    this.spotId = spotId;
    const s = DATA.spots[spotId] || {};
    this.W = W; this.H = H; this.C = 8;
    this.cols = Math.ceil(W / this.C); this.rows = Math.ceil(H / this.C);
    this.kind = new Uint8Array(this.cols * this.rows);
    this.cover = new Float32Array(this.cols * this.rows);
    this.height = new Float32Array(this.cols * this.rows);
    this.type = s.terrain || 'plains';
    this.walls = !!s.walls;
    this.site = this.walls ? (DATA.sites[s.site] ? s.site : 'open') : null;   // how the town's ground lets attackers in (DATA.sites)
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
  // ---------------------------------------------------------------- walled towns
  // A walled town is a square of walls (this.town: x0, y0, x1, y1 in pixels) with
  // gates on the sides its site leaves open. Around it is the site's "keep-out" box
  // (this.keep): the walls themselves, or the cliffs / lake that close off the other
  // approaches. Each gate has an approach lane (its channel) running out through the
  // keep-out box to a point A in the open; I is just inside the gate.
  // Inside the walls (not counting the walls themselves or a gateway).
  inTown(x, y) { const t = this.town; return !!t && x > t.x0 + t.wall && x < t.x1 - t.wall && y > t.y0 + t.wall && y < t.y1 - t.wall; }
  inKeep(x, y) { const k = this.keep; return !!k && x > k.x0 && x < k.x1 && y > k.y0 && y < k.y1; }
  // Gate-local coordinates of a point: out = distance outward from the gate's centre, lat = sideways.
  gateLocal(g, x, y) { const dx = x - g.x, dy = y - g.y; return [dx * g.nx + dy * g.ny, -dx * g.ny + dy * g.nx]; }
  gatePoint(g, out, lat) { return [g.x + g.nx * out - g.ny * lat, g.y + g.ny * out + g.nx * lat]; }
  // The gate whose approach lane (from just inside it out to A) holds (x, y), or null.
  channelOf(x, y) {
    if (!this.walls) return null;
    for (const g of this.gates) {
      const [o, l] = this.gateLocal(g, x, y);
      if (Math.abs(l) < g.lane && o > -(this.town.wall / 2 + 30) && o < g.reach + 6) return g;
    }
    return null;
  }
  // Where a unit at (x, y) should head next to reach (tx, ty), or null to walk straight:
  // round the town (and its cliffs or lake) by the corners, out to a gate's approach,
  // through the gate, and out again. Attackers (side 0) use broken gates if there are
  // any, else the nearest gate (to batter it down); defenders can use any of their gates.
  route(x, y, tx, ty, side = 0) {
    if (!this.walls) return null;
    const a = this.inTown(x, y), b = this.inTown(tx, ty);
    if (a && b) return null;
    const pc = this.channelOf(x, y), lane = (g, out) => {
      const [, l] = this.gateLocal(g, x, y);
      return this.gatePoint(g, out, clamp(l, -(g.half - 8), g.half - 8));          // spread across the gateway
    };
    // out of a lane: walk on to its outer end first
    const leave = g => { const [o] = this.gateLocal(g, x, y); return o < g.reach - 4 ? lane(g, g.reach + 4) : null; };
    if (!a && !b) {
      const qc = this.channelOf(tx, ty);
      if (pc && pc === qc) return null;
      if (qc) return pc ? leave(pc) || this.around(x, y, qc.ax, qc.ay) : this.around(x, y, qc.ax, qc.ay) || (this.inKeep(x, y) ? null : [qc.ax, qc.ay]);
      if (pc) return leave(pc) || this.around(x, y, tx, ty);
      return this.around(x, y, tx, ty);
    }
    const open = this.gates.filter(g => g.open), list = side === 0 && open.length ? open : this.gates;
    if (b) {                                                                       // going in
      const g = pc && list.includes(pc) ? pc : list.reduce((p, q) => this.costIn(x, y, q, tx, ty) < this.costIn(x, y, p, tx, ty) ? q : p);
      if (pc === g) return lane(g, -(this.town.wall / 2 + 26));
      if (pc) return leave(pc) || this.around(x, y, g.ax, g.ay);
      return this.around(x, y, g.ax, g.ay) || [g.ax, g.ay];
    }
    // going out
    const g = list.reduce((p, q) => Math.hypot(q.ix - x, q.iy - y) + Math.hypot(q.ax - tx, q.ay - ty) < Math.hypot(p.ix - x, p.iy - y) + Math.hypot(p.ax - tx, p.ay - ty) ? q : p);
    if (pc === g) return lane(g, g.reach + 4);
    const [, l] = this.gateLocal(g, x, y);
    return this.gatePoint(g, -(this.town.wall / 2 + 26), clamp(l, -(g.half - 8), g.half - 8));
  }
  costIn(x, y, g, tx, ty) {
    const r = this.around(x, y, g.ax, g.ay);
    const d = r ? Math.hypot(r[0] - x, r[1] - y) + Math.hypot(g.ax - r[0], g.ay - r[1]) * 1.2 : Math.hypot(g.ax - x, g.ay - y);
    return d + Math.hypot(g.ix - tx, g.iy - ty);
  }
  // Does the segment from (x0, y0) to (x1, y1) pass through the keep-out box?
  crossesKeep(x0, y0, x1, y1) {
    const k = this.keep, dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, x0 - k.x0 - 1], [dx, k.x1 - 1 - x0], [-dy, y0 - k.y0 - 1], [dy, k.y1 - 1 - y0]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return t1 - t0 > 1e-4;
  }
  // The first corner to make for to get round the keep-out box from (x, y) to (tx, ty),
  // or null when the way is clear (or there is no way round inside the field).
  around(x, y, tx, ty) {
    if (!this.keep || this.inKeep(x, y) || !this.crossesKeep(x, y, tx, ty)) return null;
    const k = this.keep, m = 22;
    const cs = [[k.x0 - m, k.y0 - m], [k.x1 + m, k.y0 - m], [k.x1 + m, k.y1 + m], [k.x0 - m, k.y1 + m]]
      .map(c => c[0] > 4 && c[0] < this.W - 4 && c[1] > 14 && c[1] < this.H - 6 ? c : null);
    const len = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
    let best = null, bd = 1e9;
    for (let i = 0; i < 4; i++) {
      const c = cs[i]; if (!c || this.crossesKeep(x, y, c[0], c[1])) continue;
      const d0 = len(x, y, c[0], c[1]);
      if (!this.crossesKeep(c[0], c[1], tx, ty)) { const d = d0 + len(c[0], c[1], tx, ty); if (d < bd) { bd = d; best = c; } continue; }
      for (const j of [(i + 1) % 4, (i + 3) % 4]) {
        const e = cs[j]; if (!e || this.crossesKeep(e[0], e[1], tx, ty)) continue;
        const d = d0 + len(c[0], c[1], e[0], e[1]) + len(e[0], e[1], tx, ty); if (d < bd) { bd = d; best = c; }
      }
    }
    return best;
  }
  gateAt(x, y) {
    if (!this.walls) return null;
    return this.gates.find(g => { if (g.open) return false; const [o, l] = this.gateLocal(g, x, y); return Math.abs(o) < this.town.wall / 2 + 4 && Math.abs(l) < g.half + 2; }) || null;
  }
  // A gate has been battered down: its cells become open ground.
  breakGate(g) {
    g.open = true;
    for (const i of g.cells) this.kind[i] = GROUND.grass;
  }

  // Short description for the HUD and the attack dialog.
  describe() {
    const name = { plains: 'Open plains', forest: 'Forest', river: 'River', swamp: 'Swamp', snow: 'Snowfield',
      dunes: 'Dunes', lava: 'Lava field', crystal: 'Crystal shore' }[this.type] || this.type;
    const extra = this.features.filter(f => !name.toLowerCase().includes(f.split(' ')[0])).slice(0, 2);
    return [name, ...extra].join(', ') + (this.walls ? `, walled town (${DATA.sites[this.site].name.toLowerCase()})` : '');
  }
  // What is under a point, for the battle's ground readout.
  infoAt(x, y) {
    const k = GROUND_NAMES[this.kindAt(x, y)], G = DATA.ground[k], h = this.heightAt(x, y), HB = DATA.battle.hills;
    const parts = [{ grass: 'Open ground', forest: 'Forest - hides troops, cover', water: 'Deep water - slow, poor footing', ford: 'Ford - shallow crossing',
      mud: 'Mud - slow', wall: 'Wall', snow: 'Snowdrift - slow', ice: 'Ice - fast, slippery', sand: 'Sand - slow', lava: 'Lava - impassable',
      rock: 'Rocks - impassable', stream: 'Stream - shallow', bridge: this.site === 'lake' && this.inKeep(x, y) ? 'Causeway - the only way in' : 'Bridge',
      gate: 'Gate - break it down to get in', cliff: 'Cliffs - impassable', deep: 'Deep water - impassable' }[k] || k];
    if (this.inTown(x, y) && k === 'grass') parts[0] = 'Inside the walls - defenders +' + DATA.ground.wall.fortify + ' defence';
    else if (this.channelOf(x, y) && !this.inTown(x, y) && this.site !== 'open') parts[0] = this.site === 'crag' ? 'Ramp - the only way up' : this.site === 'lake' ? parts[0] : 'Approach to the gate';
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
    const x0 = W * (this.walls ? 0.3 + rng() * 0.06 : 0.43 + rng() * 0.14), a1 = 40 + rng() * 60, a2 = 12 + rng() * 22, p1 = rng() * 6, p2 = rng() * 6;
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

    // scattered trees along the top and bottom edges
    for (let x = 40; x < W - 40; x += 70) for (const edge of [0, 1]) if (rng() < 0.55)
      this.blob(x + (rng() - 0.5) * 40, edge ? H - 20 - rng() * 30 : 20 + rng() * 30, 10 + rng() * 14, G.forest, [G.grass, G.snow, G.sand, G.mud]);
    // never block the starting areas: no water, lava or rocks where armies deploy
    const blocks = [G.water, G.lava, G.rock, G.ice];
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const i = y * this.cols + x;
      if ((x * C < 300 || x * C > W - 300) && blocks.includes(this.kind[i])) this.kind[i] = G.grass;
    }
    if (this.walls) this.genTown();
  }

  // A walled town about two-thirds of the way across the field: a square of thick stone
  // walls with round towers, a raised wall-walk inside them (so the defenders' archers
  // shoot from high ground), and gates on the sides its site leaves open:
  //   open: gates on all four sides, roads running out from each;
  //   hill: on the end of a ridge, cliffs on the far side and one flank: two gates;
  //   crag: on a cliff-girt crag, one gate up a narrow ramp;
  //   lake: on a rocky island raised out of a lake, one gate at the end of a causeway.
  // The ground around it is cleared; the site's cliffs or lake form the keep-out box.
  genTown() {
    const C = this.C, W = this.W, H = this.H, G = GROUND, rng = this.rng, cols = this.cols, rows = this.rows;
    const site = this.site, WC = 3, IW = 66, IH = 62;               // wall thickness and the inside, in cells
    const cx = Math.round(W * 0.67 / C), cy = Math.round(H / 2 / C);
    const X0 = cx - IW / 2 - WC, X1 = cx + IW / 2 + WC, Y0 = cy - IH / 2 - WC, Y1 = cy + IH / 2 + WC;   // cells [X0, X1) x [Y0, Y1)
    this.town = { x0: X0 * C, y0: Y0 * C, x1: X1 * C, y1: Y1 * C, wall: WC * C, cx: cx * C, cy: cy * C };
    const flank = (this.spotId || '').length % 2 ? 'n' : 's';     // the hill town's open flank (as the map shows it)
    const sides = { open: ['w', 'n', 's', 'e'], hill: ['w', flank], crag: ['w'], lake: ['w'] }[site];
    const base = { open: 0, hill: 0.55, crag: 0.95, lake: 0.95 }[site];   // the town's ground: an island stands up out of its lake
    // keep-out box in cells: what attackers must go round (cliffs, lake, or just the walls)
    const R = site === 'crag' ? 12 : site === 'lake' ? 14 : 10;
    const K = site === 'crag' ? [X0 - R, Y0 - R, cols, Y1 + R]
      : site === 'lake' ? [X0 - R, Y0 - R, X1 + R, Y1 + R]
      : site === 'hill' ? [X0, flank === 'n' ? Y0 : Y0 - R, cols, flank === 's' ? Y1 : Y1 + R]
      : [X0, Y0, X1, Y1];
    this.keep = { x0: K[0] * C, y0: K[1] * C, x1: K[2] * C, y1: K[3] * C };

    // clear the ground round the town and its site; flatten the land into its base
    const M = 12, inK = (x, y) => x >= K[0] && x < K[2] && y >= K[1] && y < K[3];
    for (let y = Math.max(0, K[1] - M); y < Math.min(rows, K[3] + M); y++) for (let x = Math.max(0, K[0] - M); x < Math.min(cols, K[2] + M); x++) {
      const i = y * cols + x;
      const d = Math.max(K[0] - x, x - K[2] + 1, K[1] - y, y - K[3] + 1, 0);          // cells outside the box
      if (d === 0) { this.kind[i] = G.grass; this.height[i] = site === 'lake' && !(x >= X0 && x < X1 && y >= Y0 && y < Y1) ? 0 : base; continue; }
      if (d < 4 || this.kind[i] === G.rock || this.kind[i] === G.lava) this.kind[i] = G.grass;
      const t = d / M; this.height[i] *= t * t;                                          // level ground at the foot of the site
    }
    // the site: cliffs or deep water fill the box outside the walls
    const fill = site === 'crag' || site === 'hill' ? G.cliff : site === 'lake' ? G.deep : null;
    if (fill != null) for (let y = Math.max(0, K[1]); y < Math.min(rows, K[3]); y++) for (let x = K[0]; x < K[2]; x++)
      if (!(x >= X0 && x < X1 && y >= Y0 && y < Y1)) this.kind[y * cols + x] = fill;
    if (site === 'lake') for (let y = Y0 - 5; y < Y1 + 5; y++) for (let x = X0 - 5; x < X1 + 5; x++) {   // the island's rocky shore, raised with it
      const d = Math.max(X0 - x, x - X1 + 1, Y0 - y, y - Y1 + 1);                          // cells out from the walls
      if (d <= 0 || d > 2 + this.noise(x / 3 + 40, y / 3) * 3) continue;                    // two to five cells, ragged
      const i = y * cols + x; this.kind[i] = G.cliff; this.height[i] = base * (1 - (d - 1) / 6);
    }
    if (site === 'lake') for (let y = K[1] - 2; y < K[3] + 2; y++) for (let x = K[0] - 2; x < K[2] + 2; x++) {   // a shallow rim round the lake
      if (y < 0 || y >= rows || x < 0 || x >= cols || inK(x, y)) continue;
      this.kind[y * cols + x] = G.water;
    }

    // gates, each with its approach lane out through the box
    this.gates = sides.map(side => {
      const v = side === 'w' || side === 'e', jit = Math.round((rng() - 0.5) * 10);
      const nx = side === 'w' ? -1 : side === 'e' ? 1 : 0, ny = side === 'n' ? -1 : side === 's' ? 1 : 0;
      const gx = v ? (side === 'w' ? X0 + WC / 2 : X1 - WC / 2) * C : (cx + jit) * C, gy = v ? (cy + jit) * C : (side === 'n' ? Y0 + WC / 2 : Y1 - WC / 2) * C;
      const edge = side === 'w' ? gx - K[0] * C : side === 'e' ? K[2] * C - gx : side === 'n' ? gy - K[1] * C : K[3] * C - gy;
      const g = { side, x: gx, y: gy, nx, ny, half: 22, lane: site === 'open' || site === 'hill' ? 34 : 30, reach: edge + 26,
        open: false, hp: 1, maxHp: 1, cells: [], hitT: 0 };
      [g.ax, g.ay] = this.gatePoint(g, g.reach, 0);
      [g.ix, g.iy] = this.gatePoint(g, -(WC * C / 2 + 30), 0);
      return g;
    });
    for (const g of this.gates) {                                    // the lane: open ground (a ramp, or a causeway over the lake)
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const [o, l] = this.gateLocal(g, x * C + 4, y * C + 4);
        if (Math.abs(l) >= g.lane || o < WC * C / 2 || o > g.reach - 6) continue;
        const i = y * cols + x;
        if (site === 'lake' && (inK(x, y) || this.kind[i] === G.water)) this.kind[i] = G.bridge;
        else if (inK(x, y)) {
          this.kind[i] = G.grass;
          if (site !== 'lake') this.height[i] = base * clamp(1 - (o - WC * C / 2) / Math.max(1, g.reach - WC * C / 2), 0, 1);   // the ramp down
        }
      }
    }
    // the walls, gates, wall-walk and town ground
    const walk = site === 'crag' || site === 'lake' ? 0.5 : 0.85;   // the wall-walk stands this much above the town
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const i = y * cols + x, d = Math.min(x - X0, X1 - 1 - x, y - Y0, Y1 - 1 - y);   // cells in from the outer face
      const px = x * C + 4, py = y * C + 4;
      const gate = this.gates.find(g => { const [o, l] = this.gateLocal(g, px, py); return Math.abs(l) < g.half && Math.abs(o) < WC * C / 2; });
      if (d < WC) {
        this.kind[i] = gate ? G.gate : G.wall; this.height[i] = base + walk;
        if (gate) gate.cells.push(i);
        continue;
      }
      const k = d - WC;
      this.kind[i] = G.grass;
      this.height[i] = base + (k < 5 ? walk : k < 9 ? walk * (9 - k) / 4 : 0);
      const lane = this.gates.some(g => Math.abs(this.gateLocal(g, px, py)[1]) < g.half + 4);
      if (k < 7 && !lane) this.cover[i] = DATA.ground.wall.behindCover;                 // shelter behind the wall
    }
    // roads out from the gates to the edge of the field (bridging any river on the way)
    this.roads = this.gates.map(g => {
      const pts = [[g.ax, g.ay]];
      let [x, y] = [g.ax, g.ay];
      const far = g.nx ? (g.nx < 0 ? x : W - x) : (g.ny < 0 ? y : H - y);
      const wob = rng() * 6, amp = 10 + rng() * 14;
      for (let s = 20; s <= far + 20; s += 20) {
        const w = Math.sin(s / 90 + wob) * amp * Math.min(1, s / 120);
        pts.push([g.ax + g.nx * s - g.ny * w, g.ay + g.ny * s + g.nx * w]);
      }
      for (const [px, py] of pts) for (let oy = -12; oy <= 12; oy += 8) for (let ox = -12; ox <= 12; ox += 8) {
        const i = this.idx(px + ox, py + oy); if (i < 0) continue;
        const k = this.kind[i];
        if (k === G.forest || k === G.rock || k === G.mud || k === G.snow || k === G.sand || k === G.lava) this.kind[i] = G.grass;
        else if (k === G.water || k === G.ice) this.kind[i] = G.bridge;
      }
      return pts;
    });
    const name = { open: 'open ground', hill: 'ridge end', crag: 'clifftop', lake: 'island' }[site];
    this.features.push(`${name}, ${this.gates.length} gate${this.gates.length > 1 ? 's' : ''}`);
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
      else if (k === GROUND.cliff && rng() < 0.05) rocks.push([px + 4, py + 8]);
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
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = this.kindAt(x, y); solid[y * W + x] = this.inTown(x, y) || k === GROUND.deep || k === GROUND.water || k === GROUND.lava || k === GROUND.ice || k === GROUND.bridge ? 1 : 0; }
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
    // cliffs: broken rock in the region's stone, cracked and lit from the north-west
    const ROCK = { frost: [176, 190, 206], ember: [92, 74, 70], sun: [196, 158, 104], shadow: [104, 102, 120], azure: [150, 160, 170], bog: [104, 100, 80] }[this.region] || [138, 128, 112];
    this.layer(ctx, [G.cliff], { edge: [40, 34, 30, 170], rim: [ROCK[0] * 0.45, ROCK[1] * 0.45, ROCK[2] * 0.45], paint: (wx, wy, w, n, h) => {
      const v = (n(wx / 7, wy / 7) - 0.5) * 40 + (n(wx / 2.5 + 3, wy / 2.5) - 0.5) * 16, crack = Math.abs(n(wx / 11 + 9, wy / 11) - 0.5) < 0.025;
      if (crack) return [ROCK[0] * 0.4, ROCK[1] * 0.4, ROCK[2] * 0.4];
      const lit = n(wx / 5 + 2, wy / 5 + 2) - n(wx / 5 + 2.6, wy / 5 + 2.6);
      return [ROCK[0] + v + lit * 60, ROCK[1] + v + lit * 60, ROCK[2] + v + lit * 55]; } });
    const stone = this.river && this.river.kind === 'lava';
    this.layer(ctx, stone ? [G.lava, G.bridge] : [G.lava], { edge: [42, 26, 20, 255], edgeFrom: 0.3, rim: [120, 40, 20], paint: (wx, wy, w, n) => {
      const f = n(wx / 8, wy / 8) * 0.6 + n(wx / 3 + 7, wy / 3) * 0.4, hot = Math.min(1, (w - 0.5) / 0.3);
      if (f > 0.68 && hot > 0.5) return [255, 220, 90];                  // bright veins
      return [cl(220 + 30 * f), cl(70 + 80 * f * hot), cl(24 + 20 * f)]; } });
    this.layer(ctx, [G.stream], { edge: [46, 62, 30, 110], rim: [170, 210, 236], paint: (wx, wy, w, n, h) => {
      const v = (n(wx / 8 + 3, wy / 8) - 0.5) * 14;
      if (h(Math.floor(wx / 4 + Math.sin(wy / 4) * 2), Math.floor(wy / 1.5)) < 0.05) return [190, 225, 248];
      return [106 + v, 168 + v, 222 + v]; } });
    this.layer(ctx, stone ? [G.water, G.deep, G.ford] : [G.water, G.deep, G.ford, G.bridge], { edge: [46, 62, 30, 150], rim: [150, 200, 236], sub: G.ford, paint: (wx, wy, w, n, h, f) => {
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

  // The town and what lies round it, like a walled market town seen from above: dirt
  // roads running out from the gates, crop fields outside the walls, and inside a
  // wall-walk, cobbled streets from every side to a market square with the town's keep
  // or church, a windmill, a crop field and houses in the region's style.
  // The houses are only drawn: the ground inside stays open for the defenders.
  drawTown(ctx) {
    const T = this.town, style = (DATA.regions[this.region] || DATA.regions.free).building, site = this.site;
    let seed = 11; for (const ch of this.spotId || 'x') seed = seed * 31 + ch.charCodeAt(0);
    const r2 = makeRng(seed);
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
    const DIRT = { frost: ['#7a8ea4', '#a8bacc'], ember: ['#4a3a34', '#6a5850'], sun: ['#b89058', '#d8b47c'], darkwood: ['#5a4430', '#7a6044'],
      azure: ['#b0a078', '#d4c49c'], shadow: ['#5e5a6a', '#7e7a8a'], bog: ['#5a4c30', '#7a6844'] }[this.region] || ['#8a6a44', '#b08c5c'];
    const ROAD = { frost: ['#8ea2b8', '#c4d2e0'], ember: ['#4a3e3a', '#6e605a'], sun: ['#c8a468', '#e6cc96'], darkwood: ['#6a5236', '#8a6c48'],
      azure: ['#c8b890', '#efe4c4'], shadow: ['#6a6a7a', '#8e8ea0'], bog: ['#6a5a3a', '#8a7650'] }[this.region] || ['#9a8a6a', '#bcae8c'];
    const path = pts => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); };
    const road = pts => {
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(30,22,14,0.28)'; ctx.lineWidth = 27; path(pts); ctx.stroke();
      ctx.strokeStyle = DIRT[0]; ctx.lineWidth = 23; path(pts); ctx.stroke();
      ctx.strokeStyle = DIRT[1]; ctx.lineWidth = 15; path(pts); ctx.stroke();
      ctx.setLineDash([5, 7]); ctx.strokeStyle = 'rgba(60,44,28,0.35)'; ctx.lineWidth = 1.5;          // cart ruts
      for (const s of [-4, 4]) { ctx.save(); ctx.translate(s * 0.7, s * 0.7); path(pts); ctx.stroke(); ctx.restore(); }
      ctx.setLineDash([]);
    };
    const cobble = (x, y, w, h) => {
      ctx.fillStyle = 'rgba(30,24,18,0.3)'; rr(x - 1.5, y - 1.5, w + 3, h + 3, 4); ctx.fill();
      ctx.fillStyle = ROAD[0]; rr(x, y, w, h, 3); ctx.fill();
      ctx.fillStyle = ROAD[1];
      for (let yy = y + 1; yy < y + h - 1.5; yy += 3) for (let xx = x + 1 + ((yy - y) % 6 ? 1.5 : 0); xx < x + w - 2; xx += 3) ctx.fillRect(xx, yy, 2, 1.8);
    };
    // a crop field: soil, rows of crops (wheat, greens or furrows), a low fence
    const CROPS = this.region === 'frost' ? [['#c8d4dc', '#a8b8c4']] : this.region === 'sun' ? [['#d8b050', '#b08838'], ['#8a9a40', '#6a7a30']]
      : [['#e0c050', '#c09a30'], ['#78a840', '#5a8a30'], ['#a07848', '#7a5830']];
    const field = (x, y, w, h, rot) => {
      const [c0, c1] = CROPS[Math.floor(r2() * CROPS.length)];
      ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot);
      ctx.fillStyle = 'rgba(30,22,14,0.3)'; rr(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 3); ctx.fill();
      ctx.fillStyle = '#6e5232'; rr(-w / 2, -h / 2, w, h, 2); ctx.fill();
      for (let yy = -h / 2 + 2; yy < h / 2 - 2; yy += 5) { ctx.fillStyle = c0; ctx.fillRect(-w / 2 + 2, yy, w - 4, 3); ctx.fillStyle = c1; ctx.fillRect(-w / 2 + 2, yy + 2.2, w - 4, 0.8); }
      ctx.strokeStyle = '#4a3420'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); rr(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1, 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    };
    const clear = (x, y, w, h) => {
      for (let yy = y; yy <= y + h; yy += 8) for (let xx = x; xx <= x + w; xx += 8) {
        const k = this.kindAt(xx, yy);
        if (!this.passable(xx, yy) || k === GROUND.forest || k === GROUND.water || k === GROUND.bridge || this.inKeep(xx, yy) || this.inTown(xx, yy)) return false;
        if (this.roads.some(pts => pts.some(([px, py]) => Math.abs(px - xx) < 22 && Math.abs(py - yy) < 22))) return false;
      }
      return true;
    };

    // outside: crop fields in the angles between the roads, then the roads
    if (site === 'open' || site === 'hill') for (let n = 0; n < 9; n++) {
      const w = 80 + r2() * 60, h = 50 + r2() * 40;
      const corner = [[T.x0, T.y0, -1, -1], [T.x1, T.y0, 1, -1], [T.x0, T.y1, -1, 1], [T.x1, T.y1, 1, 1]][n % 4];
      const x = corner[0] + corner[2] * (40 + r2() * 120) - (corner[2] < 0 ? w : 0), y = corner[1] + corner[3] * (30 + r2() * 110) - (corner[3] < 0 ? h : 0);
      if (clear(x - 6, y - 6, w + 12, h + 12)) field(x, y, w, h, (r2() - 0.5) * 0.15);
    }
    for (const pts of this.roads) road(pts);

    // inside: the wall-walk round the inside of the walls, streets, the square
    const w = T.wall, ix0 = T.x0 + w, iy0 = T.y0 + w, ix1 = T.x1 - w, iy1 = T.y1 - w, cx = T.cx, cy = T.cy;
    ctx.fillStyle = 'rgba(60,50,40,0.22)'; ctx.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
    ctx.fillStyle = 'rgba(120,140,80,0.5)'; ctx.fillRect(ix0 + 34, iy0 + 34, ix1 - ix0 - 68, iy1 - iy0 - 68);
    ctx.strokeStyle = 'rgba(40,30,20,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(ix0 + 34, iy0 + 34, ix1 - ix0 - 68, iy1 - iy0 - 68);
    const streets = [], street = (x, y, w, h) => { streets.push([x, y, w, h]); cobble(x, y, w, h); };
    for (const side of ['w', 'n', 's', 'e']) {                     // from every gate (or side) in to the square, with a dogleg
      const g = this.gates.find(q => q.side === side);
      const gx = g ? g.x : side === 'w' ? ix0 + 36 : side === 'e' ? ix1 - 36 : cx, gy = g ? g.y : side === 'n' ? iy0 + 36 : side === 's' ? iy1 - 36 : cy;
      if (side === 'w' || side === 'e') {
        const mx = gx + (cx - gx) * 0.5;
        street(Math.min(gx, mx) - 10, gy - 10, Math.abs(mx - gx) + 20, 20);
        street(mx - 10, Math.min(gy, cy) - 10, 20, Math.abs(cy - gy) + 20);
        street(Math.min(mx, cx) - 10, cy - 10, Math.abs(cx - mx) + 20, 20);
      } else {
        const my = gy + (cy - gy) * 0.5;
        street(gx - 10, Math.min(gy, my) - 10, 20, Math.abs(my - gy) + 20);
        street(Math.min(gx, cx) - 10, my - 10, Math.abs(cx - gx) + 20, 20);
        street(cx - 10, Math.min(my, cy) - 10, 20, Math.abs(cy - my) + 20);
      }
    }
    const PW = 160, PH = 112;
    cobble(cx - PW / 2, cy - PH / 2, PW, PH);
    ctx.strokeStyle = 'rgba(30,24,18,0.35)'; ctx.lineWidth = 1.5; rr(cx - PW / 2, cy - PH / 2, PW, PH, 6); ctx.stroke();
    // a well in the square
    ctx.fillStyle = '#2a2630'; ctx.beginPath(); ctx.arc(cx + 34, cy + 22, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a8a4b4'; ctx.beginPath(); ctx.arc(cx + 34, cy + 22, 5.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a6a9a'; ctx.beginPath(); ctx.arc(cx + 34, cy + 22, 3.4, 0, Math.PI * 2); ctx.fill();

    // plots for buildings: a grid over the inside, clear of the walk, the streets and the square
    const nearStreet = (x, y) => streets.some(([sx, sy, sw, sh]) => x > sx - 28 && x < sx + sw + 28 && y > sy - 12 && y < sy + sh + 40);
    const fq = [[ix0 + 76, iy0 + 76], [ix1 - 76 - 120, iy0 + 76], [ix0 + 76, iy1 - 76 - 80], [ix1 - 76 - 120, iy1 - 76 - 80]][Math.floor(r2() * 4)];
    const inField = (x, y) => x > fq[0] - 26 && x < fq[0] + 146 && y > fq[1] - 20 && y < fq[1] + 110;
    field(fq[0], fq[1], 120, 80, 0);
    const spots = [];
    for (let y = iy0 + 84, row = 0; y < iy1 - 56; y += 58, row++) for (let x = ix0 + 86 + (row % 2) * 30; x < ix1 - 70; x += 66) {
      const px = x + (r2() - 0.5) * 10, py = y + (r2() - 0.5) * 8;
      if (Math.abs(px - cx) < PW / 2 + 30 && Math.abs(py - cy) < PH / 2 + 30) continue;
      if (nearStreet(px, py) || inField(px, py)) continue;
      spots.push([px, py, r2() < 0.25 ? 1 : 0, 46 + r2() * 8]);
    }
    spots.push([cx - 30, cy - PH / 2 - 4, 2, 84]);                               // the keep / church at the head of the square
    const mill = [cx + PW / 2 - 22, cy + PH / 2 + 34];                               // the windmill below the square
    spots.sort((a, b) => a[1] - b[1]);
    let n = 0, millDone = false;
    for (const [x, y, size, want] of spots) {
      if (!millDone && y > mill[1]) { this.drawWindmill(ctx, mill[0], mill[1]); millDone = true; }
      const im = Art.building(style, size, size === 2 ? this.spotId || 1 : `${this.spotId}:${n++ % 8}`), bw = im.box.x1 - im.box.x0 + 1;
      const sc = Math.min(3.2, want / bw), half = bw * sc / 2;
      ctx.fillStyle = 'rgba(20,16,30,0.32)';
      ctx.beginPath(); ctx.ellipse(x + 3, y + 1, half * 0.95, half * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      HD.draw(ctx, im, Math.round(x - 24 * sc), Math.round(y - 38 * sc), 48 * sc, 40 * sc);
    }
    if (!millDone) this.drawWindmill(ctx, mill[0], mill[1]);
    // a few trees in the corners of the walk
    const tree = Art.deco(this.trees[0]);
    if (tree && tree.width) for (const [x, y] of [[ix0 + 44, iy0 + 48], [ix1 - 50, iy0 + 52], [ix0 + 46, iy1 - 30], [ix1 - 48, iy1 - 34]])
      if (!this.gates.some(g => Math.hypot(g.ix - x, g.iy - y) < 70)) HD.draw(ctx, tree, Math.round(x - tree.width / 2), Math.round(y - tree.height));
  }

  // A windmill: a round white tower with a thatched cap and four sails.
  drawWindmill(ctx, x, y) {
    const OUT = '#2a2026';
    ctx.fillStyle = 'rgba(20,16,30,0.32)'; ctx.beginPath(); ctx.ellipse(x + 3, y + 1, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = OUT; ctx.beginPath(); ctx.moveTo(x - 10, y + 1); ctx.lineTo(x - 7, y - 26); ctx.lineTo(x + 7, y - 26); ctx.lineTo(x + 10, y + 1); ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(x - 9, 0, x + 9, 0); g.addColorStop(0, '#f4ece0'); g.addColorStop(1, '#b8aca0');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 8.5, y); ctx.lineTo(x - 6, y - 25); ctx.lineTo(x + 6, y - 25); ctx.lineTo(x + 8.5, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a3a24'; ctx.fillRect(x - 2, y - 7, 4, 7);                       // door
    ctx.fillStyle = OUT; ctx.beginPath(); ctx.moveTo(x - 9, y - 24); ctx.lineTo(x, y - 36); ctx.lineTo(x + 9, y - 24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b8743c'; ctx.beginPath(); ctx.moveTo(x - 7.5, y - 25); ctx.lineTo(x, y - 34.5); ctx.lineTo(x + 7.5, y - 25); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(x, y - 25); ctx.rotate(0.35);
    for (let k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = OUT; ctx.fillRect(-1.2, -22, 2.4, 22);
      ctx.fillStyle = '#d8ccb8'; ctx.fillRect(1, -21, 5, 15);
      ctx.fillStyle = 'rgba(90,60,40,0.6)'; for (let s = -19; s < -6; s += 3) ctx.fillRect(1, s, 5, 0.6);
    }
    ctx.fillStyle = '#5a3a24'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // The town walls: four runs of thick stone wall broken by the gates, seen from a little
  // to the south (so each run's top is lifted and the south face shows), with brick
  // courses, battlements on the outer edge, a gateway at every gate and round towers at
  // the corners, beside each gate and along the long runs.
  // Gameplay still uses the wall cells; this only draws them.
  drawWall(ctx) {
    const T = this.town, w = T.wall, LIFT = 10, OUT = '#2a2630';
    const rr = (rx, ry, rw, rh, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(rx, ry, rw, rh, r) : ctx.rect(rx, ry, rw, rh); };
    // each side's runs of wall between its gates: [x, y, width, height, side]
    const runs = [];
    for (const side of ['n', 'w', 'e', 's']) {
      const horiz = side === 'n' || side === 's';
      const a0 = horiz ? T.x0 : T.y0, a1 = horiz ? T.x1 : T.y1;
      const cuts = this.gates.filter(g => g.side === side).map(g => horiz ? [g.x - g.half, g.x + g.half] : [g.y - g.half, g.y + g.half]).sort((p, q) => p[0] - q[0]);
      let s = a0;
      for (const [c0, c1] of cuts.concat([[a1, a1]])) {
        if (c0 > s) {
          if (horiz) runs.push([s, side === 'n' ? T.y0 : T.y1 - w, c0 - s, w, side]);
          else runs.push([side === 'w' ? T.x0 : T.x1 - w, s, w, c0 - s, side]);
        }
        s = c1;
      }
    }
    // gateways: cobbles through the gap, worn into the ground
    for (const g of this.gates) {
      const [o0x, o0y] = this.gatePoint(g, -w / 2 - 8, -g.half), [o1x, o1y] = this.gatePoint(g, w / 2 + 8, g.half);
      const x = Math.min(o0x, o1x), y = Math.min(o0y, o1y), gw = Math.abs(o1x - o0x), gh = Math.abs(o1y - o0y);
      ctx.fillStyle = 'rgba(40,32,24,0.35)'; rr(x - 2, y - 2, gw + 4, gh + 4, 4); ctx.fill();
      ctx.fillStyle = '#a8987a'; rr(x, y, gw, gh, 3); ctx.fill();
      for (let yy = y + 1.5; yy < y + gh - 1; yy += 2.5) for (let xx = x + 1 + ((yy * 2) % 2 ? 1.2 : 0); xx < x + gw - 1; xx += 2.5) {
        ctx.fillStyle = (xx * 7 + yy * 3) % 5 < 2 ? '#8a7a5e' : '#c0b090'; ctx.fillRect(xx, yy, 1.6, 1.4);
      }
    }
    // shadow cast inside the walls
    ctx.fillStyle = 'rgba(20,16,30,0.28)';
    ctx.fillRect(T.x0 + w, T.y0 + w, T.x1 - T.x0 - 2 * w, 10);
    ctx.fillRect(T.x1 - w - 8, T.y0 + w, 8, T.y1 - T.y0 - 2 * w);
    for (const [x, y, rw, rh, side] of runs) {
      ctx.fillStyle = OUT; rr(x - 1.5, y - LIFT - 1.5, rw + 3, rh + LIFT + 3, 2.5); ctx.fill();
      // the top: the wall-walk's flagstones, lit from the north-west
      const top = side === 'n' || side === 's' ? ctx.createLinearGradient(0, y - LIFT, 0, y - LIFT + rh) : ctx.createLinearGradient(x, 0, x + rw, 0);
      top.addColorStop(0, '#cac6d4'); top.addColorStop(1, '#9e9aaa');
      ctx.fillStyle = top; rr(x - 0.5, y - LIFT - 0.5, rw + 1, rh + 1, 2); ctx.fill();
      ctx.fillStyle = 'rgba(70,66,84,0.35)';
      for (let yy = y - LIFT + 3; yy < y - LIFT + rh - 1; yy += 4) for (let xx = x + ((yy | 0) % 8 < 4 ? 1 : 3); xx < x + rw - 1; xx += 5) ctx.fillRect(xx, yy, 0.6, 3);
      // the south face: brick courses with staggered joints
      const fy = y + rh - LIFT;
      ctx.fillStyle = '#7a7686'; ctx.fillRect(x - 0.5, fy, rw + 1, LIFT);
      ctx.fillStyle = 'rgba(48,44,60,0.6)';
      for (let yy = fy + 2.5, r = 0; yy < fy + LIFT; yy += 2.5, r++) {
        ctx.fillRect(x, yy, rw, 0.5);
        for (let xx = x + (r % 2 ? 1.5 : 3.5); xx < x + rw - 0.5; xx += 4) ctx.fillRect(xx, yy - 2, 0.5, 2);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x, fy, rw, 0.8);
      ctx.fillStyle = 'rgba(30,26,40,0.4)'; ctx.fillRect(x - 0.5, y + rh - 1.5, rw + 1, 1.5);   // foot of the wall
      // battlements on the outer edge
      const merlon = (mx, my) => { ctx.fillStyle = OUT; rr(mx - 0.5, my - 0.5, 3.6, 3.6, 0.8); ctx.fill(); ctx.fillStyle = '#dcd8e6'; ctx.fillRect(mx, my, 2.6, 1.3); ctx.fillStyle = '#9894a6'; ctx.fillRect(mx, my + 1.3, 2.6, 1.3); };
      if (side === 'n' || side === 's') for (let xx = x + 1; xx < x + rw - 3; xx += 5) merlon(xx, side === 'n' ? y - LIFT - 1 : fy - 3);
      else for (let yy = y - LIFT + 1; yy < y + rh - LIFT - 3; yy += 5) merlon(side === 'w' ? x - 1 : x + rw - 2.6, yy);
    }

    // round towers: the corners, both sides of every gate, and along the long runs
    const towerAt = (cx, cy) => {
      ctx.fillStyle = 'rgba(20,16,30,0.35)'; ctx.beginPath(); ctx.ellipse(cx + 4, cy + 3, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = OUT; rr(cx - 7.5, cy - 9, 15, 13, 4); ctx.fill();                       // drum
      const g = ctx.createLinearGradient(cx - 7, 0, cx + 7, 0);
      g.addColorStop(0, '#c6c2d0'); g.addColorStop(0.4, '#a6a2b2'); g.addColorStop(1, '#6e6a7a');
      ctx.fillStyle = g; rr(cx - 6.5, cy - 8, 13, 11, 3.5); ctx.fill();
      ctx.fillStyle = 'rgba(58,54,72,0.45)';
      for (let yy = cy - 5; yy < cy + 2; yy += 2.5) ctx.fillRect(cx - 6, yy, 12, 0.5);
      ctx.fillStyle = '#2a2026'; ctx.fillRect(cx - 1, cy - 5, 2, 3);                          // arrow slit
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(cx, cy - 9, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill();   // top
      ctx.fillStyle = '#b8b4c4'; ctx.beginPath(); ctx.ellipse(cx, cy - 9, 7, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6a6678'; ctx.beginPath(); ctx.ellipse(cx, cy - 9, 4.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      for (let a = 0; a < 8; a++) {                                                               // crenellations round the rim
        const t = a / 8 * Math.PI * 2, mx = cx + Math.cos(t) * 6.3, my = cy - 9 + Math.sin(t) * 3.1;
        ctx.fillStyle = OUT; rr(mx - 1.3, my - 1.6, 2.6, 2.6, 0.6); ctx.fill();
        ctx.fillStyle = Math.sin(t) < 0 || Math.cos(t) < 0 ? '#dcd8e6' : '#a8a4b4'; ctx.fillRect(mx - 0.8, my - 1.1, 1.6, 1.4);
      }
    };
    const towers = [[T.x0 + w / 2, T.y0 + w / 2, 2.3], [T.x1 - w / 2, T.y0 + w / 2, 2.3], [T.x0 + w / 2, T.y1 - w / 2, 2.3], [T.x1 - w / 2, T.y1 - w / 2, 2.3]];
    for (const g of this.gates) for (const s of [-1, 1]) { const [tx, ty] = this.gatePoint(g, 0, s * (g.half + 11)); towers.push([tx, ty, 2]); }
    for (const [x, y, rw, rh] of runs) {
      const len = Math.max(rw, rh), n = Math.floor(len / 170);
      for (let i = 1; i <= n; i++) towers.push(rw > rh ? [x + rw * i / (n + 1), y + rh / 2, 1.8] : [x + rw / 2, y + rh * i / (n + 1), 1.8]);
    }
    for (const [tx, ty, s] of towers.sort((a, b) => a[1] - b[1])) { ctx.save(); ctx.translate(tx, ty - LIFT * 0.4); ctx.scale(s, s); towerAt(0, 0); ctx.restore(); }
  }
}
const GROUND_NAMES = Object.keys(GROUND);
