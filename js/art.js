// =============================================================================
//  ART: pixel-art buildings, landmarks and scenery for each region, drawn in
//  code so every region gets its own look without extra image files.
//  Every picture is drawn once into a small canvas and reused.
//    Art.building(style, size)  size 0 village, 1 town, 2 capital
//    Art.landmark(type)         the big feature of a region
//    Art.deco(name)             trees, rocks, cacti, crystals...
// =============================================================================
const Art = {
  cache: {},

  make(key, w, h, draw) {
    if (this.cache[key]) return this.cache[key];
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    draw(c, w, h);
    cv.box = bbox(c, w, h);
    return (this.cache[key] = cv);
  },

  // ------------------------------------------------------------------ buildings
  // Canvas is 48 x 40; the building stands on (24, 38).
  // With the Pixelgen building generator loaded (tools/pixelgen/buildings.js), buildings are its
  // 96 x 80 pictures: twice this size, so drawing them at 48 x 40 gives double detail.
  building(style, size) {
    if (typeof PixelGen !== 'undefined' && PixelGen.GENERATORS.building) {
      const key = `gb:${style}:${size}`;
      if (this.cache[key]) return this.cache[key];
      const g = PixelGen.generate('building', { seed: 1, style, size: String(size) }).img;
      const cv = document.createElement('canvas'); cv.width = g.w; cv.height = g.h;
      const c = cv.getContext('2d'); c.putImageData(new ImageData(g.toRGBA(), g.w, g.h), 0, 0);
      const b = bbox(c, g.w, g.h);                                     // measured in the old 48 x 40 picture's units
      cv.box = { x0: b.x0 / 2, y0: b.y0 / 2, x1: b.x1 / 2, y1: b.y1 / 2, tx: b.tx / 2, ty: b.ty / 2 };
      cv.gen = true;
      return (this.cache[key] = cv);
    }
    return this.make(`b:${style}:${size}`, 48, 40, c => {
      const fn = BUILDINGS[style] || BUILDINGS.village;
      fn(c, size, 24, 38);
    });
  },

  // ------------------------------------------------------------------ landmarks
  // Canvas is 80 x 72; the landmark stands on (40, 70).
  landmark(type) {
    return this.make('l:' + type, 80, 72, c => (LANDMARKS[type] || LANDMARKS.shrine)(c, 40, 70));
  },

  // ------------------------------------------------------------------ scenery
  // Canvas is 16 x 20; the item stands on (8, 19).
  deco(name) {
    if (Assets.img['tile:' + name]) return Assets.img['tile:' + name];
    return this.make('d:' + name, 16, 20, c => (DECO[name] || DECO.bush)(c, 8, 19));
  },
};

// ------------------------------------------------------------------ drawing helpers
function R(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
// Filled triangle (roof / mountain): apex at (cx, top), base width w at top + h.
function tri(c, cx, top, w, h, col, shade) {
  for (let i = 0; i < h; i++) {
    const half = Math.max(0.5, (w / 2) * (i + 1) / h);
    R(c, cx - half, top + i, half * 2, 1, col);
    if (shade) R(c, cx, top + i, half, 1, shade);
  }
}
// Filled half-ellipse dome sitting on y = base.
function dome(c, cx, base, rx, ry, col, shade, edge) {
  for (let y = 0; y < ry; y++) {
    const t = 1 - (y + 0.5) / ry, half = rx * Math.sqrt(1 - t * t);
    const yy = base - ry + y;
    if (edge) R(c, cx - half - 1, yy, half * 2 + 2, 1, edge);
    R(c, cx - half, yy, half * 2, 1, col);
    if (shade) R(c, cx + half * 0.35, yy, half * 0.65, 1, shade);
  }
  if (edge) R(c, cx - rx * 0.6, base - ry - 1, rx * 1.2, 1, edge);
}
function box(c, x, y, w, h, col, shade, edge = '#1a1020') {
  R(c, x - 1, y - 1, w + 2, h + 2, edge);
  R(c, x, y, w, h, col);
  if (shade) R(c, x + w - Math.max(1, Math.round(w / 4)), y, Math.max(1, Math.round(w / 4)), h, shade);
}
function circ(c, cx, cy, r, col) {
  for (let y = -r; y <= r; y++) { const h = Math.sqrt(r * r - y * y); R(c, cx - h, cy + y, h * 2, 1, col); }
}
function bbox(c, w, h) {
  const d = c.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 0) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  // highest point near the middle (where a flag pole goes)
  let tx = Math.round(w / 2), ty = y0;
  outer: for (let y = 0; y < h; y++) for (let x = Math.round(w / 2) - 6; x <= Math.round(w / 2) + 6; x++)
    if (d[(y * w + x) * 4 + 3] > 0) { tx = x; ty = y; break outer; }
  return { x0, y0, x1, y1, tx, ty };
}

// Uses an existing tile, scaled.
function tile(c, name, cx, base, sc = 1) {
  const im = Assets.img['tile:' + name];
  if (!im || !im.width) return;
  const w = Math.round(im.width * sc), h = Math.round(im.height * sc);
  c.drawImage(im, Math.round(cx - w / 2), base - h + 2, w, h);
}

// ------------------------------------------------------------------ buildings
const BUILDINGS = {
  // classic plains houses, with a stone castle as capital
  castle(c, s, cx, b) {
    if (s < 2) return tile(c, s ? 'house_beige' : 'hut', cx, b, 0.75);
    castleArt(c, cx, b, '#9a9aaa', '#7a7a8c', '#3d6bd0', '#2a4ea0');
  },
  village(c, s, cx, b) {
    if (s === 3) return tile(c, 'torii', cx, b, 0.85);      // shrine
    if (s < 2) return tile(c, s ? 'house_thatch' : 'hut', cx, b, 0.75);
    castleArt(c, cx, b, '#a8a090', '#887f70', '#c0503a', '#963a28');
  },

  igloo(c, s, cx, b) {
    const r = [7, 9, 11][s];
    if (s === 2) {                                       // ice towers beside the great igloo
      for (const dx of [-16, 16]) { box(c, cx + dx - 3, b - 20, 6, 20, '#d6f0ff', '#a8d4f0', '#3a5a7a'); tri(c, cx + dx, b - 28, 8, 8, '#bff0ff', '#7fc8f0'); }
    }
    dome(c, cx, b, r + 2, r + 1, '#f4f9fd', '#c9dcec', '#3a5a7a');
    for (let y = b - r + 2; y < b; y += 3) R(c, cx - r, y, r * 2, 1, '#dbe7f2');
    R(c, cx - 3, b - 5, 6, 5, '#3a5a7a'); R(c, cx - 2, b - 4, 4, 4, '#1c2a3a');   // door tunnel
    R(c, cx - r, b, r * 2 + 2, 1, '#9fb8d0');
  },

  treehut(c, s, cx, b) {
    const hw = [10, 12, 14][s];
    if (s === 2) { circ(c, cx - 12, b - 22, 9, '#173826'); circ(c, cx + 12, b - 24, 9, '#1c4430'); circ(c, cx, b - 30, 10, '#1f4a33'); }
    box(c, cx - 2, b - 16, 4, 16, '#4a3424', '#382618');                 // trunk
    R(c, cx - 5, b - 1, 10, 1, '#382618');
    box(c, cx - hw / 2 - 2, b - 17, hw + 4, 2, '#6b4a2a');               // platform
    box(c, cx - hw / 2, b - 24, hw, 7, '#5a3e26', '#46301c');            // hut
    tri(c, cx, b - 32 - s, hw + 6, 9 + s, '#2f7a5a', '#235e44');          // roof
    R(c, cx - 2, b - 22, 3, 3, '#ffd86a');                               // lit window
    if (s) R(c, cx + 3, b - 22, 2, 2, '#ffd86a');
  },

  forge(c, s, cx, b) {
    const w = [14, 18, 26][s], h = [8, 10, 14][s];
    box(c, cx + w / 2 - 5, b - h - 10, 4, 10, '#3a3230');                 // chimney
    R(c, cx + w / 2 - 5, b - h - 11, 4, 1, '#ff8a3a');
    box(c, cx - w / 2, b - h, w, h, '#4a403c', '#3a3230');
    tri(c, cx - 2, b - h - 7 - s * 2, w + 4, 7 + s * 2, '#a8382a', '#86281e');
    R(c, cx - 3, b - 6, 6, 6, '#ffb040'); R(c, cx - 2, b - 5, 4, 5, '#ff6a2a');   // furnace
    if (s === 2) {
      for (const dx of [-17, 17]) { box(c, cx + dx - 3, b - 22, 6, 22, '#3e3634', '#2e2826'); R(c, cx + dx - 4, b - 24, 8, 2, '#2e2826'); R(c, cx + dx - 1, b - 16, 2, 3, '#ff8a3a'); }
    }
  },

  tower(c, s, cx, b) {
    const towers = [[0, 16]], extra = s === 2 ? [[-12, 20], [12, 20], [0, 28]] : s === 1 ? [[0, 20], [9, 0]] : [[0, 16]];
    for (const [dx, h] of (s ? extra : towers)) {
      if (!h) { box(c, cx + dx - 5, b - 7, 10, 7, '#6a6a80', '#56566c'); tri(c, cx + dx, b - 13, 12, 6, '#4a3a6a'); continue; }
      box(c, cx + dx - 4, b - h, 8, h, '#6e6e86', '#58586e');
      tri(c, cx + dx, b - h - 9, 10, 9, '#4a3a6a', '#3a2c56');
      R(c, cx + dx - 1, b - h + 4, 2, 3, '#c8a8ff');
    }
  },

  stilthut(c, s, cx, b) {
    const w = [14, 18, 22][s];
    R(c, cx - w / 2 - 3, b - 2, w + 6, 2, '#4a6a4a');                    // pool under the hut
    for (const dx of [-w / 2 + 2, 0, w / 2 - 3]) R(c, cx + dx, b - 8, 1, 8, '#3a2e1a');
    box(c, cx - w / 2, b - 15, w, 7, '#8a6a3a', '#6e5430');
    tri(c, cx, b - 24, w + 6, 9, '#b89a4a', '#9a7e3a');
    R(c, cx - 1, b - 13, 3, 5, '#2a2010');
    if (s === 2) { box(c, cx + w / 2 + 3, b - 18, 2, 18, '#5a3a20'); circ(c, cx + w / 2 + 4, b - 20, 2, '#e8e0d0'); R(c, cx + w / 2 + 3, b - 21, 1, 1, '#1a1020'); }
  },

  spire(c, s, cx, b) {
    const h = [14, 18, 28][s];
    dome(c, cx, b, 9 + s * 2, 4, '#eef4f4', '#c8d8d8', '#5a6a7a');
    crystalArt(c, cx, b - 3, h, 4 + s);
    crystalArt(c, cx - 6 - s, b - 2, h * 0.55, 3, true);
    crystalArt(c, cx + 6 + s, b - 2, h * 0.6, 3, true);
  },

  adobe(c, s, cx, b) {
    const w = [12, 16, 22][s], h = [8, 10, 12][s];
    if (s === 2) {
      for (const dx of [-15, 15]) { box(c, cx + dx - 2, b - 24, 4, 24, '#e0b070', '#c0904e'); dome(c, cx + dx, b - 24, 3, 3, '#f0d060', '#c8a83a'); }
      dome(c, cx, b - h, 8, 8, '#f0d060', '#c8a83a', '#5a3a20');
    }
    box(c, cx - w / 2, b - h, w, h, '#d8a868', '#b8884a', '#5a3a20');
    R(c, cx - w / 2 - 1, b - h - 1, w + 2, 2, '#e8c088');
    R(c, cx - 2, b - 6, 4, 6, '#5a3a20');
    R(c, cx - w / 2 + 2, b - h + 2, 2, 2, '#5a3a20'); R(c, cx + w / 2 - 4, b - h + 2, 2, 2, '#5a3a20');
    if (s === 1) { box(c, cx + w / 2 - 1, b - h - 4, 6, 4 + h, '#d0a060', '#b0844a', '#5a3a20'); }
  },
};

function castleArt(c, cx, b, wall, shade, roof, roofShade) {
  box(c, cx - 14, b - 12, 28, 12, wall, shade);
  for (let x = cx - 14; x < cx + 14; x += 4) R(c, x, b - 14, 2, 2, wall);
  for (const dx of [-14, 14]) { box(c, cx + dx - 4, b - 20, 8, 20, wall, shade); tri(c, cx + dx, b - 29, 10, 9, roof, roofShade); }
  box(c, cx - 5, b - 26, 10, 14, wall, shade);
  tri(c, cx, b - 36, 12, 10, roof, roofShade);
  R(c, cx - 3, b - 7, 6, 7, '#2a2230'); R(c, cx - 1, b - 22, 2, 3, '#ffd86a');
}

function crystalArt(c, cx, base, h, w, small) {
  const cols = small ? ['#7ae8f0', '#48b8d0', '#dffcff'] : ['#ff8ad0', '#c85aa8', '#ffe0f4'];
  R(c, cx - w / 2 - 1, base - h + 2, w + 2, h - 2, '#4a2a4a');
  tri(c, cx, base - h - 1, w + 2, Math.max(3, w), '#4a2a4a');
  R(c, cx - w / 2, base - h + 3, w, h - 3, cols[0]);
  R(c, cx, base - h + 3, w / 2, h - 3, cols[1]);
  tri(c, cx, base - h, w, Math.max(3, w - 1), cols[0], cols[1]);
  R(c, cx - w / 2 + 1, base - h + 4, 1, h * 0.5, cols[2]);
}

// ------------------------------------------------------------------ landmarks
const LANDMARKS = {
  volcano(c, cx, b) {
    tri(c, cx, b - 52, 76, 52, '#5a4a44', '#3e3430');
    R(c, cx - 9, b - 52, 18, 4, '#2a201e');
    R(c, cx - 7, b - 51, 14, 2, '#ff6a2a'); R(c, cx - 4, b - 51, 8, 1, '#ffd04a');
    for (const [dx, len] of [[-3, 22], [4, 30], [-8, 14]]) for (let i = 0; i < len; i++)
      R(c, cx + dx + Math.sin(i / 4) * 2 + (dx < 0 ? -i * 0.3 : i * 0.3), b - 49 + i, 2, 1, i % 6 < 3 ? '#ff6a2a' : '#ffa03a');
    for (let i = 0; i < 18; i++) R(c, cx - 30 + i * 3.4, b - 4 + (i % 3), 3, 2, '#3e3430');
  },
  icepeak(c, cx, b) {
    tri(c, cx - 14, b - 40, 56, 40, '#8ea4bc', '#72869e');
    tri(c, cx + 16, b - 32, 44, 32, '#9cb2c8', '#7e94aa');
    tri(c, cx - 14, b - 40, 18, 12, '#ffffff', '#dfeaf5');
    tri(c, cx + 16, b - 32, 14, 9, '#ffffff', '#dfeaf5');
    for (const [dx, h, w] of [[-2, 46, 7], [6, 34, 5], [-9, 28, 4]]) {
      R(c, cx + dx - w / 2 - 1, b - h + 1, w + 2, h - 1, '#3a5a7a');
      R(c, cx + dx - w / 2, b - h + 2, w, h - 2, '#bff0ff'); R(c, cx + dx, b - h + 2, w / 2, h - 2, '#7fd0f0');
      tri(c, cx + dx, b - h - w + 1, w, w, '#dffcff', '#9fe0f8');
    }
  },
  deadtree(c, cx, b) {
    const ink = '#2a201c', bark = '#3e3028', lite = '#56443a';
    R(c, cx - 7, b - 40, 14, 40, ink); R(c, cx - 6, b - 40, 12, 40, bark); R(c, cx - 6, b - 40, 3, 40, lite);
    R(c, cx - 12, b - 3, 24, 3, bark);
    const branch = (x, y, dx, dy, n, w) => { for (let i = 0; i < n; i++) R(c, x + dx * i, y + dy * i + Math.sin(i / 2) * 1.5, w, w, bark); };
    branch(cx - 4, b - 36, -1.6, -1, 14, 3); branch(cx + 3, b - 34, 1.7, -1.1, 13, 3); branch(cx, b - 40, 0.3, -1.4, 18, 3);
    branch(cx - 20, b - 50, -1, -0.4, 6, 2); branch(cx + 22, b - 48, 1, -0.6, 6, 2); branch(cx - 10, b - 44, -0.5, -1.2, 8, 2);
    R(c, cx - 3, b - 26, 2, 2, '#c8ff6a'); R(c, cx + 2, b - 26, 2, 2, '#c8ff6a');   // glowing eyes in the hollow
    R(c, cx - 4, b - 22, 8, 5, '#120c0a');
  },
  castle(c, cx, b) {
    dome(c, cx, b, 36, 10, '#5a9a3a', '#4a8230');
    c.save(); c.translate(0, -8); castleArt(c, cx, b, '#a4a4b4', '#80808f', '#3d6bd0', '#2a4ea0'); c.restore();
    for (const dx of [-26, 26]) { box(c, cx + dx - 4, b - 26, 8, 18, '#a4a4b4', '#80808f'); tri(c, cx + dx, b - 35, 10, 9, '#3d6bd0', '#2a4ea0'); }
    R(c, cx + 1, b - 60, 1, 16, '#3b2a1a'); R(c, cx + 2, b - 60, 8, 4, '#ffd84a');
  },
  shrine(c, cx, b) {
    dome(c, cx, b - 2, 30, 8, '#7cb84e', '#6aa042');
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2, x = cx + Math.cos(a) * 24, y = b - 8 + Math.sin(a) * 7;
      box(c, x - 3, y - 14, 6, 14, '#a8a8a0', '#86867e', '#3a3a36');
    }
    box(c, cx - 7, b - 12, 14, 5, '#b8b8b0', '#96968e', '#3a3a36');
    R(c, cx - 2, b - 15, 4, 3, '#ffe680');
  },
  ruins(c, cx, b) {
    R(c, cx - 30, b - 3, 60, 3, '#5a5a6a');
    for (const [dx, h] of [[-24, 26], [-12, 34], [0, 14], [12, 30], [24, 18]]) {
      box(c, cx + dx - 3, b - h, 6, h, '#a4a2b4', '#82809a', '#2e2c3a');
      R(c, cx + dx - 4, b - h - 2, 8, 2, '#b6b4c6');
    }
    box(c, cx - 14, b - 36, 28, 3, '#a4a2b4', '#82809a', '#2e2c3a');
    for (let i = 0; i < 8; i++) box(c, cx - 28 + i * 7, b - 4 - (i % 2) * 2, 4, 3, '#8a889c', null, '#2e2c3a');
  },
  giantshroom(c, cx, b) {
    box(c, cx - 5, b - 30, 10, 30, '#e8dcc0', '#c8b898');
    dome(c, cx, b - 28, 30, 20, '#d0402a', '#a83020', '#3a1410');
    for (const [dx, dy, r] of [[-14, -38, 3], [0, -44, 4], [12, -36, 3], [-22, -31, 2], [22, -31, 2]]) circ(c, cx + dx, b + dy, r, '#f4ece0');
    for (const [dx, h] of [[-18, 8], [16, 6], [24, 5]]) { box(c, cx + dx - 1, b - h, 2, h, '#e8dcc0'); dome(c, cx + dx, b - h + 1, 4, 3, '#e0a040', '#c08030'); }
  },
  crystal(c, cx, b) {
    dome(c, cx, b, 28, 6, '#d8f0f0', '#b0d0d4', '#4a5a6a');
    crystalArt(c, cx, b - 3, 54, 11);
    crystalArt(c, cx - 13, b - 2, 34, 8);
    crystalArt(c, cx + 14, b - 2, 38, 8, true);
    crystalArt(c, cx - 22, b, 18, 5, true);
    crystalArt(c, cx + 24, b, 16, 5);
  },
  pyramid(c, cx, b) {
    for (let i = 0; i < 9; i++) {
      const w = 72 - i * 8, y = b - 6 - i * 6;
      box(c, cx - w / 2, y, w, 6, '#e0b868', '#c0964a', '#5a3a20');
    }
    R(c, cx - 4, b - 62, 8, 4, '#f6d860');
    R(c, cx - 4, b - 12, 8, 12, '#3a2414');
  },
};

// ------------------------------------------------------------------ scenery
const DECO = {
  snowpine(c, cx, b) {
    R(c, cx - 1, b - 3, 2, 3, '#4a3424');
    for (const [y, w] of [[-15, 6], [-11, 10], [-7, 14]]) { tri(c, cx, b + y - 3, w, 6, '#1f5a44', '#174836'); R(c, cx - w / 4, b + y - 3, w / 2, 1, '#ffffff'); }
    R(c, cx - 1, b - 19, 2, 2, '#ffffff');
  },
  icerock(c, cx, b) { dome(c, cx, b, 6, 6, '#a8c0d8', '#8aa2bc', '#3a5a7a'); R(c, cx - 3, b - 5, 3, 1, '#ffffff'); },
  darktree(c, cx, b) {
    R(c, cx - 1, b - 5, 3, 5, '#2a1e16');
    circ(c, cx, b - 10, 6, '#0f2418'); circ(c, cx - 1, b - 11, 5, '#183a26'); circ(c, cx + 1, b - 13, 3, '#1f4a30');
  },
  mushroom(c, cx, b) {
    for (const [dx, h, col] of [[-3, 4, '#d0402a'], [3, 6, '#b03a8a'], [0, 3, '#e0a040']]) {
      R(c, cx + dx, b - h, 1, h, '#e8dcc0'); dome(c, cx + dx + 0.5, b - h + 1, 2.5, 2, col);
    }
  },
  ashrock(c, cx, b) { dome(c, cx, b, 7, 6, '#4a3e3a', '#36302c', '#1a1010'); R(c, cx - 1, b - 2, 3, 1, '#ff6a2a'); },
  deadpine(c, cx, b) {
    R(c, cx, b - 16, 2, 16, '#3a2e28');
    for (let i = 0; i < 4; i++) { R(c, cx - 4 + i % 2, b - 14 + i * 3, 4, 1, '#3a2e28'); R(c, cx + 2, b - 13 + i * 3, 4 - i % 2, 1, '#3a2e28'); }
  },
  lavacrack(c, cx, b) { for (let i = 0; i < 10; i++) R(c, cx - 5 + i, b - 3 + Math.sin(i) * 2, 2, 1, i % 3 ? '#ff6a2a' : '#ffd04a'); },
  gravestone(c, cx, b) { box(c, cx - 3, b - 8, 6, 8, '#9a98a8', '#7a788c', '#2e2c3a'); R(c, cx - 1, b - 6, 2, 1, '#5a586a'); R(c, cx - 4, b, 8, 1, '#4a4a3a'); },
  reeds(c, cx, b) { for (let i = 0; i < 5; i++) { R(c, cx - 4 + i * 2, b - 6 - (i % 3) * 2, 1, 6 + (i % 3) * 2, '#5a7a2a'); if (i % 2) R(c, cx - 4 + i * 2, b - 9 - (i % 3) * 2, 1, 3, '#6a4a2a'); } },
  crystal(c, cx, b) { crystalArt(c, cx - 2, b, 10, 3); crystalArt(c, cx + 3, b, 7, 3, true); },
  palm(c, cx, b) {
    for (let i = 0; i < 14; i++) R(c, cx + Math.sin(i / 5) * 2, b - i, 2, 1, i % 3 ? '#8a6a3a' : '#6e5430');
    for (const [dx, dy] of [[-6, 1], [6, 1], [-4, -2], [4, -2], [0, -3]]) for (let i = 0; i < 4; i++) R(c, cx + 1 + dx * i / 4, b - 14 + dy * i / 4 + (i * i) / 4, 2, 1, '#3a9a3a');
  },
  cactus(c, cx, b) {
    box(c, cx - 1, b - 12, 3, 12, '#4a9a4a', '#367a36', '#1a3a1a');
    box(c, cx - 5, b - 8, 2, 4, '#4a9a4a', null, '#1a3a1a'); R(c, cx - 4, b - 5, 3, 2, '#4a9a4a');
    box(c, cx + 4, b - 10, 2, 4, '#4a9a4a', null, '#1a3a1a'); R(c, cx + 2, b - 7, 3, 2, '#4a9a4a');
  },
  dune(c, cx, b) { for (let i = 0; i < 12; i++) { R(c, cx - 6 + i, b - 2 - Math.sin(i / 3.8) * 3, 1, 1, '#c8a050'); R(c, cx - 6 + i, b - 1 - Math.sin(i / 3.8) * 3, 1, 1, '#fae6a8'); } },
  bones(c, cx, b) { R(c, cx - 3, b - 3, 4, 3, '#f0ece0'); R(c, cx - 2, b - 2, 1, 1, '#1a1020'); for (let i = 0; i < 3; i++) R(c, cx + 2, b - 3 + i, 4, 1, '#e0dcd0'); },
  boulder(c, cx, b) { dome(c, cx, b, 7, 8, '#8a8a8a', '#6a6a6a', '#2a2a2a'); R(c, cx - 3, b - 6, 2, 1, '#b0b0b0'); },
};

// =============================================================================
//  HD: sharper assets. Every sprite is upscaled 4x with a pixel-art scaler
//  (Scale2x twice), which rounds off staircase edges without blurring, and the
//  heavy outer outlines are thinned to half width. The result keeps the pixel look
//  but has 16x the pixels, and is drawn at the original size in world units.
//    HD.up(img)                         the 4x copy (cached)
//    HD.draw(ctx, img, dx, dy[, dw, dh]) or HD.draw(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh)
//                                       like drawImage, in the original image's pixels
// =============================================================================
const HD = {
  RES: 4,
  cache: new WeakMap(),

  // One Scale2x pass over 32-bit pixels. Outside the image counts as transparent.
  scale2x(src, w, h) {
    const out = new Uint32Array(w * h * 4), W2 = w * 2;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : src[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const P = src[y * w + x], A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
      const o = (y * 2) * W2 + x * 2;
      out[o] = (C === A && C !== D && A !== B) ? A : P;
      out[o + 1] = (A === B && A !== C && B !== D) ? B : P;
      out[o + W2] = (D === C && D !== B && C !== A) ? C : P;
      out[o + W2 + 1] = (B === D && B !== A && D !== C) ? D : P;
    }
    return out;
  },

  // Upscale raw RGBA pixels by 2^passes. thin: halve the outer outlines.
  upData(data, w, h, passes = 2, thin = true) {
    const lo = new Uint32Array(data.buffer.slice(0));
    let px = lo, pw = w, ph = h;
    for (let i = 0; i < passes; i++) { px = this.scale2x(px, pw, ph); pw *= 2; ph *= 2; }
    const k = 1 << passes;
    if (thin) {
      // a dark pixel touching transparency is an outline; in its big block, the half
      // away from the transparent side takes the colour of the pixel further in.
      const alpha = v => v >>> 24, dark = v => { const r = v & 255, g = (v >> 8) & 255, b = (v >> 16) & 255; return alpha(v) > 200 && r + g + b < 140; };
      const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : lo[y * w + x];
      const half = k / 2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = lo[y * w + x];
        if (!dark(v)) continue;
        const tU = !alpha(get(x, y - 1)), tD = !alpha(get(x, y + 1)), tL = !alpha(get(x - 1, y)), tR = !alpha(get(x + 1, y));
        if (!(tU || tD || tL || tR)) continue;
        const ix = x + (tL ? 1 : 0) - (tR ? 1 : 0), iy = y + (tU ? 1 : 0) - (tD ? 1 : 0);
        let inner = get(ix, iy);
        if (!alpha(inner) || dark(inner)) continue;               // nothing lighter inside: keep the outline
        // blend the inner colour a little toward the outline for a soft inner edge
        const mix = (a, b, t) => Math.round(a * (1 - t) + b * t);
        const ir = inner & 255, ig = (inner >> 8) & 255, ib = (inner >> 16) & 255, or = v & 255, og = (v >> 8) & 255, ob = (v >> 16) & 255;
        const soft = (255 << 24) | (mix(ib, ob, 0.35) << 16) | (mix(ig, og, 0.35) << 8) | mix(ir, or, 0.35);
        for (let by = 0; by < k; by++) for (let bx = 0; bx < k; bx++) {
          if (tU && by < half) continue; if (tD && by >= half) continue;
          if (tL && bx < half) continue; if (tR && bx >= half) continue;
          const o = (y * k + by) * pw + x * k + bx;
          const edgeRow = (tU && by === half) || (tD && by === half - 1) || (tL && bx === half) || (tR && bx === half - 1);
          if (dark(px[o])) px[o] = edgeRow ? soft : inner;
        }
      }
    }
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), pw, ph), 0, 0);
    return cv;
  },

  up(im, thin = true) {
    if (!im || !im.width) return null;
    let hd = this.cache.get(im);
    if (hd) return hd;
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
    hd = this.upData(cx.getImageData(0, 0, im.width, im.height).data, im.width, im.height, 2, thin);
    hd.res = this.RES; hd.lw = im.width; hd.lh = im.height;
    this.cache.set(im, hd);
    return hd;
  },

  // Smoothing on when the 4x art is shrunk on screen (crisp, like mipmaps); off when it is enlarged.
  smooth(ctx, res) {
    const m = ctx.getTransform(), sc = Math.hypot(m.a, m.b);
    const on = sc < res * 0.98;
    ctx.imageSmoothingEnabled = on;
    if (on) ctx.imageSmoothingQuality = 'high';
  },

  draw(ctx, im, ...a) {
    const hd = this.up(im);
    if (!hd) return;
    const r = hd.res, prev = ctx.imageSmoothingEnabled;
    this.smooth(ctx, r);
    if (a.length === 2) ctx.drawImage(hd, a[0], a[1], hd.lw, hd.lh);
    else if (a.length === 4) ctx.drawImage(hd, a[0], a[1], a[2], a[3]);
    else ctx.drawImage(hd, a[0] * r, a[1] * r, a[2] * r, a[3] * r, a[4], a[5], a[6], a[7]);
    ctx.imageSmoothingEnabled = prev;
  },

  // A small HD picture as a data URL (portraits, icons) - shown shrunk, so smoothed.
  url(cv) { return this.up(cv).toDataURL(); },
};
