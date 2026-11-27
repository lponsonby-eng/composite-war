// =============================================================================
//  PALETTE: one fixed palette for all the game's pixel art, so units, buildings,
//  terrain and portraits look like one world. The palette is Resurrect 64 by
//  Kerrie Lake (free to use; lospec.com/palette-list/resurrect-64).
//  Colours are matched in OKLab (how different colours look, not how far apart their
//  numbers are) through a 32 x 32 x 32 lookup table, so even a whole battlefield is
//  snapped to the palette in a moment. Set Palette.on = false to see the raw colours.
// =============================================================================
const Palette = {
  on: true,
  HEX: ['2e222f', '3e3546', '625565', '966c6c', 'ab947a', '694f62', '7f708a', '9babb2', 'c7dcd0', 'ffffff',
    '6e2727', 'b33831', 'ea4f36', 'f57d4a', 'ae2334', 'e83b3b', 'fb6b1d', 'f79617', 'f9c22b',
    '7a3045', '9e4539', 'cd683d', 'e6904e', 'fbb954', '4c3e24', '676633', 'a2a947', 'd5e04b', 'fbff86',
    '165a4c', '239063', '1ebc73', '91db69', 'cddf6c', '313638', '374e4a', '547e64', '92a984', 'b2ba90',
    '0b5e65', '0b8a8f', '0eaf9b', '30e1b9', '8ff8e2', '323353', '484a77', '4d65b4', '4d9be6', '8fd3ff',
    '45293f', '6b3e75', '905ea9', 'a884f3', 'eaaded', '753c54', 'a24b6f', 'cf657f', 'ed8099',
    '831c5d', 'c32454', 'f04f78', 'f68181', 'fca790', 'fdcbb0'],

  // sRGB (0-255) to OKLab
  lab(r, g, b) {
    const f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    r = f(r); g = f(g); b = f(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  },
  // The lookup table: for each 5-bit-per-channel colour, the packed RGB of the nearest palette colour.
  table() {
    if (this._lut) return this._lut;
    const P = this.HEX.map(h => { const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; });
    const L = P.map(c => this.lab(...c));
    const lut = new Uint32Array(32768);
    for (let i = 0; i < 32768; i++) {
      const r = (i >> 10) * 8.226, g = (i >> 5 & 31) * 8.226, b = (i & 31) * 8.226;
      const [l, a, bb] = this.lab(r, g, b);
      let best = 0, bd = 1e9;
      for (let k = 0; k < L.length; k++) {
        const dl = (l - L[k][0]) * 1.2, da = a - L[k][1], db = bb - L[k][2], d = dl * dl + da * da + db * db;   // lightness counts a little more
        if (d < bd) { bd = d; best = k; }
      }
      lut[i] = (P[best][0] << 16) | (P[best][1] << 8) | P[best][2];
    }
    return (this._lut = lut);
  },
  // Snap RGBA pixel data to the palette in place. Pixels under alphaCut become fully
  // transparent, the rest fully opaque (pixel art has no half-see-through edges).
  quantize(d, alphaCut = 110) {
    if (!this.on) return d;
    const lut = this.table();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < alphaCut) { d[i + 3] = 0; continue; }
      const c = lut[(d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3];
      d[i] = c >> 16; d[i + 1] = c >> 8 & 255; d[i + 2] = c & 255; d[i + 3] = 255;
    }
    return d;
  },
  // Snap a whole canvas to the palette (in place), and return it.
  canvas(cv, alphaCut) {
    if (!this.on || !cv.width) return cv;
    const c = cv.getContext('2d'), img = c.getImageData(0, 0, cv.width, cv.height);
    this.quantize(img.data, alphaCut);
    c.putImageData(img, 0, 0);
    return cv;
  },
};
