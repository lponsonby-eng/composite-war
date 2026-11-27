// =============================================================================
//  PIXELGEN MEDIEVAL: a 32px set in the style of late-medieval battle art
//  (style reference: Danville's "The White Company"): realistic proportions,
//  readable faces and beards, plate and mail with hard highlights, and heraldry
//  on every surcoat, shield, banner and tent. Offline, seeded, no dependencies.
//
//    arms      32 x 36 coat of arms on a heater shield (a faction's arms)
//    soldier   128 x 232 sheet: 32 x 40 frames, cols down/up/left/right,
//              rows 0-3 walk, row 4 attack, then a 32px row of two fallen bodies
//    champion  160 x 288 hero sheet: 40 x 48 frames, cols down/up/left/right, rows walk x4,
//              attack, special. Twelve archetypes, each with its own silhouette and aura.
//    heroface  192 x 64: the matching 64 x 64 dialogue portrait of a champion (same seed and
//              options), in three moods: neutral, fierce, smile
//    cavalry   192 x 292 sheet: 48 x 52 frames (horse + rider), dirs x walk/attack, then a fallen horse and rider
//    field     64 x 64 seamless ground: meadow, camp, mud, road
//    decal     blood pools, scorch marks and trampled grass to scatter on ground
//    prop      camp: pavilion, palisade, gatehouse, banner, hay bale, campfire, barrel, crates,
//              weapon rack, cart; scenery: oak, pine, bush, rock, stump
//
//  Heraldry: when a faction is chosen every piece uses that faction's arms (rolled
//  from the faction name), so a whole army wears matching colours. Without a
//  faction, each seed rolls its own arms.
// =============================================================================
(function (root) {
  'use strict';
  const PG = typeof module !== 'undefined' && module.exports ? require('./pixelgen.js') : root.PixelGen;
  const { R, Grid, ramp, mix, pack, band, rampAt, dither, hexRgb, rgbHex, hslToRgb, tileNoise, fbm, pickSkin, HAIR, FACTIONS } = PG;

  // Tone: cool, deep shadows (hue drawn toward blue-violet), soft warm-white highlights and
  // a dark navy outline, like painted plate in the reference art.
  const INK = '#151826';                                          // outline: dark navy
  const STEEL = ['#1d2234', '#48526c', '#8590a6', '#c3cbd8', '#f2f5fa'];   // cool plate: slate shadows, near-white glints
  function tone(base) {
    const [h, s, l] = PG.rgbToHsl(...hexRgb(base));
    const toward = (t, k) => { const d = ((t - h + 1.5) % 1) - 0.5; return h + d * k; };
    return [-0.34, -0.17, 0, 0.13, 0.25].map(d => {
      const k = d < 0 ? -d / 0.34 : d / 0.25;
      const hh = d < 0 ? toward(0.68, k * 0.22) : toward(0.12, k * 0.08);
      const ss = Math.max(0, Math.min(1, s * (d < 0 ? 1 - k * 0.1 : 1 - k * 0.3)));
      const ll = Math.max(0.03, Math.min(0.97, l + d * (d < 0 ? 1.1 : 0.9)));
      return rgbHex(...hslToRgb(((hh % 1) + 1) % 1, ss, ll));
    });
  }
  const LEATHER = tone('#6a4a32');
  const WOODR = tone('#7e5530');
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
  const tRamp = t => tinctRamp[t] || (tinctRamp[t] = tone(TINCT[t]));

  // ---------------------------------------------------------------- masks and the part painter
  class Mask {
    // ox, oy: where this mask's (0, 0) sits on the canvas (heroes draw on a bigger canvas)
    constructor(w, h, ox = 0, oy = 0) { this.w = w; this.h = h; this.ox = ox; this.oy = oy; this.a = new Uint8Array(w * h); }
    has(x, y) { x += this.ox; y += this.oy; return x >= 0 && y >= 0 && x < this.w && y < this.h && this.a[y * this.w + x] === 1; }
    add(x, y) { x = Math.round(x) + this.ox; y = Math.round(y) + this.oy; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.a[y * this.w + x] = 1; return this; }
    del(x, y) { x += this.ox; y += this.oy; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.a[y * this.w + x] = 0; return this; }
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
    each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.a[y * this.w + x]) fn(x - this.ox, y - this.oy); }
  }
  // A grid drawn in shifted coordinates (see Mask): set/get/filled take the same coordinates as the masks.
  class OffsetGrid extends Grid {
    constructor(w, h, ox, oy) { super(w, h); this.ox = ox; this.oy = oy; }
    in(x, y) { return super.in(Math.round(x) + this.ox, Math.round(y) + this.oy); }
    get(x, y) { return super.get(Math.round(x) + this.ox, Math.round(y) + this.oy); }
    set(x, y, c, a) { return super.set(Math.round(x) + this.ox, Math.round(y) + this.oy, c, a); }
    outline(c, diag) { const ox = this.ox, oy = this.oy; this.ox = this.oy = 0; super.outline(c, diag); this.ox = ox; this.oy = oy; return this; }
  }

  // Paints parts back to front onto a grid. Each part is lit from the top-left: its
  // top/left edges get the lighter step, right/bottom edges the darker one, and
  // `spec` parts (plate, blades) get a white glint on their top-left corners.
  // `sep` draws a dark line where the part overlaps parts painted before it.
  class Painter {
    constructor(w, h, ox = 0, oy = 0) { this.g = ox || oy ? new OffsetGrid(w, h, ox, oy) : new Grid(w, h); this.id = new Int16Array(w * h); this.n = 0; this.w = w; this.h = h; this.ox = ox; this.oy = oy; }
    mask() { return new Mask(this.w, this.h, this.ox, this.oy); }
    idx(x, y) { x += this.ox; y += this.oy; return x >= 0 && y >= 0 && x < this.w && y < this.h ? y * this.w + x : -1; }
    part(m, rampOrFn, o = {}) {
      const pid = ++this.n, base = o.base === undefined ? 2 : o.base;
      if (o.sep) m.each((x, y) => {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy;
          const i = this.idx(X, Y);
          if (!m.has(X, Y) && i >= 0 && this.id[i] > 0 && (o.sepSides ? o.sepSides(dx, dy) : true)) this.g.set(X, Y, INK);
        }
      });
      m.each((x, y) => {
        const rp = typeof rampOrFn === 'function' ? rampOrFn(x, y) : rampOrFn;
        if (!rp) return;
        const top = !m.has(x, y - 1), left = !m.has(x - 1, y), right = !m.has(x + 1, y), bot = !m.has(x, y + 1);
        let L = x, Rr = x; while (m.has(L - 1, y)) L--; while (m.has(Rr + 1, y)) Rr++;
        const wdt = Rr - L + 1, cyl = !o.flat && wdt >= 3;
        let k = base + (o.tex ? o.tex(x, y) : 0) + (o.shade ? o.shade(x, y) : 0);
        if (o.flat) { /* lit evenly */ }
        else if (cyl) {
          // round forms: lit band left of centre, shadow down the right side, light on top edges
          const t = (x - L) / (wdt - 1);
          k += (t >= 0.15 && t <= 0.45 ? 1 : t > 0.72 ? -1 : 0) + (top ? 1 : 0) - (bot ? 1 : 0);
          if (o.spec && x === Math.round(L + 0.3 * (wdt - 1)) && !bot) k = rp.length - 1;
        } else {
          k += ((top || left) ? 1 : 0) - ((right || bot) ? 1 : 0);
          if (o.spec && top && left) k = rp.length - 1;
        }
        k = Math.max(0, Math.min(rp.length - 1 - (o.spec ? 0 : 1), k));
        this.g.set(x, y, rp[k]);
        const i = this.idx(x, y); if (i >= 0) this.id[i] = pid;
      });
      return this;
    }
    px(x, y, c) { this.g.set(x, y, c); const i = this.idx(x, y); if (i >= 0) this.id[i] = ++this.n; return this; }
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
      skin: tone(r.pick(PG.SKIN.slice(0, 6))),                          // human skin tones only
      hair: null,
      hairStyle: r.pick(['short', 'long', 'long', 'bald', 'short']),
      beard: r.pick(['none', 'full', 'full', 'moustache', 'stubble', 'none']),
      drab: tone(r.pick(DRAB)), hose: tone(r.pick(['#5a4636', '#46465a', '#6a4c36', '#7a3434', '#36483a'])),
      plume: r.chance(0.3),
    };
    // hair must stand apart from the skin (a blond beard on pale skin reads as a blob)
    const skinL = PG.rgbToHsl(...hexRgb(G.skin[2]))[2];
    const hairs = ['#2a1c14', '#3a2418', '#5a3418', '#6a4020', '#8a5a28', '#a83020', '#c89038', '#e8e4dc', '#8a7a6a', '#181820'];
    const ok = hairs.filter(h => Math.abs(PG.rgbToHsl(...hexRgb(h))[2] - skinL) > 0.22);
    G.hair = tone(r.pick(ok.length ? ok : hairs));
    if (o.robe === 'yes') {                                  // a robed caster in the army's colours
      G.over = { robe: true, torso: (x) => (x >= 15 && x <= 17 ? livMetal : liv), arms: liv, hands: G.skin, feet: LEATHER, belt: livMetal };
      G.shield = false; G.beard = r.pick(['none', 'full', 'none']);
    }
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
      case 'staff': return [{ ...W, t: [-12, 13], w: 1.3 }, { mat: ramp('#c8a040', 5, 0.5), guard: [-1.6, 1.6], t: [13.5, 13.5], w: 1 }, { mat: ramp('#7ad8ff', 5, 0.5), ball: 1.9, t: [15.5, 15.5] }];
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
    const O = g.over || {};                                         // a hero's own colours and cut (see HEROES)
    const plateBody = O.plate !== undefined ? O.plate : g.body === 'plate' || g.body === 'plateMail';
    const legRamp = O.legs || (plateBody ? STEEL : g.body === 'tunic' ? g.drab : g.hose);
    const armRamp = O.arms || (g.body === 'plate' ? STEEL : g.body === 'plateMail' || g.body === 'mailTabard' ? STEEL : g.body === 'tunic' ? g.drab : g.liv);
    const armOpts = O.armOpts || (g.body === 'plateMail' || g.body === 'mailTabard' ? { tex: mailTex, base: 1 } : g.body === 'plate' ? { spec: true } : g.body === 'tunic' ? {} : { tex: quiltTex });
    const footRamp = O.feet || (plateBody ? STEEL : LEATHER);
    const heraldFn = (x0, y0, w, h) => (x, y) => tRamp(blazon(g.arms, (x - x0) / w, (y - y0) / h));
    const torsoFn = O.torso || (g.body === 'plate' || g.body === 'plateMail' || g.body === 'mailTabard' ? heraldFn(11, 15 + b, 10, 15)
      : g.body === 'tunic' ? () => g.drab : () => g.liv);
    const torsoOpts = O.torsoOpts || (g.body === 'gambeson' || g.body === 'jack' ? { tex: quiltTex } : {});
    const hem = O.robe ? 37 : O.long ? 33 : 30;                     // how far the skirt / robe / coat reaches

    if (dir === 2) return sideFrame(g, P, pose, step, b, { legRamp, armRamp, armOpts, footRamp, torsoFn, torsoOpts, hem, plateBody, handRamp: O.hands });

    // ---------------- front / back
    const back = dir === 1;
    const lift = pose === 'walk' ? [0, 1, 0, 2][step] : 0;           // 1: left leg up, 2: right leg up
    const swing = pose === 'walk' ? [0, 1, 0, -1][step] : 0;
    // legs
    const legL = P.mask().rect(11, 27 + b, 14, 35 - (lift === 1 ? 1 : 0)), legR = P.mask().rect(18, 27 + b, 21, 35 - (lift === 2 ? 1 : 0));
    if (!O.robe) { P.part(legL, legRamp, plateBody ? { spec: true } : {}); P.part(legR, legRamp, plateBody ? { spec: true } : {}); }
    P.part(P.mask().rect(10, 36 - (lift === 1 ? 1 : 0), 14, 37 - (lift === 1 ? 1 : 0)), footRamp, { base: 1 });
    P.part(P.mask().rect(18, 36 - (lift === 2 ? 1 : 0), 22, 37 - (lift === 2 ? 1 : 0)), footRamp, { base: 1 });
    if (plateBody) for (const kx of [11, 18]) {                                                   // knee cops and joints
      for (let x = kx; x <= kx + 3; x++) P.g.set(x, 30 + b, STEEL[1]);
      P.g.set(kx + 1, 31 + b, STEEL[4]); P.g.set(kx + 2, 31 + b, STEEL[3]); P.g.set(kx + 3, 32 + b, STEEL[0]);
    }
    // torso + skirt (surcoat / tabard / gambeson / tunic)
    const torso = P.mask().poly([[10, 15 + b], [22, 15 + b], [21, 26 + b], [11, 26 + b]]);
    const skirt = O.robe ? P.mask().poly([[11, 25 + b], [21, 25 + b], [24, 37], [8, 37]])
      : P.mask().poly([[11, 25 + b], [21, 25 + b], [22 + (hem - 30) * 0.3, hem + b], [10 - (hem - 30) * 0.3, hem + b]]);
    if (g.body === 'plate' && !back && !O.torso) {
      P.part(torso, STEEL, { spec: true });                                                           // breastplate under the surcoat
      const surcoat = P.mask().poly([[11.5, 17 + b], [20.5, 17 + b], [21, 26 + b], [11, 26 + b]]);
      P.part(surcoat, torsoFn, { flat: false }); P.part(skirt, torsoFn, { sep: true, sepSides: (dx, dy) => dy < 0 });
    } else {
      P.part(torso, torsoFn, torsoOpts); P.part(skirt, torsoFn, Object.assign({ sep: true, sepSides: (dx, dy) => dy < 0 }, torsoOpts));
    }
    if (O.belt !== false && (O.belt || g.body === 'tunic' || g.body === 'jack' || g.body === 'gambeson')) P.part(P.mask().rect(11, 25 + b, 21, 25 + b), O.belt || LEATHER, { flat: true, base: 1 });   // belt
    // arms
    const armAtk = atk && !back;
    const lArm = P.mask().capsule(9.5, 17 + b, 9 - swing * 0.6, 24 + b, 3.4);
    const rArm = armAtk ? P.mask().capsule(22.5, 17 + b, 25.5, 10 + b, 3.4) : P.mask().capsule(22.5, 17 + b, 24 + swing * 0.6, 24 + b, 3.4);
    P.part(lArm, armRamp, Object.assign({ sep: true }, armOpts)); P.part(rArm, armRamp, Object.assign({ sep: true }, armOpts));
    if (plateBody && O.pauldrons !== false) { P.part(P.mask().ellipse(9.5, 16.5 + b, 3, 2.3), O.pauldrons || STEEL, { spec: true, sep: true }); P.part(P.mask().ellipse(22.5, 16.5 + b, 3, 2.3), O.pauldrons || STEEL, { spec: true, sep: true }); }
    const handRamp = O.hands || (plateBody ? STEEL : g.skin);
    const lh = [9 - swing * 0.6, 25.5 + b], rh = armAtk ? [25.8, 9 + b] : [24 + swing * 0.6, 25.5 + b];
    P.part(P.mask().ellipse(lh[0], lh[1], 1.5, 1.4), handRamp, { sep: true });
    // head
    headFront(g, P, b, back);
    // shield (viewer's left) and weapon (viewer's right)
    if (g.shield) {
      const sm = heaterMask(P.mask(), 2, 17 + b, 12, 16);
      P.part(sm, heraldFn(2, 17 + b, 12, 16), { sep: true, base: 2, flat: true, shade: (x, y) => (x <= 4 ? 1 : x >= 11 ? -1 : 0) });
      sm.each((x, y) => { if (!sm.has(x - 1, y) || !sm.has(x + 1, y) || !sm.has(x, y - 1)) P.g.set(x, y, x < 8 ? STEEL[3] : STEEL[1]); });
      P.g.set(3, 17 + b, STEEL[4]); P.g.set(4, 17 + b, STEEL[4]);
    }
    if (g.weapon === 'longbow') drawWeapon(P, 'longbow', rh[0] + 1.5, rh[1] - (armAtk ? -6 : 3), -90, { draw: armAtk, sep: true });
    else if (g.weapon === 'crossbow') drawWeapon(P, 'crossbow', rh[0] - 3, rh[1] - 1, armAtk ? -100 : -20, { sep: true });
    else {
      const long = ['spear', 'halberd', 'poleaxe', 'bill', 'staff'].includes(g.weapon);
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
      if (g.hairStyle !== 'bald') { hair.rect(13, cy - 6, 19, cy - 6); hair.rect(11, cy - 4, 11, cy); hair.rect(21, cy - 4, 21, cy); }   // volume beyond the skull
      if (g.hairStyle === 'long') { hair.rect(10, cy - 2, 12, cy + 6); hair.rect(20, cy - 2, 22, cy + 6); if (back) hair.rect(12, cy + 3, 20, cy + 6); }
      if (g.hairStyle !== 'bald') P.part(hair, H, { tex: (x, y) => ((x * 5 + y * 3) % 7 === 0 ? 1 : 0) });
    }
    if (!back) {
      // face: brows, eyes, nose, mouth
      // modelling: forehead light, cheek and jaw shadow on the right, a shadow under the brows
      head.each((x, y) => { if (P.g.get(x, y) === pack(S[2]) || P.g.get(x, y) === pack(S[3]) || P.g.get(x, y) === pack(S[1])) {
        if (x >= 19 && y >= cy - 1) P.g.set(x, y, S[1]);
        if (y === cy + 4 && x > 13 && x < 19) P.g.set(x, y, S[1]);
        if (y <= cy - 2 && x <= 16) P.g.set(x, y, S[3]);
      } });
      P.g.set(13, cy - 1, H[0]).set(14, cy - 1, H[1]).set(18, cy - 1, H[1]).set(19, cy - 1, H[0]);
      P.g.set(14, cy, '#1e1210').set(18, cy, '#1e1210').set(13, cy, S[2]).set(15, cy, S[1]).set(17, cy, S[1]).set(19, cy, S[1]);
      P.g.set(16, cy, S[3]).set(16, cy + 1, S[2]).set(17, cy + 1, S[1]).set(16, cy + 2, S[1]).set(17, cy + 2, S[0]).set(13, cy + 2, S[3]);
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
    const plateBody = R0.plateBody !== undefined ? R0.plateBody : g.body === 'plate' || g.body === 'plateMail';
    const S = g.skin, H = g.hair, cy = 9 + b;
    // far side first (darker)
    if (g.shield) {
      const sm = P.mask().poly([[17, 17 + b], [22.5, 17 + b], [22.5, 24 + b], [19.5, 30 + b], [17, 24 + b]]);
      P.part(sm, (x, y) => tRamp(blazon(g.arms, 0.55 + (x - 17) / 12, (y - 17 - b) / 13)), { base: 1 });
    }
    const robe = R0.hem >= 37;
    const farLeg = P.mask().capsule(17, 27 + b, 18 + st, 35, 3.2), nearLeg = P.mask().capsule(15, 27 + b, 14 - st, 35, 3.2);
    if (!robe) P.part(farLeg, R0.legRamp, { base: 1 });
    P.part(P.mask().rect(16 + st, 36, 19 + st, 37), R0.footRamp, { base: 0 });
    P.part(P.mask().capsule(17.5, 17 + b, 18.5 - st * 0.4, 24 + b, 3), R0.armRamp, Object.assign({}, R0.armOpts, { base: 1 }));
    // body
    const torso = P.mask().poly([[12.5, 15 + b], [19, 15 + b], [18.5, 26 + b], [13, 26 + b]]);
    const hem = R0.hem || 30;
    const skirt = P.mask().poly([[13, 25 + b], [18.5, 25 + b], [19.5 + (hem - 30) * 0.4 - st * (robe ? 0.3 : 0), hem + (robe ? 0 : b)], [12 - (hem - 30) * 0.4 - st * (robe ? 0.3 : 0), hem + (robe ? 0 : b)]]);
    const fn = (x, y) => (typeof R0.torsoFn === 'function' ? R0.torsoFn(x + 1, y) : R0.torsoFn);
    if (!robe) P.part(nearLeg, R0.legRamp, plateBody ? { spec: true, sep: true } : { sep: true });
    P.part(P.mask().rect(11 - st, 36, 15 - st, 37), R0.footRamp, { base: 1 });
    P.part(torso, fn, R0.torsoOpts); P.part(skirt, fn, Object.assign({ sep: true, sepSides: (dx, dy) => dy < 0 }, R0.torsoOpts));
    if (plateBody && !(g.over && g.over.pauldrons === false)) P.part(P.mask().ellipse(15.5, 16.5 + b, 2.8, 2.2), (g.over && g.over.pauldrons) || STEEL, { spec: true, sep: true });
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
    const hand = atk ? [9, 21 + b] : [12 + st * 0.3, 24 + b];
    P.part(P.mask().capsule(14.5, 17 + b, hand[0] + 0.5, hand[1] - 0.5, 3.2), R0.armRamp, Object.assign({ sep: true }, R0.armOpts));
    const long = ['spear', 'halberd', 'poleaxe', 'bill', 'staff'].includes(g.weapon);
    if (g.weapon === 'longbow') drawWeapon(P, 'longbow', atk ? 7 : hand[0] - 1, atk ? 21 + b : hand[1] - 3, -90, { draw: false, flip: true, sep: true });
    else if (g.weapon === 'crossbow') drawWeapon(P, 'crossbow', hand[0] + 3, hand[1] - (atk ? 4 : 0), atk ? 180 : -150, { sep: true });
    else drawWeapon(P, g.weapon, hand[0] - (atk ? 0 : 1), hand[1], atk ? (long ? 180 : 195) : long ? -93 : -98, { sep: true });
    P.part(P.mask().ellipse(hand[0], hand[1], 1.5, 1.4), R0.handRamp || (plateBody ? STEEL : S), {});
    return P.done();
  }


  // ================================================================ FOOT SOLDIERS
  // The rank and file, drawn with fuller bodies than the old frame (still used by heroes
  // and riders): legs about a third of the height, thick enough to touch at the thigh,
  // with knees and boots or sabatons; a chest tapering to the waist with a fauld or skirt
  // over the hips; shoulders broader than the waist. Each troop has its own silhouette
  // so a block reads at a glance: knights in plate with shield and surcoat, men-at-arms
  // in plate and mail with polearms, spearmen in padded coats with tall spears, archers
  // in jacks with a bow as tall as themselves and a quiver, levies in plain tunics.
  // kitOf: what this soldier wears, worked out once from the genome.
  function kitOf(g) {
    const plate = g.body === 'plate' || g.body === 'plateMail';
    const K = {
      plate,
      leg: plate ? STEEL : g.body === 'tunic' ? g.drab : g.hose,
      boots: !plate,
      arm: plate || g.body === 'mailTabard' ? STEEL : g.body === 'tunic' ? g.drab : g.liv,
      armOpts: g.body === 'plateMail' || g.body === 'mailTabard' ? { tex: mailTex, base: 1 } : plate ? { spec: true } : g.body === 'tunic' ? {} : { tex: quiltTex },
      hand: plate ? STEEL : g.body === 'gambeson' ? LEATHER : g.skin,
      robe: !!(g.over && g.over.robe),
      // what covers the body and how far down it hangs
      coat: g.body === 'plate' ? 'surcoat' : g.body === 'plateMail' ? 'brigandine' : g.body === 'mailTabard' ? 'tabard'
        : g.body === 'gambeson' ? 'gambeson' : g.body === 'jack' ? 'jack' : 'tunic',
    };
    K.hem = K.robe ? 37 : { surcoat: 29, tabard: 29, brigandine: 27, gambeson: 29, jack: 28, tunic: 29 }[K.coat];
    K.quiver = g.weapon === 'longbow' || g.weapon === 'crossbow';
    return K;
  }
  const LONG = ['spear', 'halberd', 'poleaxe', 'bill', 'staff'];

  // One 32 x 40 frame of a foot soldier. dir: 0 front, 1 back, 2 side (facing left).
  function footFrame(g, dir, pose, step) {
    const P = new Painter(32, 40);
    const K = kitOf(g);
    const atk = pose === 'attack';
    const b = pose === 'walk' && step % 2 === 1 ? -1 : 0;           // the body rises between steps
    if (dir === 2) return footSide(g, P, K, pose, step, b);
    const back = dir === 1;
    const lift = pose === 'walk' ? [0, 1, 0, 2][step] : 0;          // 1: viewer's-left leg up, 2: the other
    const swing = pose === 'walk' ? [0, 1, 0, -1][step] : 0;
    const heraldFn = (x0, y0, w, h) => (x, y) => tRamp(blazon(g.arms, (x - x0) / w, (y - y0) / h));
    const coatFn = K.robe ? (x => (x >= 15 && x <= 17 ? g.livMetal : g.liv))
      : K.coat === 'surcoat' || K.coat === 'tabard' ? heraldFn(10.5, 15 + b, 11, 15)
      : K.coat === 'tunic' ? () => g.drab : K.coat === 'jack' ? () => mixRamp(g.liv, LEATHER) : () => g.liv;
    const coatOpts = K.coat === 'gambeson' || K.coat === 'jack' ? { tex: quiltTex } : {};

    // a quiver on the back (seen over the shoulder from the front)
    if (K.quiver && !back) {
      P.part(P.mask().rect(21, 9 + b, 23, 15 + b), LEATHER, { base: 1 });
      for (const [x, c] of [[21, '#e8e0c8'], [22, '#b83a2a'], [23, '#e8e0c8']]) P.g.set(x, 8 + b, c);
    }
    // legs: thigh and shin, touching at the top; plate legs get knee cops, the rest boots
    for (const s of [-1, 1]) {
      const up = (lift === 1 && s === -1) || (lift === 2 && s === 1) ? 1.5 : 0;
      const hx = 16 + s * 2.5, kx = 16 + s * 3, ax = 16 + s * 3.2, ky = 30 + b * 0.5 - up, ay = 35 - up;
      if (!K.robe) {
        P.part(P.mask().capsule(hx, 23.5 + b, kx, ky, 5), K.leg, K.plate ? { spec: true, sep: true } : { sep: true });
        P.part(P.mask().capsule(kx, ky, ax, ay, 4.2), K.leg, K.plate ? { spec: true, sep: true } : { sep: true });
        if (K.plate) P.part(P.mask().ellipse(kx, ky, 1.9, 1.5), STEEL, { spec: true, sep: true });           // knee cop
        else P.part(P.mask().capsule(kx, ky + 2.5, ax, ay, 4.4), LEATHER, { sep: true, sepSides: (dx, dy) => dy < 0 });   // boot
      }
      // foot: turned a little outward
      P.part(P.mask().poly([[ax - 2.4 + s * 0.6, ay], [ax + 2.4 + s * 0.6, ay], [ax + 2.8 + s * 1.2, ay + 2.4], [ax - 2.2 + s * 1.2, ay + 2.4]]),
        K.plate ? STEEL : LEATHER, { base: 1, sep: true });
    }
    // hips: a skirt, fauld or robe hanging from the waist
    const hem = K.hem;
    const skirt = K.robe ? P.mask().poly([[11, 22 + b], [21, 22 + b], [24, 37], [8, 37]])
      : P.mask().poly([[11, 22 + b], [21, 22 + b], [22.5, hem + b], [9.5, hem + b]]);
    if (K.coat === 'brigandine') {                                     // steel fauld bands under a short coat
      P.part(P.mask().poly([[11, 22 + b], [21, 22 + b], [22, 27 + b], [10, 27 + b]]), STEEL, { spec: true, sep: true });
      for (let x = 10; x <= 22; x++) P.g.set(x, 24 + b, STEEL[1]), P.g.set(x, 26 + b, STEEL[0]);
    } else P.part(skirt, coatFn, Object.assign({ sep: true, sepSides: (dx, dy) => dy < 0 }, coatOpts));
    // torso: a full chest tapering to the waist
    const torso = P.mask().poly([[10, 13.5 + b], [22, 13.5 + b], [21.5, 18.5 + b], [20.5, 23 + b], [11.5, 23 + b], [10.5, 18.5 + b]]);
    if (K.coat === 'surcoat' && !back) {
      P.part(torso, STEEL, { spec: true });                             // breastplate showing at the top
      P.part(P.mask().poly([[11, 16.5 + b], [21, 16.5 + b], [20.5, 23 + b], [11.5, 23 + b]]), coatFn, { sep: true });
    } else P.part(torso, coatFn, coatOpts);
    if (K.coat === 'brigandine') {                                     // rivets on the coat
      for (let y = 16; y <= 21; y += 2) for (let x = 12 + (y % 4 ? 1 : 0); x <= 20; x += 3) P.g.set(x, y + b, g.livMetal[3]);
    }
    if (!K.robe) P.part(P.mask().rect(11, 22 + b, 21, 22 + b), K.coat === 'surcoat' ? g.livMetal : LEATHER, { flat: true, base: 1 });   // belt
    if (K.coat === 'surcoat' || K.coat === 'tabard') P.g.set(16, 22 + b, g.livMetal[4]);                  // buckle
    // arms: upper arm and forearm with a bend at the elbow; pauldrons on plate
    const armAtk = atk && !back;
    const L1 = [9.5, 15.5 + b], L2 = [8.6 - swing * 0.4, 20.5 + b], L3 = [9.2 - swing * 0.7, 25 + b];
    const R1 = [22.5, 15.5 + b], R2 = armAtk ? [24.5, 11 + b] : [23.4 + swing * 0.4, 20.5 + b], R3 = armAtk ? [25, 7.5 + b] : [23 + swing * 0.7, 25 + b];
    for (const [a, c] of [[L1, L2], [L2, L3], [R1, R2], [R2, R3]]) P.part(P.mask().capsule(a[0], a[1], c[0], c[1], 3.8), K.arm, Object.assign({ sep: true }, K.armOpts));
    if (K.plate) for (const [x, y] of [L2, R2]) P.part(P.mask().ellipse(x, y, 1.6, 1.3), STEEL, { spec: true, sep: true });   // couters
    if (K.plate || K.coat === 'tabard') for (const x of [9.5, 22.5]) P.part(P.mask().ellipse(x, 14.5 + b, 3.4, 2.6), STEEL, { spec: true, sep: true });
    else if (K.coat === 'gambeson' || K.coat === 'jack') for (const x of [10, 22]) P.part(P.mask().ellipse(x, 14.5 + b, 2.6, 2), K.coat === 'jack' ? LEATHER : g.liv, { sep: true });
    P.part(P.mask().ellipse(L3[0], L3[1] + 1, 1.7, 1.5), K.hand, { sep: true });
    footHead(g, P, 16, 8 + b, back);
    // shield on the viewer's left, held across the arm: a smaller heater with a dark rim
    if (g.shield) {
      const sm = heaterMask(P.mask(), 3, 16 + b, 11, 14);
      P.part(sm, heraldFn(3, 16 + b, 11, 14), { sep: true, base: 2, flat: true, shade: (x, y) => (x <= 5 && y < 24 + b ? 1 : x >= 12 ? -1 : 0) });
      sm.each((x, y) => { if (!sm.has(x - 1, y) || !sm.has(x + 1, y) || !sm.has(x, y - 1) || !sm.has(x, y + 1)) P.g.set(x, y, x < 8 && y < 24 + b ? STEEL[2] : STEEL[0]); });
      P.g.set(4, 16 + b, STEEL[4]); P.g.set(5, 16 + b, STEEL[3]);
      if (back) { sm.each((x, y) => { if (sm.has(x - 1, y) && sm.has(x + 1, y) && sm.has(x, y - 1) && sm.has(x, y + 1)) P.g.set(x, y, (x + y) % 5 ? WOODR[2] : WOODR[1]); }); P.part(P.mask().rect(5, 21 + b, 12, 21 + b), LEATHER, { flat: true }); }
    }
    // weapon in the other hand: blades held point-down at the side, poles upright
    const rh = R3;
    if (g.weapon === 'longbow') drawWeapon(P, 'longbow', rh[0] + 2, rh[1] - (armAtk ? -8 : 4), -90, { draw: armAtk, sep: true });
    else if (g.weapon === 'crossbow') drawWeapon(P, 'crossbow', rh[0] - 3, rh[1] - 1, armAtk ? -100 : -20, { sep: true });
    else if (g.weapon !== 'none') {
      const long = LONG.includes(g.weapon);
      drawWeapon(P, g.weapon, rh[0], rh[1], armAtk ? (long ? -60 : -150) : long ? -88 : 70, { sep: true });
    }
    P.part(P.mask().ellipse(rh[0], rh[1], 1.7, 1.5), K.hand, { sep: false });
    const img = P.done();
    return back ? img.flipX() : img;
  }

  // Side view, facing left: the near (left) side shows the shield's arms or the bow;
  // the weapon arm is on the far side.
  function footSide(g, P, K, pose, step, b) {
    const atk = pose === 'attack';
    const st = pose === 'walk' ? [2.6, 0, -2.6, 0][step] : atk ? 3 : 0.8;
    const S = g.skin, H = g.hair, cy = 8 + b;
    const long = LONG.includes(g.weapon);
    const legOpts = s => K.plate ? { spec: true, sep: s } : { sep: s };
    const leg = (dx, near) => {                                          // dx: how far forward (negative) the foot is
      const kx = 16 + dx * 0.5, ax = 16 + dx, base = near ? 2 : 1;
      P.part(P.mask().capsule(16, 23.5 + b, kx, 30 + b * 0.5, 5), K.leg, Object.assign({ base }, legOpts(near)));
      P.part(P.mask().capsule(kx, 30 + b * 0.5, ax, 35, 4.2), K.leg, Object.assign({ base }, legOpts(near)));
      if (K.plate) P.part(P.mask().ellipse(kx - 1, 30 + b * 0.5, 1.4, 1.5), STEEL, { spec: true });
      else P.part(P.mask().capsule(kx, 32.5, ax, 35, 4.4), LEATHER, { base, sep: true, sepSides: (ddx, dy) => dy < 0 });
      P.part(P.mask().poly([[ax - 4, 35.2], [ax + 2, 35.2], [ax + 2, 37.4], [ax - 4.4, 37.4]]), K.plate ? STEEL : LEATHER, { base: base - 1 + 1, sep: near });
    };
    // far side first: the weapon arm and its weapon, the far leg
    const fh = atk ? [9, 18 + b] : [18.5 - st * 0.3, 24 + b];
    if (g.weapon !== 'none' && g.weapon !== 'longbow') {
      if (g.weapon === 'crossbow') drawWeapon(P, 'crossbow', fh[0] - 2, fh[1] - (atk ? 4 : 1), atk ? 180 : -150, {});
      else drawWeapon(P, g.weapon, fh[0], fh[1], atk ? (long ? 180 : 200) : long ? -96 : 125, {});
    }
    P.part(P.mask().capsule(17.5, 15.5 + b, (17.5 + fh[0]) / 2 + 1, (15.5 + b + fh[1]) / 2 + 1, 3.6).capsule((17.5 + fh[0]) / 2 + 1, (15.5 + b + fh[1]) / 2 + 1, fh[0], fh[1], 3.4), K.arm, Object.assign({}, K.armOpts, { base: 1 }));
    P.part(P.mask().ellipse(fh[0], fh[1], 1.6, 1.5), K.hand, { base: 1 });
    if (!K.robe) leg(st, false);
    else P.part(P.mask().rect(15 + st, 35.5, 18 + st, 37), LEATHER, { base: 0 });
    // body: chest forward (to the left), a straight back
    const torso = P.mask().poly([[12.5, 13.5 + b], [19, 13.5 + b], [19.5, 18 + b], [18.5, 23 + b], [13.5, 23 + b], [12, 18 + b]]);
    const hem = K.hem, robe = K.robe;
    const skirt = P.mask().poly([[13, 22 + b], [19, 22 + b], [20 + (hem - 29) * 0.35 - st * (robe ? 0.3 : 0), hem + (robe ? 0 : b)], [11.5 - (hem - 29) * 0.35 - st * (robe ? 0.3 : 0), hem + (robe ? 0 : b)]]);
    const fn = robe ? g.liv : K.coat === 'surcoat' || K.coat === 'tabard' ? ((x, y) => tRamp(blazon(g.arms, 0.25 + (x - 12) / 14, (y - 15 - b) / 15)))
      : K.coat === 'tunic' ? g.drab : K.coat === 'jack' ? mixRamp(g.liv, LEATHER) : g.liv;
    const fOpts = K.coat === 'gambeson' || K.coat === 'jack' ? { tex: quiltTex } : {};
    if (!robe) leg(-st, true);
    else P.part(P.mask().rect(11 - st, 35.5, 15 - st, 37), LEATHER, { base: 1 });
    if (K.coat === 'brigandine') {
      P.part(P.mask().poly([[13, 22 + b], [19, 22 + b], [20, 27 + b], [12, 27 + b]]), STEEL, { spec: true, sep: true, sepSides: (dx, dy) => dy < 0 });
      for (let x = 12; x <= 20; x++) P.g.set(x, 24 + b, STEEL[1]);
    } else P.part(skirt, fn, Object.assign({ sep: true, sepSides: (dx, dy) => dy < 0 }, fOpts));
    P.part(torso, K.coat === 'surcoat' ? STEEL : fn, K.coat === 'surcoat' ? { spec: true } : fOpts);
    if (K.coat === 'surcoat') P.part(P.mask().poly([[12.5, 16.5 + b], [19, 16.5 + b], [18.5, 23 + b], [13.5, 23 + b]]), fn, {});
    if (!robe) P.part(P.mask().rect(13, 22 + b, 19, 22 + b), K.coat === 'surcoat' ? g.livMetal : LEATHER, { flat: true, base: 1 });
    if (K.quiver) { P.part(P.mask().rect(19, 13 + b, 21, 21 + b), LEATHER, { base: 1, sep: true }); P.g.set(19, 12 + b, '#e8e0c8').set(20, 11 + b, '#b83a2a').set(21, 12 + b, '#e8e0c8'); }
    // head and neck (smaller than a hero's, as in footHead)
    P.part(P.mask().rect(14, 11 + b, 17, 13 + b), S, { base: 1 });
    const head = P.mask().ellipse(15.5, cy, 3.7, 4.4);
    P.part(head, S, {});
    P.g.set(11, cy + 1, S[2]);                                                                       // nose
    if (g.hairStyle !== 'bald') {
      const hm = P.mask(); head.each((x, y) => { if (y <= cy - 2 || x >= 16) hm.add(x, y); });
      if (g.hairStyle === 'long') hm.rect(17, cy, 18, cy + 5);
      P.part(hm, H, { tex: (x, y) => ((x * 5 + y * 3) % 7 === 0 ? 1 : 0) });
    }
    P.g.set(12, cy - 1, H[1]).set(13, cy - 1, H[1]).set(13, cy, '#1a1420').set(12, cy + 3, mix(S[1], '#8a2a2a', 0.45));
    if (g.beard === 'full') { const bm = P.mask(); head.each((x, y) => { if (y >= cy + 2 && x <= 16) bm.add(x, y); }); bm.rect(12, cy + 4, 15, cy + 5); P.part(bm, H, {}); }
    if (g.beard === 'moustache') P.g.set(12, cy + 2, H[1]).set(13, cy + 2, H[1]);
    const steel = { spec: true, sep: true };
    switch (g.helm) {
      case 'greathelm': { const m = P.mask().rect(11.5, cy - 3, 19.5, cy + 4).ellipse(15.5, cy - 3, 4.2, 2.6); m.del(12, cy + 4); P.part(m, STEEL, steel); for (let x = 11; x <= 14; x++) P.g.set(x, cy - 1, INK); P.g.set(12, cy + 2, INK); break; }
      case 'bascinet': { const m = P.mask().ellipse(15.5, cy - 1.5, 4.1, 3.8); m.add(17, cy - 5).add(18, cy - 5); m.each((x, y) => { if (y >= cy - 1 && x < 15) m.del(x, y); }); P.part(m, STEEL, steel); P.part(P.mask().rect(14, cy + 3, 19, cy + 5).rect(17, cy - 1, 19, cy + 3), STEEL, { tex: mailTex, base: 1, sep: true }); break; }
      case 'sallet': { const m = P.mask().ellipse(15.8, cy - 1.5, 4.3, 3.8); m.rect(16, cy - 1, 21, cy); m.each((x, y) => { if (y > cy - 1 && x < 16) m.del(x, y); }); P.part(m, STEEL, steel); break; }
      case 'kettle': { const m = P.mask().ellipse(15.5, cy - 2.5, 3.6, 3); m.rect(10, cy - 1, 21, cy - 1); P.part(m, STEEL, steel); break; }
      case 'coif': case 'hood': { const m = P.mask().ellipse(15.8, cy, 4.4, 5); m.rect(14, cy + 3, 19, cy + 5); m.each((x, y) => { if (x <= 14 && y >= cy - 2 && y <= cy + 3) m.del(x, y); }); P.part(m, g.helm === 'coif' ? STEEL : g.liv, g.helm === 'coif' ? { tex: mailTex, base: 1, sep: true } : { sep: true }); break; }
      case 'cap': { const m = P.mask().ellipse(15.8, cy - 2.6, 4.1, 2.4); P.part(m, g.drab, { sep: true }); break; }
    }
    if (g.plume && (g.helm === 'greathelm' || g.helm === 'bascinet' || g.helm === 'sallet')) P.part(P.mask().capsule(16, cy - 5, 19, cy - 8, 2.2).capsule(19, cy - 8, 21, cy - 7, 1.8), tRamp(g.arms.A), { sep: true });
    // near side: pauldron, the shield arm, and the shield showing its arms (or the bow)
    if (K.plate || K.coat === 'tabard') P.part(P.mask().ellipse(15.5, 15 + b, 3, 2.4), STEEL, { spec: true, sep: true });
    const nh = atk && g.weapon === 'longbow' ? [8, 18 + b] : [13 - st * 0.3, 22.5 + b];
    P.part(P.mask().capsule(15, 15.5 + b, 14.5 - st * 0.2, 19.5 + b, 3.8).capsule(14.5 - st * 0.2, 19.5 + b, nh[0], nh[1], 3.5), K.arm, Object.assign({ sep: true }, K.armOpts));
    if (g.shield) {
      const sm = P.mask().poly([[7.5, 15.5 + b], [14, 15.5 + b], [14, 23.5 + b], [11, 29 + b], [7.5, 23.5 + b]]);
      P.part(sm, (x, y) => tRamp(blazon(g.arms, 0.15 + (x - 7.5) / 9, (y - 15.5 - b) / 14)), { sep: true, flat: true, shade: (x, y) => (x <= 8 ? 1 : x >= 13 ? -1 : 0) });
      sm.each((x, y) => { if (!sm.has(x - 1, y) || !sm.has(x + 1, y) || !sm.has(x, y - 1)) P.g.set(x, y, y < 18 + b ? STEEL[2] : STEEL[0]); });
      P.g.set(8, 15 + b, STEEL[4]);
    } else if (g.weapon === 'longbow') drawWeapon(P, 'longbow', atk ? 7 : nh[0] - 1, atk ? 18 + b : nh[1] - 4, -90, { flip: true, sep: true });
    P.part(P.mask().ellipse(nh[0], nh[1], 1.6, 1.5), K.hand, {});
    return P.done();
  }

  // A foot soldier's head, smaller than the heroes' (so the body reads as about four
  // heads tall), facing the viewer (or away). Helms are rounded and close-fitting:
  // the great helm is a rounded barrel with a visor slit, breaths and a centre ridge.
  function footHead(g, P, cx, cy, back) {
    const S = g.skin, H = g.hair;
    P.part(P.mask().rect(cx - 2, cy + 3, cx + 2, cy + 5), S, { base: 1 });                     // neck
    const head = P.mask().ellipse(cx, cy, 3.9, 4.4);
    P.part(head, S, { shade: (x, y) => (x >= cx + 2 ? -1 : 0) });
    if (g.hairStyle !== 'bald' || back) {
      const hair = P.mask();
      head.each((x, y) => { if (back ? y <= cy + 3 : (y <= cy - 2 || ((x <= cx - 3 || x >= cx + 3) && y <= cy + (g.hairStyle === 'long' ? 4 : 0)))) hair.add(x, y); });
      if (g.hairStyle !== 'bald') hair.rect(cx - 2, cy - 5, cx + 2, cy - 5);
      if (g.hairStyle === 'long') { hair.rect(cx - 4, cy - 1, cx - 3, cy + 5); hair.rect(cx + 3, cy - 1, cx + 4, cy + 5); if (back) hair.rect(cx - 3, cy + 3, cx + 3, cy + 5); }
      if (g.hairStyle !== 'bald') P.part(hair, H, { tex: (x, y) => ((x * 5 + y * 3) % 7 === 0 ? 1 : 0) });
    }
    if (!back) {
      // brows, eyes, nose shadow, mouth; cheek shadow on the right
      head.each((x, y) => { const v = P.g.get(x, y); if (v === pack(S[2]) || v === pack(S[3])) { if (x >= cx + 2 && y >= cy) P.g.set(x, y, S[1]); if (y <= cy - 2 && x <= cx) P.g.set(x, y, S[3]); } });
      P.g.set(cx - 2, cy - 1, H[0]).set(cx - 1, cy - 1, H[1]).set(cx + 1, cy - 1, H[1]).set(cx + 2, cy - 1, H[0]);
      P.g.set(cx - 2, cy, '#1a1420').set(cx + 2, cy, '#1a1420').set(cx - 1, cy, S[2]).set(cx + 1, cy, S[1]);
      P.g.set(cx, cy + 1, S[1]).set(cx + 1, cy + 1, S[0]);
      P.g.set(cx - 1, cy + 3, mix(S[1], '#8a2a2a', 0.45)).set(cx, cy + 3, mix(S[1], '#8a2a2a', 0.45));
      if (g.beard === 'full') { const bm = P.mask(); head.each((x, y) => { if (y >= cy + 2 && !(y === cy + 3 && Math.abs(x - cx + 0.5) < 1.5)) bm.add(x, y); }); bm.rect(cx - 2, cy + 5, cx + 2, cy + 5); P.part(bm, H, { tex: (x, y) => ((x + y) % 3 === 0 ? -1 : 0) }); }
      if (g.beard === 'moustache') P.g.set(cx - 2, cy + 2, H[1]).set(cx - 1, cy + 2, H[1]).set(cx + 1, cy + 2, H[1]).set(cx + 2, cy + 2, H[1]);
      if (g.beard === 'stubble') head.each((x, y) => { if (y >= cy + 2 && (x + y) % 2 === 0 && !(y === cy + 3 && Math.abs(x - cx + 0.5) < 1.5)) P.g.set(x, y, mix(S[1], H[1], 0.5)); });
    }
    const steel = { spec: true, sep: true };
    switch (g.helm) {
      case 'greathelm': {                                    // rounded barrel helm
        const m = P.mask().rect(cx - 4, cy - 3, cx + 4, cy + 4).ellipse(cx, cy - 3, 4.4, 2.6);
        m.del(cx - 4, cy + 4).del(cx + 4, cy + 4);
        P.part(m, STEEL, steel);
        if (!back) {
          for (let x = cx - 3; x <= cx + 3; x++) if (x !== cx) P.g.set(x, cy - 1, INK);              // visor slit
          P.g.set(cx - 3, cy - 1, STEEL[0]);
          for (const [x, y] of [[cx + 2, cy + 1], [cx + 2, cy + 3], [cx + 3, cy + 2]]) P.g.set(x, y, INK);   // breaths
          for (let y = cy - 4; y <= cy + 4; y++) P.g.set(cx, y, y === cy - 1 ? STEEL[2] : STEEL[3]);        // centre ridge
          P.g.set(cx - 2, cy - 4, STEEL[4]);
        } else for (let y = cy - 4; y <= cy + 4; y++) P.g.set(cx, y, STEEL[2]);
        break;
      }
      case 'bascinet': {
        const m = P.mask().ellipse(cx, cy - 1.5, 4.1, 3.8); m.add(cx, cy - 6).add(cx, cy - 5);
        if (!back) m.each((x, y) => { if (y >= cy - 1) m.del(x, y); });
        P.part(m, STEEL, steel);
        const av = P.mask();                                  // mail aventail round the face
        for (let y = cy - 1; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) {
          const face = !back && Math.abs(x - cx) <= 3 && y <= cy + 3;
          if (!face && (y >= cy + 3 || Math.abs(x - cx) >= 3) && Math.hypot((x - cx) / 5.2, (y - cy - 1) / 5) <= 1.05) av.add(x, y);
        }
        P.part(av, STEEL, { tex: mailTex, base: 1, sep: true });
        break;
      }
      case 'sallet': {
        const m = P.mask().ellipse(cx, cy - 1.5, 4.3, 3.8); m.rect(cx - 5, cy - 1, cx + 5, cy - 1);
        if (!back) m.each((x, y) => { if (y > cy - 1) m.del(x, y); });
        else m.rect(cx - 3, cy - 1, cx + 3, cy + 2);
        P.part(m, STEEL, steel);
        if (!back) for (let x = cx - 3; x <= cx + 3; x++) P.g.set(x, cy - 1, x === cx ? STEEL[2] : INK);
        break;
      }
      case 'kettle': {
        const m = P.mask().ellipse(cx, cy - 2.5, 3.8, 3); m.rect(cx - 6, cy - 1, cx + 6, cy - 1); m.rect(cx - 5, cy - 2, cx + 5, cy - 2);
        P.part(m, STEEL, steel);
        break;
      }
      case 'coif': case 'hood': {
        const mailHood = g.helm === 'coif';
        const m = P.mask().ellipse(cx, cy, 4.7, 5); m.rect(cx - 4, cy + 3, cx + 4, cy + 5);
        if (!back) m.each((x, y) => { if (Math.abs(x - cx) <= 2.6 && y >= cy - 2 && y <= cy + 3) m.del(x, y); });
        P.part(m, mailHood ? STEEL : g.liv, mailHood ? { tex: mailTex, base: 1, sep: true } : { sep: true });
        if (!mailHood && back) P.part(P.mask().capsule(cx, cy + 4, cx + 1, cy + 8, 2), g.liv, {});
        break;
      }
      case 'cap': {
        const m = P.mask().ellipse(cx, cy - 2.6, 4.1, 2.4); m.rect(cx - 4, cy - 2, cx + 4, cy - 2);
        P.part(m, g.drab, { sep: true });
        break;
      }
    }
    if (g.plume && (g.helm === 'greathelm' || g.helm === 'bascinet' || g.helm === 'sallet'))
      P.part(P.mask().capsule(cx, cy - 5, cx + 3, cy - 8, 2.2).capsule(cx + 3, cy - 8, cx + 6, cy - 7, 1.8), tRamp(g.arms.A), { sep: true });
  }

  // A ramp halfway between two others (a leather jack dyed in the livery).
  function mixRamp(a, c) { return a.map((x, i) => mix(x, c[i], 0.55)); }

  // A fallen soldier: the front frame laid on its side over a pool of blood.
  function corpse(g, seed, flip) {
    const r = R.make(seed, 'corpse' + flip);
    const up = footFrame(Object.assign({}, g, { weapon: 'none', shield: g.shield && r.chance(0.5) }), 0, 'walk', 0);
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
      const fr = col === 3 ? footFrame(g, 2, pose, row).flipX() : footFrame(g, col, pose, row);
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
  const PROPS = ['pavilion', 'palisade', 'gatehouse', 'banner', 'haybale', 'campfire', 'oak', 'pine', 'bush', 'rock', 'stump', 'barrel', 'crates', 'weaponrack', 'cart'];
  function genProp(o) {
    const r = R.make(o.seed, 'prop');
    const kind = o.prop || r.pick(PROPS);
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
      // a thatched lookout on four posts over a pair of braced gate doors
      P = new Painter(56, 64);
      const HAY = ['#5a4418', '#806428', '#a88a3a', '#ccae54', '#e8cc72'];
      for (const x of [5, 47]) P.part(P.mask().rect(x, 10, x + 3, 63), WOODR, { sep: true, tex: (xx, yy) => ((yy * 3 + xx) % 11 === 0 ? -1 : 0) });
      P.part(P.mask().rect(3, 24, 52, 27), WOODR, { sep: true, tex: (x) => (x % 5 === 0 ? -1 : 0) });            // platform beam
      for (let x = 6; x < 50; x += 3) P.part(P.mask().rect(x, 17, x + 1, 23), WOODR, { base: 1 });             // railing
      P.part(P.mask().rect(4, 16, 51, 17), WOODR, { sep: true });
      const roof = P.mask().poly([[10, 2], [45, 2], [55, 13], [0, 13]]);
      P.part(roof, HAY, { tex: (x, y) => ((x * 3 + y * 7) % 5 === 0 ? 1 : (x + y * 2) % 7 === 0 ? -1 : 0), shade: (x, y) => (y < 5 ? 1 : 0) - (x > 44 ? 1 : 0), sep: true });
      for (let x = 0; x < 56; x++) { P.g.set(x, 14, x % 3 ? HAY[1] : HAY[0]); if (x % 3 === 1) P.g.set(x, 15, HAY[0]); }   // ragged eave
      for (const side of [0, 1]) {                                                                               // gate doors
        const x0 = side ? 28 : 9, x1 = side ? 46 : 27;
        P.part(P.mask().rect(x0, 30, x1, 63), WOODR, { sep: true, tex: (x) => ((x - x0) % 4 === 0 ? -1 : 0), shade: () => (side ? -1 : 0) });
        P.part(P.mask().rect(x0, 34, x1, 35).rect(x0, 56, x1, 57), WOODR, { base: 1 });
        P.part(P.mask().capsule(side ? x1 - 1 : x0 + 1, 55, side ? x0 + 1 : x1 - 1, 36, 2), WOODR, { base: 1, sep: true });   // Z brace
        for (const y of [34, 56]) P.g.set(side ? x1 - 1 : x0 + 1, y, STEEL[1]).set(side ? x1 - 2 : x0 + 2, y, STEEL[2]);
      }
      P.g.set(27, 46, STEEL[3]).set(28, 46, STEEL[3]);                                                            // ring handles
    } else if (kind === 'oak' || kind === 'bush') {
      // a canopy of overlapping leaf clumps, lit from the top-left, with leaf strokes like the meadow
      const big = kind === 'oak';
      P = big ? new Painter(48, 56) : new Painter(28, 22);
      const LEAF = ['#16301a', '#224622', '#2e5e2a', '#3e7430', '#548a3a', '#74a44a'].map(c => mix(c, r.pick(['#3a6a2a', '#5a7a2a', '#2a6a3a']), 0.15));
      if (big) {
        const tr = P.mask().poly([[21, 30], [27, 30], [28, 50], [32, 54], [16, 54], [20, 50]]);
        P.part(tr, WOODR, { tex: (x, y) => ((x * 5 + y) % 7 === 0 ? -1 : 0) });
      }
      const cx = P.w / 2, cy = big ? 22 : 13, R0 = big ? 19 : 11, blobs = [];
      for (let i = 0; i < (big ? 9 : 5); i++) { const a = r() * Math.PI * 2, d = r() * R0 * 0.5; blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, R0 * r.range(0.35, 0.55)]); }
      const can = P.mask(); for (const [x, y, rr] of blobs) can.ellipse(x, y, rr, rr * 0.9);
      P.part(can, LEAF, { flat: true, base: 1, shade: (x, y) => {
        let best = 9, bl = null; for (const b of blobs) { const d = Math.hypot(x - b[0], y - b[1]) / b[2]; if (d < best) { best = d; bl = b; } }
        const lx = (x - bl[0]) / bl[2], ly = (y - bl[1]) / bl[2];
        return (lx + ly < -0.6 ? 2 : lx + ly < 0.1 ? 1 : lx + ly > 0.8 ? -1 : 0) + ((y - cy) / R0 < -0.35 ? 1 : (y - cy) / R0 > 0.35 ? -1 : 0) + ((x * 7 + y * 3) % 5 === 0 ? 1 : (x * 3 + y * 5) % 7 === 0 ? -1 : 0);
      } });
      for (let i = 0; i < (big ? 3 : 1); i++) { const fx = cx + r.range(-R0 * 0.5, R0 * 0.5), fy = cy + r.range(-R0 * 0.3, R0 * 0.4); if (can.has(Math.round(fx), Math.round(fy)) && !big) P.g.set(fx, fy, r.pick(['#e8d8f0', '#f0e8a0', '#e05060'])); }
    } else if (kind === 'pine') {
      P = new Painter(32, 56);
      P.part(P.mask().rect(14, 42, 17, 54), WOODR, {});
      const LEAF = ramp(r.pick(['#2a5a34', '#2e6040', '#244e30']), 6, 0.55);
      for (let t = 0; t < 4; t++) {
        const top = 2 + t * 10, h = 16, half = 7 + t * 2.6;
        const m = P.mask(); for (let y = 0; y < h; y++) { const hw = half * (y + 1) / h; for (let x = Math.round(16 - hw); x <= Math.round(16 + hw); x++) if (!(y === h - 1 && x % 3 === 0)) m.add(x, top + y); }
        P.part(m, LEAF, { sep: t > 0, sepSides: (dx, dy) => dy < 0 });
      }
    } else if (kind === 'rock') {
      P = new Painter(28, 20);
      const ST = ramp(r.pick(['#7a7e84', '#80786c', '#6e7478']), 6, 0.6);
      const m = P.mask(); for (let i = 0; i < 4; i++) m.ellipse(14 + r.range(-6, 6), 12 + r.range(-2, 3), r.range(4, 7), r.range(3, 5));
      P.part(m, ST, { flat: true, base: 2, shade: (x, y) => ((x - 14) + (y - 10) * 1.6 < -6 ? 2 : (x - 14) + (y - 10) * 1.6 < 0 ? 1 : (x - 14) + (y - 10) * 1.6 > 8 ? -1 : 0) + ((x * 5 + y * 3) % 11 === 0 ? -1 : 0) });
      if (r.chance(0.6)) for (let i = 0; i < 4; i++) { const x = r.int(6, 22), y = r.int(4, 10); if (m.has(x, y)) P.g.set(x, y, '#6a8a3e'); }   // moss
    } else if (kind === 'stump') {
      P = new Painter(20, 18);
      P.part(P.mask().rect(4, 7, 15, 15).ellipse(9.5, 15, 7, 2), WOODR, { tex: (x) => (x % 3 === 0 ? -1 : 0) });
      P.part(P.mask().ellipse(9.5, 7, 6, 2.6), ['#6a4a28', '#8a6a3e', '#b0905a', '#c8a870', '#dcc088'], { flat: true, base: 2, shade: (x, y) => (Math.round(Math.hypot((x - 9.5) / 1.6, y - 7)) % 2 ? -1 : 0) });
    } else if (kind === 'barrel') {
      P = new Painter(16, 20);
      P.part(P.mask().ellipse(8, 10, 6, 8.5), WOODR, { tex: (x) => (x % 3 === 0 ? -1 : 0) });
      for (const y of [4, 15]) P.part(P.mask().rect(2, y, 14, y), STEEL, { base: 1, spec: true });
      P.part(P.mask().ellipse(8, 2.5, 5, 1.5), WOODR, { base: 3, flat: true });
    } else if (kind === 'crates') {
      P = new Painter(32, 28);
      const box = (x0, y0, s) => {
        P.part(P.mask().rect(x0, y0, x0 + s, y0 + s), WOODR, { sep: true, tex: (x, y) => ((y - y0) % 4 === 0 ? -1 : 0) });
        P.part(P.mask().capsule(x0 + 1, y0 + s - 1, x0 + s - 1, y0 + 1, 1.6), WOODR, { base: 3 });
      };
      box(2, 13, 13); box(16, 13, 13); box(9, 1, 12);
    } else if (kind === 'weaponrack') {
      P = new Painter(32, 40);
      for (const [x0, x1] of [[4, 10], [28, 22]]) P.part(P.mask().capsule(x0, 39, x1, 12, 2), WOODR, { sep: true });
      P.part(P.mask().rect(5, 22, 27, 23), WOODR, { sep: true });
      for (let i = 0; i < 4; i++) drawWeapon(P, r.pick(['spear', 'halberd', 'bill', 'poleaxe']), 8 + i * 5, 34, -88 + r.range(-4, 4), { sep: true });
      for (let i = 0; i < 1; i++) { const sm = heaterMask(P.mask(), 20, 28, 9, 11); P.part(sm, (x, y) => tRamp(blazon(arms, (x - 20) / 9, (y - 28) / 11)), { sep: true, flat: true }); }
    } else if (kind === 'cart') {
      P = new Painter(48, 32);
      P.part(P.mask().rect(4, 12, 40, 21), WOODR, { sep: true, tex: (x, y) => (y % 3 === 0 ? -1 : 0) });
      P.part(P.mask().capsule(40, 18, 47, 22, 1.6), WOODR, { sep: true });
      const HAY = ['#5a4418', '#806428', '#a88a3a', '#ccae54', '#e8cc72'];
      P.part(P.mask().ellipse(22, 11, 17, 5), HAY, { tex: (x, y) => ((x * 3 + y * 7) % 5 === 0 ? 1 : 0), sep: true, sepSides: (dx, dy) => dy > 0 });
      for (const x of [12, 32]) { const w = P.mask().ellipse(x, 24, 6, 6.5); P.part(w, WOODR, { sep: true }); w.each((xx, yy) => { if (Math.hypot(xx + 0.5 - x, yy + 0.5 - 24) < 4.6 && (xx === x || yy === 24 || Math.hypot(xx + 0.5 - x, yy + 0.5 - 24) < 1.5) === false) P.g.set(xx, yy, '#2a1c10'); }); }
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

  // ================================================================ CAVALRY
  // A horse (four directions, a four-beat walk) with a rider made by the soldier
  // generator. Knights' horses may wear a heraldic caparison and a steel chanfron.
  const COATS = {
    bay:      { coat: '#7a4422', mane: '#241814' }, chestnut: { coat: '#9a5228', mane: '#7a3a1a' },
    black:    { coat: '#2e2a2c', mane: '#141214' }, grey:     { coat: '#a8a8a2', mane: '#5a5a58', dapple: true },
    white:    { coat: '#ddd8ce', mane: '#b8b2a8' }, dun:      { coat: '#b8945a', mane: '#3a2a1a' },
    palomino: { coat: '#d0a850', mane: '#f0e8d0' },
  };
  // Beast mounts for riders who don't ride horses: each changes the body, head, legs and extras.
  const MOUNTS = {
    horse:  { coats: Object.keys(COATS) },
    bear:   { coats: ['#6a4a30', '#3a2a22', '#e8e4dc'], mane: null, legs: [41, 45, 50, 4.4, 3.8], riderDy: 0 },
    stag:   { coats: ['#8a5a30', '#9a6a3a'], mane: null, legs: [37, 44, 50, 2.8, 1.9], riderDy: 0 },
    boar:   { coats: ['#4a3a30', '#6a4a36', '#3a3036'], mane: '#1a1414', legs: [41, 46, 50, 3.4, 2.8], riderDy: 3 },
    camel:  { coats: ['#c8a064', '#b8905a'], mane: '#8a6a40', legs: [36, 44, 50, 2.8, 2.2], riderDy: -3 },
    kelpie: { coats: ['#2a8a8a', '#3a6a9a'], mane: '#7af0e0', legs: [37, 44, 50, 3.2, 2.2], riderDy: 0 },
  };
  function cavalryGenome(o) {
    const r = R.make(o.seed, 'cavalry');
    const troop = o.troop && o.troop !== 'random' ? o.troop : r.pick(['knight', 'knight', 'manatarms', 'captain']);
    const rider = soldierGenome(Object.assign({}, o, { troop: TROOPS[troop] ? troop : 'knight' }));
    const weapon = o.weapon && o.weapon !== 'random' ? o.weapon : r.pick(troop === 'knight' ? ['lance', 'lance', 'sword', 'mace'] : ['sword', 'lance', 'axe']);
    rider.weapon = weapon === 'lance' ? 'none' : weapon;
    rider.shield = rider.shield || weapon === 'lance';
    const mount = MOUNTS[o.mount] ? o.mount : 'horse', MS = MOUNTS[mount];
    if (mount !== 'horse') {
      const coat = r.pick(MS.coats);
      return { troop, rider, lance: weapon === 'lance', mount, coatName: mount, coat: ramp(coat, 5, 0.5), mane: ramp(MS.mane || mix(coat, '#000000', 0.4), 5, 0.45),
        dapple: mount === 'stag', blaze: false, socks: false, caparison: false, chanfron: false, arms: rider.arms };
    }
    const coatName = o.coat && COATS[o.coat] ? o.coat : r.pick(Object.keys(COATS));
    const C = COATS[coatName];
    return { troop, rider, lance: weapon === 'lance', mount, coatName, coat: ramp(C.coat, 5, 0.5), mane: ramp(C.mane, 5, 0.45), dapple: !!C.dapple,
      blaze: r.chance(0.4), socks: r.chance(0.4), caparison: (troop === 'knight' || troop === 'captain') && r.chance(0.7), chanfron: troop !== 'levy' && r.chance(0.6), arms: rider.arms };
  }
  const HOOF = ['#141010', '#2a2220', '#3a3230', '#4a4240'];
  function lancePainter(w, h, x0, y0, x1, y1, g) {
    const P = new Painter(w, h);
    P.part(P.mask().capsule(x0, y0, x1, y1, 1.6), (x, y) => (Math.floor((x + y) / 3) % 2 ? tRamp(g.arms.A) : tRamp(METALS.includes(g.arms.A) ? g.arms.B : 'argent')), {});
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    P.part(P.mask().capsule(x1, y1, x1 + ux * 2.5, y1 + uy * 2.5, 1), STEEL, { spec: true });
    const vx = x0 + ux * 8, vy = y0 + uy * 8;                                                     // vamplate (hand guard)
    P.part(P.mask().poly([[vx - uy * 2.5, vy + ux * 2.5], [vx + uy * 2.5, vy - ux * 2.5], [vx + ux * 3, vy + uy * 3]]), STEEL, { spec: true });
    return P.done();
  }
  function horseSide(g, f, atk) {
    const P = new Painter(48, 52), C = g.coat, M = g.mane, gallop = atk ? 1.6 : 1;
    const capFn = (x, y) => tRamp(blazon(g.arms, (x - 8) / 34, (y - 26) / 18));
    const mt = g.mount || 'horse', LG = (MOUNTS[mt] && MOUNTS[mt].legs) || [37, 44, 50, 3.2, 2.2];
    const legs = [{ x: 17, ph: 2, far: true }, { x: 36, ph: 3, far: true }, { x: 14, ph: 0 }, { x: 33, ph: 1 }];
    const HOOFR = mt === 'bear' ? BONER : mt === 'camel' ? ramp('#8a6a40', 4, 0.4) : HOOF;
    const leg = (L) => {
      const k = (f + L.ph) % 4, swing = [3, 1, -3, -1][k] * gallop, lift = k === 1 ? 2.5 : k === 0 ? 0.5 : 0;
      const kx = L.x - swing * 0.5, ky = LG[1] - lift * 0.6, hx = L.x - swing - (lift ? 1 : 0), hy = LG[2] - lift;
      const m = P.mask().capsule(L.x, LG[0], kx, ky, LG[3]).capsule(kx, ky, hx, hy, LG[4]);
      P.part(m, L.far ? C.map((c, i) => C[Math.max(0, i - 1)]) : C, { sep: !L.far });
      if (g.socks && !L.far) P.part(P.mask().rect(Math.round(hx) - 1, Math.round(hy) - 3, Math.round(hx) + 1, Math.round(hy) - 1), ramp('#e8e4dc', 5, 0.3), {});
      P.part(P.mask().rect(Math.round(hx) - 1, Math.round(hy), Math.round(hx) + 1, Math.round(hy) + 1), HOOFR, { base: 1 });
    };
    leg(legs[0]); leg(legs[1]);
    const dark = C.map((c, i) => C[Math.max(0, i - 1)]);
    if (mt === 'horse' || mt === 'kelpie') {
      if (mt === 'kelpie') P.part(P.mask().poly([[39, 28], [47, 34 + (f % 2)], [46, 44], [41, 38]]), M, { tex: (x, y) => (x % 2 ? -1 : 0) });   // fin tail
      else P.part(P.mask().capsule(40, 29, 43 + (f % 2), 41, 3.4).capsule(43 + (f % 2), 41, 42, 45, 2.4), M, { tex: (x, y) => (y % 3 === 0 ? -1 : 0) });   // tail
      const body = P.mask().ellipse(25, 33, 11.5, 6).ellipse(15, 32, 5.5, 6.5).ellipse(35, 31.5, 6.5, 6.5).poly([[10, 31], [18, 28], [14, 18], [8, 17]]);
      P.part(body, C, { tex: g.dapple ? (x, y) => ((x * 7 + y * 5) % 9 === 0 ? 1 : 0) : mt === 'kelpie' ? (x, y) => ((x + y * 2) % 5 === 0 ? 1 : 0) : null });
      const head = P.mask().capsule(10, 17, 4, 24, 5.6).capsule(11, 13, 12, 16, 1.8);
      P.part(head, C, { sep: true, sepSides: (dx, dy) => dx > 0 });
      P.part(P.mask().ellipse(3.8, 24.5, 2.2, 1.8), dark, {});                                            // muzzle
      P.g.set(7, 18, '#141010').set(6, 18, C[1]);
      if (g.blaze) for (let t = 0; t <= 1; t += 0.2) P.g.set(Math.round(9 - t * 5), Math.round(16 + t * 7), '#ece8e0');
      if (mt === 'kelpie') { const fm = P.mask(); for (let i = 0; i < 5; i++) fm.poly([[11 + i * 1.4, 15 + i * 2.2], [15 + i * 1.8, 11 + i * 2.6], [13 + i * 1.6, 17 + i * 2.2]]); P.part(fm, M, { sep: true }); P.g.set(7, 18, M[4]); }
      else P.part(P.mask().capsule(10.5, 14.5, 17, 26, 2.2), M, { tex: (x, y) => ((x + y) % 3 === 0 ? 1 : 0) });   // mane
      if (g.chanfron) { const ch = P.mask().capsule(9.5, 15.5, 5, 21.5, 3.2); P.part(ch, STEEL, { spec: true, sep: true }); }
      P.g.line(6, 22, 20, 24, LEATHER[1]);                                                               // reins
    } else if (mt === 'stag') {
      P.part(P.mask().ellipse(41, 29, 2, 2), ramp('#f0ece4', 4, 0.3), {});                                  // white tail
      P.part(P.mask().ellipse(25, 32, 11, 5.5).ellipse(15, 31, 5, 6).ellipse(35, 31, 6, 6).poly([[10, 30], [17, 28], [13, 19], [8, 18]]), C, { tex: (x, y) => (y < 31 && (x * 7 + y * 5) % 9 === 0 ? 2 : 0) });
      P.part(P.mask().capsule(10, 18, 4, 24, 4.6), C, { sep: true, sepSides: (dx) => dx > 0 });
      P.part(P.mask().ellipse(3.6, 24.4, 1.8, 1.6), ['#141010', '#2a2220', '#3a3230', '#4a4240'], {});
      P.g.set(7, 19, '#141010');
      const ant = P.mask().capsule(10, 15, 12, 8, 1.4).capsule(12, 8, 15, 3, 1.2).capsule(12, 8, 9, 4, 1.1).capsule(13.5, 5, 17, 5, 1).capsule(11, 11, 7, 9, 1);
      P.part(ant, BONER, { sep: true });
    } else if (mt === 'bear') {
      P.part(P.mask().ellipse(26, 35, 13, 7.5).ellipse(16, 32, 7.5, 7).ellipse(36, 34, 6, 6), C, { tex: (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 1 : (x + y) % 5 === 0 ? -1 : 0) });
      P.part(P.mask().ellipse(7.5, 32, 5, 4.6).ellipse(3, 34, 2.6, 2.2).ellipse(9, 27.5, 1.6, 1.6), C, { sep: true, sepSides: (dx) => dx > 0 });
      P.part(P.mask().ellipse(2.6, 34.2, 1.8, 1.4), ['#141010', '#201818', '#2a2222', '#383030'], {});
      P.g.set(6, 31, '#141010');
    } else if (mt === 'boar') {
      P.part(P.mask().capsule(38, 33, 41, 31 + (f % 2), 1.4), C, {});                                    // curly tail
      P.part(P.mask().ellipse(25, 36, 12.5, 7).ellipse(15, 35, 6, 7), C, { tex: (x, y) => ((x * 5 + y) % 6 === 0 ? -1 : 0) });
      const bm = P.mask(); for (let x = 12; x <= 34; x += 2) bm.poly([[x, 31], [x + 2, 31], [x + 1, 27 - (x % 4 === 0 ? 1 : 0)]]);
      P.part(bm, M, {});                                                                               // bristles
      P.part(P.mask().poly([[13, 30], [4, 34], [2, 39], [13, 41]]), C, { sep: true, sepSides: (dx) => dx > 0 });
      P.part(P.mask().ellipse(2.4, 36.5, 1.6, 2.2), ramp('#c08080', 4, 0.4), {});                          // snout
      P.part(P.mask().capsule(5, 38, 3, 34, 1.2), BONER, {});                                             // tusk
      P.g.set(8, 33, '#ff3030');
    } else if (mt === 'camel') {
      P.part(P.mask().capsule(36, 28, 37, 38, 1.6), M, {});
      P.part(P.mask().ellipse(25, 31, 11, 5.5).ellipse(26, 25, 5.5, 4.5).ellipse(15, 31, 5, 5), C, {});
      P.part(P.mask().capsule(14, 31, 9, 22, 4).capsule(9, 22, 8, 13, 3.6).capsule(8, 13, 2, 15, 3.6), C, { sep: true, sepSides: (dx) => dx > 0 });
      P.g.set(6, 13, '#141010'); P.part(P.mask().ellipse(1.6, 15.5, 1.4, 1.4), C.map((c, i) => C[Math.max(0, i - 1)]), {});
      P.g.line(2, 16, 22, 22, LEATHER[1]);
    }
    // saddle (higher on a camel's hump, lower on a boar)
    const sd = (MOUNTS[mt] && MOUNTS[mt].riderDy) || 0;
    P.part(P.mask().poly([[19, 26 + sd], [31, 26 + sd], [30, 30 + sd], [20, 30 + sd]]), mt === 'horse' ? LEATHER : ramp(g.rider.liv[2], 5, 0.4), { sep: true });
    if (g.caparison) {
      const cap = P.mask().poly([[9, 27], [19, 26.5], [31, 26.5], [41, 27], [42, 43], [9, 43]]);
      cap.each((x, y) => { if (y >= 41 && (x % 4 === 0 || x % 4 === 3) && y >= 42) cap.del(x, y); });
      P.part(cap, capFn, { sep: true, shade: (x, y) => (y > 38 ? -1 : 0) });
    }
    leg(legs[2]); leg(legs[3]);
    if (mt === 'kelpie') for (const x of [14, 33]) P.part(P.mask().poly([[x + 1, 42], [x + 5, 40], [x + 3, 45]]), M, {});   // leg fins
    return P.done();
  }
  function horseFront(g, f, back, atk) {
    const B = new Painter(48, 52), F = new Painter(48, 52), C = g.coat, M = g.mane;
    const lift = [0, 1, 0, 2][f];
    const capFn = (x, y) => tRamp(blazon(g.arms, (x - 14) / 20, (y - 28) / 16));
    for (const [x, i] of [[19, 1], [29, 2]]) {
      const up = lift === i ? 2 : 0;
      B.part(B.mask().capsule(x, 38, x, 49 - up, 3.4), C, {});
      if (g.socks) B.part(B.mask().rect(x - 1, 46 - up, x + 1, 48 - up), ramp('#e8e4dc', 5, 0.3), {});
      B.part(B.mask().rect(x - 1, 49 - up, x + 1, 50 - up), HOOF, { base: 1 });
    }
    B.part(B.mask().ellipse(24, 34, back ? 9.5 : 8.5, 7), C, { tex: g.dapple ? (x, y) => ((x * 7 + y * 5) % 9 === 0 ? 1 : 0) : null });
    if (g.caparison) { const cap = B.mask().rect(14, 29, 34, 44); cap.each((x, y) => { if (y >= 43 && x % 4 < 2) cap.del(x, y); }); B.part(cap, capFn, { sep: true }); }
    if (back) B.part(B.mask().capsule(24, 32, 24 + (f % 2 ? 1 : -1), 46, 4), M, { tex: (x, y) => (x % 2 ? -1 : 0), sep: true });
    // the rider's legs hang either side
    const legR = g.rider.body === 'plate' || g.rider.body === 'plateMail' ? STEEL : g.rider.hose;
    B.part(B.mask().capsule(14, 30, 13, 39, 3), legR, { sep: true }); B.part(B.mask().capsule(34, 30, 35, 39, 3), legR, { sep: true });
    const mt = g.mount || 'horse';
    if (!back && mt === 'bear') {
      F.part(F.mask().ellipse(24, 33, 6.5, 5.5).ellipse(18.5, 28, 2, 2).ellipse(29.5, 28, 2, 2), C, { sep: true });
      F.part(F.mask().ellipse(24, 36, 3, 2.2), ramp('#b09070', 4, 0.4), {}); F.g.set(24, 35, '#141010').set(21, 32, '#141010').set(27, 32, '#141010');
    } else if (!back && mt === 'boar') {
      F.part(F.mask().ellipse(24, 36, 6, 5), C, { sep: true });
      F.part(F.mask().ellipse(24, 39, 3, 2.2), ramp('#c08080', 4, 0.4), {});
      for (const f2 of [-1, 1]) F.part(F.mask().capsule(24 + 3 * f2, 39, 24 + 5 * f2, 35, 1.2), BONER, {});
      F.g.set(21, 34, '#ff3030').set(27, 34, '#ff3030');
    } else if (!back && mt === 'camel') {
      F.part(F.mask().capsule(24, 34, 24, 20, 4).ellipse(24, 18, 3.6, 3.2), C, { sep: true });
      F.g.set(22, 17, '#141010').set(26, 17, '#141010');
    } else if (!back) {
      F.part(F.mask().ellipse(24, 32, 4.6, 7.5).ellipse(24, 38.5, 3.6, 2.6), C, { sep: true });
      F.part(F.mask().ellipse(24, 40, 3, 1.8), C.map((c, i) => C[Math.max(0, i - 1)]), {});
      F.part(F.mask().rect(20, 23, 21, 26).rect(27, 23, 28, 26), C, {});                                     // ears
      F.part(F.mask().rect(22, 25, 26, 27), M, {});                                                          // forelock
      F.g.set(19, 30, '#141010').set(29, 30, '#141010').set(19, 29, C[3]).set(29, 29, C[3]);
      if (g.blaze) F.g.vline(24, 28, 37, '#ece8e0');
      if (g.chanfron) { F.part(F.mask().poly([[21, 26], [27, 26], [26, 35], [22, 35]]), STEEL, { spec: true, sep: true }); F.g.set(24, 30, tRamp(g.arms.A)[3]); }
      if (mt === 'stag') for (const f2 of [-1, 1]) F.part(F.mask().capsule(24 + 3 * f2, 25, 24 + 7 * f2, 17, 1.4).capsule(24 + 6 * f2, 19, 24 + 10 * f2, 18, 1.1).capsule(24 + 7 * f2, 17, 24 + 6 * f2, 13, 1.1), BONER, { sep: true });
      if (mt === 'kelpie') for (const f2 of [-1, 1]) F.part(F.mask().poly([[24 + 3 * f2, 26], [24 + 8 * f2, 22], [24 + 5 * f2, 29]]), M, { sep: true });
    }
    return { back: B.done(), front: back ? null : F.done() };
  }
  function cavalryFrame(g, dir, pose, f) {
    const out = new Grid(48, 52), atk = pose === 'attack';
    const riderPose = atk && !g.lance ? 'attack' : 'walk';
    if (dir === 2) {
      out.blit(horseSide(g, f, atk));
      const rf = soldierFrame(g.rider, 2, riderPose, 0);
      const crop = new Grid(32, 30); for (let y = 0; y < 30; y++) for (let x = 0; x < 32; x++) crop.set(x, y, rf.get(x, y));
      const sdy = (MOUNTS[g.mount || 'horse'] || {}).riderDy || 0;
      out.blit(crop, 9, -2 + sdy);
      const legR = g.rider.body === 'plate' || g.rider.body === 'plateMail' ? STEEL : g.rider.hose;
      const LP = new Painter(48, 52);
      LP.part(LP.mask().capsule(24, 27, 20, 32, 3.2).capsule(20, 32, 21, 38, 2.8), legR, { spec: legR === STEEL });
      LP.part(LP.mask().rect(19, 38, 22, 39), LEATHER, { base: 1 });
      out.blit(LP.done());
      if (g.lance) out.blit(atk ? lancePainter(48, 52, 30, 19, 0, 21, g) : lancePainter(48, 52, 21, 34, 18, 0, g));
      return out;
    }
    const back = dir === 1, H = horseFront(g, f, back, atk);
    out.blit(H.back);
    const rf = soldierFrame(g.rider, dir, riderPose, 0);
    const crop = new Grid(32, 30); for (let y = 0; y < 30; y++) for (let x = 0; x < 32; x++) crop.set(x, y, rf.get(x, y));
    out.blit(crop, 8, -1 + ((MOUNTS[g.mount || 'horse'] || {}).riderDy || 0));
    if (H.front) out.blit(H.front);
    if (g.lance) out.blit(atk ? lancePainter(48, 52, 31, 22, 46, 50, g) : lancePainter(48, 52, back ? 15 : 33, 34, back ? 15 : 33, 0, g));
    return out;
  }
  function deadHorse(g, seed) {
    const r = R.make(seed, 'deadhorse');
    const P = new Painter(64, 32), C = g.coat;
    const pool = new Grid(64, 32);
    pool.each((x, y) => { const d = Math.hypot((x - 30) / 24, (y - 22) / 8) + (r() - 0.5) * 0.15; return d < 1 ? (d < 0.6 ? BLOOD[1] : d < 0.85 ? BLOOD[2] : dither(x, y, (1 - d) * 5) ? BLOOD[3] : undefined) : undefined; });
    for (const [x0, y0, x1, y1] of [[26, 21, 32, 29], [30, 22, 37, 28], [40, 21, 47, 27], [44, 20, 51, 25]]) { P.part(P.mask().capsule(x0, y0, x1, y1, 2.6), C, {}); P.part(P.mask().rect(x1 - 1, y1 - 1, x1 + 1, y1), HOOF, {}); }
    P.part(P.mask().ellipse(34, 16, 14, 6.5).ellipse(20, 17, 6, 5.5), C, {});
    if (g.caparison) P.part(P.mask().ellipse(34, 15, 12, 5), (x, y) => tRamp(blazon(g.arms, (x - 22) / 24, (y - 10) / 10)), { sep: true });
    P.part(P.mask().capsule(15, 17, 7, 22, 5).capsule(7, 22, 3, 23, 4.5), C, { sep: true });
    P.part(P.mask().capsule(48, 15, 58, 19, 3), g.mane, {});
    P.g.set(7, 20, '#141010');
    pool.blit(P.done());
    return pool;
  }
  function genCavalry(o) {
    const g = cavalryGenome(o);
    const sheet = new Grid(192, 292);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) {
      const pose = row === 4 ? 'attack' : 'walk';
      const fr = col === 3 ? cavalryFrame(g, 2, pose, row % 4).flipX() : cavalryFrame(g, col, pose, row % 4);
      sheet.blit(fr, col * 48, row * 52);
    }
    sheet.blit(deadHorse(g, o.seed), 0, 260);
    sheet.blit(corpse(g.rider, o.seed, false), 70, 260);
    const tracks = [0, 1, 2, 3].map(c => [0, 1, 2, 3].map(r => ({ x: c * 48, y: r * 52 })));
    tracks.push([0, 1, 2, 3].map(c => ({ x: c * 48, y: 208 })));
    return { img: sheet, anim: { fw: 48, fh: 52, fps: 6, tracks, labels: ['front', 'back', 'left', 'right', 'attack'] }, name: `cavalry-${g.troop}-${g.lance ? 'lance' : g.rider.weapon}-${g.coatName}` };
  }

  // ================================================================ HEROES
  // Heroes must not look like the rank and file. Each archetype has a silhouette of
  // its own (an outrageous hat, a cape, an oversized signature weapon), a bold personal
  // colour scheme instead of the army's livery, and a glowing aura outline, so a hero
  // can be picked out of a crowded field at a glance. Frames are 40 x 48 (the extra room
  // is for hats, capes and weapons); the body is drawn by the soldier code with the
  // hero's own colours, then the hero's pieces are layered on top.
  const HERO_PALS = {
    royal: ['#6a2a9a', '#e0b440', '#d0a0ff'], blood: ['#a81c2c', '#2a2430', '#ff6a50'], frost: ['#2a76b8', '#e8f0f8', '#9aeeff'],
    venom: ['#3e8a2a', '#2a2430', '#b0ff5a'], ember: ['#d0581a', '#3a2418', '#ffc050'], bone:  ['#d8d0b8', '#3a3440', '#8af0e0'],
    rose:  ['#d84a84', '#f4e4ec', '#ffa8dc'], sun:   ['#e8b830', '#f8f4e8', '#fff2a0'], teal:  ['#169686', '#ecdcaa', '#6affe0'],
    night: ['#2c2c64', '#9a9ad0', '#a8b0ff'],
  };
  const HEROES = {
    witch:        { torso: 'robe',   hats: ['witch'], capes: [null], weapons: ['tome', 'staff'], hair: ['long', 'wild'], pals: ['venom', 'royal', 'night', 'rose'], beard: ['none'] },
    reaper:       { torso: 'robe',   hats: ['deephood'], capes: ['tattered'], weapons: ['scythe'], hair: ['short'], pals: ['bone', 'night', 'blood'], beard: ['none'], eyes: true, tattered: true },
    cavalier:     { torso: 'doublet', hats: ['cavalier'], capes: ['shoulder'], weapons: ['rapier'], hair: ['long', 'short', 'tail'], pals: ['blood', 'teal', 'royal', 'rose', 'sun'], beard: ['moustache', 'none', 'goatee'] },
    berserker:    { torso: 'bare',   hats: ['horns', 'none'], capes: ['fur'], weapons: ['greataxe', 'maul'], hair: ['wild'], pals: ['ember', 'blood', 'frost'], beard: ['full', 'full', 'none'], paint: true },
    paladin:      { torso: 'plate',  hats: ['winged', 'halo', 'none'], capes: ['long'], weapons: ['greatsword', 'maul'], hair: ['short', 'long'], pals: ['sun', 'frost', 'royal'], beard: ['none', 'full'], glowWeapon: true },
    monk:         { torso: 'habit',  hats: ['straw', 'none'], capes: [null], weapons: ['quarterstaff'], hair: ['bald'], pals: ['ember', 'sun', 'teal'], beard: ['none', 'full', 'stubble'], beads: true },
    necromancer:  { torso: 'coat',   hats: ['hood', 'darkcrown'], capes: ['long'], weapons: ['skullstaff'], hair: ['long', 'short'], pals: ['venom', 'night', 'bone'], beard: ['none', 'goatee'], eyes: true, skulls: true },
    huntress:     { torso: 'tunic',  hats: ['hood'], capes: ['scarf'], weapons: ['longbow'], hair: ['long', 'tail'], pals: ['venom', 'teal', 'night', 'rose'], beard: ['none'], quiver: true },
    alchemist:    { torso: 'coat',   hats: ['beak'], capes: [null], weapons: ['flask'], hair: ['short'], pals: ['night', 'bone', 'teal'], beard: ['none'], potions: true },
    jester:       { torso: 'motley', hats: ['jester'], capes: [null], weapons: ['daggers'], hair: ['short'], pals: ['rose', 'royal', 'sun', 'blood'], beard: ['none'] },
    warlord:      { torso: 'plate',  hats: ['crown', 'crown', 'laurel'], capes: ['ermine'], weapons: ['greatsword', 'scepter'], hair: ['long', 'short'], pals: ['royal', 'blood', 'sun'], beard: ['full'] },
    shieldmaiden: { torso: 'tunic',  hats: ['winged'], capes: [null], weapons: ['spear'], hair: ['braids'], pals: ['frost', 'teal', 'blood'], beard: ['none'], roundShield: true },
  };
  const GOLDR = ['#5a3a10', '#9a6a1a', '#d8a030', '#f4d060', '#fff8d0'];
  const BONER = ['#4a4238', '#8a7e68', '#c4b898', '#e8dec4', '#fffaf0'];
  const FUR = ['#2a2018', '#4a3a2a', '#6e5a44', '#94806a', '#b8a890'];
  const STRAW = ['#5a4418', '#8a7030', '#b89a48', '#dcc46c', '#f4e4a0'];

  function heroGenome(o) {
    const r = R.make(o.seed, 'hero32');
    const kind = HEROES[o.hero] ? o.hero : r.pick(Object.keys(HEROES));
    const H = HEROES[kind];
    let palName = r.pick(H.pals);
    let pal = HERO_PALS[palName];
    if (FACTIONS[o.faction] && o.palette === 'faction') pal = [FACTIONS[o.faction].main, pal[1], mix(FACTIONS[o.faction].main, '#ffffff', 0.5)];
    const M = ramp(pal[0], 5, 0.55), S2 = ramp(pal[1], 5, 0.5), glow = pal[2], GL = ramp(glow, 5, 0.45);
    const base = soldierGenome(Object.assign({}, o, { troop: 'knight' }));
    const g = Object.assign(base, {
      kind, palName, M, S2, glow, GL,
      hat: r.pick(H.hats), cape: r.pick(H.capes), heroWeapon: o.weapon && o.weapon !== 'random' ? o.weapon : r.pick(H.weapons),
      hairStyle0: r.pick(H.hair), beard: r.pick(H.beard), helm: 'none', plume: false, shield: false, weapon: 'none',
      tattered: !!H.tattered, glowEyes: !!H.eyes, paint: !!H.paint, beads: !!H.beads, skulls: !!H.skulls, quiver: !!H.quiver,
      potions: !!H.potions, roundShield: !!H.roundShield, glowWeapon: !!H.glowWeapon || r.chance(0.25),
      capeSeed: r.int(0, 999),
      // personal traits, so two heroes of one archetype still differ at a glance
      familiar: r.pick([null, null, 'raven', 'wisp', 'skull']), motes: r.chance(0.45), runes: r.chance(0.3),
      mark: r.pick([null, null, null, 'eyepatch', 'scar']),
    });
    g.hairStyle = g.hairStyle0 === 'wild' || g.hairStyle0 === 'braids' ? 'long' : g.hairStyle0 === 'tail' ? 'short' : g.hairStyle0;
    if (g.hat === 'hood' || g.hat === 'deephood') { g.helm = 'hood'; g.liv = M; }
    if (kind === 'reaper' || kind === 'witch') g.skin = ramp(r.pick(['#e8d8d0', '#d8e0d0', '#c8b8c8']), 5, 0.4);
    if (kind === 'berserker') g.hair = ramp(r.pick(['#c04020', '#e8d8b0', '#3a2418', '#d08a30']), 5, 0.5);
    // the body's cut and colours
    const T = H.torso, bodyOver = { belt: false };
    const DK = ramp(mix(pal[1], '#1a1420', 0.55), 5, 0.4);
    if (T === 'robe') Object.assign(bodyOver, { robe: true, torso: () => M, arms: M, hands: g.skin, feet: DK, belt: S2 });
    if (T === 'habit') Object.assign(bodyOver, { robe: true, torso: () => M, arms: M, hands: g.skin, feet: LEATHER, belt: STRAW });
    if (T === 'coat') Object.assign(bodyOver, { long: true, torso: (x) => (x >= 15 && x <= 17 ? S2 : M), arms: M, hands: LEATHER, legs: DK, feet: LEATHER, belt: LEATHER });
    if (T === 'doublet') Object.assign(bodyOver, { torso: (x) => ((x % 3) === 0 ? S2 : M), arms: M, armOpts: { tex: (x, y) => (y % 3 === 0 ? 1 : 0) }, hands: g.skin, legs: S2, feet: LEATHER, belt: GOLDR });
    if (T === 'bare') Object.assign(bodyOver, { torso: () => g.skin, torsoOpts: {}, arms: g.skin, armOpts: {}, hands: LEATHER, legs: M, feet: FUR, belt: LEATHER });
    if (T === 'plate') Object.assign(bodyOver, { plate: true, torso: (x, y) => (x >= 13 && x <= 19 ? M : STEEL), arms: STEEL, armOpts: { spec: true }, hands: STEEL, legs: STEEL, feet: STEEL, pauldrons: GOLDR, belt: GOLDR });
    if (T === 'tunic') Object.assign(bodyOver, { torso: () => M, arms: kind === 'shieldmaiden' ? STEEL : M, armOpts: kind === 'shieldmaiden' ? { tex: mailTex, base: 1 } : {}, hands: LEATHER, legs: DK, feet: LEATHER, belt: LEATHER });
    if (T === 'motley') Object.assign(bodyOver, { torso: (x, y) => ((Math.floor((x + y) / 3) + Math.floor((x - y + 40) / 3)) % 2 ? M : S2), arms: S2, hands: g.skin, legs: M, feet: S2, belt: false });
    g.over = bodyOver; g.body = T === 'plate' ? 'plate' : 'tunic'; g.DK = DK;
    return g;
  }

  const HERO_WEAPONS = {
    scythe:       g => [{ mat: WOODR, t: [-9, 17], w: 1.4 }, { mat: g.glowWeapon ? g.GL : STEEL, spec: true, blade: [[14.5, 0.5], [18, 0.5], [18, -4], [16, -9], [12, -13], [9, -13.5], [12.5, -10], [15, -5]] }],
    greatsword:   g => [{ mat: LEATHER, t: [-3, 0.5], w: 1.5 }, { mat: GOLDR, t: [-3.8, -3.2], w: 2.2, spec: true }, { mat: GOLDR, guard: [-3.5, 3.5], t: [1.2, 1.2], w: 1.5, spec: true }, { mat: g.glowWeapon ? g.GL : STEEL, t: [2, 15.5], w: 2.6, spec: true }, { mat: g.glowWeapon ? g.GL : STEEL, t: [15.5, 17], w: 1.2, spec: true }],
    maul:         g => [{ mat: WOODR, t: [-3, 12], w: 1.5 }, { mat: g.glowWeapon ? g.GL : STEEL, spec: true, blade: [[11.5, -3.5], [16, -3.5], [16, 3.5], [11.5, 3.5]] }, { mat: GOLDR, t: [11, 11], guard: [-3.5, 3.5], w: 1.2 }],
    greataxe:     g => [{ mat: WOODR, t: [-4, 14], w: 1.5 }, { mat: g.glowWeapon ? g.GL : STEEL, spec: true, blade: [[9, 0], [15, 0], [16.5, 5], [12, 6], [8, 4]] }, { mat: g.glowWeapon ? g.GL : STEEL, spec: true, blade: [[10, 0], [14, 0], [15, -4], [11, -4.5]] }],
    rapier:       g => [{ mat: LEATHER, t: [-2, 0.5], w: 1.2 }, { mat: GOLDR, ball: 1.7, t: [1, 1] }, { mat: STEEL, t: [2, 15], w: 1, spec: true }],
    staff:        g => [{ mat: WOODR, t: [-8, 13], w: 1.4 }, { mat: GOLDR, guard: [-2, 2], t: [13.5, 13.5], w: 1.2 }, { mat: g.GL, ball: 2.4, t: [16, 16] }],
    skullstaff:   g => [{ mat: ramp('#3a3040', 5, 0.4), t: [-8, 13], w: 1.4 }, { mat: BONER, ball: 2.6, t: [15.5, 15.5] }],
    quarterstaff: g => [{ mat: WOODR, t: [-12, 14], w: 1.5 }, { mat: GOLDR, t: [-12, -10.5], w: 1.7 }, { mat: GOLDR, t: [12.5, 14], w: 1.7 }],
    scepter:      g => [{ mat: GOLDR, t: [-2, 8], w: 1.5, spec: true }, { mat: GOLDR, ball: 2, t: [9.5, 9.5] }, { mat: g.GL, ball: 1, t: [9.5, 9.5] }],
    spear:        g => [{ mat: WOODR, t: [-13, 16], w: 1.3 }, { mat: g.glowWeapon ? g.GL : STEEL, spec: true, blade: [[15, -1.6], [20.5, 0], [15, 1.6], [14.5, 0]] }],
    flask:        g => [{ mat: ramp('#c8e0e8', 5, 0.3), ball: 2, t: [1.5, 1.5] }, { mat: g.GL, ball: 1.2, t: [1.8, 1.8] }],
    dagger:       g => [{ mat: LEATHER, t: [-1, 0.5], w: 1.2 }, { mat: GOLDR, guard: [-1.6, 1.6], t: [1, 1], w: 1 }, { mat: STEEL, t: [1.5, 6], w: 1.3, spec: true }],
  };
  function drawHeroWeapon(P, g, kind, hx, hy, deg, k = 1) {
    const parts = HERO_WEAPONS[kind](g), a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const X = (t, s) => hx + (t * ca - s * sa) * k, Y = (t, s) => hy + (t * sa + s * ca) * k;
    for (const p of parts) {
      const m = P.mask();
      if (p.blade) m.poly(p.blade.map(([t, s]) => [X(t, s), Y(t, s)]));
      else if (p.ball) m.ellipse(X(p.t[0], 0), Y(p.t[0], 0), p.ball * k, p.ball * k);
      else if (p.guard) m.capsule(X(p.t[0], p.guard[0]), Y(p.t[0], p.guard[0]), X(p.t[0], p.guard[1]), Y(p.t[0], p.guard[1]), p.w * k);
      else m.capsule(X(p.t[0], 0), Y(p.t[0], 0), X(p.t[1], 0), Y(p.t[1], 0), p.w * k);
      P.part(m, p.mat, { spec: p.spec, sep: true });
    }
    if (kind === 'skullstaff') { const sx = X(15.5, 0), sy = Y(15.5, 0); P.g.set(sx - k, sy, '#141010').set(sx + k, sy, '#141010').set(sx - k, sy, g.glow).set(sx + k, sy, g.glow).set(sx, sy + 1.5 * k, '#141010'); }
    return { tipX: X(16, 0), tipY: Y(16, 0) };
  }

  // Pieces behind the body: cape (inside), long hair, quiver.
  function heroBack(g, P, dir, pose, step, b) {
    const wave = pose === 'walk' ? [0, 1, 0, -1][step] : pose === 'attack' ? 2 : 0;
    const M = g.M, S2 = g.S2;
    if (g.cape && g.cape !== 'scarf' && dir !== 1) {
      if (dir === 0) {
        const m = P.mask().poly([[8, 16 + b], [24, 16 + b], [27 + wave, 37], [5 - wave, 37]]);
        if (g.cape === 'shoulder') { m.each((x, y) => { if (x > 14 || y > 30) m.del(x, y); }); }
        if (g.cape === 'fur') { m.each((x, y) => { if (y > 26 + b) m.del(x, y); }); }
        jag(g, m, 37);
        P.part(m, g.cape === 'ermine' ? ramp('#c02030', 5, 0.5) : g.cape === 'fur' ? FUR : S2, { base: 1 });
      } else {                                             // side: the cape streams out behind
        const m = P.mask().poly([[16, 15 + b], [20, 15 + b], [27 + wave * 1.5, 34 + wave], [21, 37], [17, 30]]);
        if (g.cape === 'shoulder') m.each((x, y) => { if (y > 30) m.del(x, y); });
        if (g.cape === 'fur') m.each((x, y) => { if (y > 25 + b) m.del(x, y); });
        jag(g, m, 37);
        P.part(m, g.cape === 'ermine' ? ermineFn : g.cape === 'fur' ? FUR : M, { sep: false, shade: (x) => (x > 22 ? -1 : 0) });
      }
    }
    if (g.hairStyle0 === 'wild' && dir !== 1) {
      const m = P.mask(); for (let i = 0; i < 5; i++) { const a = -Math.PI * (0.12 + i * 0.19); m.capsule(16, 8 + b, 16 + Math.cos(a) * 7, 10 + b + Math.sin(a) * 6, 2.8); }
      P.part(m, g.hair, { tex: (x, y) => ((x * 5 + y * 3) % 6 === 0 ? 1 : 0) });
    }
    if (g.quiver && dir !== 1) {
      const qx = dir === 2 ? 20 : 21;
      P.part(P.mask().capsule(qx, 13 + b, qx + 3, 24 + b, 3), LEATHER, {});
      for (let i = 0; i < 3; i++) P.g.set(qx + i - 1, 12 + b - (i % 2), i % 2 ? '#e8e0d0' : g.M[3]);
    }
  }
  const ermineFn = (x, y) => ((x * 7 + y * 5) % 11 === 0 ? ['#141010', '#1a1416', '#201a1c', '#2a2224', '#302a2c'] : ['#a8a4a0', '#d0ccc8', '#ecebe6', '#f8f6f2', '#ffffff']);
  function jag(g, m, hemY) {
    if (!g.tattered) return;
    const r = R.make(g.capeSeed, 'jag');
    for (let x = -4; x < 40; x++) { const d = r.int(0, 4); for (let k = 0; k < d; k++) m.del(x, hemY - k); }
  }

  // Pieces in front: hats, faces, extras, weapons.
  function heroFront(g, P, dir, pose, step, b) {
    const back = dir === 1, side = dir === 2, atk = pose === 'attack' || pose === 'cast', cast = pose === 'cast';
    const cy = 9 + b, cx = side ? 15.5 : 16, M = g.M, S2 = g.S2, wave = pose === 'walk' ? [0, 1, 0, -1][step] : 0;
    // back view: the cape covers the back
    if (back && g.cape && g.cape !== 'scarf') {
      const m = P.mask().poly([[9, 15 + b], [23, 15 + b], [26 + wave, 37], [6 - wave, 37]]);
      if (g.cape === 'shoulder') m.each((x, y) => { if (x < 16 || y > 30) m.del(x, y); });
      if (g.cape === 'fur') m.each((x, y) => { if (y > 26 + b) m.del(x, y); });
      jag(g, m, 37);
      P.part(m, g.cape === 'ermine' ? ermineFn : g.cape === 'fur' ? FUR : M, { sep: true, shade: (x) => (x % 5 === 0 ? -1 : 0) });
      if (g.cape === 'ermine' || g.cape === 'long') P.part(P.mask().rect(8, 15 + b, 24, 17 + b), g.cape === 'ermine' ? ermineFn : GOLDR, { sep: true });
    }
    if (back && g.quiver) { P.part(P.mask().capsule(19, 13 + b, 13, 26 + b, 3.2), LEATHER, { sep: true }); for (let i = 0; i < 3; i++) P.g.set(19 + i, 12 + b - (i % 2), i % 2 ? '#e8e0d0' : g.M[3]); }
    if (back && g.hairStyle0 === 'braids') { P.part(P.mask().capsule(14, 12 + b, 13, 24 + b, 2).capsule(18, 12 + b, 19, 24 + b, 2), g.hair, { tex: (x, y) => (y % 2 ? -1 : 0), sep: true }); }
    // fur mantle and ermine collar sit on the shoulders
    if (g.cape === 'fur' && !back) { const m = P.mask(); for (let i = 0; i < 6; i++) m.ellipse(side ? 13 + i * 1.6 : 9 + i * 2.8, 16 + b + (i % 2), 2.6, 2.2); P.part(m, FUR, { sep: true, tex: (x, y) => ((x + y * 2) % 3 === 0 ? 1 : 0) }); }
    if (g.cape === 'ermine' && !back) { const m = side ? P.mask().rect(13, 15 + b, 20, 17 + b) : P.mask().rect(9, 15 + b, 23, 17 + b); P.part(m, ermineFn, { sep: true }); }
    // braids hang in front
    if (g.hairStyle0 === 'braids' && !back) {
      const xs = side ? [18] : [11, 21];
      for (const x of xs) { P.part(P.mask().capsule(x, 11 + b, x + (side ? 1 : 0), 23 + b, 2.2), g.hair, { tex: (xx, y) => (y % 2 ? -1 : 0), sep: true }); P.g.set(x, 24 + b, g.S2[2]); }
    }
    if (g.hairStyle0 === 'tail' && (back || side)) P.part(P.mask().capsule(side ? 19 : 16, 9 + b, side ? 22 : 16, 17 + b, 2.2), g.hair, { sep: true });
    // war paint, beads, skull pauldrons, potions
    if (g.paint && !back) { const pc = M[2]; if (!side) { P.g.set(12, cy + 1, pc).set(13, cy + 1, pc).set(19, cy + 1, pc).set(20, cy + 1, pc); for (let y = 18; y <= 23; y += 2) P.g.set(14 + (y % 4 ? 0 : 1), y + b, pc).set(18 - (y % 4 ? 0 : 1), y + b, pc); } else P.g.set(12, cy + 1, pc).set(13, cy + 1, pc); }
    if (g.over && g.over.torso && !g.over.plate && g.kind === 'berserker' && !back && !side) { P.g.set(16, 19 + b, g.skin[1]).set(15, 21 + b, g.skin[1]).set(17, 21 + b, g.skin[1]).set(16, 23 + b, g.skin[1]); }
    if (g.beads && !back) for (let i = 0; i <= 8; i++) { const a = Math.PI * (0.15 + i * 0.0875); P.g.set(Math.round((side ? 15 : 16) + Math.cos(a) * 4), Math.round(15 + b + Math.sin(a) * 4), i % 2 ? '#3a2418' : GOLDR[3]); }
    if (g.skulls) for (const x of side ? [15.5] : [9.5, 22.5]) {
      P.part(P.mask().ellipse(x, 16 + b, 2.8, 2.6), BONER, { sep: true });
      if (!back) { P.g.set(x - 1, 16 + b, '#141010').set(x + 1, 16 + b, '#141010'); if (g.glowEyes) P.g.set(x - 1, 16 + b, g.glow); }
    }
    if (g.potions && !back) for (let i = 0; i < 3; i++) { const x = side ? 13 + i * 2 : 12 + i * 3, c = ramp(['#e04040', '#40c060', '#4080e0'][i], 4, 0.5); P.part(P.mask().rect(x, 25 + b, x + 1, 27 + b), c, { sep: true }); P.g.set(x, 24 + b, LEATHER[3]); }
    if (g.kind === 'jester' && !back && !side) { P.g.set(14, cy + 3, '#8a2a2a').set(18, cy + 3, '#8a2a2a').set(15, cy + 4, '#8a2a2a').set(16, cy + 4, '#8a2a2a').set(17, cy + 4, '#8a2a2a'); P.g.set(14, cy - 1, '#141010').set(18, cy - 1, '#141010'); }
    if (g.over && g.over.plate && !back) {                         // gold trim and a sunburst on the breastplate
      for (let y = 16; y <= 25; y++) { P.g.set(side ? 13 : 12, y + b, GOLDR[2]); if (!side) P.g.set(20, y + b, GOLDR[1]); }
      if (!side) { P.g.set(16, 19 + b, GOLDR[4]).set(15, 20 + b, GOLDR[3]).set(17, 20 + b, GOLDR[3]).set(16, 21 + b, GOLDR[3]).set(16, 20 + b, g.glow); }
    }
    // headgear
    const hat = g.hat;
    if (hat === 'witch') {
      const tip = side ? 7 : 24, m = P.mask().poly([[cx - 4.5, 5 + b], [cx + 4.5, 5 + b], [cx + 2, -2 + b], [tip, -7 + b + (pose === 'walk' ? step % 2 : 0)], [cx - 1, -2 + b]]);
      P.part(P.mask().ellipse(cx, 5 + b, 9.5, 1.8), M, { sep: true });
      P.part(m, M, { sep: true });
      P.part(P.mask().rect(cx - 4, 3 + b, cx + 4, 3 + b), S2, { flat: true });
      P.g.set(cx + 1, 3 + b, g.glow);
    } else if (hat === 'cavalier') {
      P.part(P.mask().ellipse(cx, 4.5 + b, 9, 2.2), M, { sep: true });
      P.part(P.mask().ellipse(cx, 2.5 + b, 4.6, 3), M, { sep: true });
      P.part(P.mask().rect(cx - 4, 3 + b, cx + 4, 3 + b), S2, { flat: true });
      const f = side ? -1 : 1, fm = P.mask().capsule(cx + 2 * f, 2 + b, cx + 7 * f, -3 + b, 3).capsule(cx + 7 * f, -3 + b, cx + 12 * f, -2 + b + (pose === 'walk' ? step % 2 : 0), 2.4);
      P.part(fm, ramp(g.palName === 'sun' ? '#f8f4e8' : g.glow, 5, 0.5), { tex: (x, y) => ((x + y) % 2 ? 0 : -1), sep: true });
    } else if (hat === 'deephood') {
      const m = P.mask().ellipse(cx, cy - 0.5, 6.2, 6.6); m.rect(cx - 6, cy + 3, cx + 6, cy + 7); m.add(cx, cy - 8 + b * 0).add(cx + 1, cy - 7);
      P.part(m, M, { sep: true });
      if (!back) { const f = P.mask(); for (let y = cy - 2; y <= cy + 4; y++) for (let x = (side ? 10 : 12); x <= (side ? 15 : 20); x++) f.add(x, y); P.part(f, ['#08060a', '#0e0a10', '#141018', '#1a1620'], { flat: true, base: 0 }); }
    } else if (hat === 'hood' && g.kind === 'huntress') {
      // a wolf-pelt hood: pricked ears, a grey muzzle over the brow, and a scarf mask
      const WOLF = ['#2a2a30', '#4a4a52', '#76767e', '#a4a4aa', '#d0d0d4'];
      for (const f of side ? [1] : [-1, 1]) P.part(P.mask().poly([[cx + 1.5 * f, 3 + b], [cx + 5 * f, 3 + b], [cx + 4 * f, -2 + b]]), WOLF, { sep: true });
      P.part(side ? P.mask().rect(10, 3 + b, 17, 5 + b) : P.mask().rect(12, 3 + b, 20, 5 + b), WOLF, { sep: true });
      if (!back) { if (side) P.g.set(10, 5 + b, '#141010'); else P.g.set(14, 4 + b, g.glow).set(18, 4 + b, g.glow); }
      if (!side && !back) for (let x = 13; x <= 19; x++) P.g.set(x, cy + 3, S2[2]).set(x, cy + 4, S2[1]);
    } else if (hat === 'jester') {
      for (const [f, col] of [[-1, M], [1, S2]]) {
        if (side && f > 0) continue;
        const ex = side ? 22 : cx + 9 * f, m = P.mask().capsule(cx + 2.5 * f, 4 + b, cx + 6 * f, -3 + b, 3).capsule(cx + 6 * f, -3 + b, ex, 2 + b + (pose === 'walk' ? (step + (f > 0 ? 1 : 0)) % 2 : 0), 2.6);
        P.part(m, col, { sep: true });
        P.part(P.mask().ellipse(ex, 3 + b + (pose === 'walk' ? (step + (f > 0 ? 1 : 0)) % 2 : 0), 1.4, 1.4), GOLDR, { spec: true });
      }
      P.part(P.mask().ellipse(cx, 4 + b, 5, 2.6), M, { sep: true });
    } else if (hat === 'crown' || hat === 'darkcrown') {
      const C = hat === 'crown' ? GOLDR : ramp('#4a4450', 5, 0.5), m = P.mask().rect(cx - 4.5, 2 + b, cx + 4.5, 4 + b);
      for (let i = 0; i < 5; i++) m.add(cx - 4 + i * 2, 1 + b).add(cx - 4 + i * 2, 0 + b);
      P.part(m, C, { spec: true, sep: true });
      P.g.set(cx, 3 + b, hat === 'crown' ? '#d02030' : g.glow).set(cx - 3, 3 + b, hat === 'crown' ? '#2a60d0' : g.glow);
    } else if (hat === 'straw') {
      const m = P.mask().poly([[cx - 11, 6 + b], [cx + 11, 6 + b], [cx + 3, 1 + b], [cx, -1 + b], [cx - 3, 1 + b]]);
      P.part(m, STRAW, { tex: (x, y) => ((x + y) % 3 === 0 ? -1 : 0), sep: true });
    } else if (hat === 'beak') {
      P.part(P.mask().rect(cx - 4, -2 + b, cx + 4, 4 + b), ramp('#2a2430', 5, 0.4), { sep: true });
      P.part(P.mask().ellipse(cx, 4.5 + b, 9.5, 1.8), ramp('#2a2430', 5, 0.4), { sep: true });
      P.part(P.mask().rect(cx - 4, 2 + b, cx + 4, 2 + b), S2, { flat: true });
      if (!back) {
        const mask = side ? P.mask().ellipse(14, cy + 0.5, 3.6, 4).capsule(12, cy + 1, 6, cy + 5, 3) : P.mask().ellipse(16, cy + 0.5, 4.4, 4.2).capsule(16, cy + 2, 16, cy + 8, 3.2);
        P.part(mask, BONER, { sep: true });
        for (const ex of side ? [12.5] : [14, 18]) { P.part(P.mask().ellipse(ex, cy, 1.4, 1.4), GOLDR, {}); P.g.set(ex, cy, g.glow); }
      }
    } else if (hat === 'horns') {
      P.part(P.mask().ellipse(cx, 6 + b, 5.2, 3.8), STEEL, { spec: true, sep: true });
      for (const f of side ? [1] : [-1, 1]) P.part(P.mask().capsule(cx + 4 * f, 5 + b, cx + 7.5 * f, 2 + b, 2.4).capsule(cx + 7.5 * f, 2 + b, cx + 7 * f, -3 + b, 1.8), BONER, { sep: true });
    } else if (hat === 'winged') {
      P.part(P.mask().ellipse(cx, 6 + b, 5.2, 3.8), g.over && g.over.plate ? GOLDR : STEEL, { spec: true, sep: true });
      for (const f of side ? [1] : [-1, 1]) {
        const m = P.mask().poly([[cx + 4 * f, 6 + b], [cx + 10 * f, -1 + b - (pose === 'walk' ? step % 2 : 0)], [cx + 9 * f, 2 + b], [cx + 11 * f, 2 + b], [cx + 8 * f, 5 + b], [cx + 9 * f, 6 + b]]);
        P.part(m, BONER, { sep: true, tex: (x, y) => (y % 2 ? -1 : 0) });
      }
    } else if (hat === 'halo') {
      const hy = -1 + b + (pose === 'walk' && step % 2 ? 1 : 0);
      for (let a = 0; a < Math.PI * 2; a += 0.1) P.g.set(cx + Math.cos(a) * 5, hy + Math.sin(a) * 1.4, a > Math.PI ? GOLDR[4] : GOLDR[3]);
    }
    if (g.hat === 'laurel') for (let x = cx - 5; x <= cx + 5; x++) { if (side && x > cx + 1) continue; P.g.set(x, 3 + b + (Math.abs(x - cx) > 3 ? 1 : 0), (x % 2 ? '#3a8a2a' : '#6ac040')); }
    if (g.glowEyes && !back) { if (side) P.g.set(12, cy, g.glow); else P.g.set(14, cy, g.glow).set(18, cy, g.glow); }
    if (g.mark === 'eyepatch' && !back && g.hat !== 'deephood' && g.hat !== 'beak') { if (side) P.g.set(13, cy, '#141010').set(14, cy - 1, '#141010'); else { P.g.set(18, cy, '#141010').set(19, cy, '#141010').set(18, cy - 1, '#141010'); P.g.line(12, cy - 3, 20, cy - 1, '#2a2020'); } }
    if (g.mark === 'scar' && !back && g.hat !== 'deephood' && g.hat !== 'beak') P.g.line(side ? 13 : 13, cy - 2, side ? 14 : 14, cy + 2, mix(g.skin[1], '#a02030', 0.55));
    if (g.runes && !back) for (let i = 0; i < 4; i++) { const x = side ? 14 + (i % 2) * 2 : 12 + i * 3, y = (g.over && g.over.robe ? 30 : 22) + b + (i % 2) * 2; P.g.set(x, y, g.glow).set(x, y + 1, g.GL[2]); }
    if (g.cape === 'scarf') {                                           // a long scarf that streams in the wind
      const ex = side ? 27 + wave : back ? 8 - wave : 26 + wave;
      P.part(P.mask().capsule(side ? 17 : 16, 14 + b, ex, 18 + b + wave, 2.4).capsule(ex, 18 + b + wave, ex + (side ? 3 : 2), 24 + b, 2), g.S2, { sep: true });
    }
    // round shield
    if (g.roundShield) {
      const sx = side ? 9 : back ? 23 : 8, sy = 22 + b;
      if (side || !back) {
        P.part(P.mask().ellipse(sx, sy, side ? 2.6 : 6, 6.4), (x, y) => (Math.atan2(y - sy, x - sx) + Math.PI) * 4 / Math.PI % 2 < 1 ? M : S2, { sep: true, flat: true, shade: (x) => (x < sx - 2 ? 1 : x > sx + 2 ? -1 : 0) });
        P.part(P.mask().ellipse(sx, sy, 1.6, 1.6), STEEL, { spec: true });
      }
    }
    // weapon
    const W = g.heroWeapon, armAtk = atk && !back;
    let hand;
    if (side) hand = armAtk ? [9, 21 + b] : [12, 24 + b];
    else hand = armAtk ? [25.8, 9 + b] : [24, 25.5 + b];
    if (W === 'tome') {
      const bx = side ? 6 : back ? 26 : 4, by = (atk ? 10 : 16) + b + (step % 2);
      const open = atk;
      const m = open ? P.mask().rect(bx - 4, by, bx + 4, by + 4) : P.mask().rect(bx - 2, by, bx + 2, by + 5);
      P.part(m, open ? ramp('#f0e8d0', 5, 0.3) : M, { sep: true });
      if (open) { P.g.vline(bx, by, by + 4, M[1]); for (let i = 0; i < 3; i++) P.g.set(bx - 3 + i, by + 1 + i, g.glow).set(bx + 2 + (i % 2), by + 1 + i, g.glow); }
      else { P.part(P.mask().rect(bx - 2, by + 2, bx + 2, by + 2), GOLDR, { flat: true }); P.g.set(bx, by + 2, g.glow); }
      if (open) for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + step; P.g.set(bx + Math.cos(a) * 6, by + 2 + Math.sin(a) * 3, i % 2 ? g.GL[4] : g.GL[2]); }
    } else if (W === 'longbow') {
      drawWeapon(P, 'longbow', side ? (atk ? 7 : 11) : hand[0] + 1.5, side ? 21 + b : hand[1] - (armAtk ? -6 : 3), -90, { draw: armAtk && !side, flip: side, sep: true });
    } else if (W === 'daggers') {
      drawHeroWeapon(P, g, 'dagger', hand[0], hand[1], armAtk ? -120 : -70);
      if (!side) drawHeroWeapon(P, g, 'dagger', 9, 25.5 + b, armAtk ? -40 : -110);
      if (atk) for (let i = 0; i < 3; i++) P.g.set(hand[0] + 3 + i * 2, hand[1] - 4 + i, STEEL[4]);
    } else if (W === 'flask' && atk) {
      const fx = side ? 2 : 30, fy = 6 + b;
      drawHeroWeapon(P, g, 'flask', fx, fy, -90);
      for (let i = 1; i < 5; i++) P.g.set(fx + (side ? i * 1.5 : -i * 1.5), fy + i * 1.2, i % 2 ? g.GL[3] : g.GL[2]);
    } else if (W !== 'flask' || !atk) {
      const long = ['scythe', 'spear', 'quarterstaff', 'staff', 'skullstaff'].includes(W);
      const deg = side ? (armAtk ? (long ? 185 : 200) : long ? -93 : -100) : armAtk ? (long ? -60 : -150) : long ? -86 : W === 'flask' ? -90 : -62;
      const tip = drawHeroWeapon(P, g, W, side ? hand[0] - (atk ? 0 : 1) : hand[0], hand[1], back && !side ? -94 : deg);
      if (atk && (W === 'staff' || W === 'skullstaff' || g.glowWeapon)) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; P.g.set(tip.tipX + Math.cos(a) * 3.5, tip.tipY + Math.sin(a) * 3.5, i % 2 ? g.GL[4] : g.GL[2]); }
    }
    if (!back) P.part(P.mask().ellipse(hand[0], hand[1], 1.5, 1.4), (g.over && g.over.hands) || g.skin, {});
    // familiars and motes
    const t = pose === 'walk' ? step : pose === 'attack' ? 1 : 2;
    if (g.familiar === 'raven') {
      const fx = side ? 18 : back ? 22 : 10, fy = 13 + b - (atk ? 3 : 0);
      const m = P.mask().ellipse(fx, fy, 2, 1.6).add(fx + (side ? 2 : -2), fy - 1).add(fx + (side ? 3 : -3), fy - 1);
      if (atk) m.capsule(fx - 3, fy - 2, fx + 3, fy - 2, 1.4);
      P.part(m, ['#0e0c14', '#1a1824', '#2a2838', '#3e3c50', '#5a5870'], { sep: true });
      P.g.set(fx + (side ? 3 : -3), fy, GOLDR[3]); P.g.set(fx + (side ? 1 : -1), fy - 1, g.glow);
    } else if (g.familiar === 'wisp' || g.familiar === 'skull') {
      const a = t * Math.PI / 2, fx = 16 + Math.cos(a) * 12, fy = 6 + b + Math.sin(a) * 3;
      if (g.familiar === 'wisp') { P.part(P.mask().ellipse(fx, fy, 1.8, 1.8), g.GL, { flat: true, base: 3 }); P.g.set(fx - Math.cos(a) * 2.5, fy - Math.sin(a), g.GL[2]).set(fx - Math.cos(a) * 4, fy - Math.sin(a) * 1.5, g.GL[1]); }
      else { P.part(P.mask().ellipse(fx, fy, 2.3, 2.1), BONER, { sep: true }); P.g.set(fx - 1, fy, g.glow).set(fx + 1, fy, g.glow); }
    }
    if (g.motes) for (let i = 0; i < 4; i++) {
      const x = [3, 29, 6, 26][i], y = 34 - ((t * 5 + i * 9) % 26);
      P.g.set(x + (i % 2), y, i % 2 ? g.GL[4] : g.glow);
    }
    // the special move: a ring of the hero's light
    if (cast) for (let a = 0; a < Math.PI * 2; a += 0.09) {
      const rr = 15 + Math.sin(a * 6) * 1.2, x = 16 + Math.cos(a) * rr, y = 22 + Math.sin(a) * rr * 0.55;
      if (dither(Math.round(x), Math.round(y), 0.7)) P.g.set(x, y, a % 0.5 < 0.25 ? g.GL[4] : g.GL[2]);
    }
  }

  function heroFrame(g, dir, pose, step) {
    const OX = 4, OY = 8, out = new Grid(40, 48);
    const bodyPose = pose === 'cast' ? 'attack' : pose;
    const back = dir === 1;
    // behind the body
    const B = new Painter(40, 48, OX, OY);
    heroBack(g, B, dir, pose, step, bodyPose === 'walk' && step % 2 === 1 ? -1 : 0);
    let bg = B.done();
    // the body: the soldier code in the hero's own colours (back frames come back mirrored)
    const body = soldierFrame(g, dir, bodyPose, step);
    // in front
    const F = new Painter(40, 48, OX, OY);
    heroFront(g, F, dir, pose, step, bodyPose === 'walk' && step % 2 === 1 ? -1 : 0);
    let fg = F.done();
    if (back) { bg = bg.flipX(); fg = fg.flipX(); }
    out.blit(bg); out.blit(body, back ? 4 : OX, OY); out.blit(fg);
    // aura: a second outline in the hero's glow colour, shimmering between two tones
    if (g.aura !== false) {
      const k = pack(INK), src = out.copy();
      for (let y = 0; y < 48; y++) for (let x = 0; x < 40; x++) {
        if (src.filled(x, y)) continue;
        if (src.get(x - 1, y) === k || src.get(x + 1, y) === k || src.get(x, y - 1) === k || src.get(x, y + 1) === k)
          out.set(x, y, (x + y + step) % 3 === 0 ? g.GL[4] : g.glow, 220);
      }
    }
    return out;
  }
  function genHero32(o) {
    const g = heroGenome(o);
    g.aura = o.aura !== 'off';
    const sheet = new Grid(160, 288);
    const rows = [['walk', 0], ['walk', 1], ['walk', 2], ['walk', 3], ['attack', 0], ['cast', 0]];
    rows.forEach(([pose, step], row) => {
      for (let col = 0; col < 4; col++) {
        const fr = col === 3 ? heroFrame(g, 2, pose, step).flipX() : heroFrame(g, col, pose, step);
        sheet.blit(fr, col * 40, row * 48);
      }
    });
    const tracks = [0, 1, 2, 3].map(c => [0, 1, 2, 3].map(r => ({ x: c * 40, y: r * 48 })));
    tracks.push([0, 1, 2, 3].map(c => ({ x: c * 40, y: 192 })));
    tracks.push([0, 0, 1, 1, 2, 2, 3, 3].map(c => ({ x: c * 40, y: 240 })));
    return { img: sheet, anim: { fw: 40, fh: 48, fps: 6, tracks, labels: ['front', 'back', 'left', 'right', 'attack', 'special'] }, name: `hero-${g.kind}-${g.heroWeapon}-${g.palName}` };
  }

  // ================================================================ HERO PORTRAITS
  // A 64 x 64 bust for dialogue, made from the same genome as the hero sheet (same
  // seed and options = the same person): hat, hair, beard, colours, cape, weapon,
  // familiar and marks all match. Three expressions side by side: neutral, fierce, smile.
  const EXPRESSIONS = ['neutral', 'fierce', 'smile'];
  function portraitBust(g, expr) {
    const W = 64, cx = 32, cy = 26, M = g.M, S2 = g.S2, S = ramp(mix(g.skin[2], '#b89a88', 0.18), 6, 0.42), Hh = ramp(g.hair[2], 6, 0.55);
    // background: a dark vignette lit by the hero's glow
    const bg = new Grid(W, W), BGR = ramp(mix(g.glow, '#0c0a14', 0.72), 5, 0.5);
    bg.each((x, y) => { const d = Math.hypot(x - cx, (y - 24) * 1.1) / 44; return rampAt(BGR, 0.85 - d * 0.9, x, y); });
    if (g.motes) { const r = R.make(g.capeSeed, 'motes'); for (let i = 0; i < 10; i++) { const x = r.int(2, 61), y = r.int(2, 44); bg.set(x, y, g.GL[3]); if (i % 3 === 0) bg.set(x + 1, y, g.GL[2]).set(x - 1, y, g.GL[2]).set(x, y - 1, g.GL[2]).set(x, y + 1, g.GL[2]); } }
    const P = new Painter(W, W);
    const hat = g.hat, masked = hat === 'beak' || hat === 'deephood';
    // ---- behind: weapon over the shoulder, long or wild hair, hood backs, cape
    const Wp = g.heroWeapon;
    if (['greatsword', 'maul', 'greataxe', 'spear', 'staff', 'skullstaff', 'quarterstaff', 'scythe', 'scepter', 'rapier'].includes(Wp)) {
      const long = ['spear', 'staff', 'skullstaff', 'quarterstaff', 'scythe'].includes(Wp);
      drawHeroWeapon(P, g, Wp, long ? 52 : 50, long ? 80 : 66, long ? -84 : -78, long ? 2.3 : 2.4);
    }
    if (Wp === 'longbow') { const m = P.mask(); for (let t = -1; t <= 1; t += 0.02) m.capsule(52 + 6 * (1 - t * t), 34 + t * 30, 52 + 6 * (1 - (t + 0.02) ** 2), 34 + (t + 0.02) * 30, 2.2); P.part(m, WOODR, {}); P.g.line(52, 4, 52, 64, '#d8d0b8'); }
    if (g.cape && g.cape !== 'scarf' && g.cape !== 'fur') P.part(P.mask().poly([[2, 64], [62, 64], [58, 46], [6, 46]]), g.cape === 'ermine' ? ramp('#a01828', 5, 0.5) : M, { base: 1 });
    if (g.hairStyle0 === 'wild' && !masked) { const m = P.mask(); for (let i = 0; i < 9; i++) { const a = -Math.PI * (0.02 + i * 0.12); m.capsule(cx, cy, cx + Math.cos(a) * 20, cy - 2 + Math.sin(a) * 18, 6); } P.part(m, Hh, { tex: (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 1 : 0) }); }
    if (g.hairStyle === 'long' && !masked && hat !== 'hood') P.part(P.mask().poly([[19, 20], [45, 20], [49, 50], [15, 50]]), Hh, { tex: (x) => (x % 4 === 0 ? -1 : 0) });
    if (hat === 'hood' || hat === 'deephood') P.part(P.mask().ellipse(cx, 30, 18, 21), M, { base: 1 });
    // ---- shoulders and clothes
    const T = HEROES[g.kind].torso;
    const bust = P.mask().poly([[2, 64], [62, 64], [59, 52], [48, 45], [16, 45], [5, 52]]);
    const clothFn = T === 'motley' ? (x, y) => ((Math.floor((x + y) / 6) + Math.floor((x - y + 80) / 6)) % 2 ? M : S2)
      : T === 'doublet' ? (x) => (Math.floor(x / 3) % 3 === 0 ? S2 : M)
      : T === 'bare' ? () => S : T === 'plate' ? (x) => (x >= 24 && x <= 40 ? M : STEEL)
      : T === 'coat' ? (x) => (x >= 29 && x <= 35 ? S2 : M) : () => M;
    P.part(bust, clothFn, { spec: T === 'plate', tex: T === 'robe' || T === 'habit' ? (x) => (x % 7 === 0 ? -1 : 0) : null });
    P.part(P.mask().rect(26, 34, 38, 47), S, { shade: (x, y) => (y < 40 ? -1 : 0) });                        // neck
    if (T === 'plate') {
      for (const x of [11, 53]) { const pm = P.mask().ellipse(x, 53, 11, 8); P.part(pm, STEEL, { spec: true, sep: true }); pm.each((xx, yy) => { if (!pm.has(xx, yy - 1) || !pm.has(xx, yy + 2)) P.g.set(xx, yy, GOLDR[3]); }); }
      P.part(P.mask().poly([[24, 44], [40, 44], [38, 48], [26, 48]]), STEEL, { spec: true, sep: true });       // gorget
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; P.g.line(32, 56, 32 + Math.cos(a) * 4, 56 + Math.sin(a) * 4, i % 2 ? GOLDR[2] : GOLDR[4]); } P.g.set(32, 56, g.glow);
    }
    if (T === 'coat') for (const f of [-1, 1]) P.part(P.mask().poly([[cx + 5 * f, 47], [cx + 12 * f, 46], [cx + 13 * f, 33], [cx + 8 * f, 38]]), S2, { sep: true });   // high collar
    if (T === 'doublet') { const m = P.mask(); for (let x = 22; x <= 42; x += 2) m.add(x, 44).add(x + 1, 45).add(x, 46).add(x, 45); P.part(m, ramp('#f4f0e8', 5, 0.3), { sep: true }); }   // ruff
    if (T === 'habit') P.part(P.mask().ellipse(cx, 47, 17, 4), M, { sep: true, base: 2 });                     // hood down
    if (T === 'robe') { P.g.line(26, 45, 32, 56, S2[2]); P.g.line(38, 45, 32, 56, S2[2]); }
    if (T === 'tunic' && g.kind === 'shieldmaiden') for (const x of [11, 53]) P.part(P.mask().ellipse(x, 54, 10, 8), STEEL, { tex: mailTex, base: 1, sep: true });
    if (T === 'bare') { P.g.line(24, 54, 31, 57, S[1]); P.g.line(40, 54, 33, 57, S[1]); if (g.paint) for (let i = 0; i < 3; i++) P.g.line(22 + i * 3, 50, 26 + i * 3, 62, M[2]); }
    if (g.cape === 'fur') { const m = P.mask(); for (let i = 0; i < 9; i++) m.ellipse(6 + i * 6.5, 48 + (i % 2) * 2, 6, 5); P.part(m, FUR, { sep: true, tex: (x, y) => ((x + y * 2) % 3 === 0 ? 1 : 0) }); }
    if (g.cape === 'ermine') P.part(P.mask().poly([[4, 52], [60, 52], [56, 46], [8, 46]]), ermineFn, { sep: true });
    if (g.cape === 'long' || g.cape === 'shoulder') { P.part(P.mask().ellipse(18, 49, 3, 3), GOLDR, { spec: true, sep: true }); P.g.set(18, 49, g.glow); }
    if (g.cape === 'scarf') P.part(P.mask().poly([[18, 44], [46, 44], [50, 52], [14, 52]]), S2, { sep: true, tex: (x, y) => (y % 3 === 0 ? -1 : 0) });
    if (g.skulls) for (const x of [10, 54]) { P.part(P.mask().ellipse(x, 51, 7, 6.5), BONER, { sep: true }); P.part(P.mask().ellipse(x - 2.5, 51, 1.6, 2), ['#141010', '#141010', '#141010', '#141010'], { flat: true }); P.part(P.mask().ellipse(x + 2.5, 51, 1.6, 2), ['#141010', '#141010', '#141010', '#141010'], { flat: true }); P.g.set(x - 2, 51, g.glow).set(x + 3, 51, g.glow); P.g.hline(x - 3, x + 3, 56, '#3a3228'); }
    if (g.beads) for (let i = 0; i <= 14; i++) { const a = Math.PI * (0.1 + i * 0.057); P.part(P.mask().ellipse(cx + Math.cos(a) * 12, 44 + Math.sin(a) * 9, 1.3, 1.3), i % 3 ? ['#2a1810', '#4a2e1e', '#6e4a30', '#946a44'] : GOLDR, {}); }
    if (g.potions) for (let i = 0; i < 4; i++) { const c = ramp(['#e04040', '#40c060', '#4080e0', '#e0c040'][i], 4, 0.5); P.part(P.mask().rect(14 + i * 5, 55 + (i % 2), 16 + i * 5, 60 + (i % 2)), c, { sep: true }); }
    if (g.quiver) { P.part(P.mask().capsule(44, 50, 52, 38, 5), LEATHER, { sep: true }); for (let i = 0; i < 3; i++) P.part(P.mask().capsule(48 + i * 2, 38 - i, 50 + i * 3, 31 - i, 1.8), i % 2 ? ramp('#e8e0d0', 4, 0.3) : M, {}); P.g.line(16, 46, 46, 62, LEATHER[1]); }
    if (g.runes) for (let i = 0; i < 5; i++) { const x = 14 + i * 9, y = 58 + (i % 2) * 2; P.g.set(x, y, g.glow).set(x + 1, y - 1, g.glow).set(x + 2, y, g.GL[2]); }
    // ---- head
    const head = P.mask();
    for (let y = 12; y <= 40; y++) for (let x = 18; x <= 46; x++) {
      const dx = (x + 0.5 - cx) / 11.5, dy = (y + 0.5 - cy) / 13.5;
      if (dx * dx + dy * dy > 1) continue;
      if (y > 31 && Math.abs(x + 0.5 - cx) > 11.5 - (y - 31) * 0.75) continue;            // jaw
      head.add(x, y);
    }
    P.part(P.mask().ellipse(20, 28, 2.4, 4).ellipse(44, 28, 2.4, 4), S, { sep: true });                      // ears
    P.part(head, S, { sep: true });
    // ---- face
    const fierce = expr === 'fierce', smile = expr === 'smile', glowEyes = g.glowEyes;
    if (!masked) {
      // eyes
      for (const [ex, f] of [[26, -1], [38, 1]]) {
        if (g.mark === 'eyepatch' && f > 0) { P.part(P.mask().ellipse(ex, 28, 3.6, 3), ['#141010', '#1e1a1a', '#2a2424', '#383030'], {}); P.g.line(19, 21, 45, 29, '#2a2020'); continue; }
        P.g.hline(ex - 3, ex + 2, 26, '#2a1814');                                                       // upper lid
        P.g.hline(ex - 2, ex + 1, 27, '#f4f0ea').hline(ex - 2, ex + 1, 28, '#e4dcd4');
        const iris = glowEyes ? g.glow : g.eye || '#3a5a8a';
        P.g.set(ex - 1, 27, iris).set(ex, 27, iris).set(ex - 1, 28, iris).set(ex, 28, mix(iris, '#000000', 0.4));
        if (!glowEyes) P.g.set(ex - 1, 27, '#ffffff'); else { P.g.set(ex + 2, 27, g.GL[2]).set(ex - 3, 27, g.GL[2]); }
        P.g.hline(ex - 2, ex + 1, 29, S[2]);
        if (fierce) { P.g.hline(ex - 2, ex + 1, 28, S[2]); P.g.hline(ex - 3, ex + 2, 26, '#1a0e0c'); }            // narrowed
        if (smile) { P.g.hline(ex - 2, ex + 1, 28, S[3]); P.g.hline(ex - 2, ex + 1, 29, S[4]); P.g.set(ex - 3, 27, '#2a1814').set(ex + 2, 27, '#2a1814'); }   // eyes curved by the cheeks
        // brows
        const inner = f < 0 ? ex + 2 : ex - 3, outer = f < 0 ? ex - 3 : ex + 2;
        const yIn = fierce ? 25 : smile ? 21 : 23, yOut = fierce ? 21 : smile ? 22 : 23;
        P.g.line(outer, yOut, inner, yIn, Hh[1]); P.g.line(outer, yOut - 1, inner, yIn - 1, Hh[2]);
        if (fierce) P.g.line(outer, yOut + 1, inner, yIn + 1, Hh[0]);
      }
      // nose and cheeks
      P.g.vline(33, 28, 33, S[2]); P.g.set(32, 31, S[4]).set(31, 34, S[1]).set(34, 34, S[1]).set(32, 34, S[2]).set(33, 34, S[2]);
      P.g.set(23, 33, mix(S[3], '#e07070', 0.35)).set(41, 33, mix(S[2], '#e07070', 0.35));
      if (g.mark === 'scar') P.g.line(23, 22, 27, 34, mix(S[2], '#a02030', 0.55));
      if (g.paint) { P.g.hline(21, 27, 31, M[2]); P.g.hline(37, 43, 31, M[2]); P.g.hline(22, 26, 32, M[1]); P.g.hline(38, 42, 32, M[1]); }
      if (g.kind === 'jester') { for (const x of [24, 40]) P.part(P.mask().ellipse(x, 33, 2, 1.6), ramp('#e04070', 4, 0.4), { flat: true }); P.g.set(26, 24, '#141010').set(26, 30, '#141010').set(38, 24, '#141010').set(38, 30, '#141010'); }
      // beard
      if (g.beard === 'full' || g.beard === 'goatee' || g.beard === 'moustache' || g.beard === 'stubble') {
        const bm = P.mask();
        if (g.beard === 'full') head.each((x, y) => { if (y >= 33 || (y >= 30 && (x <= 23 || x >= 41))) bm.add(x, y); });
        if (g.beard === 'full') bm.poly([[22, 38], [42, 38], [38, 47], [26, 47]]);
        if (g.beard === 'goatee') bm.poly([[29, 39], [35, 39], [33, 45], [31, 45]]);
        if (g.beard !== 'stubble') bm.poly([[26, 36], [38, 36], [40, 38], [33, 35.5], [31, 35.5], [24, 38]]);
        if (g.beard === 'stubble') head.each((x, y) => { if (y >= 32 && (x + y) % 2 === 0) bm.add(x, y); });
        bm.del(30, 37); bm.del(31, 37); bm.del(32, 37); bm.del(33, 37); bm.del(34, 37);
        P.part(bm, g.beard === 'stubble' ? S.map(c => mix(c, Hh[1], 0.45)) : Hh, { tex: (x, y) => ((x * 3 + y) % 5 === 0 ? -1 : 0), sep: g.beard !== 'stubble' });
      }
    }
    if (!masked) {
      // mouth (after the beard, so it always shows)
      const lip = mix(S[1], '#8a2a30', 0.5);
      if (smile) { P.g.hline(28, 36, 37, '#2a1814'); P.g.set(27, 36, '#2a1814').set(37, 36, '#2a1814').set(26, 35, S[1]).set(38, 35, S[1]); P.g.hline(29, 35, 38, '#f4ece4'); P.g.hline(30, 34, 39, '#7a2a30'); P.g.hline(30, 34, 40, lip);
        P.g.set(23, 32, mix(S[3], '#e06070', 0.5)).set(24, 32, mix(S[3], '#e06070', 0.5)).set(40, 32, mix(S[2], '#e06070', 0.5)).set(41, 32, mix(S[2], '#e06070', 0.5)); }
      else if (fierce) { P.g.hline(28, 36, 37, '#2a1814'); P.g.hline(28, 36, 38, '#f4ece4'); P.g.set(30, 38, '#c8bcb0').set(34, 38, '#c8bcb0'); P.g.hline(28, 36, 39, '#2a1814'); P.g.set(27, 38, '#2a1814').set(37, 38, '#2a1814'); P.g.set(32, 24, S[1]).set(32, 25, S[1]); }
      else { P.g.hline(29, 35, 37, lip); P.g.hline(30, 34, 38, S[3]); }
    }
    // ---- hair (front)
    if (!masked && hat !== 'hood' && g.hairStyle !== 'bald') {
      const hm = P.mask();
      head.each((x, y) => { const fringe = 19 + ((x * 7) % 3) + (g.hairStyle0 === 'wild' ? ((x * 5) % 4) : 0); if (y < fringe || ((x <= 21 || x >= 43) && y < 31)) hm.add(x, y); });
      hm.ellipse(cx, 15, 12.5, 5);
      if (g.hairStyle === 'long') { hm.rect(18, 20, 21, 46); hm.rect(43, 20, 46, 46); }
      P.part(hm, Hh, { tex: (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 1 : (x + y) % 6 === 0 ? -1 : 0), sep: true, sepSides: (dx, dy) => dy > 0 });
    }
    if (g.hairStyle === 'bald' && !masked && hat === 'none') { P.g.set(27, 15, S[5]).set(28, 15, S[5]).set(26, 16, S[4]); }
    if (g.hairStyle0 === 'braids') for (const x of [17, 47]) P.part(P.mask().capsule(x, 30, x + (x < 32 ? -1 : 1), 58, 4.4), Hh, { tex: (xx, y) => (y % 3 === 0 ? -1 : 0), sep: true });
    // ---- headgear
    if (hat === 'witch') {
      P.part(P.mask().poly([[21, 15], [43, 15], [40, 6], [54, -2], [44, -3], [32, 2], [26, 6]]), M, { sep: true });
      P.part(P.mask().ellipse(cx, 16, 24, 3.6), M, { sep: true, base: 1 });
      P.part(P.mask().rect(22, 12, 42, 14), S2, { flat: true });
      P.part(P.mask().rect(30, 11, 34, 15), GOLDR, { spec: true }); P.g.set(32, 13, g.glow);
    } else if (hat === 'cavalier') {
      P.part(P.mask().ellipse(cx, 9, 11, 7), M, { sep: true });
      P.part(P.mask().ellipse(cx, 15, 22, 3.6), M, { sep: true });
      P.part(P.mask().rect(21, 11, 43, 13), S2, { flat: true });
      const fm = P.mask().capsule(38, 10, 48, 0, 6).capsule(48, 0, 62, 6, 4.5);
      P.part(fm, ramp(g.palName === 'sun' ? '#f8f4e8' : g.glow, 5, 0.5), { tex: (x, y) => ((x + y) % 2 ? 0 : -1), sep: true });
    } else if (hat === 'hood' || hat === 'deephood') {
      const m = P.mask().ellipse(cx, 27, 16, 19); m.add(cx, 6).add(cx, 7);
      const open = P.mask().ellipse(cx, 31, hat === 'deephood' ? 9 : 11, hat === 'deephood' ? 11 : 13);
      open.each((x, y) => m.del(x, y));
      P.part(m, M, { sep: true });
      if (hat === 'deephood') {
        P.part(open, ['#06040a', '#0c0810', '#120e18', '#18141e'], { flat: true, base: 0 });
        for (const ex of [28, 36]) { P.part(P.mask().ellipse(ex, 30, 1.6, 1.2), g.GL, { flat: true, base: 3 }); P.g.set(ex + (ex < 32 ? -2 : 2), 30, g.GL[1]); }
        if (expr === 'fierce') for (const ex of [28, 36]) P.g.set(ex, 28, g.GL[2]);
      }
      if (g.kind === 'huntress') {
        const WOLF = ['#2a2a30', '#4a4a52', '#76767e', '#a4a4aa', '#d0d0d4'];
        for (const f of [-1, 1]) P.part(P.mask().poly([[cx + 4 * f, 10], [cx + 13 * f, 10], [cx + 11 * f, -1]]), WOLF, { sep: true });
        P.part(P.mask().ellipse(cx, 13, 13, 5), WOLF, { sep: true });
        P.g.set(27, 13, g.glow).set(37, 13, g.glow);
        P.part(P.mask().poly([[19, 34], [45, 34], [44, 42], [20, 42]]), S2, { sep: true, tex: (x, y) => (y % 3 === 0 ? -1 : 0) });   // scarf mask
      }
    } else if (hat === 'jester') {
      P.part(P.mask().capsule(26, 12, 14, 2, 8).capsule(14, 2, 5, 13, 6), M, { sep: true });
      P.part(P.mask().capsule(38, 12, 50, 2, 8).capsule(50, 2, 59, 13, 6), S2, { sep: true });
      P.part(P.mask().ellipse(cx, 15, 13, 5), M, { sep: true });
      for (const x of [5, 59]) P.part(P.mask().ellipse(x, 15, 3, 3), GOLDR, { spec: true, sep: true });
    } else if (hat === 'crown' || hat === 'darkcrown' || hat === 'laurel') {
      if (hat === 'laurel') { for (let i = 0; i < 14; i++) { const a = Math.PI * (1.05 + i * 0.065), x = cx + Math.cos(a) * 13, y = 19 + Math.sin(a) * 8; P.part(P.mask().ellipse(x, y, 2.2, 1.4), ramp(i % 2 ? '#3a8a2a' : '#6ac040', 4, 0.4), { sep: true }); } }
      else {
        const C = hat === 'crown' ? GOLDR : ramp('#4a4450', 5, 0.5), m = P.mask().rect(20, 10, 44, 15);
        for (let i = 0; i < 5; i++) m.poly([[20 + i * 6, 11], [25 + i * 6, 11], [22.5 + i * 6, hat === 'crown' ? 3 : 0]]);
        P.part(m, C, { spec: true, sep: true });
        [[24, '#d02030'], [32, '#2a60d0'], [40, '#30a040']].forEach(([x, c]) => P.part(P.mask().ellipse(x, 13, 1.6, 1.6), hat === 'crown' ? ramp(c, 4, 0.5) : g.GL, { flat: true, base: 2 }));
      }
    } else if (hat === 'straw') {
      P.part(P.mask().poly([[-2, 19], [66, 19], [36, 3], [28, 3]]), STRAW, { tex: (x, y) => ((x + y) % 3 === 0 ? -1 : (x - y) % 5 === 0 ? 1 : 0), sep: true });
      head.each((x, y) => { if (y >= 20 && y <= 23) P.g.set(x, y, mix(S[1], '#000000', 0.25)); });
    } else if (hat === 'beak') {
      P.part(P.mask().rect(21, -1, 43, 12), ramp('#2a2430', 5, 0.4), { sep: true });
      P.part(P.mask().ellipse(cx, 14, 22, 3.6), ramp('#2a2430', 5, 0.4), { sep: true });
      P.part(P.mask().rect(21, 9, 43, 10), S2, { flat: true });
      P.part(P.mask().ellipse(cx, 27, 11, 10.5), BONER, { sep: true });
      P.part(P.mask().poly([[26, 31], [38, 31], [36, 38], [30, 54], [28, 44]]), BONER, { sep: true });
      P.g.line(29, 41, 31, 50, BONER[1]);
      for (const ex of [26, 38]) { P.part(P.mask().ellipse(ex, 26, 4, 4), GOLDR, { spec: true, sep: true }); P.part(P.mask().ellipse(ex, 26, 2.6, 2.6), g.GL, { flat: true, base: expr === 'fierce' ? 3 : 2 }); P.g.set(ex - 1, 25, '#ffffff'); }
    } else if (hat === 'horns' || hat === 'winged') {
      const C = hat === 'winged' && g.over && g.over.plate ? GOLDR : STEEL;
      for (const f of [-1, 1]) {
        if (hat === 'horns') P.part(P.mask().capsule(cx + 11 * f, 15, cx + 19 * f, 9, 6).capsule(cx + 19 * f, 9, cx + 21 * f, -1, 4).capsule(cx + 21 * f, -1, cx + 18 * f, -6, 2.4), BONER, { sep: true });
        else for (let i = 3; i >= 0; i--) P.part(P.mask().capsule(cx + 11 * f, 17, cx + (18 + i * 3.5) * f, 13 - i * 4.5, 5.2 - i * 0.5), BONER, { sep: true, tex: (x, y) => ((x + y) % 3 === 0 ? -1 : 0) });
      }
      const dome = P.mask().ellipse(cx, 19, 13.5, 9.5); dome.each((x, y) => { if (y > 21) dome.del(x, y); });
      P.part(dome, C, { spec: true, sep: true });
      P.part(P.mask().rect(cx - 1, 20, cx + 1, 31), C, { spec: true, sep: true });                          // nasal
    } else if (hat === 'halo') {
      for (let a = 0; a < Math.PI * 2; a += 0.04) { P.g.set(cx + Math.cos(a) * 14, 5 + Math.sin(a) * 3.2, a > Math.PI ? GOLDR[4] : GOLDR[3]); P.g.set(cx + Math.cos(a) * 15, 5 + Math.sin(a) * 3.6, g.GL[2]); }
    }
    // ---- familiars
    if (g.familiar === 'raven') {
      P.part(P.mask().ellipse(11, 40, 6, 5).ellipse(8, 33, 3.6, 3.4).capsule(14, 42, 20, 47, 3.6), ['#0e0c14', '#1a1824', '#2a2838', '#3e3c50', '#5a5870'], { sep: true });
      P.part(P.mask().poly([[5, 32], [5, 35], [0, 34]]), GOLDR, {}); P.g.set(8, 32, g.glow);
    } else if (g.familiar === 'wisp') {
      P.part(P.mask().ellipse(55, 14, 3.6, 3.6), g.GL, { flat: true, base: 3 }); P.part(P.mask().ellipse(55, 14, 1.8, 1.8), g.GL, { flat: true, base: 4 });
      for (let i = 1; i < 6; i++) P.g.set(55 + i * 1.2, 14 + i * 1.6, g.GL[Math.max(1, 3 - (i >> 1))]);
    } else if (g.familiar === 'skull') {
      P.part(P.mask().ellipse(55, 13, 5, 4.6).rect(52, 15, 58, 19), BONER, { sep: true });
      P.g.set(53, 13, g.glow).set(57, 13, g.glow).set(53, 14, '#141010').set(57, 14, '#141010'); P.g.hline(53, 57, 18, '#3a3228');
    }
    // ---- in front: books, daggers, flasks held up
    if (Wp === 'tome') { P.part(P.mask().rect(6, 46, 22, 60), M, { sep: true }); P.part(P.mask().rect(8, 48, 20, 58), GOLDR, { flat: true, base: 1 }); P.part(P.mask().rect(10, 50, 18, 56), M, { flat: true }); P.part(P.mask().ellipse(14, 53, 2.2, 2.2), g.GL, { flat: true, base: 3 }); }
    if (Wp === 'daggers') { drawHeroWeapon(P, g, 'dagger', 16, 64, -60, 2.4); drawHeroWeapon(P, g, 'dagger', 48, 64, -120, 2.4); }
    if (Wp === 'flask') { drawHeroWeapon(P, g, 'flask', 54, 52, -90, 2.6); P.part(P.mask().ellipse(54, 58, 3.6, 3), (g.over && g.over.hands) || S, { sep: true }); }
    let img = P.done();
    // aura ring around the silhouette
    const k = pack(INK), src = img.copy();
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (src.filled(x, y)) continue;
      if (src.get(x - 1, y) === k || src.get(x + 1, y) === k || src.get(x, y - 1) === k || src.get(x, y + 1) === k) img.set(x, y, (x + y) % 3 === 0 ? g.GL[4] : g.glow);
    }
    bg.blit(img);
    // a thin frame
    for (let i = 0; i < W; i++) { bg.set(i, 0, INK).set(i, W - 1, INK).set(0, i, INK).set(W - 1, i, INK); bg.set(i, 1, g.GL[1]).set(1, i, g.GL[1]); }
    return bg;
  }
  function genHeroPortrait(o) {
    const g = heroGenome(o);
    const sheet = new Grid(64 * 3, 64);
    EXPRESSIONS.forEach((e, i) => sheet.blit(portraitBust(g, e), i * 64, 0));
    return { img: sheet, anim: { fw: 64, fh: 64, fps: 1.5, tracks: [[0, 1, 2].map(i => ({ x: i * 64, y: 0 }))], labels: ['neutral / fierce / smile'] }, name: `portrait-${g.kind}-${g.palName}` };
  }

  Object.assign(PG.GENERATORS, {
    arms:    { group: 'Medieval 32px', fn: genArms,    label: 'Coat of arms', size: '32 x 36', options: { own: ['no', 'yes'] } },
    soldier: { group: 'Medieval 32px', fn: genSoldier, label: 'Soldier sheet', size: '32 x 40 frames', options: { troop: ['random', ...Object.keys(TROOPS)], robe: ['no', 'yes'], weapon: ['random', 'sword', 'mace', 'axe', 'spear', 'halberd', 'poleaxe', 'bill', 'longbow', 'crossbow', 'staff'], helm: ['random', 'none', 'greathelm', 'bascinet', 'sallet', 'kettle', 'coif', 'hood', 'cap'] } },
    champion: { group: 'Medieval 32px', fn: genHero32, label: 'Hero sheet', size: '40 x 48 frames', options: { hero: ['random', ...Object.keys(HEROES)], weapon: ['random', ...Object.keys(HERO_WEAPONS).filter(k => k !== 'dagger'), 'tome', 'longbow', 'daggers'], palette: ['own', 'faction'], aura: ['on', 'off'] } },
    heroface: { group: 'Medieval 32px', fn: genHeroPortrait, label: 'Hero portrait', size: '64 x 64 x 3 moods', options: { hero: ['random', ...Object.keys(HEROES)], weapon: ['random', ...Object.keys(HERO_WEAPONS).filter(k => k !== 'dagger'), 'tome', 'longbow', 'daggers'], palette: ['own', 'faction'] } },
    cavalry: { group: 'Medieval 32px', fn: genCavalry, label: 'Cavalry sheet', size: '48 x 52 frames', options: { mount: Object.keys(MOUNTS), troop: ['random', 'knight', 'manatarms', 'captain', 'spearman', 'archer', 'levy'], weapon: ['random', 'lance', 'sword', 'mace', 'axe', 'spear'], coat: ['random', ...Object.keys(COATS)] } },
    field:   { group: 'Medieval 32px', fn: genField,   label: 'Field ground', size: '64 x 64 seamless', options: { field: ['random', ...Object.keys(FIELD)] } },
    decal:   { group: 'Medieval 32px', fn: genDecal,   label: 'Ground decal', size: '32 x 24', options: { decal: ['random', 'blood', 'scorch', 'trampled'] } },
    prop:    { group: 'Medieval 32px', fn: genProp,    label: 'Camp prop', size: 'varies', options: { prop: ['random', ...PROPS] } },
  });
  PG.medieval = { rollArms, blazon, TINCT,
    // drawing kit for add-on sets (creatures.js)
    Painter, Mask, Grid, INK, STEEL, LEATHER, WOODR, BLOOD, BONER, GOLDR, FUR, STRAW, mailTex, quiltTex,
    soldierGenome, soldierFrame, footFrame, tone, drawWeapon, drawHeroWeapon, HERO_WEAPONS, corpse, heaterMask, tRamp, MOUNTS };
})(typeof window !== 'undefined' ? window : globalThis);
