// =============================================================================
//  PALETTE: one fixed palette for all the game's pixel art, so units, buildings,
//  terrain and portraits look like one world: a sombre, overcast palette (see HEX).
//  Colours are matched in OKLab (how different colours look, not how far apart their
//  numbers are) through a 32 x 32 x 32 lookup table, so even a whole battlefield is
//  snapped to the palette in a moment. Set Palette.on = false to see the raw colours.
// =============================================================================
const Palette = {
  on: true,
  // The sombre palette: built around iron grey 36413E, charcoal 5D5E60, rosy granite 8D8D92,
  // thistle BEB2C8 and dust grey D7D6D6, with muted earth, skin, steel, water and faction tones
  // added (and a little fire), so the world reads as one quiet, overcast place.
  HEX: ['151a19', '1f2524', '2a3230', '36413e', '47504d', '5d5e60', '74757a', '8d8d92', 'a7a6ac', 'beb2c8', 'd7d6d6', 'eeedeb',
    '4a4250', '6a5f75', '8f8299', 'a597b0',                                       // thistle and violet
    '263329', '3e5040', '55684f', '718263', '939c80',                             // muted greens
    '2e2620', '463a30', '5e4e3f', '7a6852', '9a8a72', 'b8aa92',                   // earth and wood
    '6e5048', '8e6c5c', 'b08c76', 'cdb09a',                                       // skin
    '4a2426', '6e3234', '93504a', 'b4746a',                                       // muted reds
    '26304a', '3a4a6a', '58698c', '8496b0',                                       // muted blues
    '5e4a26', '86703c', 'b09a62', 'd0c090',                                       // muted gold
    '23403f', '3c6461', '6a8f88',                                                 // muted teal
    '3c2a44', '5e4470',                                                           // deep purple
    '2b3848', '425a6e', '6a8496',                                                 // water
    '8a3e22', 'c06a32', 'e3a85a', 'f0d7a0'],                                      // fire, kept sparing


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
