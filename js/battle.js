// =============================================================================
//  BATTLE: real-time fight on a large battlefield with fog of war.
//  side 0 = attacker (starts on the left), side 1 = defender (right).
//  Each general leads a squad. Squads take orders (advance, hold, move, attack,
//  retreat), move in formations, and their heroes cast skills using MP.
//  Units only see (and target) enemies within their side's vision.
//  If a general falls, their squad scatters. The battle ends when one side has
//  nobody left, or the time limit runs out (the defender holds the town).
//  The same code runs "headless" (no drawing) to auto-resolve AI vs AI fights.
//
//  The field is big and seen from high above. Squads stand in ranks (q.files
//  soldiers wide), and can be given a frontage and facing by dragging a line.
//  The ground matters: high ground (terrain heights) lengthens shooters' range and
//  everyone's sight and helps melee downhill; slopes slow climbers; forests hide.
//  Skills are handlers in SKILL_FX (below the class) and can use the squad-level
//  helpers (squadUnits, putSquad, teleportSquad, push, buffSquad) to build new ones.
// =============================================================================
// Battle sprites (32 px figures) are drawn this big in world pixels: 22 = exactly one art pixel
// each (see ART), so they stay on the pixel grid. Generals stand out by plume, cape and size of frame.
const UNIT_SIZE = { soldier: 22, leader: 22 };

class Battle {
  constructor(opts) {
    const B = DATA.battle;
    this.W = B.width; this.H = B.height;
    this.opts = opts;      // { attackers, defenders, attFaction, defFaction, spotName, spotId, playerSide, headless }
    this.factions = [opts.attFaction, opts.defFaction];
    this.playerSide = opts.playerSide === 'att' ? 0 : opts.playerSide === 'def' ? 1 : -1;
    this.headless = !!opts.headless;
    this.fog = !!DATA.battle.fog;
    this.men = opts.men || (this.headless ? 1 : (B.men || 1));   // figures per campaign soldier (opts.men: for testing)
    this.stats = { loss: 0, flank: 0, rear: 0, charge: 0, general: 0, hits: 0 };
    this.units = []; this.squads = []; this.projs = []; this.fx = []; this.texts = []; this.dead = []; this.spent = [];
    this.zones = []; this.pending = []; this.custom = {};
    this.time = 0; this.limit = DATA.battleTimeLimit;
    this.done = false; this.banner = null;
    this.xp = {};                            // gid -> XP earned from kills this battle
    this.terrain = new Terrain(opts.spotId, this.W, this.H);
    // spacing between men: the wide, tall-figure spacing only matters to the eye, so auto-resolved
    // battles (nothing drawn) keep the tight spacing their balance was tuned with
    this.spacing = this.men > 1 ? B.spacing : B.spacingAuto; this.spacingY = this.men > 1 ? B.spacingY : 1;
    if (this.terrain.walls) for (const g of this.terrain.gates)          // gates are tougher in big battles (more men batter them)
      g.hp = g.maxHp = B.gate.hp * (this.men > 1 ? B.gate.menMul : 1) * DATA.sites[this.terrain.site].gateHp;
    this.boosts = opts.boosts || [null, null];   // landmark powers for each side: { unit, k, L } or null
    this.placeSquads(opts.attackers, 0);
    this.placeSquads(opts.defenders, 1);
    // where each side expects to find the enemy before it has seen them
    this.home = [0, 1].map(s => centroid(this.squads.filter(q => q.side === s).map(q => q.leader)));
    this.lastSeen = [null, null];
    this.sizeUp();                           // who sees whom from the start (the battle opens paused: show the enemy)
    this.lastSeen = [null, null];
    this.paused = !this.headless && this.playerSide >= 0;     // the player starts paused to give orders
    this.sel = new Set();                                      // selected squads (player side)
    this.formation = 'auto';
    if (!this.headless) {
      const FC = 16;
      this.fogC = FC; this.fw = Math.ceil(this.W / FC); this.fh = Math.ceil(this.H / FC);
      this.explored = new Uint8Array(this.fw * this.fh); this.visible = new Uint8Array(this.fw * this.fh);
      this.fogLit = new Float32Array(this.fw * this.fh); this.exploredSoft = new Float32Array(this.fw * this.fh);
      this.fogCanvas = document.createElement('canvas'); this.fogCanvas.width = this.fw; this.fogCanvas.height = this.fh;
      const me = this.home[Math.max(0, this.playerSide)];
      this.cam = { x: me.x + (this.playerSide === 1 ? -260 : 260), y: me.y, z: ART / (window.devicePixelRatio || 1) };   // opens at one screen pixel per art pixel (crisp)
      this.bg = this.buildBackground();
      this.updateFog();
      // announce landmark powers at the start
      const lines = [0, 1].map(s => this.boosts[s] && this.boosts[s].k > 0 && this.units.some(u => u.side === s && u.empowered)
        ? `${this.boosts[s].L.name}: ${DATA.plural(DATA.units[this.boosts[s].unit].name)} empowered (${Math.round(this.boosts[s].k * 100)}%)` : null).filter(Boolean);
      if (lines.length) this.banner = { text: lines.join('   |   '), t: 5, side: -1, power: true };
    }
  }

  // ------------------------------------------------------------------ setup
  // Frontline squads deploy in front, backline squads behind, side by side with a
  // gap. Wall defenders deploy inside their town; their backline right behind the
  // wall to shoot over it. Computer-led armies look for the best high ground near
  // their deployment area (the player can move theirs before unpausing).
  placeSquads(gens, side) {
    const W = this.W, H = this.H, T = this.terrain, gap = DATA.battle.squadGap * 1.6;
    const rowOf = g => g.row || DATA.roleOf(g.id);       // the formation screen's choice, or by class
    const face = side === 0 ? 1 : -1;
    const made = gens.map(g => this.makeSquad(g, side, rowOf(g), face));
    const front = made.filter(q => q.row === 'front'), back = made.filter(q => q.row === 'back');
    const walled = side === 1 && T.walls;
    if (walled) { this.placeInTown(front, back); return; }
    // the back row stands far enough behind the front row that the blocks don't overlap
    const S = this.spacing, dep = (q, n) => n ? 12 + this.blockShape(n, q.files).depth * S : 0;
    const rear = Math.max(0, ...front.map(q => dep(q, q.nBack))), ahead = Math.max(0, ...back.map(q => dep(q, q.nFront)));
    const rows = [[front, 360], [back, Math.min(265, 360 - rear - ahead - 20)]].filter(r => r[0].length);
    // where every squad would stand for a given sideways shift / forward step
    const layout = (shift, step) => {
      const out = [];
      for (const [list, depth] of rows) {
        const ws = list.map(q => this.squadWidth(q) * this.spacingY), total = ws.reduce((a, b) => a + b, 0);
        const g = Math.max(10, Math.min(gap, (H - 140 - total) / Math.max(1, list.length - 1)));
        let y = H / 2 + shift - (total + g * (list.length - 1)) / 2;
        list.forEach((q, i) => {
          const x = side === 0 ? depth + step : W - depth - step;
          out.push({ q, x, y: clamp(y + ws[i] / 2, 60, H - 60) }); y += ws[i] + g;
        });
      }
      return out;
    };
    let best = layout(0, 0);
    if (side !== this.playerSide) {                      // seek high ground (backline counts most)
      let bs = -1e9;
      for (let shift = -360; shift <= 360; shift += 60) for (const step of [0, 90, 180]) {
        const L = layout(shift, step);
        const sc = L.reduce((a, p) => a + T.heightAt(p.x, p.y) * (p.q.row === 'back' ? 1.5 : 1) - (T.passable(p.x, p.y) ? 0 : 2), 0) / L.length
          - Math.abs(shift) / 3000 - step / 2000;
        if (sc > bs) { bs = sc; best = L; }
      }
    }
    for (const p of best) { this.putSquad(p.q, p.x, p.y); this.squads.push(p.q); }
  }
  // Defenders of a walled town: the backline mans the walls beside each gate (on the
  // wall-walk, facing out, so they shoot over the wall from high ground), then the walls
  // near the attackers' side; the frontline stands just inside each gate, ready for
  // whoever breaks in; anyone left over waits in the market square. Each squad
  // remembers its post (computer defenders go back to it once the town is clear).
  placeInTown(front, back) {
    const T = this.terrain, t = T.town, w = t.wall, ix0 = t.x0 + w, iy0 = t.y0 + w, ix1 = t.x1 - w, iy1 = t.y1 - w;
    const S = this.spacing;
    const gates = T.gates.slice().sort((a, b) => 'wnse'.indexOf(a.side) - 'wnse'.indexOf(b.side));
    // posts on the wall-walk beside each gate: the block's frontage runs along the wall, from
    // just past the gateway to short of the corner, so each wall holds one block a side
    const walls = [];
    for (const g of gates) for (const s of [-1, 1]) {
      const len = (g.nx ? (iy1 - iy0) : (ix1 - ix0)) / 2 - g.half - 50;                 // room along the wall
      walls.push({ g, s, len, face: [g.nx, g.ny] });
    }
    for (const [x, y, f, len] of [[ix0 + 34, (iy0 + iy1) / 2, [-1, 0], (iy1 - iy0) - 60], [(ix0 + ix1) / 2, iy0 + 34, [0, -1], ix1 - ix0 - 60], [(ix0 + ix1) / 2, iy1 - 34, [0, 1], ix1 - ix0 - 60]])
      walls.push({ p: [x, y], len, face: f });
    // anywhere else inside: a fine grid of spots, tried nearest first to where the block is wanted
    const grid = [];
    for (let y = iy0 + 40; y <= iy1 - 40; y += 20) for (let x = ix0 + 40; x <= ix1 - 40; x += 20) grid.push([x, y]);
    const near = (x, y, face) => grid.slice().sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y)).map(p => ({ p, face, len: 170 }));
    const used = [];                                                     // [x0, y0, x1, y1] of each placed block
    // the block's men stand from `behind` the general to `ahead` of him (all in front when it has no backline)
    const reach = q => { const d = n => n ? 12 + this.blockShape(n, q.files).depth * S : 0; return [d(q.nFront), d(q.nBack)]; };
    // the box a block fills with its centre at (x, y), and where its general then stands
    const boxOf = (q, x, y, face) => {
      const [ahead, behind] = reach(q), k = this.spacingY;
      const hw = this.stretch(this.squadWidth(q), -face[1], face[0]) / 2 + 8, hd = (ahead + behind) / 2 * Math.hypot(face[0], face[1] * k) + 8;
      const ex = Math.abs(face[0]) > 0.5 ? hd : hw, ey = Math.abs(face[0]) > 0.5 ? hw : hd;
      const off = (ahead - behind) / 2;
      return { box: [x - ex, y - ey, x + ex, y + ey], lead: [x - face[0] * off, y - face[1] * off * k] };
    };
    const overlap = r => used.reduce((a, u) => a + Math.max(0, Math.min(r[2], u[2]) - Math.max(r[0], u[0])) * Math.max(0, Math.min(r[3], u[3]) - Math.max(r[1], u[1])), 0);
    const fit = (q, c) => {                                              // ranks thin enough for the post, then where it stands
      const k = Math.hypot(-c.face[1], c.face[0] * this.spacingY);
      q.files = Math.max(3, Math.min(this.blockShape(this.squadN(q)).files, Math.floor(c.len / (S * k))));
      if (!c.g) return c.p;
      const half = this.stretch(this.squadWidth(q), -c.face[1], c.face[0]) / 2;
      const [ahead, behind] = reach(q);
      return T.gatePoint(c.g, -(w / 2 + 10 + (ahead + behind) / 2), c.s * (c.g.half + 14 + half));
    };
    const put = (q, list) => {
      let best = null, bo = Infinity;                                    // the first clear spot, or else the least crowded
      for (const c of list) {
        const at = fit(q, c), { box, lead } = boxOf(q, at[0], at[1], c.face);
        if (box[0] < ix0 - 2 || box[2] > ix1 + 2 || box[1] < iy0 - 2 || box[3] > iy1 + 2) continue;
        const o = overlap(box);
        if (o < bo) { bo = o; best = { lead, face: c.face, box, files: q.files }; if (!o) break; }
      }
      if (!best) best = { lead: [t.cx, t.cy], face: [-1, 0], box: null, files: 0 };
      q.files = best.files; if (best.box) used.push(best.box);
      const p = best.lead, face = best.face;
      q.post = { x: p[0], y: p[1], face };
      this.putSquad(q, p[0], p[1], face);
      this.squads.push(q);
    };
    for (const q of back) put(q, walls.concat(near(ix0 + 60, (iy0 + iy1) / 2, [-1, 0])));
    front.forEach((q, i) => {                                            // one just inside each gate, facing it; the rest back in the square
      if (i >= gates.length) return put(q, near(t.cx + 70, t.cy, [-1, 0]));
      const g = gates[i], [x, y] = T.gatePoint(g, -(w / 2 + 150), 0);
      put(q, near(x, y, [g.nx, g.ny]));
    });
  }


  // A general's squad: the hero and their men (placed later by putSquad). In a live
  // battle each campaign soldier takes the field as `this.men` men.
  makeSquad(g, side, row, faceX) {
    const sq = {
      id: g.id, side, members: [], order: side === 1 ? 'hold' : 'advance', tx: 0, ty: 0,
      face: [faceX, 0], faceEnd: [faceX, 0], files: 0, auto: true, cd: {}, castT: Math.random(), skills: DATA.skillsOf(g.id).slice(),
      back: DATA.roleOf(g.id) === 'back', row, level: g.level || 1, chargeT: -99, charging: false, rankT: 0,
    };
    const L = DATA.battle.mp;
    sq.maxMp = L.base + L.perLevel * sq.level; sq.mp = sq.maxMp * L.start;
    // signature abilities the hero has learned (level 15 and 30)
    (g.sig || []).forEach((s, t) => { if (s && sq.level >= DATA.signature.levels[t]) { this.custom[s.id] = s; sq.skills.push(s.id); } });
    sq.leader = this.makeUnit(g, side, true, 0, 0, null, 1, sq);
    this.units.push(sq.leader);
    const mix = g.mix || [], lv = g.lv || [];
    for (let k = 0; k < g.troops; k++) for (let m = 0; m < this.men; m++) {
      const u = this.makeUnit(g, side, false, 0, 0, mix[k], lv[k] || 1, sq);
      u.slotK = sq.members.length; u.troopK = k;
      sq.members.push(u); this.units.push(u);
    }
    const M = DATA.battle.morale;
    sq.startN = Math.max(1, sq.members.length); sq.morale = Math.min(100, M.start + M.perLevel * (sq.level - 1)); sq.state = 'steady';
    this.rank(sq);
    return sq;
  }

  // ------------------------------------------------------------------ squads
  // Squad-level helpers, for orders and for skills that move whole squads.
  squadUnits(q) { return [q.leader, ...q.members].filter(u => u.alive && !u.escaped && !u.routing); }
  squadCentre(q) { return centroid(this.squadUnits(q)); }
  // Stand the squad at (x, y) in formation, right now (deployment, teleports).
  putSquad(q, x, y, face = q.face) {
    const T = this.terrain;
    q.face = face; q.faceEnd = face;
    [q.leader.x, q.leader.y] = T.nearestOpen(x, y);
    for (const u of q.members) { const [ox, oy] = this.slot(q, u.slotK); [u.x, u.y] = T.nearestOpen(q.leader.x + ox, q.leader.y + oy); }
    q.tx = q.leader.x; q.ty = q.leader.y;
  }
  // Short-range teleport of a whole squad (skills): vanish here, appear there in formation.
  teleportSquad(q, x, y, face = q.face) {
    if (!q.leader.alive) return false;
    const live = this.squadUnits(q);
    for (const u of live) this.addFx('sparkle', u.x, u.y - 8, 0.45);
    [x, y] = this.terrain.nearestOpen(clamp(x, 12, this.W - 12), clamp(y, 20, this.H - 12));
    this.putSquad(q, x, y, face);
    for (const u of live) { u.target = null; u.retarget = 0; u.hitT = 0; this.addFx('sparkle', u.x, u.y - 8, 0.5); }
    q.order = 'hold'; q.target = null;
    return true;
  }
  // Shove a unit (knockbacks): slides it up to `dist` px in direction (dx, dy), stopping at solid ground.
  push(u, dx, dy, dist) {
    const d = Math.hypot(dx, dy) || 1;
    for (let s = 0; s < dist; s += 4) {
      const nx = u.x + dx / d * 4, ny = u.y + dy / d * 4;
      if (!this.terrain.passable(nx, ny)) break;
      u.x = nx; u.y = ny;
    }
  }
  buffSquad(q, buff) { for (const u of this.squadUnits(q)) u.buffs.push({ ...buff }); }

  // Block shape: how many ranks deep and files wide a block of n men stands. By default
  // a squarish block; `files` (a frontage the player drew) fixes the width instead.
  blockShape(n, files = 0) {
    if (files) { const f = Math.max(1, Math.min(files, n)); return { depth: Math.ceil(n / f), files: f }; }
    const depth = Math.max(1, Math.min(8, Math.round(Math.sqrt(n / 2.4))));
    return { depth, files: Math.ceil(n / depth) };
  }
  squadN(sq) { return Math.max(1, sq.nFront || 0, sq.nBack || 0); }
  squadWidth(sq, files = sq.files) { return this.blockShape(this.squadN(sq), files).files * this.spacing; }
  squadDepth(sq, files = sq.files) {
    const S = this.spacing, d = n => n ? this.blockShape(n, files).depth : 0;
    return (d(sq.nFront) + d(sq.nBack)) * S + 24;
  }

  // Where man k stands relative to their general, facing the way the squad faces: a
  // block of ranks, frontline men in front of the general, backline men (archers,
  // casters) behind, each rank a little staggered.
  slot(sq, k, face = sq.face, files = sq.files) {
    const back = sq.backIdx[k] != null;
    const i = (back ? sq.backIdx[k] : sq.frontIdx[k]) ?? 0;
    const n = Math.max(1, back ? sq.nBack : (sq.nFront || sq.nBack)), S = this.spacing;
    const { depth, files: fl } = this.blockShape(n, files);
    const rank = i % depth, file = Math.floor(i / depth);
    const jit = ((k * 37) % 5 - 2) * 0.5;
    const f = back ? -(12 + rank * S) : 12 + (depth - 1 - rank) * S, l = (file - (fl - 1) / 2) * S + (rank % 2) * S * 0.5 + jit;
    const [fx, fy] = face;
    return [fx * f - fy * l, (fy * f + fx * l) * this.spacingY];
  }
  // How long a block's frontage or depth of `len` is along direction (dx, dy) on the field
  // (men stand spacingY times further apart up and down the screen, so tall figures don't hide each other).
  stretch(len, dx, dy) { return len * Math.hypot(dx, dy * this.spacingY); }

  // Number each squad's living soldiers within the front and back ranks (closing gaps as they fall).
  rank(sq) {
    sq.frontIdx = {}; sq.backIdx = {}; let f = 0, b = 0;
    sq.members.forEach((u, k) => { if (!u.alive || u.routing) return; if (u.back) sq.backIdx[k] = b++; else sq.frontIdx[k] = f++; });
    if (!f) { sq.backIdx = {}; b = 0; sq.members.forEach((u, k) => { if (u.alive && !u.routing) sq.frontIdx[k] = b++; }); f = b; b = 0; }
    sq.nFront = f; sq.nBack = b;
  }

  // A soldier of unit type `type` (default: the type the general leads), or the general.
  makeUnit(g, side, isLeader, x, y, type, slv, sq) {
    const key = (!isLeader && type) || DATA.generals[g.id].leads, t = DATA.units[key];
    const pw = this.boosts && this.boosts[side], k = pw && pw.unit === key ? pw.k : 0, P = k ? pw.L : {};   // landmark power
    const L = DATA.leveling, lv = (g.level || 1) - 1;
    const boost = 1 + lv * (isLeader ? L.leaderBonus : L.squadBonus);
    const sb = isLeader ? { hp: 1, atk: 1, def: 0 } : DATA.soldierBoost(slv);       // soldier level and tier
    const big = this.men > 1 ? DATA.battle.menHp : 1;                                // big battles: tougher men, slower grind
    const hp = Math.round((isLeader ? t.hp * 5 * (this.men > 1 ? 3 : 1) : t.hp) * big * boost * sb.hp * (1 + (P.hp || 0) * k) * (isLeader ? DATA.battle.heroHpMul : DATA.battle.hpMul));
    const B = DATA.battle, hits = t.type === 'healer' ? B.hpMul : t.proj ? B.rangedAtkMul : B.atkMul;   // heals keep pace with the extra hp
    const V = DATA.battle.vision;
    return {
      side, gid: g.id, sq, isLeader, t, back: isLeader ? DATA.roleOf(g.id) === 'back' : t.role === 'back',
      heal: t.type === 'healer', cav: t.type === 'cavalry', run: 0,
      sprite: isLeader ? Assets.genSprite(g.id) : Assets.unitSprite(t),
      x, y, hp, maxHp: hp,
      atk: (isLeader ? t.atk * 1.6 : t.atk) * boost * sb.atk * (1 + (P.atk || 0) * k) * hits,
      def: (isLeader ? t.def + 2 : t.def + sb.def) + (P.def || 0) * k,
      empowered: k, splash: (t.splash || 0) * (1 + (P.splash || 0) * k),
      lv: slv, tier: isLeader ? 0 : DATA.tierOf(slv), kills: 0,
      spd: t.spd * B.speedMul, range: t.range * (1 + (P.range || 0) * k) * (t.range > 30 ? B.rangeMul : 1), cd: t.cd * B.cdMul,
      view: (isLeader ? V.hero : V.soldier) + (t.type === 'cavalry' ? V.cavalry : 0) + (t.type === 'shooter' ? V.shooter : 0),
      buffs: [], b: { atk: 1, def: 0, spd: 1, range: 0, view: 0 },
      cdLeft: Math.random() * t.cd, retarget: Math.random() * 0.3,
      target: null, dir: side === 0 ? 3 : 2, walkT: Math.random(), atkT: 0, hitT: 0,
      alive: true, escaped: false, routing: false, routT: 0, seen: [false, false], h: 0, revealT: 0, charging: false, impact: false,
    };
  }

  // ------------------------------------------------------------------ orders
  // Where each squad of a group would stand to make a formation with its front row
  // centred on (x, y): auto (frontline in front, backline behind), line, column or
  // wedge. face: the way they will face (default: from the group towards the spot).
  // width: a frontage drawn by the player, shared out so each squad is that much of
  // it wide (soldiers per rank to match). Returns [{ q, x, y, face, files }].
  planFormation(squads, x, y, formation = this.formation, face = null, width = 0) {
    squads = squads.filter(q => q.leader.alive);
    if (!squads.length) return [];
    const B = DATA.battle, gap = B.squadGap;
    if (!face) {
      const c = centroid(squads.map(q => q.leader));
      const dx = x - c.x, dy = y - c.y, d = Math.hypot(dx, dy);
      face = d < 5 ? squads[0].faceEnd || squads[0].face : [dx / d, dy / d];
    }
    const [dx, dy] = face, px = -dy, py = dx;
    let rows;
    if (formation === 'line') rows = [squads];
    else if (formation === 'column') rows = squads.map(q => [q]);
    else if (formation === 'wedge') { rows = []; let i = 0, n = 1; while (i < squads.length) { rows.push(squads.slice(i, i + n)); i += n; n++; } }
    else rows = [squads.filter(q => q.row !== 'back'), squads.filter(q => q.row === 'back')].filter(r => r.length);
    const files = new Map();
    if (width > 20) {                                        // share the drawn frontage out
      const widest = Math.max(...rows.map(r => r.length)), each = (width - gap * (widest - 1)) / widest;
      for (const q of squads) files.set(q, clamp(Math.round(each / this.stretch(this.spacing, px, py)), 2, 60));
    }
    const fOf = q => files.get(q) || q.files;
    const out = [];
    let back = 0, prevDepth = 0;
    rows.forEach((row, r) => {
      const ws = row.map(q => this.stretch(this.squadWidth(q, fOf(q)), px, py)), total = ws.reduce((a, b) => a + b, 0) + gap * (row.length - 1);
      const depth = Math.max(...row.map(q => this.stretch(this.squadDepth(q, fOf(q)), dx, dy)));
      if (r) back += prevDepth / 2 + depth / 2 + gap * 0.5;
      prevDepth = depth;
      let lat = -total / 2;
      row.forEach((q, i) => {
        const l = lat + ws[i] / 2; lat += ws[i] + gap;
        out.push({ q, face, files: files.get(q) || 0,
          x: clamp(x - dx * back + px * l, 12, this.W - 12), y: clamp(y - dy * back + py * l, 20, this.H - 12) });
      });
    });
    return out;
  }

  // Orders for a group of squads: march (at the slowest squad's pace) to a formation.
  // Squads face the way they march, and turn to the formation's facing as they arrive.
  orderMove(squads, x, y, formation = this.formation, face = null, width = 0) {
    const plan = this.planFormation(squads, x, y, formation, face, width);
    if (!plan.length) return;
    const cap = Math.min(...plan.map(p => p.q.leader.spd));          // the group keeps together
    for (const p of plan) {
      const q = p.q;
      q.order = 'move'; q.target = null; q.cast = null;
      q.tx = p.x; q.ty = p.y; q.faceEnd = p.face; if (p.files) q.files = p.files;
      q.cap = plan.length > 1 ? cap : 0;
    }
  }

  orderAttack(squads, enemy) {
    for (const q of squads) if (q.leader.alive) { q.order = 'attack'; q.target = enemy; q.cast = null; }
  }

  orderSet(squads, order) {
    for (const q of squads) if (q.leader.alive) {
      q.order = order; q.target = null; q.cast = null;
      if (order === 'hold') { q.tx = q.leader.x; q.ty = q.leader.y; q.face = q.faceEnd = q.face; }
    }
  }

  // The computer's squads: attackers advance; defenders hold until the enemy shows
  // up nearby (wall defenders man their walls and gates: see townDefence).
  aiOrders() {
    for (const q of this.squads) {
      if (q.side === this.playerSide || !q.leader.alive) continue;
      if (q.side === 1 && this.terrain.walls) { this.townDefence(q); continue; }
      if (q.order !== 'hold') continue;
      const near = this.squads.some(e => e.side !== q.side && e.seenBy && e.seenBy[q.side] && Math.hypot(e.cx - q.leader.x, e.cy - q.leader.y) < 380);
      if (near || this.time > 70) q.order = 'advance';
    }
  }

  // Computer defenders of a walled town: the backline holds the walls; the frontline
  // goes for anyone who has got inside, and returns to its post once the town is clear.
  townDefence(q) {
    const T = this.terrain;
    if (q.back || !q.post) return;
    const inside = this.squads.filter(e => e.side !== q.side && e.live && T.inTown(e.cx, e.cy));
    if (inside.length) {
      if (q.order === 'attack' && q.target && q.target.alive && !q.target.routing && T.inTown(q.target.x, q.target.y)) return;
      const e = inside.reduce((a, b) => Math.hypot(b.cx - q.cx, b.cy - q.cy) < Math.hypot(a.cx - q.cx, a.cy - q.cy) ? b : a);
      const tg = e.leader.alive && !e.leader.routing ? e.leader : e.members.find(m => m.alive && !m.routing && !m.escaped);
      if (tg) { q.order = 'attack'; q.target = tg; }
    } else if (q.order === 'attack' || q.order === 'advance') {
      q.order = 'move'; q.target = null; q.tx = q.post.x; q.ty = q.post.y; q.faceEnd = q.post.face; q.cap = 0;
    }
  }

  // ------------------------------------------------------------------ skills
  sk(id) { return DATA.skills[id] || this.custom[id]; }

  canCast(q, id) {
    const S = this.sk(id);
    return q.leader.alive && !q.leader.routing && q.mp >= S.mp && !(q.cd[id] > this.time);
  }

  // How far a skill reaches and how big an area it covers, on this big field.
  reach(S) { return (S.range || 0) * DATA.battle.skillRangeMul; }
  rad(S) { return (S.radius || 0) * DATA.battle.areaMul; }

  // Cast now if in range, otherwise walk the hero there first. What a skill does is
  // its handler in SKILL_FX (signature abilities: castSig).
  cast(q, id, x, y) {
    const S = this.sk(id);
    if (!this.canCast(q, id)) return false;
    if (S.target !== 'self' && Math.hypot(x - q.leader.x, y - q.leader.y) > this.reach(S)) { q.cast = { id, x, y }; return true; }
    q.cast = null;
    q.mp -= S.mp; q.cd[id] = this.time + S.cd;
    const pw = 1 + 0.025 * (q.level - 1), L = q.leader;
    const team = this.units.filter(u => u.sq === q && u.alive && !u.routing);
    const near = (r, side) => this.units.filter(u => u.side === side && u.alive && !u.routing && !u.escaped && Math.hypot(u.x - x, u.y - y) <= r);
    const say = (s, c) => { if (!this.headless) this.texts.push({ x: L.x, y: L.y - 30, s, life: 1.2, color: c }); };
    if (S.target === 'self') { x = L.x; y = L.y; }
    if (S.sig) { this.castSig(q, S, x, y, pw, near); say(S.name + '!', '#d0c090'); if (!this.headless && q.side === this.playerSide) Assets.sfx('power-up', 0.35); return true; }
    const fx = SKILL_FX[id];
    if (fx) fx(this, { q, S, x, y, pw, dk: pw * DATA.battle.hpMul, L, team, near, rad: this.rad(S) });
    say(S.name + '!', '#9fd8ff');
    if (!this.headless && q.side === this.playerSide) Assets.sfx('power-up', 0.3);
    return true;
  }

  // A hero's own signature ability (see DATA.rollSignature).
  castSig(q, S, x, y, pw, near) {
    const dk = pw * DATA.battle.hpMul;                 // damage and healing keep pace with battle hp
    const L = q.leader, foe = 1 - q.side;
    const pick = () => {                               // the enemy closest to where it was aimed
      let best = null, bd = 55;
      for (const e of this.units) if (e.side === foe && e.alive && !e.escaped && !e.routing && e.seen[q.side]) {
        const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; }
      }
      return best;
    };
    const big = (u, s, c) => { if (!this.headless) this.texts.push({ x: u.x, y: u.y - 24, s, life: 1, color: c }); };
    switch (S.kind) {
      case 'strike': {
        const e = pick(); if (!e) return;
        if (S.range > 60) this.projs.push({ x: L.x, y: L.y - 6, tx: e.x, ty: e.y - 6, tg: e, side: q.side, gid: q.id, src: L, dmg: S.dmg * dk, splash: 0, img: S.proj, speed: DATA.battle.missile.skill * 1.4, angle: 0, pierce: true });
        else { this.damage(e, S.dmg * dk, q.id, false, L); this.addFx('slash', e.x, e.y - 6, 0.4); this.addFx('hit', e.x, e.y - 8, 0.4); }
        big(e, '!!', '#ff8a5a');
        break;
      }
      case 'drain': {
        const e = pick(); if (!e) return;
        const before = e.hp; this.damage(e, S.dmg * dk, q.id, true, L);
        const got = Math.max(0, before - Math.max(0, e.hp)) * S.steal;
        const team = this.units.filter(u => u.sq === q && u.alive);
        for (const u of team) u.hp = Math.min(u.maxHp, u.hp + got / Math.max(1, team.length) * 2);
        this.addFx('sparkle', L.x, L.y - 8, 0.6); this.addFx('smoke', e.x, e.y - 6, 0.5);
        break;
      }
      case 'blast':
        this.projs.push({ x: L.x, y: L.y - 6, tx: x, ty: y, tg: null, side: q.side, gid: q.id, src: L, dmg: S.dmg * dk, splash: this.rad(S), img: S.proj, speed: DATA.battle.missile.skill, angle: 0, big: true, sx: L.x, sy: L.y - 6, arc: Math.min(90, Math.hypot(x - L.x, y - L.y) * 0.3), d0: Math.max(1, Math.hypot(x - L.x, y - L.y)) });
        break;
      case 'nova':
        for (const v of near(this.rad(S), foe)) this.damage(v, S.dmg * dk, q.id, true, L);
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; this.addFx(S.element === 'ice' ? 'sparkle' : 'fire', L.x + Math.cos(a) * this.rad(S) * 0.7, L.y + Math.sin(a) * this.rad(S) * 0.45, 0.5); }
        this.zones.push({ x: L.x, y: L.y, r: this.rad(S), until: this.time + 0.4, side: q.side, ring: true });
        break;
      case 'aura':
        for (const u of near(this.rad(S), q.side)) u.buffs.push({ atk: 1 + (S.atk - 1) * pw, def: S.def, until: this.time + S.dur });
        this.zones.push({ x: L.x, y: L.y, r: this.rad(S), until: this.time + 0.6, side: q.side, ring: true, good: true });
        break;
      case 'mend':
        for (const u of near(this.rad(S), q.side)) { u.hp = Math.min(u.maxHp, u.hp + S.heal * dk); this.addFx('sparkle', u.x, u.y - 8, 0.5); }
        this.zones.push({ x: L.x, y: L.y, r: this.rad(S), until: this.time + 0.6, side: q.side, ring: true, good: true });
        break;
    }
  }

  // Heroes on auto (and all computer heroes) use their skills when it makes sense.
  autoCast(q) {
    const L = q.leader, foes = this.units.filter(e => e.side !== q.side && e.alive && !e.routing && !e.escaped && e.seen[q.side]);
    const team = this.units.filter(u => u.sq === q && u.alive);
    const nearest = foes.reduce((m, e) => Math.min(m, udist(e, L)), 1e9);
    for (const id of q.skills) {
      if (!this.canCast(q, id)) continue;
      const S = this.sk(id);
      if (S.sig) { const r = this.autoSig(q, id, S, foes, team, nearest); if (r) return r; continue; }
      if (S.target === 'ground') {
        // aim at the densest visible group of enemies in range
        let best = null, bn = 0;
        for (const e of foes) {
          if (udist(e, L) > this.reach(S)) continue;
          const n = foes.filter(f => Math.hypot(f.x - e.x, f.y - e.y) <= this.rad(S)).length;
          if (n > bn) { bn = n; best = e; }
        }
        if (id === 'blink') { const t = this.blinkSpot(q, foes); if (t) return this.cast(q, id, t[0], t[1]); continue; }
        if (best && bn >= (id === 'volley' ? 3 : 4)) return this.cast(q, id, best.x, best.y);
      } else {
        const hurt = team.reduce((s, u) => s + u.hp / u.maxHp, 0) / Math.max(1, team.length);
        const allies = this.units.filter(u => u.side === q.side && u.alive && udist(u, L) <= (this.rad(S) || 0));
        if (id === 'rally' && hurt < 0.6 && nearest < 170) return this.cast(q, id);
        if (id === 'shieldwall' && hurt < 0.8 && nearest < 50) return this.cast(q, id);
        if (id === 'charge' && nearest > 70 && nearest < 240 && q.order !== 'hold') return this.cast(q, id);
        if (id === 'eagleeye' && nearest < 380) return this.cast(q, id);
        if (id === 'massheal' && allies.filter(u => u.hp / u.maxHp < 0.7).length >= 3) return this.cast(q, id);
        if (id === 'bless' && allies.length >= 5 && nearest < 130) return this.cast(q, id);
      }
    }
  }

  // Where an auto-casting hero would blink: frontline next to enemy shooters within reach,
  // backline away from melee that has caught it. Null if not worth it.
  blinkSpot(q, foes) {
    const L = q.leader, r = this.reach(this.sk('blink'));
    if (q.back) {
      const close = foes.filter(e => !e.back && udist(e, L) < 40);
      if (close.length < 2) return null;
      const c = centroid(close), d = udist(c, L) || 1;
      return [L.x + (L.x - c.x) / d * r * 0.9, L.y + (L.y - c.y) / d * r * 0.9];
    }
    const t = foes.filter(e => e.back && udist(e, L) < r && udist(e, L) > 90);
    if (t.length < 3) return null;
    const c = centroid(t); return [c.x, c.y];
  }

  autoSig(q, id, S, foes, team, nearest) {
    const L = q.leader, inRange = foes.filter(e => udist(e, L) <= this.reach(S));
    const allies = this.units.filter(u => u.side === q.side && u.alive && udist(u, L) <= (this.rad(S) || 0));
    switch (S.kind) {
      case 'strike': case 'drain': {
        if (S.kind === 'drain' && team.reduce((s, u) => s + u.hp / u.maxHp, 0) / Math.max(1, team.length) > 0.85 && !inRange.some(e => e.isLeader)) return false;
        const e = inRange.find(f => f.isLeader) || inRange.sort((a, b) => b.hp - a.hp)[0];
        return e ? this.cast(q, id, e.x, e.y) : false;
      }
      case 'blast': {
        let best = null, bn = 0;
        for (const e of inRange) { const n = foes.filter(f => Math.hypot(f.x - e.x, f.y - e.y) <= this.rad(S)).length; if (n > bn) { bn = n; best = e; } }
        return best && bn >= 3 ? this.cast(q, id, best.x, best.y) : false;
      }
      case 'nova': return foes.filter(e => udist(e, L) <= this.rad(S)).length >= 3 ? this.cast(q, id) : false;
      case 'aura': return allies.length >= 5 && nearest < 140 ? this.cast(q, id) : false;
      case 'mend': return allies.filter(u => u.hp / u.maxHp < 0.65).length >= 3 ? this.cast(q, id) : false;
    }
    return false;
  }

  // ------------------------------------------------------------------ simulation
  update(dt) {
    if (this.done || this.paused) return;
    this.time += dt;
    this.sizeUp();
    this.moraleStep(dt);
    this.aiOrders();

    // skills: regenerate MP, walk-then-cast, and auto-casting
    for (const q of this.squads) {
      if (!q.leader.alive) continue;
      q.mp = Math.min(q.maxMp, q.mp + DATA.battle.mp.regen * dt);
      if (q.cast) {
        const S = this.sk(q.cast.id);
        if (Math.hypot(q.cast.x - q.leader.x, q.cast.y - q.leader.y) <= this.reach(S)) this.cast(q, q.cast.id, q.cast.x, q.cast.y);
      } else if ((q.auto || q.side !== this.playerSide) && (q.castT -= dt) <= 0) { q.castT = 0.5; this.autoCast(q); }
    }
    // delayed effects (meteors, volleys) and lasting areas (frost fields)
    for (const p of this.pending) if (p.at <= this.time) { p.fn(); p.done = true; }
    this.pending = this.pending.filter(p => !p.done);
    for (const z of this.zones) if (z.dps && Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2))
      for (const v of this.units) if (v.side !== z.side && v.alive && !v.escaped && Math.hypot(v.x - z.x, v.y - z.y) <= z.r) this.damage(v, z.dps / 2 + v.def, z.gid, true, z.src);
    this.zones = this.zones.filter(z => z.until > this.time);

    for (const u of this.units) {
      if (!u.alive || u.escaped) continue;
      this.applyBuffs(u);
      u.cdLeft -= dt; u.atkT -= dt; u.hitT -= dt; u.retarget -= dt; u.revealT -= dt;
      const [vx0, vy0] = this.think(u, dt);
      let vx = vx0, vy = vy0;
      if ((vx || vy) && !u.routing) [vx, vy] = this.steer(u, vx, vy);
      if (vx || vy) {
        let sp = this.speedFor(u, u.x, u.y) * u.b.spd * this.terrain.slopeFactor(u.x, u.y, vx, vy);   // uphill is slow going
        if (u.frontFoe && u.frontFoeD < DATA.roles.front.pinRadius && !u.routing) sp *= DATA.roles.front.pinSlow;   // held up by a frontline enemy
        for (const z of this.zones) if (z.slow && z.side !== u.side && Math.hypot(u.x - z.x, u.y - z.y) <= z.r) sp *= z.slow;
        vx *= sp; vy *= sp;
      }
      u.moving = !!(vx || vy); u.vx = vx; u.vy = vy;
      if (vx || vy) {
        const T = this.terrain, nx = u.x + vx * dt, ny = u.y + vy * dt;   // solid ground (walls) blocks; slide along it
        if (u.cav) u.run += Math.hypot(vx, vy) * dt;                     // cavalry builds up a charge
        if (this.speedFor(u, u.x, u.y) > 0) { u.okX = u.x; u.okY = u.y; }
        if (this.speedFor(u, nx, ny) > 0) { u.x = nx; u.y = ny; }
        else if (this.speedFor(u, nx, u.y) > 0) u.x = nx;
        else if (this.speedFor(u, u.x, ny) > 0) u.y = ny;
        u.walkT += dt;
        if (u.atkT <= 0) u.dir = faceDir(vx, vy);
      }
      if (u.sq.order === 'retreat' || u.routing) { if (u.x < -6 || u.x > this.W + 6 || u.y < 8 || u.y > this.H - 4) u.escaped = true; }
      else u.x = clamp(u.x, 4, this.W - 4);
      u.y = clamp(u.y, 14, this.H - 6);
    }

    this.separate();
    this.updateProjectiles(dt);

    if (this.terrain.walls) for (const g of this.terrain.gates) g.hitT -= dt;
    for (const f of this.fx) f.t += dt / f.dur;
    this.fx = this.fx.filter(f => f.t < 1);
    for (const t of this.texts) { t.y -= 14 * dt; t.life -= dt; }
    this.texts = this.texts.filter(t => t.life > 0);
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    if (!this.headless) this.updateFog();

    // victory check
    const active = s => this.units.some(u => u.side === s && u.alive && !u.escaped && !u.routing);
    if (!active(0)) this.finish(1);
    else if (!active(1)) this.finish(0);
    else if (this.time >= this.limit) this.finish(1);
  }

  // ------------------------------------------------------------------ morale
  // Which side of tg's block u is striking: front, side (flank) or rear.
  flankOf(u, tg) {
    const q = tg.sq; if (q.cx == null) return 'front';
    let dx = u.x - q.cx, dy = u.y - q.cy; const d = Math.hypot(dx, dy) || 1;
    const dot = (dx / d) * q.face[0] + (dy / d) * q.face[1];
    return dot > 0.35 ? 'front' : dot < -0.35 ? 'rear' : 'side';
  }
  // A melee blow shakes the block that takes it: more from the flank or rear, more from a charge.
  shock(q, side, charged) {
    const M = DATA.battle.morale;
    // per hit, scaled so it takes as much real damage as before to break a block: with
    // more hp (and heavier blows) a man takes hpMul / atkMul times as many hits to fall
    // (men in big live battles are menHp times tougher again, so they take that many more blows)
    const B = DATA.battle, per = Math.pow(B.atkMul / (B.hpMul * (this.men > 1 ? B.menHp : 1)), B.shockExp);
    let k = ((side === 'rear' ? M.rear : side === 'side' ? M.flank : 0) + (charged ? M.charge : 0)) * per;
    if (k) q.morale -= k / q.startN;
    this.stats.hits++; if (side !== 'front') this.stats[side === 'rear' ? 'rear' : 'flank'] += (side === 'rear' ? M.rear : M.flank) / q.startN; if (charged) this.stats.charge += M.charge / q.startN;
  }
  // Morale each step: blocks wheel toward the enemy they fight, recover out of contact,
  // waver, rout (and rally once safe), and a rout shakes nearby friends.
  moraleStep(dt) {
    const M = DATA.battle.morale, turn = DATA.battle.turnRate * dt;
    for (const q of this.squads) {
      if (!q.alive) { q.state = 'lost'; continue; }
      // wheel to face the enemy block (unless marching to an ordered spot)
      if (q.tsq && q.order !== 'move' && q.state !== 'routing' && (q.order !== 'hold' || q.closest < 90)) {
        const want = Math.atan2(q.tsq.cy - q.cy, q.tsq.cx - q.cx), now = Math.atan2(q.face[1], q.face[0]);
        let da = ((want - now + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        da = Math.max(-turn, Math.min(turn, da));
        q.face = [Math.cos(now + da), Math.sin(now + da)];
      }
      const engaged = q.closest < 70, leaderless = !q.leader.alive;
      const alone = !leaderless && !q.members.some(u => u.alive && !u.escaped);   // a general whose men are all dead or fled the field
      if (alone) q.morale = Math.max(-50, q.morale - M.alone * dt);
      else if (!engaged && !leaderless) q.morale = Math.min(100, q.morale + M.recover * dt);
      const was = q.state;
      if (q.state === 'routing') {
        if (!leaderless && !q.leader.escaped && !engaged && q.morale >= M.rally) q.state = 'steady';
      } else q.state = q.morale < M.rout ? 'routing' : q.morale < M.wavering ? 'wavering' : 'steady';
      if (q.state !== was) {
        const all = q.members.concat([q.leader]);
        if (q.state === 'routing') {
          for (const u of all) if (u.alive && !u.escaped) { u.routing = true; u.routT = 1e9; }
          this.sel.delete(q);
          if (!this.headless) this.texts.push({ x: q.cx, y: q.cy - 30, s: 'Routed!', life: 1.6, color: '#ff8a7a' });
          for (const f of this.squads) if (f !== q && f.side === q.side && f.live && Math.hypot(f.cx - q.cx, f.cy - q.cy) < 240) f.morale -= M.nearbyRout;
        } else if (was === 'routing') {
          for (const u of all) if (u.alive && !u.escaped) u.routing = false;
          q.order = 'hold'; q.tx = q.leader.x; q.ty = q.leader.y;
          if (!this.headless) this.texts.push({ x: q.cx, y: q.cy - 30, s: 'Rallied!', life: 1.6, color: '#9fe8a0' });
        } else if (q.state === 'wavering' && !this.headless) this.texts.push({ x: q.cx, y: q.cy - 30, s: 'Wavering', life: 1.2, color: '#ffd06a' });
      }
    }
  }

  applyBuffs(u) {
    const b = u.b; b.atk = 1; b.def = 0; b.spd = 1; b.range = 0; b.view = 0;
    if (!u.buffs.length) return;
    u.buffs = u.buffs.filter(x => x.until > this.time);
    for (const x of u.buffs) { if (x.atk) b.atk *= x.atk; if (x.def) b.def += x.def; if (x.spd) b.spd *= x.spd; if (x.range) b.range += x.range; if (x.view) b.view += x.view; }
  }

  // Decide where unit u wants to go (returns a velocity) and attack if it can.
  think(u, dt) {
    const q = u.sq, L = q.leader, R = DATA.roles.back, T = this.terrain;
    const go = (x, y, speed = u.spd) => {
      const wp = T.route(u.x, u.y, x, y, u.side);
      const gx = wp ? wp[0] : x, gy = wp ? wp[1] : y, d = Math.hypot(gx - u.x, gy - u.y);
      if (d < 2) return [0, 0];
      const s = Math.min(speed, d * 4);
      return [(gx - u.x) / d * s, (gy - u.y) / d * s];
    };
    if (u.routing) {                                     // routed: run for your own edge of the field
      u.routT -= dt;
      if (u.routT <= 0) { u.alive = false; this.addFx('smoke', u.x, u.y - 6, 0.5); }
      // inside town walls there is nowhere to run: defenders huddle in the market square
      if (T.walls && u.side === 1 && T.inTown(u.x, u.y)) return go(T.town.cx + ((u.slotK || 0) % 9 - 4) * 9, T.town.cy + ((u.slotK || 0) % 5 - 2) * 9, u.spd * 1.1);
      if (T.walls && (T.inTown(u.x, u.y) || T.channelOf(u.x, u.y) || T.crossesKeep(u.x, u.y, u.side === 0 ? -30 : this.W + 30, u.y))) return go(u.side === 0 ? -30 : this.W + 30, u.y, u.spd * 1.25);
      return [(u.side === 0 ? -1 : 1) * u.spd * 1.25, ((u.slotK || 0) % 3 - 1) * u.spd * 0.25];
    }
    if (q.order === 'retreat') return go(u.side === 0 ? -30 : this.W + 30, u.y, u.spd * 1.2);

    // healers look after the most hurt ally within reach instead of fighting
    if (u.heal && u.cdLeft <= 0) {
      const patient = this.mostHurt(u);
      if (patient) { this.healUnit(u, patient); u.cdLeft = u.cd; u.atkT = 0.25; }
    }

    // where this unit belongs: its slot next to the general, or (for the general) the order's spot
    let ax, ay;
    if (u.isLeader) { ax = q.tx; ay = q.ty; }
    else if (L.alive) { const [ox, oy] = this.slot(q, u.slotK); ax = L.x + ox; ay = L.y + oy; }
    else { ax = u.x; ay = u.y; }

    // a hero walking into range to cast a skill (the squad follows)
    if (u.isLeader && q.cast) return go(q.cast.x, q.cast.y);

    // moving: no fighting, just get there (the general sets the pace). The squad
    // faces the way it marches, then turns to its ordered facing as it arrives.
    if (q.order === 'move') {
      if (u.isLeader) {
        const d = Math.hypot(q.tx - u.x, q.ty - u.y);
        if (d < 6) { q.order = 'hold'; q.face = q.faceEnd; return [0, 0]; }
        if (d > 110) {
          const mx = (q.tx - u.x) / d, my = (q.ty - u.y) / d;
          if (mx * q.face[0] + my * q.face[1] < 0.9) q.face = [mx, my];
        } else q.face = q.faceEnd;
        return go(q.tx, q.ty, q.cap ? Math.min(u.spd, q.cap) : u.spd);
      }
      return go(ax, ay, u.spd * 1.3);
    }

    // pick a target among visible enemies
    if (u.retarget <= 0 || !u.target || !u.target.alive || u.target.routing || u.target.escaped || !u.target.seen[u.side]) {
      u.target = this.pickTarget(u);
      u.retarget = 0.3 + Math.random() * 0.2;
    }
    const tg = u.target, range = this.unitReach(u, tg);
    const d = tg ? udist(tg, u) : 1e9;
    const walled = u.side === 1 && T.walls && T.inTown(u.x, u.y);
    const kite = u.back && u.frontFoe && u.frontFoeD < R.kiteRange && u.cdLeft > 0.15 && !walled;
    if (kite) {                                         // backline steps away from a frontline enemy
      const f = u.frontFoe, fd = u.frontFoeD || 1;
      return [(u.x - f.x) / fd * u.spd * R.kiteSpeed, (u.y - f.y) / fd * u.spd * R.kiteSpeed];
    }
    const gate = this.gateDuty(u, tg);                  // a siege: batter down a gate first
    if (gate) return this.bashGate(u, gate, go);
    if (tg) {
      if (d <= range + 4) {
        u.charging = false;
        u.dir = faceDir(tg.x - u.x, tg.y - u.y);
        if (u.cdLeft <= 0 && !u.heal) { this.attack(u, tg); u.cdLeft = u.cd; u.atkT = 0.25; }
        return [0, 0];
      }
      // engagement charge: a pushing frontline block breaks into a run as it closes
      // (the general's distance sets it off for the whole block)
      const CH = DATA.battle.charge, pushing = q.order === 'advance' || q.order === 'attack';
      let speed = u.spd;
      if (u.isLeader) {
        const was = q.charging;
        q.charging = !q.back && pushing && d < CH.dist;
        if (q.charging && !was) this.chargeCry(q);
      }
      if (!u.back && pushing && (q.charging || d < CH.dist) && q.state !== 'routing') {
        speed *= CH.speed;
        if (!u.charging) { u.charging = true; if (!(this.time - u.lastAtk < 4)) u.impact = true; }   // (not again while still in the thick of it)
      } else { u.charging = false; if (!pushing) u.impact = false; }
      // in a big block only the men near the enemy break ranks; the rest keep their places
      // and the block presses forward behind its general
      if (this.men > 1 && !u.isLeader && !u.back && L.alive && d > 36 && q.state !== 'routing' && q.order !== 'attack') return go(ax, ay, speed);
      let [vx, vy] = go(tg.x, tg.y, speed);
      // backline: don't walk out in front of your own front line
      const fx = this.frontX[u.side];
      if (u.back && fx != null && (u.side === 0 ? u.x > fx - R.behindFront && vx > 0 : u.x < fx + R.behindFront && vx < 0)) vx = 0;
      return [vx, vy];
    }
    // nothing to fight: the general follows the order, soldiers keep their places
    if (u.isLeader && q.order === 'advance') {
      const goal = this.lastSeen[u.side] || this.home[1 - u.side];
      if (Math.hypot(goal.x - u.x, goal.y - u.y) < 30) this.lastSeen[u.side] = null;
      return go(goal.x, goal.y);
    }
    if (u.isLeader && q.order === 'attack' && q.target) {
      const e = q.target.alive ? q.target : null;
      if (e) return go(e.x, e.y);
      q.order = 'advance';
    }
    return go(ax, ay);
  }

  // ------------------------------------------------------------------ sieges
  // How fast unit u can cross (x, y): like the terrain, but defenders pass their own gates.
  speedFor(u, x, y) {
    const T = this.terrain;
    if (T.walls && u.side === 1 && T.kindAt(x, y) === GROUND.gate) return 1;
    return T.speedAt(x, y);
  }
  // The gate an attacking unit should be battering, or null. Squads ordered onto a gate
  // all work on it; otherwise, while every gate is shut, artillery bombards the nearest
  // and frontline troops with no enemy this side of the wall batter it.
  gateDuty(u, tg) {
    const T = this.terrain, q = u.sq;
    if (!T.walls || u.side !== 0 || u.heal || T.inTown(u.x, u.y) || q.order === 'move' || q.order === 'retreat') return null;
    if (q.gateT) { if (!q.gateT.open) return q.gateT; q.gateT = null; }
    if (T.gates.some(g => g.open)) return null;                       // there is a way in: use it
    const art = u.t.type === 'artillery', stuck = !u.back && (!tg || T.inTown(tg.x, tg.y));
    if (!art && !stuck) return null;
    if (!q.gateAim || q.gateAim.open) {
      // the nearest gate by the way round, but squads spread over the gates when there are several
      const L = q.leader.alive ? q.leader : u, busy = g => this.squads.filter(o => o !== q && o.side === q.side && o.live && o.gateAim === g).length;
      const cost = g => T.costIn(L.x, L.y, g, g.ix, g.iy) + busy(g) * 260;
      q.gateAim = T.gates.reduce((a, b) => cost(b) < cost(a) ? b : a);
    }
    return q.gateAim;
  }
  // Work on gate g: shooters and artillery fire at it from range, the rest close in
  // along its width and hit it.
  bashGate(u, g, go) {
    const T = this.terrain, G = DATA.battle.gate, face = T.town.wall / 2;
    const lat = ((u.slotK || 0) * 7) % (2 * g.half - 12) - (g.half - 6);    // spread along the gate
    const [fx, fy] = T.gatePoint(g, face + 6, lat), [ax, ay] = T.gatePoint(g, face, lat * 0.8);
    const mul = u.t.type === 'artillery' ? G.artillery : u.t.type === 'mage' ? G.mage : u.t.proj ? G.shooter : G.melee;
    const ready = u.cdLeft <= 0;
    if (u.t.proj) {
      const r = (u.range + u.b.range) * 0.95, d = Math.hypot(ax - u.x, ay - u.y);
      if (d > r) return go(g.ax, g.ay);
      u.dir = faceDir(ax - u.x, ay - u.y);
      if (ready) {
        this.projs.push(this.missile(u, ax, ay - 4, { gate: g, dmg: u.atk * u.b.atk * mul, splash: 0 }));
        u.cdLeft = u.cd; u.atkT = 0.25;
      }
      return [0, 0];
    }
    if (Math.hypot(fx - u.x, fy - u.y) > u.range + 8) return go(fx, fy, u.spd);
    u.dir = faceDir(-g.nx, -g.ny);
    if (ready) {
      this.hitGate(g, u.atk * u.b.atk * mul * (u.run >= DATA.unitTypes.cavalry.chargeRun ? 1.5 : 1));
      u.run = 0; u.cdLeft = u.cd; u.atkT = 0.25;
      if (!this.headless && Math.random() < 0.3) { this.addFx('hit', ax, ay - 6, 0.25); if (this.seenByPlayer(u)) Assets.sfx('sword', 0.2); }
    }
    return [0, 0];
  }
  // Missiles: how fast unit u's fly, and one loosed by u at (tx, ty). They are not guided:
  // they come down where they were aimed (see updateProjectiles).
  missileSpeed(u) {
    const M = DATA.battle.missile, t = u.t.type;
    return t === 'artillery' ? M.artillery : t === 'mage' || u.splash ? M.bolt : M.arrow;
  }
  missile(u, tx, ty, extra) {
    const d = Math.hypot(tx - u.x, ty - u.y + 6);
    return Object.assign({ x: u.x, y: u.y - 6, sx: u.x, sy: u.y - 6, tx, ty, tg: null, side: u.side, gid: u.gid, src: u, img: u.t.proj,
      speed: this.missileSpeed(u), angle: 0, arc: Math.min(90, d * (u.t.type === 'artillery' ? 0.3 : 0.18)), d0: Math.max(1, d) }, extra);
  }
  hitGate(g, dmg) {
    if (g.open) return;
    g.hp -= dmg; g.hitT = 0.15;
    if (g.hp > 0) return;
    this.terrain.breakGate(g);                                         // the gate falls: a way in, and a blow to the defenders
    for (const q of this.squads) {
      if (q.side === 1) q.morale -= 10;
      if (q.gateT === g) { q.gateT = null; if (q.order === 'attack' && !q.target) q.order = 'advance'; }
    }
    if (!this.headless) {
      for (let i = 0; i < 6; i++) { const [x, y] = this.terrain.gatePoint(g, (Math.random() - 0.5) * this.terrain.town.wall, (Math.random() - 0.5) * g.half * 2); this.addFx(i % 2 ? 'smoke' : 'hit', x, y, 0.7); }
      Assets.sfx('kill', 0.6);
    }
    this.banner = { text: 'A gate has fallen!', t: 2.5, side: 1 };
  }
  // Player order: all these squads batter gate g.
  orderGate(squads, g) {
    for (const q of squads) if (q.leader.alive) { q.order = 'attack'; q.target = null; q.cast = null; q.gateT = g; }
  }

  // How far unit u can hit target tg from where they stand: shooters gain range
  // shooting down from high ground, and lose some shooting uphill.
  unitReach(u, tg) {
    const base = u.range + u.b.range;
    if (base < 30 || !tg) return base;
    return base * (1 + DATA.battle.hills.range * clamp(u.h - tg.h, -0.5, 1.2));
  }
  // A squad breaking into a charge shouts once (shown if the player can see it).
  chargeCry(q) {
    if (this.time - q.chargeT < 8) return;
    q.chargeT = this.time;
    if (!this.headless && this.seenByPlayer(q.leader) && q.leader.alive) this.texts.push({ x: q.leader.x, y: q.leader.y - 34, s: 'Charge!', life: 1.1, color: '#ffb040' });
  }

  // Which visible enemy to go for. Holding squads only fight near their post;
  // wall defenders deal with anyone inside first; frontline protects its backline.
  // The squad picks an enemy block (see sizeUp); each man goes for the nearest man of
  // that block, or anyone already close. Holding squads only fight near their post;
  // wall defenders deal with anyone inside first.
  pickTarget(u) {
    const q = u.sq, T = this.terrain;
    const walled = u.side === 1 && T.walls && T.inTown(u.x, u.y), inside = e => T.inTown(e.x, e.y);
    const anchor = u.isLeader ? (q.order === 'hold' ? { x: q.tx, y: q.ty } : u) : q.leader.alive ? q.leader : u;
    const leash = q.order === 'hold' ? 150 : q.order === 'attack' ? 240 : u.isLeader ? 1e9 : 170;
    let best = null, bd = 1e9;
    const consider = e => {
      if (e.side === u.side || !e.alive || e.escaped || e.routing || !e.seen[u.side]) return;
      const d2 = (e.x - u.x) ** 2 + (e.y - u.y) ** 2, r2 = (this.unitReach(u, e) + 4) ** 2;   // shooters reach further downhill
      if (d2 > r2 && Math.hypot(e.x - anchor.x, e.y - anchor.y) > leash) return;
      if (walled && !inside(e) && d2 > r2) return;
      if (d2 < bd) { bd = d2; best = e; }
    };
    for (const e of this.nearby(u, Math.max(48, (u.range + u.b.range) * 1.3 + 8))) consider(e);
    const tq = q.order === 'attack' && q.target ? q.target.sq : q.tsq;
    if (tq) { consider(tq.leader); for (const e of tq.members) consider(e); }
    return best;
  }
  // Enemies within r of u, from the grid built in sizeUp.
  nearby(u, r) {
    const out = [], C = this.gridC, n = Math.ceil(r / C), cx = Math.floor(u.x / C), cy = Math.floor(u.y / C);
    for (let gx = cx - n; gx <= cx + n; gx++) for (let gy = cy - n; gy <= cy + n; gy++) {
      const cell = this.grid && this.grid.get(gx * 4096 + gy); if (!cell) continue;
      for (const e of cell) if (e.side !== u.side) out.push(e);
    }
    return out;
  }

  separate() {
    // keep soldiers from standing inside each other (grid so big battles stay fast)
    const live = this.units.filter(u => u.alive && !u.escaped);
    const P = DATA.battle.personal, P2 = P * P, grid = new Map(), C = 12;
    for (const u of live) { const k = Math.floor(u.x / C) * 4096 + Math.floor(u.y / C); (grid.get(k) || grid.set(k, []).get(k)).push(u); }
    for (const a of live) {
      const cx = Math.floor(a.x / C), cy = Math.floor(a.y / C);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const cell = grid.get(gx * 4096 + gy); if (!cell) continue;
        for (const b of cell) {
          if (b === a) continue;
          const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          const R0 = this.men > 1 ? DATA.battle.personalMen : P;
          if (d2 < R0 * R0 && d2 > 0.0001) {
            const d = Math.sqrt(d2), push = (R0 - d) * 0.12, nx = a.x - dx / d * push, ny = a.y - dy / d * push;
            if (this.terrain.passable(nx, ny)) { a.x = nx; a.y = ny; }
          }
        }
      }
    }
    for (const u of live)                                         // nobody gets shoved into a wall or a cliff
      if (u.okX != null && this.speedFor(u, u.x, u.y) === 0) { u.x = u.okX; u.y = u.okY; }
  }

  updateProjectiles(dt) {
    const M = DATA.battle.missile, hitR = this.men > 1 ? M.hitRMen : M.hitR;
    for (const p of this.projs) {
      if (p.tg && p.tg.alive) { p.tx = p.tg.x; p.ty = p.tg.y - 6; }      // (guided: only some skills)
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      p.angle = Math.atan2(dy, dx);
      if (p.arc) {                                                      // an arcing flight: tilt with the climb and fall
        const k = clamp(1 - d / p.d0, 0, 1);
        p.lift = Math.sin(k * Math.PI) * p.arc;
        p.angle = Math.atan2(dy / d * p.speed - Math.cos(k * Math.PI) * Math.PI * p.arc / p.d0 * p.speed, dx / d * p.speed);
      }
      if (d <= step + 2) {
        p.dead = true;
        if (p.gate) { this.hitGate(p.gate, p.dmg); this.addFx(p.big || p.splash ? 'fire' : 'hit', p.tx, p.ty, 0.3); }
        else if (p.splash) {
          if (p.big) for (let i = 0; i < 5; i++) this.addFx(i % 2 ? 'smoke' : 'fire', p.tx + (Math.random() - 0.5) * p.splash, p.ty + (Math.random() - 0.5) * p.splash * 0.6, 0.6);
          else if (!p.quiet) this.addFx('fire', p.tx, p.ty, 0.4); else this.addFx('hit', p.tx, p.ty, 0.2);
          for (const v of this.units) {                                   // full force where it lands, half at the edge of the blast
            if (!v.alive || v.escaped || v.side === p.side) continue;
            const dd = Math.hypot(v.x - p.tx, v.y - 6 - p.ty);
            if (dd <= p.splash) this.damage(v, p.dmg * (1 - 0.5 * dd / p.splash), p.gid, true, p.src);
          }
        } else if (p.tg && p.tg.alive) {
          this.addFx('hit', p.tx, p.ty, 0.25);
          this.damage(p.tg, p.dmg, p.gid, true, p.src);
        } else if (p.aim) {                                             // a loosed missile: hits whoever is where it comes down
          let v = p.aim.alive && !p.aim.escaped && Math.hypot(p.aim.x - p.tx, p.aim.y - 6 - p.ty) <= hitR ? p.aim : null;
          if (!v) { let bd = hitR; for (const e of this.nearby({ x: p.tx, y: p.ty + 6, side: p.side }, hitR + 8)) { const dd = Math.hypot(e.x - p.tx, e.y - 6 - p.ty); if (dd < bd) { bd = dd; v = e; } } }
          if (v) { this.addFx('hit', p.tx, p.ty, 0.25); this.damage(v, p.dmg, p.gid, true, p.src); }
          else if (!this.headless && p.img === 'arrow') { this.spent.push([p.tx, p.ty + 6, Math.atan2(p.ty - p.sy, p.tx - p.sx)]); if (this.spent.length > 300) this.spent.shift(); }
        }
      } else { p.x += dx / d * step; p.y += dy / d * step; }
    }
    this.projs = this.projs.filter(p => !p.dead);
  }

  mostHurt(u) {
    let best = null, worst = 0.999;
    for (const a of u.sq.members.concat([u.sq.leader])) {
      if (!a.alive || a.escaped || a.routing) continue;
      const f = a.hp / a.maxHp;
      if (f < worst && Math.hypot(a.x - u.x, a.y - u.y) <= u.range + 4) { worst = f; best = a; }
    }
    return best;
  }

  healUnit(u, a) {
    const amount = Math.round(u.atk * u.b.atk * (0.85 + Math.random() * 0.3));
    a.hp = Math.min(a.maxHp, a.hp + amount);
    if (!this.headless) {
      this.texts.push({ x: a.x, y: a.y - 16, s: '+' + amount, life: 0.6, color: '#7be07b' });
      this.addFx('sparkle', a.x, a.y - 8, 0.4);
    }
  }

  // Once per step: who can see whom (fog of war), each unit's nearest enemy and
  // nearest frontline enemy, and where each side's front line is. A coarse grid keeps it fast.
  // Built to stay fast with hundreds of men: a fine grid for who is close to whom, a coarse
  // sight map per side (a cell is seen if any man of that side sees it), and per squad its
  // centre, whether it is seen, and the enemy block it is facing up to.
  sizeUp() {
    const live = this.units.filter(u => u.alive && !u.escaped && !u.routing);
    const grid = new Map(), C = 32;
    this.grid = grid; this.gridC = C;
    const T = this.terrain, B = DATA.battle, spot = B.forestSpot;
    for (const q of this.squads) if (q.rerank && this.time - q.rankT > 0.8) { this.rank(q); q.rerank = false; q.rankT = this.time; }   // ranks close up
    for (const u of live) {
      u.seen[0] = u.seen[1] = false;
      u.h = T.heightAt(u.x, u.y); u.hidden = T.hidesAt(u.x, u.y) && u.revealT <= 0;
      const k = Math.floor(u.x / C) * 4096 + Math.floor(u.y / C);
      (grid.get(k) || grid.set(k, []).get(k)).push(u);
    }
    // sight: without fog of war everyone sees the whole field
    if (!this.fog) for (const e of live) { e.seen[0] = e.seen[1] = true; }
    else {
    const V = 40, vw = Math.ceil(this.W / V) + 1, vh = Math.ceil(this.H / V) + 1;
    const sight = [new Uint8Array(vw * vh), new Uint8Array(vw * vh)];
    for (const u of live) {
      const r = this.viewOf(u), cx = u.x / V, cy = u.y / V, n = Math.ceil(r / V), S = sight[u.side];   // hilltops see further
      const x0 = Math.max(0, Math.floor(cx) - n), x1 = Math.min(vw - 1, Math.floor(cx) + n), y0 = Math.max(0, Math.floor(cy) - n), y1 = Math.min(vh - 1, Math.floor(cy) + n);
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++)
        if (!S[gy * vw + gx] && (gx + 0.5 - cx) ** 2 + (gy + 0.5 - cy) ** 2 <= (r / V) ** 2) S[gy * vw + gx] = 1;
    }
    for (const e of live) { const i = Math.floor(e.y / V) * vw + Math.floor(e.x / V); e.seen[0] = !!sight[0][i] || e.side === 0; e.seen[1] = !!sight[1][i] || e.side === 1; }
    }
    // troops in woods are only seen by enemies close by (or for a moment after they attack)
    for (const e of live) if (e.hidden && e.seen[1 - e.side] && !this.spotted(e, spot)) e.seen[1 - e.side] = false;
    // each man's nearest enemy (only close ones matter: pinning, stepping back, being caught in melee)
    for (const u of live) {
      u.closestD = 1e9; u.frontFoe = null; u.frontFoeD = 1e9;
      const cx = Math.floor(u.x / C), cy = Math.floor(u.y / C);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const cell = grid.get(gx * 4096 + gy); if (!cell) continue;
        for (const e of cell) {
          if (e.side === u.side) continue;
          const d = Math.hypot(e.x - u.x, e.y - u.y);
          if (d < u.closestD) u.closestD = d;
          if (!e.back && d < u.frontFoeD) { u.frontFoeD = d; u.frontFoe = e; }
        }
      }
    }
    // squads: centre, seen or not, how close the enemy is, and which enemy block to go for
    for (const q of this.squads) {
      const all = q.members.concat([q.leader]).filter(u => u.alive && !u.escaped);
      const m = all.filter(u => !u.routing);
      q.live = m.length; q.alive = all.length;
      if (!m.length) { q.seenBy = [false, false]; q.closest = 1e9; if (all.length) { q.cx = all.reduce((a, u) => a + u.x, 0) / all.length; q.cy = all.reduce((a, u) => a + u.y, 0) / all.length; } continue; }
      q.cx = m.reduce((a, u) => a + u.x, 0) / m.length; q.cy = m.reduce((a, u) => a + u.y, 0) / m.length;
      q.seenBy = [m.some(u => u.seen[0]), m.some(u => u.seen[1])];
      q.closest = Math.min(...m.map(u => u.closestD));
    }
    for (const q of this.squads) {
      if (!q.live) { q.tsq = null; continue; }
      const T = this.terrain, walled = q.side === 1 && T.walls;
      let best = null, bd = 1e9;
      for (const e of this.squads) {
        if (e.side === q.side || !e.live || !e.seenBy[q.side]) continue;
        let d = Math.hypot(e.cx - q.cx, e.cy - q.cy);
        if (walled && T.inTown(e.cx, e.cy)) d -= 400;                               // intruders first
        if (!q.back) for (const f of this.squads)                                     // protect your own backline
          if (f.side === q.side && f.back && f.live && Math.hypot(f.cx - e.cx, f.cy - e.cy) < 120) d -= 150;
        if (d < bd) { bd = d; best = e; }
      }
      q.tsq = best;
    }
    for (const s of [0, 1]) {
      const seen = live.filter(e => e.side !== s && e.seen[s]);
      if (seen.length) this.lastSeen[s] = centroid(seen);
    }
    this.frontX = [0, 1].map(s => {
      const f = live.filter(u => u.side === s && !u.back);
      return f.length ? f.reduce((a, u) => a + u.x, 0) / f.length : null;
    });
  }

  // Is any enemy of e within r of it (grid from sizeUp)?
  spotted(e, r) {
    const C = this.gridC, n = Math.ceil(r / C), cx = Math.floor(e.x / C), cy = Math.floor(e.y / C);
    for (let gx = cx - n; gx <= cx + n; gx++) for (let gy = cy - n; gy <= cy + n; gy++) {
      const cell = this.grid.get(gx * 4096 + gy); if (!cell) continue;
      for (const o of cell) if (o.side !== e.side && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= r * r) return true;
    }
    return false;
  }
  // How far a unit sees: further from high ground.
  viewOf(u) { return (u.view + u.b.view) * (1 + DATA.battle.hills.view * u.h); }

  // Picks a heading near the wanted one that avoids slow ground (rivers, walls, mud)
  // when a quicker way is close by, e.g. a ford or a gate.
  steer(u, vx, vy) {
    const T = this.terrain, base = Math.atan2(vy, vx), sp = Math.hypot(vx, vy);
    let best = base, bestScore = -1;
    for (const da of [0, 0.5, -0.5, 1, -1, 1.4, -1.4]) {
      const a = base + da;
      let s = 1;
      for (const look of [6, 14, 26, 40]) s = Math.min(s, this.speedFor(u, u.x + Math.cos(a) * look, u.y + Math.sin(a) * look));
      const score = s * Math.cos(da) - Math.abs(da) * 0.02;
      if (score > bestScore + 0.05) { bestScore = score; best = a; }
    }
    return [Math.cos(best) * sp, Math.sin(best) * sp];
  }

  attack(u, tg) {
    let dmg = u.atk * u.b.atk * this.terrain.footingAt(u.x, u.y);   // poor footing (water, mud) weakens blows
    const R = DATA.roles.back;
    const C = DATA.unitTypes.cavalry;
    if (u.run >= C.chargeRun && (u.cav || u.run >= 999)) {           // cavalry charge (or the Charge skill)
      dmg *= C.chargeMul;
    }
    else if (u.impact && !u.t.proj) dmg *= DATA.battle.charge.impact;  // infantry charging home
    const charged = (u.run >= C.chargeRun && u.cav) || (u.impact && !u.t.proj);
    u.run = 0; u.impact = false; u.revealT = 2; u.lastAtk = this.time;  // fighting gives away a hidden position
    if (!u.t.proj) dmg *= 1 + DATA.battle.hills.melee * clamp(u.h - tg.h, -1, 1);   // fighting downhill
    if (u.sq.state === 'wavering') dmg *= DATA.battle.morale.waverAtk;
    if (u.t.antiCav && tg.cav) dmg *= DATA.antiCavMul;               // spears against horses
    const side = u.t.proj ? 'front' : this.flankOf(u, tg);            // blows into a block's flank or rear land hard
    if (side !== 'front') dmg *= DATA.battle.flank[side];
    if (!u.t.proj) this.shock(tg.sq, side, charged);
    if (u.back) dmg *= R.power;                                    // shooting from safety hits hard...
    if (u.back && u.closestD < R.exposedRange) dmg *= R.meleePenalty;   // ...but caught in melee, much less
    if (u.t.proj) {
      // loosed at where the target will be when it lands, scattered more the further it flies
      const M = DATA.battle.missile, d = Math.hypot(tg.x - u.x, tg.y - u.y), t = d / this.missileSpeed(u) * M.lead;
      const sc = d * M.scatter * (u.t.type === 'artillery' ? 1.3 : 1), a = Math.random() * Math.PI * 2, r = sc * Math.sqrt(Math.random()) * 0.9;
      this.projs.push(this.missile(u, tg.x + (tg.vx || 0) * t + Math.cos(a) * r, tg.y - 6 + (tg.vy || 0) * t + Math.sin(a) * r * 0.7, { aim: tg, dmg, splash: u.splash || 0 }));
      if (!this.headless && u.t.splash && this.seenByPlayer(u)) Assets.sfx('magic-1', 0.25);
    } else {
      if (!this.headless && (this.men === 1 || Math.random() < 0.3)) this.fx.push({ name: 'arc', x: tg.x, y: tg.y - 7, t: 0, dur: 0.22, a: Math.atan2(tg.y - u.y, tg.x - u.x), flip: Math.random() < 0.5 });
      if (!this.headless && this.seenByPlayer(u)) Assets.sfx('sword', 0.3);
      this.damage(tg, dmg, u.gid, false, u);
    }
  }

  damage(v, amount, byGid, ranged, src) {
    if (!v.alive) return;
    if (ranged) {
      const T = this.terrain, W = DATA.ground.wall;
      let cover = T.coverAt(v.x, v.y);
      if (T.walls && src && T.inTown(v.x, v.y) && !T.inTown(src.x, src.y))           // shot from outside the walls
        cover = Math.max(cover, src.t && src.t.type === 'artillery' ? W.lobbedCover : W.insideCover);
      amount *= 1 - cover;
    }
    const fort = v.side === 1 && this.terrain.walls && this.terrain.inTown(v.x, v.y) ? DATA.ground.wall.fortify : 0;
    const def = (v.def + v.b.def + fort) * DATA.battle.defMul * (ranged ? 1 - DATA.roles.back.pierce : 1);       // arrows and spells pierce armour
    const dmg = Math.max(1, Math.round(amount * (0.85 + Math.random() * 0.3) - def));
    v.hp -= dmg; v.hitT = 0.12;
    if (!this.headless && (this.men === 1 || v.isLeader)) this.texts.push({ x: v.x, y: v.y - 16, s: String(dmg), life: 0.6, color: v.isLeader ? '#d0c090' : '#ffffff' });
    if (v.hp <= 0) {
      v.alive = false;
      if (byGid) this.xp[byGid] = (this.xp[byGid] || 0) + (v.isLeader ? DATA.leveling.killGeneral : DATA.leveling.killSoldier / this.men);
      const M = DATA.battle.morale, sq = v.sq;
      if (!v.isLeader) { sq.morale -= M.losses / sq.startN; this.stats.loss += M.losses / sq.startN; }
      if (src) src.kills++;
      if (!v.isLeader) v.sq.rerank = true;                              // the ranks close up (see sizeUp)
      this.addFx('smoke', v.x, v.y - 6, 0.5);
      if (!this.headless && !v.isLeader && Assets.img[v.sprite] && Assets.img[v.sprite].corpse) {   // the body stays where it fell
        this.dead.push({ x: v.x, y: v.y, sprite: v.sprite, flip: Math.random() < 0.5 });
        if (this.dead.length > 400) this.dead.shift();
      }
      if (!this.headless && this.seenByPlayer(v)) Assets.sfx('kill', 0.35);
      if (v.isLeader) {                                  // the general falls: a heavy blow to morale; a small squad breaks at once
        sq.morale -= M.general + (sq.startN < 12 ? 100 : 0);
        this.sel.delete(v.sq);
        this.banner = { text: `${DATA.generals[v.gid].name} has fallen!`, t: 2.5, side: v.side };
      }
    }
  }

  addFx(name, x, y, dur) { if (!this.headless) this.fx.push({ name, x, y, t: 0, dur }); }

  finish(winnerSide) {
    this.done = true;
    this.winner = winnerSide === 0 ? 'att' : 'def';
    const res = side => (side === 0 ? this.opts.attackers : this.opts.defenders).map(g => {
      const q = this.squads.find(s => s.id === g.id), leader = q.leader;
      // men back into campaign soldiers: as many as the survivors make up, taking the
      // soldiers whose men fared best (escaped routers count as survivors)
      const byT = {};
      for (const u of q.members) { const k = u.troopK ?? u.slotK; const b = byT[k] || (byT[k] = { u, alive: 0, kills: 0 }); b.kills += u.kills; if (u.alive || u.escaped) b.alive++; }   // men still running at the end got away
      const tot = Object.values(byT).reduce((a, b) => a + b.alive, 0), keep = Math.round(tot / this.men);
      const left = Object.values(byT).sort((a, b) => b.alive - a.alive).slice(0, keep).filter(b => b.alive).map(b => Object.assign(Object.create(b.u), { kills: Math.round(b.kills / this.men) }));
      const troops = left.length;
      const L = DATA.leveling, won = (side === 0) === (winnerSide === 0);
      const xp = Math.round((this.xp[g.id] || 0) + L.fought + (won ? L.won : 0));
      const ok = leader.alive || leader.escaped;
      const P = DATA.promotion;
      const lv = left.map(u => Math.min(P.maxLevel, u.lv + P.survive + (won ? P.win : 0) + u.kills * P.kill));
      return { id: g.id, alive: ok, troops: ok ? troops : 0, mix: ok ? left.map(u => u.t.id) : [], lv: ok ? lv : [],
        promoted: ok ? left.map((u, i) => DATA.tierOf(lv[i]) > u.tier ? DATA.unitName(u.t.id, lv[i]) : null).filter(Boolean) : [], before: g.troops, xp };
    });
    this.result = { winner: this.winner, att: res(0), def: res(1), timeout: this.time >= this.limit };
  }

  runHeadless() {
    while (!this.done) this.update(1 / 12);
    return this.result;
  }

  // Status for the on-screen HUD
  sideInfo(side) {
    return this.squads.filter(q => q.side === side).map(q => ({
      id: q.id, q, hp: Math.max(0, q.leader.hp / q.leader.maxHp), alive: q.leader.alive, mp: q.mp / q.maxMp,
      troops: q.members.filter(u => u.alive && !u.routing && !u.escaped).length, morale: Math.max(0, q.morale) / 100, state: q.state,
    }));
  }

  // ------------------------------------------------------------------ fog of war
  seenByPlayer(u) { return this.playerSide < 0 || u.side === this.playerSide || u.seen[this.playerSide]; }
  cellVisible(x, y) {
    if (this.playerSide < 0 || !this.fog) return true;
    const i = Math.floor(y / this.fogC) * this.fw + Math.floor(x / this.fogC);
    return this.visible[i] === 1;
  }

  updateFog() {
    if (this.playerSide < 0 || !this.fog) return;
    const C = this.fogC, fw = this.fw, fh = this.fh, vis = this.visible, lit = this.fogLit, ex = this.explored;
    vis.fill(0); lit.fill(0);
    for (const u of this.units) {
      if (u.side !== this.playerSide || !u.alive || u.escaped) continue;
      const r = this.viewOf(u) / C, cx = u.x / C, cy = u.y / C, soft = 2.5;     // edges fade over a few cells
      for (let y = Math.max(0, Math.floor(cy - r - soft)); y <= Math.min(fh - 1, Math.ceil(cy + r + soft)); y++)
        for (let x = Math.max(0, Math.floor(cx - r - soft)); x <= Math.min(fw - 1, Math.ceil(cx + r + soft)); x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), i = y * fw + x;
          if (d <= r) { vis[i] = 1; ex[i] = 1; }
          const k = clamp((r + soft - d) / (soft * 2), 0, 1);
          if (k > lit[i]) lit[i] = k;
          if (k > this.exploredSoft[i]) this.exploredSoft[i] = k;
        }
    }
    const c = this.fogCanvas.getContext('2d'), img = c.createImageData(fw, fh);
    for (let i = 0; i < fw * fh; i++) {                // the land always shows; only troops hide in the fog
      const shade = 125 - 55 * this.exploredSoft[i];
      img.data[i * 4 + 3] = Math.round(shade * (1 - lit[i]));
      img.data[i * 4] = 8; img.data[i * 4 + 1] = 10; img.data[i * 4 + 2] = 20;
    }
    c.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------------ drawing
  buildBackground() {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(this.W * ART); cv.height = Math.ceil(this.H * ART);   // one pixel per art pixel (see ART)
    const ctx = cv.getContext('2d');
    ctx.scale(ART, ART);
    let seed = 0; for (const ch of this.opts.spotName) seed = seed * 31 + ch.charCodeAt(0);
    const rng = makeRng(seed);
    const T = Assets.img;
    // The ground, painted straight onto the art-pixel grid in three shades of the region's
    // ground from the palette: broad soft patches, ragged where they meet, and sparse blades
    // of grass (or snow glints, pebbles...). No repeating tile, so no stripes.
    const GROUNDS = { frost: ['a7a6ac', 'beb2c8', 'd7d6d6'], sun: ['7a6852', '9a8a72', 'b8aa92'], ember: ['2a3230', '463a30', '5e4e3f'],
      bog: ['263329', '3e5040', '5e4e3f'], shadow: ['2a3230', '4a4250', '5d5e60'], darkwood: ['1f2524', '263329', '3e5040'] };
    const shades = (GROUNDS[this.terrain.region] || ['36413e', '3e5040', '55684f']).map(h => { const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; });
    const noise = makeNoise(seed & 0xffff), gw = cv.width, gh = cv.height, img = new ImageData(gw, gh), gd = img.data;
    const hash = (x, y) => { const h = Math.imul(x * 374761393 + y * 668265263, 1274126177); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const n = noise(x / 70, y / 70) * 0.75 + noise(x / 18 + 40, y / 18) * 0.25 + (hash(x >> 1, y >> 1) - 0.5) * 0.08;
      let k = n < 0.36 ? 0 : n > 0.62 ? 2 : 1;
      const r = hash(x, y);
      if (r < 0.012 && k < 2) { k++; if (y + 1 < gh) { const j = ((y + 1) * gw + x) * 4; gd[j] = shades[k][0]; gd[j + 1] = shades[k][1]; gd[j + 2] = shades[k][2]; gd[j + 3] = 255; } }   // a blade
      else if (r > 0.994 && k > 0) k--;
      const i = (y * gw + x) * 4;
      if (gd[i + 3]) continue;                                        // (a blade already drawn here)
      gd[i] = shades[k][0]; gd[i + 1] = shades[k][1]; gd[i + 2] = shades[k][2]; gd[i + 3] = 255;
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(img, 0, 0); ctx.restore();
    const meadow = typeof Gen !== 'undefined' && Gen.on;
    const lush = !['frost', 'sun', 'ember'].includes(this.terrain.region);
    for (let i = 0; i < (meadow ? 26 : 90); i++) {
      const x = Math.floor(rng() * (this.W - 16)), y = Math.floor(rng() * (this.H - 16));
      if (!lush || this.terrain.kindAt(x + 8, y + 8) !== GROUND.grass) continue;
      if (meadow) {                                // generated bushes, rocks and stumps
        const kind = ['bush', 'bush', 'rock', 'stump'][Math.floor(rng() * 4)];
        const p = PixelGen.generate('prop', { seed: 1 + Math.floor(rng() * 40), prop: kind }).img, c = Gen.canvas(p, p.w, p.h, 0, 1);   // (bushes, rocks, stumps)
        ctx.imageSmoothingEnabled = false;
        artDraw(ctx, c, x, y);
      } else HD.draw(ctx, T['tile:' + ['grass_tuft', 'grass_tuft', 'bush'][Math.floor(rng() * 3)]], x, y);
    }
    this.terrain.draw(ctx);
    return Palette.canvas(cv, 0);                  // the whole field in the game's palette, on the art grid
  }

  // Camera: world point at the centre of the screen and zoom (screen px per world px).
  // Zoomed in, screen pixels per art pixel (N) are a whole number, so pixel art stays crisp;
  // zoomed out below 1 it shrinks smoothly (no pixel art survives that anyway).
  fit(canvas) {
    const dpr = window.devicePixelRatio || 1, c = this.cam;
    const minZ = Math.max(canvas.width / this.W, canvas.height / this.H) / dpr;
    c.z = clamp(c.z, minZ, 4 * ART);
    let N = c.z * dpr / ART;
    if (N >= 1) N = Math.max(1, Math.round(N));
    if (N * ART < minZ * dpr) N = minZ * dpr / ART;                   // the whole field must still fill the screen
    this.N = N; this.scale = N * ART;
    const hw = canvas.width / 2 / this.scale, hh = canvas.height / 2 / this.scale;
    c.x = clamp(c.x, hw, this.W - hw); c.y = clamp(c.y, hh, this.H - hh);
    const snap = v => N >= 1 ? Math.round(v / N) * N : Math.round(v);   // on whole art pixels
    this.ox = snap(canvas.width / 2 - c.x * this.scale);
    this.oy = snap(canvas.height / 2 - c.y * this.scale);
    this.cw = canvas.width; this.ch = canvas.height;
  }
  toWorld(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; }
  zoomAt(f, px, py) {
    const [wx, wy] = this.toWorld(px, py), dpr = window.devicePixelRatio || 1;
    const N = this.N || 1;                                             // step a whole art-pixel size at a time when zoomed in
    if (N >= 1 && f > 1) this.cam.z = (Math.round(N) + 1) * ART / dpr;
    else if (N > 1.5 && f < 1) this.cam.z = (Math.round(N) - 1) * ART / dpr;
    else this.cam.z = this.cam.z * f;
    this.cam.z = clamp(this.cam.z, 0.3, 4 * ART);
    const s = this.cam.z * dpr;
    this.cam.x = wx - (px - this.cw / 2) / s; this.cam.y = wy - (py - this.ch / 2) / s;
  }

  // The world is drawn into a buffer at one pixel per art pixel (ART art pixels per world
  // pixel, so soldiers' 32 px art lands 1:1), then enlarged onto the screen by a whole
  // number (this.N), so every sprite, wall, road and house shares one pixel grid. Squad
  // markers, numbers and messages are drawn sharp on the screen on top.
  render(screen, canvas) {
    this.fit(canvas);
    const N = this.N, bw = Math.ceil(canvas.width / N), bh = Math.ceil(canvas.height / N);
    if (!this.buf || this.buf.width !== bw || this.buf.height !== bh) { this.buf = document.createElement('canvas'); this.buf.width = bw; this.buf.height = bh; }
    let ctx = this.buf.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#151a19'; ctx.fillRect(0, 0, bw, bh);
    ctx.setTransform(ART, 0, 0, ART, this.ox / N, this.oy / N);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bg, 0, 0, this.W, this.H);
    const [vx0, vy0] = this.toWorld(0, 0), [vx1, vy1] = this.toWorld(canvas.width, canvas.height);
    const onScreen = (x, y) => x > vx0 - 30 && x < vx1 + 30 && y > vy0 - 40 && y < vy1 + 30;

    // town gates: shut, battered or broken
    if (this.terrain.walls) for (const g of this.terrain.gates) this.drawGate(ctx, g);

    // spell areas
    for (const z of this.zones) {
      if (!this.cellVisible(z.x, z.y)) continue;
      if (z.ring) {
        ctx.strokeStyle = z.good ? 'rgba(255,240,140,0.9)' : 'rgba(255,140,80,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.6, 0, 0, Math.PI * 2); ctx.stroke(); continue;
      }
      ctx.fillStyle = z.frost ? 'rgba(160,220,255,0.28)' : `rgba(255,90,40,${0.15 + 0.15 * Math.sin(this.time * 20)})`;
      ctx.strokeStyle = z.frost ? 'rgba(220,245,255,0.8)' : 'rgba(255,150,60,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (z.warn) { const k = 1 - (z.until - this.time); const im = Assets.img['fx:fireball']; if (im) HD.draw(ctx, im, 0, 0, 16, 16, Math.round(z.x - 8 + (1 - k) * 60), Math.round(z.y - 8 - (1 - k) * 160), 16, 16); }
    }

    // the fallen, under everyone else
    for (const d of this.dead || []) if (onScreen(d.x, d.y) && this.cellVisible(d.x, d.y)) Assets.drawCorpse(ctx, d.sprite, d.x, d.y, UNIT_SIZE.soldier, d.flip, 0.95);
    ctx.strokeStyle = 'rgba(70,50,30,0.8)'; ctx.lineWidth = 0.8;                 // arrows that missed, stuck in the ground
    ctx.beginPath();
    for (const [x, y, a] of this.spent) if (onScreen(x, y)) { ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * 4, y - Math.sin(a) * 4 - 2.5); }
    ctx.stroke();

    // selected squads: where they are going, as a faint ghost of the formation
    const lw = 1 / Math.max(0.5, this.cam.z);
    for (const q of this.sel) if (q.leader.alive && q.order === 'move') {
      ctx.strokeStyle = 'rgba(255,240,140,0.6)'; ctx.lineWidth = lw; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(q.leader.x, q.leader.y); ctx.lineTo(q.tx, q.ty); ctx.stroke(); ctx.setLineDash([]);
      this.drawGhost(ctx, { q, x: q.tx, y: q.ty, face: q.faceEnd, files: 0 }, 0.45);
    }
    // a formation being drawn with a right-drag
    if (this.ghost) {
      if (this.ghostLine) {
        const [a, b] = this.ghostLine;
        ctx.strokeStyle = 'rgba(255,240,140,0.9)'; ctx.lineWidth = 1.5 * lw;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      for (const p of this.ghost) this.drawGhost(ctx, p, 0.9);
    }

    const colors = this.factions.map(f => DATA.factions[f].color);
    const list = this.units.filter(u => u.alive && !u.escaped && this.seenByPlayer(u) && onScreen(u.x, u.y)).sort((a, b) => a.y - b.y);
    for (const u of list) {                       // coloured shadows show which side a unit is on; selected squads get a ring
      const sel = this.sel.has(u.sq);
      // a soft glow in the side's colour under every man (dimmer for big blocks so the ground still shows)
      ctx.fillStyle = colors[u.side] + (u.isLeader ? 'cc' : this.men > 1 ? '55' : 'aa');
      ctx.beginPath(); ctx.ellipse(u.x, u.y + 1, u.isLeader ? 10 : 6, u.isLeader ? 3.8 : 2.4, 0, 0, Math.PI * 2); ctx.fill();
      if (u.empowered > 0) {                       // landmark power: a pulsing glow in the side's colour
        const a = (0.25 + 0.2 * Math.sin(this.time * 4 + u.x)) * (0.5 + 0.5 * u.empowered);
        const g = ctx.createRadialGradient(u.x, u.y - 6, 1, u.x, u.y - 6, 13);
        g.addColorStop(0, `rgba(255,236,150,${a * 1.4})`); g.addColorStop(1, 'rgba(255,236,150,0)');
        ctx.fillStyle = g; ctx.fillRect(u.x - 13, u.y - 19, 26, 26);
      }
      if (sel) { ctx.strokeStyle = 'rgba(120,200,255,0.95)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(u.x, u.y + 1, u.isLeader ? 12 : 7, u.isLeader ? 5 : 3, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    for (const u of list) {
      const moving = u.moving && u.atkT <= 0;
      const frame = Math.floor(u.walkT * 8) % 4;
      const alpha = u.routing ? 0.5 : u.hitT > 0 && !(Assets.img[u.sprite] || {}).anims ? 0.55 : u.hidden && u.side === this.playerSide ? 0.7 : 1;   // own troops hidden in woods: see-through
      // drawn larger than on the map (22 px, generals 28 px), outlined in their side's colour
      const size = u.isLeader ? UNIT_SIZE.leader : UNIT_SIZE.soldier, top = u.y + 2 - size;
      if (!u.spriteO) u.spriteO = Assets.outlined(u.sprite, DATA.factions[this.factions[u.side]].neutral ? '#ffffff' : colors[u.side]);   // neutral troops: white
      if (u.dir === 2) u.faceLeft = true; else if (u.dir === 3) u.faceLeft = false;          // up / down keep the last side faced
      if (u.animT == null) u.animT = Math.random() * 3;
      Assets.drawUnit(ctx, u.spriteO, u.dir, moving ? frame : 0, u.atkT > 0, u.x - size / 2, top, alpha, size,
        { t: moving ? u.walkT : this.time + u.animT, moving, atkK: 1 - u.atkT / 0.25, hurt: u.hitT > 0, hurtK: 1 - u.hitT / 0.12, left: u.faceLeft == null ? u.side === 1 : u.faceLeft });
      if (u.isLeader) {
        const im = Assets.img[u.sprite], over = im && im.fh ? (im.fh - 32 - (im.pad || 0)) * size / 32 : 0;   // above the plume
        hpBar(ctx, u.x - 9, top - over - 3, 18, u.hp / u.maxHp, '#d0c090');
        if (u.side === this.playerSide) hpBar(ctx, u.x - 9, top - over - 1, 18, u.sq.mp / u.sq.maxMp, '#6fb6ff');
      } else if (u.hp < u.maxHp && this.men === 1) {                  // big battles: no bars over every man
        hpBar(ctx, u.x - 6, top - 2, 12, u.hp / u.maxHp, u.side === 0 ? '#7cf07c' : '#ff7a6a');
      }
      if (u.tier > 1) {                                   // promoted soldiers: silver pip (tier 2), two gold pips (tier 3)
        const col = u.tier === 3 ? '#d0c090' : '#d8e0ec', px = Math.round(u.x) + 7, py = Math.round(top) + 2;
        for (let k = 0; k < u.tier - 1; k++) { ctx.fillStyle = '#1a1020'; ctx.fillRect(px - 1, py - 1 + k * 3, 4, 4); ctx.fillStyle = col; ctx.fillRect(px, py + k * 3, 2, 2); }
      }
    }
    // each block's banner rises from its middle, with its morale when shaken
    for (const q of this.squads) {
      if (!q.live || !q.seenBy || !q.seenBy[Math.max(0, this.playerSide)] && this.playerSide >= 0 && q.side !== this.playerSide) continue;
      if (!onScreen(q.cx, q.cy)) continue;
      const f = this.factions[q.side], bx = Math.round(q.cx), by = Math.round(q.cy - 14);
      if (typeof Heraldry !== 'undefined') Heraldry.draw(ctx, f, bx, by - Heraldry.poleLen(1), 1, this.time, { mine: q.side === this.playerSide, lift: 1 });
      if (q.state !== 'steady') {
        const txt = q.state === 'routing' ? 'Routing' : 'Wavering', col = q.state === 'routing' ? '#ff8a7a' : '#ffd06a';
        ctx.font = '9px PixelFont'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#140c18';
        ctx.strokeText(txt, bx, by - Heraldry.poleLen(1) - 4); ctx.fillStyle = col; ctx.fillText(txt, bx, by - Heraldry.poleLen(1) - 4);
      }
    }
    for (const p of this.projs) {
      if (!this.cellVisible(p.x, p.y)) continue;
      const im = Assets.img['fx:' + p.img];
      if (!im) continue;
      if (p.lift) {                                                     // its shadow on the ground under the arc
        ctx.fillStyle = 'rgba(10,8,16,0.25)'; ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) + 5, 4, 1.5);
      }
      ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y - (p.lift || 0)));
      if (p.img !== 'shuriken') ctx.rotate(p.angle); else ctx.rotate(this.time * 20);
      HD.draw(ctx, im, -Math.floor(im.width / 2), -Math.floor(im.height / 2));
      ctx.restore();
    }
    for (const f of this.fx) {
      if (!this.cellVisible(f.x, f.y)) continue;
      if (f.name === 'arc') {                                  // a white sword-sweep, as in the reference battles
        const k = f.t, a0 = f.a + (f.flip ? 1 : -1) * (1.1 - k * 1.6);
        ctx.strokeStyle = `rgba(255,255,255,${0.95 * (1 - k)})`; ctx.lineWidth = 2.2 * (1 - k * 0.5); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(f.x, f.y, 7 + k * 3, a0 - 0.9, a0 + 0.9); ctx.stroke();
      } else Assets.drawFx(ctx, f.name, f.t, f.x, f.y);
    }

    // fog of war over everything, soft-edged
    if (this.playerSide >= 0 && this.fog) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCanvas, 0, 0, this.fw * this.fogC, this.fh * this.fogC);
      ctx.imageSmoothingEnabled = false;
    }
    // selection box being dragged
    if (this.box) {
      ctx.strokeStyle = '#d0c090'; ctx.lineWidth = 1 / this.cam.z;
      ctx.strokeRect(this.box.x0, this.box.y0, this.box.x1 - this.box.x0, this.box.y1 - this.box.y0);
    }
    // enlarge the buffer onto the screen; then sharp text, markers and messages on top
    screen.setTransform(1, 0, 0, 1, 0, 0);
    screen.imageSmoothingEnabled = N < 1;
    screen.drawImage(this.buf, 0, 0, bw * N, bh * N);
    ctx = screen;
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    for (const t of this.texts) if (this.cellVisible(t.x, t.y)) label(ctx, t.s, t.x, t.y, t.color, 'center', 12);
    const dpr = window.devicePixelRatio || 1;
    this.drawBanners(ctx, dpr);
    this.drawGroundInfo(ctx, canvas, dpr);
    // screen-space messages
    const ss = 2 * dpr;
    ctx.setTransform(ss, 0, 0, ss, 0, 0);
    const cx = canvas.width / 2 / ss;
    // messages on a dark plate, large enough to read at a glance
    const narrow = canvas.width / dpr < 760, top = narrow ? canvas.height / ss * 0.42 : 66;
    const plate = (text, y, size, color) => {
      ctx.font = `${size}px PixelFont`;
      const room = canvas.width / ss * 0.92, tw = ctx.measureText(text).width + size * 1.2;
      if (tw > room) { size *= room / tw; ctx.font = `${size}px PixelFont`; }   // shrink to fit small screens
      const w = ctx.measureText(text).width + size * 1.2, h = size * 1.5;
      ctx.fillStyle = 'rgba(8,8,18,0.82)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - w / 2, y - h * 0.72, w, h, 4) : ctx.rect(cx - w / 2, y - h * 0.72, w, h); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 0.75; ctx.stroke();
      label(ctx, text, cx, y, color, 'center', size);
    };
    if (this.banner) plate(this.banner.text, top, this.banner.power ? 12 : 15, this.banner.power ? '#9fe8ff' : this.banner.side === this.playerSide ? '#ff8a7a' : '#d0c090');
    if (this.paused && !this.done) plate('PAUSED - give orders, then press Space or Play', this.banner ? top + 22 : top, 11, '#d0c090');
  }

  // A gate seen from above: heavy timber doors banded with iron between the wall's
  // ends, splitting and darkening as it takes damage, with a bar showing what is left;
  // once broken, splintered timbers on the cobbles.
  drawGate(ctx, g) {
    const T = this.terrain, w = T.town.wall, x0 = -w / 2, y0 = -g.half, h = g.half * 2, seed = g.x * 3 + g.y;
    ctx.save(); ctx.translate(g.x, g.y);                               // drawn as a west gate, turned to face its way
    ctx.rotate({ w: 0, e: Math.PI, n: Math.PI / 2, s: -Math.PI / 2 }[g.side]);
    if (g.open) {
      const r = makeRng(seed);
      for (let i = 0; i < 9; i++) {
        ctx.save(); ctx.translate(x0 + r() * w, y0 + r() * h); ctx.rotate(r() * Math.PI);
        ctx.fillStyle = '#2a1a10'; ctx.fillRect(-6, -1.8, 12, 3.6); ctx.fillStyle = '#7a5430'; ctx.fillRect(-5.5, -1.2, 11, 2.4);
        ctx.restore();
      }
      ctx.restore();
      return;
    }
    const k = Math.max(0, g.hp / g.maxHp);
    ctx.fillStyle = '#1e1418'; ctx.fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
    ctx.fillStyle = k > 0.5 ? '#7a5430' : k > 0.2 ? '#634328' : '#4e3420'; ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = 'rgba(30,18,10,0.55)';                              // planks
    for (let y = y0 + 3; y < y0 + h; y += 4) ctx.fillRect(x0, y, w, 1);
    ctx.fillStyle = '#3a3a46';                                          // iron bands and the seam between the doors
    ctx.fillRect(x0 + 3, y0, 2.5, h); ctx.fillRect(x0 + w - 5.5, y0, 2.5, h); ctx.fillRect(x0, -1, w, 2);
    ctx.fillStyle = '#9a9aaa'; for (const yy of [y0 + 5, -6, 5, y0 + h - 6]) { ctx.fillRect(x0 + 3.5, yy, 1.5, 1.5); ctx.fillRect(x0 + w - 5, yy, 1.5, 1.5); }
    if (k < 0.7) {                                                      // cracks as it weakens
      ctx.strokeStyle = 'rgba(15,8,6,0.85)'; ctx.lineWidth = 1.2; const r = makeRng(seed + 3);
      for (let i = 0; i < (k < 0.35 ? 6 : 3); i++) { const yy = y0 + r() * h; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + w * (0.4 + r() * 0.6), yy + (r() - 0.5) * 10); ctx.stroke(); }
    }
    if (g.hitT > 0) { ctx.fillStyle = 'rgba(255,240,200,0.35)'; ctx.fillRect(x0, y0, w, h); }
    ctx.restore();
    const up = g.side === 'w' || g.side === 'e' ? g.half : w / 2;
    if (k < 1) { const bw = 44; hpBar(ctx, g.x - bw / 2, g.y - up - 14, bw, k, '#ffb040'); }
  }


  // One squad's formation as a ghost at (p.x, p.y) facing p.face: a dot per soldier,
  // the general's banner spot, and an arrow showing which way they will face.
  drawGhost(ctx, p, alpha) {
    const q = p.q, files = p.files || q.files, col = DATA.factions[this.factions[q.side]].color;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,240,170,0.9)';
    const dot = Math.max(3, this.spacing * 0.55);
    for (const u of q.members) if (u.alive && !u.routing) { const [ox, oy] = this.slot(q, u.slotK, p.face, files); ctx.fillRect(p.x + ox - dot / 2 - 1, p.y + oy - dot / 2 - 1, dot + 2, dot + 2); }
    ctx.fillStyle = col;
    for (const u of q.members) if (u.alive && !u.routing) { const [ox, oy] = this.slot(q, u.slotK, p.face, files); ctx.fillRect(p.x + ox - dot / 2, p.y + oy - dot / 2, dot, dot); }
    ctx.fillStyle = '#d0c090'; ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    const [fx, fy] = p.face, w = this.squadWidth(q, files) / 2, tip = this.blockShape(Math.max(1, q.nFront), files).depth * this.spacing + 22;
    ctx.strokeStyle = '#d0c090'; ctx.lineWidth = 1.5;
    const k = this.spacingY, Y = v => p.y + v * k;                // stretched up and down like the block itself
    ctx.beginPath();
    ctx.moveTo(p.x + fx * tip - fy * 7, Y(fy * tip + fx * 7)); ctx.lineTo(p.x + fx * (tip + 9), Y(fy * (tip + 9))); ctx.lineTo(p.x + fx * tip + fy * 7, Y(fy * tip - fx * 7));
    ctx.moveTo(p.x - fy * w + fx * (tip - 6), Y(fx * w + fy * (tip - 6))); ctx.lineTo(p.x + fy * w + fx * (tip - 6), Y(-fx * w + fy * (tip - 6)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Squad banners: a fixed-size marker over every squad you can see, readable at any
  // zoom: the side's colour, the troop type, troops left and squad strength. Selected
  // squads are outlined in gold. Click one to select that squad.
  drawBanners(ctx, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.bannerHits = [];
    const colors = this.factions.map(f => DATA.factions[f].color), z = this.cam.z;
    const fade = z > 2.2 ? 0.55 : z > 1.6 ? 0.75 : 0.95;
    for (const q of this.squads) {
      if (!q.leader.alive || q.leader.escaped) continue;
      const vis = this.squadUnits(q).filter(u => this.seenByPlayer(u));
      if (!vis.length) continue;
      const c = q.cx != null ? { x: q.cx, y: q.cy } : centroid(vis);
      const top = c.y - 14 - (typeof Heraldry !== 'undefined' ? Heraldry.poleLen(1) : 20) - 18;     // just above the block's flag
      const sx = (c.x * this.scale + this.ox) / dpr, sy = (top * this.scale + this.oy) / dpr;
      if (sx < -40 || sy < -40 || sx > this.cw / dpr + 40 || sy > this.ch / dpr + 40) continue;
      const sel = this.sel.has(q), w = 44, h = 20, x0 = Math.round(sx - w / 2), y0 = Math.round(sy - h);
      const alive = q.members.filter(u => u.alive && !u.routing && !u.escaped).length, total = q.members.length || 1;
      ctx.globalAlpha = sel ? 1 : fade;
      ctx.fillStyle = 'rgba(12,10,22,0.85)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y0, w, h, 4) : ctx.rect(x0, y0, w, h); ctx.fill();
      ctx.fillStyle = colors[q.side]; ctx.fillRect(x0 + 2, y0 + 2, 18, h - 4);
      ctx.strokeStyle = sel ? '#d0c090' : colors[q.side]; ctx.lineWidth = sel ? 2 : 1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 4, y0 + h); ctx.lineTo(sx, y0 + h + 5); ctx.lineTo(sx + 4, y0 + h); ctx.closePath();
      ctx.fillStyle = sel ? '#d0c090' : colors[q.side]; ctx.fill();
      unitIcon(ctx, q.leader.t.type, x0 + 11, y0 + h / 2, 12);
      label(ctx, String(alive), x0 + 32, y0 + 14, q.order === 'hold' || q.order === 'move' ? '#ffffff' : '#ffd8a0', 'center', 11);
      ctx.fillStyle = '#3a1820'; ctx.fillRect(x0, y0 + h + 1, w, 3);
      ctx.fillStyle = q.side === this.playerSide ? '#7cf07c' : '#ff7a6a'; ctx.fillRect(x0, y0 + h + 1, Math.round(w * alive / total), 3);
      if (q.morale != null) {                                     // morale: blue when steady, amber wavering, red routing
        ctx.fillStyle = '#1a1020'; ctx.fillRect(x0, y0 + h + 4, w, 3);
        ctx.fillStyle = q.state === 'wavering' ? '#ffd06a' : q.state === 'routing' ? '#ff6a5a' : '#7ab8ff';
        ctx.fillRect(x0, y0 + h + 4, Math.round(w * clamp(q.morale, 0, 100) / 100), 3);
      }
      ctx.globalAlpha = 1;
      this.bannerHits.push({ q, x0: x0 * dpr, y0: y0 * dpr, x1: (x0 + w) * dpr, y1: (y0 + h + 7) * dpr });
    }
  }
  bannerAt(px, py) {
    const hit = (this.bannerHits || []).slice().reverse().find(b => px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1);
    return hit ? hit.q : null;
  }

  // What the ground under the pointer is like (bottom left), so hills and woods can be used.
  drawGroundInfo(ctx, canvas, dpr) {
    if (!this.hover || canvas.width / dpr < 760) return;
    const [x, y] = this.hover;
    if (x < 0 || y < 0 || x > this.W || y > this.H) return;
    const text = this.terrain.infoAt(x, y);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '12px PixelFont';
    const w = ctx.measureText(text).width + 16, h = 22, x0 = 10, y0 = canvas.height / dpr - h - 10;
    ctx.fillStyle = 'rgba(8,8,18,0.8)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y0, w, h, 4) : ctx.rect(x0, y0, w, h); ctx.fill();
    label(ctx, text, x0 + 8, y0 + 15, '#e8f0d8', 'left', 12);
  }

  // Battle minimap: ground, fog, your units and the enemies you can see, the view box.
  drawMinimap(mc) {
    const c = mc.getContext('2d'), k = mc.width / this.W;
    if (!this.thumb) {
      this.thumb = document.createElement('canvas'); this.thumb.width = mc.width; this.thumb.height = mc.height;
      const t = this.thumb.getContext('2d'); t.imageSmoothingEnabled = true; t.drawImage(this.bg, 0, 0, mc.width, mc.height);
    }
    c.drawImage(this.thumb, 0, 0);
    c.imageSmoothingEnabled = true;
    if (this.fog) c.drawImage(this.fogCanvas, 0, 0, mc.width, mc.height);
    const colors = this.factions.map(f => DATA.factions[f].color);
    for (const u of this.units) {
      if (!u.alive || u.escaped || !this.seenByPlayer(u)) continue;
      c.fillStyle = this.sel.has(u.sq) ? '#d0c090' : colors[u.side];
      const s = u.isLeader ? 3 : 2;
      c.fillRect(u.x * k - s / 2, u.y * k - s / 2, s, s);
    }
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.cw, this.ch);
    c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.strokeRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
  }
}

// =============================================================================
//  SKILL HANDLERS: what each hero skill does when cast. SKILL_FX[id](battle, c), where
//  c = { q: casting squad, S: skill data, x, y: target point (the hero for 'self'),
//  pw: power from hero level (for buffs), dk: pw x battle hp scale (for damage and healing), L: the hero, team: the hero's living squad,
//  near(radius, side): units of a side around (x, y), rad: the skill's area radius }.
//  To add a skill: put its numbers in DATA.skills, a handler here, and (optionally)
//  a rule in Battle.autoCast so computer heroes use it.
// =============================================================================
const SKILL_FX = {
  charge: (b, c) => { for (const u of c.team) { u.buffs.push({ spd: 1.7, until: b.time + c.S.dur }); u.run = 999; } },
  rally: (b, c) => { c.q.morale = Math.min(100, c.q.morale + 35); for (const u of c.team) { u.hp = Math.min(u.maxHp, u.hp + u.maxHp * c.S.heal * c.pw); u.buffs.push({ def: c.S.def, until: b.time + c.S.dur }); } },
  shieldwall: (b, c) => { for (const u of c.team) u.buffs.push({ def: c.S.def * c.pw, spd: c.S.spd, until: b.time + c.S.dur }); },
  eagleeye: (b, c) => { for (const u of c.team) u.buffs.push({ range: c.S.range * DATA.battle.skillRangeMul, view: c.S.view, until: b.time + c.S.dur }); },
  volley: (b, c) => {
    const { S, L, q, x, y } = c;
    for (let i = 0; i < S.arrows; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * c.rad;
      b.pending.push({ at: b.time + i * 0.08, fn: () => b.projs.push({ x: L.x, y: L.y - 6, tx: x + Math.cos(a) * r, ty: y + Math.sin(a) * r,
        tg: null, side: q.side, gid: q.id, src: L, dmg: S.dmg * c.dk, splash: 10, img: 'arrow', speed: DATA.battle.missile.skill, angle: 0, quiet: true, sx: L.x, sy: L.y - 6, arc: 60, d0: Math.max(1, Math.hypot(x - L.x, y - L.y)) }) });
    }
  },
  meteor: (b, c) => {
    const { S, L, q, x, y } = c;
    b.zones.push({ x, y, r: c.rad, until: b.time + S.delay, side: q.side, warn: true });
    b.pending.push({ at: b.time + S.delay, fn: () => {
      for (const v of c.near(c.rad, 1 - q.side)) b.damage(v, S.dmg * c.dk, q.id, true, L);
      for (let i = 0; i < 6; i++) b.addFx(i % 2 ? 'fire' : 'smoke', x + (Math.random() - 0.5) * c.rad, y + (Math.random() - 0.5) * c.rad * 0.6, 0.6);
      if (!b.headless) Assets.sfx('magic-1', 0.5);
    } });
  },
  frostfield: (b, c) => b.zones.push({ x: c.x, y: c.y, r: c.rad, until: b.time + c.S.dur, side: c.q.side, slow: c.S.slow, dps: c.S.dps * c.dk, src: c.L, gid: c.q.id, frost: true }),
  massheal: (b, c) => { for (const u of c.near(c.rad, c.q.side)) { u.hp = Math.min(u.maxHp, u.hp + c.S.heal * c.dk); b.addFx('sparkle', u.x, u.y - 8, 0.5); } },
  bless: (b, c) => { for (const u of c.near(c.rad, c.q.side)) u.buffs.push({ atk: c.S.atk, until: b.time + c.S.dur }); },
  // the whole squad vanishes and reappears around the target point, facing the same way
  blink: (b, c) => b.teleportSquad(c.q, c.x, c.y),
};

function faceDir(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 2 : 3;
  return dy < 0 ? 1 : 0;
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function udist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function centroid(list) {
  if (!list.length) return { x: 0, y: 0 };
  return { x: list.reduce((s, u) => s + u.x, 0) / list.length, y: list.reduce((s, u) => s + u.y, 0) / list.length };
}

// Small troop-type symbols for squad banners, centred on (x, y), s pixels across.
function unitIcon(ctx, type, x, y, s) {
  const r = s / 2;
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = Math.max(1.2, s / 8); ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 2;
  ctx.beginPath();
  switch (type) {
    case 'cavalry':                                       // horseshoe
      ctx.arc(0, -r * 0.1, r * 0.7, Math.PI * 0.85, Math.PI * 2.15); ctx.stroke(); break;
    case 'beast':                                         // paw
      ctx.arc(0, r * 0.3, r * 0.42, 0, Math.PI * 2); ctx.fill();
      for (const a of [-0.9, 0, 0.9]) { ctx.beginPath(); ctx.arc(Math.sin(a) * r * 0.72, -r * 0.45 + Math.abs(a) * r * 0.25, r * 0.2, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'shooter':                                       // bow and arrow
      ctx.arc(-r * 0.35, 0, r * 0.85, -Math.PI * 0.42, Math.PI * 0.42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.6, 0); ctx.lineTo(r * 0.85, 0); ctx.moveTo(r * 0.45, -r * 0.35); ctx.lineTo(r * 0.85, 0); ctx.lineTo(r * 0.45, r * 0.35); ctx.stroke(); break;
    case 'artillery':                                     // cannonball with a fuse
      ctx.arc(-r * 0.1, r * 0.15, r * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.35); ctx.lineTo(r * 0.7, -r * 0.8); ctx.stroke(); break;
    case 'mage':                                          // four-point star
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, d = i % 2 ? r * 0.3 : r * 0.9; i ? ctx.lineTo(Math.sin(a) * d, -Math.cos(a) * d) : ctx.moveTo(0, -d); }
      ctx.closePath(); ctx.fill(); break;
    case 'healer':                                        // cross
      ctx.fillRect(-r * 0.22, -r * 0.8, r * 0.44, r * 1.6); ctx.fillRect(-r * 0.8, -r * 0.22, r * 1.6, r * 0.44); break;
    default:                                              // infantry: a sword
      ctx.moveTo(-r * 0.7, r * 0.7); ctx.lineTo(r * 0.75, -r * 0.75); ctx.moveTo(-r * 0.6, r * 0.05); ctx.lineTo(-r * 0.05, r * 0.6); ctx.stroke();
  }
  ctx.restore();
}

function hpBar(ctx, x, y, w, frac, color) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#1a1020'; ctx.fillRect(x - 1, y - 1, w + 2, 3);
  ctx.fillStyle = '#5a1f1f'; ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = color; ctx.fillRect(x, y, Math.max(0, Math.round(w * frac)), 1);
}
