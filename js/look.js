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

  // ------------------------------------------------------------------ soldiers
  // Men are drawn smaller (unitSize, world px), and from far off (camera zoom below
  // lodZoom) as tiny bold pixel figures: a body in the side's colour, a pale head,
  // walking legs and a silhouette for the troop type, so a block of hundreds reads
  // as a clean pattern. Generals always keep their full sprite.
  unitSize: 15,
  lodZoom: 1.6,
  _figs: {},
  // The figure for a troop type in a side's colour, facing right or left (flip),
  // walking frame 0/1, attacking or not. 13 x 14 pixels, feet on the bottom row.
  figure(type, team, flip, frame, atk) {
    const key = [type, team, flip ? 1 : 0, frame, atk ? 1 : 0, this.on ? 1 : 0].join('|');
    if (this._figs[key]) return this._figs[key];
    const W = 13, H = 14, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const shade = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
    const pal = hex => { if (!this.on) return hex; this.init(); const [r, g, b] = this._rgb[this.nearest(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))]; return `rgb(${r},${g},${b})`; };
    const T = team, TD = shade(team, 0.62), SKIN = '#d8b48c', METAL = '#b4b8c2', WOOD = '#7a5430', LEG = '#3a2c24', WHITE = '#e6e0d2';
    const px = (x, y, w, h, col) => { c.fillStyle = pal(col); c.fillRect(x, y, w, h); };
    const legs = (x) => { if (frame) { px(x - 1, 11, 1, 3, LEG); px(x + 3, 11, 1, 2, LEG); } else { px(x, 11, 1, 3, LEG); px(x + 2, 11, 1, 3, LEG); } };
    switch (type) {
      case 'cavalry': {
        px(1, 8, 9, 3, '#6a4a30'); px(9, 6, 2, 3, '#6a4a30'); px(11, 6, 1, 2, '#5a3c26');           // horse
        px(frame ? 1 : 2, 11, 1, 3, '#4a3220'); px(frame ? 9 : 8, 11, 1, 3, '#4a3220');
        px(4, 4, 4, 4, T); px(4, 4, 1, 4, TD); px(5, 1, 3, 3, METAL);                                // rider
        if (atk) px(7, 5, 6, 1, METAL); else { px(9, 0, 1, 7, WOOD); px(9, 0, 1, 1, METAL); }        // lance
        break;
      }
      case 'shooter':
        px(4, 1, 3, 3, SKIN); px(4, 1, 3, 1, TD); px(3, 4, 5, 5, T); px(3, 4, 1, 5, TD); legs(4);
        px(8, 3, 1, 1, WOOD); px(9, 4, 1, 4, WOOD); px(8, 8, 1, 1, WOOD); px(8, 4, 1, 4, atk ? WHITE : '#c8b898');   // bow
        break;
      case 'mage':
        px(5, 0, 1, 1, TD); px(4, 1, 3, 1, TD); px(3, 2, 5, 1, TD); px(4, 3, 3, 2, SKIN);             // pointed hat
        px(3, 5, 5, 7, T); px(3, 5, 1, 7, TD); px(frame ? 3 : 4, 12, 4, 2, TD);                        // robe
        px(9, 1, 1, 11, WOOD); px(9, 0, 1, 2, atk ? '#fff0a0' : '#e0b040');                              // staff
        break;
      case 'healer':
        px(4, 1, 3, 3, SKIN); px(4, 1, 3, 1, WHITE); px(3, 4, 5, 8, WHITE); px(5, 4, 1, 8, T); px(frame ? 3 : 4, 12, 4, 2, '#b8b0a0');
        px(9, 2, 1, 10, WOOD); px(8, 2, 3, 1, '#f0e080');
        break;
      case 'artillery':
        px(5, 7, 7, 2, '#2a2a30'); px(11, 6, 1, 4, '#2a2a30'); px(5, 9, 3, 3, WOOD); px(6, 10, 1, 1, '#3a2a1a');   // cannon
        px(1, 2, 3, 3, SKIN); px(1, 5, 3, 5, T); px(1, 5, 1, 5, TD); px(frame ? 1 : 2, 10, 1, 3, LEG);             // crew
        if (atk) px(12, 5, 1, 2, '#ffd060');
        break;
      case 'beast':
        px(2, 4, 9, 7, TD); px(3, 5, 7, 5, shade(team, 0.8)); px(9, 5, 1, 1, '#ffe080'); px(6, 3, 3, 1, TD);
        px(frame ? 2 : 3, 11, 2, 3, '#2a2028'); px(frame ? 8 : 7, 11, 2, 3, '#2a2028');
        break;
      default:                                                                                         // infantry: shield and spear
        px(4, 1, 3, 3, METAL); px(6, 2, 1, 1, SKIN); px(3, 4, 5, 5, T); px(3, 4, 1, 5, TD); legs(4);
        px(2, 5, 2, 4, TD);
        if (atk) { px(7, 6, 6, 1, WOOD); px(12, 6, 1, 1, METAL); } else { px(9, 0, 1, 12, WOOD); px(9, 0, 1, 1, METAL); }
    }
    // a dark outline around the whole figure, then mirror it for left-facing men
    const img = c.getImageData(0, 0, W, H), d = img.data, a = i => d[i * 4 + 3] > 0;
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (a(i)) continue;
      if ((x > 0 && a(i - 1)) || (x < W - 1 && a(i + 1)) || (y > 0 && a(i - W)) || (y < H - 1 && a(i + W))) out.push(i);
    }
    for (const i of out) { d[i * 4] = 20; d[i * 4 + 1] = 16; d[i * 4 + 2] = 26; d[i * 4 + 3] = 235; }
    c.putImageData(img, 0, 0);
    let res = cv;
    if (flip) { res = document.createElement('canvas'); res.width = W; res.height = H; const r = res.getContext('2d'); r.scale(-1, 1); r.drawImage(cv, -W, 0); }
    return (this._figs[key] = res);
  },

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('cw-look', this.on ? '1' : '0'); } catch (e) {}
    return this.on;
  },
};
Look.init();
