// =============================================================================
//  CHARS: hand-made, animated characters from free sprite packs (see
//  tools/sprites/import.py and assets/sprites/catalog.json), used for generals,
//  heroes, many units and monsters. Each is recoloured for the faction that fields
//  it (its cloth takes the faction's hue, kept muted) and snapped to the game's palette.
//  Sheets have one row per animation (idle, run, attack, hurt, death), facing right;
//  Assets.drawUnit plays them (mirrored when facing left).
//
//  Who looks like whom is set in Chars.UNITS (unit types), Chars.MONSTER_GENERALS and
//  Chars.generalFor (generals by class, lords by crown). Units not listed keep their
//  generated look (cavalry, artillery and a few beasts).
// =============================================================================
const Chars = {
  cat: null, img: {},
  UNITS: {
    knight: 'lm_hero_knight2', warden: 'lm_warrior3', brawler: 'sv_bandit_heavy', sunguard: 'lm_fantasy_warrior',
    ashigaru: 'lm_warrior', nomad: 'lm_warrior', militia: 'sv_bandit_light',
    archer: 'lm_huntress2', hunter: 'lm_huntress2', ranger: 'lm_huntress2', bandit: 'lm_huntress2',
    mage: 'lm_wizard', witch: 'lm_wizard', tidemage: 'lm_wizard',
    cleric: 'lm_wizard', shaman: 'lm_wizard', druid: 'lm_wizard', seapriest: 'lm_wizard', sunpriest: 'lm_wizard',
    ninja: 'lm_martial_hero3',
    skeleton: 'lm_skeleton', bonepriest: 'lm_skeleton', flame: 'lm_fire_worm', ghost: 'sv_wraith',
    frosteye: 'lm_flying_eye', crystal: 'lm_flying_eye', hawk: 'pb_hawk', slime: 'lm_slime', thorn: 'lm_mushroom',
    bogshaman: 'lm_goblin', frogman: 'lm_goblin', fishfolk: 'lm_goblin', beast: 'sv_berserker',
    // cavalry, beasts and engines from the second round of free packs
    lancer: 'ad_rider', emberider: 'ad_rider', nightmare: 'ad_rider', stagrider: 'ad_rider', waverider: 'ad_rider',
    camelrider: 'ot_camel', bearrider: 'pb_dire_bear', boarrider: 'tw_boar', yeti: 'pr_yeti', beetle: 'pg_beetle',
    bulwark: 'el_crab', cannon: 'pd_cannon', firecannon: 'pd_cannon', suncannon: 'pd_cannon', mortar: 'pd_cannon',
    catapult: 'np_catapult',
  },
  // monsters whose colours are their own (a fire worm stays fiery): recoloured only slightly
  OWN_COLOURS: ['lm_skeleton', 'lm_fire_worm', 'sv_wraith', 'lm_flying_eye', 'lm_bat', 'lm_slime', 'lm_mushroom',
    'lm_goblin', 'sv_berserker', 'sv_flame_demon', 'sv_flame_demon2', 'lm_rat',
    'pr_yeti', 'pb_dire_bear', 'pb_hawk', 'pb_wolf', 'pb_scorpion', 'tw_boar', 'el_crab', 'pg_beetle', 'pd_cannon', 'np_catapult'],
  MONSTER_GENERALS: { brrn: 'pr_yeti', grimbark: 'pg_beetle', shellos: 'el_crab', ignis: 'sv_flame_demon2', morta: 'lm_evil_wizard3', ooze: 'lm_slime', morrow: 'lm_mushroom',
    krug: 'sv_berserker', gill: 'lm_goblin', lumi: 'lm_flying_eye', zephyr: 'lm_bat' },
  HEROES: {
    lord: ['lm_king2', 'lm_king'],
    warrior: ['sven_knight', 'lm_hero_knight', 'lm_fantasy_warrior', 'lm_martial_hero', 'lm_warrior2', 'lm_martial_hero2', 'lm_hero_knight2', 'lm_warrior'],
    marksman: ['lm_huntress', 'lm_huntress2'],
    mage: ['lm_evil_wizard', 'lm_evil_wizard2', 'lm_wizard', 'lm_evil_wizard3'],
    healer: ['lm_wizard', 'lm_evil_wizard3'],
  },

  async load() {
    try {
      const r = await fetch('assets/sprites/catalog.json');
      if (!r.ok) return;
      this.cat = await r.json();
    } catch (e) { return; }
    await Promise.all(Object.keys(this.cat).map(id => new Promise(res => {
      const im = new Image();
      im.onload = () => { this.img[id] = im; res(); };
      im.onerror = () => res();
      im.src = 'assets/sprites/' + id + '.png';
    })));
  },
  get ready() { return !!this.cat; },
  has(id) { return !!(this.cat && this.cat[id] && this.img[id]); },

  // The character for a general: by id (monster generals), lords by crown, the rest by class.
  generalFor(gid) {
    const d = DATA.generals[gid];
    if (d.mface) return this.MONSTER_GENERALS[gid] || null;
    const cls = DATA.classOf(gid), t = (DATA.units[d.leads] || {}).type;
    const list = d.lord ? this.HEROES.lord : cls === 'marksman' ? this.HEROES.marksman : cls === 'mage' ? (t === 'healer' ? this.HEROES.healer : this.HEROES.mage) : this.HEROES.warrior;
    let h = 0; for (const ch of gid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return list[h % list.length];
  },

  // Key in Assets.img of character `id` recoloured for faction f (built once).
  sheet(id, f) {
    if (!this.has(id)) return null;
    const key = 'char:' + id + ':' + f;
    if (Assets.img[key]) return key;
    const m = this.cat[id], src = this.img[id];
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    const c = cv.getContext('2d'); c.drawImage(src, 0, 0);
    const d = c.getImageData(0, 0, cv.width, cv.height);
    this.recolour(d.data, f, this.OWN_COLOURS.includes(id));
    if (typeof Palette !== 'undefined') Palette.quantize(d.data);
    c.putImageData(d, 0, 0);
    // the body's centre: the middle of the opaque columns of the first idle frame
    let x0 = m.w, x1 = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (d.data[((m.anims.idle.row * m.h + y) * cv.width + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    Object.assign(cv, { fw: m.w, fh: m.h, feet: m.feet, anims: m.anims, still: !!m.still, charH: m.height, char: true,
      cx: x1 >= x0 ? (x0 + x1 + 1) / 2 : m.w / 2, corpse: { char: true } });
    Assets.img[key] = cv;
    return key;
  },

  // A 64 x 64 portrait: the head and shoulders of the first idle frame, enlarged by a whole
  // number, on a dark backdrop in the faction's colour inside a thin frame.
  portrait(id, f) {
    const key = this.sheet(id, f);
    if (!key) return null;
    const im = Assets.img[key], m = this.cat[id], A = m.anims.idle;
    const fr = document.createElement('canvas'); fr.width = m.w; fr.height = m.h;
    const fx = fr.getContext('2d'); fx.drawImage(im, 0, A.row * m.h, m.w, m.h, 0, 0, m.w, m.h);
    const d = fx.getImageData(0, 0, m.w, m.h).data;
    let x0 = m.w, y0 = m.h, x1 = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (d[(y * m.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); }
    const bodyH = m.feet - y0, cropH = Math.max(14, Math.round(bodyH * 0.55)), k = Math.max(1, Math.min(4, Math.floor(58 / Math.max(cropH, x1 - x0 + 1))));
    const cx = Math.round(im.cx || (x0 + x1) / 2);
    const out = document.createElement('canvas'); out.width = out.height = 64;
    const o = out.getContext('2d');
    const F = DATA.factions[f] || DATA.factions.neutral, g = o.createRadialGradient(32, 26, 4, 32, 32, 46);
    g.addColorStop(0, mixHex(F.color, '#36413e', 0.55)); g.addColorStop(1, '#1b201f');
    o.fillStyle = g; o.fillRect(0, 0, 64, 64);
    o.imageSmoothingEnabled = false;
    o.drawImage(fr, cx - 32 / k, y0 - 3, 64 / k, 64 / k, 0, 0, 64, 64);
    o.strokeStyle = '#151a19'; o.lineWidth = 2; o.strokeRect(1, 1, 62, 62);
    o.strokeStyle = mixHex(F.color, '#8d8d92', 0.6); o.lineWidth = 1; o.strokeRect(2.5, 2.5, 59, 59);
    if (typeof Palette !== 'undefined') Palette.canvas(out);
    return out;
  },

  // Cloth and trim (saturated, not skin) take the faction's hue, muted to the game's sombre
  // tone; skin, steel, leather and the character's own glows keep theirs. `own`: a monster
  // that keeps its colours, only muted a little.
  recolour(p, f, own) {
    const F = DATA.factions[f] || DATA.factions.neutral, [fh, fs] = rgbHsl(...hexToRgb(F.color));
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 40) continue;
      let [h, s, l] = rgbHsl(p[i], p[i + 1], p[i + 2]);
      if (own) s *= 0.8;
      else {
        const skin = h > 0.02 && h < 0.12 && s < 0.65 && l > 0.3 && l < 0.85;
        const bright = l > 0.88 || l < 0.08;
        if (s > 0.22 && !skin && !bright) { h = fh; s = Math.min(s, 0.15 + fs * 0.45); }
        else s *= 0.75;
      }
      const [r, g, b] = hslRgb(h, s, l);
      p[i] = r; p[i + 1] = g; p[i + 2] = b;
    }
  },
};

function hexToRgb(h) { const n = parseInt(h.replace('#', '').slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslRgb(h, s, l) {
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
function mixHex(a, b, k) { const A = hexToRgb(a), B = hexToRgb(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',') + ')'; }
