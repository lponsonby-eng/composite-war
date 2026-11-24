// =============================================================================
//  BATTLE: real-time fight between the squads of two sides.
//  side 0 = attacker (starts on the left), side 1 = defender (right).
//  Each general fights in person with a squad of soldiers. If a general falls,
//  their soldiers scatter. The battle ends when one side has nobody left, or the
//  time limit runs out (the defender holds the town).
//  The same code runs "headless" (no drawing) to auto-resolve AI vs AI fights.
// =============================================================================
class Battle {
  constructor(opts) {
    this.W = 480; this.H = 270;
    this.opts = opts;                        // { attackers, defenders, attFaction, defFaction, spotName, playerSide }
    this.factions = [opts.attFaction, opts.defFaction];
    this.playerSide = opts.playerSide === 'att' ? 0 : opts.playerSide === 'def' ? 1 : -1;
    this.units = []; this.projs = []; this.fx = []; this.texts = [];
    this.time = 0; this.limit = DATA.battleTimeLimit;
    this.orders = ['advance', this.playerSide === 1 ? 'advance' : 'hold'];
    this.done = false; this.banner = null;
    this.headless = !!opts.headless;
    this.placeSquads(opts.attackers, 0);
    this.placeSquads(opts.defenders, 1);
    if (!this.headless) this.bg = this.buildBackground();
  }

  // ------------------------------------------------------------------ setup
  placeSquads(gens, side) {
    const n = gens.length;
    gens.forEach((g, i) => {
      const cy = 52 + (i + 0.5) * (186 / n);
      const dirX = side === 0 ? 1 : -1;
      const baseX = side === 0 ? 30 : this.W - 30;
      this.units.push(this.makeUnit(g, side, true, baseX, cy));
      for (let k = 0; k < g.troops; k++) {
        const col = Math.floor(k / 3), row = (k % 3) - 1;
        this.units.push(this.makeUnit(g, side, false, baseX + dirX * (20 + col * 13), cy + row * 13 + (col % 2) * 3));
      }
    });
  }

  makeUnit(g, side, isLeader, x, y) {
    const t = DATA.units[DATA.generals[g.id].leads];
    const hp = isLeader ? t.hp * 5 : t.hp;
    return {
      side, gid: g.id, isLeader, t,
      sprite: isLeader ? 'c' + DATA.generals[g.id].face : t.sprite,
      x, y, homeX: x, homeY: y,
      hp, maxHp: hp,
      atk: isLeader ? t.atk * 1.6 : t.atk,
      def: isLeader ? t.def + 2 : t.def,
      spd: t.spd, range: t.range, cd: t.cd,
      cdLeft: Math.random() * t.cd, retarget: Math.random() * 0.3,
      target: null, dir: side === 0 ? 3 : 2, walkT: Math.random(), atkT: 0, hitT: 0,
      alive: true, escaped: false, routing: false, routT: 0,
    };
  }

  // ------------------------------------------------------------------ simulation
  update(dt) {
    if (this.done) return;
    this.time += dt;
    this.aiOrders();

    for (const u of this.units) {
      if (!u.alive || u.escaped) continue;
      u.cdLeft -= dt; u.atkT -= dt; u.hitT -= dt; u.retarget -= dt;
      let vx = 0, vy = 0;

      if (u.routing) {                                    // general fell: run away and vanish
        u.routT -= dt;
        vx = (u.side === 0 ? -1 : 1) * u.spd * 1.3;
        if (u.routT <= 0) { u.alive = false; this.addFx('smoke', u.x, u.y - 6, 0.5); }
      } else if (this.orders[u.side] === 'retreat') {      // run for the edge of the field
        vx = (u.side === 0 ? -1 : 1) * u.spd * 1.2;
        if (u.x < -6 || u.x > this.W + 6) u.escaped = true;
      } else {
        if (u.retarget <= 0 || !u.target || !u.target.alive || u.target.routing || u.target.escaped) {
          u.target = this.nearestEnemy(u);
          u.retarget = 0.3 + Math.random() * 0.2;
        }
        const tg = u.target;
        const d = tg ? Math.hypot(tg.x - u.x, tg.y - u.y) : 1e9;
        const engage = tg && (this.orders[u.side] === 'advance' || d <= u.range + 50);
        if (engage) {
          if (d <= u.range + 4) {
            u.dir = faceDir(tg.x - u.x, tg.y - u.y);
            if (u.cdLeft <= 0) { this.attack(u, tg); u.cdLeft = u.cd; u.atkT = 0.25; }
          } else {
            vx = (tg.x - u.x) / d * u.spd; vy = (tg.y - u.y) / d * u.spd;
          }
        } else {                                          // hold: return to starting position
          const hd = Math.hypot(u.homeX - u.x, u.homeY - u.y);
          if (hd > 3) { vx = (u.homeX - u.x) / hd * u.spd; vy = (u.homeY - u.y) / hd * u.spd; }
        }
      }

      u.moving = !!(vx || vy);
      if (vx || vy) {
        u.x += vx * dt; u.y += vy * dt;
        u.walkT += dt;
        if (u.atkT <= 0) u.dir = faceDir(vx, vy);
      }
      if (!u.escaped && this.orders[u.side] !== 'retreat' && !u.routing) u.x = Math.max(4, Math.min(this.W - 4, u.x));
      u.y = Math.max(34, Math.min(252, u.y));
    }

    // keep soldiers from standing inside each other
    const live = this.units.filter(u => u.alive && !u.escaped);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 < 81 && d2 > 0.0001) {
        const d = Math.sqrt(d2), push = (9 - d) * 0.25;
        a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push;
      }
    }

    // projectiles fly toward their target (homing) and hit on arrival
    for (const p of this.projs) {
      if (p.tg.alive) { p.tx = p.tg.x; p.ty = p.tg.y - 6; }
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      p.angle = Math.atan2(dy, dx);
      if (d <= step + 2) {
        p.dead = true;
        if (p.splash) {
          this.addFx('fire', p.tx, p.ty, 0.4);
          for (const v of this.units) if (v.alive && !v.escaped && v.side !== p.side && Math.hypot(v.x - p.tx, v.y - 6 - p.ty) <= p.splash) this.damage(v, p.dmg);
        } else if (p.tg.alive) {
          this.addFx('hit', p.tx, p.ty, 0.25);
          this.damage(p.tg, p.dmg);
        }
      } else { p.x += dx / d * step; p.y += dy / d * step; }
    }
    this.projs = this.projs.filter(p => !p.dead);

    for (const f of this.fx) f.t += dt / f.dur;
    this.fx = this.fx.filter(f => f.t < 1);
    for (const t of this.texts) { t.y -= 14 * dt; t.life -= dt; }
    this.texts = this.texts.filter(t => t.life > 0);
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }

    // victory check
    const active = s => this.units.some(u => u.side === s && u.alive && !u.escaped && !u.routing);
    if (!active(0)) this.finish(1);
    else if (!active(1)) this.finish(0);
    else if (this.time >= this.limit) this.finish(1);
  }

  // The computer-controlled side: defenders hold until the enemy gets close.
  aiOrders() {
    for (const s of [0, 1]) {
      if (s === this.playerSide || this.orders[s] !== 'hold') continue;
      const near = this.units.some(e => e.side !== s && e.alive && this.units.some(u => u.side === s && u.alive && Math.hypot(u.x - e.x, u.y - e.y) < 150));
      if (near || this.time > 10) this.orders[s] = 'advance';
    }
  }

  nearestEnemy(u) {
    let best = null, bd = 1e9;
    for (const e of this.units) {
      if (e.side === u.side || !e.alive || e.escaped || e.routing) continue;
      const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  attack(u, tg) {
    if (u.t.proj) {
      this.projs.push({ x: u.x, y: u.y - 6, tx: tg.x, ty: tg.y - 6, tg, side: u.side, dmg: u.atk,
        splash: u.t.splash || 0, img: u.t.proj, speed: u.t.proj === 'fireball' ? 120 : 170, angle: 0 });
      if (!this.headless && u.t.proj === 'fireball') Assets.sfx('magic-1', 0.25);
    } else {
      this.addFx('slash', tg.x, tg.y - 6, 0.25);
      if (!this.headless) Assets.sfx('sword', 0.3);
      this.damage(tg, u.atk);
    }
  }

  damage(v, amount) {
    if (!v.alive) return;
    const dmg = Math.max(1, Math.round(amount * (0.85 + Math.random() * 0.3) - v.def));
    v.hp -= dmg; v.hitT = 0.12;
    if (!this.headless) this.texts.push({ x: v.x, y: v.y - 16, s: String(dmg), life: 0.6, color: v.isLeader ? '#ffd84a' : '#ffffff' });
    if (v.hp <= 0) {
      v.alive = false;
      this.addFx('smoke', v.x, v.y - 6, 0.5);
      if (!this.headless) Assets.sfx('kill', 0.35);
      if (v.isLeader) {
        for (const u of this.units) if (u.gid === v.gid && !u.isLeader && u.alive) { u.routing = true; u.routT = 1.2; }
        this.banner = { text: `${DATA.generals[v.gid].name} has fallen!`, t: 2.5, side: v.side };
      }
    }
  }

  addFx(name, x, y, dur) { if (!this.headless) this.fx.push({ name, x, y, t: 0, dur }); }

  finish(winnerSide) {
    this.done = true;
    this.winner = winnerSide === 0 ? 'att' : 'def';
    const res = side => (side === 0 ? this.opts.attackers : this.opts.defenders).map(g => {
      const leader = this.units.find(u => u.gid === g.id && u.isLeader);
      const troops = this.units.filter(u => u.gid === g.id && !u.isLeader && (u.alive || u.escaped) && !u.routing).length;
      return { id: g.id, alive: leader.alive || leader.escaped, troops: leader.alive || leader.escaped ? troops : 0, before: g.troops };
    });
    this.result = { winner: this.winner, att: res(0), def: res(1), timeout: this.time >= this.limit };
  }

  runHeadless() {
    while (!this.done) this.update(1 / 20);
    return this.result;
  }

  // Status for the on-screen HUD
  sideInfo(side) {
    return (side === 0 ? this.opts.attackers : this.opts.defenders).map(g => {
      const leader = this.units.find(u => u.gid === g.id && u.isLeader);
      const troops = this.units.filter(u => u.gid === g.id && !u.isLeader && u.alive && !u.routing && !u.escaped).length;
      return { id: g.id, hp: Math.max(0, leader.hp / leader.maxHp), alive: leader.alive, troops };
    });
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
    for (let i = 0; i < 40; i++) {
      const n = ['grass_tuft', 'grass_tuft', 'bush'][Math.floor(rng() * 3)];
      ctx.drawImage(T['tile:' + n], Math.floor(rng() * (this.W - 16)), 40 + Math.floor(rng() * 200));
    }
    // tree line along the top of the field
    for (let x = -8; x < this.W; x += 18 + rng() * 10) {
      const n = rng() < 0.5 ? 'tree_round' : 'tree_pine';
      ctx.drawImage(T['tile:' + n], Math.floor(x), Math.floor(-6 + rng() * 10));
    }
    this.bottomTrees = [];
    for (let x = -8; x < this.W; x += 18 + rng() * 10)
      this.bottomTrees.push([rng() < 0.5 ? 'tree_round' : (rng() < 0.2 ? 'rock' : 'tree_pine'), Math.floor(x), 246 + Math.floor(rng() * 10)]);
    return cv;
  }

  fit(canvas) {
    const s = Math.min(canvas.width / this.W, canvas.height / this.H);
    this.scale = s >= 2 ? Math.floor(s) : s;
    this.ox = Math.floor((canvas.width - this.W * this.scale) / 2);
    this.oy = Math.floor((canvas.height - this.H * this.scale) / 2);
  }

  render(ctx, canvas) {
    this.fit(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16241a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, this.W, this.H); ctx.clip();
    ctx.drawImage(this.bg, 0, 0);

    const colors = this.factions.map(f => DATA.factions[f].color);
    const list = this.units.filter(u => u.alive && !u.escaped).sort((a, b) => a.y - b.y);
    for (const u of list) {                       // coloured shadows show which side a unit is on
      ctx.fillStyle = colors[u.side] + (u.isLeader ? 'ee' : 'aa');
      ctx.beginPath(); ctx.ellipse(u.x, u.y + 1, u.isLeader ? 8 : 6, u.isLeader ? 3.2 : 2.5, 0, 0, Math.PI * 2); ctx.fill();
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
      } else if (u.hp < u.maxHp) {
        hpBar(ctx, u.x - 5, u.y - 17, 10, u.hp / u.maxHp, u.side === 0 ? '#7cf07c' : '#ff7a6a');
      }
    }
    for (const p of this.projs) {
      const im = Assets.img['fx:' + p.img];
      if (!im) continue;
      ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
      if (p.img !== 'shuriken') ctx.rotate(p.angle); else ctx.rotate(this.time * 20);
      ctx.drawImage(im, -Math.floor(im.width / 2), -Math.floor(im.height / 2));
      ctx.restore();
    }
    for (const [n, x, y] of this.bottomTrees) {
      const im = Assets.img['tile:' + n]; ctx.drawImage(im, x, y);
    }
    for (const f of this.fx) Assets.drawFx(ctx, f.name, f.t, f.x, f.y);
    for (const t of this.texts) label(ctx, t.s, t.x, t.y, t.color, 'center', 10);
    if (this.banner) label(ctx, this.banner.text, this.W / 2, 30, this.banner.side === this.playerSide ? '#ff8a7a' : '#ffe680', 'center', 16);
    ctx.restore();
  }
}

function faceDir(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 2 : 3;
  return dy < 0 ? 1 : 0;
}

function hpBar(ctx, x, y, w, frac, color) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#1a1020'; ctx.fillRect(x - 1, y - 1, w + 2, 3);
  ctx.fillStyle = '#5a1f1f'; ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = color; ctx.fillRect(x, y, Math.max(0, Math.round(w * frac)), 1);
}
