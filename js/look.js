// =============================================================================
//  LOOK: the battle's art direction, applied on top of the drawing code.
//    - one shared palette: the battlefield ground (dithered) and every troop
//      sprite are snapped to it once, so everything reads as one painting;
//      team-colour outlines are added after, untouched, so sides stay clear
//    - one light, from the top left: trees, rocks and houses cast shadows down
//      and to the right, men stand on dark offset shadows, and slow cloud
//      shadows drift across the field
//    - a colour pass over each frame: a little desaturation, a warm or cool
//      grade for the region, and a vignette (the HUD is drawn after, crisp)
//  Press L in battle (or the Look button) to compare with it off. Tune it here.
// =============================================================================
const Look = {
  on: true,

  // Muted, earthy palette (our own): neutrals, earth, foliage, water, warm reds,
  // gold, a few faction tones so troops stay recognisable.
  palette: [
    '#141018', '#251f2b', '#3a3140', '#4f4552', '#6b5f68', '#8c8088', '#b0a6a4', '#d6cfc4', '#f0eadc',
    '#2e2218', '#3c2c1e', '#4a3624', '#5a422b', '#6a4e32', '#7b5c3b', '#8c6a44', '#9e7b50', '#b08c5c', '#c1a06e', '#d2b480', '#ecd8a8',
    '#1e2a1a', '#26341e', '#2e3f22', '#384a27', '#41552c', '#4c6131', '#586e36', '#657c3d', '#728a44', '#82994f', '#92a85a', '#a3b66a', '#b4c47a',
    '#1c2a3e', '#2c4560', '#3a5fa8', '#5a86b8', '#8cc0e0', '#c8e4f0',
    '#8e9aa8', '#a6b4c4', '#c4d0dc', '#dce6ee', '#eef3f6',            // cool greys and snow
    '#4a1c1c', '#7a2a24', '#a8382c', '#c8682c', '#e09a4a',
    '#8a6420', '#c89a38', '#ecc860',
    '#3a2848', '#6a4a8a', '#a080b8',
    '#2a5a58', '#3a8a88',
  ],
  dither: 4,                       // ordered-dither strength on the ground (0: flat bands; high: stippled)
  shadow: { color: 'rgba(16,12,24,0.38)', dx: 4, dy: 3 },   // cast shadows, in world pixels
  unitShadow: 'rgba(16,12,24,0.42)',
  clouds: { alpha: 0.13, scale: 9, speed: [9, 4] },         // drifting cloud shadows (world px per second)
  grade: { desat: 0.22, tint: 0.32, vignette: 0.55 },
  // the warm / cool cast of each region's light
  tints: { free: '#ffd9a0', aster: '#ffd9a0', frost: '#a9c8ff', darkwood: '#b0d09a', ember: '#ff9a6a',
    shadow: '#b0a0d0', bog: '#cfd59a', azure: '#a8e4e0', sun: '#ffc878' },

  // ------------------------------------------------------------------ palette
  _rgb: null, _lut: null,
  init() {
    if (this._rgb) return;
    this._rgb = this.palette.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    this._lut = new Int16Array(32768).fill(-1);
    try { const v = localStorage.getItem('cw-look'); if (v != null) this.on = v === '1'; } catch (e) {}
  },
  // Index of the palette colour nearest to (r, g, b), by a perceptual ("redmean") distance; cached.
  nearest(r, g, b) {
    const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    let i = this._lut[key];
    if (i >= 0) return i;
    let best = 0, bd = 1e12;
    this._rgb.forEach(([pr, pg, pb], k) => {
      const rm = (r + pr) / 2, dr = r - pr, dg = g - pg, db = b - pb;
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bd) { bd = d; best = k; }
    });
    return (this._lut[key] = best);
  },
  // Snap a canvas (or a region of it) to the palette, with optional 4x4 ordered dithering.
  quantize(cv, dither = 0, x0 = 0, y0 = 0, w = cv.width, h = cv.height) {
    this.init();
    const c = cv.getContext('2d'), img = c.getImageData(x0, y0, w, h), p = img.data, P = this._rgb;
    const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (p[i + 3] < 128) continue;
      const o = dither ? (B[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * dither * 2 : 0;
      const k = P[this.nearest(clamp(p[i] + o, 0, 255) | 0, clamp(p[i + 1] + o, 0, 255) | 0, clamp(p[i + 2] + o, 0, 255) | 0)];
      p[i] = k[0]; p[i + 1] = k[1]; p[i + 2] = k[2];
    }
    c.putImageData(img, x0, y0);
  },

  // ------------------------------------------------------------------ light
  // While drawing scenery: everything drawn casts a shadow down and to the right.
  // `scale`: device pixels per world pixel of ctx (shadow offsets ignore transforms).
  castShadows(ctx, scale) {
    if (!this.on) return;
    ctx.shadowColor = this.shadow.color; ctx.shadowBlur = 0;
    ctx.shadowOffsetX = this.shadow.dx * scale; ctx.shadowOffsetY = this.shadow.dy * scale;
  },
  noShadows(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowOffsetX = ctx.shadowOffsetY = 0; },

  // A soft, tiling cloud-shadow texture (made once).
  _cloud: null,
  cloudTile() {
    if (this._cloud) return this._cloud;
    const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const c = cv.getContext('2d'), img = c.createImageData(N, N), n = makeNoise(4242);
    const tile = (x, y, f) => {                                   // seamless: blend with the copies one tile back, so x = N matches x = 0
      const u = x / N, v = y / N;
      return n(x / f, y / f) * (1 - u) * (1 - v) + n((x - N) / f, y / f) * u * (1 - v) + n(x / f, (y - N) / f) * (1 - u) * v + n((x - N) / f, (y - N) / f) * u * v;
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = tile(x, y, 28) * 0.7 + tile(x, y, 11) * 0.3, a = clamp((v - 0.48) / 0.18, 0, 1), i = (y * N + x) * 4;
      img.data[i] = 22; img.data[i + 1] = 26; img.data[i + 2] = 44; img.data[i + 3] = Math.round(a * a * (3 - 2 * a) * 255);
    }
    c.putImageData(img, 0, 0);
    return (this._cloud = cv);
  },
  // Cloud shadows over the visible world rectangle (call in world space).
  drawClouds(ctx, x0, y0, x1, y1, t) {
    if (!this.on || !this.clouds.alpha) return;
    const C = this.clouds, im = this.cloudTile(), S = im.width * C.scale;
    const ox = ((t * C.speed[0]) % S + S) % S, oy = ((t * C.speed[1]) % S + S) % S;
    const prev = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = C.alpha;
    for (let y = Math.floor((y0 - oy) / S) * S + oy; y < y1; y += S)
      for (let x = Math.floor((x0 - ox) / S) * S + ox; x < x1; x += S) ctx.drawImage(im, x, y, S, S);
    ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = prev;
  },

  // ------------------------------------------------------------------ colour pass
  // Over the whole frame (screen space): desaturate a little, grade toward the
  // region's light, darken the edges.
  grade(ctx, w, h, region) {
    if (!this.on) return;
    const G = this.grade;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (G.desat) { ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = `rgba(128,128,128,${G.desat})`; ctx.fillRect(0, 0, w, h); }
    if (G.tint) { ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = G.tint; ctx.fillStyle = this.tints[region] || this.tints.free; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    if (G.vignette) {
      const r = Math.hypot(w, h) / 2, v = ctx.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(14,10,22,${G.vignette})`);
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  },

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('cw-look', this.on ? '1' : '0'); } catch (e) {}
    return this.on;
  },
};
Look.init();
