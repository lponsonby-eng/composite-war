// =============================================================================
//  PIXELGEN BUILDINGS: town buildings for the strategy map, one architecture per
//  region, in three-quarter view on a small floating block of ground (grass on top,
//  earth below), with a lit front, a shaded side, tiled roofs, warm lit windows and
//  bushes, trees and props around them. Each region keeps its fantasy element built
//  into the architecture (crystals growing through the Crystal Lakes palaces, lava
//  under the Ember forges, mushroom-cap roofs in the fens...).
//
//    building  96 x 80, the building standing at (48, 76): exactly twice the size
//              of the game's old 48 x 40 building pictures, so it drops straight in.
//              options: style (castle, village, igloo, treehut, forge, tower,
//              stilthut, spire, adobe), size 0 village, 1 town, 2 capital, 3 shrine
// =============================================================================
(function (root) {
  'use strict';
  const PG = typeof module !== 'undefined' && module.exports ? require('./pixelgen.js') : root.PixelGen;
  if (typeof module !== 'undefined' && module.exports) require('./medieval.js');
  const { R, ramp, mix } = PG;
  const { Painter, INK, STEEL, WOODR, GOLDR, BONER } = PG.medieval;
  const R5 = (c, s = 0.55) => ramp(c, 5, s);

  const C = {
    stone: R5('#9a9aa6', 0.5), dark: R5('#4a4452', 0.5), black: R5('#2e2a36', 0.45), plaster: R5('#e8dcc0', 0.35), sand: R5('#d8b070', 0.45),
    adobe: R5('#d89a68', 0.45), white: R5('#eef0f4', 0.3), ice: R5('#a8d8f0', 0.45), snow: R5('#eef4fa', 0.28),
    red: R5('#d0583a'), blue: R5('#3a86d8'), orange: R5('#e07a34'), teal: R5('#2aa8a0'), green: R5('#3a9a5a'), purple: R5('#6a3a9a'),
    brown: R5('#8a5a34'), thatch: R5('#c8a048', 0.5), leaf: R5('#4a9a34'), darkleaf: R5('#2a6a2e'), trunk: R5('#6a4628', 0.5),
    pink: R5('#f08ad0', 0.5), cyan: R5('#7ae8ff', 0.45), gold: GOLDR, wood: WOODR, lava: ['#7a1a08', '#c83a10', '#f07a18', '#ffc040', '#fff0a0'],
    water: R5('#3a90d0', 0.5), mush: R5('#d83a3a'),
  };
  const GLOW = ['#7a4a10', '#d89020', '#ffc848', '#ffe890', '#fffad8'];

  // ---------------------------------------------------------------- primitives (y = bottom)
  function box(P, x, yb, w, h, d, W, o = {}) {
    P.part(P.mask().rect(x, yb - h, x + w - 1, yb - 1), W, { flat: true, base: 2, tex: o.tex, sep: true });
    if (d) P.part(P.mask().poly([[x + w, yb - h], [x + w + d, yb - h - d * 0.5], [x + w + d, yb - d * 0.5], [x + w, yb]]), W, { flat: true, base: 1, tex: o.tex, sep: true });
    if (o.top && d) P.part(P.mask().poly([[x, yb - h], [x + d, yb - h - d * 0.5], [x + w + d, yb - h - d * 0.5], [x + w, yb - h]]), o.topRamp || W, { flat: true, base: 3, sep: true });
  }
  const tiles = (x, y) => (y % 3 === 0 ? -1 : (x + y) % 7 === 0 ? 1 : 0);
  const bricks = (x, y) => ((y % 4 === 0) || ((x + (Math.floor(y / 4) % 2) * 3) % 6 === 0) ? -1 : 0);
  // a gable facing the viewer, its roof running back
  function gable(P, x, yt, w, d, rh, Rf, W) {
    P.part(P.mask().poly([[x, yt], [x + w / 2, yt - rh], [x + w, yt]]), W, { flat: true, base: 2, sep: true });
    P.part(P.mask().poly([[x + w / 2, yt - rh - 1], [x + w / 2 + d, yt - rh - d * 0.5 - 1], [x + w + d + 1, yt - d * 0.5 + 1], [x + w + 1, yt + 1]]), Rf, { flat: true, base: 2, tex: tiles, sep: true });
    P.part(P.mask().capsule(x - 1, yt + 1, x + w / 2, yt - rh - 0.5, 2.2), Rf, { flat: true, base: 3, sep: true });
    P.part(P.mask().capsule(x + w / 2, yt - rh - 0.5, x + w + 1, yt + 1, 2.2), Rf, { flat: true, base: 2 });
  }
  // a roof whose long side faces the viewer
  function hip(P, x, yt, w, d, rh, Rf, W) {
    if (W) P.part(P.mask().poly([[x + w + 1, yt + 1], [x + w + 1 + d, yt + 1 - d * 0.5], [x + w + 1 + d * 0.5, yt - rh]]), W, { flat: true, base: 1, sep: true });
    P.part(P.mask().poly([[x - 2, yt + 1], [x + w + 2, yt + 1], [x + w + d * 0.5 + 1, yt - rh], [x + d * 0.5 - 1, yt - rh]]), Rf, { flat: true, base: 2, tex: tiles, sep: true, shade: (xx, yy) => (yy > yt - 2 ? -1 : 0) });
    P.part(P.mask().rect(x + d * 0.5 - 1, yt - rh - 1, x + w + d * 0.5 + 1, yt - rh), Rf, { flat: true, base: 3 });
  }
  function cone(P, cx, yt, r, h, Rf, o = {}) {
    P.part(P.mask().poly([[cx - r - 1.5, yt + 1], [cx + r + 1.5, yt + 1], [cx, yt - h]]), Rf, { tex: tiles, sep: true });
    if (o.flag) flag(P, cx, yt - h, o.flag);
  }
  function tower(P, cx, yb, r, h, W, o = {}) {
    P.part(P.mask().rect(cx - r, yb - h, cx + r, yb - 1), W, { tex: o.tex || bricks, sep: true });
    if (o.crenel) { const m = P.mask(); for (let x = cx - r; x <= cx + r; x += 3) m.rect(x, yb - h - 2, x + 1, yb - h - 1); P.part(m, W, { flat: true, base: 3 }); }
  }
  function dome(P, cx, yb, r, Rf) { P.part(P.mask().ellipse(cx, yb, r, r * 0.95).rect(cx - r, yb, cx + r, yb + 1), Rf, { sep: true }); }
  function win(P, x, y, w = 3, h = 4, lit = GLOW, arch = true) {
    P.part(P.mask().rect(x - 1, y - 1, x + w, y + h), ['#1a1210', '#2a1e18', '#3a2a22', '#4a3a2e'], { flat: true, base: 0 });
    const m = P.mask().rect(x, y, x + w - 1, y + h - 1); if (arch && w > 2) { m.del(x, y); m.del(x + w - 1, y); }
    P.part(m, lit, { flat: true, base: 2, shade: (xx, yy) => (yy === y ? 1 : 0) });
  }
  function door(P, x, yb, w = 4, h = 6, Wd = WOODR) {
    const m = P.mask().rect(x, yb - h, x + w - 1, yb - 1); m.del(x, yb - h); m.del(x + w - 1, yb - h);
    P.part(m, Wd, { flat: true, base: 1, tex: (xx) => (xx % 2 ? -1 : 0), sep: true });
  }
  function bush(P, x, y, r = 3, Lr = C.leaf) { P.part(P.mask().ellipse(x, y, r, r * 0.8).ellipse(x + r * 0.7, y + 0.5, r * 0.7, r * 0.6), Lr, { sep: true, tex: (xx, yy) => ((xx + yy) % 4 === 0 ? 1 : 0) }); }
  function tree(P, x, yb, h, Lr = C.leaf) {
    P.part(P.mask().capsule(x, yb, x, yb - h * 0.5, 2.2), C.trunk, {});
    const m = P.mask(); for (const [dx, dy, rr] of [[0, -h * 0.75, h * 0.35], [-h * 0.25, -h * 0.55, h * 0.28], [h * 0.25, -h * 0.55, h * 0.28]]) m.ellipse(x + dx, yb + dy, rr, rr * 0.9);
    P.part(m, Lr, { sep: true, tex: (xx, yy) => ((xx * 3 + yy) % 5 === 0 ? 1 : 0) });
  }
  function flag(P, x, y, col) { P.part(P.mask().rect(x, y - 7, x, y), WOODR, {}); P.part(P.mask().poly([[x + 1, y - 7], [x + 6, y - 5.5], [x + 1, y - 4]]), col, { flat: true }); }
  function crystal(P, x, yb, h, w, Rr, lean = 0) {
    const t = [x + lean, yb - h];
    P.part(P.mask().poly([[x - w, yb], [x - w, yb - h * 0.7], t, [x, yb - h * 0.75], [x, yb]]), Rr, { flat: true, base: 3, sep: true });
    P.part(P.mask().poly([[x, yb], [x, yb - h * 0.75], t, [x + w, yb - h * 0.7], [x + w, yb]]), Rr, { flat: true, base: 1, sep: true });
    P.g.set(x - w + 1, yb - h * 0.6, Rr[4]);
  }
  function smoke(P, x, y) { for (let i = 0; i < 4; i++) P.part(P.mask().ellipse(x + i * 1.5, y - i * 3, 1.6 + i * 0.4, 1.4 + i * 0.3), ['#5a5450', '#7a7470', '#a09a96', '#c8c4c0', '#e0dcd8'], { flat: true, base: 3 - (i > 1 ? 1 : 0) }); }
  function timber(P, x, yb, w, h) {                                                  // dark timber framing on plaster
    const col = '#4a3020';
    for (let xx = x; xx < x + w; xx += 5) P.g.vline(xx, yb - h, yb - 1, col);
    P.g.hline(x, x + w - 1, yb - Math.round(h / 2), col); P.g.hline(x, x + w - 1, yb - h, col);
    P.g.line(x, yb - 1, x + 4, yb - Math.round(h / 2), col);
  }

  // ---------------------------------------------------------------- the ground block
  const GROUNDS = {
    castle: ['grass', C.leaf, C.brown], village: ['grass', R5('#6aaa3a'), C.brown], igloo: ['snow', C.snow, C.stone], treehut: ['grass', C.darkleaf, C.brown],
    forge: ['ash', R5('#4a3a34', 0.45), C.dark], tower: ['ash', R5('#55556a', 0.45), C.dark], stilthut: ['marsh', R5('#5e6e30'), C.brown],
    spire: ['grass', R5('#5ab8a0', 0.45), C.white], adobe: ['sand', C.sand, R5('#a06a3e')],
  };
  function ground(P, style, w, r) {
    const [kind, top, side] = GROUNDS[style] || GROUNDS.village, cx = 48, y0 = 66, y1 = 74;
    // earth below: layered, narrowing to a rough point (a floating island)
    const und = P.mask(); for (let y = y1; y <= 79; y++) { const hw = w / 2 - (y - y1) * 1.6; for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) und.add(x, y); }
    P.part(und, side, { flat: true, base: 1, tex: (x, y) => (y % 2 ? -1 : 0) + ((x * 5 + y) % 7 === 0 ? 1 : 0) });
    const topm = P.mask(); for (let y = y0; y <= y1; y++) { const t = (y - y0) / (y1 - y0), hw = w / 2 - (1 - t) * 3; for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) topm.add(x, y); }
    P.part(topm, top, { flat: true, base: 2, tex: (x, y) => ((x * 3 + y * 7) % 11 === 0 ? 1 : (x + y * 5) % 13 === 0 ? -1 : 0), shade: (x, y) => (y === y1 ? -1 : 0) });
    if (kind === 'grass' || kind === 'marsh') for (let x = cx - w / 2; x <= cx + w / 2; x += 3) P.g.set(x + (r() < 0.5 ? 1 : 0), y1 + 1, top[1]);   // grass overhang
    if (kind === 'snow') for (let x = cx - w / 2 + 2; x <= cx + w / 2 - 2; x += 4) P.g.set(x, y1 + 2, C.snow[3]);
  }

  // ---------------------------------------------------------------- the nine architectures
  const STYLES = {
    castle(P, s, r) {
      if (s === 0) { const wide = r.chance(0.4) ? 4 : 0; box(P, 38, 70, 16 + wide, 12, 8, C.plaster); timber(P, 38, 70, 16 + wide, 12); gable(P, 38, 58, 16 + wide, 8, 10, C.blue, C.plaster); win(P, 41, 61); if (wide) win(P, 50, 61); door(P, 47, 70); if (r.chance(0.5)) { box(P, 50, 50, 3, 6, 2, C.stone); smoke(P, 52, 42); } bush(P, 33, 70); }
      else if (s === 1) {
        box(P, 30, 70, 24, 16, 10, C.stone, { tex: bricks }); hip(P, 30, 54, 24, 10, 9, C.blue, C.stone);
        tower(P, 62, 70, 5, 26, C.stone); cone(P, 62, 44, 5, 13, C.blue, { flag: C.blue });
        win(P, 34, 58); win(P, 44, 58); door(P, 40, 70, 5, 7); win(P, 61, 52, 2, 4); bush(P, 26, 70); bush(P, 72, 70, 2.5);
      } else if (s === 2) {
        box(P, 36, 58, 22, 32, 10, C.stone, { tex: bricks }); hip(P, 36, 26, 22, 10, 9, C.blue, C.stone);
        for (const tx of [26, 70]) { tower(P, tx, 72, 6, 30, C.stone, { crenel: false }); cone(P, tx, 42, 6, 15, C.blue, { flag: C.blue }); win(P, tx - 1, 50, 2, 4); }
        box(P, 32, 72, 34, 12, 0, C.stone, { tex: bricks }); const m = P.mask(); for (let x = 32; x < 66; x += 3) m.rect(x, 58, x + 1, 59); P.part(m, C.stone, { flat: true, base: 3 });
        door(P, 45, 72, 7, 9); win(P, 41, 34); win(P, 52, 34); win(P, 41, 44); win(P, 52, 44); bush(P, 18, 71); bush(P, 78, 71);
      } else { box(P, 40, 70, 14, 12, 7, C.stone, { tex: bricks }); gable(P, 40, 58, 14, 7, 8, C.blue, C.stone); tower(P, 47, 50, 2, 6, C.stone, { tex: () => 0 }); cone(P, 47, 44, 2.5, 7, C.blue); door(P, 45, 70, 4, 6); bush(P, 36, 70); }
    },
    village(P, s, r) {
      if (s === 0) {
        const tall = r.chance(0.35) ? 6 : 0;
        box(P, 38, 70, 16, 12 + tall, 8, C.plaster); timber(P, 38, 70, 16, 12 + tall);
        if (r.chance(0.5)) gable(P, 38, 58 - tall, 16, 8, 10, C.orange, C.plaster); else hip(P, 38, 58 - tall, 16, 8, 8, C.orange, C.plaster);
        if (r.chance(0.7)) { box(P, 50, 50 - tall, 3, 6, 2, C.stone); smoke(P, 52, 42 - tall); }
        win(P, 41, 61); if (tall) win(P, 41, 55); door(P, 47, 70); bush(P, 34, 70);
      }
      else if (s === 1) {
        box(P, 34, 70, 22, 20, 10, C.plaster); timber(P, 34, 70, 22, 20); hip(P, 34, 50, 22, 10, 9, C.orange, C.plaster);
        win(P, 37, 55); win(P, 49, 55); win(P, 37, 62); door(P, 46, 70, 5, 7);
        P.part(P.mask().rect(56, 58, 61, 61), WOODR, { flat: true, sep: true });                       // hanging sign
        tower(P, 24, 70, 4, 18, C.plaster, { tex: () => 0 }); cone(P, 24, 52, 4, 7, C.brown);           // windmill
        P.g.line(18, 41, 30, 53, WOODR[3]); P.g.line(18, 53, 30, 41, WOODR[3]); P.part(P.mask().ellipse(24, 47, 1.4, 1.4), WOODR, {});
        bush(P, 66, 70);
      } else if (s === 2) {
        box(P, 20, 72, 14, 14, 6, C.plaster); timber(P, 20, 72, 14, 14); gable(P, 20, 58, 14, 6, 9, C.orange, C.plaster); win(P, 24, 62);
        box(P, 60, 72, 14, 14, 6, C.plaster); timber(P, 60, 72, 14, 14); gable(P, 60, 58, 14, 6, 9, C.orange, C.plaster); win(P, 64, 62);
        box(P, 36, 72, 22, 20, 10, C.stone, { tex: bricks }); box(P, 36, 52, 22, 8, 10, C.plaster); timber(P, 36, 52, 22, 8); hip(P, 36, 44, 22, 10, 8, C.orange, C.plaster);
        tower(P, 47, 36, 4, 14, C.stone); cone(P, 47, 22, 5, 12, C.orange, { flag: C.red });
        P.part(P.mask().ellipse(47, 29, 2.4, 2.4), C.white, { flat: true, base: 3 }); P.g.set(47, 28, INK).set(48, 29, INK);   // clock
        win(P, 39, 60); win(P, 51, 60); door(P, 45, 72, 6, 8); bush(P, 16, 71); bush(P, 80, 71);
      } else {                                                                                    // a well under a little roof
        P.part(P.mask().ellipse(47, 68, 6, 3).rect(41, 64, 53, 68), C.stone, { sep: true, tex: bricks }); P.part(P.mask().ellipse(47, 64, 5, 2), C.water, { flat: true, base: 1 });
        P.part(P.mask().rect(41, 50, 41, 64).rect(53, 50, 53, 64), WOODR, {}); gable(P, 39, 51, 17, 5, 7, C.orange, WOODR); bush(P, 35, 70); bush(P, 60, 70);
      }
    },
    igloo(P, s, r) {
      const igloo = (cx, yb, rr) => {
        P.part(P.mask().ellipse(cx, yb, rr, rr * 0.85).rect(cx - rr, yb, cx + rr, yb + 1), C.snow, { sep: true, tex: (x, y) => ((y % 4 === 0) || ((x + Math.floor(y / 4) * 3) % 7 === 0) ? -1 : 0) });
        P.part(P.mask().ellipse(cx - rr * 0.6, yb - 1, rr * 0.35, rr * 0.4).rect(cx - rr * 0.95, yb - 1, cx - rr * 0.25, yb + 1), C.snow, { sep: true });
        P.part(P.mask().ellipse(cx - rr * 0.6, yb, rr * 0.18, rr * 0.25), ['#1a2a3a', '#2a3a4a', '#3a4a5a', '#4a5a6a'], { flat: true });
      };
      if (s === 0) { igloo(50, 70, 13); P.part(P.mask().rect(66, 64, 68, 70), WOODR, {}); P.part(P.mask().ellipse(67, 63, 2.5, 1.2), C.snow, {}); }
      else if (s === 1) {
        box(P, 34, 70, 24, 12, 10, C.wood, { tex: (x) => (x % 3 === 0 ? -1 : 0) }); hip(P, 34, 58, 24, 10, 11, C.snow, C.wood);
        for (let x = 33; x <= 58; x += 3) P.g.vline(x, 59, 60 + (x % 2), C.ice[3]);                    // icicles
        win(P, 38, 61); win(P, 50, 61); door(P, 45, 70); igloo(24, 70, 8);
      } else if (s === 2) {
        box(P, 22, 72, 50, 14, 0, C.ice, { tex: bricks }); const m = P.mask(); for (let x = 22; x < 72; x += 4) m.rect(x, 56, x + 2, 58); P.part(m, C.ice, { flat: true, base: 3 });
        box(P, 36, 58, 22, 22, 9, C.ice, { tex: bricks });
        crystal(P, 47, 36, 22, 4, C.cyan); crystal(P, 40, 38, 13, 3, C.ice, -1); crystal(P, 56, 38, 15, 3, C.ice, 1);
        for (const tx of [20, 74]) { tower(P, tx, 72, 5, 24, C.ice); crystal(P, tx, 48, 13, 4, C.cyan); }
        door(P, 44, 72, 7, 9, ['#1a3a5a', '#2a4a6a', '#3a6a8a', '#5a8aaa', '#8ab0c8']); win(P, 40, 44, 3, 4, C.cyan); win(P, 52, 44, 3, 4, C.cyan);
      } else { crystal(P, 47, 70, 26, 5, C.cyan); P.part(P.mask().rect(40, 68, 54, 71), C.stone, { sep: true }); for (let i = 0; i < 6; i++) P.g.set(40 + i * 3, 46 + (i % 2) * 6, C.cyan[4]); }
    },
    treehut(P, s, r) {
      if (s === 3) {                                                                          // a ring of standing stones round a glowing rune
        for (const [x, h] of [[34, 12], [42, 16], [54, 15], [62, 11]]) box(P, x, 72, 4, h, 2, C.stone);
        P.part(P.mask().ellipse(48, 66, 2.4, 2.4), R5('#a0ff70', 0.4), { flat: true, base: 3 }); tree(P, 70, 72, 16, C.darkleaf); return;
      }
      const big = [0.7, 0.85, 1.05][s], cx = 48;
      P.part(P.mask().poly([[cx - 9 * big, 72], [cx - 5 * big, 44 - s * 6], [cx + 5 * big, 44 - s * 6], [cx + 9 * big, 72]]).poly([[cx - 13 * big, 72], [cx - 6 * big, 66], [cx - 4 * big, 72]]).poly([[cx + 13 * big, 72], [cx + 6 * big, 66], [cx + 4 * big, 72]]), C.trunk, { tex: (x) => (x % 3 === 0 ? -1 : 0), sep: true });
      const can = P.mask(); const ct = 36 - s * 8;
      for (const [dx, dy, rr] of [[0, 0, 16], [-14, 6, 11], [14, 6, 11], [-7, -8, 10], [8, -8, 10]]) can.ellipse(cx + dx * big, ct + dy * big, rr * big, rr * big * 0.8);
      P.part(can, C.darkleaf, { sep: true, tex: (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 1 : (x + y) % 5 === 0 ? -1 : 0), shade: (x, y) => (y < ct - 4 ? 1 : y > ct + 8 ? -1 : 0) });
      door(P, cx - 2, 72, 5, 8); win(P, cx - 1, 58, 2, 3, R5('#a0ff70', 0.4));
      if (s >= 1) {                                                                              // a hut on a platform in the branches
        const py = s === 1 ? 50 : 44;
        P.part(P.mask().rect(cx - 16, py, cx + 16, py + 1), WOODR, { flat: true, sep: true });
        box(P, cx + 2, py, 12, 9, 5, WOODR, { tex: (x) => (x % 2 ? -1 : 0) }); gable(P, cx + 2, py - 9, 12, 5, 7, C.thatch, WOODR); win(P, cx + 5, py - 6);
        P.g.line(cx - 14, py + 1, cx - 14, 72, WOODR[2]); P.g.line(cx - 11, py + 1, cx - 11, 72, WOODR[2]); for (let y = py + 3; y < 72; y += 3) P.g.hline(cx - 14, cx - 11, y, WOODR[3]);   // ladder
      }
      if (s === 2) { box(P, cx - 18, 32, 10, 8, 4, WOODR); gable(P, cx - 18, 24, 10, 4, 6, C.thatch, WOODR); P.g.line(cx - 8, 30, cx + 2, 36, WOODR[3]); for (const [lx, ly] of [[cx - 20, 44], [cx + 18, 40]]) P.part(P.mask().ellipse(lx, ly, 1.4, 1.6), R5('#c8ff70', 0.4), { flat: true, base: 3 }); }
      P.part(P.mask().ellipse(cx + 12, 71, 2, 1.4).rect(cx + 12, 71, cx + 12, 73), C.mush, {});        // a mushroom
    },
    forge(P, s, r) {
      const lavaLine = (x0, x1, y) => P.part(P.mask().rect(x0, y, x1, y + 1), C.lava, { flat: true, base: 3, tex: (x) => (x % 3 === 0 ? -1 : 0) });
      if (s === 0) { box(P, 36, 70, 18, 12, 8, C.dark, { tex: bricks }); gable(P, 36, 58, 18, 8, 9, C.red, C.dark); box(P, 50, 52, 4, 10, 2, C.dark); smoke(P, 52, 40); door(P, 42, 70, 6, 7, C.lava); win(P, 38, 61, 3, 3, C.lava); lavaLine(28, 34, 72); }
      else if (s === 1) {
        box(P, 28, 70, 30, 16, 10, C.dark, { tex: bricks }); hip(P, 28, 54, 30, 10, 8, C.red, C.dark);
        const chim = [[34, 50], [42], [30, 42, 52]][r.int(0, 2)];
        for (const x of chim) { box(P, x, 50, 4, 12, 2, C.dark); P.g.hline(x, x + 3, 38, C.lava[3]); smoke(P, x + 2, 34); }
        door(P, 40, 70, 7, 9, C.lava); win(P, 31, 60, 3, 4, C.lava); win(P, 52, 60, 3, 4, C.lava); lavaLine(20, 72, 73);
      } else if (s === 2) {
        P.part(P.mask().rect(14, 72, 82, 74), C.lava, { flat: true, base: 2, tex: (x) => (x % 4 === 0 ? 1 : 0) });   // lava moat
        box(P, 22, 72, 50, 14, 0, C.black, { tex: bricks }); const m = P.mask(); for (let x = 22; x < 72; x += 4) m.rect(x, 56, x + 2, 58); P.part(m, C.black, { flat: true, base: 3 });
        box(P, 36, 58, 22, 28, 9, C.black, { tex: bricks }); hip(P, 36, 30, 22, 9, 8, C.red, C.black);
        for (const tx of [22, 72]) { tower(P, tx, 72, 6, 32, C.black); cone(P, tx, 40, 6, 15, C.red, { flag: C.lava }); win(P, tx - 1, 50, 2, 4, C.lava); }
        tower(P, 47, 30, 4, 10, C.black); cone(P, 47, 20, 4.5, 12, C.red);
        door(P, 44, 72, 7, 10, C.lava); win(P, 40, 40, 3, 5, C.lava); win(P, 52, 40, 3, 5, C.lava);
      } else { P.part(P.mask().rect(40, 64, 54, 71), C.dark, { sep: true, tex: bricks }); P.part(P.mask().ellipse(47, 62, 7, 2.4), C.black, { sep: true });
        P.part(P.mask().poly([[42, 62], [44, 52], [47, 56], [49, 48], [51, 55], [53, 62]]), C.lava, { flat: true, base: 3 }); }
    },
    tower(P, s, r) {
      const V = R5('#c070ff', 0.4);
      const grave = (x) => { P.part(P.mask().rect(x, 66, x + 3, 71).ellipse(x + 1.5, 66, 2, 1.5), C.stone, { sep: true }); P.g.hline(x + 1, x + 2, 67, C.stone[1]); };
      if (s === 0) { const th = 24 + r.int(-4, 6); tower(P, 48, 70, 7, th, C.dark); cone(P, 49, 70 - th, 7, 18, C.purple); win(P, 47, 54, 3, 5, V); door(P, 46, 70); grave(32); grave(62); }
      else if (s === 1) {
        box(P, 32, 70, 24, 18, 10, C.dark, { tex: bricks }); hip(P, 32, 52, 24, 10, 10, C.black, C.dark);
        tower(P, 62, 70, 4, 30, C.dark); cone(P, 62, 40, 4.5, 20, C.black);
        P.part(P.mask().ellipse(44, 60, 3.4, 3.4), V, { flat: true, base: 3 }); P.g.vline(44, 57, 63, C.black[1]); P.g.hline(41, 47, 60, C.black[1]);   // rose window
        door(P, 41, 70, 6, 7); grave(22); grave(26); P.part(P.mask().capsule(76, 71, 77, 60, 1.4).capsule(77, 63, 81, 59, 1).capsule(76, 65, 73, 61, 1), C.dark, {});
      } else if (s === 2) {
        box(P, 22, 72, 50, 10, 0, C.black, { tex: bricks }); for (let x = 22; x < 72; x += 3) P.g.vline(x, 59, 62, C.black[1]);   // iron fence
        tower(P, 47, 64, 7, 34, C.black); cone(P, 47, 30, 7, 26, C.black, { flag: C.purple });
        for (const tx of [30, 64]) { tower(P, tx, 66, 5, 26, C.dark); cone(P, tx, 40, 5, 18, C.black); win(P, tx - 1, 50, 2, 5, V); }
        win(P, 45, 40, 4, 6, V); win(P, 45, 52, 4, 6, V); door(P, 44, 64, 7, 9);
      } else { box(P, 38, 70, 18, 12, 8, C.dark, { tex: bricks }); hip(P, 38, 58, 18, 8, 6, C.black, C.dark); door(P, 45, 70, 4, 7, R5('#2a2030', 0.3)); grave(30); grave(62); P.g.set(47, 54, V[4]); }
    },
    stilthut(P, s, r) {
      P.part(P.mask().ellipse(48, 70, s === 2 ? 30 : 22, 3.2), C.water, { flat: true, base: 2, tex: (x, y) => ((x + y) % 7 === 0 ? 2 : 0) });
      const hut = (x, yb, w, h, roof) => {
        for (const sx of [x + 1, x + w - 2]) P.part(P.mask().rect(sx, yb, sx + 1, 72), WOODR, {});
        P.part(P.mask().rect(x - 2, yb, x + w + 1, yb + 1), WOODR, { flat: true, sep: true });
        box(P, x, yb, w, h, 5, WOODR, { tex: (xx) => (xx % 2 ? -1 : 0) });
        if (roof === 'mush') { P.part(P.mask().ellipse(x + w / 2 + 2, yb - h, w / 2 + 6, 7).rect(x - 4, yb - h, x + w + 8, yb - h + 1), C.mush, { sep: true });
          for (const [dx, dy] of [[-3, -3], [3, -5], [7, -2], [0, -1]]) P.part(P.mask().ellipse(x + w / 2 + 2 + dx, yb - h + dy, 1.4, 1), C.white, { flat: true, base: 3 }); }
        else gable(P, x - 1, yb - h, w + 2, 5, 9, C.thatch, WOODR);
        win(P, x + 2, yb - h + 3, 2, 3); P.g.line(x + w + 3, yb + 1, x + w + 5, 72, WOODR[2]);
      };
      if (s === 0) hut(40 - r.int(0, 2), 58, 12 + r.int(0, 4), 9, r.chance(0.25) ? 'mush' : null);
      else if (s === 1) { hut(28, 58, 12, 8); hut(56, 56, 12, 9); P.part(P.mask().rect(42, 57, 54, 57), WOODR, { flat: true }); P.part(P.mask().capsule(76, 71, 76, 60, 2).ellipse(76, 58, 6, 4).rect(70, 58, 82, 59), C.mush, { sep: true }); }
      else if (s === 2) hut(30, 56, 30, 14, 'mush');
      else { P.part(P.mask().capsule(48, 71, 48, 56, 3.4), C.white, { sep: true }); P.part(P.mask().ellipse(48, 52, 12, 8).rect(36, 52, 60, 54), C.mush, { sep: true });
        for (const [dx, dy] of [[-5, -3], [3, -5], [7, -1], [-1, -6]]) P.part(P.mask().ellipse(48 + dx, 52 + dy, 1.6, 1.2), R5('#c8ff70', 0.4), { flat: true, base: 3 }); }
      for (const x of [22, 74]) if (s < 2) P.part(P.mask().rect(x, 64, x, 70).rect(x + 2, 62, x + 2, 70), R5('#6a8a3a'), {});   // reeds
    },
    spire(P, s, r) {
      const PK = C.pink, CY = C.cyan;
      if (s === 0) { crystal(P, 60, 68, 22, 4, PK, 2); crystal(P, 54, 68, 14, 3, CY, -1); box(P, 34, 70, 18, 12, 8, C.white); gable(P, 34, 58, 18, 8, 9, C.teal, C.white); win(P, 37, 61, 3, 4, CY); door(P, 44, 70); bush(P, 30, 70, 2.5, R5('#3a9a7a')); }
      else if (s === 1) {
        crystal(P, 26, 68, 24, 4, PK, -2); box(P, 32, 70, 28, 16, 10, C.white); dome(P, 50, 52, 9, C.teal);
        crystal(P, 38, 54, 14, 3, CY, -1); crystal(P, 64, 70, 18, 3, CY, 2); win(P, 36, 60, 3, 4, CY); win(P, 50, 60, 3, 4, CY); door(P, 43, 70, 5, 8);
      } else if (s === 2) {
        P.part(P.mask().rect(14, 72, 82, 74), C.water, { flat: true, base: 3 });
        box(P, 22, 72, 50, 12, 0, C.white); box(P, 34, 60, 26, 20, 10, C.white);
        crystal(P, 47, 40, 34, 6, PK); crystal(P, 37, 42, 18, 4, CY, -2); crystal(P, 59, 42, 20, 4, CY, 2);
        for (const tx of [22, 72]) { tower(P, tx, 72, 5, 22, C.white, { tex: () => 0 }); dome(P, tx, 50, 5, C.teal); crystal(P, tx, 45, 10, 2.5, PK); }
        door(P, 44, 72, 7, 9, C.teal); win(P, 38, 50, 3, 5, CY); win(P, 54, 50, 3, 5, CY);
      } else { P.part(P.mask().rect(40, 66, 54, 71), C.white, { sep: true }); crystal(P, 47, 58, 20, 5, PK); for (let i = 0; i < 5; i++) P.g.set(38 + i * 5, 44 + (i % 2) * 8, CY[4]); }
    },
    adobe(P, s, r) {
      const awning = (x, y, w) => { const m = P.mask().poly([[x, y], [x + w, y], [x + w + 2, y + 4], [x - 2, y + 4]]); P.part(m, (xx) => (Math.floor(xx / 3) % 2 ? C.red : C.white), { flat: true, base: 2, sep: true }); };
      const palm = (x, yb) => { P.part(P.mask().capsule(x, yb, x + 2, yb - 18, 1.6), C.trunk, { tex: (xx, y) => (y % 2 ? -1 : 0) }); for (const a of [-2.6, -2, -1.2, -0.6, 0]) P.part(P.mask().capsule(x + 2, yb - 18, x + 2 + Math.cos(a) * 9, yb - 18 + Math.sin(a) * 4 + 4, 1.6), C.leaf, { sep: true }); };
      if (s === 0) { box(P, 38, 70, 18, 12, 8, C.adobe, { top: true }); if (r.chance(0.45)) dome(P, 50, 56, 4, C.green); awning(40, 60, 8); door(P, 50, 70); win(P, 41, 64, 3, 3); palm(30, 70); P.part(P.mask().ellipse(62, 69, 2.4, 2.4), R5('#b06a3a'), { sep: true }); }
      else if (s === 1) { box(P, 30, 70, 28, 14, 10, C.adobe, { top: true }); dome(P, 49, 52, 8, C.green); awning(32, 60, 10); door(P, 46, 70, 5, 7); win(P, 34, 64, 3, 3); palm(66, 70); P.part(P.mask().rect(24, 66, 28, 70), C.brown, { sep: true }); }
      else if (s === 2) {
        box(P, 22, 72, 50, 12, 0, C.adobe); box(P, 34, 62, 26, 18, 10, C.sand, { top: true });
        dome(P, 52, 42, 11, C.gold); P.part(P.mask().rect(52, 26, 52, 31), C.gold, {}); P.part(P.mask().ellipse(52, 25, 1.6, 1.6), C.gold, { spec: true });
        for (const tx of [22, 72]) { tower(P, tx, 72, 4, 32, C.sand, { tex: () => 0 }); dome(P, tx, 40, 4.4, C.gold); win(P, tx - 1, 50, 2, 4); }
        door(P, 44, 72, 7, 9, C.gold); win(P, 38, 52, 3, 5); win(P, 56, 52, 3, 5); palm(14, 72); palm(78, 72);
      } else { P.part(P.mask().rect(42, 66, 52, 71), C.adobe, { sep: true }); P.part(P.mask().poly([[44, 66], [50, 66], [48, 44], [46, 44]]), C.sand, { sep: true }); P.part(P.mask().poly([[46, 44], [48, 44], [47, 41]]), C.gold, {}); palm(60, 71); }
    },
  };
  const WIDTH = [42, 58, 80, 40];

  // ---------------------------------------------------------------- variants
  // Each seed gives a building its own colours (chosen from options that suit the
  // region), may mirror it, and scatters its own props on the ground block.
  const VARIANTS = {
    castle:   { blue: ['#3a86d8', '#2a9a9a', '#5a6a8a', '#c04a3a', '#3a5ab8'], plaster: ['#e8dcc0', '#f0ece0', '#d8c8a8'], stone: ['#9a9aa6', '#a8a090', '#8a92a0'] },
    village:  { orange: ['#e07a34', '#c84a2a', '#8a5a34', '#c8a048', '#a8603a'], plaster: ['#e8dcc0', '#f4eee0', '#e0c8a0', '#d8d0b8'] },
    igloo:    { wood: null },
    treehut:  { thatch: ['#c8a048', '#8a6a3a', '#5a8a3a'], darkleaf: ['#2a6a2e', '#2a5a3a', '#3a6a28'] },
    forge:    { red: ['#d0583a', '#e07a2a', '#8a3a2a', '#5a4a4a'] },
    tower:    { purple: ['#6a3a9a', '#2a6a6a', '#8a2a4a', '#3a3a7a'] },
    stilthut: { thatch: ['#c8a048', '#a88a48', '#8a7a4a'], mush: ['#d83a3a', '#a03ad0', '#e07a2a', '#3a8ad0'] },
    spire:    { teal: ['#2aa8a0', '#3a7ad8', '#8a5ad0', '#2a9a6a'], pink: ['#f08ad0', '#ffd060', '#a080ff'] },
    adobe:    { green: ['#3a9a5a', '#3a7ad8', '#e0b440', '#2aa8a0', '#c84a3a'], adobe: ['#d89a68', '#e0b080', '#c8885a'] },
  };
  const PROPS = {
    castle: ['bush', 'tree', 'barrel', 'flowers', 'fence', 'rock'], village: ['bush', 'tree', 'hay', 'barrel', 'flowers', 'fence', 'crate'],
    igloo: ['snowman', 'barrel', 'rock', 'pine'], treehut: ['mushroom', 'bush', 'lantern', 'rock'], forge: ['anvil', 'crate', 'rock', 'barrel'],
    tower: ['grave', 'deadtree', 'lantern', 'rock'], stilthut: ['reeds', 'mushroom', 'barrel'], spire: ['crystal', 'bush', 'flowers'],
    adobe: ['palm', 'pot', 'crate', 'cactus'],
  };
  function prop(P, kind, x, yb) {
    switch (kind) {
      case 'bush': return bush(P, x, yb - 2, 2.6);
      case 'tree': return tree(P, x, yb, 14);
      case 'pine': return P.part(P.mask().poly([[x - 4, yb - 1], [x + 4, yb - 1], [x, yb - 14]]), C.darkleaf, { sep: true });
      case 'barrel': return P.part(P.mask().rect(x - 2, yb - 5, x + 2, yb - 1), WOODR, { sep: true, tex: (xx, y) => (y === yb - 3 ? -1 : 0) });
      case 'crate': return box(P, x - 2, yb, 4, 4, 2, WOODR);
      case 'hay': return P.part(P.mask().ellipse(x, yb - 3, 3.4, 2.6), C.thatch, { sep: true, tex: (xx, y) => ((xx + y) % 3 === 0 ? 1 : 0) });
      case 'flowers': for (let i = 0; i < 3; i++) P.g.set(x + i * 2 - 2, yb - 1 - (i % 2), ['#f05a8a', '#f0e060', '#ffffff'][i]); return;
      case 'fence': for (let i = 0; i < 4; i++) P.g.vline(x - 4 + i * 3, yb - 4, yb - 1, WOODR[2]); P.g.hline(x - 4, x + 5, yb - 3, WOODR[3]); return;
      case 'rock': return P.part(P.mask().ellipse(x, yb - 2, 2.6, 2), C.stone, { sep: true });
      case 'snowman': P.part(P.mask().ellipse(x, yb - 2, 2.4, 2.2).ellipse(x, yb - 5.5, 1.7, 1.6), C.snow, { sep: true }); P.g.set(x + 1, yb - 6, '#e07a2a'); return;
      case 'mushroom': P.part(P.mask().rect(x, yb - 3, x, yb - 1), C.white, {}); return P.part(P.mask().ellipse(x, yb - 4, 2.4, 1.4), C.mush, { sep: true });
      case 'lantern': P.part(P.mask().rect(x, yb - 8, x, yb - 1), WOODR, {}); return P.part(P.mask().rect(x - 1, yb - 10, x + 1, yb - 8), GLOW, { flat: true, base: 3 });
      case 'anvil': return P.part(P.mask().rect(x - 3, yb - 4, x + 3, yb - 3).rect(x - 1, yb - 3, x + 1, yb - 1), C.dark, { sep: true });
      case 'grave': P.part(P.mask().rect(x - 1, yb - 5, x + 2, yb - 1).ellipse(x + 0.5, yb - 5, 2, 1.4), C.stone, { sep: true }); return;
      case 'deadtree': return P.part(P.mask().capsule(x, yb, x, yb - 10, 1.4).capsule(x, yb - 6, x + 4, yb - 9, 1).capsule(x, yb - 8, x - 3, yb - 11, 1), C.dark, {});
      case 'reeds': for (let i = 0; i < 3; i++) P.g.vline(x + i * 2 - 2, yb - 5 - (i % 2) * 2, yb - 1, R5('#6a8a3a')[2 + (i % 2)]); return;
      case 'crystal': return crystal(P, x, yb - 1, 8, 2, C.pink, 1);
      case 'palm': P.part(P.mask().capsule(x, yb, x + 1, yb - 12, 1.4), C.trunk, {}); for (const a of [-2.6, -1.8, -1, -0.3]) P.part(P.mask().capsule(x + 1, yb - 12, x + 1 + Math.cos(a) * 6, yb - 12 + Math.sin(a) * 3 + 3, 1.3), C.leaf, { sep: true }); return;
      case 'pot': return P.part(P.mask().ellipse(x, yb - 2.5, 2.2, 2.4), R5('#b06a3a'), { sep: true });
      case 'cactus': return P.part(P.mask().capsule(x, yb, x, yb - 8, 1.6).capsule(x, yb - 4, x + 3, yb - 6, 1.2), C.leaf, { sep: true });
    }
  }

  function genBuilding(o) {
    const r = R.make(o.seed, 'building');
    const style = STYLES[o.style] ? o.style : r.pick(Object.keys(STYLES));
    const size = Math.max(0, Math.min(3, +o.size || 0));
    const P = new Painter(96, 80);
    const V = VARIANTS[style] || {}, saved = {};
    const variant = o.variant !== 'no';
    if (variant) for (const [k, opts] of Object.entries(V)) if (opts) { saved[k] = C[k]; C[k] = R5(r.pick(opts), k === 'plaster' ? 0.35 : 0.55); }
    try {
      ground(P, style, WIDTH[size], r);
      // props behind the building first, then the building, then props in front
      const w = WIDTH[size], list = PROPS[style] || [], n = variant ? r.int(1, size === 2 ? 2 : 3) : 0, front = [];
      for (let i = 0; i < n; i++) {
        const side = r.chance(0.5) ? -1 : 1, x = 48 + side * (w / 2 - 4 - r.int(0, 3)), k = r.pick(list);
        if (r.chance(0.5)) prop(P, k, x, 68); else front.push([k, x]);
      }
      STYLES[style](P, size, r);
      for (const [k, x] of front) prop(P, k, x, 73);
    } finally { for (const k of Object.keys(saved)) C[k] = saved[k]; }
    let img = P.done();
    if (variant && size !== 3 && r.chance(0.5)) img = img.flipX();          // some face the other way
    return { img, anim: { fw: 96, fh: 80, fps: 1, tracks: [[{ x: 0, y: 0 }]] }, name: `building-${style}-${['village', 'town', 'capital', 'shrine'][size]}` };
  }

  Object.assign(PG.GENERATORS, {
    building: { group: 'Medieval 32px', fn: genBuilding, label: 'Town building', size: '96 x 80', options: { style: ['random', ...Object.keys(STYLES)], size: ['0', '1', '2', '3'], variant: ['yes', 'no'] } },
  });
  PG.buildings = { STYLES: Object.keys(STYLES) };
})(typeof window !== 'undefined' ? window : globalThis);
