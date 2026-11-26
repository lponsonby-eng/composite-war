// =============================================================================
//  GENERATED SPRITES: connects the Pixelgen generators (tools/pixelgen) to the game.
//  Human units get medieval soldier or cavalry sheets in their faction's heraldry,
//  every general (except monsters) gets a hero sheet of their own with a matching
//  portrait, and fallen soldiers leave their bodies on the battlefield.
//  Everything is made on first use (seeded, so always the same picture) and then
//  kept; the rest is warmed up in the background a few pieces at a time.
//  Units with no generated look yet (monsters, artillery, beast riders) keep their
//  old sprites: Gen returns null for them.
//
//  A generated sheet is a canvas with .fw/.fh (frame size) and .pad (empty rows
//  under the feet). Its columns are down/up/left/right and its rows walk frames,
//  with the attack in row 4, like the old 16 px sheets.
// =============================================================================
const Gen = {
  on: typeof PixelGen !== 'undefined' && !!(PixelGen.GENERATORS && PixelGen.GENERATORS.soldier),
  cache: {},
  queue: [],

  // ---------------------------------------------------------------- unit looks
  // How each human unit is drawn: a soldier troop (with weapon / helm), a robed caster,
  // or a cavalry sheet. Units missing here keep their old sprite.
  UNITS: {
    knight:     { troop: 'knight' },
    lancer:     { cav: 'knight', weapon: 'lance' },
    archer:     { troop: 'archer' },
    mage:       { caster: 'hood', weapon: 'staff' },
    cleric:     { caster: 'coif', weapon: 'staff' },
    warden:     { troop: 'manatarms', weapon: 'halberd', helm: 'greathelm' },
    hunter:     { troop: 'archer', helm: 'hood' },
    shaman:     { caster: 'hood', weapon: 'staff' },
    ranger:     { troop: 'archer', helm: 'hood' },
    witch:      { caster: 'hood', weapon: 'staff' },
    druid:      { caster: 'hood', weapon: 'staff' },
    ashigaru:   { troop: 'spearman', helm: 'kettle' },
    brawler:    { troop: 'manatarms', weapon: 'mace', helm: 'bascinet' },
    emberider:  { cav: 'manatarms', weapon: 'sword' },
    nightmare:  { cav: 'knight', weapon: 'lance', coat: 'black' },
    tidemage:   { caster: 'hood', weapon: 'staff' },
    seapriest:  { caster: 'coif', weapon: 'staff' },
    nomad:      { troop: 'spearman', helm: 'hood' },
    sunguard:   { troop: 'knight', weapon: 'mace', helm: 'sallet' },
    sunpriest:  { caster: 'hood', weapon: 'staff' },
    militia:    { troop: 'levy' },
    bandit:     { troop: 'archer', helm: 'hood' },
  },

  // the faction a unit is recruited by (for its colours)
  unitFaction(id) {
    if (!this._uf) {
      this._uf = {};
      for (const [f, list] of Object.entries(DATA.rosters || {})) for (const u of Object.keys(list)) if (!this._uf[u]) this._uf[u] = f;
    }
    return this._uf[id] || 'neutral';
  },

  // Key of a unit type's generated sheet in Assets.img, or null to keep the old sprite.
  unit(id) {
    if (!this.on || !this.UNITS[id]) return null;
    const key = 'gen:u:' + id;
    if (!Assets.img[key]) {
      const spec = this.UNITS[id], f = this.unitFaction(id), seed = 1 + (PixelGen.hashSeed(id) % 9973);
      let res;
      if (spec.cav) res = PixelGen.generate('cavalry', { seed, faction: f, troop: spec.cav, weapon: spec.weapon, coat: spec.coat });
      else if (spec.caster) res = PixelGen.generate('soldier', { seed, faction: f, troop: 'archer', helm: spec.caster, weapon: spec.weapon, robe: 'yes' });
      else res = PixelGen.generate('soldier', { seed, faction: f, troop: spec.troop, weapon: spec.weapon, helm: spec.helm });
      Assets.img[key] = this.canvas(res.img, spec.cav ? 48 : 32, spec.cav ? 52 : 40, spec.cav ? 0 : 2, spec.cav ? 5 : 5);
      Assets.img[key].corpse = spec.cav ? { x: 0, y: 260, w: 64, h: 32, rider: { x: 70, y: 260, w: 40, h: 32 } } : { x: 0, y: 200, w: 40, h: 32, alt: { x: 44, y: 200 } };
    }
    return key;
  },

  // ---------------------------------------------------------------- heroes
  // Each general's archetype follows what they lead; lords are warlords.
  ARCHETYPES: {
    warrior: ['paladin', 'berserker', 'cavalier', 'shieldmaiden'],
    beast: ['berserker', 'shieldmaiden'],
    shooter: ['huntress', 'huntress', 'jester', 'alchemist'],
    artillery: ['alchemist'],
    mage: ['witch', 'necromancer', 'reaper', 'witch'],
    healer: ['monk', 'monk', 'witch', 'paladin'],
  },
  heroArchetype(gid) {
    const d = DATA.generals[gid];
    if (d.hero) return d.hero;                                    // set `hero` on a general to choose
    if (d.lord) return 'warlord';
    const t = (DATA.units[d.leads] || {}).type || 'infantry';
    const list = this.ARCHETYPES[t] || this.ARCHETYPES.warrior;
    return list[PixelGen.hashSeed('arch:' + gid) % list.length];
  },
  heroOpts(gid) { return { seed: 1 + (PixelGen.hashSeed('hero:' + gid) % 99991), hero: this.heroArchetype(gid) }; },

  // Key of a general's hero sheet, or null (monster generals keep their creature look).
  hero(gid) {
    const d = DATA.generals[gid];
    if (!this.on || !d || d.mface) return null;
    const key = 'gen:h:' + gid;
    if (!Assets.img[key]) Assets.img[key] = this.canvas(PixelGen.generate('champion', this.heroOpts(gid)).img, 40, 48, 2, 5);
    return key;
  },
  // A portrait canvas (64 x 64) in one of three moods, or null.
  portrait(gid, mood = 'neutral') {
    const d = DATA.generals[gid];
    if (!this.on || !d || d.mface) return null;
    const key = 'gen:p:' + gid;
    if (!this.cache[key]) this.cache[key] = this.canvas(PixelGen.generate('heroface', this.heroOpts(gid)).img, 64, 64, 0, 0);
    const i = Math.max(0, ['neutral', 'fierce', 'smile'].indexOf(mood));
    const ck = key + ':' + i;
    if (!this.cache[ck]) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      c.getContext('2d').drawImage(this.cache[key], i * 64, 0, 64, 64, 0, 0, 64, 64);
      this.cache[ck] = c;
    }
    return this.cache[ck];
  },
  // Guess a line's mood from its words (a scene can also set `mood` itself).
  moodOf(text) {
    const t = String(text || '');
    if (/\b(thank|glad|welcome|well done|rejoice|celebrat|feast|friend|haha|ha!|splendid|wonderful|good news|at last)/i.test(t)) return 'smile';
    if (/\b(die|death|kill|blood|traitor|never|crush|destroy|enough|how dare|war\b|burn|fight|attack|revenge|vengeance|curse)/i.test(t) || /!.*!/.test(t)) return 'fierce';
    return 'neutral';
  },

  // ---------------------------------------------------------------- helpers
  canvas(grid, fw, fh, pad, rows) {
    const c = document.createElement('canvas'); c.width = grid.w; c.height = grid.h;
    const x = c.getContext('2d');
    x.putImageData(new ImageData(grid.toRGBA(), grid.w, grid.h), 0, 0);
    c.fw = fw; c.fh = fh; c.pad = pad; c.rows = rows;
    return c;
  },

  // Make everything ahead of time, a few pieces per idle moment, so first sight never stutters.
  warm() {
    if (!this.on) return;
    for (const id of Object.keys(this.UNITS)) if (DATA.units[id]) this.queue.push(() => this.unit(id));
    for (const gid of Object.keys(DATA.generals)) this.queue.push(() => this.hero(gid));
    const step = () => {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < 12) { try { this.queue.shift()(); } catch (e) { console.warn(e); } }
      if (this.queue.length) setTimeout(step, 30);
    };
    setTimeout(step, 400);
  },
};
