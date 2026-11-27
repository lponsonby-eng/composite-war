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

  // Sprite sheet key for a unit type or a general: the generated medieval sheet where
  // there is one (see js/gensprites.js), otherwise the old sprite with any recolour applied.
  unitSprite(t) {
    const id = t.id || (t.id = Object.keys(DATA.units).find(k => DATA.units[k] === t));
    return (typeof Gen !== 'undefined' && Gen.unit(id)) || this.tint(t.sprite, t.hue);
  },
  genSprite(gid) {
    const d = DATA.generals[gid];
    return (typeof Gen !== 'undefined' && Gen.hero(gid)) || this.tint(d.mface ? 'm' + d.mface : 'c' + d.face, d.hue);
  },

  // Small picture (data URL) of a unit type, for the recruit window.
  _icons: {},
  unitIcon(id) {
    if (this._icons[id]) return this._icons[id];
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    const im = this.img[this.unitSprite(DATA.units[id])];
    if (im && im.fw) {                                      // generated sheet: the first frame, fitted to the icon
      const fw = im.fw, fh = im.fh, k = Math.min(32 / fw, 32 / (fh - (im.pad || 0)));
      c.drawImage(im, 0, 0, fw, fh, 16 - fw * k / 2, 32 - fh * k + (im.pad || 0) * k, fw * k, fh * k);
      return (this._icons[id] = cv.toDataURL());
    }
    if (im && im.width) c.drawImage(im, 0, 0, 16, 16, 0, 0, 32, 32);
    return (this._icons[id] = HD.url(cv));
  },

  // Portrait picture (data URL) for a general: their face, or a monster close-up.
  // mood: 'neutral', 'fierce' or 'smile' (generated hero portraits have all three).
  _portraits: {},
  portrait(gid, mood = 'neutral') {
    const pk = gid + ':' + mood;
    if (this._portraits[pk]) return this._portraits[pk];
    const gp = typeof Gen !== 'undefined' && Gen.portrait(gid, mood);
    if (gp) return (this._portraits[pk] = gp.toDataURL());
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
    return (this._portraits[gid] = HD.url(cv));
  },

  // Draws one frame of a unit sheet. dir: 0 down, 1 up, 2 left, 3 right.
  // Character sheets have rows 0-3 = walk, row 4 = attack. Monster sheets have 4 rows.
  // size: drawn size in world pixels (battles draw units larger than the map does).
  // Old sheets have 16 x 16 frames filling the size x size box. Generated sheets
  // (im.fw x im.fh frames, 32 px figures) are drawn at size/32 per pixel, centred on
  // the box and standing on its bottom edge, so both kinds of figure match in height.
  drawUnit(ctx, sprite, dir, frame, attacking, x, y, alpha = 1, size = 16, st = null) {
    const im = this.img[sprite];
    if (!im || !im.width) return;
    if (im.anims) return this.drawChar(ctx, im, dir, frame, attacking, x, y, alpha, size, st || {});
    const fw = im.fw || 16, fh = im.fh || 16;
    const rows = im.rows || Math.floor(im.height / fh);
    let row = frame % Math.min(rows, 4);
    if (attacking && rows >= 5) row = 4;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    if (fw === 16 && fh === 16) HD.draw(ctx, im, dir * 16, row * 16, 16, 16, Math.round(x), Math.round(y), size, size);
    else {
      const k = size / 32 * (im.scale || 1), w = fw * k, h = fh * k;
      this.crisp(ctx, im, dir * fw, row * fh, fw, fh, x + size / 2 - w / 2, y + size - h + (im.pad || 0) * k, w, h);
    }
    if (alpha !== 1) ctx.globalAlpha = 1;
  },
  // An animated character sheet (see Chars): idle, run, attack, hurt, death rows, facing
  // right (a mirrored copy faces left). Stands with its feet on the bottom of the size box,
  // centred on its body, size / 32 world pixels per art pixel. st: { t (animation clock),
  // moving, atkK / hurtK (0..1 through the attack / hit), hurt, left }.
  drawChar(ctx, im, dir, frame, attacking, x, y, alpha, size, st) {
    const a = st.dead ? (im.anims.death ? 'death' : 'idle') : st.hurt && im.anims.hurt ? 'hurt' : attacking ? 'attack' : (st.moving || frame) ? 'run' : 'idle';
    const A = im.anims[a] || im.anims.idle;
    let f = st.dead ? A.n - 1 : a === 'attack' ? Math.floor(clampK(st.atkK == null ? 0.5 : st.atkK) * A.n) : a === 'hurt' ? Math.floor(clampK(st.hurtK || 0) * A.n)
      : Math.floor((st.t || 0) * (a === 'run' ? 11 : 7)) % A.n;
    f = Math.min(A.n - 1, f);
    const left = st.left != null ? st.left : dir === 2;
    const src = left ? this.mirrorOf(im) : im, cols = Math.round(im.width / im.fw);
    const col = left ? cols - 1 - f : f, k = size / 32, w = im.fw * k, h = im.fh * k;
    const cx = left ? im.fw - (im.cx || im.fw / 2) : (im.cx || im.fw / 2);
    let bob = 0;
    if (im.still && (st.moving || frame)) bob = Math.abs(Math.sin((st.t || 0) * 9)) * -2;   // a still picture hops as it moves
    if (alpha !== 1) ctx.globalAlpha = alpha;
    this.crisp(ctx, src, col * im.fw, A.row * im.fh, im.fw, im.fh, x + size / 2 - cx * k, y + size - (im.feet + 1) * k + bob, w, h);
    if (alpha !== 1) ctx.globalAlpha = 1;
  },
  mirrorOf(im) {
    if (im.mirror) return im.mirror;
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.translate(im.width, 0); x.scale(-1, 1); x.drawImage(im, 0, 0);
    return (im.mirror = c);
  },
  // Generated art is drawn with hard pixel edges (no smoothing).
  crisp(ctx, im, sx, sy, sw, sh, dx, dy, dw, dh) {
    const m = ctx.getTransform();
    if (!m.b && !m.c && m.a > 0) {                       // land on whole pixels of the target (battles draw at 1 art pixel each)
      dx = (Math.round(dx * m.a + m.e) - m.e) / m.a; dy = (Math.round(dy * m.d + m.f) - m.f) / m.d;
      dw = Math.round(dw * m.a) / m.a; dh = Math.round(dh * m.d) / m.d;
    }
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.imageSmoothingEnabled = prev;
  },
  // A fallen soldier's body (generated sheets only), lying where they fell. size as in drawUnit.
  drawCorpse(ctx, sprite, x, y, size, flip, alpha = 1) {
    const im = this.img[sprite], c = im && im.corpse;
    if (!c) return false;
    if (im.anims) {                                        // an animated character: the last frame of its death
      this.drawChar(ctx, im, flip ? 2 : 3, 0, false, x - size / 2, y - size + 2, alpha, size, { dead: true });
      return true;
    }
    const k = size / 32 * (im.scale || 1);
    if (alpha !== 1) ctx.globalAlpha = alpha;
    const part = (q, ox) => {
      const sx = flip && q.alt ? q.alt.x : q.x, sy = flip && q.alt ? q.alt.y : q.y;
      this.crisp(ctx, im, sx, sy, q.w, q.h, x - q.w * k / 2 + ox * k, y - q.h * k * 0.7, q.w * k, q.h * k);
    };
    part(c, 0);
    if (c.rider) part(c.rider, flip ? -24 : 24);
    if (alpha !== 1) ctx.globalAlpha = 1;
    return true;
  },

  // A copy of a unit sheet with a 1-pixel outline in `col` around each figure (once),
  // so a side's soldiers read at a glance. Returns its key.
  outlined(sprite, col) {
    const k = sprite + '|o' + col;
    if (this.img[k]) return k;
    const src = this.img[sprite];
    if (!src || !src.width) return sprite;
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    const c = cv.getContext('2d'); c.drawImage(src, 0, 0);
    const W = cv.width, H = cv.height, d = c.getImageData(0, 0, W, H), p = d.data, a = new Uint8Array(W * H);
    const fw = src.fw || 16, fh = src.fh || 16;
    Object.assign(cv, { fw: src.fw, fh: src.fh, pad: src.pad, rows: src.rows, corpse: src.corpse, scale: src.scale,
      anims: src.anims, feet: src.feet, cx: src.cx, still: src.still, char: src.char });
    for (let i = 0; i < W * H; i++) a[i] = p[i * 4 + 3] > 128 ? 1 : 0;
    let r = parseInt(col.slice(1, 3), 16), g = parseInt(col.slice(3, 5), 16), b = parseInt(col.slice(5, 7), 16);
    if (typeof Palette !== 'undefined' && Palette.on) { const q = Palette.table()[(r >> 3) << 10 | (g >> 3) << 5 | b >> 3]; r = q >> 16; g = q >> 8 & 255; b = q & 255; }   // the side's colour, from the palette
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (a[y * W + x]) continue;
      const same = (nx, ny) => nx >= 0 && ny >= 0 && nx < W && ny < H && Math.floor(nx / fw) === Math.floor(x / fw) && Math.floor(ny / fh) === Math.floor(y / fh) && a[ny * W + nx];
      if (same(x - 1, y) || same(x + 1, y) || same(x, y - 1) || same(x, y + 1)) {
        const i = (y * W + x) * 4; p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = 255;
      }
    }
    c.putImageData(d, 0, 0);
    this.img[k] = cv;
    return k;
  },

  // Draws a horizontal strip effect (32x32 frames), t from 0..1
  drawFx(ctx, name, t, x, y) {
    const im = this.img['fx:' + name];
    if (!im || !im.width) return;
    const n = Math.max(1, Math.floor(im.width / 32));
    const f = Math.min(n - 1, Math.floor(t * n));
    HD.draw(ctx, im, f * 32, 0, 32, 32, Math.round(x - 16), Math.round(y - 16), 32, 32);
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
function clampK(v) { return Math.max(0, Math.min(0.999, v)); }
