// =============================================================================
//  PIXELGEN MEDIEVAL: a 32px set in the style of late-medieval battle art
//  (style reference: Danville's "The White Company"): realistic proportions,
//  readable faces and beards, plate and mail with hard highlights, and heraldry
//  on every surcoat, shield, banner and tent. Offline, seeded, no dependencies.
//
//    arms      32 x 36 coat of arms on a heater shield (a faction's arms)
//    soldier   128 x 232 sheet: 32 x 40 frames, cols down/up/left/right,
//              rows 0-3 walk, row 4 attack, then a 32px row of two fallen bodies
//    field     64 x 64 seamless ground: meadow, camp, mud, road
//    decal     blood pools, scorch marks and trampled grass to scatter on ground
//    prop      pavilion tent, palisade, gatehouse, banner, hay bale, campfire
//
//  Heraldry: when a faction is chosen every piece uses that faction's arms (rolled
//  from the faction name), so a whole army wears matching colours. Without a
//  faction, each seed rolls its own arms.
// =============================================================================
(function (root) {
  'use strict';
  const PG = typeof module !== 'undefined' && module.exports ? require('./pixelgen.js') : root.PixelGen;
  const { R, Grid, ramp, mix, pack, band, rampAt, dither, hexRgb, rgbHex, hslToRgb, tileNoise, fbm, pickSkin, HAIR, FACTIONS } = PG;

  const INK = '#1a1210';                                          // outline: warm near-black
  const STEEL = ['#262a34', '#545c6c', '#8a94a6', '#c2cad8', '#f4f8ff'];
  const LEATHER = ['#2a1a12', '#4a2e1e', '#6e4a30', '#946a44', '#b88e62'];
  const WOODR = ['#2e1c10', '#563620', '#7e5530', '#a47a48', '#c8a06a'];
  const BLOOD = ['#3a0a0c', '#5e1014', '#7e1a1a', '#9a2a22'];

  // ---------------------------------------------------------------- heraldry
  const TINCT = {
    argent: '#e8e4dc', or: '#e0b440',                                       // metals
    gules: '#c42a2a', azure: '#2a62b8', vert: '#2e8a3e', sable: '#34302e', purpure: '#7a3a8e', tenne: '#c8642a',
  };
  const METALS = ['argent', 'or'], COLOURS = ['gules', 'azure', 'vert', 'sable', 'purpure', 'tenne'];
  // the nearest heraldic colour to a faction's colour
  function nearestTincture(hex) {
    const [r, g, b] = hexRgb(hex);
    let best = 'gules', bd = 1e9;
    for (const k of COLOURS) { const [R2, G2, B2] = hexRgb(TINCT[k]); const d = (r - R2) ** 2 + (g - G2) ** 2 + (b - B2) ** 2; if (d < bd) { bd = d; best = k; } }
    return best;
  }
  // bold divisions are weighted up: they still read on a 10px surcoat, as in the reference art
  const DIVISIONS = ['plain', 'perPale', 'perPale', 'perFess', 'quarterly', 'quarterly', 'perSaltire', 'perSaltire', 'perBend', 'perChevron', 'paly', 'barry', 'chequy', 'gyronny'];
  const ORDINARIES = ['none', 'none', 'cross', 'saltire', 'pale', 'fess', 'bend', 'chevron', 'chief', 'bordure'];
  const CHARGES = ['none', 'none', 'none', 'roundel', 'mullet', 'crescent', 'lozenge', 'annulet'];

  // Roll a coat of arms. Faction arms are rolled from the faction name, so they
  // stay the same everywhere; `seed` gives one-off arms (captains, mercenaries).
  function rollArms(faction, seed, forceOwn) {
    const own = forceOwn || !FACTIONS[faction];
    const r = R.make(own ? seed : 'arms:' + faction, 'arms');
    const colour = !own ? nearestTincture(FACTIONS[faction].main) : r.pick(COLOURS);
    const metal = r.pick(METALS);
    const second = r.chance(0.3) ? r.pick(COLOURS.filter(c => c !== colour)) : metal;
    const fieldIsMetal = r.chance(0.35);
    const div = r.pick(DIVISIONS);
    // a divided field alternates its two tinctures; ordinaries and charges take the other class (rule of tincture)
    const A = fieldIsMetal ? metal : colour, B = div === 'plain' ? A : (fieldIsMetal ? colour : second === metal ? metal : second);
    const ord = r.pick(ORDINARIES);
    const ordT = (fieldIsMetal || div !== 'plain') && ord !== 'bordure' ? (fieldIsMetal ? colour : metal) : (fieldIsMetal ? colour : metal);
    return { div, A, B: B === A ? (fieldIsMetal ? colour : metal) : B, ord: div === 'chequy' || div === 'gyronny' ? 'none' : ord, ordT: ordT === A && div === 'plain' ? (fieldIsMetal ? colour : metal) : ordT,
      charge: r.pick(CHARGES), chargeT: fieldIsMetal ? colour : metal, n: 4 };
  }
  // Tincture name at (u, v) in 0..1 over the field.
  function blazon(a, u, v) {
    const n = a.n;
    let t;
    switch (a.div) {
      case 'perPale': t = u < 0.5 ? a.A : a.B; break;
      case 'perFess': t = v < 0.45 ? a.A : a.B; break;
      case 'quarterly': t = (u < 0.5) === (v < 0.45) ? a.A : a.B; break;
      case 'perSaltire': t = Math.abs(u - 0.5) > Math.abs(v - 0.45) * 1.1 ? a.B : a.A; break;
      case 'perBend': t = u > v ? a.A : a.B; break;
      case 'perChevron': t = v < 0.95 - Math.abs(u - 0.5) * 1.2 ? a.A : a.B; break;
      case 'paly': t = Math.floor(u * n) % 2 ? a.B : a.A; break;
      case 'barry': t = Math.floor(v * n) % 2 ? a.B : a.A; break;
      case 'chequy': t = (Math.floor(u * 4) + Math.floor(v * 4)) % 2 ? a.B : a.A; break;
      case 'gyronny': { const ang = Math.atan2(v - 0.45, u - 0.5); t = Math.floor((ang + Math.PI) / (Math.PI / 4)) % 2 ? a.B : a.A; break; }
      default: t = a.A;
    }
    const w = 0.11;
    let on = false;
    switch (a.ord) {
      case 'cross': on = Math.abs(u - 0.5) < w || Math.abs(v - 0.42) < w; break;
      case 'saltire': on = Math.abs((u - 0.5) - (v - 0.45)) < w * 1.2 || Math.abs((u - 0.5) + (v - 0.45)) < w * 1.2; break;
      case 'pale': on = Math.abs(u - 0.5) < w * 1.5; break;
      case 'fess': on = Math.abs(v - 0.42) < w * 1.5; break;
      case 'bend': on = Math.abs(u - v) < w * 1.4; break;
      case 'chevron': { const y = 0.75 - Math.abs(u - 0.5) * 1.1; on = v > y - w * 1.6 && v < y + w * 0.4; break; }
      case 'chief': on = v < 0.22; break;
      case 'bordure': on = u < 0.1 || u > 0.9 || v < 0.08 || v > 0.86; break;
    }
    if (on) t = a.ordT;
    return t;
  }
  // Charges are drawn as a small pixel motif in the middle of a large field (shields, banners).
  function drawCharge(g, a, cx, cy, s, shade) {
    if (a.charge === 'none' || a.ord === 'cross' || a.ord === 'saltire') return;
    const C = ramp(TINCT[a.chargeT], 5, 0.5);
    const put = (x, y, k) => g.set(Math.round(cx + x), Math.round(cy + y), C[k]);
    if (a.charge === 'roundel') { for (let y = -s; y <= s; y++) for (let x = -s; x <= s; x++) if (x * x + y * y <= s * s + 0.5) put(x, y, x + y < -s / 2 ? 3 : x + y > s / 2 ? 1 : 2); }
    if (a.charge === 'annulet') { for (let y = -s; y <= s; y++) for (let x = -s; x <= s; x++) { const d = x * x + y * y; if (d <= s * s + 0.5 && d >= (s - 1.2) ** 2) put(x, y, y < 0 ? 3 : 2); } }
    if (a.charge === 'lozenge') { for (let y = -s - 1; y <= s + 1; y++) for (let x = -s; x <= s; x++) if (Math.abs(x) / s + Math.abs(y) / (s + 1) <= 1) put(x, y, x < 0 ? 3 : 2); }
    if (a.charge === 'mullet') {
      for (let y = -s - 1; y <= s + 1; y++) for (let x = -s - 1; x <= s + 1; x++) {
        const ang = Math.atan2(y, x), rr = Math.hypot(x, y), lim = (s + 0.8) * (0.55 + 0.45 * Math.cos(5 * (ang + Math.PI / 2)));
        if (rr <= Math.max(lim, s * 0.45)) put(x, y, x + y < 0 ? 3 : 2);
      }
    }
    if (a.charge === 'crescent') { for (let y = -s; y <= s; y++) for (let x = -s; x <= s; x++) if (x * x + y * y <= s * s + 0.5 && x * x + (y + s * 0.6) ** 2 > (s * 0.8) ** 2) put(x, y, x < 0 ? 3 : 2); }
  }
  const tinctRamp = {};
  const tRamp = t => tinctRamp[t] || (tinctRamp[t] = ramp(TINCT[t], 5, 0.5));

  // ---------------------------------------------------------------- masks and the part painter
  class Mask {
    constructor(w, h) { this.w = w; this.h = h; this.a = new Uint8Array(w * h); }
    has(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.a[y * this.w + x] === 1; }
    add(x, y) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.a[y * this.w + x] = 1; return this; }
    del(x, y) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.a[y * this.w + x] = 0; return this; }
    rect(x0, y0, x1, y1) { for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) this.add(x, y); return this; }
    ellipse(cx, cy, rx, ry) { for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) { const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry; if (dx * dx + dy * dy <= 1) this.add(x, y); } return this; }
    // thick segment from (x0, y0) to (x1, y1), width w
    capsule(x0, y0, x1, y1, w) {
      const r = w / 2, vx = x1 - x0, vy = y1 - y0, L2 = vx * vx + vy * vy || 1;
      for (let y = Math.floor(Math.min(y0, y1) - r - 1); y <= Math.max(y0, y1) + r + 1; y++)
        for (let x = Math.floor(Math.min(x0, x1) - r - 1); x <= Math.max(x0, x1) + r + 1; x++) {
          const px = x + 0.5, py = y + 0.5, t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / L2));
          if (Math.hypot(px - x0 - vx * t, py - y0 - vy * t) <= r) this.add(x, y);
        }
      return this;
    }
    poly(pts) {
      const ys = pts.map(p => p[1]), xs = pts.map(p => p[0]);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y++) for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) {
        let inside = false; const px = x + 0.5, py = y + 0.5;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.add(x, y);
      }
      return this;
    }
    each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.a[y * this.w + x]) fn(x, y); }
  }

  // Paints parts back to front onto a grid. Each part is lit from the top-left: its
  // top/left edges get the lighter step, right/bottom edges the darker one, and
  // `spec` parts (plate, blades) get a white glint on their top-left corners.
  // `sep` draws a dark line where the part overlaps parts painted before it.
  class Painter {
    constructor(w, h) { this.g = new Grid(w, h); this.id = new Int16Array(w * h); this.n = 0; this.w = w; this.h = h; }
    mask() { return new Mask(this.w, this.h); }
    part(m, rampOrFn, o = {}) {
      const pid = ++this.n, base = o.base === undefined ? 2 : o.base;
      if (o.sep) m.each((x, y) => {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy;
          if (!m.has(X, Y) && X >= 0 && Y >= 0 && X < this.w && Y < this.h && this.id[Y * this.w + X] > 0 && (o.sepSides ? o.sepSides(dx, dy) : true)) this.g.set(X, Y, INK);
        }
      });
      m.each((x, y) => {
        const rp = typeof rampOrFn === 'function' ? rampOrFn(x, y) : rampOrFn;
        if (!rp) return;
        const top = !m.has(x, y - 1), left = !m.has(x - 1, y), right = !m.has(x + 1, y), bot = !m.has(x, y + 1);
        let k = base + ((top || left) && !o.flat ? 1 : 0) - ((right || bot) && !o.flat ? 1 : 0) + (o.tex ? o.tex(x, y) : 0) + (o.shade ? o.shade(x, y) : 0);
        if (o.spec && top && left) k = rp.length - 1;
        k = Math.max(0, Math.min(rp.length - 1 - (o.spec ? 0 : 1), k));
        this.g.set(x, y, rp[k]);
        this.id[y * this.w + x] = pid;
      });
      return this;
    }
    px(x, y, c) { this.g.set(x, y, c); if (this.g.in(x, y)) this.id[y * this.w + x] = ++this.n; return this; }
    done() { this.g.outline(INK); return this.g; }
  }
  const mailTex = (x, y) => ((x + y) % 2 ? 1 : -1) * ((x * 3 + y) % 4 === 0 ? 0 : 1) * 0.6 > 0 ? 1 : 0;
  const quiltTex = (x, y) => (y % 3 === 0 ? -1 : 0);

  // ================================================================ ARMS (shield)
  function heaterMask(m, x0, y0, w, h) {
    const cx = x0 + w / 2, flat = h * 0.42;
    for (let y = 0; y < h; y++) {
      let half = w / 2;
      if (y > flat) { const t = (y - flat) / (h - flat); half = (w / 2) * Math.sqrt(Math.max(0, 1 - t * t)); }
      for (let x = Math.round(cx - half); x < Math.round(cx + half); x++) m.add(x, y0 + y);
    }
    return m;
  }
  function genArms(o) {
    const a = rollArms(o.faction, o.seed, o.own === 'yes');
    const P = new Painter(32, 36);
    const m = heaterMask(P.mask(), 3, 2, 26, 32);
    const fieldFn = (x, y) => tRamp(blazon(a, (x - 3) / 26, (y - 2) / 32));
    // the field is lit softly from the upper left (a slightly curved shield)
    P.part(m, fieldFn, { flat: true, base: 2, shade: (x, y) => (x < 10 && y < 14 ? 1 : 0) - (x > 23 || y > 27 ? 1 : 0) });
    drawCharge(P.g, a, 16, 14, 4);
    // rim
    const rim = P.mask();
    m.each((x, y) => { if (!m.has(x - 1, y) || !m.has(x + 1, y) || !m.has(x, y - 1) || !m.has(x, y + 1)) rim.add(x, y); });
    rim.each((x, y) => P.g.set(x, y, x < 16 && y < 20 ? STEEL[3] : STEEL[1]));
    P.g.set(5, 3, STEEL[4]); P.g.set(6, 3, STEEL[4]);
    const img = P.done();
    return { img, anim: { fw: 32, fh: 36, fps: 1, tracks: [[{ x: 0, y: 0 }]] }, name: `arms-${a.div}-${a.ord}`, arms: a };
  }

  // ================================================================ SOLDIER
  const TROOPS = {
    knight:    { helms: ['greathelm', 'bascinet', 'bascinet', 'sallet'], body: 'plate', shield: 1, weapons: ['sword', 'sword', 'mace', 'axe'] },
    manatarms: { helms: ['bascinet', 'sallet', 'kettle', 'coif'], body: 'plateMail', shield: 0.5, weapons: ['poleaxe', 'halberd', 'sword', 'axe'] },
    captain:   { helms: ['none'], body: 'plate', shield: 1, weapons: ['sword'], own: true },
    spearman:  { helms: ['kettle', 'coif', 'kettle', 'hood'], body: 'gambeson', shield: 0.8, weapons: ['spear'] },
    archer:    { helms: ['kettle', 'hood', 'none', 'coif'], body: 'jack', shield: 0, weapons: ['longbow'] },
    crossbow:  { helms: ['kettle', 'sallet'], body: 'mailTabard', shield: 0, weapons: ['crossbow'] },
    levy:      { helms: ['hood', 'none', 'cap', 'none'], body: 'tunic', shield: 0.2, weapons: ['bill', 'spear', 'axe'] },
  };
  const DRAB = ['#7a6a4a', '#5a6a3a', '#8a5a3a', '#6a5a6a', '#5a5048', '#8a7a5a', '#4a5a6a'];
  function soldierGenome(o) {
    const r = R.make(o.seed, 'soldier');
    const type = TROOPS[o.troop] ? o.troop : r.pick(Object.keys(TROOPS));
    const T = TROOPS[type];
    const arms = rollArms(o.faction, o.seed, T.own && r.chance(0.5) ? true : !FACTIONS[o.faction]);
    if (type === 'captain' && r.chance(0.5)) Object.assign(arms, { div: 'plain', A: 'argent', ord: 'cross', ordT: 'gules', charge: 'none' });
    const liv = tRamp(arms.A === 'argent' || arms.A === 'or' ? arms.B : arms.A);
    const livMetal = tRamp(METALS.includes(arms.A) ? arms.A : METALS.includes(arms.B) ? arms.B : 'argent');
    const G = {
      type, arms, liv, livMetal,
      helm: o.helm && o.helm !== 'random' ? o.helm : r.pick(T.helms),
      body: T.body,
      shield: r.chance(T.shield),
      weapon: o.weapon && o.weapon !== 'random' ? o.weapon : r.pick(T.weapons),
      skin: ramp(r.pick(PG.SKIN.slice(0, 6)), 5, 0.45),                 // human skin tones only
      hair: null,
      hairStyle: r.pick(['short', 'long', 'long', 'bald', 'short']),
      beard: r.pick(['none', 'full', 'full', 'moustache', 'stubble', 'none']),
      drab: ramp(r.pick(DRAB), 5, 0.5), hose: ramp(r.pick(['#4a3a30', '#3a3a4a', '#5a4030', '#6a2a2a', '#2a3a2a']), 5, 0.45),
      plume: r.chance(0.3),
    };
    // hair must stand apart from the skin (a blond beard on pale skin reads as a blob)
    const skinL = PG.rgbToHsl(...hexRgb(G.skin[2]))[2];
    const hairs = ['#2a1c14', '#3a2418', '#5a3418', '#6a4020', '#8a5a28', '#a83020', '#c89038', '#e8e4dc', '#8a7a6a', '#181820'];
    const ok = hairs.filter(h => Math.abs(PG.rgbToHsl(...hexRgb(h))[2] - skinL) > 0.22);
    G.hair = ramp(r.pick(ok.length ? ok : hairs), 5, 0.5);
    return G;
  }
  // Weapon pieces in local coordinates: t runs along the weapon from the hand, s across it.
  function weaponParts(kind) {
    const W = { mat: WOODR, w: 1.3 }, M = { mat: STEEL, w: 1.6, spec: true }, L = { mat: LEATHER, w: 1.3 };
    switch (kind) {
      case 'sword': return [{ ...L, t: [-2, 0.5] }, { ...M, t: [-3, -2.4], w: 1.8, mat: STEEL }, { ...M, guard: [-3, 3], t: [1.2, 1.2], w: 1.3 }, { ...M, t: [2, 12.5], w: 1.7 }, { ...M, t: [12.5, 13.6], w: 0.9 }];
      case 'mace': return [{ ...W, t: [-2, 8] }, { ...M, ball: 2.2, t: [9.5, 9.5] }];
      case 'axe': return [{ ...W, t: [-2, 10] }, { ...M, blade: [[7, 0], [11, 0], [12, 4], [10, 4.5], [7.5, 2.5]] }];
      case 'spear': return [{ ...W, t: [-13, 16], w: 1.2 }, { ...M, blade: [[15.5, -1.4], [19.5, 0], [15.5, 1.4], [15, 0]] }];
      case 'halberd': return [{ ...W, t: [-13, 16], w: 1.2 }, { ...M, blade: [[10, 0], [14, 0], [14.5, 4], [11, 3.5]] }, { ...M, t: [16, 19.5], w: 1.1 }, { ...M, blade: [[12, 0], [12.5, -2.5], [13.5, 0]] }];
      case 'poleaxe': return [{ ...W, t: [-11, 15], w: 1.2 }, { ...M, blade: [[12, 0], [15, 0], [15, 3.2], [12, 3]] }, { ...M, t: [12.5, 14.5], w: 2.6, mat: STEEL, s: -1.4 }, { ...M, t: [15, 18], w: 1 }];
      case 'bill': return [{ ...W, t: [-13, 14], w: 1.2 }, { ...M, blade: [[13, -0.5], [19, 0.5], [17.5, 2.5], [16, 1.5], [13.5, 1.5]] }];
      case 'crossbow': return [{ ...W, t: [-3, 7], w: 1.8 }, { ...M, guard: [-4.5, 4.5], t: [6, 6], w: 1.2 }];
      default: return [];
    }
  }
  function drawWeapon(P, kind, hx, hy, deg, o = {}) {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const X = (t, s) => hx + t * ca - s * sa, Y = (t, s) => hy + t * sa + s * ca;
    if (kind === 'longbow') {
      const m = P.mask(), str = P.mask(), pull = o.draw ? -3.5 : 0, flip = o.flip ? -1 : 1;
      for (let t = -10; t <= 10; t += 0.25) { const s = flip * 2.6 * (1 - (t / 10) ** 2); m.add(X(t, s), Y(t, s)); }
      for (let t = -9.5; t <= 9.5; t += 0.3) { const s = flip * pull * (1 - Math.abs(t) / 9.5); str.add(X(t, s), Y(t, s)); }
      P.part(m, WOODR, { base: 2 });
      str.each((x, y) => { if (!P.g.filled(x, y)) P.g.set(x, y, '#d8d0b8'); });
      if (o.draw) { const am = P.mask().capsule(X(0, flip * pull), Y(0, flip * pull), X(0, flip * 4.5), Y(0, flip * 4.5), 1); P.part(am, WOODR, { base: 3 }); P.g.set(Math.round(X(0, flip * 5)), Math.round(Y(0, flip * 5)), STEEL[3]); }
      return;
    }
    for (const p of weaponParts(kind)) {
      const m = P.mask();
      if (p.blade) m.poly(p.blade.map(([t, s]) => [X(t, s), Y(t, s)]));
      else if (p.ball) m.ellipse(X(p.t[0], 0), Y(p.t[0], 0), p.ball, p.ball);
      else if (p.guard) m.capsule(X(p.t[0], p.guard[0]), Y(p.t[0], p.guard[0]), X(p.t[0], p.guard[1]), Y(p.t[0], p.guard[1]), p.w);
      else m.capsule(X(p.t[0], p.s || 0), Y(p.t[0], p.s || 0), X(p.t[1], p.s || 0), Y(p.t[1], p.s || 0), p.w);
      P.part(m, p.mat, { spec: p.spec, sep: !!o.sep, base: p.mat === STEEL ? 2 : 2 });
    }
  }

  // One 32 x 40 frame. dir: 0 front, 1 back, 2 side (facing left). pose: walk (step 0-3) or attack.
  function soldierFrame(g, dir, pose, step) {
    const P = new Painter(32, 40);
    const atk = pose === 'attack';
    const b = pose === 'walk' && step % 2 === 1 ? -1 : 0;
    const plateBody = g.body === 'plate' || g.body === 'plateMail';
    const legRamp = plateBody ? STEEL : g.body === 'tunic' ? g.drab : g.hose;
    const armRamp = g.body === 'plate' ? STEEL : g.body === 'plateMail' || g.body === 'mailTabard' ? STEEL : g.body === 'tunic' ? g.drab : g.liv;
    const armOpts = g.body === 'plateMail' || g.body === 'mailTabard' ? { tex: mailTex, base: 1 } : g.body === 'plate' ? { spec: true } : g.body === 'tunic' ? {} : { tex: quiltTex };
    const footRamp = plateBody ? STEEL : LEATHER;
    const heraldFn = (x0, y0, w, h) => (x, y) => tRamp(blazon(g.arms, (x - x0) / w, (y - y0) / h));
    const torsoFn = g.body === 'plate' || g.body === 'plateMail' || g.body === 'mailTabard' ? heraldFn(11, 15 + b, 10, 15)
      : g.body === 'tunic' ? () => g.drab : () => g.liv;
    const torsoOpts = g.body === 'gambeson' || g.body === 'jack' ? { tex: quiltTex } : {};

    if (dir === 2) return sideFrame(g, P, pose, step, b, { legRamp, armRamp, armOpts, footRamp, torsoFn, torsoOpts });

    // ---------------- front / back
    const back = dir === 1;
    const lift = pose === 'walk' ? [0, 1, 0, 2][step] : 0;           // 1: left leg up, 2: right leg up
    const swing = pose === 'walk' ? [0, 1, 0, -1][step] : 0;
    // legs
    const legL = P.mask().rect(12, 27 + b, 14, 35 - (lift === 1 ? 1 : 0)), legR = P.mask().rect(17, 27 + b, 19, 35 - (lift === 2 ? 1 : 0));
    P.part(legL, legRamp, plateBody ? { spec: true } : {}); P.part(legR, legRamp, plateBody ? { spec: true } : {});
    P.part(P.mask().rect(11, 36 - (lift === 1 ? 1 : 0), 14, 37 - (lift === 1 ? 1 : 0)), footRamp, { base: 1 });
    P.part(P.mask().rect(17, 36 - (lift === 2 ? 1 : 0), 20, 37 - (lift === 2 ? 1 : 0)), footRamp, { base: 1 });
    if (plateBody) { P.g.set(13, 31 + b, STEEL[4]); P.g.set(18, 31 + b, STEEL[4]); }                // knee cops
    // torso + skirt (surcoat / tabard / gambeson / tunic)
    const torso = P.mask().poly([[11, 15 + b], [21, 15 + b], [20.5, 26 + b], [11.5, 26 + b]]);
    const skirt = P.mask().poly([[11.5, 25 + b], [20.5, 25 + b], [21.5, 30 + b], [10.5, 30 + b]]);
    if (g.body === 'plate' && !back) {
      P.part(torso, STEEL, { spec: true });                                                           // breastplate under the surcoat
      const surcoat = P.mask().poly([[12, 17 + b], [20, 17 + b], [20.5, 26 + b], [11.5, 26 + b]]);
      P.part(surcoat, torsoFn, { flat: false }); P.part(skirt, torsoFn, { sep: true, sepSides: (dx, dy) => dy < 0 });
    } else {
      P.part(torso, torsoFn, torsoOpts); P.part(skirt, torsoFn, Object.assign({ sep: true, sepSides: (dx, dy) => dy < 0 }, torsoOpts));
    }
    if (g.body === 'tunic' || g.body === 'jack' || g.body === 'gambeson') P.part(P.mask().rect(12, 25 + b, 20, 25 + b), LEATHER, { flat: true, base: 1 });   // belt
    // arms
    const armAtk = atk && !back;
    const lArm = P.mask().capsule(10.5, 17 + b, 10 - swing * 0.6, 24 + b, 3.2);
    const rArm = armAtk ? P.mask().capsule(21.5, 17 + b, 24.5, 10 + b, 3.2) : P.mask().capsule(21.5, 17 + b, 22 + swing * 0.6, 24 + b, 3.2);
    P.part(lArm, armRamp, Object.assign({ sep: true }, armOpts)); P.part(rArm, armRamp, Object.assign({ sep: true }, armOpts));
    if (plateBody) { P.part(P.mask().ellipse(10.5, 16.5 + b, 2.6, 2.1), STEEL, { spec: true, sep: true }); P.part(P.mask().ellipse(21.5, 16.5 + b, 2.6, 2.1), STEEL, { spec: true, sep: true }); }
    const handRamp = plateBody ? STEEL : g.skin;
    const lh = [10 - swing * 0.6, 25.5 + b], rh = armAtk ? [24.8, 9 + b] : [22 + swing * 0.6, 25.5 + b];
    P.part(P.mask().ellipse(lh[0], lh[1], 1.5, 1.4), handRamp, { sep: true });
    // head
    headFront(g, P, b, back);
    // shield (viewer's left) and weapon (viewer's right)
    if (g.shield) {
      const sm = heaterMask(P.mask(), 4, 18 + b, 10, 14);
      P.part(sm, heraldFn(4, 18 + b, 10, 14), { sep: true, base: 2 });
      sm.each((x, y) => { if (!sm.has(x - 1, y) || !sm.has(x + 1, y) || !sm.has(x, y - 1)) P.g.set(x, y, x < 8 ? STEEL[3] : STEEL[1]); });
      P.g.set(5, 18 + b, STEEL[4]);
    }
    if (g.weapon === 'longbow') drawWeapon(P, 'longbow', rh[0] + 1.5, rh[1] - (armAtk ? -6 : 3), -90, { draw: armAtk, sep: true });
    else if (g.weapon === 'crossbow') drawWeapon(P, 'crossbow', rh[0] - 3, rh[1] - 1, armAtk ? -100 : -20, { sep: true });
    else {
      const long = ['spear', 'halberd', 'poleaxe', 'bill'].includes(g.weapon);
      const deg = armAtk ? (long ? -60 : -150) : long ? -86 : -62;
      drawWeapon(P, g.weapon, rh[0], rh[1], deg, { sep: true });
    }
    P.part(P.mask().ellipse(rh[0], rh[1], 1.5, 1.4), handRamp, { sep: false });
    const img = P.done();
    return back ? img.flipX() : img;
  }

  function headFront(g, P, b, back) {
    const S = g.skin, H = g.hair, cx = 16, cy = 9 + b;
    P.part(P.mask().rect(14, 13 + b, 18, 15 + b), S, { base: 1 });                                      // neck
    const head = P.mask().ellipse(cx, cy, 4.6, 5.1);
    P.part(head, S, { shade: (x, y) => (x >= 19 ? -1 : 0) });
    const helmed = g.helm !== 'none' && g.helm !== 'hood' && g.helm !== 'cap';
    // hair
    if (g.hairStyle !== 'bald' || back) {
      const hair = P.mask();
      head.each((x, y) => { if (back ? y <= cy + 3 : (y <= cy - 2 || ((x <= 12 || x >= 20) && y <= cy + (g.hairStyle === 'long' ? 5 : 1)))) hair.add(x, y); });
      if (g.hairStyle === 'long') { hair.rect(11, cy - 1, 12, cy + 6); hair.rect(20, cy - 1, 21, cy + 6); if (back) hair.rect(12, cy + 3, 20, cy + 6); }
      if (g.hairStyle !== 'bald') P.part(hair, H, { tex: (x, y) => ((x * 5 + y * 3) % 7 === 0 ? 1 : 0) });
    }
    if (!back) {
      // face: brows, eyes, nose, mouth
      P.g.set(13, cy - 1, H[1]).set(14, cy - 1, H[1]).set(18, cy - 1, H[1]).set(19, cy - 1, H[1]);
      P.g.set(14, cy, '#2a1a14').set(18, cy, '#2a1a14').set(13, cy, S[3]).set(19, cy, S[2]);
      P.g.set(16, cy + 1, S[1]).set(16, cy + 2, S[1]).set(17, cy + 2, S[0]);
      P.g.set(15, cy + 3, mix(S[1], '#8a2a2a', 0.4)).set(16, cy + 3, mix(S[1], '#8a2a2a', 0.4)).set(17, cy + 3, mix(S[1], '#8a2a2a', 0.4));
      if (g.beard === 'full' || g.beard === 'moustache') {
        const bm = P.mask();
        if (g.beard === 'full') { head.each((x, y) => { if (y >= cy + 3 || (y === cy + 2 && (x <= 13 || x >= 19))) bm.add(x, y); }); bm.rect(13, cy + 5, 19, cy + 6); bm.del(15, cy + 3).del(16, cy + 3).del(17, cy + 3); }
        bm.rect(14, cy + 2, 18, cy + 2);
        P.part(bm, H, { tex: (x, y) => ((x + y) % 3 === 0 ? -1 : 0) });
        P.g.set(16, cy + 1, S[1]);
      }
      if (g.beard === 'stubble') head.each((x, y) => { if (y >= cy + 2 && (x + y) % 2 === 0 && !(y === cy + 3 && x >= 15 && x <= 17)) P.g.set(x, y, mix(S[1], H[1], 0.5)); });
    }
    // headgear
    const steel = { spec: true, sep: true };
    switch (g.helm) {
      case 'greathelm': {
        const m = P.mask().rect(11, cy - 5, 21, cy + 5); m.del(11, cy - 5).del(21, cy - 5);
        P.part(m, STEEL, steel);
        if (!back) { for (let x = 12; x <= 20; x++) if (x !== 16) P.g.set(x, cy, INK); P.g.set(14, cy + 3, INK).set(18, cy + 3, INK); P.part(P.mask().rect(16, cy - 4, 16, cy + 5), STEEL, { base: 3, flat: true }); }
        break;
      }
      case 'bascinet': {
        const m = P.mask().ellipse(cx, cy - 1.5, 4.8, 4.3); m.add(16, cy - 6).add(16, cy - 7);
        if (!back) { m.each((x, y) => { if (y >= cy - 1) m.del(x, y); }); }
        P.part(m, STEEL, steel);
        const av = P.mask();                                                                      // mail aventail
        for (let y = cy - 1; y <= cy + 6; y++) for (let x = 10; x <= 22; x++) {
          const face = !back && x >= 13 && x <= 19 && y <= cy + 4;
          if (!face && (y >= cy + 3 || x <= 12 || x >= 20)) av.add(x, y);
        }
        P.part(av, STEEL, { tex: mailTex, base: 1, sep: true });
        break;
      }
      case 'sallet': {
        const m = P.mask().ellipse(cx, cy - 1.5, 5, 4.2); m.rect(10, cy - 1, 22, cy - 1);
        if (!back) m.each((x, y) => { if (y > cy - 1) m.del(x, y); });
        else m.rect(12, cy - 1, 20, cy + 2);
        P.part(m, STEEL, steel);
        if (!back) for (let x = 12; x <= 20; x++) P.g.set(x, cy - 1, x === 16 ? STEEL[2] : INK);
        break;
      }
      case 'kettle': {
        const m = P.mask().ellipse(cx, cy - 2.5, 4.2, 3.4); m.rect(9, cy - 1, 23, cy - 1); m.rect(10, cy - 2, 22, cy - 2);
        P.part(m, STEEL, steel);
        break;
      }
      case 'coif': case 'hood': {
        const mailHood = g.helm === 'coif';
        const m = P.mask().ellipse(cx, cy, 5.4, 5.8); m.rect(11, cy + 3, 21, cy + 6);
        if (!back) m.each((x, y) => { if (x >= 13 && x <= 19 && y >= cy - 2 && y <= cy + 4) m.del(x, y); });
        P.part(m, mailHood ? STEEL : g.liv, mailHood ? { tex: mailTex, base: 1, sep: true } : { sep: true });
        if (!mailHood && back) P.part(P.mask().capsule(16, cy + 5, 17, cy + 10, 2), g.liv, {});   // liripipe
        break;
      }
      case 'cap': {
        const m = P.mask().ellipse(cx, cy - 3, 4.8, 2.8); m.rect(11, cy - 2, 21, cy - 2);
        P.part(m, g.drab, { sep: true });
        break;
      }
    }
    if (g.plume && (g.helm === 'greathelm' || g.helm === 'bascinet' || g.helm === 'sallet')) {
      const pm = P.mask().capsule(16, cy - 6, 19, cy - 9, 2.4).capsule(19, cy - 9, 22, cy - 8, 2);
      P.part(pm, tRamp(g.arms.A), { sep: true });
    }
  }

  // Side view, facing left.
  function sideFrame(g, P, pose, step, b, R0) {
    const atk = pose === 'attack';
    const st = pose === 'walk' ? [2.5, 0, -2.5, 0][step] : atk ? 3 : 1;
    const plateBody = g.body === 'plate' || g.body === 'plateMail';
    const S = g.skin, H = g.hair, cy = 9 + b;
    // far side first (darker)
    if (g.shield) {
      const sm = P.mask().poly([[17, 17 + b], [22.5, 17 + b], [22.5, 24 + b], [19.5, 30 + b], [17, 24 + b]]);
      P.part(sm, (x, y) => tRamp(blazon(g.arms, 0.55 + (x - 17) / 12, (y - 17 - b) / 13)), { base: 1 });
    }
    const farLeg = P.mask().capsule(17, 27 + b, 18 + st, 35, 3.2), nearLeg = P.mask().capsule(15, 27 + b, 14 - st, 35, 3.2);
    P.part(farLeg, R0.legRamp, { base: 1 });
    P.part(P.mask().rect(16 + st, 36, 19 + st, 37), R0.footRamp, { base: 0 });
    P.part(P.mask().capsule(17.5, 17 + b, 18.5 - st * 0.4, 24 + b, 3), R0.armRamp, Object.assign({}, R0.armOpts, { base: 1 }));
    // body
    const torso = P.mask().poly([[12.5, 15 + b], [19, 15 + b], [18.5, 26 + b], [13, 26 + b]]);
    const skirt = P.mask().poly([[13, 25 + b], [18.5, 25 + b], [19.5, 30 + b], [12, 30 + b]]);
    const fn = (x, y) => (typeof R0.torsoFn === 'function' ? R0.torsoFn(x + 1, y) : R0.torsoFn);
    P.part(nearLeg, R0.legRamp, plateBody ? { spec: true, sep: true } : { sep: true });
    P.part(P.mask().rect(11 - st, 36, 15 - st, 37), R0.footRamp, { base: 1 });
    P.part(torso, fn, R0.torsoOpts); P.part(skirt, fn, Object.assign({ sep: true, sepSides: (dx, dy) => dy < 0 }, R0.torsoOpts));
    if (plateBody) P.part(P.mask().ellipse(15.5, 16.5 + b, 2.8, 2.2), STEEL, { spec: true, sep: true });
    // head
    P.part(P.mask().rect(14, 13 + b, 17, 15 + b), S, { base: 1 });
    const head = P.mask().ellipse(15.5, cy, 4.2, 5.1);
    P.part(head, S, {});
    P.g.set(11, cy + 1, S[2]);                                                                        // nose
    if (g.hairStyle !== 'bald') {
      const hm = P.mask(); head.each((x, y) => { if (y <= cy - 2 || x >= 16) hm.add(x, y); });
      if (g.hairStyle === 'long') hm.rect(17, cy, 19, cy + 6);
      P.part(hm, H, { tex: (x, y) => ((x * 5 + y * 3) % 7 === 0 ? 1 : 0) });
    }
    P.g.set(12, cy - 1, H[1]).set(13, cy - 1, H[1]).set(13, cy, '#2a1a14').set(12, cy + 3, mix(S[1], '#8a2a2a', 0.4));
    if (g.beard === 'full') { const bm = P.mask(); head.each((x, y) => { if (y >= cy + 2 && x <= 16) bm.add(x, y); }); bm.rect(12, cy + 5, 15, cy + 6); P.part(bm, H, {}); }
    if (g.beard === 'moustache') P.g.set(12, cy + 2, H[1]).set(13, cy + 2, H[1]);
    // headgear (profile)
    const steel = { spec: true, sep: true };
    switch (g.helm) {
      case 'greathelm': { const m = P.mask().rect(11, cy - 5, 20, cy + 5); m.del(11, cy - 5); P.part(m, STEEL, steel); for (let x = 11; x <= 14; x++) P.g.set(x, cy, INK); break; }
      case 'bascinet': { const m = P.mask().ellipse(15.5, cy - 1.5, 4.6, 4.3); m.add(18, cy - 6).add(19, cy - 6); m.each((x, y) => { if (y >= cy - 1 && x < 15) m.del(x, y); }); P.part(m, STEEL, steel); P.part(P.mask().rect(14, cy + 3, 20, cy + 6).rect(17, cy - 1, 20, cy + 3), STEEL, { tex: mailTex, base: 1, sep: true }); break; }
      case 'sallet': { const m = P.mask().ellipse(16, cy - 1.5, 4.8, 4.2); m.rect(16, cy - 1, 22, cy); m.each((x, y) => { if (y > cy - 1 && x < 16) m.del(x, y); }); P.part(m, STEEL, steel); break; }
      case 'kettle': { const m = P.mask().ellipse(15.5, cy - 2.5, 4, 3.4); m.rect(9, cy - 1, 22, cy - 1); P.part(m, STEEL, steel); break; }
      case 'coif': case 'hood': { const m = P.mask().ellipse(16, cy, 5, 5.8); m.rect(14, cy + 3, 20, cy + 6); m.each((x, y) => { if (x <= 14 && y >= cy - 2 && y <= cy + 4) m.del(x, y); }); P.part(m, g.helm === 'coif' ? STEEL : g.liv, g.helm === 'coif' ? { tex: mailTex, base: 1, sep: true } : { sep: true }); break; }
      case 'cap': { const m = P.mask().ellipse(16, cy - 3, 4.6, 2.8); P.part(m, g.drab, { sep: true }); break; }
    }
    // near arm and weapon
    const hand = atk ? [9, 21 + b] : [13 + st * 0.4, 25 + b];
    P.part(P.mask().capsule(14.5, 17 + b, hand[0] + 0.5, hand[1] - 0.5, 3.2), R0.armRamp, Object.assign({ sep: true }, R0.armOpts));
    const long = ['spear', 'halberd', 'poleaxe', 'bill'].includes(g.weapon);
    if (g.weapon === 'longbow') drawWeapon(P, 'longbow', atk ? 7 : hand[0] - 1, atk ? 21 + b : hand[1] - 3, -90, { draw: false, flip: true, sep: true });
    else if (g.weapon === 'crossbow') drawWeapon(P, 'crossbow', hand[0] + 3, hand[1] - (atk ? 4 : 0), atk ? 180 : -150, { sep: true });
    else drawWeapon(P, g.weapon, hand[0], hand[1], atk ? (long ? 180 : 195) : long ? -95 : -118, { sep: true });
    P.part(P.mask().ellipse(hand[0], hand[1], 1.5, 1.4), plateBody ? STEEL : S, {});
    return P.done();
  }

  // A fallen soldier: the front frame laid on its side over a pool of blood.
  function corpse(g, seed, flip) {
    const r = R.make(seed, 'corpse' + flip);
    const up = soldierFrame(Object.assign({}, g, { weapon: 'none', shield: g.shield && r.chance(0.5) }), 0, 'walk', 0);
    const out = new Grid(40, 32);
    // pool of blood first
    const cx = (flip ? 25 : 15) + r.range(-3, 3), cy = 21, rx = r.range(14, 18), ry = r.range(7, 9);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 40; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (r() - 0.5) * 0.15;
      if (d < 1) out.set(x, y, d < 0.55 ? BLOOD[1] : d < 0.8 ? BLOOD[2] : dither(x, y, (1 - d) * 4) ? BLOOD[3] : undefined);
    }
    // rotate the body 90 degrees so it lies along the ground
    for (let y = 0; y < 40; y++) for (let x = 0; x < 32; x++) {
      const v = up.get(x, y); if (!(v & 255)) continue;
      // lying on its side: the head points left (or right when flipped), feet the other way
      const X = flip ? 39 - y : y, Y = flip ? x : 31 - x;
      out.set(X, Y + 1, v);
    }
    // a dropped weapon
    if (g.weapon !== 'longbow' && g.weapon !== 'crossbow' && r.chance(0.6)) {
      const P = new Painter(40, 32);
      drawWeapon(P, g.weapon, r.range(8, 30), 27, r.pick([-8, 172, 5, 185]), {});
      out.blit(P.done());
    }
    return out;
  }

  function genSoldier(o) {
    const g = soldierGenome(o);
    const sheet = new Grid(128, 232);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) {
      const pose = row === 4 ? 'attack' : 'walk';
      const fr = col === 3 ? soldierFrame(g, 2, pose, row).flipX() : soldierFrame(g, col, pose, row);
      sheet.blit(fr, col * 32, row * 40);
    }
    sheet.blit(corpse(g, o.seed, false), 0, 200);
    sheet.blit(corpse(g, o.seed, true), 44, 200);
    const tracks = [0, 1, 2, 3].map(c => [0, 1, 2, 3].map(r => ({ x: c * 32, y: r * 40 })));
    tracks.push([0, 1, 2, 3].map(c => ({ x: c * 32, y: 160 })));
    return { img: sheet, anim: { fw: 32, fh: 40, fps: 6, tracks, labels: ['front', 'back', 'left', 'right', 'attack'] }, name: `soldier-${g.type}-${g.weapon}`, info: g };
  }

  // ================================================================ FIELD TILES
  const FIELD = {
    meadow: { base: ['#24421e', '#30582a', '#3e6c30', '#4e8038', '#629444', '#7aa852'] },
    camp:   { base: ['#4a3a24', '#5e4a2e', '#735c38', '#8a7044', '#a08654', '#b89c68'] },
    mud:    { base: ['#2a2016', '#3a2c1e', '#4a3a28', '#5c4a32', '#6e5a3e', '#84704e'] },
    road:   { base: ['#5a4a36', '#6e5c44', '#847052', '#9a8460', '#b09a74', '#c4b088'] },
  };
  function genField(o) {
    const r = R.make(o.seed, 'field');
    const kind = FIELD[o.field] ? o.field : r.pick(Object.keys(FIELD));
    const C = FIELD[kind].base, S = 64, g = new Grid(S, S), n = fbm(r, S), w = (x, y, c) => g.set((x + S * 4) % S, (y + S * 4) % S, c);
    g.each((x, y) => rampAt(C.slice(1, 4), n(x, y) * 1.1 - 0.05, x, y));
    if (kind === 'meadow') {
      // a calm base, then overlapping leaf strokes (3-4px, slanted either way), each with a lit
      // upper edge and a dark shadow underneath: the soft leafy grass of the reference
      g.each((x, y) => (n(x, y) > 0.62 ? C[3] : n(x, y) < 0.3 ? C[1] : C[2]));
      for (let i = 0; i < 300; i++) {
        const x = r.int(0, S - 1), y = r.int(0, S - 1), dir = r.chance(0.5) ? 1 : -1, len = r.int(2, 3), lit = n(x, y) > 0.5 ? 1 : 0;
        for (let k = 0; k <= len; k++) {
          const px = x + dir * k, py = y - Math.floor(k * 0.7);
          w(px, py + 1, C[1 + lit - (k === 0 ? 1 : 0) < 0 ? 0 : 1 + lit - (k === 0 ? 1 : 0)]);
          w(px, py, C[(k === len ? 4 : 3) + lit]);
        }
      }
      for (let i = 0; i < 5; i++) { const x = r.int(0, S - 1), y = r.int(0, S - 1); w(x, y, r.pick(['#e8e0a0', '#d8d0e8', '#f0f0e0'])); }
    } else {
      for (let i = 0; i < (kind === 'camp' ? 26 : 14); i++) {                                     // stones
        const x = r.int(0, S - 1), y = r.int(0, S - 1), big = r.chance(0.4);
        const st = ramp(r.pick(['#6a7480', '#7a7a70', '#5a6470']), 4, 0.5);
        w(x, y, st[2]); w(x + 1, y, st[1]); w(x, y - 1, st[3]); if (big) { w(x + 1, y - 1, st[2]); w(x - 1, y, st[2]); w(x + 2, y, st[0]); } w(x, y + 1, C[0]); w(x + 1, y + 1, C[0]);
      }
      for (let i = 0; i < 160; i++) { const x = r.int(0, S - 1), y = r.int(0, S - 1); w(x, y, r.chance(0.5) ? C[0] : C[4]); }
      if (kind === 'road') for (let x = 0; x < S; x++) { w(x, 18 + Math.round(Math.sin(x / 64 * Math.PI * 4)), C[1]); w(x, 44 + Math.round(Math.cos(x / 64 * Math.PI * 6)), C[1]); }  // wheel ruts
      if (kind === 'mud') for (let i = 0; i < 10; i++) { const x = r.int(0, S - 1), y = r.int(0, S - 1); for (let k = 0; k < 4; k++) w(x + k, y, '#4a5a64'); w(x + 1, y, '#8a9aa0'); }   // puddles
      if (kind === 'camp') for (let i = 0; i < 24; i++) { const x = r.int(0, S - 1), y = r.int(0, S - 1); w(x, y, '#4e7a30'); w(x + 1, y - 1, '#6a9a40'); }   // tufts
    }
    return { img: g, anim: { fw: S, fh: S, fps: 1, tracks: [[{ x: 0, y: 0 }]], tile: true }, name: `field-${kind}` };
  }

  // ================================================================ DECALS
  function genDecal(o) {
    const r = R.make(o.seed, 'decal');
    const kind = o.decal || r.pick(['blood', 'blood', 'scorch', 'trampled']);
    const g = new Grid(32, 24), cx = 16, cy = 12;
    const blobs = []; for (let i = 0; i < r.int(2, 5); i++) blobs.push([cx + r.range(-7, 7), cy + r.range(-3, 3), r.range(3, 7), r.range(2, 4)]);
    g.each((x, y) => {
      let d = 9; for (const [bx, by, rx, ry] of blobs) d = Math.min(d, Math.hypot((x - bx) / rx, (y - by) / ry));
      d += (r() - 0.5) * 0.12;
      if (d >= 1) return kind === 'blood' && d < 1.25 && r() < 0.08 ? BLOOD[2] : undefined;
      if (kind === 'blood') return d < 0.5 ? BLOOD[0] : d < 0.8 ? BLOOD[1] : dither(x, y, (1 - d) * 5) ? BLOOD[2] : BLOOD[3];
      if (kind === 'scorch') return d < 0.4 ? '#1a1410' : d < 0.75 ? '#2e241a' : dither(x, y, (1 - d) * 4) ? '#3e3020' : undefined;
      return dither(x, y, (1 - d) * 1.4) ? (y % 3 === 0 ? '#2a4a1e' : '#5a7a34') : undefined;
    });
    return { img: g, anim: { fw: 32, fh: 24, fps: 1, tracks: [[{ x: 0, y: 0 }]] }, name: `decal-${kind}` };
  }

  // ================================================================ PROPS
  function genProp(o) {
    const r = R.make(o.seed, 'prop');
    const kind = o.prop || r.pick(['pavilion', 'palisade', 'gatehouse', 'banner', 'haybale', 'campfire']);
    const arms = rollArms(o.faction, o.seed, !FACTIONS[o.faction]);
    const colA = tRamp(METALS.includes(arms.A) ? arms.B : arms.A), colB = tRamp(METALS.includes(arms.A) ? arms.A : METALS.includes(arms.B) ? arms.B : 'argent');
    let P;
    if (kind === 'pavilion') {
      P = new Painter(56, 64);
      const ax = 28, top = 4, eave = 24, base = 58, half = 23, panels = r.pick([6, 8]);
      // walls: vertical panels alternating two colours, darker toward the right
      const walls = P.mask().poly([[ax - half + 1, eave], [ax + half - 1, eave], [ax + half + 1, base], [ax - half - 1, base]]);
      P.part(walls, (x, y) => (Math.floor((x - (ax - half)) / (2 * half / panels)) % 2 ? colB : colA), { flat: true, shade: (x, y) => (x > ax + 8 ? -1 : x < ax - 12 ? 1 : 0) });
      // door
      const door = P.mask().poly([[ax - 1, eave + 6], [ax + 5, base], [ax - 6, base]]);
      P.part(door, ['#140c08', '#24160e', '#34221a', '#44302a'], { flat: true, base: 1 });
      P.part(P.mask().capsule(ax - 1, eave + 6, ax - 7, base, 1.4), colB, { base: 3, flat: true });
      // roof: a cone of panels from the apex, with a dagged (scalloped) valance
      const roof = P.mask().poly([[ax, top], [ax + half + 2, eave + 1], [ax - half - 2, eave + 1]]);
      P.part(roof, (x, y) => { const ang = Math.atan2(x - ax, y - top); return Math.floor((ang + 1.2) / (2.4 / panels)) % 2 ? colA : colB; },
        { flat: true, shade: (x, y) => (x > ax + 6 ? -1 : x < ax - 6 ? 1 : 0) + (y < top + 6 ? 1 : 0) });
      const val = P.mask();
      for (let x = ax - half - 2; x <= ax + half + 2; x++) { const dy = (x - (ax - half - 2)) % 5 < 3 ? 3 : 1; val.rect(x, eave + 1, x, eave + dy); }
      P.part(val, colB, { flat: true, base: 2, sep: true, shade: (x) => (x > ax + 8 ? -1 : 0) });
      P.part(P.mask().rect(ax, 0, ax, top + 1), WOODR, { base: 1 });                    // pole
      P.part(P.mask().poly([[ax + 1, 0], [ax + 8, 2], [ax + 1, 4]]), colA, { base: 2 });  // pennant
      // guy ropes and pegs
      for (const [x0, x1] of [[ax - half - 1, ax - half - 6], [ax + half + 1, ax + half + 6]]) { P.g.line(x0, eave + 2, x1, base + 2, '#b8a888'); P.g.set(x1, base + 3, WOODR[1]); }
    } else if (kind === 'palisade') {
      P = new Painter(48, 40);
      const n = 5;
      for (let i = 0; i < n; i++) {
        const x = 2 + i * 9 + r.int(-1, 1), h = 30 + r.int(-3, 3), w = 8;
        const m = P.mask().poly([[x, 39], [x + w, 39], [x + w, 39 - h + 6], [x + w / 2, 39 - h], [x, 39 - h + 6]]);
        P.part(m, WOODR, { sep: true, tex: (xx, yy) => ((xx * 7 + yy) % 9 === 0 ? -1 : 0), shade: (xx) => (xx - x > 5 ? -1 : xx - x < 2 ? 1 : 0) });
        P.part(P.mask().poly([[x + 1, 39 - h + 6], [x + w / 2, 39 - h], [x + w - 1, 39 - h + 6], [x + w / 2, 39 - h + 4]]), ['#8a6a48', '#a88a62', '#c4a87e', '#dcc49a', '#f0dcb4'], { base: 1 });
      }
      P.part(P.mask().rect(0, 22, 47, 23), WOODR, { base: 1, sep: true });                     // rail
    } else if (kind === 'gatehouse') {
      P = new Painter(48, 56);
      for (const x of [4, 40]) P.part(P.mask().rect(x, 14, x + 3, 55), WOODR, { sep: true });
      P.part(P.mask().rect(2, 28, 45, 31), WOODR, { sep: true, tex: (x) => (x % 6 === 0 ? -1 : 0) });   // walkway
      const roof = P.mask().poly([[0, 14], [47, 14], [45, 24], [2, 24]]);
      const HAY = ['#6a5420', '#8a7030', '#b09440', '#d0b458', '#ecd47a'];
      P.part(roof, HAY, { tex: (x, y) => ((x * 3 + y * 7) % 5 === 0 ? 1 : (x + y * 2) % 7 === 0 ? -1 : 0), sep: true });
      for (let x = 2; x < 46; x += 2) P.g.set(x, 24, HAY[1]).set(x + 1, 25, HAY[0]);
      for (const side of [0, 1]) {                                                              // gate leaves
        const x0 = side ? 24 : 8;
        P.part(P.mask().rect(x0, 33, x0 + 15, 55), WOODR, { sep: true, tex: (x) => ((x - x0) % 4 === 0 ? -1 : 0) });
        P.part(P.mask().rect(x0, 38, x0 + 15, 39).rect(x0, 49, x0 + 15, 50), WOODR, { base: 1 });
      }
    } else if (kind === 'banner') {
      P = new Painter(24, 48);
      P.part(P.mask().rect(3, 2, 4, 47), WOODR, {});
      P.part(P.mask().ellipse(3.5, 2, 1.6, 1.6), ramp('#e0b440', 5), { spec: true });
      const m = P.mask(), tails = r.chance(0.5);
      for (let y = 5; y <= 30; y++) for (let x = 5; x <= 21; x++) {
        const wave = Math.round(Math.sin(x / 3) * 1);
        if (y + wave < 5) continue;
        if (tails && y + wave > 25 && Math.abs(x - 13) < (y + wave - 25) * 1.2) continue;
        if (y + wave <= 30) m.add(x, y);
      }
      P.part(m, (x, y) => tRamp(blazon(arms, (x - 5) / 16, (y - 5) / 22)), { flat: true, base: 2, shade: (x) => (Math.sin(x / 3) > 0.4 ? -1 : Math.sin(x / 3) < -0.4 ? 1 : 0) });
      drawCharge(P.g, arms, 13, 15, 3);
    } else if (kind === 'haybale') {
      P = new Painter(24, 20);
      const HAY = ['#6a5420', '#8a7030', '#b09440', '#d0b458', '#ecd47a'];
      P.part(P.mask().ellipse(12, 11, 10, 7.5), HAY, { tex: (x, y) => ((x * 3 + y * 5) % 4 === 0 ? 1 : (x + y) % 5 === 0 ? -1 : 0) });
      P.part(P.mask().rect(5, 4, 5, 18).rect(18, 4, 18, 18), LEATHER, { base: 1, flat: true });
    } else {
      P = new Painter(24, 24);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; P.part(P.mask().ellipse(12 + Math.cos(a) * 7, 18 + Math.sin(a) * 3, 2, 1.6), ramp('#7a7a74', 5), {}); }
      P.part(P.mask().capsule(6, 19, 18, 16, 2).capsule(6, 16, 18, 19, 2), WOODR, {});
      const FIRE = ['#7a1a08', '#c83a10', '#f07a18', '#ffc040', '#fff0a0'];
      const fm = P.mask(); for (let y = 6; y <= 17; y++) for (let x = 7; x <= 17; x++) { const h = 17 - y, wdt = 5 - h * 0.4 + Math.sin(x * 1.7 + y) * 0.8; if (Math.abs(x - 12) < wdt) fm.add(x, y); }
      P.part(fm, FIRE, { shade: (x, y) => (y > 13 ? 1 : 0) + (Math.abs(x - 12) < 2 ? 1 : 0) });
    }
    return { img: P.done(), anim: { fw: P.w, fh: P.h, fps: 1, tracks: [[{ x: 0, y: 0 }]] }, name: `prop-${kind}` };
  }

  Object.assign(PG.GENERATORS, {
    arms:    { group: 'Medieval 32px', fn: genArms,    label: 'Coat of arms', size: '32 x 36', options: { own: ['no', 'yes'] } },
    soldier: { group: 'Medieval 32px', fn: genSoldier, label: 'Soldier sheet', size: '32 x 40 frames', options: { troop: ['random', ...Object.keys(TROOPS)], weapon: ['random', 'sword', 'mace', 'axe', 'spear', 'halberd', 'poleaxe', 'bill', 'longbow', 'crossbow'], helm: ['random', 'none', 'greathelm', 'bascinet', 'sallet', 'kettle', 'coif', 'hood', 'cap'] } },
    field:   { group: 'Medieval 32px', fn: genField,   label: 'Field ground', size: '64 x 64 seamless', options: { field: ['random', ...Object.keys(FIELD)] } },
    decal:   { group: 'Medieval 32px', fn: genDecal,   label: 'Ground decal', size: '32 x 24', options: { decal: ['random', 'blood', 'scorch', 'trampled'] } },
    prop:    { group: 'Medieval 32px', fn: genProp,    label: 'Camp prop', size: 'varies', options: { prop: ['random', 'pavilion', 'palisade', 'gatehouse', 'banner', 'haybale', 'campfire'] } },
  });
  PG.medieval = { rollArms, blazon, TINCT };
})(typeof window !== 'undefined' ? window : globalThis);
