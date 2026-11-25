// =============================================================================
//  HERALDRY: each faction's banner. A banner is a hanging cloth in the faction's
//  colours with a randomly made symbol in the middle, and a glow effect of its own
//  (fire flicker, frost sparkle, ripples...) so every side reads at a glance.
//  Symbols are rolled from a seed: a new campaign gets a new seed (saved with the
//  game), so each war has its own coats of arms.
//    Heraldry.draw(ctx, faction, x, y, tier, time, opts)  x, y: top of the pole
//    Heraldry.icon(faction)                               data URL for the side panel
// =============================================================================
const Heraldry = {
  seed: 7,
  cache: {},

  // cloth, trim, symbol and glow colours, and the glow effect, for each faction
  STYLE: {
    aster:   { cloth: '#1e3f86', trim: '#e8c860', sym: '#f4f8ff', glow: '#5a9cff', fx: 'pulse' },
    frost:   { cloth: '#2c5a78', trim: '#e8f8ff', sym: '#c8f4ff', glow: '#9fe2ff', fx: 'frost' },
    thorn:   { cloth: '#10503f', trim: '#a8d870', sym: '#7dffd0', glow: '#1fd8a8', fx: 'spores' },
    ember:   { cloth: '#6a1410', trim: '#ffb03a', sym: '#ffe070', glow: '#ff5a2a', fx: 'flicker' },
    shadow:  { cloth: '#2a1040', trim: '#c88aff', sym: '#e8c8ff', glow: '#9b4fd6', fx: 'void' },
    horde:   { cloth: '#3a5a16', trim: '#e8d040', sym: '#d8ff7a', glow: '#8ad043', fx: 'throb' },
    azure:   { cloth: '#6a1848', trim: '#7ae8ff', sym: '#ffd0ec', glow: '#ff6ac0', fx: 'ripple' },
    sun:     { cloth: '#8a5410', trim: '#fff0b0', sym: '#fff6c8', glow: '#ffc83a', fx: 'rays' },
    neutral: { cloth: '#56565e', trim: '#8a8a92', sym: '#c8c8cc', glow: null, fx: null },
  },
  style(f) { return this.STYLE[f] || { cloth: darken(DATA.factions[f].color, 0.5), trim: '#e8d8a0', sym: '#ffffff', glow: DATA.factions[f].color, fx: 'pulse' }; },

  // banner sizes by town rank: 1 village, 2 town, 3 capital / city
  SIZE: [null, { w: 11, h: 15, k: 1 }, { w: 13, h: 18, k: 1 }, { w: 18, h: 25, k: 2 }],

  poleLen(tier) { return this.SIZE[tier].h + (tier === 3 ? 9 : 7); },
  setSeed(s) { this.seed = s; this.cache = {}; },
  newSeed() { this.setSeed(1 + Math.floor(Math.random() * 1e9)); return this.seed; },

  // A symmetric 7x7 symbol: random left half mirrored, denser toward the middle.
  symbol(f) {
    const key = 'sym:' + f;
    if (this.cache[key]) return this.cache[key];
    let h = this.seed;
    for (const ch of f) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761);
    const rng = makeRng(h);
    let grid;
    for (let tries = 0; tries < 40; tries++) {
      grid = Array.from({ length: 7 }, () => Array(7).fill(0));
      for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) {
        const centre = 1 - (Math.abs(x - 3) + Math.abs(y - 3)) / 7;
        if (rng() < 0.25 + centre * 0.55) grid[y][x] = grid[y][6 - x] = 1;
      }
      // drop lone pixels so the symbol reads as one shape
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (grid[y][x] &&
        ![[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => (grid[y + dy] || [])[x + dx])) grid[y][x] = 0;
      const n = grid.flat().reduce((a, b) => a + b, 0);
      const spine = grid.reduce((a, r) => a + r[3], 0);
      const rows = grid.filter(r => r.some(Boolean)).length;
      if (n >= 17 && n <= 33 && spine >= 4 && rows >= 6) break;
    }
    return (this.cache[key] = grid);
  },

  // The still banner (cloth + trim + symbol), and a blurred copy of the symbol for its glow.
  sprite(f, tier, mine) {
    const key = `b:${f}:${tier}:${mine ? 1 : 0}`;
    if (this.cache[key]) return this.cache[key];
    const S = this.SIZE[tier], st = this.style(f), sym = this.symbol(f);
    const W = S.w + 2, H = S.h + 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const tail = tier === 3 ? 4 : 3;                       // pointed / forked bottom
    const rowSpan = y => {                                // cloth width inset at row y (0..S.h-1)
      const fromBottom = S.h - 1 - y;
      if (fromBottom >= tail) return null;
      return tail - fromBottom;
    };
    const trim = mine ? '#ffd84a' : st.trim;
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const cut = rowSpan(y), mid = (S.w - 1) / 2, d = Math.abs(x - mid);
      if (cut != null) {
        if (tier === 3 ? d < cut * 1.2 : d > mid - cut * 1.6) continue;   // capitals: swallow tail; others: point
      }
      const edge = x === 0 || x === S.w - 1 || y === 0;
      R(c, x + 1, y + 1, 1, 1, edge ? trim : st.cloth);
    }
    // inner trim line and a top bar
    if (tier >= 2) for (let x = 2; x < S.w - 2; x++) R(c, x + 1, 3, 1, 1, hexA(trim, 0.7));
    // outline: any empty pixel next to cloth
    const img = c.getImageData(0, 0, W, H), d = img.data, filled = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 0;
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (!filled(x, y) && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) out.push([x, y]);
    for (const [x, y] of out) R(c, x, y, 1, 1, '#120a18');
    // the symbol with a dark outline
    const k = S.k, sx = 1 + Math.floor((S.w - 7 * k) / 2), sy = 1 + (tier === 3 ? 4 : tier === 2 ? 5 : 3);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (sym[y][x])
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx > 6 || ny > 6 || !sym[ny][nx]) R(c, sx + (x + ox) * k, sy + (y + oy) * k, k, k, darken(st.cloth, 0.55));
      }
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (sym[y][x]) {
      R(c, sx + x * k, sy + y * k, k, k, st.sym);
      if (k > 1) R(c, sx + x * k, sy + y * k, 1, 1, '#ffffff');
    }
    // glow: blurred symbol in the glow colour, on a padded canvas
    let glow = null;
    if (st.glow) {
      const P = 8;
      const g0 = document.createElement('canvas'); g0.width = W + P * 2; g0.height = H + P * 2;
      const gc = g0.getContext('2d');
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (sym[y][x]) R(gc, P + sx + x * k - 1, P + sy + y * k - 1, k + 2, k + 2, st.glow);
      glow = document.createElement('canvas'); glow.width = g0.width; glow.height = g0.height;
      const g2 = glow.getContext('2d');
      g2.filter = `blur(${tier === 3 ? 3 : 2}px)`;
      g2.drawImage(g0, 0, 0); g2.drawImage(g0, 0, 0);
      glow.pad = P;
    }
    cv.glow = glow; cv.symY = sy + 3.5 * k; cv.symX = sx + 3.5 * k;
    return (this.cache[key] = cv);
  },

  // Soft round halo in the glow colour (drawn additively behind the banner).
  halo(f) {
    const key = 'h:' + f;
    if (this.cache[key]) return this.cache[key];
    const st = this.style(f), cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, hexA(st.glow, 0.9)); g.addColorStop(0.35, hexA(st.glow, 0.35)); g.addColorStop(1, hexA(st.glow, 0));
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    return (this.cache[key] = cv);
  },

  // How bright the glow is right now, per effect.
  level(fx, t, seed) {
    switch (fx) {
      case 'pulse': return 0.55 + 0.35 * Math.sin(t * 2.2 + seed);
      case 'flicker': return 0.6 + 0.25 * Math.sin(t * 13 + seed) * Math.sin(t * 7.3 + seed * 2) + 0.15 * Math.sin(t * 3 + seed);
      case 'throb': { const b = (t * 1.1 + seed) % 1; return 0.4 + 0.6 * (Math.exp(-b * 14) + 0.7 * Math.exp(-Math.max(0, b - 0.18) * 14) * (b > 0.18)); }
      case 'void': return 0.5 + 0.3 * Math.sin(t * 0.9 + seed);
      case 'frost': return 0.55 + 0.2 * Math.sin(t * 3 + seed) + 0.15 * (Math.sin(t * 17 + seed * 3) > 0.92);
      case 'ripple': return 0.6 + 0.2 * Math.sin(t * 2.6 + seed);
      case 'rays': return 0.7 + 0.2 * Math.sin(t * 1.5 + seed);
      case 'spores': return 0.5 + 0.25 * Math.sin(t * 1.7 + seed);
      default: return 0;
    }
  },

  // x, y: top of the pole. lift 0..1 hoists the banner after a capture.
  draw(ctx, f, x, y, tier, t, o = {}) {
    const S = this.SIZE[tier], st = this.style(f), im = this.sprite(f, tier, o.mine);
    const pole = this.poleLen(tier);
    const seed = (x * 0.37 + y * 0.11) % 6.28;
    const lift = o.lift == null ? 1 : o.lift;
    const bx = Math.round(x - im.width / 2), by = Math.round(y + 3 + (1 - lift) * (pole - S.h - 4));
    const lv = st.fx ? this.level(st.fx, t, seed) * (o.dim ? 0.5 : 1) : 0;
    const cx = bx + im.width / 2, cy = by + im.symY;

    // pole, crossbar and finial
    ctx.fillStyle = '#120a18'; ctx.fillRect(x - 1, y - 1, 3, pole + 2);
    ctx.fillStyle = '#7a5a36'; ctx.fillRect(x, y, 1, pole);
    ctx.fillStyle = '#120a18'; ctx.fillRect(bx - 1, by - 1, im.width + 2, 3);
    ctx.fillStyle = o.mine ? '#ffd84a' : '#a88a5a'; ctx.fillRect(bx, by, im.width, 1);
    if (tier === 3 || o.mine) {                                     // crown finial
      ctx.fillStyle = '#120a18'; ctx.fillRect(x - 3, y - 5, 7, 5);
      ctx.fillStyle = o.mine ? '#ffd84a' : '#d8d8e0';
      ctx.fillRect(x - 2, y - 2, 5, 2); ctx.fillRect(x - 2, y - 4, 1, 2); ctx.fillRect(x, y - 4, 1, 2); ctx.fillRect(x + 2, y - 4, 1, 2);
    } else { ctx.fillStyle = '#120a18'; ctx.fillRect(x - 2, y - 3, 5, 4); ctx.fillStyle = '#d8d8e0'; ctx.fillRect(x - 1, y - 2, 3, 2); }

    // effects behind the banner (additive light)
    if (st.fx && lv > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hs = (tier === 3 ? 58 : tier === 2 ? 44 : 36) * (st.fx === 'void' ? 1.2 : 1);
      ctx.globalAlpha = Math.min(1, lv * (st.fx === 'void' ? 0.45 : 0.6));
      ctx.drawImage(this.halo(f), cx - hs / 2, cy - hs / 2, hs, hs);
      ctx.globalAlpha = 1;
      this.behind(ctx, st, cx, cy, tier, t, seed, lv);
      ctx.restore();
    }

    // the banner, swaying: each row shifted a little, more toward the bottom
    for (let r = 0; r < im.height; r++) {
      const off = Math.round(Math.sin(t * 2.4 + seed - r * 0.22) * 1.4 * (r / im.height));
      ctx.drawImage(im, 0, r, im.width, 1, bx + off, by + r, im.width, 1);
    }

    // glowing symbol and front effects
    if (st.fx && im.glow && lv > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.75, lv * 0.6);
      const off = Math.round(Math.sin(t * 2.4 + seed - (im.symY) * 0.22) * 1.4 * (im.symY / im.height));
      ctx.drawImage(im.glow, bx - im.glow.pad + off, by - im.glow.pad);
      ctx.globalAlpha = 1;
      this.front(ctx, st, cx, by, im, tier, t, seed, lv);
      ctx.restore();
    }
  },

  // Effects behind the banner: rotating rays, expanding ripples, a dark aura.
  behind(ctx, st, cx, cy, tier, t, seed, lv) {
    const sc = tier === 3 ? 1.5 : 1;
    if (st.fx === 'rays') {
      ctx.fillStyle = hexA(st.glow, 0.35 * lv);
      for (let i = 0; i < 8; i++) {
        const a = t * 0.6 + seed + i * Math.PI / 4, r0 = 6 * sc, r1 = (15 + 3 * Math.sin(t * 3 + i)) * sc;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a - 0.12) * r0, cy + Math.sin(a - 0.12) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a + 0.12) * r0, cy + Math.sin(a + 0.12) * r0);
        ctx.fill();
      }
    } else if (st.fx === 'ripple') {
      for (let i = 0; i < 2; i++) {
        const k = (t * 0.6 + seed + i * 0.5) % 1;
        ctx.strokeStyle = hexA(st.glow, 0.8 * (1 - k)); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(cx, cy, (4 + k * 14) * sc, (4 + k * 14) * sc * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (st.fx === 'void') {                              // violet wisps circling the banner
      for (let i = 0; i < 3; i++) {
        const a = t * 1.1 + seed + i * 2.1, r = 10 * sc;
        for (let j = 0; j < 4; j++) {
          const b = a - j * 0.18;
          ctx.fillStyle = hexA('#c88aff', (0.7 - j * 0.16) * lv);
          ctx.fillRect(Math.round(cx + Math.cos(b) * r), Math.round(cy + Math.sin(b) * r * 0.7), 1, 1);
        }
      }
    }
  },

  // Effects in front: embers, ice glints, spores, a heartbeat flash.
  front(ctx, st, cx, by, im, tier, t, seed, lv) {
    const w = im.width, h = im.height;
    const dots = (n, fn) => { for (let i = 0; i < n; i++) fn(i, ((t * 0.5 + seed + i / n) % 1)); };
    if (st.fx === 'flicker') dots(4, (i, k) => {               // embers rising from the cloth
      ctx.fillStyle = hexA(i % 2 ? '#ffd040' : '#ff6a2a', 1 - k);
      ctx.fillRect(Math.round(cx - w / 2 + ((i * 7 + seed * 3) % w) + Math.sin(t * 4 + i) * 2), Math.round(by + h * 0.6 - k * (h + 8)), 1, 1);
    });
    else if (st.fx === 'frost') dots(4, (i, k) => {            // twinkling ice glints around the banner
      const tw = Math.max(0, Math.sin(t * 5 + i * 1.7 + seed));
      if (tw < 0.6) return;
      const x = Math.round(cx - w / 2 - 2 + ((i * 11 + seed * 5) % (w + 4))), y = Math.round(by + ((i * 7) % h));
      ctx.fillStyle = hexA('#ffffff', tw);
      ctx.fillRect(x, y - 1, 1, 3); ctx.fillRect(x - 1, y, 3, 1);
    });
    else if (st.fx === 'spores') dots(3, (i, k) => {           // drifting motes
      ctx.fillStyle = hexA(st.glow, Math.sin(k * Math.PI));
      ctx.fillRect(Math.round(cx + Math.sin(t * 1.3 + i * 2 + seed) * (w / 2 + 3)), Math.round(by + h - k * (h + 10)), 1, 1);
    });
    else if (st.fx === 'throb' && lv > 0.9) {                  // the beat flashes the symbol white
      ctx.globalAlpha = (lv - 0.9) * 4;
      ctx.drawImage(im.glow, Math.round(cx - im.glow.width / 2), by - im.glow.pad);
      ctx.globalAlpha = 1;
    } else if (st.fx === 'pulse') {                            // a glint sweeping down the cloth
      const k = (t * 0.35 + seed) % 1.6;
      if (k < 1) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(Math.round(cx - w / 2 + 1), Math.round(by + 1 + k * (h - 4)), w - 2, 1); }
    }
  },

  // Small still picture of the banner for the side panel.
  icon(f) {
    const key = 'i:' + f;
    if (this.cache[key]) return this.cache[key];
    const im = this.sprite(f, 2, false), st = this.style(f);
    const cv = document.createElement('canvas'); cv.width = im.width + 6; cv.height = im.height + 6;
    const c = cv.getContext('2d');
    if (st.glow) { c.globalCompositeOperation = 'lighter'; c.drawImage(this.halo(f), -4, -4, cv.width + 8, cv.height + 8); c.globalCompositeOperation = 'source-over'; }
    c.drawImage(im, 3, 3);
    if (im.glow) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.7; c.drawImage(im.glow, 3 - im.glow.pad, 3 - im.glow.pad); }
    return (this.cache[key] = cv.toDataURL());
  },
};
