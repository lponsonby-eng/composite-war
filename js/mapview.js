// =============================================================================
//  MAP VIEW: draws the strategy map (terrain, roads, towns, flags, generals).
//  The terrain is generated once from the spot/road layout in data.js, so if you
//  move a town the coastline and forests follow automatically.
// =============================================================================
const MapView = {
  W: 640, H: 360,
  terrain: null,           // offscreen canvas with land, water, roads and trees
  scale: 1, ox: 0, oy: 0,  // world -> screen transform (device pixels)
  time: 0,

  init() {
    this.terrain = this.buildTerrain();
  },

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const W = this.W, H = this.H, CELL = 2;           // chunky 2x2 "pixels"
    const gw = W / CELL, gh = H / CELL;
    const spots = Object.values(DATA.spots);
    const segs = DATA.links.map(([a, b]) => [DATA.spots[a], DATA.spots[b]]);
    const noise = makeNoise(1234);
    const fbm = (x, y) => (noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.1);

    // 1. Which cells are land? Land grows around towns and roads, with a noisy edge.
    const land = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const x = gx * CELL + 1, y = gy * CELL + 1;
      let d = 1e9;
      for (const s of spots) d = Math.min(d, Math.hypot(x - s.x, y - s.y) - 12);
      for (const [a, b] of segs) d = Math.min(d, distToSeg(x, y, a.x, a.y, b.x, b.y));
      const n = fbm(x / 45, y / 45);
      if (d < 38 + (n - 0.5) * 70 || n > 0.68) land[gy * gw + gx] = 1;
    }
    const isLand = (gx, gy) => gx >= 0 && gy >= 0 && gx < gw && gy < gh && land[gy * gw + gx] === 1;
    const nearWater = (gx, gy, r) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!isLand(gx + dx, gy + dy)) return true;
      return false;
    };
    const nearLand = (gx, gy, r) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (isLand(gx + dx, gy + dy)) return true;
      return false;
    };

    // 2. Paint cells
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const rng = makeRng(99);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const x = gx * CELL, y = gy * CELL;
      const n = fbm(x / 30 + 50, y / 30);
      let col;
      if (isLand(gx, gy)) {
        if (nearWater(gx, gy, 1)) col = '#e9d38f';                         // beach
        else if (n > 0.6) col = '#4f9a3a';                                // dark grass
        else if (n < 0.35) col = '#7cc456';                               // light grass
        else col = '#67b04a';                                             // grass
        if (rng() < 0.04) col = '#8fd062';                                // speckles
      } else {
        if (nearLand(gx, gy, 2)) col = '#5fa8dc';                          // shallows
        else if (n > 0.55) col = '#2e5f9f';
        else col = '#3a71b5';
        if (rng() < 0.015) col = '#8cc6ee';                               // wave glints
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, CELL, CELL);
    }

    // 3. Roads (dirt paths)
    const roadPts = [];
    for (const [a, b] of segs) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let i = 0; i <= len; i += 1) {
        const t = i / len;
        // slight wobble so roads look hand drawn
        const wob = Math.sin(t * Math.PI) * Math.sin(t * 9 + a.x) * 3;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        roadPts.push([a.x + (b.x - a.x) * t + nx * wob, a.y + (b.y - a.y) * t + ny * wob]);
      }
    }
    ctx.fillStyle = '#9b7a4a';
    for (const [x, y] of roadPts) ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
    ctx.fillStyle = '#d3b27a';
    for (const [x, y] of roadPts) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);

    // 4. Decorations: forests, rocks, flowers — kept away from towns and roads
    const deco = [];
    const T = Assets.img;
    for (let y = 8; y < H; y += 11) for (let x = 6; x < W; x += 12) {
      const cx = x + (rng() - 0.5) * 8, cy = y + (rng() - 0.5) * 6;
      const gx = Math.floor(cx / CELL), gy = Math.floor(cy / CELL);
      if (!isLand(gx, gy) || !isLand(gx - 6, gy) || !isLand(gx + 6, gy) || nearWater(gx, gy, 3)) continue;
      let ds = 1e9, dr = 1e9;
      for (const s of spots) ds = Math.min(ds, Math.hypot(cx - s.x, cy - s.y + 6));
      for (const [a, b] of segs) dr = Math.min(dr, distToSeg(cx, cy, a.x, a.y, b.x, b.y));
      if (ds < 40 || dr < 12) continue;
      const f = fbm(cx / 55 + 200, cy / 55);
      const kind = fbm(cx / 90 + 400, cy / 90);
      if (f > 0.55) deco.push([kind > 0.5 ? 'tree_pine' : (rng() < 0.08 ? 'tree_pink' : 'tree_round'), cx, cy]);
      else if (f < 0.3 && rng() < 0.35) deco.push(['rock', cx, cy]);
      else if (rng() < 0.07) deco.push([['grass_tuft', 'flower', 'bush'][Math.floor(rng() * 3)], cx, cy]);
    }
    deco.sort((a, b) => a[2] - b[2]);
    for (const [name, x, y] of deco) {
      const im = T['tile:' + name];
      if (im && im.width) ctx.drawImage(im, Math.round(x - im.width / 2), Math.round(y - im.height));
    }
    return cv;
  },

  // ---------------------------------------------------------------- layout
  fit(canvas) {
    const s = Math.min(canvas.width / this.W, canvas.height / this.H);
    this.scale = s >= 2 ? Math.floor(s) : s;          // whole-number zoom keeps pixels crisp
    this.ox = Math.floor((canvas.width - this.W * this.scale) / 2);
    this.oy = Math.floor((canvas.height - this.H * this.scale) / 2);
  },
  toWorld(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; },

  spotAt(wx, wy) {
    let best = null, bd = 26;
    for (const [id, s] of Object.entries(DATA.spots)) {
      const d = Math.hypot(wx - s.x, wy - (s.y - 6));
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  },

  // ---------------------------------------------------------------- render
  // ui = { selected, targets: {spotId: 'move'|'attack'}, hover }
  render(ctx, canvas, game, ui, dt) {
    this.time += dt;
    this.fit(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1d3557';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, 0, 0);

    // highlighted roads from selected spot
    if (ui.selected) {
      const a = DATA.spots[ui.selected];
      for (const [id, kind] of Object.entries(ui.targets)) {
        const b = DATA.spots[id];
        ctx.strokeStyle = kind === 'attack' ? 'rgba(255,80,60,0.9)' : 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.lineDashOffset = -this.time * 12;
        ctx.beginPath(); ctx.moveTo(a.x, a.y - 4); ctx.lineTo(b.x, b.y - 4); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    const order = Object.keys(DATA.spots).sort((p, q) => DATA.spots[p].y - DATA.spots[q].y);
    for (const id of order) this.drawSpot(ctx, id, game, ui);
  },

  drawSpot(ctx, id, game, ui) {
    const s = DATA.spots[id];
    const owner = game.spots[id].owner;
    const color = DATA.factions[owner].color;
    const T = Assets.img;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);

    // selection / target rings
    const ring = (col, r) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, r, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    };
    if (ui.selected === id) ring(`rgba(255,240,120,${0.6 + pulse * 0.4})`, 26);
    else if (ui.targets[id] === 'attack') ring(`rgba(255,70,50,${0.5 + pulse * 0.5})`, 24);
    else if (ui.targets[id] === 'move') ring(`rgba(255,255,255,${0.5 + pulse * 0.5})`, 24);
    else if (ui.hover === id) ring('rgba(255,255,255,0.5)', 24);

    // faction-coloured ground circle
    ctx.fillStyle = color + '66';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, 22, 9, 0, 0, Math.PI * 2); ctx.fill();

    // building
    let im, sc = 1;
    if (s.kind === 'capital') im = T['tile:house_red'];
    else if (s.kind === 'town') im = (s.x + s.y) % 2 ? T['tile:house_thatch'] : T['tile:house_beige'];
    else if (s.kind === 'shrine') im = T['tile:torii'];
    else im = T['tile:hut'];
    if (s.kind !== 'capital') sc = 0.75;
    if (im && im.width) {
      const w = Math.round(im.width * sc), h = Math.round(im.height * sc);
      ctx.drawImage(im, Math.round(s.x - w / 2), Math.round(s.y - h + 4), w, h);
      // flag on a pole
      const fx = Math.round(s.x + w / 2 - 4), fy = Math.round(s.y - h - 2);
      const wave = Math.floor(this.time * 4 + s.x) % 2;
      ctx.fillStyle = '#1a1020';                                  // dark outline so every colour reads on grass
      ctx.fillRect(fx, fy - 1, 10 + wave, 8);
      ctx.fillStyle = '#3b2a1a'; ctx.fillRect(fx, fy, 1, 13);
      ctx.fillStyle = color;
      ctx.fillRect(fx + 1, fy, 8, 4);
      ctx.fillRect(fx + 1, fy + 4, 7 + wave, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(fx + 1, fy + 5, 7 + wave, 1);
    }

    // generals standing in front of the building
    const gens = game.generalsAt(id);
    const shown = gens.slice(0, 4);
    const startX = s.x - (shown.length * 11) / 2;
    shown.forEach((g, i) => {
      const frame = Math.floor(this.time * 3 + i) % 2 === 0 ? 0 : 0;
      Assets.drawUnit(ctx, 'c' + DATA.generals[g.id].face, 0, frame, false, startX + i * 11 - 2, s.y - 6);
      if (g.acted && owner === game.player) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(Math.round(startX + i * 11 - 2), s.y - 6, 16, 16);
      }
    });
    if (gens.length > 4) label(ctx, '+' + (gens.length - 4), s.x + 24, s.y + 6, '#fff', 'left');

    // name label
    label(ctx, s.name, s.x, s.y + 21, owner === game.player ? '#fff6b0' : '#ffffff', 'center', 12);
  },
};

// Pixel text with a dark outline (world coordinates)
function label(ctx, text, x, y, color, align = 'center', size = 8) {
  ctx.font = `${size}px PixelFont`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1a1020';
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(text, Math.round(x) + dx * 0.5, Math.round(y) + dy * 0.5);
  ctx.fillStyle = color;
  ctx.fillText(text, Math.round(x), Math.round(y));
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// Smooth value noise in 0..1
function makeNoise(seed) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
