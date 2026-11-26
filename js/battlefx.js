// =============================================================================
//  BATTLE EFFECTS: dust, blood and scorch marks (live battles only).
//    - dust kicked up by charging men and cavalry, in the ground's colour
//    - blood on the ground where men are hit and where they fall, and a short
//      spray of it on a kill (it stays: the field shows where the fight was)
//    - dust bursts and scorch marks where cannonballs and blasts land
//  Particles live in battle.parts; marks are painted onto one world-sized
//  canvas (battle.decals) drawn just above the ground. Tune it in BattleFX.cfg.
// =============================================================================
const BattleFX = {
  cfg: {
    max: 700,                  // particles alive at most
    dustRate: 5,               // dust puffs per second from each charging man (shared out over big blocks)
    bloodHit: 0.3,             // chance a blow leaves blood on the ground
    blood: ['rgba(96,14,16,0.55)', 'rgba(70,10,12,0.5)', 'rgba(120,24,20,0.45)'],
  },

  init(b) { b.parts = []; b.decals = null; },

  decalCtx(b) {
    if (!b.decals) { b.decals = document.createElement('canvas'); b.decals.width = b.W; b.decals.height = b.H; }
    return b.decals.getContext('2d');
  },

  // The colour of dust thrown up at (x, y): sand, snow, mud, spray from water, or dry earth.
  dustColour(b, x, y) {
    const k = b.terrain.kindAt(x, y), G = GROUND;
    if (k === G.sand) return [216, 192, 144];
    if (k === G.snow || k === G.ice) return [238, 243, 246];
    if (k === G.mud) return [106, 82, 54];
    if (k === G.water || k === G.ford || k === G.stream) return [200, 228, 240];
    return [184, 160, 120];
  },

  add(b, p) { if (b.parts.length < this.cfg.max) b.parts.push(p); },

  dust(b, x, y, n = 1, spread = 4, big = 1) {
    const [r, g, bl] = this.dustColour(b, x, y);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 10 * big;
      this.add(b, { kind: 'dust', x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread * 0.5, z: 0,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5 - 2, vz: 0, r: (1.5 + Math.random() * 1.5) * big, grow: 5 * big,
        life: 0, max: 0.6 + Math.random() * 0.5 * big, col: `${r},${g},${bl}`, a: 0.45 });
    }
  },

  // A blood mark on the ground (size ~ 1 for a blow, 2 for a death) and, on a death, a spray.
  blood(b, x, y, size = 1, spray = 0) {
    const c = this.decalCtx(b), B = this.cfg.blood;
    for (let i = 0; i < 1 + size * 2; i++) {
      c.fillStyle = B[Math.floor(Math.random() * B.length)];
      c.beginPath(); c.ellipse(x + (Math.random() - 0.5) * 5 * size, y + (Math.random() - 0.5) * 2.5 * size, (0.8 + Math.random()) * size, (0.5 + Math.random() * 0.6) * size, 0, 0, Math.PI * 2); c.fill();
    }
    for (let i = 0; i < spray; i++) {
      const a = Math.random() * Math.PI * 2, s = 12 + Math.random() * 22;
      this.add(b, { kind: 'spray', x, y, z: 6 + Math.random() * 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5, vz: 14 + Math.random() * 18,
        r: 0.9, life: 0, max: 1.5, col: '128,18,18', a: 0.9 });
    }
  },

  // Where a cannonball or blast lands: a scorch mark and a burst of dust.
  impact(b, x, y, r) {
    const c = this.decalCtx(b), g = c.createRadialGradient(x, y, 0, x, y, r * 0.7);
    g.addColorStop(0, 'rgba(30,22,16,0.45)'); g.addColorStop(1, 'rgba(30,22,16,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(x, y, r * 0.7, r * 0.45, 0, 0, Math.PI * 2); c.fill();
    this.dust(b, x, y, Math.min(14, 4 + r / 3), r * 0.6, 1.8);
  },

  update(b, dt) {
    for (const p of b.parts) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'dust') { p.r += p.grow * dt; p.vx *= 0.92; p.vy *= 0.92; }
      else {                                                        // blood spray falls and marks the ground
        p.vz -= 70 * dt; p.z += p.vz * dt;
        if (p.z <= 0) { p.life = p.max; const c = this.decalCtx(b); c.fillStyle = this.cfg.blood[0]; c.fillRect(p.x - 0.6, p.y - 0.4, 1.4, 0.9); }
      }
    }
    b.parts = b.parts.filter(p => p.life < p.max);
  },

  // Under the men: the marks on the ground, then the dust.
  drawGround(ctx, b) {
    if (b.decals) ctx.drawImage(b.decals, 0, 0, b.W, b.H);
    for (const p of b.parts) if (p.kind === 'dust') {
      const k = p.life / p.max;
      ctx.fillStyle = `rgba(${p.col},${p.a * (1 - k) * (1 - k)})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y - p.r * 0.4, p.r, p.r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    }
  },
  // Over the men: the spray in the air.
  drawAir(ctx, b) {
    for (const p of b.parts) if (p.kind === 'spray') { ctx.fillStyle = `rgba(${p.col},${p.a})`; ctx.fillRect(p.x - p.r / 2, p.y - p.z - p.r / 2, p.r, p.r); }
  },
};
