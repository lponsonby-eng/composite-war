// =============================================================================
//  WALLS: pixel-art stonework for battle towns, in the style of a hand-painted
//  castle tileset: blue-grey bricks lit from above with dark mortar, flagstone
//  wall-walks, crenellations, creeping moss and ivy, round towers with arrow slits
//  and arched oak gates with iron bands. Everything is drawn pixel by pixel at one
//  art pixel each (see ART in terrain.js) in the game's palette, seeded so a town
//  always looks the same.
// =============================================================================
const WallArt = {
  // palette (all from js/palette.js)
  STONE: ['#1f2524', '#2b3848', '#425a6e', '#58698c', '#6a8496', '#8496b0', '#a7a6ac'],   // blue-grey stone, dark to lit
  MORTAR: '#1f2524', MOSS: ['#263329', '#3e5040', '#55684f', '#718263'],
  WOOD: ['#2e2620', '#463a30', '#5e4e3f', '#7a6852', '#9a8a72'], IRON: ['#1f2524', '#36413e', '#5d5e60', '#8d8d92'],

  canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; },
  rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); },

  // A pixel painter over an ImageData.
  painter(w, h) {
    const img = new ImageData(w, h), d = img.data, cache = {};
    const rgb = c => cache[c] || (cache[c] = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
    return {
      img, w, h,
      set(x, y, c) { if (x < 0 || y < 0 || x >= w || y >= h) return; const [r, g, b] = rgb(c), i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; },
      get(x, y) { if (x < 0 || y < 0 || x >= w || y >= h) return 0; return d[(y * w + x) * 4 + 3]; },
      rect(x0, y0, rw, rh, c) { for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) this.set(x, y, c); },
      done() { const c = WallArt.canvas(w, h); c.getContext('2d').putImageData(img, 0, 0); return c; },
    };
  },

  // A face of coursed bricks (rows `bh` tall) filling (x0, y0, w, h): each brick lit on top,
  // shadowed below and right, mortar between; `shade` darkens (0) or lightens the face.
  bricks(P, x0, y0, w, h, r, shade = 0, bh = 4) {
    const S = this.STONE;
    for (let row = 0, y = y0; y < y0 + h; row++, y += bh) {
      let x = x0 - ((row % 2) ? 5 : 0) - Math.floor(r() * 3);
      while (x < x0 + w) {
        const bw = 7 + Math.floor(r() * 5), base = clampI(3 + shade + (r() < 0.25 ? -1 : r() < 0.15 ? 1 : 0), 1, 5);
        for (let yy = y; yy < Math.min(y + bh, y0 + h); yy++) for (let xx = Math.max(x, x0); xx < Math.min(x + bw, x0 + w); xx++) {
          const top = yy === y, bot = yy === y + bh - 1, right = xx === x + bw - 1, left = xx === x;
          let c = bot || right ? this.MORTAR : top ? S[clampI(base + 1, 0, 6)] : left ? S[clampI(base + 1, 0, 6)] : S[base];
          if (!bot && !right && yy === y + bh - 2) c = S[clampI(base - 1, 0, 6)];
          if (!top && !bot && !right && r() < 0.04) c = S[clampI(base - 1, 0, 6)];              // pits and chips
          P.set(xx, yy, c);
        }
        x += bw;
      }
    }
  },
  // Flagstones on a wall-walk or gateway: big slabs, lit edges, dark joints.
  flags(P, x0, y0, w, h, r, S = this.STONE) {
    for (let y = y0; y < y0 + h; y += 5) {
      let x = x0 - Math.floor(r() * 5);
      while (x < x0 + w) {
        const sw = 5 + Math.floor(r() * 5), base = r() < 0.5 ? 4 : r() < 0.6 ? 3 : 5;
        for (let yy = y; yy < Math.min(y + 5, y0 + h); yy++) for (let xx = Math.max(x, x0); xx < Math.min(x + sw, x0 + w); xx++) {
          const joint = yy === y + 4 || xx === x + sw - 1;
          P.set(xx, yy, joint ? S[2] : yy === y || xx === x ? S[clampI(base + 1, 0, 6)] : S[base]);
        }
        x += sw;
      }
    }
  },
  // Moss creeping up from the foot of a face, and a few strands of ivy hanging from the top.
  moss(P, x0, y0, w, h, r, amount = 1) {
    const M = this.MOSS;
    for (let x = x0; x < x0 + w; x++) {
      const up = Math.max(0, Math.floor((Math.sin(x * 0.31 + r() * 0.6) + Math.sin(x * 0.07 + 2)) * 2 * amount + r() * 2 - 1));
      for (let k = 0; k < up; k++) if (P.get(x, y0 + h - 1 - k)) P.set(x, y0 + h - 1 - k, M[k < up - 1 ? 1 + (k === 0 ? 0 : 1) : 2 + (r() < 0.3 ? 1 : 0)]);
    }
    for (let i = 0; i < Math.round(w / 26 * amount); i++) {                // ivy
      let x = x0 + Math.floor(r() * w), len = 3 + Math.floor(r() * h * 0.7);
      for (let k = 0; k < len; k++) {
        if (P.get(x, y0 + k)) P.set(x, y0 + k, M[2 + (k % 3 === 0 ? 1 : 0)]);
        if (k % 3 === 1 && P.get(x + 1, y0 + k)) P.set(x + 1, y0 + k, M[3]);
        if (r() < 0.25) x += r() < 0.5 ? -1 : 1;
      }
    }
  },
  // A row of merlons (crenellations) along a horizontal edge at y, each 4 wide and 3 tall + its face.
  merlonsH(P, x0, w, y, r) {
    const S = this.STONE;
    for (let x = x0 + 1; x + 4 <= x0 + w; x += 7) {
      P.rect(x, y, 4, 2, S[5]); P.set(x, y, S[6]); P.rect(x, y + 2, 4, 3, S[3]); P.rect(x + 3, y + 2, 1, 3, S[2]);
      P.rect(x, y + 5, 4, 1, this.MORTAR);
    }
  },
  merlonsV(P, x, y0, h, r, left) {
    const S = this.STONE;
    for (let y = y0 + 1; y + 4 <= y0 + h; y += 7) {
      P.rect(x, y, 4, 4, S[5]); P.set(left ? x : x + 3, y, S[6]); P.rect(left ? x + 4 : x - 1, y, 1, 4, S[1]); P.rect(x, y + 4, 4, 2, S[3]);
    }
  },

  // A run of wall, `aw` x `ad` art pixels seen from above (ad: the wall's thickness for a
  // horizontal run, its length for a vertical one), its front face `lift` px tall below.
  // side: which side of the town it is (merlons on the outer edge).
  run(aw, ad, lift, side, seed) {
    const r = this.rng(seed), horiz = side === 'n' || side === 's';
    const P = this.painter(aw, ad + lift);
    // the wall-walk on top: flagstones between a parapet on each side
    this.flags(P, 0, 0, aw, ad, r);
    if (horiz) {
      P.rect(0, 0, aw, 2, this.STONE[5]); P.rect(0, ad - 2, aw, 2, this.STONE[3]);                 // parapets
      this.merlonsH(P, 0, aw, side === 'n' ? 0 : ad - 6, r);
    } else {
      P.rect(0, 0, 2, ad, this.STONE[5]); P.rect(aw - 2, 0, 2, ad, this.STONE[3]);
      this.merlonsV(P, side === 'w' ? 0 : aw - 4, 0, ad, r, side === 'w');
    }
    // the front (south) face: courses of brick, darker towards the foot, moss and ivy
    this.bricks(P, 0, ad, aw, lift, r, 0);
    P.rect(0, ad, aw, 1, this.STONE[6]);                                                           // the lit lip
    for (let x = 0; x < aw; x++) P.set(x, ad + lift - 1, this.STONE[0]);
    this.moss(P, 0, ad, aw, lift, r, horiz ? 1 : 0.6);
    // arrow slits every so often on the face
    if (horiz) for (let x = 10 + Math.floor(r() * 8); x < aw - 6; x += 22 + Math.floor(r() * 10)) { P.rect(x, ad + 3, 1, lift - 6, this.MORTAR); P.set(x + 1, ad + 3, this.STONE[2]); }
    return P.done();
  },

  // A round tower `d` art pixels across, `tall` pixels of wall below its top: a crenellated
  // ring with a dark floor seen from above, and a body of curved courses, lit on the left.
  tower(d, tall, seed) {
    const r = this.rng(seed), S = this.STONE, R = d / 2, ry = Math.round(R * 0.6);
    const H = ry * 2 + tall + 2, P = this.painter(d + 2, H + 2), cx = R + 1, cy = ry + 1;
    // body: a cylinder of bricks, shaded across its width
    for (let y = cy; y < cy + tall; y++) for (let x = 1; x <= d; x++) {
      const t = (x - 1) / (d - 1), row = Math.floor((y - cy) / 4), joint = (y - cy) % 4 === 3;
      const seam = (Math.floor((x + (row % 2) * 4) / 8) !== Math.floor((x + 1 + (row % 2) * 4) / 8));
      let base = t < 0.2 ? 5 : t < 0.5 ? 4 : t < 0.8 ? 3 : 2;
      P.set(x, y, joint || seam ? this.MORTAR : (y - cy) % 4 === 0 ? S[clampI(base + 1, 0, 6)] : S[base]);
    }
    // the bottom curve of the body
    for (let x = 1; x <= d; x++) { const k = Math.round(Math.sqrt(Math.max(0, 1 - ((x - cx) / R) ** 2)) * ry); for (let y = cy + tall; y < cy + tall + k; y++) P.set(x, y, S[1]); }
    this.moss(P, 1, cy + tall - 6, d, 6, r, 1.2);
    // arrow slits
    for (const x of [Math.round(cx - R * 0.35), Math.round(cx + R * 0.2)]) { P.rect(x, cy + 5, 1, Math.max(3, tall - 10), this.MORTAR); P.set(x - 1, cy + 5, S[5]); }
    // the top: a ring of stone with merlons, a dark floor inside
    for (let y = 0; y <= ry * 2; y++) for (let x = 0; x <= d; x++) {
      const e = ((x - cx + 0.5) / (R + 0.5)) ** 2 + ((y - cy + 0.5) / (ry + 0.5)) ** 2;
      if (e > 1) continue;
      const inner = ((x - cx + 0.5) / (R - 2.5)) ** 2 + ((y - cy + 0.5) / (ry - 2)) ** 2 < 1;
      P.set(x, y, inner ? ((x + y) % 5 === 0 ? S[2] : y < cy - ry * 0.3 ? S[2] : S[3]) : (y < cy ? S[5] : S[4]));   // a flagged floor inside the rim
    }
    for (let a = 0; a < 12; a++) {                                       // merlons round the rim
      if (a % 2) continue;
      const t = a / 12 * Math.PI * 2, mx = Math.round(cx + Math.cos(t) * (R - 1)), my = Math.round(cy + Math.sin(t) * (ry - 1));
      P.rect(mx - 1, my - 2, 3, 2, S[6]); P.rect(mx - 1, my, 3, 1, S[3]);
    }
    return P.done();
  },

  // Gate doors filling `w` x `h` art pixels (a west gate: the doors run down the gap),
  // oak planks with iron bands and studs, a seam between the leaves; damage k (1 whole).
  doors(w, h, k, seed) {
    const r = this.rng(seed), W = this.WOOD, I = this.IRON, P = this.painter(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const plank = y % 5, c = plank === 4 ? W[0] : plank === 0 ? W[3] : W[2];
      P.set(x, y, k < 0.3 && r() < 0.15 ? W[1] : c);
    }
    for (const bx of [2, w - 4]) { P.rect(bx, 0, 2, h, I[1]); for (let y = 2; y < h; y += 6) P.set(bx, y, I[3]); }   // iron bands with studs
    P.rect(0, Math.floor(h / 2) - 1, w, 2, I[0]);                                                     // the seam
    P.rect(Math.floor(w / 2) - 1, Math.floor(h / 2) - 4, 2, 2, I[3]); P.rect(Math.floor(w / 2) - 1, Math.floor(h / 2) + 2, 2, 2, I[3]);   // ring handles
    if (k < 0.7) for (let i = 0; i < (k < 0.35 ? 7 : 3); i++) {           // splits as it is battered
      let x = Math.floor(r() * w), y = Math.floor(r() * h);
      for (let s = 0; s < 6; s++) { P.set(x, y, W[0]); x += r() < 0.5 ? 1 : 0; y += r() < 0.7 ? 1 : -1; }
    }
    for (let x = 0; x < w; x++) { P.set(x, 0, I[0]); P.set(x, h - 1, I[0]); }
    return P.done();
  },
  // Broken gate: splintered planks scattered on flagstones.
  // Cobbled street or square: small set stones in earth and grey tones, dark joints.
  COBBLE: ['#1f2524', '#2e2620', '#463a30', '#5e4e3f', '#7a6852', '#9a8a72', '#b8aa92'],
  cobbles(w, h, seed) {
    const r = this.rng(seed), C = this.COBBLE, P = this.painter(w, h);
    for (let y = 0; y < h; y += 3) for (let x = -((y / 3) % 2) * 2; x < w; x += 4) {
      const base = r() < 0.5 ? 4 : r() < 0.5 ? 3 : 5;
      for (let yy = y; yy < Math.min(h, y + 3); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + 4); xx++)
        P.set(xx, yy, yy === y + 2 || xx === x + 3 ? C[2] : yy === y ? C[base + 1] : C[base]);
    }
    for (let x = 0; x < w; x++) { P.set(x, 0, C[1]); P.set(x, h - 1, C[1]); }
    for (let y = 0; y < h; y++) { P.set(0, y, C[1]); P.set(w - 1, y, C[1]); }
    return P.done();
  },
  rubble(w, h, seed) {
    const r = this.rng(seed), P = this.painter(w, h);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * (w - 6)), y = Math.floor(r() * (h - 3)), len = 4 + Math.floor(r() * 5);
      for (let k = 0; k < len; k++) { P.set(x + k, y, this.WOOD[2]); P.set(x + k, y + 1, this.WOOD[1]); }
    }
    return P.done();
  },
};
function clampI(v, a, b) { return Math.max(a, Math.min(b, v)); }
