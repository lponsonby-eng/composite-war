// =============================================================================
//  GAME: campaign state, turns, player actions, the computer opponents, and UI.
// =============================================================================
const $ = sel => document.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SAVE_KEY = 'cw_save_v2';           // v2: the big map (older saves don't fit it)

const Game = {
  // ---- campaign state (everything here is saved) ----
  player: null, turn: 1, gold: {}, spots: {}, gens: {}, logLines: [],
  // ---- view state ----
  mode: 'title',            // title | map | battle
  busy: false,              // true while the computer is taking its turn
  ui: { selected: null, targets: {}, hover: null, picked: new Set() },
  battle: null, battleSpeed: 1,

  // ======================================================== setup / save
  newGame(fid) {
    this.player = fid; this.turn = 1; this.logLines = [];
    this.gold = {}; this.spots = {}; this.gens = {};
    this.clearCompanies(); this.coSeq = 0; this.coCount = {};
    for (const f of Object.keys(DATA.factions)) this.gold[f] = DATA.startGold;
    for (const [id, s] of Object.entries(DATA.spots)) this.spots[id] = { owner: s.owner };
    this.placeGenerals();
    this.startingCompanies();
    this.stock = {}; for (const f of Object.keys(DATA.factions)) this.refillStock(f);
    this.log(`You lead the ${DATA.factions[fid].name}. Unite the realm!`, 'good');
    this.seen = {}; this.evq = []; this.mods = [];
    this.startMap();
    this.centerOnHome();
    this.queueEvents('start');
    this.flushEvents();
  },

  // Starting positions: towns may list `gens` in js/map.js; otherwise each lord and the
  // next two generals go to the faction's capital and the rest spread over its other towns.
  // Free towns get the named heroes (biggest heartland towns first), or else a militia captain.
  placeGenerals() {
    const place = (gid, spot) => {
      const g = DATA.generals[gid];
      this.gens[gid] = { id: gid, faction: g.faction, spot, troops: g.troops, mix: Array(g.troops).fill(g.leads), lv: Array(g.troops).fill(1), acted: false, alive: true, level: g.level || 1, xp: 0 };
      this.rollSig(this.gens[gid]);
    };
    for (const [id, s] of Object.entries(DATA.spots)) for (const gid of s.gens || []) place(gid, id);
    const unplaced = f => Object.keys(DATA.generals).filter(gid => DATA.generals[gid].faction === f && !this.gens[gid] && !DATA.generals[gid].captain);
    for (const f of Object.keys(DATA.factions)) {
      if (DATA.factions[f].neutral) continue;
      const own = this.spotsOf(f);
      if (!own.length) continue;
      const cap = own.find(id => DATA.spots[id].kind === 'capital') || own[0];
      const rest = own.filter(id => id !== cap).sort((a, b) => dist(a, cap) - dist(b, cap));
      const gens = unplaced(f).sort((a, b) => (DATA.generals[b].lord ? 1 : 0) - (DATA.generals[a].lord ? 1 : 0));
      gens.forEach((gid, i) => place(gid, i < 3 || !rest.length ? cap : rest[(i - 3) % rest.length]));
    }
    const free = this.spotsOf('neutral').filter(id => !this.generalsAt(id).length)
      .sort((a, b) => (DATA.spots[b].region === 'free') - (DATA.spots[a].region === 'free') || DATA.spots[b].income - DATA.spots[a].income);
    unplaced('neutral').forEach((gid, i) => { if (free[i]) place(gid, free[i]); });
    for (const id of this.spotsOf('neutral')) if (!this.generalsAt(id).length && DATA.generals['cap_' + id]) place('cap_' + id, id);
  },

  capitalOf(f) {
    const own = this.spotsOf(f);
    return own.find(id => DATA.spots[id].kind === 'capital' && DATA.factions[f].home === DATA.spots[id].region) || own[0];
  },
  // Each faction starts with a few companies of its most common units in its capital.
  startingCompanies() {
    const C = DATA.companies;
    for (const f of Object.keys(DATA.factions)) {
      if (DATA.factions[f].neutral) continue;
      const cap = this.capitalOf(f); if (!cap) continue;
      const units = Object.entries(DATA.rosters[f] || {}).sort((a, b) => b[1] - a[1]).map(([u]) => u);
      for (let i = 0; i < C.start && units.length; i++) {
        const g = this.makeCompany(f, cap, units[i % units.length]);
        for (let k = 0; k < C.startTroops; k++) this.addSoldier(g, g.co.unit);
        g.acted = false;
      }
    }
  },
  centerOnHome() {
    const c = this.capitalOf(this.player);
    if (c) MapView.centerOn(DATA.spots[c].x, DATA.spots[c].y);
  },

  save() {
    try {
      const { player, turn, gold, spots, gens, logLines, stock, seen, mods, coSeq, coCount } = this;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ player, turn, gold, spots, gens, logLines, stock, seen, mods, coSeq, coCount }));
      return true;
    } catch (e) { return false; }
  },
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d) return false;
      this.mods = []; this.coSeq = 0; this.coCount = {};
      this.clearCompanies();
      Object.assign(this, d);
      for (const g of Object.values(this.gens)) if (g.co) DATA.addCompany(g.id, g.co.unit, g.faction, g.co.name);
      for (const g of Object.values(this.gens)) {           // saves from before levels existed
        if (!g.level) g.level = DATA.generals[g.id].level || 1;
        if (g.xp == null) g.xp = 0;
        if (!g.mix) g.mix = Array(g.troops).fill(DATA.generals[g.id].leads);
        if (!g.lv) g.lv = Array(g.mix.length).fill(1);
        if (!g.sig) this.rollSig(g);
      }
      this.startMap();
      this.log('Game loaded.');
      return true;
    } catch (e) { return false; }
  },

  startMap() {
    this.mode = 'map';
    document.body.dataset.mode = 'map';
    $('#title-screen').hidden = true;
    this.clearSelection();
    this.refreshTop();
    Assets.playMusic('map');
  },

  // ======================================================== queries
  generalsAt(spot) { return Object.values(this.gens).filter(g => g.alive && !g.free && g.spot === spot); },
  wanderersAt(spot) { return Object.values(this.gens).filter(g => g.alive && g.free && g.spot === spot); },
  wanderers() { return Object.values(this.gens).filter(g => g.alive && g.free); },
  gensOf(f) { return Object.values(this.gens).filter(g => g.alive && g.faction === f); },
  spotsOf(f) { return Object.keys(this.spots).filter(id => this.spots[id].owner === f); },
  neighbors(id) {
    const out = [];
    for (const [a, b] of DATA.links) { if (a === id) out.push(b); else if (b === id) out.push(a); }
    return out;
  },
  heroesOf(f) { return this.gensOf(f).filter(g => !DATA.generals[g.id].company); },
  companiesOf(f) { return this.gensOf(f).filter(g => DATA.generals[g.id].company); },
  // Stacks a town can hold (heroes' squads and companies) and how many more fit.
  room(spot) { return DATA.capOf(spot) - this.generalsAt(spot).length; },
  activeFactions() { return Object.keys(DATA.factions).filter(f => !DATA.factions[f].neutral && this.spotsOf(f).length > 0); },

  unitPower(type) { const t = DATA.units[type]; return t.hp * t.atk / t.cd / 10 * (t.proj ? 1.2 : 1); },
  genPower(g) {
    const d = DATA.generals[g.id], p = this.unitPower(d.leads) * (d.company ? 3 / 8 : 1), L = DATA.leveling, lv = (g.level || 1) - 1;
    const lead = (1 + lv * L.leaderBonus) ** 2, squad = (1 + lv * L.squadBonus) ** 2;   // hp and attack both scale
    const sigMul = 1 + this.learnedSig(g).reduce((s, x) => s + x.stars, 0) * DATA.signature.valuePerStar;   // strong abilities make a hero worth more
    return p * 8 * lead * sigMul + (g.mix || []).reduce((s, u, i) => { const b = DATA.soldierBoost((g.lv || [])[i]); return s + this.unitPower(u) * b.hp * b.atk; }, 0) * squad;
  },

  // ======================================================== levels
  xpNeeded(g) { return DATA.leveling.xpBase + DATA.leveling.xpPerLevel * g.level; },
  // Each hero's two signature abilities, rolled once (level 15 and level 30).
  rollSig(g) {
    const f = g.faction || DATA.generals[g.id].faction;
    const a = DATA.rollSignature(g.id, 0, f), b = DATA.rollSignature(g.id, 1, f, a.kind);
    g.sig = [a, b];
  },
  learnedSig(g) { return (g.sig || []).filter((s, t) => s && g.level >= DATA.signature.levels[t]); },

  // Adds XP and returns how many levels the general gained.
  gainXp(g, amount) {
    const L = DATA.leveling;
    let ups = 0;
    if (g.level >= L.maxLevel) return 0;
    g.xp += Math.round(amount);
    while (g.level < L.maxLevel && g.xp >= this.xpNeeded(g)) { g.xp -= this.xpNeeded(g); g.level++; ups++; }
    if (g.level >= L.maxLevel) g.xp = 0;
    return ups;
  },

  // ======================================================== companies (troop stacks without a hero)
  clearCompanies() {
    for (const id of Object.keys(DATA.generals)) if (DATA.generals[id].company) { delete DATA.generals[id]; delete Assets._portraits[id]; }
  },
  makeCompany(f, spot, unit) {
    this.coSeq = (this.coSeq || 0) + 1; this.coCount = this.coCount || {};
    const key = f + ':' + unit, n = this.coCount[key] = (this.coCount[key] || 0) + 1;
    const id = 'co_' + this.coSeq, name = `${DATA.ordinal(n)} ${DATA.units[unit].name} Company`;
    DATA.addCompany(id, unit, f, name);
    return (this.gens[id] = { id, faction: f, spot, troops: 0, mix: [], lv: [], acted: true, alive: true, level: 1, xp: 0, sig: [], co: { unit, name } });
  },
  companyCost(f, u) { return this.unitCost(f, u) * DATA.companies.captainCost; },
  canRaise(f, spot, u) { return this.room(spot) > 0 && this.stockLeft(f, u) > 0 && this.gold[f] >= this.companyCost(f, u); },
  // Raise a company of unit u in spot (pays for the captain), then buy up to `fill` soldiers.
  raiseCompany(f, spot, u, fill = 0) {
    if (!this.canRaise(f, spot, u)) return null;
    this.gold[f] -= this.companyCost(f, u);
    if (this.stockLeft(f, u) !== Infinity) this.stock[f][u]--;
    const g = this.makeCompany(f, spot, u);
    for (let i = 0; i < fill && this.buyOne(g, f, u); i++);
    return g;
  },
  disband(g, why) {
    g.alive = false; g.troops = 0; g.mix = []; g.lv = [];
    if (g.faction === this.player && why) this.log(`${DATA.generals[g.id].name} ${why}.`, 'bad');
  },

  // Reinforcements for a battle at `spot`: stacks of faction f from its neighbouring
  // towns (see DATA.reinforce). Never the last stack in a town, never a lord.
  reinforcementsFor(spot, f) {
    const R = DATA.reinforce, out = [];
    if (!f || DATA.factions[f].neutral) return out;
    for (const n of this.neighbors(spot)) {
      if (this.spots[n].owner !== f) continue;
      const here = this.generalsAt(n).filter(g => g.faction === f);
      const can = here.filter(g => !DATA.generals[g.id].lord && g.troops > 0).sort((a, b) => this.genPower(b) - this.genPower(a));
      const k = Math.min(can.length, Math.floor(here.length * R.share), here.length - 1);
      out.push(...can.slice(0, Math.max(0, k)));
    }
    return out.sort((a, b) => this.genPower(b) - this.genPower(a)).slice(0, R.max);
  },
  // Faction f's stacks that have not acted, in its towns next to `spot` (to join an attack).
  joinersFor(spot, f, except = []) {
    return this.neighbors(spot).filter(n => this.spots[n].owner === f)
      .flatMap(n => this.generalsAt(n).filter(g => g.faction === f && !g.acted && !except.includes(g)));
  },

  // ======================================================== wandering generals
  hireCost(g) {
    const stars = this.learnedSig(g).reduce((s, x) => s + x.stars, 0);
    return Math.round((DATA.hiring.base + DATA.hiring.perLevel * g.level) * (1 + stars * 0.1) / 5) * 5;
  },

  // ======================================================== persuasion
  // Gold it takes to win general g over (null if they cannot be persuaded).
  // A general is cornered when no neighbouring town belongs to their own side.
  cornered(g) { return !this.neighbors(g.spot).some(n => this.spots[n].owner === g.faction); },
  persuadeCost(g) {
    const d = DATA.generals[g.id], P = DATA.persuade;
    if (d.lord || d.company || g.free || !g.alive || !this.cornered(g)) return null;
    const mul = d.captain ? P.captainMul : DATA.factions[g.faction].neutral ? 1 : P.factionMul;
    return Math.round((P.base + this.genPower(g) * P.perPower) * mul / 5) * 5;
  },
  // One of faction f's generals who has not acted, in f's town next to `spot`.
  envoyFor(spot, f) {
    for (const n of this.neighbors(spot)) {
      if (this.spots[n].owner !== f) continue;
      const e = this.generalsAt(n).find(g => g.faction === f && !g.acted);
      if (e) return e;
    }
    return null;
  },
  persuade(gid, f) {
    const g = this.gens[gid], cost = this.persuadeCost(g), envoy = cost != null && this.envoyFor(g.spot, f);
    if (!envoy || this.gold[f] < cost) return false;
    const was = g.faction, from = g.spot;
    this.gold[f] -= cost;
    g.faction = f; g.spot = envoy.spot; g.acted = true; envoy.acted = true;
    const name = DATA.generals[gid].name, who = DATA.factions[f].name;
    if (f === this.player) { this.log(`${name} was persuaded to join you for ${cost} gold!`, 'good'); Assets.sfx('gold-1', 0.5); }
    else if (was === this.player) this.log(`Your general ${name} was bribed away by the ${who} (cut off at ${DATA.spots[from].name})!`, 'bad');
    else this.log(`${name} of the ${DATA.factions[was].name} was persuaded to join the ${who}.`, 'muted');
    if (this.spotsOf(was).length && !this.gensOf(was).length && !DATA.factions[was].neutral) this.log(`The ${DATA.factions[was].name} has no generals left!`, 'muted');
    return { from };
  },
  stayTurns() { const H = DATA.hiring; return H.stayMin + Math.floor(Math.random() * (H.stayMax - H.stayMin + 1)); },

  // Turns a general into a wanderer at a random town (other than `avoid`).
  makeWanderer(g, avoid) {
    const towns = Object.keys(this.spots).filter(id => id !== avoid);
    g.free = true; g.faction = null; g.troops = 0; g.mix = []; g.lv = []; g.acted = false;
    g.spot = towns[Math.floor(Math.random() * towns.length)];
    g.stay = this.stayTurns();
  },

  hire(gid, f) {
    const g = this.gens[gid], cost = this.hireCost(g);
    if (!g || !g.free || this.spots[g.spot].owner !== f || this.gold[f] < cost) return false;
    this.gold[f] -= cost;
    g.free = false; g.faction = f; g.acted = true; delete g.stay;
    while (g.troops < Math.ceil(DATA.generals[gid].max / 2)) this.addSoldier(g, this.prefType(g));
    const name = DATA.generals[gid].name;
    if (f === this.player) { this.log(`${name} has joined your army!`, 'good'); Assets.sfx('power-up', 0.5); }
    else this.log(`${name} has joined the ${DATA.factions[f].name}.`, this.neighborsOfPlayer(g.spot) ? 'bad' : 'muted');
    return true;
  },
  neighborsOfPlayer(spot) { return this.neighbors(spot).some(n => this.spots[n].owner === this.player); },

  // Each new turn: wanderers drift on, and sometimes a new one arrives.
  wanderTurn() {
    for (const g of this.wanderers()) {
      if (--g.stay > 0) continue;
      const ns = this.neighbors(g.spot);
      g.spot = ns[Math.floor(Math.random() * ns.length)];
      g.stay = this.stayTurns();
      if (this.spots[g.spot].owner === this.player)
        this.log(`${DATA.generals[g.id].name} (wanderer, Lv ${g.level}) wandered into ${DATA.spots[g.spot].name}.`, 'good');
    }
    const H = DATA.hiring;
    const pool = Object.keys(DATA.wanderers).filter(id => !this.gens[id]);
    if (pool.length && this.wanderers().length < H.maxOnMap && Math.random() < H.appearChance) {
      const id = pool[Math.floor(Math.random() * pool.length)], d = DATA.generals[id];
      const g = this.gens[id] = { id, faction: null, troops: 0, mix: [], lv: [], acted: false, alive: true, level: d.level || 1, xp: 0 };
      this.rollSig(g);
      this.makeWanderer(g);
      const mine = this.spots[g.spot].owner === this.player;
      this.log(`A wandering ${DATA.units[d.leads].name.toLowerCase()}, ${d.name} (Lv ${g.level}), has appeared at ${DATA.spots[g.spot].name}.${mine ? ' Hire them!' : ''}`, mine ? 'good' : 'muted');
    }
  },
  // An army whose archers and casters have no frontline to shield them counts as weaker.
  armyPower(list) {
    const hasFront = list.some(g => DATA.roleOf(g.id) === 'front');
    return list.reduce((s, g) => s + this.genPower(g) * (!hasFront && DATA.roleOf(g.id) === 'back' ? DATA.roles.back.noFrontPower : 1), 0);
  },
  // Defenders fight better behind walls; the computer takes that into account.
  defensePower(spot) {
    const s = DATA.spots[spot];
    return this.armyPower(this.generalsAt(spot)) * (s.walls ? 1.4 : 1) * (s.terrain === 'river' ? 1.25 : 1);
  },
  terrainText(spot) {
    const s = DATA.spots[spot];
    const t = { plains: 'Open plains', forest: 'Forest: slows units, cover from arrows',
      river: 'River: wade slowly or cross at the fords', swamp: 'Swamp: mud slows units',
      snow: 'Snowfield: deep drifts slow units, frozen ponds are fast but slippery', dunes: 'Dunes: sand slows units',
      lava: 'Lava field: walk around the molten pools', crystal: 'Crystal shore: crystal pillars block the way' }[s.terrain || 'plains'];
    return t + (s.walls ? '. Walls: defenders shelter behind them, attackers must use the gates' : '');
  },

  log(text, cls = '') {
    this.logLines.push({ text, cls, turn: this.turn });
    if (this.logLines.length > 60) this.logLines.shift();
    const el = $('#log');
    el.innerHTML = this.logLines.slice(-30).map(l => `<div class="${l.cls}">${l.text}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  },

  // ======================================================== player actions
  clearSelection() {
    this.ui.selected = null; this.ui.targets = {}; this.ui.picked = new Set();
    this.renderPanel();
  },

  select(id) {
    this.ui.selected = id;
    const own = this.spots[id].owner === this.player;
    this.ui.picked = new Set(own ? this.generalsAt(id).filter(g => !g.acted).map(g => g.id) : []);
    this.computeTargets();
    this.renderPanel();
    Assets.sfx('menu-1', 0.3);
  },

  computeTargets() {
    const id = this.ui.selected;
    this.ui.targets = {};
    if (!id || this.spots[id].owner !== this.player || this.ui.picked.size === 0) return;
    for (const n of this.neighbors(id)) this.ui.targets[n] = this.spots[n].owner === this.player ? 'move' : 'attack';
  },

  clickSpot(id) {
    if (this.busy || this.mode !== 'map') return;
    if (!id) { this.clearSelection(); return; }
    const kind = this.ui.targets[id];
    if (this.ui.selected && kind === 'move') return this.moveGenerals(this.ui.selected, id);
    if (this.ui.selected && kind === 'attack') return this.attackDialog(this.ui.selected, id);
    this.select(id);
  },

  togglePick(gid) {
    if (this.ui.picked.has(gid)) this.ui.picked.delete(gid); else this.ui.picked.add(gid);
    this.computeTargets();
    this.renderPanel();
  },

  // ======================================================== recruiting
  // A hero recruits their faction's units of the types their class allows.
  // pref is the type the quick Recruit button fills with (last one chosen).
  prefType(g) {
    const ok = DATA.recruitable(g.id, g.faction), d = DATA.generals[g.id];
    return ok.includes(g.pref) ? g.pref : ok.includes(d.leads) ? d.leads : ok[0];
  },
  addSoldier(g, type, lv = 1) { g.mix.push(type); (g.lv = g.lv || []).push(lv); g.troops = g.mix.length; },
  // Dismiss the lowest-level soldier of a type (veterans are kept).
  dismissSoldier(g, type) {
    let best = -1;
    g.mix.forEach((u, i) => { if (u === type && (best < 0 || (g.lv[i] || 1) < (g.lv[best] || 1))) best = i; });
    if (best >= 0) { g.mix.splice(best, 1); g.lv.splice(best, 1); g.troops = g.mix.length; }
  },
  canBuyVeterans(g) { return g.level >= DATA.promotion.veteranHeroLevel; },

  // ---- prices and the per-turn hiring stock of uncommon and rare units
  rarityOf(f, u) { return DATA.rarity(DATA.weightOf(f, u)); },
  unitCost(f, u, vet) {
    return Math.round(DATA.units[u].cost * DATA.rarityRules[this.rarityOf(f, u)].cost * (vet ? DATA.promotion.veteranCost : 1));
  },
  stockCap(f, u) {
    const R = DATA.rarityRules[this.rarityOf(f, u)];
    return R.perTurn === Infinity ? Infinity : R.perTurn + Math.floor(this.spotsOf(f).length / R.perTowns);
  },
  refillStock(f) {
    this.stock = this.stock || {};
    this.stock[f] = {};
    for (const u of Object.keys(DATA.rosters[f] || {})) { const c = this.stockCap(f, u); if (c !== Infinity) this.stock[f][u] = c; }
  },
  stockLeft(f, u) {
    if (this.stockCap(f, u) === Infinity) return Infinity;
    if (!this.stock || !this.stock[f]) this.refillStock(f);
    return this.stock[f][u] ?? this.stockCap(f, u);
  },
  canBuy(f, u, vet) { return this.stockLeft(f, u) > 0 && this.gold[f] >= this.unitCost(f, u, vet); },
  // Hire one soldier of type u into general g's squad for faction f (pays and uses stock).
  buyOne(g, f, u, vet) {
    if (g.troops >= DATA.generals[g.id].max || !this.canBuy(f, u, vet)) return false;
    this.gold[f] -= this.unitCost(f, u, vet);
    if (this.stockLeft(f, u) !== Infinity) this.stock[f][u]--;
    this.addSoldier(g, u, vet ? DATA.promotion.tierLevels[0] : 1);
    return true;
  },

  recruitCost(list) {
    return list.reduce((s, g) => s + (DATA.generals[g.id].max - g.troops) * this.unitCost(this.player, this.prefType(g)), 0);
  },

  recruit() {
    const list = [...this.ui.picked].map(id => this.gens[id]);
    let hired = 0, outOf = null;
    for (const g of list) {
      const type = this.prefType(g);
      while (g.troops < DATA.generals[g.id].max && this.buyOne(g, this.player, type)) hired++;
      if (g.troops < DATA.generals[g.id].max && this.stockLeft(this.player, type) <= 0) outOf = type;
    }
    if (hired) { Assets.sfx('gold-1', 0.5); this.log(`Recruited ${hired} soldiers.`); }
    if (outOf) this.log(`No more ${DATA.units[outOf].name} can be hired this turn.`, 'muted');
    else if (!hired) this.log('Not enough gold to recruit.', 'bad');
    this.refreshTop(); this.renderPanel();
  },

  // Recruit window for one general: buy any allowed unit type, or dismiss soldiers.
  recruitDialog(gid) {
    const g = this.gens[gid], d = DATA.generals[gid], cls = DATA.heroClasses[DATA.classOf(gid)];
    const m = $('#modal');
    const draw = () => {
      const gold = this.gold[this.player], room = d.max - g.troops;
      const counts = {}; for (const u of g.mix) counts[u] = (counts[u] || 0) + 1;
      const P = DATA.promotion, vet = this.canBuyVeterans(g);
      const rows = DATA.recruitable(gid, this.player).map(id => {
        const u = DATA.units[id], ty = DATA.unitTypes[u.type], stock = this.stockLeft(this.player, id);
        const extra = [u.splash ? 'area damage' : '', u.antiCav ? 'anti-cavalry' : '', u.type === 'cavalry' ? 'charge' : '', u.type === 'healer' ? 'heals allies' : ''].filter(Boolean).join(', ');
        return `<tr class="${g.pref === id || (!g.pref && d.leads === id) ? 'pref' : ''}">
          <td><img class="uico" src="${Assets.unitIcon(id)}"></td>
          <td><b>${u.name}</b> <span class="rar r${DATA.rarity(DATA.weightOf(this.player, id))[0]}">${DATA.rarity(DATA.weightOf(this.player, id))}</span><br><span class="role ${ty.role}">${ty.name}</span> <span class="muted">${extra}</span></td>
          <td class="st">HP ${u.hp}<br>${u.type === 'healer' ? 'Heal' : 'Atk'} ${u.atk} Def ${u.def}<br>Range ${u.range}</td>
          <td class="st">${this.unitCost(this.player, id)}g${stock === Infinity ? '' : `<br><span class="${stock ? '' : 'bad'}">${stock} left this turn</span>`}</td>
          <td>${counts[id] ? `<button data-dis="${id}" title="Dismiss one (lowest level first)">-</button>` : ''} <b>${counts[id] || 0}</b>
            <button data-add="${id}" ${room < 1 || !this.canBuy(this.player, id) ? 'disabled' : ''}>+1</button>
            <button data-fill="${id}" ${room < 1 || !this.canBuy(this.player, id) ? 'disabled' : ''}>Fill</button>
            ${vet ? `<br><button data-vet="${id}" ${room < 1 || !this.canBuy(this.player, id, true) ? 'disabled' : ''} title="Starts at level ${P.tierLevels[0]}">+1 ${DATA.unitName(id, P.tierLevels[0])} ${this.unitCost(this.player, id, true)}g</button>` : ''}</td></tr>`;
      }).join('');
      // soldiers of types this general can no longer recruit (e.g. after changing sides)
      const others = Object.keys(counts).filter(id => !DATA.recruitable(gid, this.player).includes(id))
        .map(id => `${DATA.units[id].name} x${counts[id]} <button data-dis="${id}">-</button>`).join(' ');
      m.innerHTML = `<div class="box rec"><h2>Recruit for ${d.name}</h2>
        <p><span class="role ${cls.role}">${cls.name}</span> ${d.lord && d.faction === this.player ? `As lord of the ${DATA.factions[this.player].name}, ${d.name} can recruit every unit the faction has, in any mix.` : cls.blurb}</p>
        <p class="muted">Squad ${g.troops}/${d.max} - Gold ${gold}. Fill sets the type the quick Recruit button uses. Uncommon and rare units cost more and only a few can be hired each turn.</p>
        <p class="muted">Squad: ${squadText(g, true) || 'empty'}</p>
        <div class="sigs">${(g.sig || []).map((s, t) => `<div class="sigl ${g.level >= DATA.signature.levels[t] ? '' : 'locked'}">
          <b>${s.name}</b> <span class="stars">${'\u2605'.repeat(s.stars)}${'\u2606'.repeat(5 - s.stars)}</span>
          <span class="muted">${g.level >= DATA.signature.levels[t] ? 'learned' : 'at level ' + DATA.signature.levels[t]} - ${s.desc} ${DATA.sigText(s)}</span></div>`).join('')}</div>
        <p class="muted">Soldiers level up in battle and are promoted at level ${P.tierLevels[0]} and ${P.tierLevels[1]}.
          ${vet ? `As a level ${g.level} hero, ${d.name} can also recruit veterans.` : `From hero level ${P.veteranHeroLevel}, ${d.name} can recruit veterans.`}</p>
        ${DATA.recruitable(gid, this.player).length > 1 ? `<p><button data-mix ${room < 1 ? 'disabled' : ''}>Fill with faction mix</button>
          <span class="muted">${Object.entries(DATA.rosters[this.player] || {}).filter(([u]) => DATA.recruitable(gid, this.player).includes(u)).map(([u, w]) => `${DATA.units[u].name} ${w}`).join(', ')}</span></p>` : ''}
        <table class="rect">${rows}</table>${others ? `<p class="muted">Other troops: ${others}</p>` : ''}
        <div class="mbtns"><button data-close>Done</button></div></div>`;
      m.hidden = false;
      const buy = (id, n) => {
        for (let i = 0; i < n && this.buyOne(g, this.player, id); i++);
        Assets.sfx('gold-1', 0.4); this.refreshTop(); draw();
      };
      m.querySelectorAll('[data-add]').forEach(b => b.onclick = () => buy(b.dataset.add, 1));
      const mixBtn = m.querySelector('[data-mix]');
      if (mixBtn) mixBtn.onclick = () => {                  // fill the free slots in the faction's usual proportions
        const ok = DATA.recruitable(gid, this.player), want = {}, have = {};
        for (const u of g.mix) have[u] = (have[u] || 0) + 1;
        const total = ok.reduce((s, u) => s + Math.max(1, DATA.weightOf(this.player, u)), 0);
        for (const u of ok) want[u] = Math.max(1, DATA.weightOf(this.player, u)) / total * d.max;
        let bought = 0;
        while (g.troops < d.max) {
          const u = ok.filter(x => this.canBuy(this.player, x)).sort((a, b) => ((have[a] || 0) - want[a]) - ((have[b] || 0) - want[b]))[0];
          if (!u || !this.buyOne(g, this.player, u)) break;
          have[u] = (have[u] || 0) + 1; bought++;
        }
        if (bought) Assets.sfx('gold-1', 0.4);
        this.refreshTop(); draw();
      };
      m.querySelectorAll('[data-vet]').forEach(b => b.onclick = () => {
        this.buyOne(g, this.player, b.dataset.vet, true);
        Assets.sfx('gold-1', 0.4); this.refreshTop(); draw();
      });
      m.querySelectorAll('[data-fill]').forEach(b => b.onclick = () => { g.pref = b.dataset.fill; buy(b.dataset.fill, 99); });
      m.querySelectorAll('[data-dis]').forEach(b => b.onclick = () => {
        this.dismissSoldier(g, b.dataset.dis);
        draw();
      });
      m.querySelector('[data-close]').onclick = () => { m.hidden = true; this.renderPanel(); };
    };
    m.onclick = e => { if (e.target === m) { m.hidden = true; this.renderPanel(); } };
    draw();
  },

  // Raise a company in town `spot`: pick a unit type; the captain costs a few soldiers'
  // pay, and the company can be filled right away or later with Recruit.
  raiseDialog(spot) {
    const m = $('#modal'), f = this.player, C = DATA.companies;
    const draw = () => {
      const rows = Object.keys(DATA.rosters[f] || {}).map(id => {
        const u = DATA.units[id], ty = DATA.unitTypes[u.type], stock = this.stockLeft(f, id);
        const cc = this.companyCost(f, id), full = cc + this.unitCost(f, id) * C.size, ok = this.canRaise(f, spot, id);
        return `<tr><td><img class="uico" src="${Assets.unitIcon(id)}"></td>
          <td><b>${u.name}</b> <span class="rar r${DATA.rarity(DATA.weightOf(f, id))[0]}">${DATA.rarity(DATA.weightOf(f, id))}</span><br><span class="role ${ty.role}">${ty.name}</span></td>
          <td class="st">HP ${u.hp}<br>Atk ${u.atk} Def ${u.def}<br>Range ${u.range}</td>
          <td class="st">Captain ${cc}g<br>Full ${full}g${stock === Infinity ? '' : `<br><span class="${stock ? '' : 'bad'}">${stock} left this turn</span>`}</td>
          <td><button data-r="${id}" ${ok ? '' : 'disabled'}>Captain only</button><br>
            <button data-rf="${id}" ${ok ? '' : 'disabled'}>Raise + fill</button></td></tr>`;
      }).join('');
      m.innerHTML = `<div class="box rec"><h2>Raise a company in ${DATA.spots[spot].name}</h2>
        <p>A company is a stack of troops of one type led by a captain of that type, up to ${C.size} soldiers. It needs no hero,
          levels up and is promoted like any squad, and can march, attack and reinforce on its own. It has no skills, cannot be
          persuaded, and disbands if its captain falls or it is cut off. A new company can act from next turn.</p>
        <p class="muted">Gold ${this.gold[f]} - room for ${this.room(spot)} more stack${this.room(spot) === 1 ? '' : 's'} here (${DATA.capOf(spot)} max).</p>
        <table class="rect">${rows}</table>
        <div class="mbtns"><button data-close>Done</button></div></div>`;
      m.hidden = false;
      const go = (id, fill) => {
        const g = this.raiseCompany(f, spot, id, fill);
        if (g) { Assets.sfx('gold-1', 0.5); this.log(`${DATA.generals[g.id].name} raised in ${DATA.spots[spot].name} (${g.troops} soldiers).`, 'good'); }
        this.refreshTop(); draw();
      };
      m.querySelectorAll('[data-r]').forEach(b => b.onclick = () => go(b.dataset.r, 0));
      m.querySelectorAll('[data-rf]').forEach(b => b.onclick = () => go(b.dataset.rf, C.size));
      m.querySelector('[data-close]').onclick = () => { m.hidden = true; this.select(spot); };
    };
    m.onclick = e => { if (e.target === m) { m.hidden = true; this.select(spot); } };
    draw();
  },

  moveGenerals(from, to) {
    const all = [...this.ui.picked].map(id => this.gens[id]), room = Math.max(0, this.room(to));
    const list = all.slice(0, room);
    if (!list.length) { this.log(`${DATA.spots[to].name} is full (${DATA.capOf(to)} stacks).`, 'bad'); return; }
    for (const g of list) { g.spot = to; g.acted = true; }
    if (list.length < all.length) this.log(`${DATA.spots[to].name} only had room for ${list.length} more.`, 'muted');
    this.log(`${list.map(g => DATA.generals[g.id].name).join(', ')} marched to ${DATA.spots[to].name}.`);
    Assets.sfx('menu-2', 0.4);
    this.select(to);
  },

  // Attack: the ticked stacks, plus any you add from your other towns next to the
  // target. The defenders call reinforcements from their own neighbouring towns.
  attackDialog(from, to) {
    const att = [...this.ui.picked].map(id => this.gens[id]);
    const owner = this.spots[to].owner;
    const def = this.generalsAt(to), reinf = this.reinforcementsFor(to, owner);
    const joiners = this.joinersFor(to, this.player, att).filter(g => g.spot !== from || !att.includes(g));
    const join = new Set();
    const m = $('#modal');
    const army = list => list.map(g => genChip(g)).join('') || '<div class="muted">No defenders</div>';
    const draw = () => {
      const all = att.concat(joiners.filter(g => join.has(g.id)));
      const ap = this.armyPower(all), dp = this.defensePower(to) + this.armyPower(reinf) * 0.8;
      const odds = def.length + reinf.length === 0 ? 'Undefended!' : ap > dp * 1.5 ? 'Favourable' : ap > dp * 0.9 ? 'Even' : 'Risky';
      const byTown = {}; for (const g of joiners) (byTown[g.spot] = byTown[g.spot] || []).push(g);
      const jhtml = Object.entries(byTown).map(([sp, list]) => `<div class="jtown"><b>From ${DATA.spots[sp].name}</b>${list.map(g =>
        `<label class="jg ${join.has(g.id) ? 'on' : ''}"><input type="checkbox" data-j="${g.id}" ${join.has(g.id) ? 'checked' : ''}>${genChip(g)}</label>`).join('')}</div>`).join('');
      const buttons = def.length + reinf.length === 0 ? [['Capture', 'auto']] : [['Fight!', 'live'], ['Auto-resolve', 'auto']];
      m.innerHTML = `<div class="box"><h2>Attack ${DATA.spots[to].name}?</h2>
        <div class="vs">
          <div><h3 style="color:${DATA.factions[this.player].color}">Your army (${all.length})</h3>${army(att)}${army(joiners.filter(g => join.has(g.id))).replace('<div class="muted">No defenders</div>', '')}</div>
          <div class="vs-mid">VS<br><span class="odds">${odds}</span></div>
          <div><h3 style="color:${DATA.factions[owner].color}">${DATA.factions[owner].name} (${def.length})</h3>${army(def)}
            ${reinf.length ? `<h3 class="muted">Reinforcements (${reinf.length}) - arrive during the battle</h3>${army(reinf)}` : ''}</div>
        </div>
        ${joiners.length ? `<h3>Join the attack from neighbouring towns <button data-all>${join.size === joiners.length ? 'None' : 'All'}</button></h3><div class="joins">${jhtml}</div>` : ''}
        <p class="terr">Battlefield: ${this.terrainText(to)}.</p>
        ${formationNote(all)}
        <div class="mbtns">${buttons.map(([l, k]) => `<button data-go="${k}">${l}</button>`).join('')}<button data-x>Cancel</button></div></div>`;
      m.hidden = false; m.onclick = null;
      m.querySelectorAll('[data-j]').forEach(el => el.onchange = () => { if (el.checked) join.add(el.dataset.j); else join.delete(el.dataset.j); draw(); });
      const ab = m.querySelector('[data-all]');
      if (ab) ab.onclick = () => { if (join.size === joiners.length) join.clear(); else for (const g of joiners) join.add(g.id); draw(); };
      m.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { m.hidden = true; this.resolveAttack(from, to, all, def, b.dataset.go, reinf); });
      m.querySelector('[data-x]').onclick = () => { m.hidden = true; };
    };
    draw();
  },

  async resolveAttack(from, to, att, def, how, reinf = []) {
    this.busy = true;
    await this.fight(from, to, att, def, this.player, this.spots[to].owner, how === 'live' ? 'att' : null, reinf);
    await this.flushEvents();
    this.busy = false;
    this.select(this.spots[to].owner === this.player && this.generalsAt(to).length ? to : from);
    this.checkEnd();
  },

  // ======================================================== battles
  // Runs a battle (live or auto) and applies the result to the campaign.
  // reinf: the defenders' reinforcements (they arrive during the battle; if the town
  // itself is empty they are there from the start).
  async fight(from, to, att, def, attF, defF, playerSide, reinf = []) {
    const spotName = DATA.spots[to].name;
    att.forEach(g => g.acted = true);
    if (!def.length && reinf.length) { def = reinf; reinf = []; }
    let result;
    if (def.length === 0) {
      result = { winner: 'att', att: att.map(g => ({ id: g.id, alive: true, troops: g.troops, mix: g.mix.slice(), lv: g.lv.slice(), before: g.troops, xp: DATA.leveling.capture })), def: [] };
    } else {
      const mineList = playerSide === 'att' ? att : playerSide === 'def' ? def : null;
      if (mineList) await this.formationDialog(mineList, DATA.spots[to].name);
      const army = list => list.map(g => ({ id: g.id, troops: g.troops, mix: g.mix.slice(), lv: g.lv.slice(), level: g.level, sig: g.sig,
        row: list === mineList ? g.row || DATA.roleOf(g.id) : null }));
      const battle = new Battle({ attackers: army(att), defenders: army(def), reserve: army(reinf), attFaction: attF, defFaction: defF,
        spotName, spotId: to, playerSide, headless: !playerSide });
      result = playerSide ? await this.playBattle(battle) : battle.runHeadless();
    }
    this.applyResult(from, to, attF, defF, result);
    return result;
  },

  applyResult(from, to, attF, defF, r) {
    const spotName = DATA.spots[to].name;
    const fallen = [];
    for (const x of r.att.concat(r.def)) {
      const g = this.gens[x.id];
      g.troops = x.troops; g.mix = x.mix || []; g.lv = x.lv || g.mix.map(() => 1);
      if (x.promoted && x.promoted.length && g.faction === this.player) {
        const c = {}; for (const n of x.promoted) c[n] = (c[n] || 0) + 1;
        this.log(`${DATA.generals[x.id].name}'s soldiers promoted: ${Object.entries(c).map(([n, k]) => `${k} ${n}`).join(', ')}!`, 'good');
        Assets.sfx('power-up', 0.4);
      }
      if (!x.alive) fallen.push(DATA.generals[x.id].name);
      const before = g.level;
      x.levelUp = this.gainXp(g, x.xp || 0);
      x.level = g.level;
      const learned = (g.sig || []).filter((s, t) => s && before < DATA.signature.levels[t] && g.level >= DATA.signature.levels[t]);
      if (x.levelUp && g.faction === this.player) {
        this.log(`${DATA.generals[x.id].name} reached level ${g.level}!`, 'good');
        for (const s of learned) this.queueEvents('learn', { hero: x.id, other: s.name });
        for (const s of learned) this.log(`${DATA.generals[x.id].name} learned ${s.name} ${'\u2605'.repeat(s.stars)} (${DATA.sigText(s)})!`, 'big');
        Assets.sfx('power-up', 0.45);
      } else if (x.levelUp && before < 5 && g.level >= 5) {
        this.log(`Enemy general ${DATA.generals[x.id].name} is now level ${g.level}.`, 'muted');
      }
    }
    if (fallen.length) this.log(`Fallen in battle: ${fallen.join(', ')} (squads scattered).`);
    // a company whose captain fell is gone
    for (const x of r.att.concat(r.def)) if (!x.alive && DATA.generals[x.id].company) this.disband(this.gens[x.id]);

    if (r.winner === 'att') {
      this.spots[to].owner = attF;
      // the victors move in, as many as the town holds; the rest stay where they came from
      let room = DATA.capOf(to);
      for (const x of r.att) if (x.alive && this.gens[x.id].alive && room > 0) { this.gens[x.id].spot = to; room--; }
      // defenders retreat to a friendly neighbour, or are captured; reinforcements go home
      for (const x of r.def) {
        const g = this.gens[x.id];
        if (!g.alive || g.spot !== to) continue;
        const escape = this.neighbors(to).filter(n => this.spots[n].owner === defF && this.room(n) > 0);
        if (escape.length) { g.spot = escape[Math.floor(Math.random() * escape.length)]; }
        else if (DATA.generals[g.id].company) this.disband(g, 'was cut off and disbanded');
        else if (DATA.generals[g.id].captain) {
          g.alive = false;                                         // militia captains just go home
        } else if (DATA.factions[defF].neutral && !DATA.generals[g.id].lord) {
          g.faction = attF; g.spot = to; g.acted = true;          // free generals join the conqueror
          this.log(`${DATA.generals[g.id].name} has joined the ${DATA.factions[attF].name}!`, attF === this.player ? 'good' : '');
        } else if (DATA.generals[g.id].lord) {
          g.alive = false;
          this.log(`${DATA.generals[g.id].name} was captured.`, defF === this.player ? 'bad' : '');
        } else {
          this.makeWanderer(g, to);
          this.log(`${DATA.generals[g.id].name} was defeated and now wanders the realm.`, defF === this.player ? 'bad' : '');
        }
      }
      const mine = attF === this.player, theirs = defF === this.player;
      this.log(`${DATA.factions[attF].name} captured ${spotName}!`, mine ? 'good' : theirs ? 'bad' : '');
      if (mine) { this.queueEvents('won', { spot: to }); this.queueEvents('capture', { spot: to, from: defF }); }
      if (this.spotsOf(defF).length === 0 && !DATA.factions[defF].neutral) {
        for (const g of this.gensOf(defF)) { if (DATA.generals[g.id].lord || DATA.generals[g.id].company) g.alive = false; else this.makeWanderer(g); }
        this.log(`The ${DATA.factions[defF].name} has been destroyed!`, 'big');
        this.queueEvents('fallen', { faction: defF, other: DATA.factions[defF].name });
      }
    } else {
      const mine = defF === this.player, theirs = attF === this.player;
      this.log(`${spotName} held against the ${DATA.factions[attF].name}.`, mine ? 'good' : theirs ? 'bad' : '');
      if (mine) this.queueEvents('won', { spot: to });
    }
    this.refreshTop();
  },

  // Formation screen before a battle you fight yourself: put each squad in the front
  // or back row and order them along the line. Choices are remembered (g.row) and
  // the list order is kept for this battle.
  formationDialog(list, where) {
    return new Promise(resolve => {
      const m = $('#modal');
      for (const g of list) if (!g.row) g.row = DATA.roleOf(g.id);
      const order = list.slice();
      const card = (g, i) => {
        const d = DATA.generals[g.id];
        return `<div class="fslot" data-sw="${g.id}" title="Click to move to the ${g.row === 'front' ? 'back' : 'front'} row">
          <img src="${Assets.portrait(g.id)}"><div class="fi"><b>${d.name}</b> <span class="lv">Lv ${g.level}</span><br>
          ${roleTag(g.id)} <span class="muted">${g.troops}/${d.max}</span><div class="muted sq">${squadText(g) || 'No troops'}</div></div>
          <div class="fmv"><button data-up="${g.id}" title="Move up the line">&#9650;</button><button data-dn="${g.id}" title="Move down the line">&#9660;</button></div></div>`;
      };
      const draw = () => {
        const fr = order.filter(g => g.row === 'front'), bk = order.filter(g => g.row === 'back');
        m.innerHTML = `<div class="box form"><h2>Battle formation - ${where}</h2>
          <p class="muted">Click a squad to switch rows. Arrows move it along the line (top to bottom of the field).
            The front row deploys nearest the enemy; the back row behind it. Group moves in Auto formation keep these rows.</p>
          <div class="frows">
            <div class="frow"><h3>Back row</h3>${bk.map(card).join('') || '<p class="muted">empty</p>'}</div>
            <div class="frow front"><h3>Front row <span class="muted">enemy &#8594;</span></h3>${fr.map(card).join('') || '<p class="muted">empty</p>'}</div>
          </div>
          ${bk.length && !fr.length ? '<p class="warn">Your back row has no front row to protect it.</p>' : ''}
          <div class="mbtns"><button data-auto>Auto (by class)</button><button data-go class="primary">Start battle</button></div></div>`;
        m.hidden = false; m.onclick = null;
        m.querySelectorAll('[data-sw]').forEach(el => el.onclick = e => {
          if (e.target.closest('button')) return;
          const g = list.find(x => x.id === el.dataset.sw); g.row = g.row === 'front' ? 'back' : 'front'; Assets.sfx('menu-1', 0.25); draw();
        });
        const move = (id, dir) => {
          const g = order.find(x => x.id === id), same = order.filter(x => x.row === g.row), i = same.indexOf(g), j = i + dir;
          if (j < 0 || j >= same.length) return;
          const a = order.indexOf(g), b = order.indexOf(same[j]); [order[a], order[b]] = [order[b], order[a]]; draw();
        };
        m.querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(b.dataset.up, -1));
        m.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => move(b.dataset.dn, 1));
        m.querySelector('[data-auto]').onclick = () => { for (const g of list) g.row = DATA.roleOf(g.id); draw(); };
        m.querySelector('[data-go]').onclick = () => { m.hidden = true; list.splice(0, list.length, ...order); resolve(); };
      };
      draw();
    });
  },

  playBattle(battle) {
    return new Promise(resolve => {
      this.battle = battle; this.battleSpeed = 1;
      this.mode = 'battle';
      document.body.dataset.mode = 'battle';
      Assets.playMusic('battle');
      this.buildBattleHud();
      battle.onDone = () => {
        const r = battle.result;
        const won = (r.winner === 'att') === (battle.playerSide === 0);
        Assets.sfx(won ? 'succes' : 'game-over', 0.5);
        const mine = battle.playerSide === 0 ? r.att : r.def;
        const theirs = battle.playerSide === 0 ? r.def : r.att;
        const rows = list => list.map(x => {
          const g = this.gens[x.id], ups = levelsFrom(g, x.xp);
          return `<tr><td>${DATA.generals[x.id].name} <span class="lv">Lv ${g.level}</span></td><td>${x.before} &gt; ${x.troops} troops</td>
            <td>+${x.xp} XP${ups ? ` <span class="good">Level up!</span>` : ''}${x.promoted && x.promoted.length ? ` <span class="good">${x.promoted.length} promoted</span>` : ''}${x.alive ? '' : ' <span class="bad">fallen</span>'}</td></tr>`;
        }).join('');
        modal(`<h2 class="${won ? 'good' : 'bad'}">${won ? 'Victory!' : 'Defeat'}</h2>
          ${r.timeout ? '<p class="muted">Time ran out: the defenders hold.</p>' : ''}
          <table class="res"><tr><th colspan="3">Your forces</th></tr>${rows(mine)}
          <tr><th colspan="3">Enemy forces</th></tr>${rows(theirs)}</table>`,
          [['Continue', () => {
            this.battle = null; this.mode = 'map'; document.body.dataset.mode = 'map';
            Assets.playMusic('map');
            resolve(r);
          }]], true);
      };
    });
  },

  buildBattleHud() { BattleUI.start(this.battle); },
  updateBattleHud() { BattleUI.updateHud(); },

  // ======================================================== story events (js/events.js)
  // Finds the events for a trigger and puts them in the queue. At most one random
  // (chance) event per check, picked in random order, and only if no other event fired. storyOff turns events off (used by tests).
  queueEvents(trigger, c = {}) {
    if (this.storyOff || !window.EVENTS) return;
    this.seen = this.seen || {}; this.evq = this.evq || [];
    let randomDone = false;
    const fixed = EVENTS.filter(e => !e.chance), rnd = EVENTS.filter(e => e.chance);
    for (let i = rnd.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rnd[i], rnd[j]] = [rnd[j], rnd[i]]; }
    for (const e of fixed.concat(rnd)) {
      if (e.trigger !== trigger || (!e.repeat && this.seen[e.id])) continue;
      try { if (e.when && !e.when(this, c)) continue; } catch (err) { continue; }
      if (e.chance) { if (randomDone || Math.random() > e.chance) continue; }
      randomDone = true;                       // a random event only if nothing else happened
      if (!e.repeat) this.seen[e.id] = true;
      this.evq.push({ e, c });
    }
  },

  async flushEvents() {
    while (this.evq && this.evq.length) {
      const { e, c } = this.evq.shift();
      await this.storyDialog(e, c);
    }
    this.refreshTop();
    if (this.mode === 'map') this.renderPanel();
  },

  // Who is speaking: a general id, 'lord', 'advisor', 'hero' or 'narrator'.
  speaker(who, c) {
    const mine = this.gensOf(this.player);
    if (who === 'lord') return (mine.find(g => DATA.generals[g.id].lord) || {}).id || null;
    if (who === 'advisor') {
      if (!this.advisorId || !mine.some(g => g.id === this.advisorId)) this.advisorId = (mine.find(g => !DATA.generals[g.id].lord) || {}).id;
      return this.advisorId || null;
    }
    if (who === 'hero') return c.hero || null;
    return who === 'narrator' ? null : who;
  },

  storyText(t, c) {
    const lord = this.speaker('lord', c), adv = this.speaker('advisor', c);
    const town = c.spot || (this.evTown = this.evTown && this.spots[this.evTown].owner === this.player ? this.evTown : this.capitalOf(this.player));
    return t.replace(/\{(\w+)\}/g, (m, k) => ({
      lord: lord ? DATA.generals[lord].name : 'my lord', advisor: adv ? DATA.generals[adv].name : 'your advisor',
      faction: DATA.factions[this.player].name, town: town ? DATA.spots[town].name : 'the capital',
      region: town ? DATA.regions[DATA.spots[town].region].name : '', other: c.other || '', prev: c.from ? DATA.factions[c.from].name : '', hero: c.hero ? DATA.generals[c.hero].name : '',
    })[k] ?? m);
  },

  // Shows an event's scenes one by one, then its choices. Resolves when done.
  storyDialog(e, c) {
    this.evTown = null;
    return new Promise(resolve => {
      const m = $('#modal');
      let i = 0;
      const show = (html, buttons) => {
        m.innerHTML = `<div class="box story">${html}<div class="mbtns">${buttons.map((b, k) => `<button data-k="${k}">${b[0]}</button>`).join('')}</div></div>`;
        m.hidden = false; m.onclick = null;
        m.querySelectorAll('[data-k]').forEach(el => el.onclick = () => buttons[+el.dataset.k][1]());
      };
      const scene = () => {
        const sc = e.scenes[i], gid = this.speaker(sc.who, c);
        const name = gid ? DATA.generals[gid].name : '';
        const html = `<div class="scene ${gid ? '' : 'narr'}">${gid ? `<img src="${Assets.portrait(gid)}">` : ''}
          <div>${name ? `<div class="who">${name}</div>` : ''}<p>${this.storyText(sc.text, c)}</p></div></div>`;
        const last = i === e.scenes.length - 1;
        if (!last) return show(html, [['Next', () => { i++; scene(); }]]);
        const choices = (e.choices || []).filter(ch => { try { return !ch.when || ch.when(this, c); } catch (err) { return false; } });
        if (!choices.length) return show(html, [['Continue', done]]);
        show(html, choices.map(ch => [ch.label + (ch.outcomes ? ' <span class="risk">?</span>' : ''), () => {
          const r = this.resolveChoice(ch, c);
          this.refreshTop();
          if (!r.text && !r.lines) return done();
          if (r.lines) this.log(r.lines, r.mood === 'bad' ? 'bad' : r.mood === 'mixed' ? '' : 'good');
          const head = r.mood ? `<div class="mood ${r.mood}">${{ good: 'Fortune smiles', bad: 'Misfortune', mixed: 'A mixed blessing' }[r.mood]}</div>` : '';
          show(`${head}${r.text ? `<p class="otext">${this.storyText(r.text, c)}</p>` : ''}${r.lines ? `<p class="result ${r.mood || 'good'}">${r.lines}</p>` : ''}`, [['Continue', done]]);
        }]));
      };
      const done = () => { m.hidden = true; resolve(); };
      Assets.sfx('menu-2', 0.3);
      scene();
    });
  },

  // Runs a choice. A choice either has an effect, or outcomes: one is picked at random
  // by weight (w: a number or (G, c) => number) and has a mood (good / bad / mixed),
  // a line of story text and an effect. Effects return a line, or a list of lines.
  resolveChoice(ch, c) {
    let o = ch;
    if (ch.outcomes) {
      const ws = ch.outcomes.map(x => { try { return Math.max(0, typeof x.w === 'function' ? x.w(this, c) : (x.w ?? 1)); } catch (err) { return 0; } });
      let r = Math.random() * ws.reduce((a, b) => a + b, 0);
      o = ch.outcomes.find((x, i) => (r -= ws[i]) < 0) || ch.outcomes[ch.outcomes.length - 1];
    }
    let res = '';
    try { res = o.effect ? o.effect(this, c) || '' : ''; } catch (err) { console.warn(err); }
    if (Array.isArray(res)) res = res.filter(Boolean).join(' ');
    return { mood: o.mood || null, text: o.text || '', lines: res };
  },

  // Lasting effects from events: { f, n, turns, name } changes a faction's income each turn.
  applyMods() {
    this.mods = (this.mods || []).filter(m => {
      if (!this.gold[m.f] && this.gold[m.f] !== 0) return false;
      this.gold[m.f] = Math.max(0, this.gold[m.f] + m.n);
      m.turns--;
      if (m.f === this.player) this.log(`${m.name}: ${m.n >= 0 ? '+' : ''}${m.n} gold${m.turns > 0 ? ` (${m.turns} more turn${m.turns > 1 ? 's' : ''})` : ' (last turn)'}.`, m.n >= 0 ? 'good' : 'bad');
      return m.turns > 0;
    });
  },

  // Effects that events can use: G.ev.gold(n) etc. Each returns a line for the player.
  get ev() {
    const G = this, f = this.player, mine = () => this.gensOf(f);
    return {
      gold(n) { G.gold[f] = Math.max(0, G.gold[f] + n); return n >= 0 ? `+${n} gold.` : `${n} gold.`; },
      troops(n) {
        let k = 0;
        for (const g of mine().sort((a, b) => (a.troops / DATA.generals[a.id].max) - (b.troops / DATA.generals[b.id].max)))
          while (k < n && g.troops < DATA.generals[g.id].max) { G.addSoldier(g, G.prefType(g)); k++; }
        return k ? `${k} soldiers joined your squads.` : 'Your squads are full - the volunteers go home.';
      },
      loseTroops(frac) {
        let k = 0;
        for (const g of mine()) { const n = Math.floor(g.troops * frac + Math.random()); for (let i = 0; i < n && g.mix.length; i++) { G.dismissSoldier(g, g.mix[Math.floor(Math.random() * g.mix.length)]); k++; } }
        return `${k} soldiers lost.`;
      },
      xp(n) {
        const ups = [];
        for (const g of mine()) { const before = g.level; G.gainXp(g, n); if (g.level > before) ups.push(`${DATA.generals[g.id].name} Lv ${g.level}`);
          for (const s of (g.sig || []).filter((s, t) => s && before < DATA.signature.levels[t] && g.level >= DATA.signature.levels[t])) G.log(`${DATA.generals[g.id].name} learned ${s.name}!`, 'big'); }
        return `Your heroes gain ${n} XP.` + (ups.length ? ' Level up: ' + ups.join(', ') + '.' : '');
      },
      veterans(n) {
        const cand = mine().flatMap(g => g.lv.map((l, i) => ({ g, i, l }))).filter(x => x.l < DATA.promotion.tierLevels[0]);
        let k = 0;
        while (k < n && cand.length) { const x = cand.splice(Math.floor(Math.random() * cand.length), 1)[0]; x.g.lv[x.i] = DATA.promotion.tierLevels[0]; k++; }
        return k ? `${k} soldiers promoted.` : 'No soldiers to train.';
      },
      wanderer() {
        const town = G.capitalOf(f);
        const pool = Object.keys(DATA.wanderers).filter(id => !G.gens[id]);
        let g;
        if (pool.length) {
          const id = pool[Math.floor(Math.random() * pool.length)], d = DATA.generals[id];
          g = G.gens[id] = { id, faction: null, troops: 0, mix: [], lv: [], acted: false, alive: true, level: d.level || 1, xp: 0 };
          G.rollSig(g); G.makeWanderer(g);
        } else g = G.wanderers()[0];
        if (!g) return 'Nobody answered.';
        g.spot = town; g.stay = Math.max(g.stay || 0, 4);
        return `${DATA.generals[g.id].name} (Lv ${g.level}) is waiting in ${DATA.spots[town].name} - hire them there.`;
      },
      // income(n, turns, name): +/- n gold at the start of each of your next turns
      income(n, turns, name) {
        G.mods = G.mods || []; G.mods.push({ f, n, turns, name });
        return `${name}: ${n >= 0 ? '+' : ''}${n} gold a turn for ${turns} turns.`;
      },
      // the same for every rival faction (not you, not the Free Towns)
      rivalIncome(n, turns, name) {
        G.mods = G.mods || [];
        for (const r of G.activeFactions()) if (r !== f) G.mods.push({ f: r, n, turns, name });
        return `Every rival ${n >= 0 ? 'gains' : 'loses'} ${Math.abs(n)} gold a turn for ${turns} turns.`;
      },
      rivalGold(n) {
        for (const r of G.activeFactions()) if (r !== f) G.gold[r] = Math.max(0, G.gold[r] + n);
        return `Every rival ${n >= 0 ? 'gains' : 'loses'} ${Math.abs(n)} gold.`;
      },
      rivalTroops(frac) {
        let k = 0;
        for (const g of Object.values(G.gens)) {
          if (!g.alive || g.free || g.faction === f || DATA.factions[g.faction].neutral) continue;
          const n = Math.floor(g.troops * frac + Math.random());
          for (let i = 0; i < n && g.mix.length; i++) { G.dismissSoldier(g, g.mix[Math.floor(Math.random() * g.mix.length)]); k++; }
        }
        return `Rival armies lose ${k} soldiers.`;
      },
      // xp for one random hero of yours (a hero lost in a dangerous errand comes back wiser)
      heroXp(n) {
        const list = mine(); if (!list.length) return '';
        const g = list[Math.floor(Math.random() * list.length)], before = g.level;
        G.gainXp(g, n);
        return `${DATA.generals[g.id].name} gains ${n} XP${g.level > before ? ` and reaches level ${g.level}` : ''}.`;
      },
    };
  },

  // ======================================================== turns & computer players
  async endTurn() {
    if (this.busy || this.mode !== 'map') return;
    this.busy = true;
    this.clearSelection();
    $('#end-turn').disabled = true;
    for (const f of Object.keys(DATA.factions)) {
      if (f === this.player || DATA.factions[f].neutral || this.spotsOf(f).length === 0) continue;
      await this.aiTurn(f);
      if (this.checkEnd()) { this.busy = false; return; }
    }
    this.newTurn();
    this.queueEvents('turn');
    await this.flushEvents();
    this.busy = false;
    $('#end-turn').disabled = false;
  },

  newTurn() {
    this.turn++;
    for (const f of Object.keys(DATA.factions)) this.refillStock(f);
    for (const f of Object.keys(DATA.factions))
      for (const id of this.spotsOf(f)) this.gold[f] += DATA.spots[id].income;
    for (const g of Object.values(this.gens)) {
      g.acted = false;
      if (g.alive && !g.free && DATA.factions[g.faction].neutral && g.troops < DATA.generals[g.id].max) this.addSoldier(g, DATA.generals[g.id].leads);
    }
    this.wanderTurn();
    const inc = this.spotsOf(this.player).reduce((s, id) => s + DATA.spots[id].income, 0);
    this.log(`Turn ${this.turn}. Income +${inc} gold.`, 'turn');
    this.applyMods();
    Assets.sfx('gold-1', 0.4);
    this.refreshTop();
    this.renderPanel();
    this.save();
  },

  async aiTurn(f) {
    this.log(`${DATA.factions[f].name} is moving...`, 'muted');
    $('#turn-banner').textContent = `${DATA.factions[f].name}'s turn`;
    $('#turn-banner').style.color = DATA.factions[f].color;
    $('#turn-banner').hidden = false;
    await sleep(150);

    // Spots that touch an enemy are the "front". Interior armies march toward it.
    const front = new Set(this.spotsOf(f).filter(id => this.neighbors(id).some(n => this.spots[n].owner !== f)));

    // 0a. Persuade every cornered general next to our towns that is worth it and affordable
    const P = DATA.persuade;
    const targets = [...new Set(this.spotsOf(f).flatMap(id => this.neighbors(id)))]
      .filter(n => this.spots[n].owner !== f)
      .flatMap(n => this.generalsAt(n))
      .map(g => ({ g, c: this.persuadeCost(g) })).filter(x => x.c != null && this.genPower(x.g) / x.c >= P.aiMinValue)
      .sort((a, b) => this.genPower(b.g) / b.c - this.genPower(a.g) / a.c);
    for (const { g, c } of targets) {
      if (this.gold[f] < c + P.aiReserve) continue;
      const mine = g.faction === this.player;
      if (this.persuade(g.id, f) && mine) Assets.sfx('alert', 0.5);
    }

    // 0. Hire any wandering general in our towns we can afford, best first
    for (const g of this.wanderers().filter(w => this.spots[w.spot].owner === f).sort((a, b) => b.level - a.level))
      this.hire(g.id, f);

    // 1. Raise companies in towns with room, front towns first, while keeping a reserve
    const C = DATA.companies, roster = Object.keys(DATA.rosters[f] || {});
    const spots = this.spotsOf(f).sort((a, b) => (front.has(b) ? 1 : 0) - (front.has(a) ? 1 : 0) || DATA.capOf(b) - DATA.capOf(a));
    let raised = 0;
    const maxRaise = 1 + Math.floor(this.spotsOf(f).length / 6);
    for (const sp of spots) {
      if (raised >= maxRaise) break;
      if (this.room(sp) <= (front.has(sp) ? 1 : 3)) continue;
      const avail = roster.filter(u => this.canRaise(f, sp, u) && this.gold[f] >= this.companyCost(f, u) + this.unitCost(f, u) * C.size * 0.6 + 60);
      if (!avail.length) continue;
      const u = DATA.pickWeighted(f, avail);
      if (this.raiseCompany(f, sp, u, C.size)) raised++;
    }

    // 2. Recruit, front-line stacks first
    const gens = this.gensOf(f).sort((a, b) => (front.has(b.spot) ? 1 : 0) - (front.has(a.spot) ? 1 : 0));
    for (const g of gens) {
      const ok = DATA.recruitable(g.id, f), pref = this.prefType(g);
      while (g.troops < DATA.generals[g.id].max) {
        // by the faction's hiring weights (the hero's own type counts double)
        const avail = ok.filter(u => this.canBuy(f, u));
        if (!avail.length) break;
        const type = DATA.pickWeighted(f, avail, pref);
        if (this.canBuyVeterans(g) && this.gold[f] >= this.unitCost(f, type, true) + 300 && this.buyOne(g, f, type, true)) continue;   // rich: a veteran
        if (!this.buyOne(g, f, type)) break;
      }
    }

    // 3. Attack where we are clearly stronger, marching in from every neighbouring town.
    // A town next to a rival faction keeps someone home: its lord, or else its weakest stack.
    const isThreat = n => this.spots[n].owner !== f && !DATA.factions[this.spots[n].owner].neutral;
    const available = sp => {
      const here = this.generalsAt(sp).filter(g => g.faction === f);
      let pool = here.filter(g => !g.acted && g.troops > 0);
      if (this.neighbors(sp).some(isThreat) && pool.length === here.length) {
        const lord = pool.find(g => DATA.generals[g.id].lord);
        pool.sort((a, b) => this.genPower(b) - this.genPower(a));
        pool = lord ? pool.filter(g => g !== lord) : pool.slice(0, -1);
      }
      return pool;
    };
    const border = () => [...new Set(this.spotsOf(f).flatMap(id => this.neighbors(id).filter(n => this.spots[n].owner !== f)))];
    for (const target of shuffle(border())) {
      if (this.spots[target].owner === f) continue;
      const srcs = this.neighbors(target).filter(n => this.spots[n].owner === f);
      const pool = srcs.flatMap(available);
      if (!pool.length) continue;
      const defF = this.spots[target].owner, def = this.generalsAt(target);
      const reinf = this.reinforcementsFor(target, defF);
      const dp = this.defensePower(target) + this.armyPower(reinf) * 0.8;
      const ratio = dp === 0 ? 99 : this.armyPower(pool) / dp;
      if (ratio < 1.15) continue;
      const from = srcs.sort((a, b) => pool.filter(g => g.spot === b).length - pool.filter(g => g.spot === a).length)[0];
      this.log(`${DATA.factions[f].name} attacks ${DATA.spots[target].name}${pool.length > 1 ? ` with ${pool.length} stacks` : ''}!`, defF === this.player ? 'bad' : '');
      let side = null, help = reinf;
      if (defF === this.player && (def.length || reinf.length)) ({ side, help } = await this.defendPrompt(f, target, pool, def, reinf));
      await this.fight(from, target, pool, def, f, defF, side, help);
      if (this.spotsOf(this.player).length === 0) return;
      await sleep(defF === this.player ? 250 : 40);
    }

    // 4. Gather idle stacks next to the weakest enemy town on the border, to strike next turn
    const edge = border();
    if (edge.length) {
      const focus = shuffle(edge).sort((a, b) => this.armyPower(this.generalsAt(a)) - this.armyPower(this.generalsAt(b)))[0];
      const dist = this.bfs(f, new Set(this.neighbors(focus).filter(n => this.spots[n].owner === f)));
      for (const g of this.gensOf(f)) {
        const s = g.spot;
        if (g.acted || !dist[s]) continue;
        if (DATA.generals[g.id].lord && DATA.spots[s].kind === 'capital') continue;
        if (this.neighbors(s).some(isThreat) && this.generalsAt(s).length <= 1) continue;
        const next = this.neighbors(s).find(n => this.spots[n].owner === f && dist[n] === dist[s] - 1);
        if (next && this.room(next) > 0) { g.spot = next; g.acted = true; }
      }
    }
    $('#turn-banner').hidden = true;
  },

  // You are attacked: choose which of your stacks in neighbouring towns come to help
  // (the usual ones are ticked), then fight or auto-resolve.
  defendPrompt(f, spot, att, def, reinf) {
    MapView.centerOn(DATA.spots[spot].x, DATA.spots[spot].y);
    const cand = this.neighbors(spot).filter(n => this.spots[n].owner === this.player).flatMap(n => this.generalsAt(n).filter(g => g.faction === this.player && g.troops > 0));
    const pick = new Set(reinf.map(g => g.id));
    return new Promise(resolve => {
      Assets.sfx('alert', 0.5);
      const m = $('#modal');
      const draw = () => {
        m.innerHTML = `<div class="box"><h2 class="bad">${DATA.factions[f].name} attacks ${DATA.spots[spot].name}!</h2>
          <div class="vs"><div><h3 style="color:${DATA.factions[f].color}">Attackers (${att.length})</h3>${att.map(genChip).join('')}</div>
          <div class="vs-mid">VS</div><div><h3 style="color:${DATA.factions[this.player].color}">Your defenders (${def.length})</h3>${def.map(genChip).join('') || '<div class="muted">The town is empty</div>'}</div></div>
          ${cand.length ? `<h3>Send reinforcements from neighbouring towns <span class="muted">(${pick.size} chosen, max ${DATA.reinforce.max}; they arrive after about ${DATA.reinforce.delay}s and go home afterwards)</span></h3>
            <div class="joins">${cand.map(g => `<label class="jg ${pick.has(g.id) ? 'on' : ''}"><input type="checkbox" data-j="${g.id}" ${pick.has(g.id) ? 'checked' : ''}>${genChip(g)}<span class="muted">${DATA.spots[g.spot].name}</span></label>`).join('')}</div>` : ''}
          <p class="terr">Battlefield: ${this.terrainText(spot)}.</p>
          <div class="mbtns"><button data-go="def">Defend!</button><button data-go="auto">Auto-resolve</button></div></div>`;
        m.hidden = false; m.onclick = null;
        m.querySelectorAll('[data-j]').forEach(el => el.onchange = () => {
          if (el.checked && pick.size < DATA.reinforce.max) pick.add(el.dataset.j); else pick.delete(el.dataset.j);
          draw();
        });
        m.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
          m.hidden = true;
          const help = cand.filter(g => pick.has(g.id));
          resolve({ side: b.dataset.go === 'def' && (def.length || help.length) ? 'def' : null, help });
        });
      };
      draw();
    });
  },

  bfs(f, sources) {                                  // distance (in roads, through own towns) from the sources
    const dist = {}; const q = [...sources];
    for (const s of q) dist[s] = 0;
    while (q.length) {
      const c = q.shift();
      for (const n of this.neighbors(c)) if (this.spots[n].owner === f && dist[n] === undefined) { dist[n] = dist[c] + 1; q.push(n); }
    }
    return dist;
  },

  checkEnd() {
    const mine = this.spotsOf(this.player).length;
    if (mine === 0) {
      this.mode = 'over';
      this.queueEvents('defeat');
      this.flushEvents().then(() => modal(`<h2 class="bad">Defeat</h2><p>The ${DATA.factions[this.player].name} has fallen on turn ${this.turn}.</p>`,
        [['Back to title', () => location.reload()]], true));
      return true;
    }
    const rivals = this.activeFactions().filter(f => f !== this.player);
    if (rivals.length === 0) {
      this.mode = 'over';
      Assets.sfx('power-up', 0.6);
      this.queueEvents('victory');
      this.flushEvents().then(() => modal(`<h2 class="good">The Realm is United!</h2><p>The ${DATA.factions[this.player].name} has defeated every rival faction after ${this.turn} turns, and holds ${mine} towns.</p>`,
        [['Back to title', () => location.reload()]], true));
      return true;
    }
    return false;
  },

  // ======================================================== UI panels
  refreshTop() {
    const f = DATA.factions[this.player];
    $('#tb-faction').textContent = f.name;
    $('#tb-faction').style.color = f.color;
    $('#tb-gold').textContent = this.gold[this.player];
    $('#tb-turn').textContent = this.turn;
    $('#tb-spots').textContent = `${this.spotsOf(this.player).length}/${Object.keys(this.spots).length}`;
  },

  renderPanel() {
    const p = $('#panel');
    const id = this.ui.selected;
    if (!id) {
      const rows = Object.keys(DATA.factions).filter(f => this.spotsOf(f).length).map(f => {
        const fa = DATA.factions[f];
        return `<tr><td><i class="dot" style="background:${fa.color}"></i>${fa.name}${f === this.player ? ' (you)' : ''}</td>
          <td>${this.spotsOf(f).length}</td><td>${this.heroesOf(f).length}</td><td>${this.companiesOf(f).length}</td></tr>`;
      }).join('');
      p.innerHTML = `<h2>The Realm</h2><table class="realm"><tr><th>Faction</th><th>Towns</th><th>Heroes</th><th>Co.</th></tr>${rows}</table>
        <p class="hint">Click one of your towns (yellow names) to command the generals there.
        Then click a road neighbour: <b>white</b> = move, <b>red</b> = attack.</p>
        ${this.wanderers().length ? `<h3 class="wh">Wandering generals</h3>${this.wanderers().map(g =>
          `<div class="hint">${DATA.generals[g.id].name} <span class="lv">Lv ${g.level}</span> at ${DATA.spots[g.spot].name}</div>`).join('')}
          <p class="hint">Hire them when they are in one of your towns.</p>` : ''}`;
      return;
    }
    const s = DATA.spots[id], owner = this.spots[id].owner, fa = DATA.factions[owner];
    const own = owner === this.player;
    const gens = this.generalsAt(id);
    const envoy = own ? null : this.envoyFor(id, this.player);
    const list = gens.map(g => {
      const d = DATA.generals[g.id], u = DATA.units[d.leads];
      const canPick = own && !g.acted;
      const pc = own ? null : this.persuadeCost(g);
      return `<div class="gen ${g.acted && own ? 'acted' : ''} ${this.ui.picked.has(g.id) ? 'picked' : ''}" ${canPick ? `data-g="${g.id}"` : ''}>
        <img src="${Assets.portrait(g.id)}">
        <div class="gi"><div class="gn">${d.name} <span class="lv">Lv ${g.level}</span>${d.lord ? ' <span class="lord">Lord</span>' : ''}${d.company ? ' <span class="coy">Company</span>' : ''}</div>
        <div class="gu">${roleTag(g.id)} ${g.troops}/${d.max} ${own ? `<button class="mini" data-rec="${g.id}">Recruit</button>` : ''}</div>
        <div class="gu sq">${squadText(g) || 'No troops'}</div>
        <div class="tbar"><i style="width:${g.troops / d.max * 100}%"></i></div>
        ${own ? `<div class="xbar" title="${g.xp}/${this.xpNeeded(g)} XP"><i style="width:${g.level >= DATA.leveling.maxLevel ? 100 : g.xp / this.xpNeeded(g) * 100}%"></i></div>` : ''}</div>
        ${own ? `<div class="gs">${g.acted ? 'done' : this.ui.picked.has(g.id) ? 'ready' : ''}</div>`
          : pc == null ? (d.lord || d.company ? `<div class="gs muted" title="${d.company ? 'Companies' : 'Lords'} cannot be persuaded">loyal</div>`
            : '<div class="gs muted" title="Can still fall back to a neighbouring town of their own side. Cut them off first.">can retreat</div>')
          : `<button class="persuade" data-per="${g.id}" ${!envoy || this.gold[this.player] < pc ? 'disabled' : ''}
              title="${envoy ? `Envoy: ${DATA.generals[envoy.id].name} from ${DATA.spots[envoy.spot].name}` : 'Needs one of your generals who has not acted, in a town next to this one'}">Persuade<br>${pc}g</button>`}</div>`;
    }).join('') || '<p class="muted">No generals here.</p>';

    const free = this.wanderersAt(id);
    const wlist = free.length ? `<h3 class="wh">Wandering here</h3><div class="gens">${free.map(g => {
      const d = DATA.generals[g.id], c = this.hireCost(g);
      return `<div class="gen"><img src="${Assets.portrait(g.id)}">
        <div class="gi"><div class="gn">${d.name} <span class="lv">Lv ${g.level}</span></div>
        <div class="gu">${roleTag(g.id)} ${DATA.units[d.leads].name} - squad ${Math.ceil(d.max / 2)}/${d.max}</div>
        <div class="gu">Leaves in ${g.stay} turn${g.stay === 1 ? '' : 's'}</div></div>
        ${own ? `<button data-hire="${g.id}" ${this.gold[this.player] < c ? 'disabled' : ''}>Hire ${c}g</button>` : ''}</div>`;
    }).join('')}</div>${own ? '' : '<p class="hint">Capture this town to hire them.</p>'}` : '';

    const picked = [...this.ui.picked].map(g => this.gens[g]);
    const cost = this.recruitCost(picked);
    p.innerHTML = `<h2 style="color:${fa.color}">${s.name}</h2>
      <div class="sub">${fa.name} - ${s.kind} - +${s.income} gold - stacks ${gens.length}/${DATA.capOf(id)}</div>
      <div class="gens">${list}</div>
      ${own ? `<div class="actions">
        <button id="btn-recruit" ${cost === 0 || !picked.length ? 'disabled' : ''}>Recruit (${cost}g)</button>
        <button id="btn-raise" ${this.room(id) > 0 ? '' : 'disabled'} title="Hire troops as their own stack, led by a captain">Raise company</button>
      </div>
      <p class="hint">${picked.length ? 'Click a highlighted neighbour: <b>white</b> to move, <b>red</b> to attack with the ticked generals.' : 'Tick generals (click them) to give orders.'}
      Recruiting does not use up a general's turn.</p>`
      : `<p class="hint">Strength: ${Math.round(this.armyPower(gens))}</p>
         ${gens.length ? `<p class="hint">Only cornered generals (no neighbouring town of their own side) can be persuaded.
           ${envoy ? `Envoy: <b>${DATA.generals[envoy.id].name}</b> (${DATA.spots[envoy.spot].name}), who uses their turn.`
           : 'You also need a general who has not acted, in one of your towns next to this one, to go as envoy.'}</p>` : ''}`}
      ${wlist}`;
    p.querySelectorAll('[data-per]').forEach(el => el.onclick = () => {
      if (this.busy) return;
      const r = this.persuade(el.dataset.per, this.player);
      if (r) { this.refreshTop(); this.select(this.gens[el.dataset.per].spot); }
    });
    p.querySelectorAll('[data-hire]').forEach(el => el.onclick = () => {
      if (this.busy) return;
      if (this.hire(el.dataset.hire, this.player)) { this.refreshTop(); this.select(id); }
    });
    p.querySelectorAll('[data-g]').forEach(el => el.onclick = () => this.togglePick(el.dataset.g));
    p.querySelectorAll('[data-rec]').forEach(el => el.onclick = e => { e.stopPropagation(); this.recruitDialog(el.dataset.rec); });
    const rb = $('#btn-recruit'); if (rb) rb.onclick = () => this.recruit();
    const cb = $('#btn-raise'); if (cb) cb.onclick = () => this.raiseDialog(id);
  },

  showTitle() {
    this.mode = 'title';
    document.body.dataset.mode = 'title';
    const ts = $('#title-screen');
    const cards = Object.entries(DATA.factions).filter(([, f]) => f.playable).map(([id, f]) => {
      const [lordId, lord] = Object.entries(DATA.generals).find(([, g]) => g.faction === id && g.lord);
      const towns = Object.values(DATA.spots).filter(s => s.owner === id).length;
      return `<button class="fcard" data-f="${id}" style="--fc:${f.color}">
        <img src="${Assets.portrait(lordId)}"><div><div class="fn">${f.name}</div>
        <div class="fl">Lord ${lord.name} - ${towns} towns</div><div class="fb">${f.blurb}</div></div></button>`;
    }).join('');
    ts.innerHTML = `<div class="title-box"><h1>${DATA.title}</h1>
      <p class="muted">A pixel-art war of generals and towns</p>
      ${this.hasSave() ? '<button id="btn-continue" class="big">Continue saved game</button>' : ''}
      <h3>Choose your faction</h3><div class="fcards">${cards}</div></div>`;
    ts.hidden = false;
    ts.querySelectorAll('[data-f]').forEach(b => b.onclick = () => this.newGame(b.dataset.f));
    const c = $('#btn-continue'); if (c) c.onclick = () => this.load();
  },
};

// ---------------------------------------------------------------- helpers
function genChip(g) {
  const d = DATA.generals[g.id];
  return `<div class="chip"><img src="${Assets.portrait(g.id)}"><div><b>${d.name}</b> <span class="lv">Lv ${g.level}</span><br>
    ${roleTag(g.id)} <span class="muted">${squadText(g) || 'no troops'}</span></div></div>`;
}

// How many levels a general would gain from xp, without changing them.
function levelsFrom(g, xp) {
  const copy = { level: g.level, xp: g.xp };
  return Game.gainXp(copy, xp || 0);
}

// Simple dialog: buttons = [[label, fn|null], ...]
function modal(html, buttons, noClose) {
  const m = $('#modal');
  m.innerHTML = `<div class="box">${html}<div class="mbtns">${buttons.map((b, i) => `<button data-i="${i}">${b[0]}</button>`).join('')}</div></div>`;
  m.hidden = false;
  m.querySelectorAll('[data-i]').forEach(el => el.onclick = () => {
    m.hidden = true;
    const fn = buttons[+el.dataset.i][1];
    if (fn) fn();
  });
  m.onclick = e => { if (e.target === m && !noClose) m.hidden = true; };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function dist(a, b) { const p = DATA.spots[a], q = DATA.spots[b]; return Math.hypot(p.x - q.x, p.y - q.y); }

// Small tag with a general's class, coloured by frontline / backline.
function roleTag(gid) {
  const c = DATA.heroClasses[DATA.classOf(gid)];
  return `<span class="role ${c.role}" title="${c.name} (${DATA.roles[c.role].name}): ${c.blurb}">${c.name}</span>`;
}

// "Knight x4, Paladin x1" (promoted soldiers under their tier name; with levels, the average level)
function squadText(g, levels) {
  const counts = {}, sum = {};
  (g.mix || []).forEach((u, i) => {
    const lv = (g.lv || [])[i] || 1, n = DATA.unitName(u, lv);
    counts[n] = (counts[n] || 0) + 1; sum[n] = (sum[n] || 0) + lv;
  });
  return Object.entries(counts).map(([n, k]) => `${n} x${k}${levels ? ` (Lv ${Math.round(sum[n] / k)})` : ''}`).join(', ');
}

// One line about an army's formation, with a warning when the backline is unprotected.
function formationNote(list) {
  const f = list.filter(g => DATA.roleOf(g.id) === 'front').length, b = list.length - f;
  if (b && !f) return `<p class="warn">No frontline: your ${b > 1 ? 'archers and casters are' : 'backline general is'} exposed to melee and fight weaker.</p>`;
  if (f && !b) return `<p class="terr">Formation: ${f} frontline, no backline support.</p>`;
  return `<p class="terr">Formation: ${f} frontline in front, ${b} backline behind.</p>`;
}
