// =============================================================================
//  PIXELGEN CREATURES: monsters and war machines for the medieval 32px set.
//  Inspired by the bestiary of Vampire Survivors: every creature reads as a strong
//  silhouette in one colour family, with glowing eyes and a reaching, shambling or
//  flapping animation, so a swarm of them is legible at a glance. All designs are
//  our own. Offline, seeded, no dependencies.
//
//    creature  192 x 288 sheet of 48 x 48 frames: cols down/up/left/right,
//              rows 0-3 walk (or fly / roll), row 4 attack, row 5 remains (col 0).
//              The figure stands like a soldier (32 px scale) in the middle of the
//              frame, with room for wings, claws and long barrels.
//              Option hero: 'yes' makes a monster general: larger, regalia, aura.
//    creatureface  64 x 64 portrait of a creature (for monster generals)
//
//  Kinds: walkers   skeleton, bonepriest, ninja, fishfolk, frogman, yeti, bogshaman,
//                   thornling, mudbrute, mummy
//         floaters  slime, flame, ghost, frosteye, crystaleye, firehawk, bat
//         crawlers  beetle, crab
//         machines  cannon, firecannon, suncannon, mortar, catapult
// =============================================================================
(function (root) {
  'use strict';
  const PG = typeof module !== 'undefined' && module.exports ? require('./pixelgen.js') : root.PixelGen;
  if (typeof module !== 'undefined' && module.exports) require('./medieval.js');
  const { R, Grid, ramp, mix, pack, dither, rgbHex, FACTIONS } = PG;
  const K = PG.medieval;
  const { Painter, INK, STEEL, LEATHER, WOODR, BLOOD, BONER, GOLDR, FUR, soldierGenome, soldierFrame, drawWeapon, drawHeroWeapon, tRamp } = K;

  const EYE = { red: ['#5a0808', '#a01010', '#ff3020', '#ff9a80', '#fff0e0'], yellow: ['#5a4008', '#a07010', '#ffc020', '#ffe880', '#fffae0'],
    green: ['#0a4a10', '#18902a', '#5aff4a', '#b0ffa0', '#f0fff0'], violet: ['#2a0a4a', '#6020a0', '#b060ff', '#e0b0ff', '#fff0ff'],
    cyan: ['#0a3a4a', '#1880a0', '#40e0ff', '#a8f4ff', '#f0ffff'] };
  const DARKS = ['#08060a', '#100c12', '#18141a', '#201c24', '#2a2630'];
  const R5 = (c, s = 0.55) => ramp(c, 5, s);

  // ---------------------------------------------------------------- creature table
  // body: walker | floater | crawler | machine. scale: drawn size vs a soldier.
  // fluid: what they leave behind. glow: aura and eye colour family.
  const KINDS = {
    skeleton:   { body: 'walker',  scale: 1,    fluid: 'bones', glow: 'red' },
    bonepriest: { body: 'walker',  scale: 1.05, fluid: 'bones', glow: 'violet' },
    ninja:      { body: 'walker',  scale: 1,    fluid: 'blood', glow: 'red' },
    fishfolk:   { body: 'walker',  scale: 1,    fluid: 'blood', glow: 'yellow' },
    frogman:    { body: 'walker',  scale: 1,    fluid: 'ichor', glow: 'yellow' },
    yeti:       { body: 'walker',  scale: 1.4,  fluid: 'blood', glow: 'cyan' },
    bogshaman:  { body: 'walker',  scale: 1,    fluid: 'ichor', glow: 'green' },
    thornling:  { body: 'walker',  scale: 0.95, fluid: 'sap',   glow: 'yellow' },
    mudbrute:   { body: 'walker',  scale: 1.45, fluid: 'mud',   glow: 'yellow' },
    mummy:      { body: 'walker',  scale: 1.05, fluid: 'dust',  glow: 'yellow' },
    slime:      { body: 'floater', scale: 1,    fluid: 'ichor', glow: 'green' },
    flame:      { body: 'floater', scale: 1,    fluid: 'ash',   glow: 'yellow' },
    ghost:      { body: 'floater', scale: 1.1,  fluid: 'ecto',  glow: 'cyan' },
    frosteye:   { body: 'floater', scale: 1,    fluid: 'ecto',  glow: 'cyan' },
    crystaleye: { body: 'floater', scale: 1,    fluid: 'shards', glow: 'violet' },
    firehawk:   { body: 'floater', scale: 1.1,  fluid: 'ash',   glow: 'yellow' },
    bat:        { body: 'floater', scale: 1,    fluid: 'blood', glow: 'red' },
    beetle:     { body: 'crawler', scale: 1.35, fluid: 'ichor', glow: 'green' },
    crab:       { body: 'crawler', scale: 1.3,  fluid: 'blood', glow: 'yellow' },
    cannon:     { body: 'machine', scale: 1.15, fluid: 'wreck', glow: 'yellow' },
    firecannon: { body: 'machine', scale: 1.15, fluid: 'wreck', glow: 'red' },
    suncannon:  { body: 'machine', scale: 1.15, fluid: 'wreck', glow: 'yellow' },
    mortar:     { body: 'machine', scale: 1.1,  fluid: 'sap',   glow: 'green' },
    catapult:   { body: 'machine', scale: 1.25, fluid: 'wreck', glow: 'cyan' },
  };
  const FLUIDS = { blood: BLOOD, ichor: ['#1a3a0a', '#2e6014', '#4a8a20', '#6ab030'], sap: ['#3a2a08', '#6a4a10', '#9a7020', '#c09838'],
    mud: ['#2a2014', '#3e3020', '#54422c', '#6a5638'], ecto: ['#0a3a3a', '#146060', '#2a9a90', '#5ad0c0'], ash: ['#1a1616', '#2a2422', '#3e3634', '#5a504c'],
    dust: ['#5a4a30', '#7a6a48', '#9a8a64', '#b8a882'], shards: ['#4a1a5a', '#8a3aa8', '#c070e0', '#f0c0ff'], bones: null, wreck: ['#1a1410', '#2a2018', '#3a2e22', '#4a3c2c'] };

  // ---------------------------------------------------------------- genome
  function genome(o) {
    const r = R.make(o.seed, 'creature');
    const kind = KINDS[o.creature] ? o.creature : r.pick(Object.keys(KINDS));
    const K0 = KINDS[kind], hero = o.hero === 'yes';
    const g = { kind, K: K0, r, hero, seed: o.seed, faction: o.faction, step: 0,
      E: EYE[K0.glow], glow: EYE[K0.glow][2], GL: EYE[K0.glow], glowWeapon: false };
    g.arms = K.rollArms(o.faction, o.seed, !FACTIONS[o.faction]);
    g.fc = FACTIONS[o.faction] ? R5(FACTIONS[o.faction].main) : R5('#8a8a92');
    if (K0.body === 'walker') g.body = walkerBody(g, o, r);
    if (hero) g.crown = r.pick(['crown', 'horns', 'circlet']);
    return g;
  }

  // The soldier body, re-dressed for each walking creature.
  function walkerBody(g, o, r) {
    const k = g.kind;
    const opts = { seed: o.seed, faction: o.faction, troop: 'levy', helm: 'none', weapon: 'none' };
    if (k === 'skeleton') Object.assign(opts, { weapon: r.pick(['sword', 'axe', 'spear', 'sword']), helm: r.pick(['none', 'none', 'kettle']) });
    if (k === 'fishfolk') opts.weapon = 'spear';
    if (k === 'frogman') opts.weapon = 'mace';
    if (k === 'ninja') opts.helm = 'hood';
    if (k === 'bonepriest' || k === 'bogshaman') opts.helm = k === 'bonepriest' ? 'hood' : 'none';
    const b = soldierGenome(opts);
    b.shield = false; b.beard = 'none'; b.plume = false; b.hairStyle = 'bald';
    const ribs = (x, y) => (y % 2 === 0 && x > 11 && x < 21 ? DARKS : BONER);
    const SC = { skeleton: BONER, bonepriest: BONER, ninja: R5('#e0b890', 0.4), fishfolk: R5('#3a9a8a'), frogman: R5('#5a9a3a'), yeti: R5('#e8e8f0', 0.35),
      bogshaman: R5('#7a8a3a'), thornling: R5('#6a4a2a'), mudbrute: R5('#5a4a2e', 0.5), mummy: R5('#c8b890', 0.45) }[k];
    b.skin = SC; b.hair = SC;
    const furTex = (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 1 : (x + y) % 5 === 0 ? -1 : 0);
    const bandTex = (x, y) => ((x + y * 2) % 4 === 0 ? -1 : 0);
    const scaleTex = (x, y) => ((x + (y % 2) * 2) % 4 === 0 ? -1 : 0);
    const barkTex = (x, y) => (x % 3 === 0 ? -1 : (x * 5 + y) % 9 === 0 ? 1 : 0);
    const mudTex = (x, y) => ((x * 7 + y * 3) % 8 === 0 ? 1 : (y * 3 + x) % 6 === 0 ? -1 : 0);
    switch (k) {
      case 'skeleton': b.over = { torso: ribs, arms: BONER, legs: BONER, feet: BONER, hands: BONER, belt: LEATHER, plate: false }; break;
      case 'bonepriest': b.liv = R5('#4a2a6a', 0.5); b.over = { robe: true, torso: () => b.liv, arms: b.liv, hands: BONER, feet: DARKS, belt: GOLDR }; break;
      case 'ninja': { const N = R5('#2a2c48', 0.45); b.liv = N; b.over = { torso: () => N, arms: N, legs: N, feet: DARKS, hands: N, belt: R5('#c02030') }; break; }
      case 'fishfolk': b.over = { torso: (x) => (x >= 14 && x <= 18 ? R5('#b8e0c8', 0.4) : SC), torsoOpts: { tex: scaleTex }, arms: SC, armOpts: { tex: scaleTex }, legs: SC, feet: R5('#2a6a5a'), hands: SC, belt: false }; break;
      case 'frogman': b.over = { torso: (x) => (x >= 13 && x <= 19 ? R5('#d8d8a0', 0.4) : SC), arms: SC, armOpts: {}, legs: SC, feet: SC, hands: SC, belt: R5('#6a4a2a') }; break;
      case 'yeti': b.over = { torso: () => SC, torsoOpts: { tex: furTex }, arms: SC, armOpts: { tex: furTex }, legs: SC, feet: R5('#6a8ab8'), hands: R5('#6a8ab8'), belt: false }; break;
      case 'bogshaman': b.liv = R5('#5a5a2a'); b.over = { robe: true, torso: (x, y) => ((x + y) % 3 === 0 ? R5('#3a6a2a') : b.liv), arms: SC, armOpts: {}, hands: SC, feet: SC, belt: BONER }; break;
      case 'thornling': b.over = { torso: () => SC, torsoOpts: { tex: barkTex }, arms: SC, armOpts: { tex: barkTex }, legs: SC, feet: SC, hands: SC, belt: false }; break;
      case 'mudbrute': b.over = { torso: () => SC, torsoOpts: { tex: mudTex }, arms: SC, armOpts: { tex: mudTex }, legs: SC, feet: SC, hands: SC, belt: false }; break;
      case 'mummy': b.over = { torso: () => SC, torsoOpts: { tex: bandTex }, arms: SC, armOpts: { tex: bandTex }, legs: SC, feet: SC, hands: SC, belt: false }; break;
    }
    b.roundShield = k === 'skeleton' && r.chance(0.5);
    return b;
  }

  // ---------------------------------------------------------------- walkers: pieces over the body
  function walkerFront(g, P, dir, pose, step, b) {
    const k = g.kind, side = dir === 2, back = dir === 1, atk = pose === 'attack';
    const cy = 9 + b, cx = side ? 15.5 : 16, E = g.E, SC = g.body.skin;
    const eyes = (pts, big) => { if (back) return; for (const [x, y] of pts) { P.g.set(x, y, E[2]); if (big) P.g.set(x, y - 1, E[3]); } };
    if (k === 'skeleton' || k === 'bonepriest') {
      if (k === 'skeleton') {
        P.part(side ? P.mask().ellipse(15.5, cy - 0.5, 4.4, 4.8).rect(12, cy + 2, 17, cy + 4) : P.mask().ellipse(16, cy - 0.5, 4.6, 4.8).rect(13, cy + 2, 19, cy + 4), BONER, { sep: true });
        if (g.body.helm === 'kettle') { P.part(P.mask().ellipse(cx, cy - 3, 4.6, 3).rect(cx - 7, cy - 2, cx + 7, cy - 2), R5('#7a5a3a', 0.4), { sep: true }); }
      }
      if (!back) {
        const S = side ? [[12, cy]] : [[14, cy], [18, cy]];
        for (const [x, y] of S) { P.g.set(x - 1, y - 1, DARKS[0]).set(x, y - 1, DARKS[0]).set(x - 1, y, DARKS[1]).set(x, y, E[2]); }
        if (k === 'skeleton') { P.g.set(side ? 11 : 16, cy + 1, DARKS[0]); for (let x = side ? 11 : 13; x <= (side ? 15 : 19); x++) P.g.set(x, cy + 3, x % 2 ? DARKS[1] : BONER[3]); }
      }
      if (k === 'bonepriest') {
        const st = { GL: g.GL, glow: g.glow, glowWeapon: false };
        drawHeroWeapon(P, st, 'skullstaff', side ? 11 : 24, side ? 24 + b : 25.5 + b, side ? (atk ? 190 : -98) : atk ? -60 : -86);
        if (atk) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; P.g.set((side ? 0 : 30) + Math.cos(a) * 3.5, 9 + b + Math.sin(a) * 3.5, i % 2 ? E[4] : E[2]); }
      }
      if (g.body.roundShield && !back) {
        const sx = side ? 9 : 8, sy = 23 + b;
        P.part(P.mask().ellipse(sx, sy, side ? 2.4 : 5.4, 5.6), WOODR, { sep: true, tex: (x) => (x % 3 === 0 ? -1 : 0) });
        P.part(P.mask().ellipse(sx, sy, 1.4, 1.4), R5('#7a5a3a', 0.4), {});
      }
    } else if (k === 'ninja') {
      if (!back) { for (let x = side ? 11 : 12; x <= (side ? 16 : 20); x++) for (let y = cy + 1; y <= cy + 4; y++) P.g.set(x, y, g.body.liv[(x + y) % 2 ? 1 : 2]); eyes(side ? [[12, cy]] : [[14, cy], [18, cy]]); }
      const wave = pose === 'walk' ? [0, 1, 0, -1][step] : 2, ex = side ? 27 + wave : back ? 6 - wave : 26 + wave;      // a long red scarf
      P.part(P.mask().capsule(side ? 17 : 16, 13 + b, ex, 16 + b + wave, 2.2).capsule(ex, 16 + b + wave, ex + (side ? 4 : 3), 21 + b, 1.8), R5('#c02030'), { sep: true });
      const hand = side ? (atk ? [9, 21 + b] : [12, 24 + b]) : atk ? [25.8, 9 + b] : [24, 25.5 + b];
      if (atk) { const sx = hand[0] + (side ? -3 : 3), sy = hand[1] - 2; P.part(P.mask().rect(sx - 1, sy, sx + 1, sy).rect(sx, sy - 1, sx, sy + 1), STEEL, { spec: true }); P.g.set(sx - 2, sy - 2, STEEL[3]).set(sx + 2, sy + 2, STEEL[3]).set(sx + 2, sy - 2, STEEL[3]).set(sx - 2, sy + 2, STEEL[3]); }
      else drawWeapon(P, 'sword', side ? hand[0] - 1 : hand[0], hand[1], side ? -98 : -62, { sep: true });
    } else if (k === 'fishfolk' || k === 'frogman') {
      const F = k === 'fishfolk';
      const head = side ? P.mask().ellipse(14.5, cy + (F ? 0 : 1), F ? 5.4 : 5.6, F ? 4.6 : 4) : P.mask().ellipse(16, cy + (F ? 0 : 1), F ? 5.6 : 6.2, F ? 5 : 4.2);
      P.part(head, SC, { sep: true });
      if (F) {                                                                         // a fin crest, big side eyes, a wide toothy mouth
        const fin = P.mask(); for (let i = 0; i < 4; i++) fin.poly([[cx - 3 + i * 2, cy - 4], [cx - 2 + i * 2, cy - 9 + (i % 2)], [cx - 1 + i * 2, cy - 4]]);
        P.part(fin, R5('#e07a8a', 0.5), { sep: true });
        if (!back) {
          for (const ex of side ? [12] : [11, 21]) { P.part(P.mask().ellipse(ex, cy - 1, 1.8, 1.8), R5('#f0d040', 0.4), { flat: true, base: 2 }); P.g.set(ex, cy - 1, DARKS[0]); }
          for (let x = side ? 9 : 12; x <= (side ? 13 : 20); x++) P.g.set(x, cy + 3, x % 2 ? DARKS[0] : '#f0f0e0');
        }
      } else if (!back) {                                                              // frog: eyes bulging on top, a wide grin
        for (const ex of side ? [13] : [12.5, 19.5]) { P.part(P.mask().ellipse(ex, cy - 3, 2.2, 2.2), SC, { sep: true }); P.part(P.mask().ellipse(ex, cy - 3, 1.3, 1.1), R5('#f0d040', 0.4), { flat: true, base: 2 }); P.g.hline(Math.round(ex) - 1, Math.round(ex), cy - 3, DARKS[0]); }
        P.g.hline(side ? 9 : 11, side ? 14 : 21, cy + 2, DARKS[1]);
      }
    } else if (k === 'yeti' || k === 'mudbrute') {
      const Y = k === 'yeti', C = SC;
      // hunched, massive shoulders and long arms that hang to the knees
      const sh = P.mask(); for (let i = 0; i < 5; i++) sh.ellipse(side ? 12 + i * 2 : 7 + i * 4.5, 15 + b - (i === 2 ? 1 : 0), 3.6, 3.2);
      P.part(sh, C, { sep: true, tex: (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 1 : 0) });
      if (!side) for (const [x0, x1] of [[7, 5 - (atk ? 0 : 0)], [25, 27]]) {
        const up = atk && x0 > 16;
        P.part(P.mask().capsule(x0, 17 + b, up ? x1 + 2 : x1, up ? 6 + b : 31 + b, 4.6), C, { sep: true, tex: (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 1 : 0) });
        P.part(P.mask().ellipse(up ? x1 + 2 : x1, up ? 5 + b : 32 + b, 3, 2.6), Y ? R5('#6a8ab8') : C, { sep: true });
      } else { const up = atk; P.part(P.mask().capsule(13, 17 + b, up ? 4 : 11, up ? 15 + b : 31 + b, 4.6), C, { sep: true }); P.part(P.mask().ellipse(up ? 3 : 11, up ? 15 + b : 32 + b, 3, 2.6), Y ? R5('#6a8ab8') : C, { sep: true }); }
      const hy = cy + 3;                                                              // the head sits low, between the shoulders
      P.part(side ? P.mask().ellipse(13, hy, 4.2, 4) : P.mask().ellipse(16, hy, 4.6, 4.2), C, { sep: true, tex: (x, y) => ((x + y) % 4 === 0 ? 1 : 0) });
      if (Y && !back) { P.part(side ? P.mask().ellipse(11.5, hy + 0.5, 2.4, 2.6) : P.mask().ellipse(16, hy + 1, 3, 2.6), R5('#6a8ab8'), { flat: true, base: 2 }); for (const f of side ? [1] : [-1, 1]) P.part(P.mask().capsule(cx + 3.5 * f, hy - 3, cx + 5 * f, hy - 7, 1.4), BONER, { sep: true }); }
      eyes(side ? [[10, hy]] : [[14, hy], [18, hy]], true);
      if (!back) { if (Y) P.g.set(side ? 10 : 15, hy + 2, '#f0f0e0').set(side ? 11 : 17, hy + 2, '#f0f0e0'); else for (let i = 0; i < 4; i++) P.g.vline(side ? 14 + i * 2 : 9 + i * 5, 26 + b, 28 + b + (i % 2), C[0]); }   // fangs / mud drips
      if (!Y) { const ms = P.mask(); for (const x of side ? [14, 18] : [8, 13, 20, 25]) ms.ellipse(x, 13 + b, 1.8, 1.2); P.part(ms, R5('#4a7a2a'), {}); }   // moss
    } else if (k === 'bogshaman') {
      P.part(side ? P.mask().ellipse(14.5, cy + 0.5, 4.4, 4.4) : P.mask().ellipse(16, cy + 0.5, 4.8, 4.6), BONER, { sep: true });   // bone mask
      if (!back) { for (const [x, y] of side ? [[12, cy]] : [[14, cy], [18, cy]]) P.g.set(x, y, DARKS[0]).set(x, y, E[2]); P.g.hline(side ? 11 : 14, side ? 14 : 18, cy + 3, DARKS[1]); }
      const fc = ['#c03030', '#3a9a3a', '#e8c040', '#3a6ac0'];
      for (let i = 0; i < 4; i++) { const a = -Math.PI * (0.2 + i * 0.2), x1 = cx + Math.cos(a) * 9, y1 = cy - 3 + Math.sin(a) * 8; P.part(P.mask().capsule(cx, cy - 3, x1, y1, 2), R5(fc[i]), { sep: true }); }
      drawHeroWeapon(P, { GL: g.GL, glow: g.glow, glowWeapon: false }, 'staff', side ? 11 : 24, side ? 24 + b : 25.5 + b, side ? (atk ? 190 : -98) : atk ? -60 : -86);
    } else if (k === 'thornling') {
      const leaves = P.mask(); for (let i = 0; i < 7; i++) { const a = -Math.PI * (0.05 + i * 0.15); leaves.ellipse(cx + Math.cos(a) * 4.5, cy - 2 + Math.sin(a) * 4.5, 2.4, 1.8); }
      P.part(leaves, R5('#4a8a2a'), { sep: true, tex: (x, y) => ((x + y) % 3 === 0 ? 1 : 0) });
      eyes(side ? [[12, cy + 1]] : [[14, cy + 1], [18, cy + 1]], true);
      for (const [x, y] of side ? [[14, 17], [18, 20]] : [[9, 16], [23, 16], [11, 21], [21, 21]]) P.part(P.mask().poly([[x - 1, y + b], [x + 1, y + b], [x + (x < 16 ? -2 : 2), y - 3 + b]]), BONER, {});
      if (atk) P.part(P.mask().capsule(side ? 4 : 26, 20 + b, side ? 0 : 30, 18 + b, 1.2), R5('#8a6a3a'), {});
    } else if (k === 'mummy') {
      if (!back) { P.g.hline(side ? 11 : 13, side ? 14 : 19, cy, DARKS[0]); eyes(side ? [[12, cy]] : [[14, cy], [18, cy]]); }
      for (let i = 0; i < 3; i++) P.part(P.mask().capsule(side ? 18 + i : 10 + i * 6, 26 + b, side ? 21 + i : 9 + i * 6 + (step % 2), 31 + b + i, 1.2), g.body.skin, {});   // trailing wraps
      if (g.hero) {                                                                    // a pharaoh's striped headdress and collar
        const hd = side ? P.mask().poly([[10, cy - 5], [20, cy - 5], [21, cy + 6], [17, cy + 6], [16, cy - 1], [12, cy - 1]]) : P.mask().poly([[10, cy - 5], [22, cy - 5], [24, cy + 7], [20, cy + 7], [19, cy - 1], [13, cy - 1], [12, cy + 7], [8, cy + 7]]);
        P.part(hd, (x, y) => (y % 2 ? GOLDR : R5('#2a50a0')), { sep: true });
        P.part(side ? P.mask().rect(12, 14 + b, 19, 16 + b) : P.mask().rect(10, 14 + b, 22, 16 + b), GOLDR, { spec: true, sep: true });
      }
    }
  }

  // ---------------------------------------------------------------- floaters
  function floaterFrame(g, P, dir, pose, step) {
    const k = g.kind, side = dir === 2, back = dir === 1, atk = pose === 'attack', E = g.E;
    const bob = [0, -1, 0, 1][step] + (atk ? -1 : 0), cx = 16;
    if (k === 'slime') {
      const C = R5(FACTIONS[g.faction] ? mix(FACTIONS[g.faction].main, '#5ac040', 0.5) : '#5ac040', 0.55);
      const rx = atk ? 7 : 9.5 + [0, 1, 0, -0.5][step], ry = atk ? 10.5 : 7 - [0, 1, 0, -0.5][step];
      const m = P.mask().ellipse(cx, 37 - ry, rx, ry); m.rect(cx - rx + 1, 36, cx + rx - 1, 37);
      P.part(m, C, { tex: (x, y) => ((x * 5 + y * 3) % 13 === 0 ? 2 : 0) });
      P.g.set(cx - rx * 0.45, 37 - ry * 1.55, C[4]).set(cx - rx * 0.45 + 1, 37 - ry * 1.55, C[4]).set(cx - rx * 0.45, 37 - ry * 1.55 + 1, C[3]);
      if (!back) for (const ex of side ? [cx - 4] : [cx - 3, cx + 3]) { const ey = 37 - ry * 1.05; P.part(P.mask().ellipse(ex, ey, 1.3, 1.9), DARKS, { flat: true, base: 1 }); P.g.set(ex - 0.5, ey - 1, '#ffffff'); }
      if (!back && atk) P.part(P.mask().ellipse(side ? cx - 4 : cx, 37 - ry * 0.55, 2, 1.4), DARKS, { flat: true });
      return;
    }
    if (k === 'flame') {
      const sway = [0, 1.5, 0, -1.5][step], top = 13 + bob - (atk ? 4 : 0);
      const layer = (scale, ramp0) => {
        const m = P.mask();
        for (let y = top; y <= 36; y++) {
          const t = (y - top) / (36 - top), w = Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.62) * 8 * scale * (atk ? 1.15 : 1);
          const x0 = cx + sway * (1 - t) * 2;
          for (let x = Math.round(x0 - w); x <= Math.round(x0 + w); x++) if (t > (1 - scale) * 0.5 || scale === 1) m.add(x, y);
        }
        m.each((x, y) => { if (y > 34 && (x + step) % 3 === 0) m.del(x, y); });
        return m;
      };
      P.part(layer(1), ['#5a1008', '#a8200c', '#e04a14', '#f07a20', '#ffa040'], { flat: true, base: 2 });
      P.part(layer(0.68), ['#e04a14', '#f07a20', '#ffb030', '#ffd860', '#fff0a0'], { flat: true, base: 2 });
      P.part(layer(0.38), ['#ffd860', '#ffe890', '#fff4c0', '#fffae0', '#ffffff'], { flat: true, base: 2 });
      if (!back) { const ey = 27 + bob; for (const ex of side ? [cx - 4] : [cx - 3, cx + 3]) { P.g.set(ex, ey, DARKS[0]).set(ex, ey + 1, DARKS[0]); P.g.set(ex + (ex < cx ? -1 : 1), ey - 1, DARKS[1]); }
        P.part(P.mask().ellipse(side ? cx - 4 : cx, ey + 4, atk ? 2 : 1.4, atk ? 1.6 : 0.8), DARKS, { flat: true }); }
      for (let i = 0; i < 4; i++) P.g.set(cx - 6 + i * 4 + (step % 2), 10 + ((i * 7 + step * 3) % 6) + bob, i % 2 ? '#ffd860' : '#ff7a20');
      return;
    }
    if (k === 'ghost') {
      const C = R5('#5ab8a8', 0.5), sway = [0, 1, 0, -1][step];
      const m = P.mask().ellipse(cx, 16 + bob, 6.2, 6.4);
      for (let y = 16; y <= 36; y++) { const t = (y - 16) / 20, w = 6.2 + t * 4, x0 = cx + sway * t * 2; for (let x = Math.round(x0 - w); x <= Math.round(x0 + w); x++) m.add(x, y + bob); }
      m.each((x, y) => { if (y > 31 + bob && ((x + step) % 4 === 0 || (x + step) % 4 === 1) && y > 33 + bob) m.del(x, y); });
      P.part(m, C, { tex: (x, y) => ((x * 3 + y) % 9 === 0 ? 1 : 0) });
      // arms reaching out
      const reach = atk ? 4 : 0;
      if (side) P.part(P.mask().capsule(13, 22 + bob, 6 - reach, 24 + bob - (step % 2), 2.6), C, { sep: true });
      else for (const f of [-1, 1]) P.part(P.mask().capsule(cx + 5 * f, 21 + bob, cx + (9 + reach * 0.5) * f, 27 + bob - reach, 2.6), C, { sep: true });
      if (!back) {
        for (const ex of side ? [cx - 3.5] : [cx - 2.5, cx + 2.5]) { P.part(P.mask().ellipse(ex, 15 + bob, 1.5, 2.1), DARKS, { flat: true, base: 1 }); P.g.set(ex, 15 + bob, E[2]); }
        P.part(P.mask().ellipse(side ? cx - 3 : cx, 20 + bob, atk ? 1.8 : 1.2, atk ? 2 : 1.3), DARKS, { flat: true, base: 1 });
      }
      return;
    }
    if (k === 'frosteye' || k === 'crystaleye') {
      const F = k === 'frosteye', cyy = 25 + bob;
      if (F) {
        P.part(P.mask().ellipse(cx, cyy, 7.5, 7.2), R5('#e8f0f8', 0.4), {});
        for (const [a, l] of [[2.6, 6], [3.4, 5], [0.4, 6]]) P.g.line(cx + Math.cos(a) * 7, cyy + Math.sin(a) * 7, cx + Math.cos(a) * (7 - l), cyy + Math.sin(a) * (7 - l), '#d06070');   // veins
      } else {
        const m = P.mask().poly([[cx, cyy - 11], [cx + 8, cyy], [cx, cyy + 11], [cx - 8, cyy]]);
        P.part(m, (x, y) => (x < cx ? (y < cyy ? R5('#f0a0e0', 0.4) : R5('#c060c0')) : (y < cyy ? R5('#a0e0f0', 0.4) : R5('#6080c0'))), { flat: true, base: 2 });
      }
      if (!back) {
        const ix = side ? cx - 3 : cx, glowing = atk;
        P.part(P.mask().ellipse(ix, cyy, F ? 3.4 : 3, F ? 3.4 : 2.6), F ? R5('#40a0e0') : R5('#ffffff', 0.2), { flat: true, base: glowing ? 3 : 2 });
        P.part(P.mask().ellipse(ix, cyy, 1.6, 1.6), F ? DARKS : R5('#c02080'), { flat: true, base: 1 });
        P.g.set(ix - 1, cyy - 1, '#ffffff');
      } else if (F) P.part(P.mask().capsule(cx, cyy + 6, cx + (step % 2 ? 1 : -1), cyy + 11, 1.4), R5('#d06070'), {});   // the nerve trails behind
      for (let i = 0; i < 4; i++) {                                                     // orbiting shards
        const a = (i / 4 + step / 16) * Math.PI * 2, d = atk ? 13 : 11, sx = cx + Math.cos(a) * d, sy = cyy + Math.sin(a) * d * 0.45;
        P.part(P.mask().poly([[sx, sy - 2.5], [sx + 1.3, sy], [sx, sy + 2.5], [sx - 1.3, sy]]), F ? R5('#9ae8ff', 0.4) : R5('#e8a0ff', 0.4), { flat: true, base: 3 });
      }
      return;
    }
    if (k === 'firehawk' || k === 'bat') {
      const H = k === 'firehawk';
      const C = H ? R5('#e05a1a') : R5('#3a2a4a', 0.4), M = H ? R5('#ffc040', 0.4) : R5('#5a3a5a', 0.4);
      const flap = atk ? 0 : step, wy = [-9, -2, 5, -2][flap], cyy = 23 + bob;
      // wings: membranes with finger bones (bat) or feathers (hawk)
      const wing = (f) => {
        const sx = cx + 2 * f, tip = [cx + 15 * f, cyy + wy], mid = [cx + 9 * f, cyy + wy * 0.6 - 2];
        const m = P.mask().poly([[sx, cyy - 2], mid, tip, [cx + 12 * f, cyy + 3 + wy * 0.3], [cx + 7 * f, cyy + 1], [cx + 4 * f, cyy + 4]]);
        if (side && f > 0) return;
        P.part(m, C, { sep: true, shade: (x, y) => (y > cyy + 1 ? -1 : 0) });
        if (!H) { P.g.line(sx, cyy - 2, tip[0], tip[1], M[2]); P.g.line(mid[0], mid[1], cx + 12 * f, cyy + 3 + wy * 0.3, M[1]); }
        else for (let i = 0; i < 4; i++) P.g.set(cx + (6 + i * 2.5) * f, cyy + wy * (0.3 + i * 0.15) + 2, M[3]);
      };
      if (!side) { wing(-1); wing(1); } else wing(-1);
      P.part(P.mask().ellipse(cx, cyy + 1, 3.4, 4.4), C, { sep: true });
      const hx = side ? cx - 3 : cx, hy = cyy - 4;
      P.part(P.mask().ellipse(hx, hy, 2.8, 2.6), C, { sep: true });
      if (!H) P.part(P.mask().poly([[hx - 2.5, hy - 1], [hx - 2, hy - 5], [hx - 0.5, hy - 2]]).poly([[hx + 2.5, hy - 1], [hx + 2, hy - 5], [hx + 0.5, hy - 2]]), C, { sep: true });   // ears
      else { P.part(P.mask().poly([[hx - (side ? 3 : 0.8), hy + 1], [hx - (side ? 6 : 0), hy + (side ? 1.5 : 3)], [hx + (side ? -3 : 0.8), hy + 1.5]]), GOLDR, {}); for (let i = 0; i < 5; i++) P.g.set(cx + (side ? 4 + i : (i - 2)), cyy + 6 + i + (step % 2), i % 2 ? '#ffd860' : '#ff7a20'); }   // beak, flame tail
      if (!back) { if (side) P.g.set(hx - 1, hy, E[2]); else P.g.set(hx - 1, hy, E[2]).set(hx + 1, hy, E[2]); }
      if (!H && !back && atk) P.g.set(hx - 1, hy + 2, '#f0f0e0').set(hx + 1, hy + 2, '#f0f0e0');
      return;
    }
  }

  // ---------------------------------------------------------------- crawlers
  function crawlerFrame(g, P, dir, pose, step) {
    const k = g.kind, side = dir === 2, back = dir === 1, atk = pose === 'attack', E = g.E;
    if (k === 'beetle') {
      const C = R5(FACTIONS[g.faction] ? mix(FACTIONS[g.faction].main, '#2a8a5a', 0.4) : '#2a8a5a', 0.6);
      const legs = (far) => { for (let i = 0; i < 3; i++) { const ph = (step + i + (far ? 2 : 0)) % 4, lx = (side ? 12 + i * 6 : 0), sw = [1.5, 0, -1.5, 0][ph];
        if (side) P.part(P.mask().capsule(lx, 31, lx - 2 + sw, 34, 1.6).capsule(lx - 2 + sw, 34, lx - 3 + sw, 37 - (ph === 1 ? 1 : 0), 1.3), far ? DARKS : R5('#2a2a30', 0.4), {}); } };
      if (side) {
        legs(true);
        P.part(P.mask().ellipse(19, 28, 10.5, 6.5).rect(9, 28, 29, 31), C, { spec: true });
        P.g.line(19, 22, 19, 31, C[0]);
        P.part(P.mask().ellipse(8, 30, 3.4, 3), R5('#2a2a30', 0.4), { sep: true });
        P.part(P.mask().capsule(7, 29, atk ? 1 : 3, atk ? 26 : 22, 1.8).capsule(atk ? 1 : 3, atk ? 26 : 22, atk ? 0 : 4, atk ? 23 : 19, 1.3), R5('#2a2a30', 0.4), { sep: true });
        P.g.set(7, 29, E[2]);
        legs(false);
      } else {
        for (let i = 0; i < 3; i++) for (const f of [-1, 1]) { const ph = (step + i + (f > 0 ? 2 : 0)) % 4, up = ph === 1 ? 1 : 0; P.part(P.mask().capsule(16 + 7 * f, 26 + i * 3, 16 + 12 * f, 31 + i * 2 - up, 1.6), DARKS, {}); }
        P.part(P.mask().ellipse(16, 27, 9.5, 8), C, { spec: true });
        P.g.vline(16, 20, 34, C[0]);
        if (!back) { P.part(P.mask().ellipse(16, 34, 3.6, 2.8), R5('#2a2a30', 0.4), { sep: true }); P.part(P.mask().capsule(16, 33, 16, atk ? 22 : 25, 2.2), R5('#2a2a30', 0.4), { sep: true }); P.g.set(14, 35, E[2]).set(18, 35, E[2]); }
      }
      return;
    }
    if (k === 'crab') {
      const C = R5(FACTIONS[g.faction] ? mix(FACTIONS[g.faction].main, '#d05a2a', 0.5) : '#d05a2a', 0.6);
      const up = atk ? 9 : [0, 1, 0, 1][step];
      if (side) {
        for (let i = 0; i < 3; i++) { const ph = (step + i) % 2; P.part(P.mask().capsule(14 + i * 4, 31, 12 + i * 4 - ph, 37, 1.4), C.map((c, j) => C[Math.max(0, j - 1)]), {}); }
        P.part(P.mask().ellipse(18, 28, 9, 6), C, { spec: true });
        P.part(P.mask().capsule(12, 28, 6, 26 - up, 2.2).ellipse(4, 24 - up, 4, 3.2), C, { sep: true });
        P.g.set(1, 24 - up, DARKS[0]).set(2, 24 - up, DARKS[0]);
        P.part(P.mask().capsule(12, 23, 11, 19, 1).ellipse(11, 18.5, 1.3, 1.3), C, {}); P.g.set(10, 18, DARKS[0]);
      } else {
        for (let i = 0; i < 3; i++) for (const f of [-1, 1]) { const ph = (step + i + (f > 0 ? 1 : 0)) % 2; P.part(P.mask().capsule(16 + 7 * f, 29 + i, 16 + 13 * f, 35 + i - ph, 1.4), C.map((c, j) => C[Math.max(0, j - 1)]), {}); }
        P.part(P.mask().ellipse(16, 28, 10.5, 6.5), C, { spec: true });
        for (const f of [-1, 1]) {
          P.part(P.mask().capsule(16 + 7 * f, 27, 16 + 11 * f, 24 - up, 2.4), C, { sep: true });
          P.part(P.mask().ellipse(16 + 12 * f, 21 - up, 3.6, 4).poly([[16 + 12 * f, 16 - up], [16 + 14 * f, 15 - up], [16 + 13 * f, 19 - up]]), C, { sep: true });
          P.g.vline(16 + 12 * f, 17 - up, 21 - up, DARKS[0]);
        }
        if (!back) for (const f of [-1, 1]) { P.part(P.mask().capsule(16 + 3 * f, 24, 16 + 3.5 * f, 19, 1).ellipse(16 + 3.5 * f, 18.5, 1.4, 1.4), C, {}); P.g.set(16 + 3.5 * f, 18, DARKS[0]); }
      }
      return;
    }
  }

  // ---------------------------------------------------------------- machines
  function machineFrame(g, P, dir, pose, step) {
    const k = g.kind, side = dir === 2, back = dir === 1, atk = pose === 'attack';
    const rec = atk ? 2 : 0, spin = step * Math.PI / 4;
    const wheel = (x, y, r0, front) => {
      if (front) { P.part(P.mask().ellipse(x, y, 1.8, r0), WOODR, { sep: true }); return; }
      P.part(P.mask().ellipse(x, y, r0, r0), WOODR, { sep: true });
      P.part(P.mask().ellipse(x, y, r0 - 1.6, r0 - 1.6), ['#2a1a10', '#3a2818', '#4a3420', '#5a4028'], { flat: true });
      for (let i = 0; i < 4; i++) { const a = spin + i * Math.PI / 4; P.g.line(x - Math.cos(a) * (r0 - 1.5), y - Math.sin(a) * (r0 - 1.5), x + Math.cos(a) * (r0 - 1.5), y + Math.sin(a) * (r0 - 1.5), WOODR[3]); }
      P.part(P.mask().ellipse(x, y, 1.3, 1.3), STEEL, { spec: true });
    };
    const flag = (x, y) => { P.part(P.mask().rect(x, y - 9, x, y), WOODR, {}); P.part(P.mask().poly([[x + 1, y - 9], [x + 6, y - 7.5], [x + 1, y - 6]]), g.fc, { flat: true }); };
    if (k === 'cannon' || k === 'firecannon' || k === 'suncannon') {
      const BR = k === 'suncannon' ? GOLDR : k === 'firecannon' ? R5('#5a3a3a', 0.5) : R5('#b07a40', 0.55);
      if (side) {
        flag(27, 30);
        P.part(P.mask().poly([[14, 29], [32, 33], [31, 36], [14, 32]]), WOODR, { sep: true });               // trail
        const m = P.mask().capsule(3 + rec, 24, 22 + rec, 21, 5.5).ellipse(23.5 + rec, 21, 2.2, 2.2);
        P.part(m, BR, { spec: true, sep: true });
        for (const x of [8, 14, 19]) P.g.line(x + rec, 21.5 - (x - 3) * 0.16, x + rec, 26.5 - (x - 3) * 0.16, BR[1]);
        if (k === 'firecannon') {                                                     // a dragon's head for a muzzle
          P.part(P.mask().poly([[0 + rec, 20], [6 + rec, 19], [6 + rec, 28], [0 + rec, 27], [-3 + rec, 24]]), R5('#a02020'), { sep: true });
          P.g.set(3 + rec, 20, '#ffd040'); for (let i = 0; i < 3; i++) P.g.set(-2 + rec + i * 2, 27, '#f0f0e0');
        } else P.part(P.mask().ellipse(3 + rec, 24, 1.6, 3.4), BR, { spec: true, sep: true });
        if (k === 'suncannon') { P.part(P.mask().ellipse(13 + rec, 22.5, 2.2, 2.2), R5('#fff0a0', 0.3), { flat: true, base: 3 }); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; P.g.set(13 + rec + Math.cos(a) * 3.5, 22.5 + Math.sin(a) * 3.5, GOLDR[4]); } }
        wheel(16, 31, 6.2);
        if (atk) {
          for (let i = 0; i < 10; i++) { const a = Math.PI + (i - 4.5) * 0.18, d = 3 + (i % 3) * 2; P.g.set(-1 + Math.cos(a) * d, 23 + Math.sin(a) * d, i % 2 ? '#fff0a0' : '#ffb030'); }
          P.part(P.mask().ellipse(-4, 20, 3, 2.4).ellipse(-1, 17, 2.4, 2), ['#5a5450', '#7a7470', '#a09a96', '#c8c4c0', '#e8e4e0'], { flat: true, base: 2 });
        }
      } else {
        flag(back ? 9 : 22, 24);
        wheel(5, 29, 6.2, true); wheel(27, 29, 6.2, true);
        P.part(P.mask().rect(6, 27, 26, 30), WOODR, { sep: true });
        P.part(P.mask().ellipse(16, 24 - rec, 5, 5), BR, { spec: true, sep: true });
        if (!back) { P.part(P.mask().ellipse(16, 24 - rec, 2.6, 2.6), DARKS, { flat: true }); if (atk) for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; P.g.set(16 + Math.cos(a) * 6, 24 - rec + Math.sin(a) * 6, i % 2 ? '#fff0a0' : '#ffb030'); } }
        else { P.part(P.mask().ellipse(16, 24, 2, 2), BR, { spec: true }); P.part(P.mask().rect(14, 30, 18, 36), WOODR, { sep: true }); }
        if (k === 'firecannon' && !back) { P.g.set(13, 20 - rec, '#ffd040').set(19, 20 - rec, '#ffd040'); for (let i = 0; i < 4; i++) P.g.set(13 + i * 2, 28 - rec, '#f0f0e0'); }
      }
      return;
    }
    if (k === 'mortar') {
      // a squat wooden mortar wrapped in vines, walking on its roots
      const lift = step % 2;
      for (let i = 0; i < 4; i++) { const x = (side ? 10 : 9) + i * 4, ph = (step + i) % 2; P.part(P.mask().capsule(x + 1, 31, x - 1 + ph, 37 - (ph && lift ? 1 : 0), 1.6), R5('#5a3a1a'), {}); }
      const ang = side ? -0.95 : -Math.PI / 2, bx = 16, by = 29;
      const m = side ? P.mask().capsule(bx, by, bx + Math.cos(ang) * 10, by + Math.sin(ang) * 10, 8.5) : P.mask().ellipse(16, 25, 7, 8);
      P.part(m, WOODR, { sep: true, tex: (x) => (x % 3 === 0 ? -1 : 0) });
      const mx = side ? bx + Math.cos(ang) * 10 : 16, my = side ? by + Math.sin(ang) * 10 : 21;
      P.part(P.mask().ellipse(mx, my, side ? 3.8 : 4.6, side ? 2.8 : 3.4), back ? WOODR : ['#1a1208', '#2a1e10', '#3a2a18', '#4a3620'], { flat: true });
      if (!back && !atk) P.part(P.mask().ellipse(mx, my - 1, 2.2, 2), R5('#8aa040'), {});           // a seed pod ready
      const vine = R5('#3a7a2a'); for (let i = 0; i < 6; i++) { const a = i * 1.1, vx = 16 + Math.cos(a) * 7, vy = 26 + Math.sin(a) * 4; P.part(P.mask().ellipse(vx, vy, 1.8, 1.2), vine, {}); }
      if (atk) { P.part(P.mask().ellipse(mx + (side ? -3 : 0), my - 7, 2.2, 2), R5('#8aa040'), { sep: true }); for (let i = 0; i < 8; i++) P.g.set(mx - 4 + i, my - 2 - (i % 3), i % 2 ? '#c8e070' : '#8aa040'); }
      return;
    }
    if (k === 'catapult') {
      const COR = R5('#e87a8a', 0.5), throwA = atk ? -0.3 : -2.4 + (step % 2) * 0.05;
      if (side) {
        flag(29, 30);
        P.part(P.mask().rect(5, 28, 29, 31), COR, { sep: true, tex: (x) => (x % 4 === 0 ? -1 : 0) });
        P.part(P.mask().poly([[13, 29], [16, 17], [19, 29]]), COR, { sep: true });
        const ax = 16, ay = 19, ex = ax + Math.cos(throwA) * 14, ey = ay + Math.sin(throwA) * 14;
        P.part(P.mask().capsule(ax, ay, ex, ey, 2), COR, { sep: true });
        P.part(P.mask().ellipse(ex, ey, 3, 2.4), ramp('#f0e0c8', 5, 0.4), { sep: true });                 // shell bucket
        if (!atk) P.part(P.mask().ellipse(ex, ey - 2, 2, 2), R5('#40c0e0', 0.4), { flat: true, base: 3 });
        else P.part(P.mask().ellipse(ex - 4, ey - 6, 2.2, 2.2), R5('#40c0e0', 0.4), { flat: true, base: 3 });
        wheel(9, 32, 4.6); wheel(25, 32, 4.6);
      } else {
        flag(back ? 7 : 24, 26);
        wheel(5, 31, 4.6, true); wheel(27, 31, 4.6, true);
        P.part(P.mask().rect(6, 28, 26, 31), COR, { sep: true });
        P.part(P.mask().rect(10, 14, 12, 29).rect(20, 14, 22, 29).rect(10, 14, 22, 15), COR, { sep: true });
        const ey = atk ? 6 : 24;
        P.part(P.mask().capsule(16, 22, 16, ey, 2), COR, { sep: true });
        P.part(P.mask().ellipse(16, ey, 3, 2.4), ramp('#f0e0c8', 5, 0.4), { sep: true });
        if (!atk) P.part(P.mask().ellipse(16, ey - 2, 2, 2), R5('#40c0e0', 0.4), { flat: true, base: 3 });
      }
      return;
    }
  }

  // ---------------------------------------------------------------- frames, regalia, aura
  function regalia(g, P, dir, b, topY) {
    if (!g.hero || g.kind === 'mummy') return;                    // the mummy wears a pharaoh's headdress instead
    const cx = dir === 2 ? 15.5 : 16, y = topY;
    if (g.crown === 'crown') { const m = P.mask().rect(cx - 4, y, cx + 4, y + 2); for (let i = 0; i < 5; i++) m.add(cx - 4 + i * 2, y - 1).add(cx - 4 + i * 2, y - 2); P.part(m, GOLDR, { spec: true, sep: true }); P.g.set(cx, y + 1, g.glow); }
    else if (g.crown === 'horns') for (const f of dir === 2 ? [1] : [-1, 1]) P.part(P.mask().capsule(cx + 3 * f, y + 2, cx + 6 * f, y - 2, 1.8).capsule(cx + 6 * f, y - 2, cx + 5 * f, y - 5, 1.2), ['#1a1414', '#2a2222', '#4a3a3a', '#6a5a5a', '#8a7a7a'], { sep: true });
    else { for (let x = cx - 4; x <= cx + 4; x++) P.g.set(x, y + 1, GOLDR[3]); P.g.set(cx, y + 1, g.glow).set(cx, y, g.E[3]); }
  }
  function topOf(g, b) {
    const k = g.kind;
    if (g.K.body === 'walker') return (k === 'yeti' || k === 'mudbrute' ? 7 : k === 'fishfolk' ? -1 : k === 'frogman' ? 3 : k === 'bogshaman' ? -2 : 1) + b;
    return { slime: 21, flame: 8, ghost: 8, frosteye: 15, crystaleye: 11, firehawk: 14, bat: 13, beetle: 19, crab: 19 }[k] || 6;
  }
  function frame(g, dir, pose, step) {
    const OX = 8, OY = 8, out = new Grid(48, 48), back = dir === 1;
    const b = pose === 'walk' && step % 2 === 1 ? -1 : 0;
    if (g.K.body === 'walker') {
      const body = soldierFrame(g.body, dir, pose, step);
      const F = new Painter(48, 48, OX, OY);
      walkerFront(g, F, dir, pose, step, b);
      regalia(g, F, dir, b, topOf(g, b));
      let fg = F.done();
      if (back) fg = fg.flipX();
      out.blit(body, OX, OY); out.blit(fg);
    } else {
      const P = new Painter(48, 48, OX, OY);
      const d = back ? 0 : dir;                                       // backs are drawn as fronts without faces, then mirrored
      (g.K.body === 'floater' ? floaterFrame : g.K.body === 'crawler' ? crawlerFrame : machineFrame)(g, P, back ? 1 : d, pose, step);
      if (g.K.body !== 'machine') regalia(g, P, dir, 0, topOf(g, 0) + (g.K.body === 'floater' ? [0, -1, 0, 1][step] : 0));
      out.blit(back ? P.done().flipX() : P.done());
    }
    if (g.hero) {                                                     // a monster general's aura
      const k = pack(INK), src = out.copy();
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        if (src.filled(x, y)) continue;
        if (src.get(x - 1, y) === k || src.get(x + 1, y) === k || src.get(x, y - 1) === k || src.get(x, y + 1) === k) out.set(x, y, (x + y + step) % 3 === 0 ? g.E[4] : g.glow, 230);
      }
    }
    return out;
  }
  // What a creature leaves behind: its body flattened on a pool (or a scatter of bones, or a wreck).
  function remains(g) {
    const r = R.make(g.seed, 'remains'), out = new Grid(48, 48), fl = FLUIDS[g.K.fluid];
    const src = frame(Object.assign({}, g, { hero: false }), 0, 'walk', 0);
    if (fl) out.each((x, y) => { const d = Math.hypot((x - 24) / 16, (y - 38) / 6.5) + (r() - 0.5) * 0.15; return d < 1 ? (d < 0.55 ? fl[1] : d < 0.8 ? fl[2] : dither(x, y, (1 - d) * 5) ? fl[3] : undefined) : undefined; });
    if (g.K.fluid === 'bones') {
      for (let i = 0; i < 7; i++) { const x = r.int(12, 34), y = r.int(34, 42), a = r() * Math.PI; out.line(x, y, x + Math.cos(a) * 4, y + Math.sin(a) * 2, BONER[3]); out.set(x, y, BONER[4]); }
      out.set(22, 37, BONER[3]).set(23, 37, BONER[3]).set(22, 38, DARKS[0]).set(24, 38, BONER[2]);
      out.outline(INK); return out;
    }
    if (['ash', 'ecto', 'shards'].includes(g.K.fluid)) return out;
    let x0 = 48, y0 = 48, x1 = 0, y1 = 0;
    src.each((x, y, v) => { if (v & 255) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
    const h = y1 - y0 + 1, flat = 0.45;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const v = src.get(x, y); if (!(v & 255)) continue;
      const ty = Math.round(41 - (y1 - y) * flat), tx = Math.round(24 + (x - (x0 + x1) / 2) * (g.K.body === 'machine' ? 1 : 1.1));
      const cR = (v >>> 24) & 255, cG = (v >>> 16) & 255, cB = (v >>> 8) & 255;
      out.set(tx, ty, rgbHex(cR * 0.8, cG * 0.8, cB * 0.8));
    }
    if (g.K.fluid === 'wreck') for (let i = 0; i < 6; i++) out.set(r.int(14, 34), r.int(24, 34), i % 2 ? '#5a5450' : '#7a7470');   // smoke
    return out;
  }

  function genCreature(o) {
    const g = genome(o);
    const sheet = new Grid(192, 288);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) {
      const pose = row === 4 ? 'attack' : 'walk';
      const fr = col === 3 ? frame(g, 2, pose, row % 4).flipX() : frame(g, col, pose, row % 4);
      sheet.blit(fr, col * 48, row * 48);
    }
    sheet.blit(remains(g), 0, 240);
    const tracks = [0, 1, 2, 3].map(c => [0, 1, 2, 3].map(r => ({ x: c * 48, y: r * 48 })));
    tracks.push([0, 1, 2, 3].map(c => ({ x: c * 48, y: 192 })));
    tracks.push([{ x: 0, y: 240 }]);
    return { img: sheet, anim: { fw: 48, fh: 48, fps: 7, tracks, labels: ['front', 'back', 'left', 'right', 'attack', 'remains'] },
      name: `creature-${g.kind}${g.hero ? '-general' : ''}`, scale: g.K.scale * (g.hero ? 1.2 : 1), glow: g.glow };
  }

  // A portrait for a monster general: the front frame's upper half, doubled, on a vignette lit by its glow.
  function genCreatureFace(o) {
    const g = genome(Object.assign({}, o, { hero: 'yes' }));
    const fr = frame(g, 0, 'walk', 0), W = 64, out = new Grid(W, W);
    const BGR = ramp(mix(g.glow, '#0c0a14', 0.72), 5, 0.5);
    out.each((x, y) => rampAt(BGR, 0.85 - Math.hypot(x - 32, (y - 26) * 1.1) / 44 * 0.9, x, y));
    let x0 = 48, y0 = 48, x1 = 0, y1 = 0;
    fr.each((x, y, v) => { if (v & 255) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
    const cx = Math.round((x0 + x1) / 2), size = 30, sx = cx - 15, sy = Math.max(0, y0 - 1);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = fr.get(sx + x, sy + y); if (!(v & 255)) continue;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) out.p[(4 + y * 2 + j) * W + 2 + x * 2 + i] = v;
    }
    for (let i = 0; i < W; i++) { out.set(i, 0, INK).set(i, W - 1, INK).set(0, i, INK).set(W - 1, i, INK); out.set(i, 1, g.GL[1]).set(1, i, g.GL[1]); }
    return { img: out, anim: { fw: 64, fh: 64, fps: 1, tracks: [[{ x: 0, y: 0 }]] }, name: `creatureface-${g.kind}` };
  }
  const rampAt = PG.rampAt;

  Object.assign(PG.GENERATORS, {
    creature:     { group: 'Medieval 32px', fn: genCreature, label: 'Monster / machine sheet', size: '48 x 48 frames', options: { creature: ['random', ...Object.keys(KINDS)], hero: ['no', 'yes'] } },
    creatureface: { group: 'Medieval 32px', fn: genCreatureFace, label: 'Monster general portrait', size: '64 x 64', options: { creature: ['random', ...Object.keys(KINDS)] } },
  });
  PG.creatures = { KINDS };
})(typeof window !== 'undefined' ? window : globalThis);
