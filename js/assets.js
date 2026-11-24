// =============================================================================
//  ASSETS: loads images and sounds, and draws animated sprites.
// =============================================================================
const Assets = {
  img: {},          // key -> HTMLImageElement, e.g. img['c18'], img['face12'], img['tile:rock']
  muted: false,
  music: null,

  load() {
    const list = [];
    for (let i = 1; i <= 25; i++) {
      list.push(['c' + i, `assets/chars/${i}.png`]);
      list.push(['face' + i, `assets/faces/${i}.png`]);
    }
    for (let i = 1; i <= 22; i++) list.push(['m' + i, `assets/monsters/${i}.png`]);
    for (const n of ['arrow', 'fireball', 'shuriken', 'hit', 'slash', 'smoke', 'fire', 'sparkle'])
      list.push(['fx:' + n, `assets/fx/${n}.png`]);
    for (const n of ['house_thatch', 'house_beige', 'house_red', 'hut', 'torii', 'statue', 'tree_round',
      'tree_pine', 'tree_pink', 'rock', 'bush', 'grass_tuft', 'flower', 'ground_grass', 'ground_grass2'])
      list.push(['tile:' + n, `assets/tiles/${n}.png`]);

    try { this.muted = localStorage.getItem('botr_muted') === '1'; } catch (e) {}

    return Promise.all(list.map(([key, src]) => new Promise(resolve => {
      const im = new Image();
      im.onload = () => resolve();
      im.onerror = () => { console.warn('missing', src); resolve(); };
      im.src = src;
      this.img[key] = im;
    }))).then(() => {
      // coloured variants of the fireball and arrow for other kinds of magic
      this.img['fx:icebolt'] = this.img[this.tint('fx:fireball', 190)];
      this.img['fx:hexbolt'] = this.img[this.tint('fx:fireball', 100)];
      this.img['fx:sparkbolt'] = this.img[this.tint('fx:sparkle', 280)];
    });
  },

  // ---------------- Recolouring ----------------
  // Makes a hue-shifted copy of an image (once) and returns its key, e.g. 'c4@110'.
  tint(key, hue) {
    if (!hue) return key;
    const k = key + '@' + hue;
    if (this.img[k]) return k;
    const src = this.img[key];
    if (!src || !src.width) return key;
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    const c = cv.getContext('2d');
    c.drawImage(src, 0, 0);
    const d = c.getImageData(0, 0, cv.width, cv.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const [h, s, l] = rgbToHsl(p[i], p[i + 1], p[i + 2]);
      [p[i], p[i + 1], p[i + 2]] = hslToRgb((h + hue / 360) % 1, s, l);
    }
    c.putImageData(d, 0, 0);
    this.img[k] = cv;
    return k;
  },

  // Sprite sheet key for a unit type or a general (with any recolour applied).
  unitSprite(t) { return this.tint(t.sprite, t.hue); },
  genSprite(gid) {
    const d = DATA.generals[gid];
    return this.tint(d.mface ? 'm' + d.mface : 'c' + d.face, d.hue);
  },

  // Portrait picture (data URL) for a general: their face, or a monster close-up.
  _portraits: {},
  portrait(gid) {
    if (this._portraits[gid]) return this._portraits[gid];
    const d = DATA.generals[gid];
    const cv = document.createElement('canvas');
    cv.width = 38; cv.height = 38;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    if (d.mface) {
      const f = DATA.factions[d.faction];
      c.fillStyle = '#1c2034'; c.fillRect(0, 0, 38, 38);
      c.fillStyle = (f ? f.color : '#888') + '55'; c.fillRect(0, 20, 38, 18);
      const im = this.img[this.tint('m' + d.mface, d.hue)];
      if (im && im.width) c.drawImage(im, 0, 0, 16, 16, 3, 2, 32, 32);
    } else {
      const im = this.img[this.tint('face' + d.face, d.hue)];
      if (im && im.width) c.drawImage(im, 0, 0, 38, 38);
    }
    return (this._portraits[gid] = cv.toDataURL());
  },

  // Draws one frame of a 16x16 unit sheet. dir: 0 down, 1 up, 2 left, 3 right.
  // Character sheets have rows 0-3 = walk, row 4 = attack. Monster sheets have 4 rows.
  drawUnit(ctx, sprite, dir, frame, attacking, x, y, alpha = 1) {
    const im = this.img[sprite];
    if (!im || !im.width) return;
    const rows = Math.floor(im.height / 16);
    let row = frame % Math.min(rows, 4);
    if (attacking && rows >= 5) row = 4;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(im, dir * 16, row * 16, 16, 16, Math.round(x), Math.round(y), 16, 16);
    if (alpha !== 1) ctx.globalAlpha = 1;
  },

  // Draws a horizontal strip effect (32x32 frames), t from 0..1
  drawFx(ctx, name, t, x, y) {
    const im = this.img['fx:' + name];
    if (!im || !im.width) return;
    const n = Math.max(1, Math.floor(im.width / 32));
    const f = Math.min(n - 1, Math.floor(t * n));
    ctx.drawImage(im, f * 32, 0, 32, 32, Math.round(x - 16), Math.round(y - 16), 32, 32);
  },

  // ---------------- Audio ----------------
  _last: {},
  sfx(name, volume = 0.5) {
    if (this.muted) return;
    const now = performance.now();
    if (this._last[name] && now - this._last[name] < 90) return; // avoid noise spam in big battles
    this._last[name] = now;
    try {
      const a = new Audio(`assets/sfx/${name}.ogg`);
      a.volume = volume;
      a.play().catch(() => {});
    } catch (e) {}
  },

  playMusic(name) {
    if (this.musicName === name && this.music) { if (!this.muted) this.music.play().catch(() => {}); return; }
    if (this.music) this.music.pause();
    this.musicName = name;
    try {
      this.music = new Audio(`assets/music/${name}.ogg`);
      this.music.loop = true;
      this.music.volume = 0.35;
      if (!this.muted) this.music.play().catch(() => {});
    } catch (e) { this.music = null; }
  },

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('botr_muted', this.muted ? '1' : '0'); } catch (e) {}
    if (this.music) { if (this.muted) this.music.pause(); else this.music.play().catch(() => {}); }
    return this.muted;
  },
};

// Small seeded random generator so the map looks the same every time.
function makeRng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Colour conversions used for recolouring sprites (all values 0..1 except rgb 0..255).
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h, s, l) {
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
