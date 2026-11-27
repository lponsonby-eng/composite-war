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
  SIZE: [null, { w: 15, h: 20 }, { w: 17, h: 24 }, { w: 21, h: 30 }],
  N: 11,                                                   // symbols are 11 x 11

  poleLen(tier) { return this.SIZE[tier].h + (tier === 3 ? 9 : 7); },
  setSeed(s) { this.seed = s; this.cache = {}; },
  newSeed() { this.setSeed(1 + Math.floor(Math.random() * 1e9)); return this.seed; },
  rng(f, salt) {
    let h = this.seed + salt * 7919;
    for (const ch of f) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761);
    return makeRng(h);
  },

  // An 11x11 symbol built in layers, mirrored left to right (sometimes top to bottom too):
  // a frame (ring, diamond, shield, cross or corners) in the accent colour, a random core
  // shape, ornaments above and below, then highlights on the upper-left edges.
  // Cells: 0 empty, 1 main, 2 accent, 3 highlight.
  symbol(f) {
    const key = 'sym:' + f;
    if (this.cache[key]) return this.cache[key];
    const N = this.N, C = 5, rng = this.rng(f, 1);
    const blank = () => Array.from({ length: N }, () => Array(N).fill(0));
    const set = (g, x, y, v) => { if (x >= 0 && y >= 0 && x < N && y < N) { g[y][x] = v; g[y][N - 1 - x] = v; } };
    let g;
    for (let tries = 0; tries < 60; tries++) {
      g = blank();
      const vsym = rng() < 0.35;
      // 1. frame
      const frame = ['ring', 'diamond', 'shield', 'cross', 'corners', 'arch'][Math.floor(rng() * 6)];
      for (let y = 0; y < N; y++) for (let x = 0; x <= C; x++) {
        const dx = C - x, dy = y - C, r = Math.hypot(dx, dy);
        let on = false;
        if (frame === 'ring') on = Math.abs(r - 4.6) < 0.5;
        else if (frame === 'diamond') on = dx + Math.abs(dy) === 5;
        else if (frame === 'shield') on = (y === 0 && dx <= 4) || (dx === 4 && y <= 6) || (y > 6 && dx === 10 - y);
        else if (frame === 'cross') on = (dx === 0 && (y <= 1 || y >= N - 2)) || (dx >= 4 && Math.abs(dy) === 0);
        else if (frame === 'corners') on = (dx === 5 && Math.abs(dy) >= 3) || (Math.abs(dy) === 5 && dx >= 3);
        else if (frame === 'arch') on = (y <= 5 && Math.abs(Math.hypot(dx, y - 5) - 5) < 0.5) || (dx === 5 && y > 5);
        if (on) set(g, x, y, 2);
      }
      // 2. core shape in the middle 7x7, denser toward the centre
      const dens = 0.3 + rng() * 0.25;
      for (let y = 2; y <= 8; y++) for (let x = 2; x <= C; x++) {
        if (vsym && y > C) continue;
        const near = 1 - (Math.abs(x - C) + Math.abs(y - C)) / 6;
        if (rng() < dens + near * 0.5) { set(g, x, y, 1); if (vsym) set(g, x, N - 1 - y, 1); }
      }
      // 3. ornaments: a crest above, a point below, studs on the sides
      const top = Math.floor(rng() * 4), bot = Math.floor(rng() * 3);
      if (top === 1) { set(g, C, 1, 1); set(g, C - 1, 2, 1); }                         // spike
      if (top === 2) { set(g, C - 2, 1, 2); set(g, C, 1, 2); set(g, C - 1, 2, 1); }      // crown
      if (top === 3) { set(g, C, 0, 2); set(g, C, 1, 1); }                              // jewel
      if (bot === 1) { set(g, C, 9, 1); set(g, C, 10, 2); }
      if (bot === 2) { set(g, C - 1, 9, 1); set(g, C - 2, 10, 2); }
      if (rng() < 0.5) { set(g, 1, C, 2); set(g, 0, C, 1); }
      // drop lone main pixels
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] === 1 &&
        ![[0, 1], [0, -1], [1, 0], [-1, 0]].some(([ox, oy]) => (g[y + oy] || [])[x + ox])) g[y][x] = 0;
      const core = g.flat().filter(v => v === 1).length, spine = g.reduce((a, r) => a + (r[C] === 1), 0);
      if (core >= 18 && core <= 46 && spine >= 4) break;
    }
    // 4. highlights where the main shape meets empty space above or to the left
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      if (g[y][x] === 1 && (!(g[y - 1] || [])[x] || !g[y][x - 1]) && (x <= C)) g[y][x] = 3;
    return (this.cache[key] = g);
  },

  // A woven pattern for the cloth, also random per faction.
  pattern(f) {
    const key = 'pat:' + f;
    if (this.cache[key]) return this.cache[key];
    const kinds = {
      diamond: (x, y) => (x + y) % 4 === 0 || (x - y + 400) % 4 === 0,
      stripe: x => x % 3 === 0,
      check: (x, y) => (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0,
      chevron: (x, y) => (y + Math.abs(x - 8)) % 4 === 0,
      scale: (x, y) => (y % 3 === 0 && x % 2 === 0) || (y % 3 === 1 && x % 4 === 1),
      dots: (x, y) => x % 3 === 1 && y % 3 === 1,
    };
    const names = Object.keys(kinds);
    return (this.cache[key] = kinds[names[Math.floor(this.rng(f, 2)() * names.length)]]);
  },

  // The still banner, plus its glow layers (blurred symbol, blurred silhouette).
  sprite(f, tier, mine) {
    const key = `b:${f}:${tier}:${mine ? 1 : 0}`;
    if (this.cache[key]) return this.cache[key];
    const S = this.SIZE[tier], st = this.style(f), sym = this.symbol(f), pat = this.pattern(f), N = this.N;
    const W = S.w + 2, H = S.h + 4;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const trim = mine ? '#d0c090' : st.trim, trimLo = darken(trim, 0.35);
    const tail = tier === 3 ? 5 : 4, mid = (S.w - 1) / 2;
    const inCloth = (x, y) => {
      if (x < 0 || y < 0 || x >= S.w || y >= S.h) return false;
      const fb = S.h - 1 - y;
      if (fb >= tail) return true;
      const cut = tail - fb, d = Math.abs(x - mid);
      return tier === 3 ? d >= cut * 1.3 : d <= mid - cut * (mid / tail);   // capitals: forked; others: pointed
    };
    // cloth: shaded top to bottom, woven pattern, double trim
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      if (!inCloth(x, y)) continue;
      const edge = !inCloth(x - 1, y) || !inCloth(x + 1, y) || !inCloth(x, y - 1) || !inCloth(x, y + 1);
      const inner = !edge && (!inCloth(x - 2, y) || !inCloth(x + 2, y) || !inCloth(x, y - 2) || !inCloth(x, y + 2));
      let col;
      if (edge) col = (x + y) % 2 ? trim : trimLo;
      else if (inner) col = darken(st.cloth, 0.35);
      else {
        const shade = y / S.h;
        col = shade < 0.25 ? lighten(st.cloth, 0.12) : shade > 0.75 ? darken(st.cloth, 0.18) : st.cloth;
        if (pat(x, y)) col = lighten(st.cloth, 0.22);
      }
      R(c, x + 1, y + 1, 1, 1, col);
    }
    // top band with studs
    for (let x = 1; x < S.w - 1; x++) R(c, x + 1, 2, 1, 1, x % 3 === 1 ? '#ffffff' : trim);
    for (let x = 1; x < S.w - 1; x++) R(c, x + 1, 3, 1, 1, darken(st.cloth, 0.45));
    // symbol on a roundel, centred
    const sx = 1 + Math.floor((S.w - N) / 2), sy = tier === 3 ? 6 : 5;
    if (tier >= 2) {                                         // a dark roundel behind the symbol
      for (let y = -1; y <= N; y++) for (let x = -1; x <= N; x++) {
        const r = Math.hypot(x - 5, y - 5);
        if (r <= 6.4 && inCloth(sx + x - 1, sy + y - 1)) R(c, sx + x, sy + y, 1, 1, r > 5.6 ? trimLo : darken(st.cloth, 0.3));
      }
    }
    const dark = darken(st.cloth, 0.7);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (sym[y][x])
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || !sym[ny][nx]) R(c, sx + nx, sy + ny, 1, 1, dark);
      }
    const COL = [null, st.sym, trim, '#ffffff'];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (sym[y][x]) R(c, sx + x, sy + y, 1, 1, COL[sym[y][x]]);
    // crisp copy of the symbol (with its outline) drawn again over the glow so the design stays sharp
    const crisp = document.createElement('canvas'); crisp.width = W; crisp.height = H;
    crisp.getContext('2d').drawImage(cv, sx - 1, sy - 1, N + 2, N + 2, sx - 1, sy - 1, N + 2, N + 2);
    // capitals: corner gems and a second band
    if (tier === 3) {
      for (const [x, y] of [[2, 4], [S.w - 3, 4], [2, S.h - tail - 2], [S.w - 3, S.h - tail - 2]]) { R(c, x + 1, y + 1, 1, 1, '#ffffff'); R(c, x + 1, y + 2, 1, 1, st.glow || trim); }
      for (let x = 2; x < S.w - 2; x++) if (inCloth(x, S.h - tail - 3)) R(c, x + 1, S.h - tail - 2, 1, 1, x % 2 ? trim : trimLo);
    }
    // fringe under the cloth
    for (let x = 0; x < S.w; x++) {
      let y = S.h - 1; while (y > 0 && !inCloth(x, y)) y--;
      if (inCloth(x, y) && x % 2 === 0) R(c, x + 1, y + 2, 1, 1 + (x % 4 === 0 ? 1 : 0), trim);
    }
    // outline everything
    const d = c.getImageData(0, 0, W, H).data, filled = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (!filled(x, y) && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) R(c, x, y, 1, 1, '#120a18');

    // glow layers
    let glow = null, rim = null;
    if (st.glow) {
      const P = 10, mk = draw => { const a = document.createElement('canvas'); a.width = W + P * 2; a.height = H + P * 2; draw(a.getContext('2d')); return a; };
      const blur = (src, px, times) => mk(g2 => { g2.filter = `blur(${px}px)`; for (let i = 0; i < times; i++) g2.drawImage(src, 0, 0); });
      const symSrc = mk(gc => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (sym[y][x]) R(gc, P + sx + x, P + sy + y, 1, 1, sym[y][x] === 1 ? st.glow : lighten(st.glow, 0.5)); });
      glow = mk(g2 => { g2.filter = 'blur(3px)'; g2.drawImage(symSrc, 0, 0); g2.drawImage(symSrc, 0, 0); g2.filter = 'blur(1.5px)'; g2.drawImage(symSrc, 0, 0); });
      const sil = mk(gc => { gc.drawImage(cv, P, P); gc.globalCompositeOperation = 'source-in'; gc.fillStyle = st.glow; gc.fillRect(0, 0, W + P * 2, H + P * 2); });
      rim = blur(sil, 3, 3);
      glow.pad = rim.pad = P;
    }
    const hd = HD.up(cv);                                   // 4x detail, drawn at the original size
    Object.assign(hd, { glow, rim, crisp: HD.up(crisp, false), symY: sy + 5, symX: sx + 5, lo: cv });
    return (this.cache[key] = hd);
  },

  // Soft round halo in the glow colour (drawn additively behind the banner).
  halo(f) {
    const key = 'h:' + f;
    if (this.cache[key]) return this.cache[key];
    const st = this.style(f), cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, hexA(st.glow, 1));
    g.addColorStop(0.3, hexA(st.glow, 0.55)); g.addColorStop(0.65, hexA(st.glow, 0.18)); g.addColorStop(1, hexA(st.glow, 0));
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    return (this.cache[key] = cv);
  },

  // How bright the glow is right now, per effect.
  level(fx, t, seed) {
    switch (fx) {
      case 'pulse': return 0.8 + 0.3 * Math.sin(t * 2.2 + seed);
      case 'flicker': return 0.85 + 0.3 * Math.sin(t * 13 + seed) * Math.sin(t * 7.3 + seed * 2) + 0.15 * Math.sin(t * 3 + seed);
      case 'throb': { const b = (t * 1.1 + seed) % 1; return 0.65 + 0.6 * (Math.exp(-b * 14) + 0.7 * Math.exp(-Math.max(0, b - 0.18) * 14) * (b > 0.18)); }
      case 'void': return 0.8 + 0.3 * Math.sin(t * 0.9 + seed);
      case 'frost': return 0.8 + 0.2 * Math.sin(t * 3 + seed) + 0.2 * (Math.sin(t * 17 + seed * 3) > 0.92);
      case 'ripple': return 0.85 + 0.2 * Math.sin(t * 2.6 + seed);
      case 'rays': return 0.95 + 0.2 * Math.sin(t * 1.5 + seed);
      case 'spores': return 0.8 + 0.25 * Math.sin(t * 1.7 + seed);
      default: return 0;
    }
  },

  // x, y: top of the pole. lift 0..1 hoists the banner after a capture.
  draw(ctx, f, x, y, tier, t, o = {}) {
    const S = this.SIZE[tier], st = this.style(f), im = this.sprite(f, tier, o.mine);
    const pole = this.poleLen(tier);
    const seed = ((x * 0.37 + y * 0.11) % 6.28 + 6.28) % 6.28;     // never negative (banners just off the top/left edge), or the effects break
    const lift = o.lift == null ? 1 : o.lift;
    const IW = im.lw, IH = im.lh, R4 = im.res;
    const bx = Math.round(x - IW / 2), by = Math.round(y + 3 + (1 - lift) * (pole - S.h - 4));
    const lv = st.fx ? this.level(st.fx, t, seed) * (o.dim ? 0.5 : 1) : 0;
    const cx = bx + IW / 2, cy = by + im.symY;

    // pole, crossbar and finial
    ctx.fillStyle = '#120a18'; ctx.fillRect(x - 1, y - 1, 3, pole + 2);
    ctx.fillStyle = '#7a5a36'; ctx.fillRect(x, y, 1, pole);
    ctx.fillStyle = '#120a18'; ctx.fillRect(bx - 1, by - 1, IW + 2, 3);
    ctx.fillStyle = o.mine ? '#d0c090' : '#a88a5a'; ctx.fillRect(bx, by, IW, 1);
    if (tier === 3 || o.mine) {                                     // crown finial
      ctx.fillStyle = '#120a18'; ctx.fillRect(x - 3, y - 5, 7, 5);
      ctx.fillStyle = o.mine ? '#d0c090' : '#d8d8e0';
      ctx.fillRect(x - 2, y - 2, 5, 2); ctx.fillRect(x - 2, y - 4, 1, 2); ctx.fillRect(x, y - 4, 1, 2); ctx.fillRect(x + 2, y - 4, 1, 2);
    } else { ctx.fillStyle = '#120a18'; ctx.fillRect(x - 2, y - 3, 5, 4); ctx.fillStyle = '#d8d8e0'; ctx.fillRect(x - 1, y - 2, 3, 2); }

    // effects behind the banner (additive light)
    if (st.fx && lv > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hs = (tier === 3 ? 96 : tier === 2 ? 70 : 56) * (st.fx === 'void' ? 1.2 : 1);
      ctx.globalAlpha = Math.min(1, lv * 0.9);
      ctx.drawImage(this.halo(f), cx - hs / 2, cy - hs / 2, hs, hs);
      ctx.globalAlpha = Math.min(1, lv);                          // glowing edge around the cloth
      ctx.drawImage(im.rim, bx - im.rim.pad, by - im.rim.pad);
      if (tier === 3) { ctx.globalAlpha = Math.min(1, lv * 0.5); ctx.drawImage(im.rim, bx - im.rim.pad, by - im.rim.pad); }
      ctx.globalAlpha = 1;
      this.behind(ctx, st, cx, cy, tier, t, seed, lv);
      ctx.restore();
    }

    // the banner, swaying: each row shifted a little, more toward the bottom
    const prevSmooth = ctx.imageSmoothingEnabled;
    HD.smooth(ctx, R4);
    for (let r = 0; r < IH; r++) {
      const off = Math.round(Math.sin(t * 2.4 + seed - r * 0.22) * 1.4 * (r / IH));
      ctx.drawImage(im, 0, r * R4, im.width, R4, bx + off, by + r, IW, 1);
    }
    ctx.imageSmoothingEnabled = prevSmooth;

    // glowing symbol and front effects
    if (st.fx && im.glow && lv > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, lv * 0.7);
      const off = Math.round(Math.sin(t * 2.4 + seed - (im.symY) * 0.22) * 1.4 * (im.symY / IH));
      ctx.drawImage(im.glow, bx - im.glow.pad + off, by - im.glow.pad);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      for (let r = im.symY - 7; r < im.symY + 7; r++) {                   // sharp symbol on top, swaying with the cloth
        const o2 = Math.round(Math.sin(t * 2.4 + seed - r * 0.22) * 1.4 * (r / IH));
        HD.smooth(ctx, R4);
        ctx.drawImage(im.crisp, 0, r * R4, im.width, R4, bx + o2, by + r, IW, 1);
        ctx.imageSmoothingEnabled = prevSmooth;
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;
      this.front(ctx, st, cx, by, im, tier, t, seed, lv);
      ctx.restore();
    }
  },

  // Effects behind the banner: rotating rays, expanding ripples, a dark aura.
  behind(ctx, st, cx, cy, tier, t, seed, lv) {
    const sc = tier === 3 ? 2 : tier === 2 ? 1.4 : 1.2;
    if (st.fx === 'rays') {
      ctx.fillStyle = hexA(st.glow, Math.min(1, 0.6 * lv));
      for (let i = 0; i < 12; i++) {
        const a = t * 0.6 + seed + i * Math.PI / 6, r0 = 6 * sc, r1 = (15 + 3 * Math.sin(t * 3 + i)) * sc;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a - 0.12) * r0, cy + Math.sin(a - 0.12) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a + 0.12) * r0, cy + Math.sin(a + 0.12) * r0);
        ctx.fill();
      }
    } else if (st.fx === 'ripple') {
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.6 + seed + i / 3) % 1;
        ctx.strokeStyle = hexA(st.glow, Math.min(1, lv * (1 - k))); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(cx, cy, (4 + k * 14) * sc, (4 + k * 14) * sc * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (st.fx === 'void') {                              // violet wisps circling the banner
      for (let i = 0; i < 4; i++) {
        const a = t * 1.1 + seed + i * 1.57, r = 11 * sc;
        for (let j = 0; j < 6; j++) {
          const b = a - j * 0.15;
          ctx.fillStyle = hexA(j ? '#c88aff' : '#ffffff', Math.min(1, (1 - j * 0.15) * lv));
          ctx.fillRect(Math.round(cx + Math.cos(b) * r), Math.round(cy + Math.sin(b) * r * 0.7), 1, 1);
        }
      }
    }
  },

  // Effects in front: embers, ice glints, spores, a heartbeat flash.
  front(ctx, st, cx, by, im, tier, t, seed, lv) {
    const w = im.lw, h = im.lh;
    const dots = (n, fn) => { for (let i = 0; i < n; i++) fn(i, ((t * 0.5 + seed + i / n) % 1)); };
    if (st.fx === 'flicker') dots(8, (i, k) => {               // embers rising from the cloth
      ctx.fillStyle = hexA(i % 2 ? '#ffd040' : '#ff6a2a', 1 - k);
      ctx.fillRect(Math.round(cx - w / 2 + ((i * 7 + seed * 3) % w) + Math.sin(t * 4 + i) * 2), Math.round(by + h * 0.6 - k * (h + 12)), i % 3 ? 1 : 2, i % 3 ? 1 : 2);
    });
    else if (st.fx === 'frost') dots(7, (i, k) => {            // twinkling ice glints around the banner
      const tw = Math.max(0, Math.sin(t * 5 + i * 1.7 + seed));
      if (tw < 0.6) return;
      const x = Math.round(cx - w / 2 - 2 + ((i * 11 + seed * 5) % (w + 4))), y = Math.round(by + ((i * 7) % h));
      ctx.fillStyle = hexA('#ffffff', tw);
      ctx.fillRect(x, y - 1, 1, 3); ctx.fillRect(x - 1, y, 3, 1);
    });
    else if (st.fx === 'spores') dots(6, (i, k) => {           // drifting motes
      ctx.fillStyle = hexA(i % 2 ? '#d8ffe8' : st.glow, Math.sin(k * Math.PI));
      ctx.fillRect(Math.round(cx + Math.sin(t * 1.3 + i * 2 + seed) * (w / 2 + 4)), Math.round(by + h - k * (h + 14)), i % 3 ? 1 : 2, i % 3 ? 1 : 2);
    });
    else if (st.fx === 'throb' && lv > 0.9) {                  // the beat flashes the symbol white
      ctx.globalAlpha = (lv - 0.9) * 4;
      ctx.drawImage(im.glow, Math.round(cx - im.glow.width / 2), by - im.glow.pad);
      ctx.globalAlpha = 1;
    } else if (st.fx === 'pulse') {                            // a glint sweeping down the cloth
      const k = (t * 0.35 + seed) % 1.6;
      if (k < 1) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(Math.round(cx - w / 2 + 1), Math.round(by + 1 + k * (h - 4)), w - 2, 1); }
    }
  },

  // Small still picture of the banner for the side panel.
  icon(f) {
    const key = 'i:' + f;
    if (this.cache[key]) return this.cache[key];
    const im = this.sprite(f, 2, false), st = this.style(f), K = 4;
    const cv = document.createElement('canvas'); cv.width = (im.lw + 6) * K; cv.height = (im.lh + 6) * K;
    const c = cv.getContext('2d');
    c.scale(K, K);
    if (st.glow) { c.globalCompositeOperation = 'lighter'; c.drawImage(this.halo(f), -4, -4, cv.width + 8, cv.height + 8); c.globalCompositeOperation = 'source-over'; }
    c.drawImage(im, 3, 3, im.lw, im.lh);
    if (im.glow) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.9; c.drawImage(im.glow, 3 - im.glow.pad, 3 - im.glow.pad); }
    return (this.cache[key] = cv.toDataURL());
  },
};
