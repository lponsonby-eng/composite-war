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
    for (const f of Object.keys(DATA.factions)) this.gold[f] = DATA.startGold;
    for (const [id, s] of Object.entries(DATA.spots)) this.spots[id] = { owner: s.owner };
    this.placeGenerals();
    this.log(`You lead the ${DATA.factions[fid].name}. Unite the realm!`, 'good');
    this.startMap();
    this.centerOnHome();
  },

  // Starting positions: towns may list `gens` in js/map.js; otherwise each lord and the
  // next two generals go to the faction's capital and the rest spread over its other towns.
  // Free towns get the named heroes (biggest heartland towns first), or else a militia captain.
  placeGenerals() {
    const place = (gid, spot) => {
      const g = DATA.generals[gid];
      this.gens[gid] = { id: gid, faction: g.faction, spot, troops: g.troops, acted: false, alive: true, level: g.level || 1, xp: 0 };
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
  centerOnHome() {
    const c = this.capitalOf(this.player);
    if (c) MapView.centerOn(DATA.spots[c].x, DATA.spots[c].y);
  },

  save() {
    try {
      const { player, turn, gold, spots, gens, logLines } = this;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ player, turn, gold, spots, gens, logLines }));
      return true;
    } catch (e) { return false; }
  },
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d) return false;
      Object.assign(this, d);
      for (const g of Object.values(this.gens)) {           // saves from before levels existed
        if (!g.level) g.level = DATA.generals[g.id].level || 1;
        if (g.xp == null) g.xp = 0;
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
  activeFactions() { return Object.keys(DATA.factions).filter(f => !DATA.factions[f].neutral && this.spotsOf(f).length > 0); },

  unitPower(type) { const t = DATA.units[type]; return t.hp * t.atk / t.cd / 10 * (t.proj ? 1.2 : 1); },
  genPower(g) {
    const p = this.unitPower(DATA.generals[g.id].leads), L = DATA.leveling, lv = (g.level || 1) - 1;
    const lead = (1 + lv * L.leaderBonus) ** 2, squad = (1 + lv * L.squadBonus) ** 2;   // hp and attack both scale
    return p * 8 * lead + g.troops * p * squad;
  },

  // ======================================================== levels
  xpNeeded(g) { return DATA.leveling.xpBase + DATA.leveling.xpPerLevel * g.level; },
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

  // ======================================================== wandering generals
  hireCost(g) { return DATA.hiring.base + DATA.hiring.perLevel * g.level; },
  stayTurns() { const H = DATA.hiring; return H.stayMin + Math.floor(Math.random() * (H.stayMax - H.stayMin + 1)); },

  // Turns a general into a wanderer at a random town (other than `avoid`).
  makeWanderer(g, avoid) {
    const towns = Object.keys(this.spots).filter(id => id !== avoid);
    g.free = true; g.faction = null; g.troops = 0; g.acted = false;
    g.spot = towns[Math.floor(Math.random() * towns.length)];
    g.stay = this.stayTurns();
  },

  hire(gid, f) {
    const g = this.gens[gid], cost = this.hireCost(g);
    if (!g || !g.free || this.spots[g.spot].owner !== f || this.gold[f] < cost) return false;
    this.gold[f] -= cost;
    g.free = false; g.faction = f; g.acted = true; delete g.stay;
    g.troops = Math.max(g.troops, Math.ceil(DATA.generals[gid].max / 2));
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
      const g = this.gens[id] = { id, faction: null, troops: 0, acted: false, alive: true, level: d.level || 1, xp: 0 };
      this.makeWanderer(g);
      const mine = this.spots[g.spot].owner === this.player;
      this.log(`A wandering ${DATA.units[d.leads].name.toLowerCase()}, ${d.name} (Lv ${g.level}), has appeared at ${DATA.spots[g.spot].name}.${mine ? ' Hire them!' : ''}`, mine ? 'good' : 'muted');
    }
  },
  armyPower(list) { return list.reduce((s, g) => s + this.genPower(g), 0); },
  // Defenders fight better behind walls; the computer takes that into account.
  defensePower(spot) { return this.armyPower(this.generalsAt(spot)) * (DATA.spots[spot].walls ? 1.3 : 1); },
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

  recruitCost(list) {
    return list.reduce((s, g) => s + (DATA.generals[g.id].max - g.troops) * DATA.units[DATA.generals[g.id].leads].cost, 0);
  },

  recruit() {
    const list = [...this.ui.picked].map(id => this.gens[id]);
    let hired = 0;
    for (const g of list) {
      const cost = DATA.units[DATA.generals[g.id].leads].cost;
      while (g.troops < DATA.generals[g.id].max && this.gold[this.player] >= cost) {
        g.troops++; this.gold[this.player] -= cost; hired++;
      }
    }
    if (hired) { Assets.sfx('gold-1', 0.5); this.log(`Recruited ${hired} soldiers.`); }
    else this.log('Not enough gold to recruit.', 'bad');
    this.refreshTop(); this.renderPanel();
  },

  moveGenerals(from, to) {
    const list = [...this.ui.picked].map(id => this.gens[id]);
    for (const g of list) { g.spot = to; g.acted = true; }
    this.log(`${list.map(g => DATA.generals[g.id].name).join(', ')} marched to ${DATA.spots[to].name}.`);
    Assets.sfx('menu-2', 0.4);
    this.select(to);
  },

  attackDialog(from, to) {
    const att = [...this.ui.picked].map(id => this.gens[id]);
    const def = this.generalsAt(to);
    const owner = this.spots[to].owner;
    const ap = this.armyPower(att), dp = this.defensePower(to);
    const odds = def.length === 0 ? 'Undefended!' : ap > dp * 1.5 ? 'Favourable' : ap > dp * 0.9 ? 'Even' : 'Risky';
    const army = list => list.map(g => genChip(g)).join('') || '<div class="muted">No defenders</div>';
    const buttons = def.length === 0
      ? [['Capture', () => this.resolveAttack(from, to, att, def, 'auto')]]
      : [['Fight!', () => this.resolveAttack(from, to, att, def, 'live')],
         ['Auto-resolve', () => this.resolveAttack(from, to, att, def, 'auto')]];
    buttons.push(['Cancel', null]);
    modal(`<h2>Attack ${DATA.spots[to].name}?</h2>
      <div class="vs">
        <div><h3 style="color:${DATA.factions[this.player].color}">Your army</h3>${army(att)}</div>
        <div class="vs-mid">VS<br><span class="odds">${odds}</span></div>
        <div><h3 style="color:${DATA.factions[owner].color}">${DATA.factions[owner].name}</h3>${army(def)}</div>
      </div>
      <p class="terr">Battlefield: ${this.terrainText(to)}.</p>`, buttons);
  },

  async resolveAttack(from, to, att, def, how) {
    this.busy = true;
    await this.fight(from, to, att, def, this.player, this.spots[to].owner, how === 'live' ? 'att' : null);
    this.busy = false;
    this.select(this.spots[to].owner === this.player && this.generalsAt(to).length ? to : from);
    this.checkEnd();
  },

  // ======================================================== battles
  // Runs a battle (live or auto) and applies the result to the campaign.
  async fight(from, to, att, def, attF, defF, playerSide) {
    const spotName = DATA.spots[to].name;
    att.forEach(g => g.acted = true);
    let result;
    if (def.length === 0) {
      result = { winner: 'att', att: att.map(g => ({ id: g.id, alive: true, troops: g.troops, before: g.troops, xp: DATA.leveling.capture })), def: [] };
    } else {
      const army = list => list.map(g => ({ id: g.id, troops: g.troops, level: g.level }));
      const battle = new Battle({ attackers: army(att), defenders: army(def), attFaction: attF, defFaction: defF,
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
      g.troops = x.troops;
      if (!x.alive) fallen.push(DATA.generals[x.id].name);
      const before = g.level;
      x.levelUp = this.gainXp(g, x.xp || 0);
      x.level = g.level;
      if (x.levelUp && g.faction === this.player) {
        this.log(`${DATA.generals[x.id].name} reached level ${g.level}!`, 'good');
        Assets.sfx('power-up', 0.45);
      } else if (x.levelUp && before < 5 && g.level >= 5) {
        this.log(`Enemy general ${DATA.generals[x.id].name} is now level ${g.level}.`, 'muted');
      }
    }
    if (fallen.length) this.log(`Fallen in battle: ${fallen.join(', ')} (squads scattered).`);

    if (r.winner === 'att') {
      this.spots[to].owner = attF;
      for (const x of r.att) if (x.alive) this.gens[x.id].spot = to;
      // defenders retreat to a friendly neighbour, or are captured
      for (const x of r.def) {
        const g = this.gens[x.id];
        const escape = this.neighbors(to).filter(n => this.spots[n].owner === defF);
        if (escape.length) { g.spot = escape[Math.floor(Math.random() * escape.length)]; }
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
      if (this.spotsOf(defF).length === 0 && !DATA.factions[defF].neutral) {
        for (const g of this.gensOf(defF)) { if (DATA.generals[g.id].lord) g.alive = false; else this.makeWanderer(g); }
        this.log(`The ${DATA.factions[defF].name} has been destroyed!`, 'big');
      }
    } else {
      const mine = defF === this.player, theirs = attF === this.player;
      this.log(`${spotName} held against the ${DATA.factions[attF].name}.`, mine ? 'good' : theirs ? 'bad' : '');
    }
    this.refreshTop();
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
            <td>+${x.xp} XP${ups ? ` <span class="good">Level up!</span>` : ''}${x.alive ? '' : ' <span class="bad">fallen</span>'}</td></tr>`;
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

  buildBattleHud() {
    const b = this.battle;
    const side = s => {
      const f = b.factions[s];
      return `<div class="bh-side bh-${s}"><div class="bh-name" style="color:${DATA.factions[f].color}">${DATA.factions[f].name}</div>
        <div class="bh-gens" id="bh-gens-${s}"></div></div>`;
    };
    $('#battle-hud').innerHTML = `${side(0)}<div class="bh-mid"><div id="bh-time"></div>
      <div class="bh-where">${b.opts.spotName}<br><span class="bh-terr">${b.terrain.describe()}</span></div></div>${side(1)}`;
    const ctr = $('#battle-ctrl');
    ctr.innerHTML = `<span class="muted">You are ${b.playerSide === 0 ? 'attacking' : 'defending'}:</span>
      <button data-o="advance">Advance</button><button data-o="hold">Hold</button><button data-o="retreat">Retreat</button>
      <span class="sep"></span><button data-s="1">x1</button><button data-s="2">x2</button><button data-s="4">x4</button>`;
    const setOrder = o => { b.orders[b.playerSide] = o; this.updateBattleHud(true); };
    ctr.querySelectorAll('[data-o]').forEach(bt => bt.onclick = () => {
      if (bt.dataset.o !== 'retreat') return setOrder(bt.dataset.o);
      modal('<h2>Retreat?</h2><p>Your units run for the edge of the field. Those who escape survive, but the battle is lost.</p>',
        [['Retreat', () => setOrder('retreat')], ['Keep fighting', null]]);
    });
    ctr.querySelectorAll('[data-s]').forEach(bt => bt.onclick = () => { this.battleSpeed = +bt.dataset.s; this.updateBattleHud(true); });
    this.updateBattleHud(true);
  },

  updateBattleHud(force) {
    const b = this.battle; if (!b) return;
    for (const s of [0, 1]) {
      $('#bh-gens-' + s).innerHTML = b.sideInfo(s).map(x => `<div class="bh-gen ${x.alive ? '' : 'dead'}">
        <img src="${Assets.portrait(x.id)}" title="${DATA.generals[x.id].name} Lv ${this.gens[x.id].level}"><div class="bh-bar"><i style="width:${x.hp * 100}%"></i></div>
        <span>${x.troops}</span></div>`).join('');
    }
    const left = Math.max(0, Math.ceil(b.limit - b.time));
    $('#bh-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (force) {
      document.querySelectorAll('#battle-ctrl [data-o]').forEach(bt => bt.classList.toggle('on', b.orders[b.playerSide] === bt.dataset.o));
      document.querySelectorAll('#battle-ctrl [data-s]').forEach(bt => bt.classList.toggle('on', this.battleSpeed === +bt.dataset.s));
    }
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
    this.busy = false;
    $('#end-turn').disabled = false;
  },

  newTurn() {
    this.turn++;
    for (const f of Object.keys(DATA.factions))
      for (const id of this.spotsOf(f)) this.gold[f] += DATA.spots[id].income;
    for (const g of Object.values(this.gens)) {
      g.acted = false;
      if (g.alive && !g.free && DATA.factions[g.faction].neutral) g.troops = Math.min(DATA.generals[g.id].max, g.troops + 1);
    }
    this.wanderTurn();
    const inc = this.spotsOf(this.player).reduce((s, id) => s + DATA.spots[id].income, 0);
    this.log(`Turn ${this.turn}. Income +${inc} gold.`, 'turn');
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

    // 0. Hire any wandering general in our towns we can afford, best first
    for (const g of this.wanderers().filter(w => this.spots[w.spot].owner === f).sort((a, b) => b.level - a.level))
      this.hire(g.id, f);

    // 1. Recruit, front-line generals first
    const gens = this.gensOf(f).sort((a, b) => (front.has(b.spot) ? 1 : 0) - (front.has(a.spot) ? 1 : 0));
    for (const g of gens) {
      const cost = DATA.units[DATA.generals[g.id].leads].cost;
      while (g.troops < DATA.generals[g.id].max && this.gold[f] >= cost) { g.troops++; this.gold[f] -= cost; }
    }

    // 2. Attack wherever we are clearly stronger
    const isThreat = n => this.spots[n].owner !== f && !DATA.factions[this.spots[n].owner].neutral;
    for (const spot of shuffle(this.spotsOf(f))) {
      if (this.spots[spot].owner !== f) continue;
      let pool = this.generalsAt(spot).filter(g => !g.acted && g.faction === f);
      const enemies = this.neighbors(spot).filter(n => this.spots[n].owner !== f);
      if (!pool.length || !enemies.length) continue;
      const here = this.generalsAt(spot).length;
      const threatened = enemies.some(isThreat);
      let need = 1.15;
      // Keep someone home when a rival faction is next door: the lord, or else the weakest general.
      if (threatened && pool.length === here) {
        if (here === 1) need = 2;
        else {
          const lord = pool.find(g => DATA.generals[g.id].lord);
          pool.sort((a, b) => this.genPower(b) - this.genPower(a));
          pool = lord ? pool.filter(g => g !== lord) : pool.slice(0, -1);
        }
      }

      let best = null, bestRatio = 0;
      for (const n of enemies) {
        const dp = this.defensePower(n);
        const ratio = dp === 0 ? 99 : this.armyPower(pool) / dp;
        if (ratio > bestRatio) { bestRatio = ratio; best = n; }
      }
      if (!best || bestRatio < need) continue;

      const defF = this.spots[best].owner;
      const def = this.generalsAt(best);
      this.log(`${DATA.factions[f].name} attacks ${DATA.spots[best].name}!`, defF === this.player ? 'bad' : '');
      let side = null;
      if (defF === this.player && def.length) side = await this.defendPrompt(f, best, pool, def);
      await this.fight(spot, best, pool, def, f, defF, side);
      if (this.spotsOf(this.player).length === 0) return;
      await sleep(defF === this.player ? 250 : 40);
    }

    // 3. Gather idle generals next to the weakest enemy town on the border, to strike next turn
    const border = [...new Set(this.spotsOf(f).flatMap(id => this.neighbors(id).filter(n => this.spots[n].owner !== f)))];
    if (border.length) {
      const focus = shuffle(border).sort((a, b) => this.armyPower(this.generalsAt(a)) - this.armyPower(this.generalsAt(b)))[0];
      const dist = this.bfs(f, new Set(this.neighbors(focus).filter(n => this.spots[n].owner === f)));
      for (const g of this.gensOf(f)) {
        const s = g.spot;
        if (g.acted || !dist[s]) continue;
        if (DATA.generals[g.id].lord && DATA.spots[s].kind === 'capital') continue;
        if (this.neighbors(s).some(isThreat) && this.generalsAt(s).length <= 1) continue;
        const next = this.neighbors(s).find(n => this.spots[n].owner === f && dist[n] === dist[s] - 1);
        if (next) { g.spot = next; g.acted = true; }
      }
    }
    $('#turn-banner').hidden = true;
  },

  defendPrompt(f, spot, att, def) {
    MapView.centerOn(DATA.spots[spot].x, DATA.spots[spot].y);
    return new Promise(resolve => {
      Assets.sfx('alert', 0.5);
      modal(`<h2 class="bad">${DATA.factions[f].name} attacks ${DATA.spots[spot].name}!</h2>
        <div class="vs"><div><h3 style="color:${DATA.factions[f].color}">Attackers</h3>${att.map(genChip).join('')}</div>
        <div class="vs-mid">VS</div><div><h3 style="color:${DATA.factions[this.player].color}">Your defenders</h3>${def.map(genChip).join('')}</div></div>
        <p class="terr">Battlefield: ${this.terrainText(spot)}.</p>`,
        [['Defend!', () => resolve('def')], ['Auto-resolve', () => resolve(null)]], true);
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
      modal(`<h2 class="bad">Defeat</h2><p>The ${DATA.factions[this.player].name} has fallen on turn ${this.turn}.</p>`,
        [['Back to title', () => location.reload()]], true);
      return true;
    }
    const rivals = this.activeFactions().filter(f => f !== this.player);
    if (rivals.length === 0) {
      this.mode = 'over';
      Assets.sfx('power-up', 0.6);
      modal(`<h2 class="good">The Realm is United!</h2><p>The ${DATA.factions[this.player].name} has defeated every rival faction after ${this.turn} turns, and holds ${mine} towns.</p>`,
        [['Back to title', () => location.reload()]], true);
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
          <td>${this.spotsOf(f).length}</td><td>${this.gensOf(f).length}</td></tr>`;
      }).join('');
      p.innerHTML = `<h2>The Realm</h2><table class="realm"><tr><th>Faction</th><th>Towns</th><th>Generals</th></tr>${rows}</table>
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
    const list = gens.map(g => {
      const d = DATA.generals[g.id], u = DATA.units[d.leads];
      const canPick = own && !g.acted;
      return `<div class="gen ${g.acted && own ? 'acted' : ''} ${this.ui.picked.has(g.id) ? 'picked' : ''}" ${canPick ? `data-g="${g.id}"` : ''}>
        <img src="${Assets.portrait(g.id)}">
        <div class="gi"><div class="gn">${d.name} <span class="lv">Lv ${g.level}</span>${d.lord ? ' <span class="lord">Lord</span>' : ''}</div>
        <div class="gu">${u.name} - ${g.troops}/${d.max}</div>
        <div class="tbar"><i style="width:${g.troops / d.max * 100}%"></i></div>
        ${own ? `<div class="xbar" title="${g.xp}/${this.xpNeeded(g)} XP"><i style="width:${g.level >= DATA.leveling.maxLevel ? 100 : g.xp / this.xpNeeded(g) * 100}%"></i></div>` : ''}</div>
        ${own ? `<div class="gs">${g.acted ? 'done' : this.ui.picked.has(g.id) ? 'ready' : ''}</div>` : ''}</div>`;
    }).join('') || '<p class="muted">No generals here.</p>';

    const free = this.wanderersAt(id);
    const wlist = free.length ? `<h3 class="wh">Wandering here</h3><div class="gens">${free.map(g => {
      const d = DATA.generals[g.id], c = this.hireCost(g);
      return `<div class="gen"><img src="${Assets.portrait(g.id)}">
        <div class="gi"><div class="gn">${d.name} <span class="lv">Lv ${g.level}</span></div>
        <div class="gu">${DATA.units[d.leads].name} - squad ${Math.ceil(d.max / 2)}/${d.max}</div>
        <div class="gu">Leaves in ${g.stay} turn${g.stay === 1 ? '' : 's'}</div></div>
        ${own ? `<button data-hire="${g.id}" ${this.gold[this.player] < c ? 'disabled' : ''}>Hire ${c}g</button>` : ''}</div>`;
    }).join('')}</div>${own ? '' : '<p class="hint">Capture this town to hire them.</p>'}` : '';

    const picked = [...this.ui.picked].map(g => this.gens[g]);
    const cost = this.recruitCost(picked);
    p.innerHTML = `<h2 style="color:${fa.color}">${s.name}</h2>
      <div class="sub">${fa.name} - ${s.kind} - +${s.income} gold</div>
      <div class="gens">${list}</div>
      ${own ? `<div class="actions">
        <button id="btn-recruit" ${cost === 0 || !picked.length ? 'disabled' : ''}>Recruit (${cost}g)</button>
      </div>
      <p class="hint">${picked.length ? 'Click a highlighted neighbour: <b>white</b> to move, <b>red</b> to attack with the ticked generals.' : 'Tick generals (click them) to give orders.'}
      Recruiting does not use up a general's turn.</p>`
      : `<p class="hint">Strength: ${Math.round(this.armyPower(gens))}</p>`}
      ${wlist}`;
    p.querySelectorAll('[data-hire]').forEach(el => el.onclick = () => {
      if (this.busy) return;
      if (this.hire(el.dataset.hire, this.player)) { this.refreshTop(); this.select(id); }
    });
    p.querySelectorAll('[data-g]').forEach(el => el.onclick = () => this.togglePick(el.dataset.g));
    const rb = $('#btn-recruit'); if (rb) rb.onclick = () => this.recruit();
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
    <span class="muted">${DATA.units[d.leads].name} x${g.troops}</span></div></div>`;
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
