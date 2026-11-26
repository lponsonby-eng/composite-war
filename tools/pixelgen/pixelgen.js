// =============================================================================
//  PIXELGEN: pixel-art generators that run entirely offline (no APIs, no network).
//  Every generator is seeded: the same seed + options always gives the same picture,
//  so a design you like can be written down as "hero ember 1234" and made again.
//
//  Works in the browser (window.PixelGen, used by tools/pixelgen/index.html) and in
//  Node (require('./pixelgen'), used by tools/pixelgen/cli.js). No dependencies.
//
//    PixelGen.generate(kind, { seed, faction, ...options })  ->  { img, anim, name }
//      img   a Grid (w, h, RGBA pixels); img.toRGBA() gives a Uint8ClampedArray
//      anim  { fw, fh, fps, tracks: [[{x, y}, ...], ...] } frames for previews
//
//  Kinds and the game formats they match:
//    hero     64 x 112 unit sheet like assets/chars  (cols: down/up/left/right,
//             rows 0-3 walk, row 4 attack, row 5 hurt, row 6 cast)
//    portrait 38 x 38 face like assets/faces
//    monster  64 x 64 sheet like assets/monsters (cols: dirs, rows: 4 frames)
//    fx       32 x 32 frame strips like assets/fx (burst, slash, sparkle, smoke, orb)
//    tile     32 x 32 seamless ground tiles (grass, dirt, cobble, sand, snow, ...)
//    item     16 x 16 icons (sword, axe, spear, bow, staff, shield, potion, gem, scroll)
//    palette  a hue-shifted colour ramp swatch for a faction or any base colour
// =============================================================================
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- random
  function makeRng(seed) {
    seed = (seed | 0) || 1;
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashSeed(...parts) {
    let h = 2166136261;
    for (const p of parts) for (const ch of String(p)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  const R = {
    make(seed, salt) {
      const r = makeRng(hashSeed(seed, salt || ''));
      r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
      r.pick = arr => arr[Math.floor(r() * arr.length)];
      r.chance = p => r() < p;
      r.range = (a, b) => a + r() * (b - a);
      return r;
    },
  };

  // ---------------------------------------------------------------- colour
  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 1) + 1) % 1;
    if (!s) { const v = l * 255; return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const clamp01 = v => Math.max(0, Math.min(1, v));
  // Move hue h toward target t by k (0..1), the short way round.
  function hueToward(h, t, k) { let d = ((t - h + 1.5) % 1) - 0.5; return h + d * k; }

  // A pixel-art colour ramp from dark to light around a base colour. Shadows drift
  // toward blue-violet and gain saturation, highlights drift toward warm yellow:
  // the classic "hue shifting" that makes pixel art look painted rather than greyed.
  function ramp(base, n = 5, spread = 0.62) {
    const [h, s, l] = rgbToHsl(...hexRgb(base));
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;          // -1 dark .. +1 light
      const ll = clamp01(l + t * spread * (t < 0 ? l : 1 - l) * 1.15);
      const hh = t < 0 ? hueToward(h, 0.70, -t * 0.12) : hueToward(h, 0.14, t * 0.10);
      const ss = clamp01(s * (t < 0 ? 1 + -t * 0.15 : 1 - t * 0.25));
      out.push(rgbHex(...hslToRgb(hh, ss, ll)));
    }
    return out;
  }
  function mix(a, b, k) {
    const A = hexRgb(a), B = hexRgb(b);
    return rgbHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
  }
  function hueShift(hex, deg) {
    const [h, s, l] = rgbToHsl(...hexRgb(hex));
    return rgbHex(...hslToRgb(h + deg / 360, s, l));
  }

  // Faction colours, kept in step with DATA.factions / Heraldry.STYLE in the game.
  const FACTIONS = {
    aster:   { main: '#3d7be0', accent: '#e8c860', name: 'Kingdom of Aster' },
    frost:   { main: '#6fb8dc', accent: '#e8f8ff', name: 'Frostmark' },
    thorn:   { main: '#1fa38a', accent: '#a8d870', name: 'Thornwood Pact' },
    ember:   { main: '#e0483d', accent: '#ffb03a', name: 'Ember Clan' },
    shadow:  { main: '#9b4fd6', accent: '#c88aff', name: 'Shadow Order' },
    horde:   { main: '#7bc043', accent: '#e8d040', name: 'Wild Horde' },
    azure:   { main: '#e05aa8', accent: '#7ae8ff', name: 'Azure Tide' },
    sun:     { main: '#e0a030', accent: '#fff0b0', name: 'Sun Dominion' },
    neutral: { main: '#8a8a92', accent: '#c8b070', name: 'Free Towns' },
  };
  // The element each faction leans on, for staffs, orbs and effects.
  const FACTION_ELEMENT = { aster: 'holy', frost: 'ice', thorn: 'nature', ember: 'fire', shadow: 'shadow',
    horde: 'nature', azure: 'ice', sun: 'holy', neutral: 'steel' };
  const ELEMENTS = {
    fire:   ['#5a1008', '#b8280c', '#f06018', '#ffb030', '#fff0a0'],
    ice:    ['#14305a', '#2a6cb0', '#58b0f0', '#a8e4ff', '#f0ffff'],
    nature: ['#0c3a18', '#1e7a2a', '#48b838', '#a8e858', '#f0ffc0'],
    shadow: ['#12061e', '#3a1260', '#7a2aa8', '#c070f0', '#f0d0ff'],
    holy:   ['#5a4410', '#b08a20', '#f0d048', '#fff09a', '#ffffff'],
    steel:  ['#20242e', '#4a5262', '#8a94a8', '#c8d0dc', '#ffffff'],
    poison: ['#1a2408', '#4a6a10', '#8ac020', '#d0f050', '#f8ffd0'],
    blood:  ['#2a0408', '#6a0a14', '#b01828', '#e85060', '#ffc0c8'],
  };
  const SKIN = ['#f6d2b0', '#eab48a', '#d89a6a', '#b87848', '#8a5430', '#5e3820', '#c8e0a0', '#a8c8e8', '#d0b8e8'];
  const HAIR = ['#2a1c14', '#5a3418', '#8a5a28', '#c89038', '#f0d070', '#e8e4dc', '#a83020', '#e05a20', '#304068', '#5a2a6a', '#2a5a3a', '#181820'];
  const EYES = ['#2a4a8a', '#3a6a2a', '#5a3418', '#202028', '#8a2a8a', '#c03020'];
  const METAL = ramp('#9aa4b8', 5);
  const GOLD = ramp('#e0b040', 5);
  const WOOD = ramp('#8a5a2b', 5);
  const LEATHER = ramp('#6a4228', 5);
  const OUTLINE = '#1a1424';
  // Mostly human skin tones, with the odd green, blue or lilac fantasy folk.
  const pickSkin = r => SKIN[r() < 0.85 ? Math.floor(r() * 6) : 6 + Math.floor(r() * 3)];

  function factionPal(f, seed) {
    const F = FACTIONS[f] || FACTIONS.neutral;
    return { main: ramp(F.main), accent: ramp(F.accent), element: ELEMENTS[FACTION_ELEMENT[f] || 'steel'] };
  }

  // ---------------------------------------------------------------- grid
  // A small RGBA image. Colours are hex strings in, packed 0xRRGGBBAA inside; 0 = empty.
  function pack(c, a = 255) {
    if (!c) return 0;
    if (typeof c === 'number') return c >>> 0;
    const [r, g, b] = hexRgb(c);
    return ((r << 24) | (g << 16) | (b << 8) | (a & 255)) >>> 0;
  }
  class Grid {
    constructor(w, h) { this.w = w; this.h = h; this.p = new Uint32Array(w * h); }
    in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    get(x, y) { x = Math.round(x); y = Math.round(y); return this.in(x, y) ? this.p[y * this.w + x] : 0; }
    set(x, y, c, a) { x = Math.round(x); y = Math.round(y); if (this.in(x, y)) this.p[y * this.w + x] = pack(c, a); return this; }
    clear(x, y) { return this.set(x, y, 0); }
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); return this; }
    hline(x0, x1, y, c) { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c); return this; }
    vline(x, y0, y1, c) { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c); return this; }
    line(x0, y0, x1, y1, c) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let e = dx + dy;
      for (;;) { this.set(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
      return this;
    }
    ellipse(cx, cy, rx, ry, c) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x - cx) / (rx + 0.5), dy = (y - cy) / (ry + 0.5);
          if (dx * dx + dy * dy <= 1) this.set(x, y, c);
        }
      return this;
    }
    // fn(x, y, current) -> colour or undefined to leave as is
    each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const v = fn(x, y, this.p[y * this.w + x]); if (v !== undefined) this.p[y * this.w + x] = pack(v); } return this; }
    filled(x, y) { return (this.get(x, y) & 255) > 0; }
    // An outline in `c` on every empty pixel that touches a filled one (4 neighbours; diag adds corners).
    outline(c = OUTLINE, diag = false) {
      const o = this.copy(), k = pack(c);
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (o.filled(x, y)) continue;
        let hit = o.filled(x - 1, y) || o.filled(x + 1, y) || o.filled(x, y - 1) || o.filled(x, y + 1);
        if (!hit && diag) hit = o.filled(x - 1, y - 1) || o.filled(x + 1, y - 1) || o.filled(x - 1, y + 1) || o.filled(x + 1, y + 1);
        if (hit) this.p[y * this.w + x] = k;
      }
      return this;
    }
    copy() { const g = new Grid(this.w, this.h); g.p.set(this.p); return g; }
    flipX() { const g = new Grid(this.w, this.h); for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.p[y * this.w + x] = this.p[y * this.w + this.w - 1 - x]; return g; }
    mirrorLeft() { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w / 2; x++) this.p[y * this.w + this.w - 1 - x] = this.p[y * this.w + x]; return this; }
    // Paste another grid (only its filled pixels) at dx, dy.
    blit(src, dx = 0, dy = 0) { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const v = src.p[y * src.w + x]; if (v & 255) { const X = x + dx, Y = y + dy; if (this.in(X, Y)) this.p[Y * this.w + X] = v; } } return this; }
    toRGBA() {
      const out = new Uint8ClampedArray(this.w * this.h * 4);
      for (let i = 0; i < this.p.length; i++) { const v = this.p[i]; out[i * 4] = v >>> 24; out[i * 4 + 1] = (v >>> 16) & 255; out[i * 4 + 2] = (v >>> 8) & 255; out[i * 4 + 3] = v & 255; }
      return out;
    }
  }
  // Bayer 4x4 ordered dither: true if value v (0..1) should be "on" at x, y.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const dither = (x, y, v) => v * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5;
  // Pick a ramp colour for value v (0..1) in clean bands, no dithering (for skin, cloth).
  function band(r, v) { return r[Math.max(0, Math.min(r.length - 1, Math.round(clamp01(v) * (r.length - 1))))]; }
  // Pick a ramp colour for value v (0..1) with dithering between steps.
  function rampAt(r, v, x, y) {
    const f = clamp01(v) * (r.length - 1), i = Math.floor(f);
    return r[Math.min(r.length - 1, dither(x, y, f - i) ? i + 1 : i)];
  }

  // ================================================================ HERO SHEET
  // A chibi soldier like the game's unit sheets: big head, small body. The genome is
  // rolled once; every frame is then drawn from it, so all frames match.
  const CLASS_GEAR = {
    warrior:  { weapons: ['sword', 'axe', 'spear', 'sword'], hats: ['helmet', 'helmet', 'none', 'bandana', 'horned'], robe: 0.05 },
    marksman: { weapons: ['bow', 'bow', 'bow', 'crossbow'], hats: ['hood', 'bandana', 'none', 'cap'], robe: 0.1 },
    mage:     { weapons: ['staff', 'staff', 'wand'], hats: ['wizard', 'hood', 'wizard', 'none'], robe: 0.85 },
    healer:   { weapons: ['staff', 'staff'], hats: ['hood', 'circlet', 'none'], robe: 0.9 },
  };
  function heroGenome(o) {
    const r = R.make(o.seed, 'hero');
    const cls = CLASS_GEAR[o.cls] ? o.cls : r.pick(Object.keys(CLASS_GEAR));
    const gear = CLASS_GEAR[cls], pal = factionPal(o.faction);
    return {
      cls,
      skin: ramp(pickSkin(r), 3, 0.35),
      hair: ramp(r.pick(HAIR), 3, 0.45),
      eye: r.pick(EYES),
      hairStyle: r.pick(['short', 'long', 'spiky', 'bald', 'tail', 'bob']),
      hat: o.hat || r.pick(gear.hats),
      weapon: o.weapon || r.pick(gear.weapons),
      robe: r.chance(gear.robe),
      cape: r.chance(0.35),
      main: pal.main, accent: pal.accent, element: pal.element,
      metal: r.chance(0.2) ? GOLD : METAL,
      pants: ramp(r.pick(['#4a3a30', '#3a3a4a', '#5a4a3a', '#2a2a34']), 3, 0.4),
      blush: r.chance(0.3),
    };
  }
  // Weapon pixels in local coords: u runs from the grip (0) toward the tip (negative),
  // v is sideways. Each entry [u, v, colour].
  function weaponShape(g, kind) {
    const M = g.metal, W = WOOD, E = g.element, A = g.accent;
    switch (kind) {
      case 'sword': return [[1, 0, M[1]], [0, 0, LEATHER[2]], [-1, -1, A[2]], [-1, 0, A[3]], [-1, 1, A[2]],
        [-2, 0, M[3]], [-3, 0, M[3]], [-4, 0, M[3]], [-5, 0, M[4]], [-6, 0, M[4]]];
      case 'axe': return [[1, 0, W[1]], [0, 0, W[2]], [-1, 0, W[2]], [-2, 0, W[2]], [-3, 0, W[3]], [-4, 0, W[2]],
        [-3, 1, M[2]], [-4, 1, M[3]], [-5, 1, M[3]], [-3, 2, M[3]], [-4, 2, M[4]], [-5, 2, M[3]], [-4, -1, M[2]]];
      case 'spear': return [[2, 0, W[1]], [1, 0, W[2]], [0, 0, W[2]], [-1, 0, W[2]], [-2, 0, W[2]], [-3, 0, W[3]], [-4, 0, W[2]],
        [-5, 0, A[3]], [-6, 0, M[3]], [-7, 0, M[4]], [-6, -1, M[2]], [-6, 1, M[2]]];
      case 'staff': return [[2, 0, W[1]], [1, 0, W[2]], [0, 0, W[2]], [-1, 0, W[2]], [-2, 0, W[3]], [-3, 0, W[2]], [-4, 0, W[2]],
        [-5, -1, W[1]], [-5, 1, W[1]], [-6, 0, E[3]], [-5, 0, E[2]], [-7, 0, E[4]], [-6, -1, E[2]], [-6, 1, E[2]]];
      case 'wand': return [[0, 0, W[1]], [-1, 0, W[2]], [-2, 0, W[2]], [-3, 0, E[3]], [-4, 0, E[4]]];
      case 'bow': {
        const out = [];
        for (let u = -4; u <= 4; u++) out.push([u, -Math.floor(u * u / 6), Math.abs(u) === 4 ? W[1] : W[2 + (u < 0 ? 1 : 0)]]);
        for (let u = -3; u <= 3; u++) out.push([u, -2, '#e8e0c8']);
        return out;
      }
      case 'crossbow': return [[1, 0, W[1]], [0, 0, W[2]], [-1, 0, W[2]], [-2, 0, W[3]], [-3, 0, W[2]],
        [-3, -2, M[2]], [-3, -1, M[3]], [-3, 1, M[3]], [-3, 2, M[2]], [-4, 0, M[4]]];
      default: return [];
    }
  }
  // Transform weapon local coords into the frame at hand position (hx, hy) pointing `dir`.
  function placeWeapon(f, shape, hx, hy, dir) {
    for (const [u, v, c] of shape) {
      let x, y;
      if (dir === 'up') { x = hx + v; y = hy + u; }
      else if (dir === 'down') { x = hx - v; y = hy - u; }
      else if (dir === 'left') { x = hx + u; y = hy + v; }
      else { x = hx - u; y = hy + v; }
      f.set(x, y, c);
    }
  }

  // Draw one 16x16 frame. dir: 0 down, 1 up, 2 left (right is the mirror of left).
  // pose: 'walk' (step 0-3), 'attack', 'hurt', 'cast'.
  function heroFrame(g, dir, pose, step) {
    const f = new Grid(16, 16);
    const back = new Grid(16, 16);                 // things behind the body (cape, weapon on the back)
    const walking = pose === 'walk';
    const bob = walking && (step === 1 || step === 3) ? 1 : 0;
    const oy = bob + (pose === 'hurt' ? 1 : 0);
    const S = g.skin, H = g.hair, M = g.main, A = g.accent, P = g.pants;
    const profile = dir === 2;

    // ---- legs and feet (rows 13-15)
    if (!g.robe) {
      const lift = walking ? step : 0;
      if (profile) {
        const a = lift === 1 ? -1 : lift === 3 ? 1 : 0;
        f.rect(7 + a, 13, 2, 2, P[1]); f.rect(7 - a, 13, 2, 2, P[0]);
        f.rect(6 + a, 15, 3, 1, LEATHER[1]); if (a) f.rect(6 - a, 15, 3, 1, LEATHER[0]);
      } else {
        const lL = lift === 1 ? 1 : 0, lR = lift === 3 ? 1 : 0;
        f.rect(5, 13, 2, 2 - lL, P[1]); f.rect(9, 13, 2, 2 - lR, P[1]);
        f.rect(5, 15 - lL, 2, 1, LEATHER[1]); f.rect(9, 15 - lR, 2, 1, LEATHER[1]);
      }
    }
    // ---- cape behind
    if (g.cape) {
      if (dir === 1) back.rect(4, 9 + oy, 8, 6, M[1]).rect(5, 9 + oy, 6, 5, M[2]);
      else if (profile) back.rect(9, 9 + oy, 3, 5, M[1]);
    }
    // ---- body (rows 9-12), robe reaches the ground
    const bodyBottom = g.robe ? 15 : 12;
    for (let y = 9; y <= bodyBottom; y++) {
      const widen = g.robe ? Math.max(0, Math.floor((y - 10) / 2)) : 0;
      const x0 = (profile ? 6 : 5) - widen, x1 = (profile ? 9 : 10) + widen;
      for (let x = x0; x <= x1; x++) {
        let c = M[2];
        if (x === x0) c = M[1]; else if (x === x1) c = M[1];
        else if (y === 9 && x === x0 + 1) c = M[3];
        if (y === bodyBottom && g.robe) c = M[0];
        f.set(x, y + (y <= 12 ? oy : 0), c);
      }
    }
    if (!g.robe) f.hline(profile ? 6 : 5, profile ? 9 : 10, 12 + oy, LEATHER[1]);       // belt
    if (dir === 0) { f.set(7, 9 + oy, A[3]); f.set(8, 9 + oy, A[3]); f.set(7, 10 + oy, A[2]); }  // collar / trim
    if (dir === 0 && g.robe) f.vline(7, 11 + oy, 14, A[2]).vline(8, 11 + oy, 14, A[2]);

    // ---- arms and hands
    let hand;                                       // where the weapon is held
    const castUp = pose === 'cast';
    if (dir === 0) {
      f.vline(4, 9 + oy, 10 + oy, M[1]); f.vline(11, 9 + oy, 10 + oy, M[1]);
      if (castUp) { f.set(3, 8 + oy, S[1]); f.set(12, 8 + oy, S[1]); f.vline(4, 8 + oy, 9 + oy, M[1]); f.vline(11, 8 + oy, 9 + oy, M[1]); }
      else { f.set(4, 11 + oy, S[1]); f.set(11, 11 + oy, S[1]); }
      hand = [11, 11 + oy];
    } else if (dir === 1) {
      f.vline(4, 9 + oy, 10 + oy, M[1]); f.vline(11, 9 + oy, 10 + oy, M[1]);
      f.set(4, 11 + oy, S[0]); f.set(11, 11 + oy, S[0]);
      hand = [4, 11 + oy];
    } else {
      const swing = walking ? (step === 1 ? -1 : step === 3 ? 1 : 0) : 0;
      const ax = pose === 'attack' ? 6 : 7 + swing;
      f.vline(ax, 9 + oy, 10 + oy, M[1]); f.set(ax, 11 + oy, S[1]);
      hand = [ax, 11 + oy];
    }

    // ---- head (rows 1-8): 8 wide with clipped corners
    const hy = oy;
    for (let y = 1; y <= 8; y++) for (let x = 4; x <= 11; x++) {
      if ((y === 1 || y === 8) && (x === 4 || x === 11)) continue;
      f.set(x, y + hy, (x >= 10 || y === 8) ? S[0] : S[1]);
    }
    f.set(5, 2 + hy, S[2]);
    // face
    if (dir === 0) {
      const blink = pose === 'hurt';
      for (const ex of [6, 9]) {
        if (blink) f.set(ex, 6 + hy, OUTLINE);
        else { f.set(ex, 5 + hy, OUTLINE); f.set(ex, 6 + hy, g.eye); }
      }
      if (g.blush) { f.set(5, 7 + hy, '#f09090'); f.set(10, 7 + hy, '#f09090'); }
    } else if (profile) {
      if (pose === 'hurt') f.set(5, 6 + hy, OUTLINE); else { f.set(5, 5 + hy, OUTLINE); f.set(5, 6 + hy, g.eye); }
      f.set(4, 7 + hy, S[1]); f.set(3, 6 + hy, S[1]);                                     // nose
    }
    // hair
    const hairOn = (x, y) => {
      const st = g.hairStyle;
      if (st === 'bald') return y <= 1;
      if (dir === 1) return y <= (st === 'long' || st === 'bob' ? 8 : 6);                  // back of the head
      if (profile) {
        if (y <= 3) return true;
        if (x >= 9) return y <= (st === 'long' ? 9 : st === 'bob' ? 7 : 6);
        return st === 'spiky' && y === 4 && x % 2 === 0;
      }
      if (y <= 3) return true;
      if (y === 4) return st === 'spiky' ? x % 2 === 1 : (x <= 5 || x >= 10 || (st === 'bob' && x !== 7));
      if (x <= 4 || x >= 11) return st === 'long' ? y <= 9 : st === 'bob' ? y <= 7 : y <= 5;
      return false;
    };
    for (let y = 0; y <= 9; y++) for (let x = 3; x <= 12; x++) {
      if (!f.filled(x, y + hy) && !(y === 9 && g.hairStyle === 'long' && (x === 4 || x === 11 || (dir === 1 && x > 4 && x < 11)))) continue;
      if (y === 9 && !(g.hairStyle === 'long')) continue;
      if (hairOn(x, y)) f.set(x, y + hy, (y <= 1 || x <= 4) ? H[2] : (x >= 10 ? H[0] : H[1]));
    }
    if (g.hairStyle === 'spiky') { f.set(6, 0 + hy, H[1]); f.set(9, 0 + hy, H[1]); }
    if (g.hairStyle === 'tail') {
      if (dir === 1) f.vline(7, 7 + hy, 10 + hy, H[0]).vline(8, 7 + hy, 10 + hy, H[1]);
      else if (profile) f.set(12, 4 + hy, H[1]).set(12, 5 + hy, H[0]).set(13, 5 + hy, H[0]).set(13, 6 + hy, H[0]);
    }
    // headgear
    const T = g.metal;
    switch (g.hat) {
      case 'helmet':
        for (let y = 0; y <= 4; y++) for (let x = 4; x <= 11; x++) {
          if (y === 0 && (x === 4 || x === 11)) continue;
          f.set(x, y + hy, y === 0 ? T[3] : x >= 10 ? T[1] : x <= 5 ? T[3] : T[2]);
        }
        if (dir === 0) f.vline(7, 4 + hy, 5 + hy, T[1]).vline(8, 4 + hy, 5 + hy, T[1]);
        if (dir !== 1) f.set(profile ? 5 : 6, 0 + hy, A[3]);
        break;
      case 'horned':
        for (let y = 1; y <= 4; y++) for (let x = 4; x <= 11; x++) f.set(x, y + hy, x >= 10 ? T[1] : T[2]);
        f.set(3, 1 + hy, '#f0e8d0').set(3, 0 + hy, '#f0e8d0').set(12, 1 + hy, '#f0e8d0').set(12, 0 + hy, '#f0e8d0');
        break;
      case 'hood':
        for (let y = 0; y <= 9; y++) for (let x = 3; x <= 12; x++) {
          const face = dir === 0 ? (x >= 5 && x <= 10 && y >= 4) : profile ? (x <= 7 && y >= 4) : false;
          const edge = (y === 0 && (x <= 4 || x >= 11)) || (y >= 8 && dir !== 1 && !profile && x > 4 && x < 11);
          if (face || edge) continue;
          if (y >= 1 || (x > 3 && x < 12)) if (y <= 8 || x === 3 || x === 12) f.set(x, y + hy, x >= 10 ? M[1] : y <= 1 ? M[3] : M[2]);
        }
        break;
      case 'wizard':
        f.hline(3, 12, 3 + hy, M[1]).hline(4, 11, 2 + hy, M[2]);
        f.hline(5, 10, 1 + hy, M[2]).hline(6, 9, 0 + hy, M[3]);
        f.hline(4, 11, 3 + hy, A[2]);
        break;
      case 'cap':
        f.hline(4, 11, 1 + hy, M[3]).hline(4, 11, 2 + hy, M[2]).hline(4, 11, 3 + hy, M[1]);
        if (dir === 0) f.hline(5, 10, 4 + hy, M[0]); else if (profile) f.hline(2, 5, 3 + hy, M[1]);
        break;
      case 'bandana':
        f.hline(4, 11, 3 + hy, A[2]); f.set(4, 3 + hy, A[1]);
        if (dir === 1 || profile) f.set(12, 4 + hy, A[1]).set(12, 5 + hy, A[2]);
        break;
      case 'circlet':
        f.hline(4, 11, 3 + hy, GOLD[3]); if (dir === 0) f.set(7, 3 + hy, g.element[3]).set(8, 3 + hy, g.element[3]);
        break;
    }

    // ---- weapon
    const shape = weaponShape(g, g.weapon);
    const W = new Grid(16, 16);
    if (pose === 'attack') {
      const facing = dir === 0 ? 'down' : dir === 1 ? 'up' : 'left';
      const [hx, hy2] = dir === 0 ? [11, 12] : dir === 1 ? [11, 8] : [5, 10 + oy];
      placeWeapon(W, shape, hx, hy2, facing);
      if (g.weapon === 'staff' || g.weapon === 'wand') {                                 // a spark at the tip
        const tip = dir === 0 ? [11, 15] : dir === 1 ? [11, 1] : [0, 10];
        W.set(tip[0], tip[1], g.element[4]);
      }
    } else if (castUp) {
      placeWeapon(W, shape, dir === 1 ? 4 : 12, 8 + oy, 'up');
    } else if (shape.length) {
      placeWeapon(W, shape, hand[0] + (dir === 0 ? 1 : dir === 1 ? -1 : -1), hand[1], 'up');
    }
    // back-facing heroes carry the weapon in front of them (hidden), so draw it behind
    const out = new Grid(16, 16);
    out.blit(back);
    if (dir === 1 && pose !== 'attack') { out.blit(W); out.blit(f); }
    else { out.blit(f); out.blit(W); }
    out.outline();
    if (pose === 'hurt') {                                            // a white-red flash
      const ol = pack(OUTLINE);
      out.each((x, y, v) => {
        if (!(v & 255) || v === ol) return;
        return mix(rgbHex(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255), '#ffe0e0', 0.55);
      });
    }
    return out;
  }

  function genHero(o) {
    const g = heroGenome(o);
    const sheet = new Grid(64, 112);
    const poses = [['walk', 0], ['walk', 1], ['walk', 2], ['walk', 3], ['attack', 0], ['hurt', 0], ['cast', 0]];
    poses.forEach(([pose, step], row) => {
      for (let col = 0; col < 4; col++) {
        // game sheet columns: 0 down, 1 up, 2 left, 3 right
        const fr = col === 3 ? heroFrame(g, 2, pose, step).flipX() : heroFrame(g, col, pose, step);
        sheet.blit(fr, col * 16, row * 16);
      }
    });
    const tracks = [0, 1, 2, 3].map(col => [0, 1, 2, 3].map(r => ({ x: col * 16, y: r * 16 })));
    tracks.push([0, 1, 2, 3].map(col => ({ x: col * 16, y: 64 })));
    return { img: sheet, anim: { fw: 16, fh: 16, fps: 6, tracks }, name: `hero-${g.cls}-${g.weapon}`, info: g };
  }

  // ================================================================ PORTRAIT
  function genPortrait(o) {
    const r = R.make(o.seed, 'portrait');
    const pal = factionPal(o.faction);
    const W = 38, Hh = 38;
    const cls = CLASS_GEAR[o.cls] ? o.cls : r.pick(Object.keys(CLASS_GEAR));
    const skin = ramp(pickSkin(r), 4, 0.4), hair = ramp(r.pick(HAIR), 4, 0.5), eye = r.pick(EYES);
    const hairStyle = r.pick(['short', 'long', 'spiky', 'bald', 'mohawk', 'swept', 'long']);
    const hat = o.hat || r.pick(cls === 'warrior' ? ['helmet', 'none', 'none', 'circlet'] : cls === 'mage' ? ['wizard', 'hood', 'none'] : cls === 'healer' ? ['hood', 'circlet', 'none'] : ['hood', 'none', 'none']);
    const beard = r.chance(0.3) ? r.pick(['full', 'goatee', 'stubble']) : null;
    const jaw = r.pick(['round', 'square', 'narrow']);
    const rx = jaw === 'narrow' ? 7 : 8, ry = 10, cx = 18.5, cy = 16;
    const scar = r.chance(0.15);
    const M = pal.main, A = pal.accent;

    const bg = new Grid(W, Hh);
    const bgr = ramp(mix(M[1], '#141828', 0.55), 4, 0.4);
    bg.each((x, y) => rampAt(bgr, 0.15 + (1 - y / Hh) * 0.55 - Math.hypot(x - 19, y - 14) / 70, x, y));

    const ch = new Grid(W, Hh);
    // shoulders
    for (let y = 29; y < Hh; y++) {
      const half = 9 + (y - 29) * 1.2;
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        const k = (x - cx) / half;
        ch.set(x, y, k < -0.6 ? M[3] : k > 0.5 ? M[1] : M[2]);
      }
    }
    if (cls === 'warrior') {                                       // pauldrons
      ch.ellipse(7, 32, 5, 3, METAL[3]); ch.ellipse(30, 32, 5, 3, METAL[1]);
      ch.hline(3, 11, 34, METAL[2]); ch.hline(26, 34, 34, METAL[0]);
    }
    for (let x = 13; x <= 24; x++) ch.set(x, 29, A[2]).set(x, 30, A[1]);    // collar
    // neck
    ch.rect(15, 24, 8, 6, skin[1]); ch.rect(20, 24, 3, 6, skin[0]);
    // ears
    ch.rect(Math.round(cx - rx) - 1, 15, 2, 4, skin[1]); ch.rect(Math.round(cx + rx), 15, 2, 4, skin[0]);
    // head
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = 0; x < W; x++) {
      const dy = (y - cy) / (ry + 0.5);
      let half = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      if (y > cy && jaw === 'square') half = Math.max(half, rx - 1 - (y > cy + ry - 2 ? 2 : 0));
      if (Math.abs(x - cx) > half + 0.2) continue;
      const lx = (x - cx) / rx, ly = (y - cy) / ry;
      const light = 0.6 - lx * 0.35 - ly * 0.12;
      ch.set(x, y, band(skin, light));
    }
    // cheeks, nose, mouth
    ch.set(13, 21, skin[2]); ch.set(24, 21, skin[1]);
    ch.set(19, 19, skin[1]).set(19, 20, skin[1]).set(20, 21, skin[0]).set(18, 21, skin[0]);
    const mouthW = r.int(1, 3);
    ch.hline(19 - mouthW, 18 + mouthW, 23, mix(skin[0], '#802030', 0.45));
    if (r.chance(0.4)) ch.set(18 + mouthW, 22, mix(skin[0], '#802030', 0.3));
    // eyes
    for (const ex of [14, 22]) {
      ch.set(ex, 17, '#f4f0ea').set(ex + 1, 17, eye).set(ex + 2, 17, '#f4f0ea');
      ch.set(ex + 1, 18, mix(eye, '#000000', 0.4));
      ch.hline(ex, ex + 2, 16, OUTLINE);
      ch.set(ex + (ex < 19 ? 2 : 0), 17, ex < 19 ? '#f4f0ea' : '#e0d8d0');
    }
    const browY = r.pick([14, 14, 13]);
    ch.hline(13, 16, browY, hair[0]); ch.hline(21, 24, browY, hair[0]);
    if (r.chance(0.3)) { ch.set(16, browY + 1, hair[0]); ch.set(21, browY + 1, hair[0]); }       // stern
    if (scar) ch.line(23, 13, 25, 20, mix(skin[1], '#a03040', 0.5));
    // beard
    if (beard) {
      const bc = hair;
      for (let y = 20; y <= 27; y++) for (let x = 9; x <= 28; x++) {
        if (!ch.filled(x, y) || (y < 24 && Math.abs(x - cx) < 3 && beard !== 'stubble')) continue;
        const onFace = Math.hypot((x - cx) / rx, (y - cy) / ry) <= 1.02;
        if (!onFace) continue;
        if (beard === 'full' && y >= 21) ch.set(x, y, band(bc, 0.55 - (x - cx) / 18));
        if (beard === 'goatee' && Math.abs(x - cx) <= 2 && y >= 22) ch.set(x, y, bc[1]);
        if (beard === 'stubble' && y >= 21 && (x + y) % 2 === 0) ch.set(x, y, mix(bc[1], skin[1], 0.5));
      }
      if (beard !== 'stubble') ch.hline(17, 20, 23, mix(skin[0], '#802030', 0.4));          // mouth stays visible
      if (beard === 'full') for (let x = 14; x <= 23; x++) ch.set(x, 21, hair[1]);             // moustache line
    }
    // hair
    if (hairStyle !== 'bald' && hat !== 'helmet' && hat !== 'hood') {
      const top = cy - ry - (hairStyle === 'spiky' ? 3 : hairStyle === 'mohawk' ? 4 : 1);
      for (let y = Math.floor(top); y <= 30; y++) for (let x = 6; x <= 31; x++) {
        const dx = (x - cx) / (rx + 1.5), dy = (y - cy) / (ry + 1.5);
        const inside = dx * dx + dy * dy <= 1;
        let on = false;
        const hairline = 12 + (hairStyle === 'swept' ? (x - cx) / 4 : 0) + ((x * 7) % 3 === 0 ? 1 : 0);
        const ex = (x - cx) / (rx + 1.5), headTop = Math.abs(ex) < 1 ? cy - (ry + 1.5) * Math.sqrt(1 - ex * ex) : 99;
        if (hairStyle === 'mohawk') on = Math.abs(x - cx) <= 2 && y < 11 && y >= top;
        else {
          on = inside && y < hairline;
          if (hairStyle === 'spiky' && y < headTop && y < hairline) {
            const spike = 3.2 - Math.abs((((x - cx) % 5) + 5) % 5 - 2.5) * 1.3;
            on = y >= headTop - spike;
          }
          if ((hairStyle === 'long') && Math.abs(x - cx) >= rx - 1 && Math.abs(x - cx) <= rx + 2 && y >= 12 && y <= 30) on = true;
        }
        if (on) {
          const light = 0.62 - (x - cx) / 22 - (y - top) / 45 + ((x * 3 + y) % 7 === 0 ? 0.25 : 0);
          ch.set(x, y, band(hair, light));
        }
      }
    }
    // headgear
    if (hat === 'helmet') {
      for (let y = 3; y <= 15; y++) for (let x = 8; x <= 29; x++) {
        const dx = (x - cx) / (rx + 2), dy = (y - 15) / 12;
        if (dx * dx + dy * dy > 1) continue;
        ch.set(x, y, rampAt(METAL, 0.75 - (x - cx) / 14 - (y - 3) / 40, x, y));
      }
      ch.hline(9, 28, 15, METAL[1]);
      ch.vline(18, 15, 20, METAL[2]).vline(19, 15, 20, METAL[1]);                 // nose guard
      if (r.chance(0.5)) for (let y = 0; y <= 4; y++) ch.hline(18 - (4 - y > 2 ? 0 : 1), 19, y, A[2 + (y < 2 ? 1 : 0)]);   // plume
    } else if (hat === 'hood') {
      for (let y = 2; y <= 31; y++) for (let x = 4; x <= 33; x++) {
        const dx = (x - cx) / (rx + 4), dy = (y - 16) / (ry + 5);
        if (dx * dx + dy * dy > 1) continue;
        const ix = (x - cx) / (rx - 0.5), iy = (y - 18) / (ry - 1);
        if (ix * ix + iy * iy < 1 && y > 9) continue;                                  // face opening
        ch.set(x, y, rampAt(M, 0.7 - (x - cx) / 16 - (y - 2) / 60, x, y));
      }
      for (let y = 9; y <= 13; y++) for (let x = 11; x <= 26; x++) if (!ch.filled(x, y)) continue; else if (Math.abs((x - cx) / (rx - 0.5)) ** 2 + ((y - 18) / (ry - 1)) ** 2 < 1.1 && y < 14) ch.set(x, y, M[0]);
    } else if (hat === 'wizard') {
      const tilt = r.pick([-1, 1]);
      for (let y = 0; y <= 9; y++) {
        const half = 1 + y * 1.1, sx = cx + tilt * (9 - y) * 0.5;
        for (let x = Math.round(sx - half); x <= Math.round(sx + half); x++) ch.set(x, y, rampAt(M, 0.7 - (x - sx) / 12, x, y));
      }
      ch.hline(4, 33, 9, M[1]).hline(3, 34, 10, M[0]);
      ch.hline(Math.round(cx - 6), Math.round(cx + 6), 8, A[2]);
    } else if (hat === 'circlet') {
      ch.hline(11, 26, 11, GOLD[3]).hline(11, 26, 12, GOLD[1]);
      ch.set(18, 11, pal.element[4]).set(19, 11, pal.element[3]).set(18, 12, pal.element[2]).set(19, 12, pal.element[2]);
    }
    ch.outline(OUTLINE);
    bg.blit(ch);
    return { img: bg, name: `portrait-${cls}-${hat}`, info: { cls, hat, hairStyle, beard } };
  }

  // ================================================================ MONSTER SHEET
  // A creature is a mirrored body blob plus parts (horns, ears, legs, wings, tentacles,
  // spikes, tail). Frames bob and move the legs / wings; side views shift the face.
  function monsterGenome(o) {
    const r = R.make(o.seed, 'monster');
    const body = o.body || r.pick(['blob', 'beast', 'flyer', 'eye', 'bug', 'spirit']);
    const baseHue = FACTIONS[o.faction] ? FACTIONS[o.faction].main : rgbHex(...hslToRgb(r(), r.range(0.45, 0.8), r.range(0.42, 0.58)));
    const col = ramp(baseHue, 5, 0.7), belly = ramp(mix(baseHue, '#f4e0b0', r.range(0.45, 0.7)), 3, 0.3);
    const noise = []; for (let i = 0; i < 256; i++) noise.push(r());
    const g = {
      body, col, belly, noise,
      rx: r.range(4, 6.2), ry: r.range(3.4, 5.2), cy: r.range(8.5, 9.8),
      eyes: body === 'eye' ? 1 : r.pick([1, 2, 2, 2, 3]),
      eyeBig: body === 'eye' || r.chance(0.3),
      mouth: r.pick(['none', 'line', 'teeth', 'fang']),
      horns: r.chance(0.4) ? r.pick(['up', 'side', 'curl']) : null,
      ears: r.chance(0.3),
      legs: body === 'beast' || body === 'bug' ? (body === 'bug' ? 3 : 2) : body === 'blob' ? 0 : r.chance(0.3) ? 2 : 0,
      wings: body === 'flyer' || (body === 'bug' && r.chance(0.5)),
      tentacles: body === 'spirit' || (body === 'eye' && r.chance(0.6)),
      spikes: r.chance(0.3),
      pattern: r.pick(['none', 'spots', 'stripes', 'none']),
      eyeCol: r.pick(['#ffffff', '#fff4a0', '#ff6040', '#80ffd0', '#ffffff']),
      pupil: r.pick([OUTLINE, OUTLINE, '#c02020', '#2040a0']),
      roughness: r.range(0.1, 0.35),
    };
    if (body === 'eye') { g.rx = r.range(5, 6.5); g.ry = g.rx - 0.5; g.belly = ramp('#f4ece0', 3, 0.3); }
    if (body === 'spirit') g.ry += 1;
    return g;
  }
  function monsterFrame(g, dir, frame) {
    const mask = new Grid(16, 16), C = g.col;
    const bob = [0, 1, 0, -1][frame], flap = frame % 2;
    const cy = g.cy + bob + (g.wings ? -1 : 0), rx = g.rx * (frame === 1 ? 1.08 : 1), ry = g.ry * (frame === 1 ? 0.92 : 1);
    const set = (x, y, c) => { mask.set(x, y, c); mask.set(15 - x, y, c); };
    // body with a rough edge
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
      const dx = (x + 0.5 - 8) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
      const n = g.noise[(y * 8 + x) & 255];
      if (d < 1 - g.roughness * n || (d < 1.15 && n < 0.25)) {
        const light = 0.75 - (y - (cy - ry)) / (ry * 2.6) - (x < 4 ? 0 : 0.05) + (n - 0.5) * 0.15;
        set(x, y, rampAt(C, light, x, y));
      }
    }
    if (g.tentacles) for (let i = 0; i < 3; i++) {
      const x = 8 - 1 - i * 2, wave = ((frame + i) % 2);
      for (let y = Math.floor(cy + ry - 1); y <= 15; y++) set(x - (y % 3 === 0 ? wave : 0), y, C[1 + (y % 2)]);
    }
    if (g.legs) {
      const n = g.legs, by = Math.min(15, Math.floor(cy + ry));
      for (let i = 0; i < n; i++) {
        const lx = 7 - Math.round(rx * (0.35 + i * 0.55 / Math.max(1, n - 1)) * (n === 1 ? 0 : 1));
        const lift = (frame + i) % 2 === 1 ? 1 : 0;
        for (let y = by; y <= Math.min(15, by + 2) - lift; y++) {
          mask.set(lx, y, C[1]); mask.set(15 - lx, y - (lift ? 0 : 0) + ((frame + i + 1) % 2 === 1 && y === by + 2 ? -0 : 0), C[1]);
        }
        if (g.body === 'beast') { mask.set(lx - 1, Math.min(15, by + 2) - lift, C[0]); mask.set(16 - lx, Math.min(15, by + 2) - ((frame + i + 1) % 2), C[0]); }
      }
    }
    if (g.wings) {
      const wy = Math.round(cy - 2 + (flap ? -2 : 1));
      for (let i = 0; i < 4; i++) for (let j = 0; j <= i; j++) {
        const x = Math.round(8 - rx - 1 - i), y = wy + j - (flap ? 0 : i > 1 ? -1 : 0);
        set(x, y, j === 0 ? C[3] : C[2]);
      }
    }
    if (g.horns) {
      const hx = Math.round(8 - rx * 0.55), top = Math.round(cy - ry);
      const hc = '#f0e4c8', hs = '#b8a888';
      if (g.horns === 'up') { set(hx, top - 1, hc); set(hx, top - 2, hc); set(hx + 1, top - 1, hs); }
      if (g.horns === 'side') { set(hx - 1, top, hc); set(hx - 2, top - 1, hc); set(hx - 2, top - 2, hc); }
      if (g.horns === 'curl') { set(hx, top - 1, hc); set(hx - 1, top - 2, hc); set(hx - 2, top - 2, hs); set(hx - 2, top - 1, hs); }
    }
    if (g.ears) { const ex = Math.round(8 - rx * 0.75), top = Math.round(cy - ry); set(ex, top - 1, C[2]); set(ex, top - 2, C[3]); set(ex + 1, top - 1, C[1]); }
    if (g.spikes) { const top = Math.round(cy - ry); for (let x = 5; x < 8; x += 2) set(x, top - 1, C[4]); }
    // pattern
    if (g.pattern !== 'none') mask.each((x, y, v) => {
      if (!(v & 255)) return;
      const n = g.noise[(y * 16 + x) & 255];
      if (g.pattern === 'spots' && n > 0.86 && y < cy + 1) return C[0];
      if (g.pattern === 'stripes' && Math.round(y - cy) % 3 === 0 && y < cy + ry - 1) return C[1];
    });

    // face: front (dir 0) and side (dir 2) only
    if (dir === 0 || dir === 2) {
      const side = dir === 2, sx = side ? -2 : 0;
      // belly patch
      for (let y = Math.round(cy); y <= Math.round(cy + ry - 1); y++) for (let x = 6; x <= 9; x++) {
        const X = x + sx + (side ? -1 : 0);
        if (mask.filled(X, y) && g.body !== 'eye' && (Math.abs(x - 7.5) < 2 - (y - cy) / 4)) mask.set(X, y, g.belly[1 + ((x + y) % 2 === 0 && x < 8 ? 1 : 0)]);
      }
      const ey = Math.round(cy - ry * 0.3);
      const eyeXs = g.eyes === 1 ? [7.5] : g.eyes === 2 ? [5.5, 9.5] : [4.5, 7.5, 10.5];
      const shown = side ? eyeXs.filter((_, i) => i === 0) : eyeXs;
      for (const ex0 of shown) {
        const ex = Math.round(ex0 + sx - (side && g.eyes > 1 ? 1 : 0));
        if (g.eyeBig) {
          const rr = g.body === 'eye' ? 2.6 : 1.6;
          for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= rr * rr) mask.set(ex + x, ey + y, g.eyeCol);
          mask.set(ex + (side ? -1 : 0), ey, g.pupil); mask.set(ex + (side ? -1 : 0), ey + 1, g.pupil);
          if (g.body === 'eye') { mask.set(ex - 1 + (side ? -1 : 0), ey, g.pupil); mask.set(ex - 1 + (side ? -1 : 0), ey + 1, g.pupil); mask.set(ex + 1, ey - 1, '#ffffff'); }
        } else {
          mask.set(ex, ey, g.eyeCol); mask.set(ex, ey + 1, g.pupil);
        }
      }
      const my = Math.round(cy + ry * 0.35);
      if (g.body !== 'eye') {
        if (g.mouth === 'line') mask.hline(6 + sx, 9 + sx, my, C[0]);
        if (g.mouth === 'teeth') { mask.hline(6 + sx, 9 + sx, my, OUTLINE); mask.set(6 + sx, my + 1, '#ffffff'); mask.set(9 + sx, my + 1, '#ffffff'); }
        if (g.mouth === 'fang') { mask.hline(6 + sx, 9 + sx, my, OUTLINE); mask.set(7 + sx, my + 1, '#ffffff'); }
      }
    }
    mask.outline(OUTLINE);
    return mask;
  }
  function genMonster(o) {
    const g = monsterGenome(o);
    const sheet = new Grid(64, 64);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      const fr = col === 3 ? monsterFrame(g, 2, row).flipX() : monsterFrame(g, col, row);
      sheet.blit(fr, col * 16, row * 16);
    }
    const tracks = [0, 1, 2, 3].map(col => [0, 1, 2, 3].map(r => ({ x: col * 16, y: r * 16 })));
    return { img: sheet, anim: { fw: 16, fh: 16, fps: 6, tracks }, name: `monster-${g.body}` };
  }

  // ================================================================ FX STRIPS
  function genFx(o) {
    const r = R.make(o.seed, 'fx');
    const kind = o.fx || r.pick(['burst', 'slash', 'sparkle', 'smoke', 'orb', 'ring']);
    const el = ELEMENTS[o.element] ? o.element : (o.faction && FACTION_ELEMENT[o.faction]) || r.pick(Object.keys(ELEMENTS));
    const E = ELEMENTS[el];
    const S = 32;
    const frames = kind === 'orb' ? 4 : kind === 'smoke' || kind === 'sparkle' ? 6 : 5;
    const img = new Grid(S * frames, S);
    const parts = [];
    for (let i = 0; i < 14; i++) parts.push({ a: r() * Math.PI * 2, s: r.range(0.5, 1), sz: r.range(1, 2.6), x: r.range(4, 28), y: r.range(4, 28), ph: r() });
    const arcDir = r.pick([1, -1]);
    for (let f = 0; f < frames; f++) {
      const t = f / (frames - 1), ox = f * S, g = new Grid(S, S), c = 15.5;
      if (kind === 'burst') {
        if (f <= 1) g.ellipse(c, c, 5 - f * 2, 5 - f * 2, E[4 - f]);
        for (const p of parts) {
          const d = 3 + p.s * 13 * Math.sqrt(t), sz = p.sz * (1 - t * 0.8);
          const x = c + Math.cos(p.a) * d, y = c + Math.sin(p.a) * d;
          const col = E[Math.max(1, 4 - Math.floor(t * 3 + p.s))];
          if (sz > 0.4) g.ellipse(x, y, sz * 0.7, sz * 0.7, col);
          if (t < 0.6) g.line(x, y, c + Math.cos(p.a) * (d - 3), c + Math.sin(p.a) * (d - 3), E[2]);
        }
      } else if (kind === 'slash') {
        const a0 = -2.4, sweep = 3.2, head = a0 + sweep * Math.min(1, t * 1.4);
        for (let a = a0; a <= head; a += 0.04) {
          const age = (head - a) / sweep;
          if (age > 0.7 || t > 0.95) continue;
          const thick = (1 - age) * 3 * (1 - t * 0.6);
          for (let k = 0; k < thick; k += 0.7) {
            const rad = 12 - k;
            const x = c + Math.cos(a) * rad * arcDir, y = c + Math.sin(a) * rad;
            g.set(x, y, k < 0.8 ? E[4] : E[3 - Math.min(2, Math.floor(age * 4))]);
          }
        }
      } else if (kind === 'sparkle') {
        for (const p of parts.slice(0, 7)) {
          const life = Math.sin(((t + p.ph) % 1) * Math.PI);
          const n = Math.round(life * 3);
          if (n <= 0) continue;
          g.set(p.x, p.y, E[4]);
          for (let k = 1; k <= n; k++) { const col = E[4 - k]; g.set(p.x + k, p.y, col).set(p.x - k, p.y, col).set(p.x, p.y + k, col).set(p.x, p.y - k, col); }
          if (n >= 2) g.set(p.x + 1, p.y + 1, E[2]).set(p.x - 1, p.y - 1, E[2]).set(p.x + 1, p.y - 1, E[2]).set(p.x - 1, p.y + 1, E[2]);
        }
      } else if (kind === 'smoke') {
        const smoke = el === 'fire' ? ['#3a3438', '#5a545a', '#8a8488', '#b8b4b8', '#e0dcdc'] : E;
        for (const p of parts.slice(0, 6)) {
          const rad = 2 + p.s * 5 * (0.4 + t), x = c + Math.cos(p.a) * 6 * t * p.s, y = c + 4 - t * 10 + Math.sin(p.a) * 3;
          for (let yy = -Math.ceil(rad); yy <= rad; yy++) for (let xx = -Math.ceil(rad); xx <= rad; xx++) {
            const d = Math.hypot(xx, yy) / rad;
            if (d > 1) continue;
            const X = Math.round(x + xx), Y = Math.round(y + yy);
            if (!dither(X, Y, (1 - t * 0.85) * (1.1 - d * 0.4))) continue;
            g.set(X, Y, smoke[Math.max(1, Math.min(4, Math.round(3 - d * 2 + t * 1.5 - yy / rad)))]);
          }
        }
      } else if (kind === 'ring') {
        const rad = 3 + t * 12;
        for (let a = 0; a < Math.PI * 2; a += 0.03) {
          for (let k = 0; k < 2.5 * (1 - t) + 0.6; k += 0.7) {
            const x = c + Math.cos(a) * (rad - k), y = c + Math.sin(a) * (rad - k) * 0.6;
            if (dither(Math.round(x), Math.round(y), 1.2 - t)) g.set(x, y, E[k < 0.7 ? 4 : 3 - Math.floor(t * 2)]);
          }
        }
      } else if (kind === 'orb') {
        const wob = [0, 1, 0, -1][f];
        for (let i = 0; i < 12; i++) {                                     // trailing tail
          const tx = c - 4 - i, w = 3.5 - i * 0.3 + (i % 2 === f % 2 ? 0.5 : 0);
          for (let y = -w; y <= w; y++) if (dither(Math.round(tx), Math.round(c + y + wob * (i / 12)), 1 - i / 12)) g.set(tx, c + y + (i > 3 ? Math.sin(i + f) : 0), E[Math.max(1, 3 - Math.floor(i / 4))]);
        }
        g.ellipse(c, c, 4, 4, E[2]); g.ellipse(c + 0.5, c - 0.5, 2.6, 2.6, E[3]); g.ellipse(c + 1, c - 1, 1.2, 1.2, E[4]);
      }
      if (kind === 'orb' || kind === 'slash' || kind === 'burst') g.outline(mix(E[0], '#000000', 0.3));
      img.blit(g, ox, 0);
    }
    const tracks = [Array.from({ length: frames }, (_, f) => ({ x: f * S, y: 0 }))];
    return { img, anim: { fw: S, fh: S, fps: 10, tracks }, name: `fx-${kind}-${el}` };
  }

  // ================================================================ TILES
  // Seamless tiles: noise wraps around the edges, so tiles repeat with no seams.
  function tileNoise(r, size, cells) {
    const lat = []; for (let i = 0; i < cells * cells; i++) lat.push(r());
    const L = (x, y) => lat[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
    const sm = t => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = x / size * cells, fy = y / size * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
      const a = L(ix, iy), b = L(ix + 1, iy), c = L(ix, iy + 1), d = L(ix + 1, iy + 1);
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
  }
  function fbm(r, size) {
    const n1 = tileNoise(r, size, 4), n2 = tileNoise(r, size, 8), n3 = tileNoise(r, size, 16);
    return (x, y) => n1(x, y) * 0.55 + n2(x, y) * 0.3 + n3(x, y) * 0.15;
  }
  // Wrapped Voronoi: distance to nearest and second-nearest point, and the nearest's index.
  function voronoi(r, size, n) {
    const pts = []; for (let i = 0; i < n; i++) pts.push([r() * size, r() * size, r()]);
    return (x, y) => {
      let d1 = 1e9, d2 = 1e9, id = 0;
      for (let i = 0; i < n; i++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const d = Math.hypot(x + 0.5 - pts[i][0] - ox * size, y + 0.5 - pts[i][1] - oy * size);
        if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
      }
      return { d1, d2, edge: d2 - d1, v: pts[id][2] };
    };
  }
  const TILE_RAMPS = {
    grass: ramp('#5a9a3a', 5, 0.5), dirt: ramp('#8a6440', 5, 0.5), cobble: ramp('#8a8a90', 5, 0.6),
    sand: ramp('#e0c080', 5, 0.4), snow: ['#9ab4d0', '#c0d4e8', '#dce8f4', '#eef4fa', '#ffffff'],
    water: ramp('#2a6ab0', 5, 0.55), lava: ['#2a0e0a', '#4a1a12', '#c02a10', '#f07a18', '#ffe060'],
    brick: ramp('#a8583a', 5, 0.5), planks: WOOD, swamp: ramp('#4a5a2a', 5, 0.5), crystal: ramp('#7a6ad0', 5, 0.6),
  };
  function genTile(o) {
    const r = R.make(o.seed, 'tile');
    const kind = o.tile || r.pick(Object.keys(TILE_RAMPS));
    const S = 32, g = new Grid(S, S), P = TILE_RAMPS[kind];
    const n = fbm(r, S);
    if (kind === 'cobble' || kind === 'crystal' || kind === 'lava') {
      const v = voronoi(r, S, kind === 'lava' ? 7 : 11);
      g.each((x, y) => {
        const c = v(x, y), nn = n(x, y);
        if (kind === 'lava') return c.edge < 1.6 ? rampAt(P, 0.95 - c.edge * 0.25 + nn * 0.1, x, y) : rampAt(P, 0.05 + nn * 0.35, x, y);
        if (c.edge < 1.1) return P[0];
        const light = 0.35 + c.v * 0.35 + nn * 0.2 + (c.d1 < 2.5 ? 0.15 : 0);
        return rampAt(P, light, x, y);
      });
      if (kind === 'cobble') g.each((x, y, val) => (val !== pack(P[0]) && g.get(x - 1, y - 1) === pack(P[0])) ? P[4] : undefined);
      if (kind === 'crystal') g.each((x, y, val) => (val !== pack(P[0]) && v(x, y).edge < 2 && (x + y) % 3 === 0) ? P[4] : undefined);
    } else if (kind === 'brick' || kind === 'planks') {
      const bh = kind === 'brick' ? 8 : 6, bw = kind === 'brick' ? 16 : 32;
      g.each((x, y) => {
        const row = Math.floor(y / bh), off = (row % 2) * (bw / 2);
        const lx = (x + off + (kind === 'planks' ? row * 11 : 0)) % bw, ly = y % bh;
        if (ly === bh - 1 || (lx === 0 && kind === 'brick')) return P[0];
        if (kind === 'planks' && lx === 0 && row % 2 === 0) return P[0];
        const grain = kind === 'planks' ? Math.sin((x + row * 5) * 0.4 + n(x, y) * 6) * 0.12 : 0;
        return rampAt(P, 0.35 + n(x, y) * 0.35 + (ly === 0 ? 0.18 : 0) + grain + ((row * 7) % 3) * 0.05, x, y);
      });
    } else {
      g.each((x, y) => {
        let v = n(x, y);
        if (kind === 'sand') v += Math.sin((y + n(x, y) * 10) * 0.9) * 0.12;
        if (kind === 'water') v = v * 0.7 + Math.sin((x * 0.4 + y * 1.3 + n(x, y) * 8)) * 0.15 + 0.1;
        if (kind === 'snow') v = 0.45 + v * 0.45;
        return rampAt(P, (v - 0.2) * 1.4, x, y);
      });
      // details
      const k = kind === 'grass' ? 24 : kind === 'dirt' ? 10 : kind === 'swamp' ? 8 : kind === 'snow' ? 6 : kind === 'water' ? 7 : 4;
      for (let i = 0; i < k; i++) {
        const x = r.int(0, S - 1), y = r.int(0, S - 1), w = (a, b, c) => g.set((a + S) % S, (b + S) % S, c);
        if (kind === 'grass') { w(x, y, P[4]); w(x, y + 1, P[3]); if (r.chance(0.5)) w(x + 1, y + 1, P[3]); if (r.chance(0.08)) { w(x, y - 1, r.pick(['#f8f0a0', '#f8a0c0', '#ffffff'])); } }
        if (kind === 'dirt') { w(x, y, P[4]); w(x + 1, y, P[3]); w(x, y + 1, P[1]); w(x + 1, y + 1, P[0]); }
        if (kind === 'swamp') { w(x, y, '#2a3a1a'); w(x + 1, y, '#3a4a20'); w(x, y - 1, '#7aa040'); }
        if (kind === 'snow') w(x, y, '#ffffff');
        if (kind === 'water') { for (let j = 0; j < 4; j++) w(x + j, y, P[4]); w(x + 1, y - 1, P[4]); }
        if (kind === 'sand') { w(x, y, P[1]); }
      }
    }
    const tracks = [[{ x: 0, y: 0 }]];
    return { img: g, anim: { fw: S, fh: S, fps: 1, tracks, tile: true }, name: `tile-${kind}` };
  }

  // ================================================================ ITEM ICONS
  function genItem(o) {
    const r = R.make(o.seed, 'item');
    const kind = o.item || r.pick(['sword', 'axe', 'spear', 'bow', 'staff', 'shield', 'potion', 'gem', 'scroll', 'ring']);
    const pal = factionPal(o.faction);
    const metal = r.chance(0.25) ? GOLD : r.chance(0.2) ? ramp(r.pick(['#a0c8e8', '#c8a0e8', '#e08060']), 5) : METAL;
    const E = ELEMENTS[r.pick(Object.keys(ELEMENTS))];
    const g = new Grid(16, 16);
    // diagonal from bottom-left (grip) to top-right (tip)
    const diag = (t, side) => [2 + t + side, 13 - t + side];
    if (kind === 'sword') {
      const L = r.int(7, 10), wide = r.chance(0.4);
      for (let t = 3; t < 3 + L; t++) {
        const [x, y] = diag(t, 0); g.set(x, y, metal[3]); g.set(x + 1, y + 1, metal[1]);
        if (wide) g.set(x - 1, y, metal[4]);
      }
      const [tx, ty] = diag(3 + L, 0); g.set(tx, ty, metal[4]);
      const [gx, gy] = diag(2, 0); g.set(gx - 1, gy - 1, pal.accent[3]); g.set(gx, gy, pal.accent[2]); g.set(gx + 1, gy + 1, pal.accent[1]); g.set(gx - 2, gy - 2, pal.accent[2]); g.set(gx + 2, gy + 2, pal.accent[1]);
      g.set(...diag(1, 0), LEATHER[2]); g.set(...diag(0, 0), LEATHER[1]); g.set(...diag(-1, 0), pal.accent[3]);
      if (r.chance(0.4)) g.set(gx, gy, E[3]);
    } else if (kind === 'axe' || kind === 'spear' || kind === 'staff') {
      const L = kind === 'spear' ? 12 : 10;
      for (let t = -1; t < L; t++) g.set(...diag(t, 0), WOOD[t % 3 === 0 ? 3 : 2]);
      const [hx, hy] = diag(L, 0);
      if (kind === 'axe') {
        for (let t = L - 4; t <= L; t++) {                                  // blade on one side of the haft
          const reach = t === L - 4 || t === L ? 2 : 3;
          for (let k = 1; k <= reach; k++) { const [x, y] = diag(t, k), c = k === reach ? metal[4] : t >= L - 1 ? metal[3] : metal[2]; g.set(x, y, c); if (t < L) g.set(x + 1, y, c); }
        }
        g.set(...diag(L - 2, -1), metal[1]); g.set(...diag(L - 1, -1), metal[2]);  // back spike
      } else if (kind === 'spear') {
        g.set(hx, hy, metal[3]).set(hx + 1, hy - 1, metal[4]).set(hx + 1, hy, metal[2]).set(hx, hy - 1, metal[3]).set(hx + 2, hy - 2, metal[4]);
        g.set(hx - 1, hy + 1, pal.accent[2]);
      } else {
        g.ellipse(hx + 0.5, hy - 0.5, 1.6, 1.6, E[2]); g.set(hx + 1, hy - 1, E[4]); g.set(hx, hy, E[3]);
        g.set(hx - 2, hy, WOOD[3]); g.set(hx, hy + 2, WOOD[1]);
      }
    } else if (kind === 'bow') {
      const rad = 6.2;
      for (let a = -Math.PI / 4; a <= Math.PI * 3 / 4 + 0.01; a += 0.04) {
        const x = Math.round(7.5 + Math.cos(a) * rad), y = Math.round(8.5 - Math.sin(a) * rad);
        g.set(x, y, a > Math.PI / 4 ? WOOD[3] : WOOD[2]);
      }
      const e = rad * Math.SQRT1_2;
      g.line(Math.round(7.5 + e), Math.round(8.5 + e), Math.round(7.5 - e), Math.round(8.5 - e), '#e8e0c8');
      const [hx, hy] = [Math.round(7.5 + Math.cos(Math.PI / 4) * rad), Math.round(8.5 - Math.sin(Math.PI / 4) * rad)];
      g.set(hx, hy, LEATHER[2]); g.set(hx - 1, hy + 1, LEATHER[1]); g.set(hx + 1, hy - 1, LEATHER[3]);
      g.line(4, 12, 13, 3, metal[2]); g.set(14, 2, metal[4]); g.set(13, 2, metal[3]); g.set(14, 3, metal[3]);   // nocked arrow
      g.set(3, 12, pal.accent[3]); g.set(4, 13, pal.accent[3]); g.set(3, 13, pal.accent[2]);
    } else if (kind === 'shield') {
      const M = pal.main, rim = metal;
      for (let y = 2; y <= 14; y++) {
        const half = y < 9 ? 5.5 : 5.5 - (y - 8) * 0.9;
        for (let x = Math.round(7.5 - half); x <= Math.round(7.5 + half); x++) {
          const edge = Math.abs(x - 7.5) > half - 1 || y === 2;
          g.set(x, y, edge ? rim[x < 8 ? 3 : 1] : (x < 8 ? M[3] : M[2]));
        }
      }
      const em = r.pick(['bar', 'cross', 'dot', 'chevron']);
      if (em === 'bar' || em === 'cross') g.rect(7, 4, 2, 9, pal.accent[3]);
      if (em === 'cross') g.rect(4, 7, 8, 2, pal.accent[3]);
      if (em === 'dot') g.ellipse(7.5, 7.5, 2, 2, pal.accent[3]);
      if (em === 'chevron') for (let i = 0; i < 4; i++) { g.set(4 + i, 6 + i, pal.accent[3]); g.set(11 - i, 6 + i, pal.accent[3]); }
    } else if (kind === 'potion') {
      const L = ramp(rgbHex(...hslToRgb(r(), 0.75, 0.5)), 4, 0.6), glass = '#d8e8f0';
      const shape = r.pick(['round', 'tall', 'flask']);
      if (shape === 'round') g.ellipse(7.5, 10, 4.5, 4, glass);
      else if (shape === 'tall') g.rect(5, 6, 6, 9, glass);
      else for (let y = 7; y <= 14; y++) { const h = 1 + (y - 7) * 0.6; g.hline(Math.round(7.5 - h), Math.round(7.5 + h), y, glass); }
      g.each((x, y, v) => (v === pack(glass) && y >= 9) ? (x < 7 ? L[3] : x > 9 ? L[1] : L[2]) : undefined);
      g.rect(6, 3, 4, 3, glass).rect(6, 1, 4, 2, WOOD[2]); g.hline(6, 9, 1, WOOD[3]);
      g.set(5, shape === 'tall' ? 7 : 8, '#ffffff'); g.set(5, 10, '#ffffff');
    } else if (kind === 'gem') {
      const G = ramp(rgbHex(...hslToRgb(r(), 0.7, 0.5)), 5, 0.7);
      for (let y = 3; y <= 13; y++) {
        const half = y <= 6 ? 2 + (y - 3) * 1.3 : 6 - (y - 6) * 0.85;
        for (let x = Math.round(7.5 - half); x <= Math.round(7.5 + half); x++) {
          const top = y <= 6, leftHalf = x < 8;
          g.set(x, y, top ? (leftHalf ? G[4] : G[3]) : (leftHalf ? G[2] : G[1]));
        }
      }
      g.hline(5, 10, 6, G[4]); g.set(6, 4, '#ffffff'); g.set(5, 5, '#ffffff');
    } else if (kind === 'scroll') {
      const P = ramp('#e8d4a0', 4, 0.4);
      g.rect(4, 4, 8, 9, P[2]); g.rect(9, 4, 3, 9, P[1]);
      g.rect(3, 2, 10, 2, P[3]); g.hline(3, 12, 3, P[1]); g.rect(3, 13, 10, 2, P[3]); g.hline(3, 12, 14, P[1]);
      for (let y = 6; y <= 11; y += 2) g.hline(5, 5 + r.int(3, 5), y, '#8a6a4a');
      g.set(11, 12, pal.main[2]).set(10, 12, pal.main[3]);                           // seal
    } else if (kind === 'ring') {
      for (let a = 0; a < Math.PI * 2; a += 0.15) g.set(Math.round(7.5 + Math.cos(a) * 4), Math.round(9.5 + Math.sin(a) * 3.5), a > Math.PI ? metal[3] : metal[2]);
      g.ellipse(7.5, 5, 1.8, 1.6, E[2]); g.set(7, 4, E[4]);
    }
    g.outline(OUTLINE);
    return { img: g, anim: { fw: 16, fh: 16, fps: 1, tracks: [[{ x: 0, y: 0 }]] }, name: `item-${kind}` };
  }

  // ================================================================ PALETTE
  // Five ramps for a design: faction main and accent, skin, metal and the faction's element.
  function genPalette(o) {
    const r = R.make(o.seed, 'palette');
    const base = o.base || (o.faction && FACTIONS[o.faction] ? FACTIONS[o.faction].main : rgbHex(...hslToRgb(r(), r.range(0.45, 0.8), r.range(0.4, 0.6))));
    const harmony = o.harmony || r.pick(['complement', 'triad', 'analogous', 'split']);
    const off = { complement: [180], triad: [120, 240], analogous: [30, -30], split: [150, 210] }[harmony];
    const ramps = [ramp(base, 7), ...off.map(d => ramp(hueShift(base, d), 7)), ramp(r.pick(SKIN), 7, 0.45), ramp('#9aa4b8', 7)];
    const g = new Grid(7 * 8, ramps.length * 8);
    ramps.forEach((rp, j) => rp.forEach((c, i) => g.rect(i * 8, j * 8, 8, 8, c)));
    return { img: g, anim: { fw: g.w, fh: g.h, fps: 1, tracks: [[{ x: 0, y: 0 }]] }, name: `palette-${harmony}`, colors: ramps };
  }

  const GENERATORS = {
    hero:     { group: 'Classic 16px', fn: genHero,     label: 'Hero / unit sheet', size: '64 x 112', options: { cls: ['random', 'warrior', 'marksman', 'mage', 'healer'], weapon: ['random', 'sword', 'axe', 'spear', 'bow', 'crossbow', 'staff', 'wand'], hat: ['random', 'none', 'helmet', 'horned', 'hood', 'wizard', 'cap', 'bandana', 'circlet'] } },
    portrait: { fn: genPortrait, label: 'Portrait', size: '38 x 38', options: { cls: ['random', 'warrior', 'marksman', 'mage', 'healer'], hat: ['random', 'none', 'helmet', 'hood', 'wizard', 'circlet'] } },
    monster:  { fn: genMonster,  label: 'Monster sheet', size: '64 x 64', options: { body: ['random', 'blob', 'beast', 'flyer', 'eye', 'bug', 'spirit'] } },
    fx:       { fn: genFx,       label: 'Effect strip', size: '32 x 32 frames', options: { fx: ['random', 'burst', 'slash', 'sparkle', 'smoke', 'ring', 'orb'], element: ['faction', ...Object.keys(ELEMENTS)] } },
    tile:     { fn: genTile,     label: 'Ground tile', size: '32 x 32 seamless', options: { tile: ['random', ...Object.keys(TILE_RAMPS)] } },
    item:     { fn: genItem,     label: 'Item icon', size: '16 x 16', options: { item: ['random', 'sword', 'axe', 'spear', 'bow', 'staff', 'shield', 'potion', 'gem', 'scroll', 'ring'] } },
    palette:  { fn: genPalette,  label: 'Palette', size: '7 x 5 ramps', options: { harmony: ['random', 'complement', 'triad', 'analogous', 'split'] } },
  };

  function generate(kind, opts = {}) {
    const G = GENERATORS[kind];
    if (!G) throw new Error('unknown generator: ' + kind + ' (try ' + Object.keys(GENERATORS).join(', ') + ')');
    const o = Object.assign({ seed: 1 }, opts);
    for (const k of Object.keys(o)) if (o[k] === 'random' || o[k] === 'faction' || o[k] === '') delete o[k];
    if (!o.seed && o.seed !== 0) o.seed = 1;
    const out = G.fn(o);
    out.kind = kind; out.seed = o.seed;
    return out;
  }

  const PixelGen = { generate, GENERATORS, FACTIONS, ELEMENTS, FACTION_ELEMENT, ramp, Grid, makeRng, hashSeed,
    // shared helpers, used by add-on generator sets such as gothic.js
    R, pack, mix, hueShift, hexRgb, rgbHex, rgbToHsl, hslToRgb, band, rampAt, dither, factionPal, pickSkin,
    tileNoise, fbm, voronoi, SKIN, HAIR, EYES, METAL, GOLD, WOOD, LEATHER, OUTLINE };
  if (typeof module !== 'undefined' && module.exports) module.exports = PixelGen;
  else root.PixelGen = PixelGen;
})(typeof window !== 'undefined' ? window : globalThis);
