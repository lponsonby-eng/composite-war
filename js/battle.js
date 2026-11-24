// =============================================================================
//  BATTLE: real-time fight on a large battlefield with fog of war.
//  side 0 = attacker (starts on the left), side 1 = defender (right).
//  Each general leads a squad. Squads take orders (advance, hold, move, attack,
//  retreat), move in formations, and their heroes cast skills using MP.
//  Units only see (and target) enemies within their side's vision.
//  If a general falls, their squad scatters. The battle ends when one side has
//  nobody left, or the time limit runs out (the defender holds the town).
//  The same code runs "headless" (no drawing) to auto-resolve AI vs AI fights.
// =============================================================================
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
      this.fogCanvas = document.createElement('canvas'); this.fogCanvas.width = this.fw; this.fogCanvas.height = this.fh;
      const me = this.home[Math.max(0, this.playerSide)];
      this.cam = { x: me.x + (this.playerSide === 1 ? -120 : 120), y: me.y, z: 1.6 };
      this.bg = this.buildBackground();
      this.updateFog();
    }
  }

  // ------------------------------------------------------------------ setup
  // Frontline squads deploy in front, backline squads behind. Wall defenders deploy
  // inside their town; their backline right behind the wall to shoot over it.
  placeSquads(gens, side) {
    const W = this.W, H = this.H, T = this.terrain;
    // rows: the formation chosen on the formation screen (g.row), or by class
    const rowOf = g => g.row || DATA.roleOf(g.id);
    const front = gens.filter(g => rowOf(g) === 'front'), back = gens.filter(g => rowOf(g) === 'back');
    const walled = side === 1 && T.walls;
    const rows = walled ? [[back, T.wallX + 40], [front, T.wallX + 110]]
      : [[front, 230], [back, 150]].filter(r => r[0].length);
    const face = side === 0 ? 1 : -1;
    for (const [list, depth] of rows) list.forEach((g, i) => {
      const n = list.length;
      const cy = H * 0.5 + (i - (n - 1) / 2) * Math.min(80, (H - 160) / Math.max(1, n));
      const x = walled ? depth : side === 0 ? depth : W - depth;
      const sq = {
        id: g.id, side, members: [], order: side === 1 ? 'hold' : 'advance', tx: x, ty: cy,
        face: [face, 0], auto: true, cd: {}, castT: Math.random(), skills: DATA.skillsOf(g.id).slice(),
        back: DATA.roleOf(g.id) === 'back', row: rowOf(g), level: g.level || 1,
      };
      const L = DATA.battle.mp;
      sq.maxMp = L.base + L.perLevel * sq.level; sq.mp = sq.maxMp * L.start;
      // signature abilities the hero has learned (level 15 and 30)
      (g.sig || []).forEach((s, t) => { if (s && sq.level >= DATA.signature.levels[t]) { this.custom[s.id] = s; sq.skills.push(s.id); } });
      sq.leader = this.makeUnit(g, side, true, x, cy, null, 1, sq);
      this.units.push(sq.leader);
      const mix = g.mix || [], lv = g.lv || [];
      for (let k = 0; k < g.troops; k++) {
        const u = this.makeUnit(g, side, false, x, cy, mix[k], lv[k] || 1, sq);
        u.slotK = k;
        sq.members.push(u); this.units.push(u);
      }
      this.rank(sq);
      for (const u of sq.members) { const [ox, oy] = this.slot(sq, u.slotK); u.x += ox; u.y += oy; }
      this.squads.push(sq);
    });
  }

  // Where soldier k stands relative to their general: a block of rows of 3 in
  // front of the general, facing the way the squad faces.
  // Frontline soldiers stand in ranks in front of the general, backline soldiers in
  // ranks behind; big squads use wider ranks.
  slot(sq, k) {
    const u = sq.members[k], back = u && u.back && sq.nFront > 0;
    const i = back ? sq.backIdx[k] : sq.frontIdx[k] ?? k;
    const n = back ? sq.nBack : (sq.nFront || sq.members.length), w = n > 15 ? 5 : n > 8 ? 4 : 3;
    const col = Math.floor(i / w), row = (i % w) - (w - 1) / 2;
    const f = back ? -(14 + col * 12) : 14 + col * 12, l = row * 12 + (col % 2) * 3;
    const [fx, fy] = sq.face;
    return [fx * f - fy * l, fy * f + fx * l];
  }

  // Number each squad's soldiers within the front and back ranks.
  rank(sq) {
    sq.frontIdx = {}; sq.backIdx = {}; let f = 0, b = 0;
    sq.members.forEach((u, k) => { if (u.back) sq.backIdx[k] = b++; else sq.frontIdx[k] = f++; });
    sq.nFront = f; sq.nBack = b;
  }

  // A soldier of unit type `type` (default: the type the general leads), or the general.
  makeUnit(g, side, isLeader, x, y, type, slv, sq) {
    const t = DATA.units[(!isLeader && type) || DATA.generals[g.id].leads];
    const L = DATA.leveling, lv = (g.level || 1) - 1;
    const boost = 1 + lv * (isLeader ? L.leaderBonus : L.squadBonus);
    const sb = isLeader ? { hp: 1, atk: 1, def: 0 } : DATA.soldierBoost(slv);       // soldier level and tier
    const hp = Math.round((isLeader ? t.hp * 5 : t.hp) * boost * sb.hp);
    const V = DATA.battle.vision;
    return {
      side, gid: g.id, sq, isLeader, t, back: isLeader ? DATA.roleOf(g.id) === 'back' : t.role === 'back',
      heal: t.type === 'healer', cav: t.type === 'cavalry', run: 0,
      sprite: isLeader ? Assets.genSprite(g.id) : Assets.unitSprite(t),
      x, y, hp, maxHp: hp,
      atk: (isLeader ? t.atk * 1.6 : t.atk) * boost * sb.atk,
      def: isLeader ? t.def + 2 : t.def + sb.def,
      lv: slv, tier: isLeader ? 0 : DATA.tierOf(slv), kills: 0,
      spd: t.spd, range: t.range, cd: t.cd,
      view: (isLeader ? V.hero : V.soldier) + (t.type === 'cavalry' ? V.cavalry : 0) + (t.type === 'shooter' ? V.shooter : 0),
      buffs: [], b: { atk: 1, def: 0, spd: 1, range: 0, view: 0 },
      cdLeft: Math.random() * t.cd, retarget: Math.random() * 0.3,
      target: null, dir: side === 0 ? 3 : 2, walkT: Math.random(), atkT: 0, hitT: 0,
      alive: true, escaped: false, routing: false, routT: 0, seen: [false, false],
    };
  }

  // ------------------------------------------------------------------ orders
  // Orders for a group of squads. Moves keep the chosen formation:
  //   auto: frontline in front, backline behind; line; column; wedge.
  orderMove(squads, x, y, formation = this.formation) {
    squads = squads.filter(q => q.leader.alive);
    if (!squads.length) return;
    const c = centroid(squads.map(q => q.leader));
    let dx = x - c.x, dy = y - c.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    if (d < 5) [dx, dy] = squads[0].face;
    const px = -dy, py = dx;
    let rows;
    if (formation === 'line') rows = [squads];
    else if (formation === 'column') rows = squads.map(q => [q]);
    else if (formation === 'wedge') { rows = []; let i = 0, n = 1; while (i < squads.length) { rows.push(squads.slice(i, i + n)); i += n; n++; } }
    else { rows = [squads.filter(q => q.row !== 'back'), squads.filter(q => q.row === 'back')].filter(r => r.length); }
    const cap = Math.min(...squads.map(q => q.leader.spd));          // the group keeps together
    rows.forEach((row, r) => row.forEach((q, i) => {
      const lat = (i - (row.length - 1) / 2) * 48;
      q.order = 'move'; q.target = null; q.cast = null;
      q.tx = clamp(x - dx * r * 46 + px * lat, 12, this.W - 12); q.ty = clamp(y - dy * r * 46 + py * lat, 20, this.H - 12);
      q.face = [dx, dy]; q.cap = squads.length > 1 ? cap : 0;
    }));
  }

  orderAttack(squads, enemy) {
    for (const q of squads) if (q.leader.alive) { q.order = 'attack'; q.target = enemy; q.cast = null; }
  }

  orderSet(squads, order) {
    for (const q of squads) if (q.leader.alive) {
      q.order = order; q.target = null; q.cast = null;
      if (order === 'hold') { q.tx = q.leader.x; q.ty = q.leader.y; }
    }
  }

  // The computer's squads: attackers advance; defenders hold until the enemy shows
  // up nearby (wall defenders always man their walls).
  aiOrders() {
    for (const q of this.squads) {
      if (q.side === this.playerSide || !q.leader.alive || q.order !== 'hold') continue;
      if (q.side === 1 && this.terrain.walls) continue;
      const near = this.units.some(e => e.side !== q.side && e.alive && e.seen[q.side] && udist(e, q.leader) < 260);
      if (near || this.time > 45) q.order = 'advance';
    }
  }

  // ------------------------------------------------------------------ skills
  sk(id) { return DATA.skills[id] || this.custom[id]; }

  canCast(q, id) {
    const S = this.sk(id);
    return q.leader.alive && !q.leader.routing && q.mp >= S.mp && !(q.cd[id] > this.time);
  }

  // Cast now if in range, otherwise walk the hero there first.
  cast(q, id, x, y) {
    const S = this.sk(id);
    if (!this.canCast(q, id)) return false;
    if (S.target !== 'self' && Math.hypot(x - q.leader.x, y - q.leader.y) > S.range) { q.cast = { id, x, y }; return true; }
    q.cast = null;
    q.mp -= S.mp; q.cd[id] = this.time + S.cd;
    const pw = 1 + 0.025 * (q.level - 1), L = q.leader;
    const team = this.units.filter(u => u.sq === q && u.alive && !u.routing);
    const near = (r, side) => this.units.filter(u => u.side === side && u.alive && !u.routing && !u.escaped && Math.hypot(u.x - x, u.y - y) <= r);
    const say = (s, c) => { if (!this.headless) this.texts.push({ x: L.x, y: L.y - 30, s, life: 1.2, color: c }); };
    if (S.target === 'self') { x = L.x; y = L.y; }
    if (S.sig) { this.castSig(q, S, x, y, pw, near); say(S.name + '!', '#ffd84a'); if (!this.headless && q.side === this.playerSide) Assets.sfx('power-up', 0.35); return true; }
    switch (id) {
      case 'charge': for (const u of team) { u.buffs.push({ spd: 1.7, until: this.time + S.dur }); u.run = 999; } break;
      case 'rally': for (const u of team) { u.hp = Math.min(u.maxHp, u.hp + u.maxHp * S.heal * pw); u.buffs.push({ def: S.def, until: this.time + S.dur }); } break;
      case 'shieldwall': for (const u of team) u.buffs.push({ def: S.def * pw, spd: S.spd, until: this.time + S.dur }); break;
      case 'eagleeye': for (const u of team) u.buffs.push({ range: S.range, view: S.view, until: this.time + S.dur }); break;
      case 'volley':
        for (let i = 0; i < S.arrows; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * S.radius;
          this.pending.push({ at: this.time + i * 0.08, fn: () => this.projs.push({ x: L.x, y: L.y - 6, tx: x + Math.cos(a) * r, ty: y + Math.sin(a) * r,
            tg: null, side: q.side, gid: q.id, src: L, dmg: S.dmg * pw, splash: 9, img: 'arrow', speed: 220, angle: 0, quiet: true }) });
        }
        break;
      case 'meteor':
        this.zones.push({ x, y, r: S.radius, until: this.time + S.delay, side: q.side, warn: true });
        this.pending.push({ at: this.time + S.delay, fn: () => {
          for (const v of near(S.radius, 1 - q.side)) this.damage(v, S.dmg * pw, q.id, true, L);
          for (let i = 0; i < 6; i++) this.addFx(i % 2 ? 'fire' : 'smoke', x + (Math.random() - 0.5) * S.radius, y + (Math.random() - 0.5) * S.radius * 0.6, 0.6);
          if (!this.headless) Assets.sfx('magic-1', 0.5);
        } });
        break;
      case 'frostfield': this.zones.push({ x, y, r: S.radius, until: this.time + S.dur, side: q.side, slow: S.slow, dps: S.dps * pw, src: L, gid: q.id, frost: true }); break;
      case 'massheal':
        for (const u of near(S.radius, q.side)) { u.hp = Math.min(u.maxHp, u.hp + S.heal * pw); if (!this.headless) this.addFx('sparkle', u.x, u.y - 8, 0.5); }
        break;
      case 'bless': for (const u of near(S.radius, q.side)) u.buffs.push({ atk: S.atk, until: this.time + S.dur }); break;
    }
    say(S.name + '!', '#9fd8ff');
    if (!this.headless && q.side === this.playerSide) Assets.sfx('power-up', 0.3);
    return true;
  }

  // A hero's own signature ability (see DATA.rollSignature).
  castSig(q, S, x, y, pw, near) {
    const L = q.leader, foe = 1 - q.side;
    const pick = () => {                               // the enemy closest to where it was aimed
      let best = null, bd = 40;
      for (const e of this.units) if (e.side === foe && e.alive && !e.escaped && !e.routing && e.seen[q.side]) {
        const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; }
      }
      return best;
    };
    const big = (u, s, c) => { if (!this.headless) this.texts.push({ x: u.x, y: u.y - 24, s, life: 1, color: c }); };
    switch (S.kind) {
      case 'strike': {
        const e = pick(); if (!e) return;
        if (S.range > 60) this.projs.push({ x: L.x, y: L.y - 6, tx: e.x, ty: e.y - 6, tg: e, side: q.side, gid: q.id, src: L, dmg: S.dmg * pw, splash: 0, img: S.proj, speed: 260, angle: 0, pierce: true });
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
        this.projs.push({ x: L.x, y: L.y - 6, tx: x, ty: y, tg: null, side: q.side, gid: q.id, src: L, dmg: S.dmg * pw, splash: S.radius, img: S.proj, speed: 150, angle: 0, big: true });
        break;
      case 'nova':
        for (const v of near(S.radius, foe)) this.damage(v, S.dmg * pw, q.id, true, L);
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; this.addFx(S.element === 'ice' ? 'sparkle' : 'fire', L.x + Math.cos(a) * S.radius * 0.7, L.y + Math.sin(a) * S.radius * 0.45, 0.5); }
        this.zones.push({ x: L.x, y: L.y, r: S.radius, until: this.time + 0.4, side: q.side, ring: true });
        break;
      case 'aura':
        for (const u of near(S.radius, q.side)) u.buffs.push({ atk: 1 + (S.atk - 1) * pw, def: S.def, until: this.time + S.dur });
        this.zones.push({ x: L.x, y: L.y, r: S.radius, until: this.time + 0.6, side: q.side, ring: true, good: true });
        break;
      case 'mend':
        for (const u of near(S.radius, q.side)) { u.hp = Math.min(u.maxHp, u.hp + S.heal * pw); this.addFx('sparkle', u.x, u.y - 8, 0.5); }
        this.zones.push({ x: L.x, y: L.y, r: S.radius, until: this.time + 0.6, side: q.side, ring: true, good: true });
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
          if (udist(e, L) > S.range) continue;
          const n = foes.filter(f => Math.hypot(f.x - e.x, f.y - e.y) <= S.radius).length;
          if (n > bn) { bn = n; best = e; }
        }
        if (best && bn >= (id === 'volley' ? 3 : 4)) return this.cast(q, id, best.x, best.y);
      } else {
        const hurt = team.reduce((s, u) => s + u.hp / u.maxHp, 0) / Math.max(1, team.length);
        const allies = this.units.filter(u => u.side === q.side && u.alive && udist(u, L) <= (S.radius || 0));
        if (id === 'rally' && hurt < 0.6 && nearest < 120) return this.cast(q, id);
        if (id === 'shieldwall' && hurt < 0.8 && nearest < 40) return this.cast(q, id);
        if (id === 'charge' && nearest > 50 && nearest < 170 && q.order !== 'hold') return this.cast(q, id);
        if (id === 'eagleeye' && nearest < 260) return this.cast(q, id);
        if (id === 'massheal' && allies.filter(u => u.hp / u.maxHp < 0.7).length >= 3) return this.cast(q, id);
        if (id === 'bless' && allies.length >= 5 && nearest < 90) return this.cast(q, id);
      }
    }
  }

  autoSig(q, id, S, foes, team, nearest) {
    const L = q.leader, inRange = foes.filter(e => udist(e, L) <= (S.range || 0));
    const allies = this.units.filter(u => u.side === q.side && u.alive && udist(u, L) <= (S.radius || 0));
    switch (S.kind) {
      case 'strike': case 'drain': {
        if (S.kind === 'drain' && team.reduce((s, u) => s + u.hp / u.maxHp, 0) / Math.max(1, team.length) > 0.85 && !inRange.some(e => e.isLeader)) return false;
        const e = inRange.find(f => f.isLeader) || inRange.sort((a, b) => b.hp - a.hp)[0];
        return e ? this.cast(q, id, e.x, e.y) : false;
      }
      case 'blast': {
        let best = null, bn = 0;
        for (const e of inRange) { const n = foes.filter(f => Math.hypot(f.x - e.x, f.y - e.y) <= S.radius).length; if (n > bn) { bn = n; best = e; } }
        return best && bn >= 3 ? this.cast(q, id, best.x, best.y) : false;
      }
      case 'nova': return foes.filter(e => udist(e, L) <= S.radius).length >= 3 ? this.cast(q, id) : false;
      case 'aura': return allies.length >= 5 && nearest < 100 ? this.cast(q, id) : false;
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
        if (Math.hypot(q.cast.x - q.leader.x, q.cast.y - q.leader.y) <= S.range) this.cast(q, q.cast.id, q.cast.x, q.cast.y);
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
      u.cdLeft -= dt; u.atkT -= dt; u.hitT -= dt; u.retarget -= dt;
      const [vx0, vy0] = this.think(u, dt);
      let vx = vx0, vy = vy0;
      if ((vx || vy) && !u.routing) [vx, vy] = this.steer(u, vx, vy);
      if (vx || vy) {
        let sp = this.terrain.speedAt(u.x, u.y) * u.b.spd;
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

    // moving: no fighting, just get there (the general sets the pace)
    if (q.order === 'move') {
      if (u.isLeader) {
        if (Math.hypot(q.tx - u.x, q.ty - u.y) < 6) { q.order = 'hold'; return [0, 0]; }
        return go(q.tx, q.ty, q.cap ? Math.min(u.spd, q.cap) : u.spd);
      }
      return go(ax, ay, u.spd * 1.3);
    }

    // pick a target among visible enemies
    if (u.retarget <= 0 || !u.target || !u.target.alive || u.target.routing || u.target.escaped || !u.target.seen[u.side]) {
      u.target = this.pickTarget(u);
      u.retarget = 0.3 + Math.random() * 0.2;
    }
    const tg = u.target, range = u.range + u.b.range;
    const d = tg ? udist(tg, u) : 1e9;
    const walled = u.side === 1 && T.walls && u.x > T.wallX;
    const kite = u.back && u.frontFoe && u.frontFoeD < R.kiteRange && u.cdLeft > 0.15 && !walled;
    if (kite) {                                         // backline steps away from a frontline enemy
      const f = u.frontFoe, fd = u.frontFoeD || 1;
      return [(u.x - f.x) / fd * u.spd * R.kiteSpeed, (u.y - f.y) / fd * u.spd * R.kiteSpeed];
    }
    if (tg) {
      if (d <= range + 4) {
        u.dir = faceDir(tg.x - u.x, tg.y - u.y);
        if (u.cdLeft <= 0 && !u.heal) { this.attack(u, tg); u.cdLeft = u.cd; u.atkT = 0.25; }
        return [0, 0];
      }
      let [vx, vy] = go(tg.x, tg.y);
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

  // Which visible enemy to go for. Holding squads only fight near their post;
  // wall defenders deal with anyone inside first; frontline protects its backline.
  pickTarget(u) {
    const q = u.sq, T = this.terrain, G = DATA.roles.front.guardRadius;
    const walled = u.side === 1 && T.walls && u.x > T.wallX, inside = e => e.x > T.wallX + 6;
    const anchor = u.isLeader ? (q.order === 'hold' ? { x: q.tx, y: q.ty } : u) : q.leader.alive ? q.leader : u;
    const leash = q.order === 'hold' ? 110 : q.order === 'attack' ? 160 : u.isLeader ? 1e9 : 120;
    const mine = u.back ? [] : this.units.filter(a => a.side === u.side && a.back && a.alive && !a.routing && udist(a, u) < 200);
    let best = null, bd = 1e9;
    for (const e of this.units) {
      if (e.side === u.side || !e.alive || e.escaped || e.routing || !e.seen[u.side]) continue;
      const d2 = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
      if (Math.hypot(e.x - anchor.x, e.y - anchor.y) > leash && d2 > (u.range + u.b.range + 4) ** 2) continue;
      if (walled && !inside(e) && d2 > (u.range + u.b.range + 4) ** 2) continue;
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
    const grid = new Map(), C = 12;
    for (const u of live) { const k = Math.floor(u.x / C) * 4096 + Math.floor(u.y / C); (grid.get(k) || grid.set(k, []).get(k)).push(u); }
    for (const a of live) {
      const cx = Math.floor(a.x / C), cy = Math.floor(a.y / C);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const cell = grid.get(gx * 4096 + gy); if (!cell) continue;
        for (const b of cell) {
          if (b === a) continue;
          const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 < 81 && d2 > 0.0001) { const d = Math.sqrt(d2), push = (9 - d) * 0.12; a.x -= dx / d * push; a.y -= dy / d * push; }
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
    for (const u of live) {
      u.seen[0] = u.seen[1] = false;
      const k = Math.floor(u.x / C) * 4096 + Math.floor(u.y / C);
      (grid.get(k) || grid.set(k, []).get(k)).push(u);
    }
    for (const u of live) {
      u.closestD = 1e9; u.frontFoe = null; u.frontFoeD = 1e9;
      const r = u.view + u.b.view, n = Math.ceil(r / C), cx = Math.floor(u.x / C), cy = Math.floor(u.y / C);
      for (let gx = cx - n; gx <= cx + n; gx++) for (let gy = cy - n; gy <= cy + n; gy++) {
        const cell = grid.get(gx * 4096 + gy); if (!cell) continue;
        for (const e of cell) {
          if (e.side === u.side) continue;
          const d = Math.hypot(e.x - u.x, e.y - u.y);
          if (d <= r) e.seen[u.side] = true;
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

  // Picks a heading near the wanted one that avoids slow ground (rivers, walls, mud)
  // when a quicker way is close by, e.g. a ford or a gate.
  steer(u, vx, vy) {
    const T = this.terrain, base = Math.atan2(vy, vx), sp = Math.hypot(vx, vy);
    let best = base, bestScore = -1;
    for (const da of [0, 0.5, -0.5, 1, -1, 1.4, -1.4]) {
      const a = base + da;
      let s = 1;
      for (const look of [6, 14, 24]) s = Math.min(s, T.speedAt(u.x + Math.cos(a) * look, u.y + Math.sin(a) * look));
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
      if (!this.headless && u.cav) this.texts.push({ x: u.x, y: u.y - 22, s: 'Charge!', life: 0.7, color: '#ffb040' });
    }
    u.run = 0;
    if (u.t.antiCav && tg.cav) dmg *= DATA.antiCavMul;               // spears against horses
    if (u.back) dmg *= R.power;                                    // shooting from safety hits hard...
    if (u.back && u.closestD < R.exposedRange) dmg *= R.meleePenalty;   // ...but caught in melee, much less
    if (u.t.proj) {
      this.projs.push({ x: u.x, y: u.y - 6, tx: tg.x, ty: tg.y - 6, tg, side: u.side, gid: u.gid, src: u, dmg,
        splash: u.t.splash || 0, img: u.t.proj, speed: u.t.splash ? 120 : 170, angle: 0 });
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
    const C = this.fogC, fw = this.fw, fh = this.fh, vis = this.visible;
    vis.fill(0);
    for (const u of this.units) {
      if (u.side !== this.playerSide || !u.alive || u.escaped) continue;
      const r = (u.view + u.b.view) / C, cx = u.x / C, cy = u.y / C;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(fh - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(fw - 1, Math.ceil(cx + r)); x++)
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) { vis[y * fw + x] = 1; this.explored[y * fw + x] = 1; }
    }
    const c = this.fogCanvas.getContext('2d'), img = c.createImageData(fw, fh);
    for (let i = 0; i < fw * fh; i++) { img.data[i * 4 + 3] = vis[i] ? 0 : this.explored[i] ? 120 : 225; img.data[i * 4] = 8; img.data[i * 4 + 1] = 10; img.data[i * 4 + 2] = 20; }
    c.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------------ drawing
  buildBackground() {
    const cv = document.createElement('canvas');
    cv.width = this.W; cv.height = this.H;
    const ctx = cv.getContext('2d');
    let seed = 0; for (const ch of this.opts.spotName) seed = seed * 31 + ch.charCodeAt(0);
    const rng = makeRng(seed);
    const T = Assets.img;
    for (let y = 0; y < this.H; y += 16) for (let x = 0; x < this.W; x += 16)
      ctx.drawImage(rng() < 0.7 ? T['tile:ground_grass'] : T['tile:ground_grass2'], x, y);
    const tint = (DATA.regions[this.terrain.region] || {}).battle;
    if (tint) {                                    // recolour the grass to the region's ground (snow, sand, ash...)
      ctx.globalCompositeOperation = 'color'; ctx.fillStyle = tint; ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = this.terrain.region === 'frost' ? 0.8 : 0.55; ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    }
    const lush = !['frost', 'sun', 'ember'].includes(this.terrain.region);
    for (let i = 0; i < 160; i++) {
      const n = ['grass_tuft', 'grass_tuft', 'bush'][Math.floor(rng() * 3)];
      const x = Math.floor(rng() * (this.W - 16)), y = Math.floor(rng() * (this.H - 16));
      if (lush && this.terrain.kindAt(x + 8, y + 8) === GROUND.grass) ctx.drawImage(T['tile:' + n], x, y);
    }
    this.terrain.draw(ctx);
    return cv;
  }

  // Camera: world point at the centre of the screen and zoom (screen px per world px).
  fit(canvas) {
    const dpr = window.devicePixelRatio || 1, c = this.cam;
    const minZ = Math.max(canvas.width / this.W, canvas.height / this.H) / dpr;
    c.z = clamp(c.z, minZ, 4);
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
    this.cam.z = clamp(this.cam.z * f, 0.4, 4);
    const s = this.cam.z * dpr;
    this.cam.x = wx - (px - this.cw / 2) / s; this.cam.y = wy - (py - this.ch / 2) / s;
  }

  render(ctx, canvas) {
    this.fit(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16241a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bg, 0, 0);
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
      if (z.warn) { const k = 1 - (z.until - this.time); const im = Assets.img['fx:fireball']; if (im) ctx.drawImage(im, 0, 0, 16, 16, Math.round(z.x - 8 + (1 - k) * 60), Math.round(z.y - 8 - (1 - k) * 160), 16, 16); }
    }

    // selected squads: their destination
    for (const q of this.sel) if (q.leader.alive && (q.order === 'move' || q.order === 'hold')) {
      ctx.strokeStyle = 'rgba(255,240,140,0.7)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(q.leader.x, q.leader.y); ctx.lineTo(q.tx, q.ty); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffe680'; ctx.fillRect(Math.round(q.tx), Math.round(q.ty) - 8, 1, 8); ctx.fillRect(Math.round(q.tx) + 1, Math.round(q.ty) - 8, 4, 3);
    }

    const colors = this.factions.map(f => DATA.factions[f].color);
    const list = this.units.filter(u => u.alive && !u.escaped && this.seenByPlayer(u) && onScreen(u.x, u.y)).sort((a, b) => a.y - b.y);
    for (const u of list) {                       // coloured shadows show which side a unit is on; selected squads get a ring
      const sel = this.sel.has(u.sq);
      ctx.fillStyle = colors[u.side] + (u.isLeader ? 'ee' : 'aa');
      ctx.beginPath(); ctx.ellipse(u.x, u.y + 1, u.isLeader ? 8 : 6, u.isLeader ? 3.2 : 2.5, 0, 0, Math.PI * 2); ctx.fill();
      if (sel) { ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(u.x, u.y + 1, u.isLeader ? 10 : 7, u.isLeader ? 4.5 : 3.2, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    for (const u of list) {
      const moving = u.moving && u.atkT <= 0;
      const frame = Math.floor(u.walkT * 8) % 4;
      const alpha = u.routing ? 0.5 : (u.hitT > 0 ? 0.55 : 1);
      Assets.drawUnit(ctx, u.sprite, u.dir, moving ? frame : 0, u.atkT > 0, u.x - 8, u.y - 14, alpha);
      if (u.isLeader) {
        const fx = Math.round(u.x + 4), fy = Math.round(u.y - 26);
        ctx.fillStyle = '#3b2a1a'; ctx.fillRect(fx, fy, 1, 10);
        ctx.fillStyle = colors[u.side]; ctx.fillRect(fx + 1, fy, 6, 4);
        hpBar(ctx, u.x - 7, u.y - 18, 14, u.hp / u.maxHp, '#ffd84a');
        if (u.side === this.playerSide) hpBar(ctx, u.x - 7, u.y - 16, 14, u.sq.mp / u.sq.maxMp, '#6fb6ff');
      } else if (u.hp < u.maxHp) {
        hpBar(ctx, u.x - 5, u.y - 17, 10, u.hp / u.maxHp, u.side === 0 ? '#7cf07c' : '#ff7a6a');
      }
      if (u.tier > 1) {                                   // promoted soldiers: silver pip (tier 2), two gold pips (tier 3)
        const col = u.tier === 3 ? '#ffd84a' : '#d8e0ec', px = Math.round(u.x) + 5, py = Math.round(u.y) - 15;
        for (let k = 0; k < u.tier - 1; k++) { ctx.fillStyle = '#1a1020'; ctx.fillRect(px - 1, py - 1 + k * 3, 4, 4); ctx.fillStyle = col; ctx.fillRect(px, py + k * 3, 2, 2); }
      }
    }
    for (const p of this.projs) {
      if (!this.cellVisible(p.x, p.y)) continue;
      const im = Assets.img['fx:' + p.img];
      if (!im) continue;
      ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
      if (p.img !== 'shuriken') ctx.rotate(p.angle); else ctx.rotate(this.time * 20);
      ctx.drawImage(im, -Math.floor(im.width / 2), -Math.floor(im.height / 2));
      ctx.restore();
    }
    for (const f of this.fx) if (this.cellVisible(f.x, f.y)) Assets.drawFx(ctx, f.name, f.t, f.x, f.y);
    for (const t of this.texts) if (this.cellVisible(t.x, t.y)) label(ctx, t.s, t.x, t.y, t.color, 'center', 10);

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
    // screen-space messages
    const dpr = window.devicePixelRatio || 1, ss = 2 * dpr;
    ctx.setTransform(ss, 0, 0, ss, 0, 0);
    const cx = canvas.width / 2 / ss;
    if (this.banner) label(ctx, this.banner.text, cx, 58, this.banner.side === this.playerSide ? '#ff8a7a' : '#ffe680', 'center', 12);
    if (this.paused && !this.done) label(ctx, 'PAUSED - give orders, then press Space or Play', cx, 72, '#ffe680', 'center', 9);
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

function hpBar(ctx, x, y, w, frac, color) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#1a1020'; ctx.fillRect(x - 1, y - 1, w + 2, 3);
  ctx.fillStyle = '#5a1f1f'; ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = color; ctx.fillRect(x, y, Math.max(0, Math.round(w * frac)), 1);
}
