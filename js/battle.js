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
const UNIT_SIZE = { soldier: 22, leader: 25 };   // battle sprites are 16 px, drawn this big

class Battle {
  constructor(opts) {
    const B = DATA.battle;
    this.W = B.width; this.H = B.height;
    this.opts = opts;      // { attackers, defenders, attFaction, defFaction, spotName, spotId, playerSide, headless }
    this.factions = [opts.attFaction, opts.defFaction];
    this.playerSide = opts.playerSide === 'att' ? 0 : opts.playerSide === 'def' ? 1 : -1;
    this.headless = !!opts.headless;
    this.units = []; this.squads = []; this.projs = []; this.fx = []; this.texts = [];
    this.zones = []; this.pending = []; this.custom = {};
    this.time = 0; this.limit = DATA.battleTimeLimit;
    this.done = false; this.banner = null;
    this.xp = {};                            // gid -> XP earned from kills this battle
    this.terrain = new Terrain(opts.spotId, this.W, this.H);
    this.boosts = opts.boosts || [null, null];   // landmark powers for each side: { unit, k, L } or null
    this.placeSquads(opts.attackers, 0);
    this.placeSquads(opts.defenders, 1);
    // where each side expects to find the enemy before it has seen them
    this.home = [0, 1].map(s => centroid(this.squads.filter(q => q.side === s).map(q => q.leader)));
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
      this.cam = { x: me.x + (this.playerSide === 1 ? -260 : 260), y: me.y, z: 0.95 };
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
    const rows = (walled ? [[back, T.wallX + 50], [front, T.wallX + 135]] : [[front, 360], [back, 265]]).filter(r => r[0].length);
    // where every squad would stand for a given sideways shift / forward step
    const layout = (shift, step) => {
      const out = [];
      for (const [list, depth] of rows) {
        const ws = list.map(q => this.squadWidth(q)), total = ws.reduce((a, b) => a + b, 0);
        const g = Math.max(10, Math.min(gap, (H - 140 - total) / Math.max(1, list.length - 1)));
        let y = H / 2 + shift - (total + g * (list.length - 1)) / 2;
        list.forEach((q, i) => {
          const x = walled ? depth : side === 0 ? depth + step : W - depth - step;
          out.push({ q, x, y: clamp(y + ws[i] / 2, 60, H - 60) }); y += ws[i] + g;
        });
      }
      return out;
    };
    let best = layout(0, 0);
    if (!walled && side !== this.playerSide) {           // seek high ground (backline counts most)
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

  // A general's squad: the hero and their soldiers (placed later by putSquad).
  makeSquad(g, side, row, faceX) {
    const sq = {
      id: g.id, side, members: [], order: side === 1 ? 'hold' : 'advance', tx: 0, ty: 0,
      face: [faceX, 0], faceEnd: [faceX, 0], files: 0, auto: true, cd: {}, castT: Math.random(), skills: DATA.skillsOf(g.id).slice(),
      back: DATA.roleOf(g.id) === 'back', row, level: g.level || 1, chargeT: -99,
    };
    const L = DATA.battle.mp;
    sq.maxMp = L.base + L.perLevel * sq.level; sq.mp = sq.maxMp * L.start;
    // signature abilities the hero has learned (level 15 and 30)
    (g.sig || []).forEach((s, t) => { if (s && sq.level >= DATA.signature.levels[t]) { this.custom[s.id] = s; sq.skills.push(s.id); } });
    sq.leader = this.makeUnit(g, side, true, 0, 0, null, 1, sq);
    this.units.push(sq.leader);
    const mix = g.mix || [], lv = g.lv || [];
    for (let k = 0; k < g.troops; k++) {
      const u = this.makeUnit(g, side, false, 0, 0, mix[k], lv[k] || 1, sq);
      u.slotK = k;
      sq.members.push(u); this.units.push(u);
    }
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

  // Squad shape: soldiers per rank (files), how wide and how deep it stands.
  autoFiles(n) { return clamp(Math.round(Math.sqrt(n * 2.2)), 2, 8); }
  filesOf(sq) { return sq.files || this.autoFiles(Math.max(1, sq.nFront || 0, sq.nBack || 0)); }
  squadWidth(sq, files = this.filesOf(sq)) { return Math.max(1, Math.min(files, Math.max(sq.nFront, sq.nBack, 1))) * DATA.battle.spacing; }
  squadDepth(sq, files = this.filesOf(sq)) {
    const D = DATA.battle.rankDepth;
    return (Math.ceil(sq.nFront / files) + Math.ceil(sq.nBack / files) + 1) * D + D;
  }

  // Where soldier k stands relative to their general, facing the way the squad faces:
  // frontline soldiers in ranks in front of the general, backline soldiers in ranks
  // behind, `files` soldiers to a rank (a short last rank is centred).
  slot(sq, k, face = sq.face, files = this.filesOf(sq)) {
    const B = DATA.battle, SP = B.spacing, DP = B.rankDepth;
    const back = sq.backIdx[k] != null;
    const i = (back ? sq.backIdx[k] : sq.frontIdx[k]) ?? 0;
    const n = Math.max(1, back ? sq.nBack : (sq.nFront || sq.nBack)), w = Math.max(1, Math.min(n, files));
    const rank = Math.floor(i / w), file = i % w, inRank = Math.min(w, n - rank * w);
    const l = (file - (inRank - 1) / 2) * SP, f = back ? -(DP + 2 + rank * DP) : DP + 2 + rank * DP;
    const [fx, fy] = face;
    return [fx * f - fy * l, fy * f + fx * l];
  }

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
    const hp = Math.round((isLeader ? t.hp * 5 : t.hp) * boost * sb.hp * (1 + (P.hp || 0) * k));
    const V = DATA.battle.vision;
    return {
      side, gid: g.id, sq, isLeader, t, back: isLeader ? DATA.roleOf(g.id) === 'back' : t.role === 'back',
      heal: t.type === 'healer', cav: t.type === 'cavalry', run: 0,
      sprite: isLeader ? Assets.genSprite(g.id) : Assets.unitSprite(t),
      x, y, hp, maxHp: hp,
      atk: (isLeader ? t.atk * 1.6 : t.atk) * boost * sb.atk * (1 + (P.atk || 0) * k),
      def: (isLeader ? t.def + 2 : t.def + sb.def) + (P.def || 0) * k,
      empowered: k, splash: (t.splash || 0) * (1 + (P.splash || 0) * k),
      lv: slv, tier: isLeader ? 0 : DATA.tierOf(slv), kills: 0,
      spd: t.spd * DATA.battle.speedMul, range: t.range * (1 + (P.range || 0) * k) * (t.range > 30 ? DATA.battle.rangeMul : 1), cd: t.cd,
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
      for (const q of squads) files.set(q, clamp(Math.round(each / B.spacing), 2, 16));
    }
    const fOf = q => files.get(q) || this.filesOf(q);
    const out = [];
    let back = 0, prevDepth = 0;
    rows.forEach((row, r) => {
      const ws = row.map(q => this.squadWidth(q, fOf(q))), total = ws.reduce((a, b) => a + b, 0) + gap * (row.length - 1);
      const depth = Math.max(...row.map(q => this.squadDepth(q, fOf(q))));
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
  // up nearby (wall defenders always man their walls).
  aiOrders() {
    for (const q of this.squads) {
      if (q.side === this.playerSide || !q.leader.alive || q.order !== 'hold') continue;
      if (q.side === 1 && this.terrain.walls) continue;
      const near = this.units.some(e => e.side !== q.side && e.alive && e.seen[q.side] && udist(e, q.leader) < 380);
      if (near || this.time > 70) q.order = 'advance';
    }
  }

  // ------------------------------------------------------------------ skills
  sk(id) { return DATA.skills[id] || this.custom[id]; }

  canCast(q, id) {
    const S = this.sk(id);
    return q.leader.alive && !q.leader.routing && q.mp >= S.mp && !(q.cd[id] > this.time);
  }

  // How far a skill reaches and how big an area it covers, on this big field.
  reach(S) { return (S.range || 0) * DATA.battle.rangeMul; }
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
    if (S.sig) { this.castSig(q, S, x, y, pw, near); say(S.name + '!', '#ffd84a'); if (!this.headless && q.side === this.playerSide) Assets.sfx('power-up', 0.35); return true; }
    const fx = SKILL_FX[id];
    if (fx) fx(this, { q, S, x, y, pw, L, team, near, rad: this.rad(S) });
    say(S.name + '!', '#9fd8ff');
    if (!this.headless && q.side === this.playerSide) Assets.sfx('power-up', 0.3);
    return true;
  }

  // A hero's own signature ability (see DATA.rollSignature).
  castSig(q, S, x, y, pw, near) {
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
        if (S.range > 60) this.projs.push({ x: L.x, y: L.y - 6, tx: e.x, ty: e.y - 6, tg: e, side: q.side, gid: q.id, src: L, dmg: S.dmg * pw, splash: 0, img: S.proj, speed: 340, angle: 0, pierce: true });
        else { this.damage(e, S.dmg * pw, q.id, false, L); this.addFx('slash', e.x, e.y - 6, 0.4); this.addFx('hit', e.x, e.y - 8, 0.4); }
        big(e, '!!', '#ff8a5a');
        break;
      }
      case 'drain': {
        const e = pick(); if (!e) return;
        const before = e.hp; this.damage(e, S.dmg * pw, q.id, true, L);
        const got = Math.max(0, before - Math.max(0, e.hp)) * S.steal;
        const team = this.units.filter(u => u.sq === q && u.alive);
        for (const u of team) u.hp = Math.min(u.maxHp, u.hp + got / Math.max(1, team.length) * 2);
        this.addFx('sparkle', L.x, L.y - 8, 0.6); this.addFx('smoke', e.x, e.y - 6, 0.5);
        break;
      }
      case 'blast':
        this.projs.push({ x: L.x, y: L.y - 6, tx: x, ty: y, tg: null, side: q.side, gid: q.id, src: L, dmg: S.dmg * pw, splash: this.rad(S), img: S.proj, speed: 210, angle: 0, big: true });
        break;
      case 'nova':
        for (const v of near(this.rad(S), foe)) this.damage(v, S.dmg * pw, q.id, true, L);
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; this.addFx(S.element === 'ice' ? 'sparkle' : 'fire', L.x + Math.cos(a) * this.rad(S) * 0.7, L.y + Math.sin(a) * this.rad(S) * 0.45, 0.5); }
        this.zones.push({ x: L.x, y: L.y, r: this.rad(S), until: this.time + 0.4, side: q.side, ring: true });
        break;
      case 'aura':
        for (const u of near(this.rad(S), q.side)) u.buffs.push({ atk: 1 + (S.atk - 1) * pw, def: S.def, until: this.time + S.dur });
        this.zones.push({ x: L.x, y: L.y, r: this.rad(S), until: this.time + 0.6, side: q.side, ring: true, good: true });
        break;
      case 'mend':
        for (const u of near(this.rad(S), q.side)) { u.hp = Math.min(u.maxHp, u.hp + S.heal * pw); this.addFx('sparkle', u.x, u.y - 8, 0.5); }
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
        let sp = this.terrain.speedAt(u.x, u.y) * u.b.spd * this.terrain.slopeFactor(u.x, u.y, vx, vy);   // uphill is slow going
        if (u.frontFoe && u.frontFoeD < DATA.roles.front.pinRadius && !u.routing) sp *= DATA.roles.front.pinSlow;   // held up by a frontline enemy
        for (const z of this.zones) if (z.slow && z.side !== u.side && Math.hypot(u.x - z.x, u.y - z.y) <= z.r) sp *= z.slow;
        vx *= sp; vy *= sp;
      }
      u.moving = !!(vx || vy);
      if (vx || vy) {
        const T = this.terrain, nx = u.x + vx * dt, ny = u.y + vy * dt;   // solid ground (walls) blocks; slide along it
        if (u.cav) u.run += Math.hypot(vx, vy) * dt;                     // cavalry builds up a charge
        if (T.speedAt(nx, ny) > 0) { u.x = nx; u.y = ny; }
        else if (T.speedAt(nx, u.y) > 0) u.x = nx;
        else if (T.speedAt(u.x, ny) > 0) u.y = ny;
        u.walkT += dt;
        if (u.atkT <= 0) u.dir = faceDir(vx, vy);
      }
      if (u.sq.order === 'retreat' || u.routing) { if (u.x < -6 || u.x > this.W + 6) u.escaped = true; }
      else u.x = clamp(u.x, 4, this.W - 4);
      u.y = clamp(u.y, 14, this.H - 6);
    }

    this.separate();
    this.updateProjectiles(dt);

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
      const wp = T.gateWaypoint(u.x, u.y, x, y);
      const gx = wp ? wp[0] : x, gy = wp ? wp[1] : y, d = Math.hypot(gx - u.x, gy - u.y);
      if (d < 2) return [0, 0];
      const s = Math.min(speed, d * 4);
      return [(gx - u.x) / d * s, (gy - u.y) / d * s];
    };
    if (u.routing) {                                     // general fell: run away and vanish
      u.routT -= dt;
      if (u.routT <= 0) { u.alive = false; this.addFx('smoke', u.x, u.y - 6, 0.5); }
      return [(u.side === 0 ? -1 : 1) * u.spd * 1.3, 0];
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
    const walled = u.side === 1 && T.walls && u.x > T.wallX;
    const kite = u.back && u.frontFoe && u.frontFoeD < R.kiteRange && u.cdLeft > 0.15 && !walled;
    if (kite) {                                         // backline steps away from a frontline enemy
      const f = u.frontFoe, fd = u.frontFoeD || 1;
      return [(u.x - f.x) / fd * u.spd * R.kiteSpeed, (u.y - f.y) / fd * u.spd * R.kiteSpeed];
    }
    if (tg) {
      if (d <= range + 4) {
        u.charging = false;
        u.dir = faceDir(tg.x - u.x, tg.y - u.y);
        if (u.cdLeft <= 0 && !u.heal) { this.attack(u, tg); u.cdLeft = u.cd; u.atkT = 0.25; }
        return [0, 0];
      }
      // engagement charge: pushing frontline troops break into a run near their target
      const CH = DATA.battle.charge, pushing = q.order === 'advance' || q.order === 'attack';
      let speed = u.spd;
      if (!u.back && pushing && d < CH.dist) {
        speed *= CH.speed;
        if (!u.charging) { u.charging = true; u.impact = true; this.chargeCry(q); }
      } else { u.charging = false; if (!pushing) u.impact = false; }
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
  pickTarget(u) {
    const q = u.sq, T = this.terrain, G = DATA.roles.front.guardRadius;
    const walled = u.side === 1 && T.walls && u.x > T.wallX, inside = e => e.x > T.wallX + 6;
    const anchor = u.isLeader ? (q.order === 'hold' ? { x: q.tx, y: q.ty } : u) : q.leader.alive ? q.leader : u;
    const leash = q.order === 'hold' ? 150 : q.order === 'attack' ? 240 : u.isLeader ? 1e9 : 170;
    const mine = u.back ? [] : this.units.filter(a => a.side === u.side && a.back && a.alive && !a.routing && udist(a, u) < 260);
    let best = null, bd = 1e9;
    for (const e of this.units) {
      if (e.side === u.side || !e.alive || e.escaped || e.routing || !e.seen[u.side]) continue;
      const d2 = (e.x - u.x) ** 2 + (e.y - u.y) ** 2, r2 = (this.unitReach(u, e) + 4) ** 2;
      if (Math.hypot(e.x - anchor.x, e.y - anchor.y) > leash && d2 > r2) continue;
      if (walled && !inside(e) && d2 > r2) continue;
      let s = d2;
      if (q.order === 'attack' && e.sq === q.target?.sq) s -= 40000;          // ordered target first
      if (mine.length && mine.some(a => Math.abs(a.x - e.x) < G && Math.abs(a.y - e.y) < G)) s -= G * G;
      if (s < bd) { bd = s; best = e; }
    }
    return best;
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
          if (d2 < P2 && d2 > 0.0001) {
            const d = Math.sqrt(d2), push = (P - d) * 0.12, nx = a.x - dx / d * push, ny = a.y - dy / d * push;
            if (this.terrain.passable(nx, ny)) { a.x = nx; a.y = ny; }
          }
        }
      }
    }
    if (this.terrain.walls) for (const u of live)                 // nobody gets shoved into a wall
      if (this.terrain.speedAt(u.x, u.y) === 0) u.x = u.x < this.terrain.wallX + 4 ? this.terrain.wallX - 1 : this.terrain.wallX + 9;
  }

  updateProjectiles(dt) {
    for (const p of this.projs) {
      if (p.tg && p.tg.alive) { p.tx = p.tg.x; p.ty = p.tg.y - 6; }
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      p.angle = Math.atan2(dy, dx);
      if (d <= step + 2) {
        p.dead = true;
        if (p.splash) {
          if (p.big) for (let i = 0; i < 5; i++) this.addFx(i % 2 ? 'smoke' : 'fire', p.tx + (Math.random() - 0.5) * p.splash, p.ty + (Math.random() - 0.5) * p.splash * 0.6, 0.6);
          else if (!p.quiet) this.addFx('fire', p.tx, p.ty, 0.4); else this.addFx('hit', p.tx, p.ty, 0.2);
          for (const v of this.units) if (v.alive && !v.escaped && v.side !== p.side && Math.hypot(v.x - p.tx, v.y - 6 - p.ty) <= p.splash) this.damage(v, p.dmg, p.gid, true, p.src);
        } else if (p.tg && p.tg.alive) {
          this.addFx('hit', p.tx, p.ty, 0.25);
          this.damage(p.tg, p.dmg, p.gid, true, p.src);
        }
      } else { p.x += dx / d * step; p.y += dy / d * step; }
    }
    this.projs = this.projs.filter(p => !p.dead);
  }

  mostHurt(u) {
    let best = null, worst = 0.999;
    for (const a of this.units) {
      if (a.side !== u.side || !a.alive || a.escaped || a.routing) continue;
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
  sizeUp() {
    const live = this.units.filter(u => u.alive && !u.escaped && !u.routing);
    const grid = new Map(), C = 64;
    const T = this.terrain, B = DATA.battle, spot = B.forestSpot;
    for (const u of live) {
      u.seen[0] = u.seen[1] = false;
      u.h = T.heightAt(u.x, u.y); u.hidden = T.hidesAt(u.x, u.y) && u.revealT <= 0;
      const k = Math.floor(u.x / C) * 4096 + Math.floor(u.y / C);
      (grid.get(k) || grid.set(k, []).get(k)).push(u);
    }
    for (const u of live) {
      u.closestD = 1e9; u.frontFoe = null; u.frontFoeD = 1e9;
      const r = this.viewOf(u), n = Math.ceil(r / C), cx = Math.floor(u.x / C), cy = Math.floor(u.y / C);
      for (let gx = cx - n; gx <= cx + n; gx++) for (let gy = cy - n; gy <= cy + n; gy++) {
        const cell = grid.get(gx * 4096 + gy); if (!cell) continue;
        for (const e of cell) {
          if (e.side === u.side) continue;
          const d = Math.hypot(e.x - u.x, e.y - u.y);
          if (d <= r && (!e.hidden || d <= spot)) e.seen[u.side] = true;     // troops in woods are only seen up close
          if (d < u.closestD) u.closestD = d;
          if (!e.back && d < u.frontFoeD) { u.frontFoeD = d; u.frontFoe = e; }
        }
      }
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
      for (const look of [6, 14, 26, 40]) s = Math.min(s, T.speedAt(u.x + Math.cos(a) * look, u.y + Math.sin(a) * look));
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
    u.run = 0; u.impact = false; u.revealT = 2;                       // fighting gives away a hidden position
    if (!u.t.proj) dmg *= 1 + DATA.battle.hills.melee * clamp(u.h - tg.h, -1, 1);   // fighting downhill
    if (u.t.antiCav && tg.cav) dmg *= DATA.antiCavMul;               // spears against horses
    if (u.back) dmg *= R.power;                                    // shooting from safety hits hard...
    if (u.back && u.closestD < R.exposedRange) dmg *= R.meleePenalty;   // ...but caught in melee, much less
    if (u.t.proj) {
      this.projs.push({ x: u.x, y: u.y - 6, tx: tg.x, ty: tg.y - 6, tg, side: u.side, gid: u.gid, src: u, dmg,
        splash: u.splash || 0, img: u.t.proj, speed: u.t.splash ? 170 : 250, angle: 0 });
      if (!this.headless && u.t.splash && this.seenByPlayer(u)) Assets.sfx('magic-1', 0.25);
    } else {
      this.addFx('slash', tg.x, tg.y - 6, 0.25);
      if (!this.headless && this.seenByPlayer(u)) Assets.sfx('sword', 0.3);
      this.damage(tg, dmg, u.gid, false, u);
    }
  }

  damage(v, amount, byGid, ranged, src) {
    if (!v.alive) return;
    if (ranged) amount *= 1 - this.terrain.coverAt(v.x, v.y);
    const fort = v.side === 1 && this.terrain.walls && v.x > this.terrain.wallX ? DATA.ground.wall.fortify : 0;
    const def = (v.def + v.b.def + fort) * (ranged ? 1 - DATA.roles.back.pierce : 1);       // arrows and spells pierce armour
    const dmg = Math.max(1, Math.round(amount * (0.85 + Math.random() * 0.3) - def));
    v.hp -= dmg; v.hitT = 0.12;
    if (!this.headless) this.texts.push({ x: v.x, y: v.y - 16, s: String(dmg), life: 0.6, color: v.isLeader ? '#ffd84a' : '#ffffff' });
    if (v.hp <= 0) {
      v.alive = false;
      if (byGid) this.xp[byGid] = (this.xp[byGid] || 0) + (v.isLeader ? DATA.leveling.killGeneral : DATA.leveling.killSoldier);
      if (src) src.kills++;
      if (!v.isLeader) this.rank(v.sq);                                 // the ranks close up
      this.addFx('smoke', v.x, v.y - 6, 0.5);
      if (!this.headless && this.seenByPlayer(v)) Assets.sfx('kill', 0.35);
      if (v.isLeader) {
        for (const u of v.sq.members) if (u.alive) { u.routing = true; u.routT = 1.2; }
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
      const left = q.members.filter(u => (u.alive || u.escaped) && !u.routing);
      const troops = left.length;
      const L = DATA.leveling, won = (side === 0) === (winnerSide === 0);
      const xp = (this.xp[g.id] || 0) + L.fought + (won ? L.won : 0);
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
      troops: q.members.filter(u => u.alive && !u.routing && !u.escaped).length,
    }));
  }

  // ------------------------------------------------------------------ fog of war
  seenByPlayer(u) { return this.playerSide < 0 || u.side === this.playerSide || u.seen[this.playerSide]; }
  cellVisible(x, y) {
    if (this.playerSide < 0) return true;
    const i = Math.floor(y / this.fogC) * this.fw + Math.floor(x / this.fogC);
    return this.visible[i] === 1;
  }

  updateFog() {
    if (this.playerSide < 0) return;
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
    cv.width = this.W * 2; cv.height = this.H * 2;            // drawn at twice the detail
    const ctx = cv.getContext('2d');
    ctx.scale(2, 2);
    let seed = 0; for (const ch of this.opts.spotName) seed = seed * 31 + ch.charCodeAt(0);
    const rng = makeRng(seed);
    const T = Assets.img;
    // Calm grass: broad soft patches between the two grass tiles' average colours,
    // with the tile texture laid over faintly (no more tile checkerboard).
    const avg = im => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d');
      x.drawImage(im, 0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data; };
    const ga = avg(T['tile:ground_grass']), gb = avg(T['tile:ground_grass2']);
    const noise = makeNoise(seed & 0xffff);
    const lw = Math.ceil(this.W / 4), lh = Math.ceil(this.H / 4);
    const lo = document.createElement('canvas'); lo.width = lw; lo.height = lh;
    const lc = lo.getContext('2d'), id = lc.createImageData(lw, lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const n = noise(x / 22, y / 22) * 0.7 + noise(x / 7 + 40, y / 7) * 0.3;
      const t = Math.round(Math.max(0, Math.min(1, (n - 0.3) / 0.45)) * 4) / 4 * 0.85;
      const i = (y * lw + x) * 4;
      for (let k = 0; k < 3; k++) id.data[i + k] = ga[k] + (gb[k] - ga[k]) * t;
      id.data[i + 3] = 255;
    }
    lc.putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(lo, 0, 0, lw * 4, lh * 4);
    ctx.globalAlpha = 0.16;
    for (let y = 0; y < this.H; y += 16) for (let x = 0; x < this.W; x += 16) HD.draw(ctx, T['tile:ground_grass'], x, y);
    ctx.globalAlpha = 1;
    const tint = (DATA.regions[this.terrain.region] || {}).battle;
    if (tint) {                                    // recolour the grass to the region's ground (snow, sand, ash...)
      ctx.globalCompositeOperation = 'color'; ctx.fillStyle = tint; ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = this.terrain.region === 'frost' ? 0.8 : 0.55; ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    }
    const lush = !['frost', 'sun', 'ember'].includes(this.terrain.region);
    for (let i = 0; i < 90; i++) {
      const n = ['grass_tuft', 'grass_tuft', 'bush'][Math.floor(rng() * 3)];
      const x = Math.floor(rng() * (this.W - 16)), y = Math.floor(rng() * (this.H - 16));
      if (lush && this.terrain.kindAt(x + 8, y + 8) === GROUND.grass) HD.draw(ctx, T['tile:' + n], x, y);
    }
    this.terrain.draw(ctx);
    return cv;
  }

  // Camera: world point at the centre of the screen and zoom (screen px per world px).
  fit(canvas) {
    const dpr = window.devicePixelRatio || 1, c = this.cam;
    const minZ = Math.max(canvas.width / this.W, canvas.height / this.H) / dpr;
    c.z = clamp(c.z, minZ, 3.5);
    this.scale = c.z * dpr;
    const hw = canvas.width / 2 / this.scale, hh = canvas.height / 2 / this.scale;
    c.x = clamp(c.x, hw, this.W - hw); c.y = clamp(c.y, hh, this.H - hh);
    this.ox = Math.round(canvas.width / 2 - c.x * this.scale);
    this.oy = Math.round(canvas.height / 2 - c.y * this.scale);
    this.cw = canvas.width; this.ch = canvas.height;
  }
  toWorld(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; }
  zoomAt(f, px, py) {
    const [wx, wy] = this.toWorld(px, py), dpr = window.devicePixelRatio || 1;
    this.cam.z = clamp(this.cam.z * f, 0.3, 3.5);
    const s = this.cam.z * dpr;
    this.cam.x = wx - (px - this.cw / 2) / s; this.cam.y = wy - (py - this.ch / 2) / s;
  }

  render(ctx, canvas) {
    this.fit(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16241a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    ctx.imageSmoothingEnabled = this.scale < 2;
    ctx.drawImage(this.bg, 0, 0, this.W, this.H);
    ctx.imageSmoothingEnabled = false;
    const [vx0, vy0] = this.toWorld(0, 0), [vx1, vy1] = this.toWorld(canvas.width, canvas.height);
    const onScreen = (x, y) => x > vx0 - 30 && x < vx1 + 30 && y > vy0 - 40 && y < vy1 + 30;

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
      ctx.fillStyle = colors[u.side] + (u.isLeader ? 'ee' : 'aa');
      ctx.beginPath(); ctx.ellipse(u.x, u.y + 1, u.isLeader ? 10 : 7.5, u.isLeader ? 3.8 : 3, 0, 0, Math.PI * 2); ctx.fill();
      if (u.empowered > 0) {                       // landmark power: a pulsing glow in the side's colour
        const a = (0.25 + 0.2 * Math.sin(this.time * 4 + u.x)) * (0.5 + 0.5 * u.empowered);
        const g = ctx.createRadialGradient(u.x, u.y - 6, 1, u.x, u.y - 6, 13);
        g.addColorStop(0, `rgba(255,236,150,${a * 1.4})`); g.addColorStop(1, 'rgba(255,236,150,0)');
        ctx.fillStyle = g; ctx.fillRect(u.x - 13, u.y - 19, 26, 26);
      }
      if (sel) { ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(u.x, u.y + 1, u.isLeader ? 12 : 9, u.isLeader ? 5 : 3.8, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    for (const u of list) {
      const moving = u.moving && u.atkT <= 0;
      const frame = Math.floor(u.walkT * 8) % 4;
      const alpha = u.routing ? 0.5 : u.hitT > 0 ? 0.55 : u.hidden && u.side === this.playerSide ? 0.7 : 1;   // own troops hidden in woods: see-through
      // drawn larger than on the map (22 px, generals 25 px), outlined in their side's colour
      const size = u.isLeader ? UNIT_SIZE.leader : UNIT_SIZE.soldier, top = u.y + 2 - size;
      if (!u.spriteO) u.spriteO = Assets.outlined(u.sprite, DATA.factions[this.factions[u.side]].neutral ? '#ffffff' : colors[u.side]);   // neutral troops: white
      Assets.drawUnit(ctx, u.spriteO, u.dir, moving ? frame : 0, u.atkT > 0, u.x - size / 2, top, alpha, size);
      if (u.isLeader) {
        const fx = Math.round(u.x + 5), fy = Math.round(top - 9);
        ctx.fillStyle = '#1a1020'; ctx.fillRect(fx - 1, fy - 1, 3, 13); ctx.fillRect(fx + 1, fy - 1, 9, 7);
        ctx.fillStyle = '#7a5a36'; ctx.fillRect(fx, fy, 1, 11);
        ctx.fillStyle = colors[u.side]; ctx.fillRect(fx + 1, fy, 8, 5);
        hpBar(ctx, u.x - 9, top - 3, 18, u.hp / u.maxHp, '#ffd84a');
        if (u.side === this.playerSide) hpBar(ctx, u.x - 9, top - 1, 18, u.sq.mp / u.sq.maxMp, '#6fb6ff');
      } else if (u.hp < u.maxHp) {
        hpBar(ctx, u.x - 6, top - 2, 12, u.hp / u.maxHp, u.side === 0 ? '#7cf07c' : '#ff7a6a');
      }
      if (u.tier > 1) {                                   // promoted soldiers: silver pip (tier 2), two gold pips (tier 3)
        const col = u.tier === 3 ? '#ffd84a' : '#d8e0ec', px = Math.round(u.x) + 7, py = Math.round(top) + 2;
        for (let k = 0; k < u.tier - 1; k++) { ctx.fillStyle = '#1a1020'; ctx.fillRect(px - 1, py - 1 + k * 3, 4, 4); ctx.fillStyle = col; ctx.fillRect(px, py + k * 3, 2, 2); }
      }
    }
    for (const p of this.projs) {
      if (!this.cellVisible(p.x, p.y)) continue;
      const im = Assets.img['fx:' + p.img];
      if (!im) continue;
      ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
      if (p.img !== 'shuriken') ctx.rotate(p.angle); else ctx.rotate(this.time * 20);
      HD.draw(ctx, im, -Math.floor(im.width / 2), -Math.floor(im.height / 2));
      ctx.restore();
    }
    for (const f of this.fx) if (this.cellVisible(f.x, f.y)) Assets.drawFx(ctx, f.name, f.t, f.x, f.y);
    for (const t of this.texts) if (this.cellVisible(t.x, t.y)) label(ctx, t.s, t.x, t.y, t.color, 'center', 12);

    // fog of war over everything, soft-edged
    if (this.playerSide >= 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCanvas, 0, 0, this.fw * this.fogC, this.fh * this.fogC);
      ctx.imageSmoothingEnabled = false;
    }
    // selection box being dragged
    if (this.box) {
      ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 1 / this.cam.z;
      ctx.strokeRect(this.box.x0, this.box.y0, this.box.x1 - this.box.x0, this.box.y1 - this.box.y0);
    }
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
    if (this.banner) plate(this.banner.text, top, this.banner.power ? 12 : 15, this.banner.power ? '#9fe8ff' : this.banner.side === this.playerSide ? '#ff8a7a' : '#ffe680');
    if (this.paused && !this.done) plate('PAUSED - give orders, then press Space or Play', this.banner ? top + 22 : top, 11, '#ffe680');
  }

  // One squad's formation as a ghost at (p.x, p.y) facing p.face: a dot per soldier,
  // the general's banner spot, and an arrow showing which way they will face.
  drawGhost(ctx, p, alpha) {
    const q = p.q, files = p.files || this.filesOf(q), col = DATA.factions[this.factions[q.side]].color;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,240,170,0.9)';
    for (const u of q.members) if (u.alive && !u.routing) { const [ox, oy] = this.slot(q, u.slotK, p.face, files); ctx.fillRect(p.x + ox - 3.5, p.y + oy - 3.5, 7, 7); }
    ctx.fillStyle = col;
    for (const u of q.members) if (u.alive && !u.routing) { const [ox, oy] = this.slot(q, u.slotK, p.face, files); ctx.fillRect(p.x + ox - 2.5, p.y + oy - 2.5, 5, 5); }
    ctx.fillStyle = '#ffe680'; ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    const D = DATA.battle.rankDepth, [fx, fy] = p.face, w = this.squadWidth(q, files) / 2, tip = Math.ceil(Math.max(1, q.nFront) / files) * D + D + 8;
    ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x + fx * tip - fy * 7, p.y + fy * tip + fx * 7); ctx.lineTo(p.x + fx * (tip + 9), p.y + fy * (tip + 9)); ctx.lineTo(p.x + fx * tip + fy * 7, p.y + fy * tip - fx * 7);
    ctx.moveTo(p.x - fy * w + fx * (tip - 6), p.y + fx * w + fy * (tip - 6)); ctx.lineTo(p.x + fy * w + fx * (tip - 6), p.y - fx * w + fy * (tip - 6));
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
      const c = centroid(vis), top = Math.min(...vis.map(u => u.y)) - (vis.includes(q.leader) ? 34 : 26);
      const sx = (c.x * this.scale + this.ox) / dpr, sy = (top * this.scale + this.oy) / dpr;
      if (sx < -40 || sy < -40 || sx > this.cw / dpr + 40 || sy > this.ch / dpr + 40) continue;
      const sel = this.sel.has(q), w = 44, h = 20, x0 = Math.round(sx - w / 2), y0 = Math.round(sy - h);
      const alive = q.members.filter(u => u.alive && !u.routing && !u.escaped).length, total = q.members.length || 1;
      ctx.globalAlpha = sel ? 1 : fade;
      ctx.fillStyle = 'rgba(12,10,22,0.85)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y0, w, h, 4) : ctx.rect(x0, y0, w, h); ctx.fill();
      ctx.fillStyle = colors[q.side]; ctx.fillRect(x0 + 2, y0 + 2, 18, h - 4);
      ctx.strokeStyle = sel ? '#ffe680' : colors[q.side]; ctx.lineWidth = sel ? 2 : 1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 4, y0 + h); ctx.lineTo(sx, y0 + h + 5); ctx.lineTo(sx + 4, y0 + h); ctx.closePath();
      ctx.fillStyle = sel ? '#ffe680' : colors[q.side]; ctx.fill();
      unitIcon(ctx, q.leader.t.type, x0 + 11, y0 + h / 2, 12);
      label(ctx, String(alive), x0 + 32, y0 + 14, q.order === 'hold' || q.order === 'move' ? '#ffffff' : '#ffd8a0', 'center', 11);
      ctx.fillStyle = '#3a1820'; ctx.fillRect(x0, y0 + h + 1, w, 3);
      ctx.fillStyle = q.side === this.playerSide ? '#7cf07c' : '#ff7a6a'; ctx.fillRect(x0, y0 + h + 1, Math.round(w * alive / total), 3);
      ctx.globalAlpha = 1;
      this.bannerHits.push({ q, x0: x0 * dpr, y0: y0 * dpr, x1: (x0 + w) * dpr, y1: (y0 + h + 5) * dpr });
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
    c.drawImage(this.fogCanvas, 0, 0, mc.width, mc.height);
    const colors = this.factions.map(f => DATA.factions[f].color);
    for (const u of this.units) {
      if (!u.alive || u.escaped || !this.seenByPlayer(u)) continue;
      c.fillStyle = this.sel.has(u.sq) ? '#ffe680' : colors[u.side];
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
//  pw: power from hero level, L: the hero, team: the hero's living squad,
//  near(radius, side): units of a side around (x, y), rad: the skill's area radius }.
//  To add a skill: put its numbers in DATA.skills, a handler here, and (optionally)
//  a rule in Battle.autoCast so computer heroes use it.
// =============================================================================
const SKILL_FX = {
  charge: (b, c) => { for (const u of c.team) { u.buffs.push({ spd: 1.7, until: b.time + c.S.dur }); u.run = 999; } },
  rally: (b, c) => { for (const u of c.team) { u.hp = Math.min(u.maxHp, u.hp + u.maxHp * c.S.heal * c.pw); u.buffs.push({ def: c.S.def, until: b.time + c.S.dur }); } },
  shieldwall: (b, c) => { for (const u of c.team) u.buffs.push({ def: c.S.def * c.pw, spd: c.S.spd, until: b.time + c.S.dur }); },
  eagleeye: (b, c) => { for (const u of c.team) u.buffs.push({ range: c.S.range * DATA.battle.rangeMul, view: c.S.view, until: b.time + c.S.dur }); },
  volley: (b, c) => {
    const { S, L, q, x, y } = c;
    for (let i = 0; i < S.arrows; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * c.rad;
      b.pending.push({ at: b.time + i * 0.08, fn: () => b.projs.push({ x: L.x, y: L.y - 6, tx: x + Math.cos(a) * r, ty: y + Math.sin(a) * r,
        tg: null, side: q.side, gid: q.id, src: L, dmg: S.dmg * c.pw, splash: 10, img: 'arrow', speed: 300, angle: 0, quiet: true }) });
    }
  },
  meteor: (b, c) => {
    const { S, L, q, x, y } = c;
    b.zones.push({ x, y, r: c.rad, until: b.time + S.delay, side: q.side, warn: true });
    b.pending.push({ at: b.time + S.delay, fn: () => {
      for (const v of c.near(c.rad, 1 - q.side)) b.damage(v, S.dmg * c.pw, q.id, true, L);
      for (let i = 0; i < 6; i++) b.addFx(i % 2 ? 'fire' : 'smoke', x + (Math.random() - 0.5) * c.rad, y + (Math.random() - 0.5) * c.rad * 0.6, 0.6);
      if (!b.headless) Assets.sfx('magic-1', 0.5);
    } });
  },
  frostfield: (b, c) => b.zones.push({ x: c.x, y: c.y, r: c.rad, until: b.time + c.S.dur, side: c.q.side, slow: c.S.slow, dps: c.S.dps * c.pw, src: c.L, gid: c.q.id, frost: true }),
  massheal: (b, c) => { for (const u of c.near(c.rad, c.q.side)) { u.hp = Math.min(u.maxHp, u.hp + c.S.heal * c.pw); b.addFx('sparkle', u.x, u.y - 8, 0.5); } },
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
