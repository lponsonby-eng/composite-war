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
    })));
  },

  // Draws one frame of a 16x16 unit sheet. dir: 0 down, 1 up, 2 left, 3 right.
  // Character sheets have rows 0-3 = walk, row 4 = attack. Monster sheets have 4 rows.
  drawUnit(ctx, sprite, dir, frame, attacking, x, y, alpha = 1) {
    const im = this.img[sprite];
    if (!im || !im.complete || !im.width) return;
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
