// =============================================================================
//  MAP VIEW: draws the strategy map (land, regions, roads, towns, landmarks),
//  and handles scrolling and zooming.
//  The land is generated once from the towns and roads in js/map.js: land grows
//  around towns and roads, and each patch of land takes the look of the region
//  of its nearest town. Move a town and the coast and scenery follow.
// =============================================================================
const MapView = {
  W: 1600, H: 960,
  terrain: null,           // offscreen canvas: land, water, roads, scenery, landmarks
  thumb: null,             // small copy for the minimap
  time: 0,
  // camera: world point at the centre of the screen, and zoom (screen pixels per world pixel)
  cam: { x: 800, y: 480, z: 1.5 },
  scale: 1, ox: 0, oy: 0,  // world -> device pixel transform for the current frame
  fitAll: false,           // title screen: show the whole map

  init() {
    this.W = MAP.width; this.H = MAP.height;
    this.terrain = this.buildTerrain();
    this.thumb = document.createElement('canvas');
    this.thumb.width = 200; this.thumb.height = Math.round(200 * this.H / this.W);
    const tc = this.thumb.getContext('2d');
    tc.imageSmoothingEnabled = true;
    tc.drawImage(this.terrain, 0, 0, this.thumb.width, this.thumb.height);
    this.mist = Array.from({ length: 14 }, (_, i) => ({ seed: i, r: 40 + (i * 37) % 50 }));
    this.snow = Array.from({ length: 90 }, (_, i) => ({ x: (i * 97) % 1000 / 1000, y: (i * 61) % 1000 / 1000, s: 6 + (i % 5) * 3 }));
  },

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const W = this.W, H = this.H, CELL = 2, G = 8;             // 2x2 "pixels"; coarse grid of 8x8 for distances
    const spots = Object.values(DATA.spots);
    const segs = DATA.links.map(([a, b]) => [DATA.spots[a], DATA.spots[b]]);
    const noise = makeNoise(1234);
    const fbm = (x, y) => (noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.1);

    // 1. Coarse grid: distance to the nearest town or road, and which region it belongs to.
    const cw = Math.ceil(W / G) + 1, ch = Math.ceil(H / G) + 1;
    const cdist = new Float32Array(cw * ch), creg = new Array(cw * ch);
    for (let gy = 0; gy < ch; gy++) for (let gx = 0; gx < cw; gx++) {
      const x = gx * G, y = gy * G;
      let d = 1e9, rd = 1e9, reg = 'free';
      const wx = x + (fbm(x / 60, y / 60) - 0.5) * 70, wy = y + (fbm(x / 60 + 9, y / 60) - 0.5) * 70;   // wobbly borders
      for (const s of spots) {
        d = Math.min(d, Math.hypot(x - s.x, y - s.y) - 12);
        const e = Math.hypot(wx - s.x, wy - s.y);
        if (e < rd) { rd = e; reg = s.region; }
      }
      for (const [a, b] of segs) d = Math.min(d, distToSeg(x, y, a.x, a.y, b.x, b.y));
      for (const p of Object.values(MAP.landmarks)) d = Math.min(d, Math.hypot(x - p.x, (y - (p.y - 30)) * 0.8) - 30);   // land under each landmark
      cdist[gy * cw + gx] = d; creg[gy * cw + gx] = reg;
    }
    const distAt = (x, y) => {                                     // bilinear
      const fx = x / G, fy = y / G, ix = Math.min(cw - 2, Math.floor(fx)), iy = Math.min(ch - 2, Math.floor(fy)), tx = fx - ix, ty = fy - iy;
      const a = cdist[iy * cw + ix], b = cdist[iy * cw + ix + 1], c = cdist[(iy + 1) * cw + ix], d = cdist[(iy + 1) * cw + ix + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
    const regCoarse = (x, y) => creg[Math.max(0, Math.min(ch - 1, Math.round(y / G))) * cw + Math.max(0, Math.min(cw - 1, Math.round(x / G)))];
    // jitter the lookup a little so region borders look ragged rather than blocky
    const regAt = (x, y) => regCoarse(x + (noise(x / 22 + 3, y / 22) - 0.5) * 22, y + (noise(x / 22, y / 22 + 5) - 0.5) * 22);
    this.regAt = regAt;

    // 2. Which cells are land, lake or lava?
    const gw = W / CELL, gh = H / CELL;
    const land = new Uint8Array(gw * gh);         // 0 sea, 1 land, 2 inland lake, 3 lava
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const x = gx * CELL + 1, y = gy * CELL + 1, d = distAt(x, y), reg = regAt(x, y);
      const n = fbm(x / 45, y / 45);
      const edge = Math.min(x, y, W - x, H - y);
      let isLand = (d < 62 + (n - 0.5) * 80 || n > 0.6) && edge > 10 + n * 30;
      if (reg === 'azure') isLand = d < 16 + (n - 0.5) * 30 || (n > 0.62 && d < 60);   // islands and causeways
      let v = isLand ? 1 : 0;
      if (v && d > 16) {
        const m = fbm(x / 28 + 70, y / 28 + 30);
        if (reg === 'ember' && m > 0.7) v = 3;
        else if ((reg === 'frost' || reg === 'free' || reg === 'shadow') && m > 0.8 && d > 30) v = 2;
        else if (reg === 'bog' && m > 0.66) v = 2;
        else if (reg === 'sun' && m > 0.8 && fbm(x / 9, y / 9) > 0.5) v = 2;    // rare oasis
      }
      land[gy * gw + gx] = v;
    }
    const cellAt = (gx, gy) => (gx < 0 || gy < 0 || gx >= gw || gy >= gh) ? 0 : land[gy * gw + gx];
    const near = (gx, gy, r, test) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (test(cellAt(gx + dx, gy + dy))) return true;
      return false;
    };

    // 3. The atlas look: painted relief with a little crisp pixel terracing.
    //    Every region keeps its own colours (lowland, forest, rock, peak); an elevation
    //    field gives hills and mountain ridges away from towns and roads, lit from the
    //    north-west; high ground steps into terraces with cliff faces; forests are
    //    clusters of round canopies; rivers run downhill to the sea; the coast is a
    //    bright rim over a sea that deepens away from the shore.
    const LOOK = {
      aster:    { low: ['#3c8a2c', '#57a638', '#7cc24a'], forest: ['#173f1c', '#245c26', '#3a7e30'], rock: ['#5e4430', '#8a6844', '#b8946a', '#dcc29c'], peak: '#ece4d0', mtn: 0.75 },
      free:     { low: ['#5a9a30', '#78b440', '#9ccc5a'], forest: ['#1c4a1e', '#2a6628', '#428a34'], rock: ['#5e4a30', '#8a7044', '#b89a68', '#dcc89a'], peak: '#ece4d0', mtn: 0.55 },
      frost:    { low: ['#b8cadc', '#d6e4f0', '#f2f7fb'], forest: ['#1e3a34', '#2a5048', '#3e6a5e'], rock: ['#4e5a6a', '#76849a', '#a4b2c4', '#d0dcea'], peak: '#ffffff', mtn: 0.95 },
      darkwood: { low: ['#1e4424', '#2c5a2e', '#3e7238'], forest: ['#0c2414', '#163a1e', '#24542a'], rock: ['#3a3428', '#5a5038', '#80744e', '#a89a70'], peak: '#c8c0a0', mtn: 0.6 },
      ember:    { low: ['#4a3a34', '#614c42', '#7c6452'], forest: ['#2a201c', '#3a2c26', '#4e3c32'], rock: ['#2a1e1c', '#4a3430', '#6e5048', '#94746a'], peak: '#3a2a28', mtn: 1.0 },
      shadow:   { low: ['#4e4e66', '#62627c', '#7c7c98'], forest: ['#2a2a3c', '#383850', '#4a4a64'], rock: ['#363444', '#525066', '#76748c', '#9c9ab0'], peak: '#c8c8dc', mtn: 0.65 },
      bog:      { low: ['#4a5a24', '#5e6e30', '#76863c'], forest: ['#24301a', '#344424', '#465a2e'], rock: ['#3e3a24', '#5a5434', '#7a7248', '#9a9264'], peak: '#b0aa80', mtn: 0.25 },
      azure:    { low: ['#4ea898', '#6cc4b4', '#98dccc'], forest: ['#1e5a50', '#2a7064', '#3e8a7c'], rock: ['#5a6a7a', '#7e90a2', '#a6b8c8', '#d0dce8'], peak: '#f0f8ff', mtn: 0.3 },
      sun:      { low: ['#c49858', '#d8b270', '#ecce90'], forest: ['#6a6a2a', '#7e7e34', '#949440'], rock: ['#7a4a2a', '#a06a3e', '#c48e58', '#e0b47c'], peak: '#f4dcb0', mtn: 0.55 },
    };
    const FOREST = { aster: 0.58, free: 0.62, frost: 0.66, darkwood: 0.36, ember: 0.85, shadow: 0.68, bog: 0.62, azure: 0.78, sun: 2 };
    const gwh = gw * gh, rng = makeRng(99);
    const regC = new Array(gwh), elev = new Float32Array(gwh), coast = new Float32Array(gwh);
    // distance to the sea (two-pass chamfer), so land rises inland
    for (let i = 0; i < gwh; i++) coast[i] = land[i] === 0 ? 0 : 1e6;
    for (let pass = 0; pass < 2; pass++) {
      const f = pass === 0;
      for (let k = 0; k < gwh; k++) {
        const i = f ? k : gwh - 1 - k, gx = i % gw, gy = (i / gw) | 0, d = f ? -1 : 1;
        let v = coast[i];
        if (gx + d >= 0 && gx + d < gw) v = Math.min(v, coast[i + d] + 1);
        if (gy + d >= 0 && gy + d < gh) v = Math.min(v, coast[i + d * gw] + 1);
        if (gx + d >= 0 && gx + d < gw && gy + d >= 0 && gy + d < gh) v = Math.min(v, coast[i + d * gw + d] + 1.41);
        coast[i] = v;
      }
    }
    const seaD = new Float32Array(gwh);                                               // distance out to sea
    for (let i = 0; i < gwh; i++) seaD[i] = land[i] === 0 ? 1e6 : 0;
    for (let pass = 0; pass < 2; pass++) {
      const f = pass === 0;
      for (let k = 0; k < gwh; k++) {
        const i = f ? k : gwh - 1 - k, gx = i % gw, gy = (i / gw) | 0, d = f ? -1 : 1;
        let v = seaD[i];
        if (gx + d >= 0 && gx + d < gw) v = Math.min(v, seaD[i + d] + 1);
        if (gy + d >= 0 && gy + d < gh) v = Math.min(v, seaD[i + d * gw] + 1);
        if (gx + d >= 0 && gx + d < gw && gy + d >= 0 && gy + d < gh) v = Math.min(v, seaD[i + d * gw + d] + 1.41);
        seaD[i] = v;
      }
    }
    const ridged = (x, y) => 1 - Math.abs(2 * fbm(x, y) - 1);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx, x = gx * CELL + 1, y = gy * CELL + 1, reg = regAt(x, y);
      regC[i] = reg;
      if (land[i] !== 1) continue;
      const L = LOOK[reg] || LOOK.free;
      const keep = Math.max(0, Math.min(1, (distAt(x, y) - 12) / 30));             // towns and roads stay on low ground
      const range = Math.max(0, Math.min(1, (fbm(x / 190 + 50, y / 190 + 90) - 0.35) * 4));   // mountains gather into ranges
      const r = ridged(x / 64 + 11, y / 64 + 3), ridge = r * r;
      elev[i] = Math.min(1, coast[i] / 40) * 0.16 + fbm(x / 110 + 30, y / 110) * 0.2 + ridge * L.mtn * keep * range * 1.15;
    }
    const E = (gx, gy) => elev[Math.max(0, Math.min(gh - 1, gy)) * gw + Math.max(0, Math.min(gw - 1, gx))];
    const TER = 0.4, level = (gx, gy) => { const e = E(gx, gy); return e < TER ? -1 : Math.floor((e - TER) * 11); };
    // rivers: from high ground, downhill to the sea or a lake
    const river = new Uint8Array(gwh);
    const sources = [];
    for (let t = 0; t < 4000 && sources.length < 12; t++) {
      const gx = Math.floor(rng() * gw), gy = Math.floor(rng() * gh), i = gy * gw + gx;
      if (land[i] === 1 && elev[i] > 0.55 && regC[i] !== 'azure' && regC[i] !== 'sun' && regC[i] !== 'ember') sources.push([gx, gy]);
    }
    for (const [sx, sy] of sources) {
      let gx = sx, gy = sy, steps = 0;
      const path = [];
      while (steps++ < 700) {
        const i = gy * gw + gx;
        if (land[i] !== 1) break;
        path.push(i);
        let best = null, be = 1e9;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const nx = gx + dx, ny = gy + dy; if (nx < 1 || ny < 1 || nx >= gw - 1 || ny >= gh - 1) continue;
          const j = ny * gw + nx; if (river[j] === 2) continue;
          const e = elev[j] - (land[j] !== 1 ? 1 : 0) + (noise(nx / 6, ny / 6) - 0.5) * 0.02 + coast[j] * 0.006;   // downhill, and always toward the sea
          if (e < be) { be = e; best = [nx, ny]; }
        }
        if (!best) break;
        river[i] = 2; [gx, gy] = best;
      }
      if (path.length < 30 || path.length > 320) { for (const i of path) river[i] = 0; continue; }
      path.forEach((i, k) => { river[i] = 1; if (k > path.length * 0.5) river[i + 1] = 1; });
    }
    // paint
    const ground = new Uint32Array(gwh), colCache = {};
    const toInt = col => colCache[col] || (colCache[col] = (() => { const [r, g, b] = hexRgb(col); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; })());
    const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const mixInt = (a, b, t) => { const p = hexRgb(a), q = hexRgb(b);
      return ((255 << 24) | (Math.round(p[2] + (q[2] - p[2]) * t) << 16) | (Math.round(p[1] + (q[1] - p[1]) * t) << 8) | Math.round(p[0] + (q[0] - p[0]) * t)) >>> 0; };
    // pick from a palette at tone t (0..1), dithered between the steps: painted, but still pixels
    const tone = (pal, t, gx, gy) => {
      const f = Math.max(0, Math.min(0.999, t)) * (pal.length - 1), k = Math.floor(f), fr = f - k;
      const steps = 3, s = Math.floor(fr * steps), sub = fr * steps - s, j = (s + (sub * 16 > BAY[(gy & 3) * 4 + (gx & 3)] ? 1 : 0)) / steps;
      return mixInt(pal[k], pal[Math.min(pal.length - 1, k + 1)], Math.min(1, j));
    };
    const WATER = { frost: ['#7aa8cc', '#a8cce6', '#e8f4fc'], bog: ['#3a4a2a', '#4a5a34', '#6a7a4a'], azure: ['#1e8aa8', '#3cb4cc', '#a8f4ff'] };
    const canopy = (gx, gy) => {                                                     // round tree crowns on a 5-cell grid
      const cs = 5, cx0 = Math.floor(gx / cs), cy0 = Math.floor(gy / cs);
      let bd = 9, bdx = 0, bdy = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = cx0 + ox, cy = cy0 + oy, h = Math.imul(cx * 374761393 + cy * 668265263, 1274126177) >>> 0;
        const px = (cx + 0.25 + ((h & 255) / 255) * 0.5) * cs, py = (cy + 0.25 + (((h >> 8) & 255) / 255) * 0.5) * cs;
        const dx = gx - px, dy = gy - py, d = Math.hypot(dx, dy) / 3.3;
        if (d < bd) { bd = d; bdx = dx; bdy = dy; }
      }
      if (bd > 1) return 0.05;
      return 0.5 + (1 - bd) * 0.25 + (bdx + bdy < -1 ? 0.25 : bdx + bdy > 1.5 ? -0.25 : 0);
    };
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx, x = gx * CELL, y = gy * CELL, v = land[i], reg = regC[i], L = LOOK[reg] || LOOK.free;
      let ci;
      if (v === 1) {
        const e = elev[i], lv = level(gx, gy);
        const shade = (E(gx - 1, gy - 1) - E(gx + 1, gy + 1)) * 14;                // light from the north-west
        const seaN = near(gx, gy, 1, c => c === 0);
        if (river[i] === 1) ci = toInt(near(gx, gy, 1, c => c === 0) ? '#8ad0f0' : (river[i - 1] === 1 && river[i + 1] === 1) || (river[i - gw] === 1 && river[i + gw] === 1) ? '#b8e8fa' : '#6ab8e6');
        else if (river[i + 1] === 1 || river[i - 1] === 1 || river[i + gw] === 1 || river[i - gw] === 1) ci = mixInt(L.low[0], '#2a4a3a', 0.35);   // dark river banks
        else if (seaN) ci = toInt(reg === 'frost' ? '#f4f8ff' : reg === 'ember' ? '#3a302e' : reg === 'bog' ? '#7a6a40' : '#ecd99a');      // beach rim
        else if (near(gx, gy, 1, c => c === 3)) ci = toInt('#241a18');
        else if (lv >= 0) {
          // terraces: a cliff face below every step down, a bright lip on top
          const above1 = level(gx, gy - 1), above2 = level(gx, gy - 2), below = level(gx, gy + 1);
          const peak = e > 0.78 && (reg === 'frost' || reg === 'shadow' || reg === 'aster' || reg === 'free' || reg === 'azure');
          if (above1 > lv || above2 > lv) ci = tone(L.rock, (gx % 3 === 0 ? 0.05 : 0.22) + (above1 > lv ? 0 : 0.08), gx, gy);
          else if (below < lv) ci = peak ? toInt('#ffffff') : tone(L.rock, 0.95, gx, gy);
          else ci = peak ? tone([L.rock[2], L.peak, '#ffffff'], 0.45 + shade * 0.5, gx, gy) : tone(L.rock, 0.5 + shade + (noise(x / 9, y / 9) - 0.5) * 0.25, gx, gy);
        } else {
          const hill = Math.max(0, (e - 0.26) / (TER - 0.26));
          const f = fbm(x / 48 + 100, y / 48), isForest = f > FOREST[reg] && distAt(x, y) > 14;
          if (isForest) ci = tone(L.forest, canopy(gx, gy) + shade * 0.6, gx, gy);
          else {
            let t = 0.55 + shade * (0.6 + hill) + (fbm(x / 30 + 50, y / 30) - 0.5) * 0.45 - hill * 0.12 + (noise(x / 4 + 300, y / 4) - 0.5) * 0.22;
            ci = hill > 0.55 ? tone([L.low[0], L.low[1], L.rock[2]], t * 0.9, gx, gy) : tone(L.low, t, gx, gy);
            if (rng() < 0.004) ci = toInt(L.low[2]);
          }
        }
      } else if (v === 3) {                                                          // lava
        ci = toInt(fbm(x / 8, y / 8) > 0.55 ? '#ffb03a' : '#e8501e');
        if (rng() < 0.015) ci = toInt('#ffe070');
      } else if (v === 2) {                                                          // lakes
        const w = WATER[reg] || ['#2a78c0', '#3a92d4', '#a8e0fa'];
        ci = toInt(near(gx, gy, 1, c => c === 1) ? w[1] : w[0]);
        if (rng() < 0.004 || (reg === 'frost' && fbm(x / 9, y / 9) > 0.62)) ci = toInt(w[2]);
      } else {                                                                       // the sea: bright by the shore, deep far out
        const d = seaD[i], landAbove = cellAt(gx, gy - 1) === 1 || cellAt(gx, gy - 2) === 1;
        const wave = Math.sin(x / 5 + fbm(x / 30, y / 30) * 9 + y / 9) > 0.975 && fbm(x / 22 + 40, y / 22) > 0.5;
        if (d <= 1.01) ci = toInt(reg === 'frost' ? '#e8f4fc' : '#d8f4ff');                      // foam
        else if (landAbove && d < 4) ci = toInt('#1a4a7a');                              // the land's shadow on the water
        else ci = tone(['#123676', '#1a52a0', '#2672bc', '#3a98d4', '#5cc0e2'], 1.02 - Math.sqrt(d / 26) * 0.85 + (fbm(x / 40 + 7, y / 40) - 0.5) * 0.18, gx, gy);
        if (wave && d > 3) ci = mixInt('#2a7cc4', '#a8e0fa', 0.35);
        if (reg === 'frost' && d > 4 && fbm(x / 12, y / 12) > 0.6) ci = toInt('#f0f8ff');   // ice floes
        if (rng() < 0.0025) ci = toInt('#a8e0fa');
      }
      ground[i] = ci;
    }
    // one Scale2x pass: the 2-px cells become the map's 1-px art grid, with rounded coasts kept as hard pixels
    const cv = HD.upData(new Uint8ClampedArray(ground.buffer), gw, gh, 1, false);
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.elev = { elev, gw, gh, CELL };

    // 4. Routes: thin pale lines between towns, as on an atlas
    ctx.lineCap = 'round';
    for (const [a, b] of segs) {
      ctx.strokeStyle = 'rgba(20,30,20,0.35)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y + 0.8); ctx.lineTo(b.x, b.y + 0.8); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,252,236,0.85)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // 5. A little scenery for each region's character (the forests and hills now do most of the work)
    const lm = Object.entries(MAP.landmarks);
    const deco = [];
    const FLAVOUR = { frost: ['snowpine', 'icerock'], ember: ['deadpine', 'ashrock'], shadow: ['gravestone', 'deadpine'], bog: ['mushroom', 'reeds'],
      azure: ['palm', 'crystal'], sun: ['cactus', 'cactus', 'bones'], darkwood: ['mushroom'] };
    for (let y = 8; y < H; y += 14) for (let x = 6; x < W; x += 15) {
      const cx = x + (rng() - 0.5) * 10, cy = y + (rng() - 0.5) * 8;
      const gx = Math.floor(cx / CELL), gy = Math.floor(cy / CELL), reg = regAt(cx, cy), list = FLAVOUR[reg];
      if (!list || cellAt(gx, gy) !== 1 || near(gx, gy, 3, c => c !== 1) || level(gx, gy) >= 0 || river[gy * gw + gx] || distAt(cx, cy) < 22) continue;
      let ds = 1e9;
      for (const s of spots) ds = Math.min(ds, Math.hypot(cx - s.x, cy - s.y + 6));
      if (ds < 40 || lm.some(([, p]) => Math.abs(cx - p.x) < 48 * LS && cy < p.y + 30 && cy > p.y - 72 * LS)) continue;
      if (rng() < (reg === 'sun' ? 0.12 : 0.1)) deco.push([list[Math.floor(rng() * list.length)], cx, cy]);
    }
    for (const [reg, p] of lm) deco.push(['@' + reg, p.x, p.y]);
    deco.sort((a, b) => a[2] - b[2]);
    for (const [name, x, y] of deco) {
      const big = name[0] === '@';
      const im = big ? Art.landmark(DATA.regions[name.slice(1)].landmark) : Art.deco(name);
      if (!im || !im.width) continue;
      if (!big) { mapDraw(ctx, im, x - im.width / 2, y - im.height + 1); continue; }
      // landmarks: one art pixel each, on a soft shadow
      const w = im.width * LS, h = im.height * LS, bw = (im.box.x1 - im.box.x0 + 1) * LS;
      ctx.fillStyle = 'rgba(20,16,30,0.3)';
      ctx.beginPath(); ctx.ellipse(x + 4, y + 1, bw * 0.55, bw * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      mapDraw(ctx, im, x - w / 2, y - h + 2 * LS, LS);
    }
    // region names: placed now, clear of the towns as far as possible
    this.regionNames = [];
    for (const [reg, p] of lm) {
      const rn = DATA.regions[reg].name;
      ctx.font = '13px PixelFont';
      const tw = Math.ceil(ctx.measureText(rn).width) + 12;
      // place the plate where no town (building, banner, generals, name) overlaps it
      // how much of the plate a town would cover (its building, banner, generals and name)
      const overlap = (px, py) => spots.reduce((sum, s) => {
        const ox = Math.min(px + tw / 2, s.x + 34) - Math.max(px - tw / 2, s.x - 34);
        const oy = Math.min(py + 20, s.y + 34) - Math.max(py - 16, s.y - (s.kind === 'capital' || s.kind === 'city' ? 100 : 80));
        return sum + (ox > 0 && oy > 0 ? ox * oy : 0);
      }, 0);
      let x = p.x, ty = p.y + 18, best = Infinity;
      const top = p.y - 72 * LS + 4;
      for (const [dx, dy] of [[0, 18], [0, 30], [-30, 22], [30, 22], [0, top - p.y], [-80, -10], [80, -10], [-95, -40], [95, -40], [-70, 20], [70, 20]]) {
        const py = p.y + dy;
        if (py < 40 || py > this.H - 34) continue;                                       // stay on the map (plates have two lines)
        const o = overlap(p.x + dx, py) * 3 + (Math.abs(dx) + Math.abs(dy - 18)) * 0.5;   // prefer just below the landmark
        if (o < best) { best = o; x = p.x + dx; ty = p.y + dy; }
      }
      // drawn live each frame (see drawRegionNames), so they stay sharp and readable at any zoom
      const home = Object.values(DATA.factions).find(f => f.home === reg && !f.neutral);
      const owner = Object.keys(DATA.factions).find(f => DATA.landmarkRegion && DATA.landmarkRegion(f) === reg && DATA.landmarkPower.factions[f]);
      this.regionNames.push({ name: rn, x, y: ty - 4, trim: home ? home.color : '#c9a15a', f: owner });
    }
    return Palette.canvas(cv, 0);                  // the whole map in the game's palette
  },

  // ---------------------------------------------------------------- camera
  fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    if (this.fitAll) {
      this.scale = Math.min(canvas.width / this.W, canvas.height / this.H);
    } else {
      const minZ = Math.max(canvas.width / this.W, canvas.height / this.H) / dpr;   // never smaller than the screen
      this.cam.z = Math.max(minZ, Math.min(4, this.cam.z));
      // zoomed in, whole screen pixels per map (art) pixel so the pixel art stays crisp; below 1, smooth
      let N = this.cam.z * dpr;
      if (N >= 1) N = Math.max(1, Math.round(N));
      if (N < minZ * dpr) N = minZ * dpr;
      this.scale = N;
      const hw = canvas.width / 2 / this.scale, hh = canvas.height / 2 / this.scale;
      this.cam.x = Math.max(hw, Math.min(this.W - hw, this.cam.x));
      this.cam.y = Math.max(hh, Math.min(this.H - hh, this.cam.y));
    }
    const cx = this.fitAll ? this.W / 2 : this.cam.x, cy = this.fitAll ? this.H / 2 : this.cam.y;
    const N = this.scale, snap = v => N >= 1 ? Math.round(v / Math.round(N)) * Math.round(N) : Math.round(v);   // on whole map pixels
    this.ox = snap(canvas.width / 2 - cx * this.scale);
    this.oy = snap(canvas.height / 2 - cy * this.scale);
  },
  toWorld(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; },
  centerOn(x, y) { this.cam.x = x; this.cam.y = y; },
  zoomAt(factor, px, py) {                     // px, py: device pixels to keep still
    const [wx, wy] = this.toWorld(px, py), dpr0 = window.devicePixelRatio || 1, N = this.scale || 1;
    if (N >= 1 && factor > 1) this.cam.z = (Math.round(N) + 1) / dpr0;               // whole steps when zoomed in
    else if (N > 1.5 && factor < 1) this.cam.z = (Math.round(N) - 1) / dpr0;
    else this.cam.z = this.cam.z * factor;
    this.cam.z = Math.max(0.3, Math.min(4, this.cam.z));
    const dpr = window.devicePixelRatio || 1, s = this.cam.z * dpr;
    this.cam.x = wx - (px - this.canvasW / 2) / s;
    this.cam.y = wy - (py - this.canvasH / 2) / s;
  },

  spotAt(wx, wy) {
    let best = null, bd = 26;
    for (const [id, s] of Object.entries(DATA.spots)) {
      const d = Math.hypot(wx - s.x, wy - (s.y - 8));
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  },

  // ---------------------------------------------------------------- input
  // Drag to scroll, wheel or pinch to zoom, click a town. Arrow keys / WASD scroll.
  attach(canvas, onClick, onHover, active = () => true) {
    const pts = new Map();
    let drag = null, pinch = null;
    const dev = e => { const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
    canvas.addEventListener('pointerdown', e => {
      if (!active()) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      pts.set(e.pointerId, dev(e));
      if (pts.size === 1) drag = { start: dev(e), cam: { ...this.cam }, moved: false };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.cam.z }; drag = null; }
    });
    canvas.addEventListener('pointermove', e => {
      if (!active()) return;
      const p = dev(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomAt((pinch.z * d / pinch.d) / this.cam.z, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        return;
      }
      if (drag && !this.fitAll) {
        const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
        if (Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved) { this.cam.x = drag.cam.x - dx / this.scale; this.cam.y = drag.cam.y - dy / this.scale; canvas.style.cursor = 'grabbing'; }
      } else if (!drag) {
        const id = this.spotAt(...this.toWorld(...p));
        onHover(id);
        canvas.style.cursor = id ? 'pointer' : 'grab';
      }
    });
    const up = e => {
      if (!active()) { pts.clear(); drag = null; pinch = null; return; }
      const wasClick = drag && !drag.moved;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (e.type === 'pointerup' && wasClick && pts.size === 0) onClick(this.spotAt(...this.toWorld(...dev(e))));
      if (pts.size === 0) drag = null;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => {
      if (!active()) return;
      e.preventDefault();
      if (!this.fitAll) this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, ...dev(e));
    }, { passive: false });
    this.keys = new Set();
    window.addEventListener('keydown', e => { if (!e.target.closest || !e.target.closest('input,textarea')) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  },

  scrollKeys(dt) {
    if (!this.keys || this.fitAll) return;
    const sp = 420 * dt / this.cam.z, k = this.keys;
    if (k.has('arrowleft') || k.has('a')) this.cam.x -= sp;
    if (k.has('arrowright') || k.has('d')) this.cam.x += sp;
    if (k.has('arrowup') || k.has('w')) this.cam.y -= sp;
    if (k.has('arrowdown') || k.has('s')) this.cam.y += sp;
  },

  // ---------------------------------------------------------------- render
  // ui = { selected, targets: {spotId: 'move'|'attack'}, hover }
  render(ctx, canvas, game, ui, dt) {
    this.time += dt;
    this.canvasW = canvas.width; this.canvasH = canvas.height;
    this.scrollKeys(dt);
    this.startQueuedFx(dt);
    this.fit(canvas);
    if (this.shake > 0.2) {                    // screen shake after big captures (in whole map pixels)
      const k = Math.max(1, Math.round(this.scale));
      this.ox += Math.round((Math.random() - 0.5) * this.shake * 2) * k;
      this.oy += Math.round((Math.random() - 0.5) * this.shake * 2) * k;
    }
    this.shake *= Math.pow(0.02, dt);
    if (this.calm === undefined) this.calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (this.calm) { this.shake = 0; this.flash = Math.min(this.flash, 0.15); }
    // the map is drawn into a buffer at one pixel per map pixel, then enlarged by a whole number
    // (N), so the land, towns, generals and scenery share one pixel grid; names go on top, sharp
    const screen = ctx, N = this.scale >= 1 ? Math.round(this.scale) : this.scale;
    const bw = Math.ceil(canvas.width / N), bh = Math.ceil(canvas.height / N);
    if (!this.buf || this.buf.width !== bw || this.buf.height !== bh) { this.buf = document.createElement('canvas'); this.buf.width = bw; this.buf.height = bh; }
    ctx = this.buf.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2b3848';
    ctx.fillRect(0, 0, bw, bh);
    ctx.setTransform(1, 0, 0, 1, this.ox / N, this.oy / N);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, 0, 0, this.W, this.H);

    // visible area in world pixels, so off-screen towns are skipped
    const [vx0, vy0] = this.toWorld(0, 0), [vx1, vy1] = this.toWorld(canvas.width, canvas.height);
    const vis = (x, y, m = 60) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

    this.drawLandmarkFx(ctx, vis);

    if (ui.selected) {
      const a = DATA.spots[ui.selected];
      for (const [id, kind] of Object.entries(ui.targets)) {
        const b = DATA.spots[id];
        ctx.strokeStyle = kind === 'attack' ? 'rgba(255,80,60,0.9)' : 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.lineDashOffset = -this.time * 12;
        ctx.beginPath(); ctx.moveTo(a.x, a.y - 4); ctx.lineTo(b.x, b.y - 4); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    const order = Object.keys(DATA.spots).sort((p, q) => DATA.spots[p].y - DATA.spots[q].y);
    this.drawBeams(ctx, dt);
    for (const id of order) if (vis(DATA.spots[id].x, DATA.spots[id].y)) this.drawSpot(ctx, id, game, ui);
    this.drawWeather(ctx, vis, vx0, vy0, vx1, vy1);
    this.drawFx(ctx, dt);
    // enlarge the buffer onto the screen, then the names, sharp
    screen.setTransform(1, 0, 0, 1, 0, 0);
    screen.imageSmoothingEnabled = N < 1;
    screen.drawImage(this.buf, 0, 0, bw * N, bh * N);
    ctx = screen;
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    for (const id of order) if (vis(DATA.spots[id].x, DATA.spots[id].y)) this.drawSpotName(ctx, id, game);
    this.drawRegionNames(ctx, vis, game);
    this.drawFxText(ctx);
    if (this.flash > 0.01) {                   // full-screen flash
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255,248,220,${Math.min(0.85, this.flash)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (this.flashCol) {
        const g = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.3, canvas.width / 2, canvas.height / 2, canvas.width * 0.75);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, hexA(this.flashCol, Math.min(0.6, this.flash * 1.4)));
        ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      this.flash *= Math.pow(0.04, dt);
    }
  },

  // ---------------------------------------------------------------- effects
  // Captures and recruits are queued (they may happen while a battle is on screen)
  // and start on the next map frame, one after another.
  queue: [], parts: [], rings: [], texts: [], beams: [], later: [], raise: {}, beacons: {},
  shake: 0, flash: 0, flashCol: null, qWait: 0,
  tierOf(kind) { return kind === 'capital' || kind === 'city' ? 3 : kind === 'town' || kind === 'shrine' ? 2 : 1; },

  // who: 'mine' (player took it), 'lost' (player lost it), 'other'
  capture(spot, faction, who) { this.queue.push({ type: 'capture', spot, faction, who }); },
  recruit(spot, name, how) { this.queue.push({ type: 'recruit', spot, name, how }); },
  beacon(spot) { this.beacons[spot] = this.time; },

  startQueuedFx(dt) {
    if (this.qWait > 0) { this.qWait -= dt; return; }
    const e = this.queue.shift();
    if (!e) return;
    const s = DATA.spots[e.spot];
    if (e.type === 'recruit') { this.recruitFx(s, e.name, e.how); this.qWait = 0.4; return; }
    const tier = this.tierOf(s.kind), col = DATA.factions[e.faction].color;
    this.raise[e.spot] = this.time;
    if (e.who === 'mine') this.captureFx(s, tier, col);
    else if (e.who === 'lost') this.lostFx(s, tier);
    else this.ring(s.x, s.y + 2, 4, 30, 0.7, col, 2);
    this.qWait = e.who === 'mine' ? [0, 0.3, 0.6, 1.4][tier] : 0.05;
  },

  captureFx(s, tier, col) {
    const x = s.x, y = s.y - 10;
    if (tier >= 2) this.centerOn(x, y);
    // shockwaves
    for (let i = 0; i < [0, 1, 2, 4][tier]; i++)
      this.ring(x, s.y + 2, 6, [0, 34, 52, 90][tier] + i * 14, 0.7 + i * 0.18, i % 2 ? '#d0c090' : col, tier === 3 ? 3 : 2, i * 0.12);
    // bursts of faction colour and gold
    this.burst(x, y, [0, 26, 50, 110][tier], [col, lighten(col, 0.4), '#d0c090', '#fff6c0'], [0, 60, 85, 130][tier]);
    if (tier >= 2) this.coins(x, y - 6, tier === 3 ? 34 : 14);
    if (tier === 1) this.floatText(x, y - 36, 'CAPTURED!', '#eeedeb', 11, 1.6);   // towns and cities get the big banner instead
    this.floatText(x, y - 22, `+${s.income} gold / turn`, '#7be07b', 9, 1.8, 0.35);
    this.shake = Math.max(this.shake, [0, 1.5, 4, 11][tier]);
    if (tier >= 2) { this.flash = tier === 3 ? 0.75 : 0.22; this.flashCol = tier === 3 ? col : null; }
    if (tier === 3) {
      this.beams.push({ x, y: s.y, age: 0, dur: 2.6, col });
      for (let i = 0; i < 9; i++) this.later.push({ t: 0.35 + i * 0.28 + Math.random() * 0.15, fn: () => {
        const fx = x + (Math.random() - 0.5) * 120, fy = y - 40 - Math.random() * 60;
        this.burst(fx, fy, 36, [col, '#d0c090', '#ffffff', lighten(col, 0.5)], 70, 0.9);
        this.ring(fx, fy, 2, 22, 0.5, '#fff6c0', 1);
        Assets.sfx(i % 2 ? 'magic-1' : 'kill', 0.25);
      } });
      Assets.sfx('succes', 0.6); Assets.sfx('power-up', 0.5);
      this.later.push({ t: 0.5, fn: () => Assets.sfx('gold-1', 0.5) });
    } else if (tier === 2) {
      Assets.sfx('succes', 0.5); this.later.push({ t: 0.25, fn: () => Assets.sfx('gold-1', 0.45) });
    } else Assets.sfx('gold-1', 0.45);
    if (tier >= 2) showCaptureBanner(s, col, tier);
  },

  lostFx(s, tier) {
    this.ring(s.x, s.y + 2, 6, 40 + tier * 10, 0.9, '#ff4a3a', 2);
    for (let i = 0; i < 18 + tier * 10; i++) this.parts.push({ x: s.x + (Math.random() - 0.5) * 24, y: s.y - 6, vx: (Math.random() - 0.5) * 16,
      vy: -12 - Math.random() * 22, g: -4, life: 0, max: 1.2 + Math.random(), col: Math.random() < 0.3 ? '#ff6a3a' : '#4a4048', size: 2 + Math.random() * 2.5, soft: true });
    this.floatText(s.x, s.y - 40, 'LOST!', '#ff6b5e', 11 + tier, 1.6);
    this.shake = Math.max(this.shake, tier * 1.5);
    Assets.sfx('alert', 0.4);
  },

  recruitFx(s, name, how) {
    const x = s.x, y = s.y - 10, col = how === 'persuade' ? '#ff7ad9' : '#d0c090';
    this.ring(x, s.y + 2, 4, 40, 0.8, col, 2);
    this.ring(x, s.y + 2, 4, 26, 0.6, '#ffffff', 1, 0.15);
    this.beams.push({ x, y: s.y, age: 0, dur: 1.3, col, thin: true });
    this.burst(x, y, 40, [col, '#ffffff', '#fff6c0'], 70);
    this.floatText(x, y - 30, how === 'persuade' ? 'WON OVER!' : 'HERO JOINS!', col, 12, 2);
    this.floatText(x, y - 17, name, '#ffffff', 9, 2, 0.2);
    this.shake = Math.max(this.shake, 2);
    Assets.sfx('power-up', 0.5); this.later.push({ t: 0.2, fn: () => Assets.sfx('magic-1', 0.35) });
  },

  ring(x, y, r0, r1, dur, col, w = 2, delay = 0) { this.rings.push({ x, y, r0, r1, dur, col, w, age: -delay }); },
  burst(x, y, n, cols, speed, grav = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.75);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8 - speed * 0.35, g: 90 * grav, life: 0,
        max: 0.6 + Math.random() * 0.8, col: cols[i % cols.length], size: 1 + Math.floor(Math.random() * 2) });
    }
  },
  coins(x, y, n) {
    for (let i = 0; i < n; i++) this.parts.push({ x: x + (Math.random() - 0.5) * 10, y, vx: (Math.random() - 0.5) * 70, vy: -60 - Math.random() * 60,
      g: 160, life: 0, max: 1.1 + Math.random() * 0.6, col: '#d0c090', size: 2, coin: true, spin: Math.random() * 6 });
  },
  floatText(x, y, text, col, size, dur, delay = 0) { this.texts.push({ x, y, text, col, size, dur, age: -delay }); },

  drawFx(ctx, dt) {
    for (const l of this.later) l.t -= dt;
    for (const l of this.later.filter(l => l.t <= 0)) l.fn();
    this.later = this.later.filter(l => l.t > 0);
    this.drawRest(ctx, dt);
  },
  // light pillars, behind the towns so the new flag shows in front
  drawBeams(ctx, dt) {
    for (const b of this.beams) {
      b.age += dt;
      const k = b.age / b.dur, a = Math.sin(Math.min(1, k) * Math.PI) * (b.thin ? 0.55 : 0.75);
      const w = (b.thin ? 8 : 18) * (1 - k * 0.5);
      const g = ctx.createLinearGradient(0, b.y - 160, 0, b.y);
      g.addColorStop(0, hexA(b.col, 0)); g.addColorStop(0.7, hexA(b.col, a * 0.7)); g.addColorStop(1, hexA('#ffffff', a));
      ctx.fillStyle = g; ctx.fillRect(b.x - w / 2, b.y - 160, w, 160);
      ctx.fillStyle = `rgba(255,255,255,${a * 0.8})`; ctx.fillRect(b.x - w / 6, b.y - 160, w / 3, 160);
    }
    this.beams = this.beams.filter(b => b.age < b.dur);
  },
  drawRest(ctx, dt) {
    // shockwave rings
    for (const r of this.rings) {
      r.age += dt;
      if (r.age < 0) continue;
      const k = Math.min(1, r.age / r.dur), e = 1 - Math.pow(1 - k, 3), rad = r.r0 + (r.r1 - r.r0) * e;
      ctx.strokeStyle = hexA(r.col, 1 - k); ctx.lineWidth = r.w * (1 - k * 0.5);
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    this.rings = this.rings.filter(r => r.age < r.dur);
    // particles
    for (const p of this.parts) {
      p.life += dt; p.vy += p.g * dt; p.vx *= Math.pow(0.4, dt); p.x += p.vx * dt; p.y += p.vy * dt;
      const a = 1 - p.life / p.max;
      if (a <= 0) continue;
      if (p.soft) { ctx.fillStyle = hexA(p.col, a * 0.6); circPath(ctx, p.x, p.y, p.size * (1 + p.life)); continue; }
      ctx.globalAlpha = Math.min(1, a * 1.5);
      if (p.coin) {
        const w = Math.max(1, Math.round(Math.abs(Math.cos(p.life * 8 + p.spin)) * 3));
        ctx.fillStyle = '#8a5a10'; ctx.fillRect(Math.round(p.x - w / 2) - 0.5, Math.round(p.y) - 1.5, w + 1, 4);
        ctx.fillStyle = p.col; ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y) - 1, w, 3);
      } else {
        ctx.fillStyle = p.col; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }
    this.parts = this.parts.filter(p => p.life < p.max);
    for (const t of this.texts) t.age += dt;
  },
  // floating words (drawn sharp, over the enlarged map): pop in, hold, drift up and fade
  drawFxText(ctx) {
    for (const t of this.texts) {
      if (t.age < 0) continue;
      const k = t.age / t.dur, pop = t.age < 0.18 ? 1.6 - (t.age / 0.18) * 0.6 : 1;
      const a = k > 0.75 ? (1 - k) / 0.25 : 1;
      ctx.globalAlpha = Math.max(0, a);
      label(ctx, t.text, t.x, t.y - k * 14, t.col, 'center', Math.round(t.size * pop));
      ctx.globalAlpha = 1;
    }
    this.texts = this.texts.filter(t => t.age < t.dur);
  },

  // Region names on plates, drawn every frame on top of the map so the text is crisp at
  // any zoom and never smaller than about 15 screen pixels. Trimmed in the colour of the
  // faction whose home the region is (gold for the Heartlands).
  drawRegionNames(ctx, vis, game) {
    const dpr = window.devicePixelRatio || 1, z = this.scale / dpr;
    const fs = Math.max(13, 15 / z);                         // world pixels
    for (const r of this.regionNames || []) {
      if (!vis(r.x, r.y, 120)) continue;
      // second line: the landmark's power, or that it is broken while the capital is lost
      const L = r.f && DATA.landmarkPower.factions[r.f], seat = L && DATA.landmarkSeat(r.f);
      const held = L && game && game.spots && game.spots[seat] && game.spots[seat].owner === r.f;
      const sub = L ? (held ? `${DATA.plural(DATA.units[L.unit].name)} empowered` : 'Power broken: capital lost') : '';
      // atlas lettering: big italic serif with a soft shadow and a dark edge, no plate
      const px = 1 / z, ss = fs * 0.66, F = "Georgia, 'Times New Roman', serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.font = `italic 700 ${fs * 1.25}px ${F}`;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillText(r.name, r.x + 2 * px, r.y + 2.5 * px);
      ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(16,12,24,0.85)'; ctx.strokeText(r.name, r.x, r.y);
      ctx.fillStyle = '#fff8e6'; ctx.fillText(r.name, r.x, r.y);
      if (sub) {
        ctx.font = `italic 600 ${ss}px ${F}`;
        const sy = r.y + fs * 0.95;
        ctx.lineWidth = 2.6 * px; ctx.strokeText(sub, r.x, sy);
        ctx.fillStyle = held ? lighten(r.trim, 0.45) : '#ff8a7a'; ctx.fillText(sub, r.x, sy);
      }
    }
    ctx.textBaseline = 'alphabetic';
  },

  // Volcano smoke, crystal sparkles, fireflies.
  drawLandmarkFx(ctx, vis) {
    const t = this.time;
    for (const [reg, p] of Object.entries(MAP.landmarks)) {
      if (!vis(p.x, p.y, 160)) continue;
      const type = DATA.regions[reg].landmark, L = LS;          // offsets follow the landmark's drawn size
      if (type === 'volcano') {
        for (let i = 0; i < 6; i++) {
          const k = (t * 0.25 + i / 6) % 1;
          ctx.fillStyle = `rgba(70,60,60,${0.55 * (1 - k)})`;
          circPath(ctx, p.x + (Math.sin(k * 6 + i) * 6 + k * 14) * L, p.y - (52 * L + 2) - k * 40 * L, (3 + k * 9) * L);
        }
        ctx.fillStyle = `rgba(255,120,40,${0.25 + 0.15 * Math.sin(t * 3)})`;
        circPath(ctx, p.x, p.y - (50 * L + 2), 10 * L);
      } else if (type === 'crystal') {
        ctx.fillStyle = `rgba(255,150,220,${0.12 + 0.1 * Math.sin(t * 2)})`;
        circPath(ctx, p.x, p.y - 30 * L, 34 * L);
        for (let i = 0; i < 5; i++) {
          const k = (t * 0.6 + i / 5) % 1;
          ctx.fillStyle = `rgba(255,255,255,${1 - k})`;
          ctx.fillRect(Math.round(p.x + (-24 + ((i * 13) % 48)) * L), Math.round(p.y - (20 + k * 40) * L), 1.5, 1.5);
        }
      } else if (type === 'deadtree' || type === 'giantshroom') {
        for (let i = 0; i < 8; i++) {
          const a = t * 0.7 + i * 0.8;
          ctx.fillStyle = `rgba(200,255,106,${0.5 + 0.5 * Math.sin(t * 4 + i)})`;
          ctx.fillRect(Math.round(p.x + Math.sin(a) * 30 * L), Math.round(p.y + (-30 + Math.cos(a * 1.3) * 18) * L), 1.5, 1.5);
        }
      }
    }
  },

  // Drifting mist over the Mistlands and snowfall over the Frozen North.
  drawWeather(ctx, vis, vx0, vy0, vx1, vy1) {
    const t = this.time;
    const sh = MAP.landmarks.shadow, fr = MAP.landmarks.frost;
    if (sh && vis(sh.x, sh.y, 300)) {
      for (const m of this.mist) {
        const x = sh.x - 220 + ((m.seed * 83 + t * 6) % 440), y = sh.y - 150 + (m.seed * 47) % 300;
        if (this.regAt(x, y) !== 'shadow') continue;
        const g = ctx.createRadialGradient(x, y, 0, x, y, m.r);
        g.addColorStop(0, 'rgba(220,215,240,0.28)'); g.addColorStop(1, 'rgba(220,215,240,0)');
        ctx.fillStyle = g; ctx.fillRect(x - m.r, y - m.r, m.r * 2, m.r * 2);
      }
    }
    if (fr && vis(fr.x, fr.y, 400)) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const w = vx1 - vx0, h = vy1 - vy0;
      for (const f of this.snow) {
        const x = vx0 + (((f.x * w + Math.sin(t + f.s) * 8) % w) + w) % w;
        const y = vy0 + ((f.y * h + t * f.s) % h);
        if (this.regAt(x, y) === 'frost') ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
  },

  drawSpot(ctx, id, game, ui) {
    const s = DATA.spots[id];
    const owner = game.spots[id].owner;
    const color = DATA.factions[owner].color;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);

    const ring = (col, r) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 5, r, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    };
    if (ui.selected === id) ring(`rgba(255,240,120,${0.6 + pulse * 0.4})`, 26);
    else if (ui.targets[id] === 'attack') ring(`rgba(255,70,50,${0.5 + pulse * 0.5})`, 24);
    else if (ui.targets[id] === 'move') ring(`rgba(255,255,255,${0.5 + pulse * 0.5})`, 24);
    else if (ui.hover === id) ring('rgba(255,255,255,0.5)', 24);

    // faction-coloured ground circle, outlined so it reads on any ground
    const tier = this.tierOf(s.kind);
    const gr = [0, 23, 27, 32][tier];
    if (s.walls) this.drawSite(ctx, s, gr, id);
    ctx.fillStyle = hexA(color, 0.5);
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 5, gr, gr * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(16,10,24,0.85)'; ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = lighten(color, 0.35);
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 5, gr - 1.5, gr * 0.42 - 1.2, 0, 0, Math.PI * 2); ctx.stroke();

    // building in the region's style, with a flag in the owner's colour
    const style = DATA.regions[s.region].building;
    const size = { village: 0, town: 1, capital: 2, city: 2, shrine: style === 'village' ? 3 : 0 }[s.kind] || 0;
    // drawn bigger, scaled by the building's own width so every region's houses match
    const im = Art.building(style, size, id);                       // each town its own variant
    // one art pixel per map pixel; the picture's box, tx, ty are in the old 48 x 40 units (generated pictures are twice that)
    const sc = im.gen ? 2 : 1;
    const bx = Math.round(s.x - 24 * sc), by = Math.round(s.y - 3 - 38 * sc);   // the building stands at (24, 38) in old units
    mapDraw(ctx, im, bx, by);
    // flag pole planted on the roof's highest point
    const poleX = Math.round(bx + (im.box.tx + 0.5) * sc), poleBase = Math.round(by + im.box.ty * sc + 2);
    let lift = 1;
    if (this.raise[id] != null) {                 // just captured: hoist the new banner
      const k = Math.min(1, (this.time - this.raise[id]) / 0.9);
      lift = 1 - Math.pow(1 - k, 3);
      if (k >= 1) delete this.raise[id];
    }
    Heraldry.draw(ctx, owner, poleX, poleBase - Heraldry.poleLen(tier), tier, this.time, { mine: owner === game.player, lift });
    if (style === 'forge') {                                      // forge smoke
      const k = (this.time * 0.5 + s.x / 100) % 1;
      ctx.fillStyle = `rgba(80,70,70,${0.5 * (1 - k)})`;
      circPath(ctx, bx + (im.box.x1 - 6) * sc + k * 4, by + (im.box.y0 + 8) * sc - k * 12, (1.5 + k * 3) * sc);
    }

    // generals standing in front of the building: drawn 22 px, outlined in their side's
    // colour (white for the Free Towns); generals who have moved this turn are faded
    const GS = 32, gap = 20, MAXG = 2;                               // 32: one art pixel per map pixel; two at most, the rest counted
    const outlineOf = f => !f || DATA.factions[f].neutral ? '#ffffff' : DATA.factions[f].color;
    const gens = game.generalsAt(id);
    const shown = gens.slice(0, MAXG);
    const startX = s.x - ((shown.length - 1) * gap) / 2;
    shown.forEach((g, i) => {
      const done = g.acted && owner === game.player;
      Assets.drawUnit(ctx, Assets.outlined(Assets.genSprite(g.id), outlineOf(g.faction)), 0, 0, false,
        startX + i * gap - GS / 2, s.y + 16 - GS, done ? 0.5 : 1, GS, { t: this.time + i * 0.7 + s.x * 0.01 });
    });
    if (gens.length > MAXG) {                                // how many more are here
      const bx = Math.round(startX + (shown.length - 1) * gap + 12), by = Math.round(s.y - 4);
      ctx.fillStyle = '#1a1020'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx - 1, by - 1, 15, 10, 3) : ctx.rect(bx - 1, by - 1, 15, 10); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, 13, 8, 2.5) : ctx.rect(bx, by, 13, 8); ctx.fill();
      label(ctx, '+' + (gens.length - MAXG), bx + 6.5, by + 7, '#ffffff', 'center', 8);
    }

    // wandering generals stand beside the building with a gold outline and a gold coin
    const free = game.wanderersAt ? game.wanderersAt(id) : [];
    free.slice(0, 2).forEach((g, i) => {
      const WS = 32, wx = s.x - 28 - i * 15, wy = s.y + 2 - WS;                       // to the left; the right is for the +N badge
      const bob = Math.floor(this.time * 2 + i) % 2;
      Assets.drawUnit(ctx, Assets.outlined(Assets.genSprite(g.id), '#d0c090'), 0, 0, false, wx - WS / 2, wy, 1, WS, { t: this.time + i });
      const cx = wx + 7, cy = wy - 2 - bob;
      ctx.fillStyle = '#1a1020'; ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d0c090'; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b8860b'; ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 2, 1, 4);
      ctx.fillStyle = '#eeedeb'; ctx.fillRect(Math.round(cx) - 2, Math.round(cy) - 2, 1, 1);
    });

    // recruit opportunity: a bobbing badge over the town
    const opp = game.oppSpots && game.oppSpots[id];
    if (opp) this.drawBeacon(ctx, id, s, opp, poleBase - Heraldry.poleLen(tier) - 14);

  },

  // A walled town's site under it (an island in a lake, a crag with a ramp, a ridge end)
  // and its wall: a stone ring with a gap for each gate (see DATA.sites).
  drawSite(ctx, s, gr, id) {
    const x = s.x, y = s.y + 5, rx = gr + 6, ry = rx * 0.45, site = s.site || 'open';
    const ell = (cx, cy, a, b) => { ctx.beginPath(); ctx.ellipse(cx, cy, a, b, 0, 0, Math.PI * 2); };
    if (site === 'lake') {
      ell(x, y + 1, rx + 12, ry + 7); ctx.fillStyle = 'rgba(16,10,24,0.6)'; ctx.fill();
      ell(x, y + 1, rx + 11, ry + 6); ctx.fillStyle = '#3f7fc0'; ctx.fill();
      ell(x, y + 1, rx + 7, ry + 3.5); ctx.strokeStyle = 'rgba(190,226,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#16101a'; ctx.fillRect(x - rx - 13, y - 3, 14, 6);              // the causeway
      ctx.fillStyle = '#b08c5c'; ctx.fillRect(x - rx - 12, y - 2, 13, 4);
    } else if (site === 'crag' || site === 'hill') {
      const lift = site === 'crag' ? 8 : 4, col = site === 'crag' ? ['#5a5058', '#8a8088', '#a8a0a4'] : ['#4a5a30', '#6a7a44', '#86965a'];
      ell(x, y + lift, rx + 6, ry + 4); ctx.fillStyle = 'rgba(16,10,24,0.7)'; ctx.fill();
      ctx.fillStyle = col[0]; ctx.fillRect(x - rx - 5, y, (rx + 5) * 2, lift);
      ell(x, y + lift, rx + 5, ry + 3); ctx.fill();
      ell(x, y, rx + 5, ry + 3); ctx.fillStyle = col[2]; ctx.fill();
      ctx.strokeStyle = col[1]; ctx.lineWidth = 1;
      for (let a = 0.3; a < Math.PI - 0.2; a += 0.45) { const px = x + Math.cos(a) * (rx + 5); ctx.beginPath(); ctx.moveTo(px, y + Math.sin(a) * (ry + 3)); ctx.lineTo(px, y + Math.sin(a) * (ry + 3) + lift - 1); ctx.stroke(); }
      if (site === 'crag') { ctx.fillStyle = '#16101a'; ctx.beginPath(); ctx.moveTo(x - rx - 4, y - 3); ctx.lineTo(x - rx - 16, y + lift + 2); ctx.lineTo(x - rx - 8, y + lift + 4); ctx.lineTo(x - rx + 2, y + 3); ctx.fill();
        ctx.fillStyle = '#b08c5c'; ctx.beginPath(); ctx.moveTo(x - rx - 3, y - 1.5); ctx.lineTo(x - rx - 14, y + lift + 2); ctx.lineTo(x - rx - 8, y + lift + 3); ctx.lineTo(x - rx + 1, y + 2); ctx.fill(); }
    }
    // the wall: a stone ring broken at the gates
    const gaps = { open: [Math.PI, -Math.PI / 2, Math.PI / 2, 0], hill: [Math.PI, id.length % 2 ? -Math.PI / 2 : Math.PI / 2], crag: [Math.PI], lake: [Math.PI] }[site];
    const R = rx - 1, Ry = R * 0.45;
    for (const [col, lw] of [['rgba(16,10,24,0.9)', 4.5], ['#bab6c4', 2.6]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      let a0 = -Math.PI + 0.2;                                   // (every town has a west gate)
      for (const g of gaps.slice().sort((p, q) => p - q).concat([Math.PI + 0.001])) {
        const a1 = Math.min(g, Math.PI) - 0.2;
        if (a1 > a0) { ctx.beginPath(); ctx.ellipse(x, y, R, Ry, 0, a0, a1); ctx.stroke(); }
        a0 = g + 0.2;
      }
    }
    ctx.fillStyle = '#e4e0ec';
    for (let a = 0; a < Math.PI * 2; a += 0.32) if (!gaps.some(g => Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.24)) ctx.fillRect(Math.round(x + Math.cos(a) * R) - 0.5, Math.round(y + Math.sin(a) * Ry) - 1.5, 1.2, 1.2);
  },

  // The town's name, drawn sharp over the enlarged map.
  drawSpotName(ctx, id, game) {
    const s = DATA.spots[id], owner = game.spots[id].owner, color = DATA.factions[owner].color, tier = this.tierOf(s.kind);
    // name: plain lettering with a dark outline, as on an atlas, and a thin underline in the owner's colour
    const fs = [0, 11, 12, 14][tier];
    ctx.font = `${fs}px PixelFont`;
    const tw = Math.ceil(ctx.measureText(s.name).width), ty = s.y + 26;
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(12,10,20,0.92)'; ctx.strokeText(s.name, s.x, ty);
    ctx.fillStyle = tier === 3 ? '#d0c090' : owner === game.player ? '#eeedeb' : '#ffffff';
    ctx.fillText(s.name, s.x, ty);
    ctx.fillStyle = 'rgba(12,10,20,0.85)'; ctx.fillRect(Math.round(s.x - tw / 2) - 1, ty + 2, tw + 2, 3);
    ctx.fillStyle = color; ctx.fillRect(Math.round(s.x - tw / 2), ty + 3, tw, 1);
  },

  // Bobbing badge: gold "!" = a hero you can hire here; pink "?" = a general you can persuade.
  drawBeacon(ctx, id, s, kind, y) {
    const hire = kind === 'hire', col = hire ? '#d0c090' : '#ff7ad9';
    const bob = Math.sin(this.time * 4 + s.x) * 2, pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    const x = s.x - 6, cy = Math.round(y + bob);
    const fresh = this.beacons[id] != null && this.time - this.beacons[id] < 1.5;
    ctx.fillStyle = hexA(col, 0.18 + pulse * 0.2);
    circPath(ctx, x, cy, 9 + pulse * 3 + (fresh ? 6 : 0));
    ctx.fillStyle = '#1a1020';
    ctx.beginPath(); ctx.moveTo(x, cy - 8); ctx.lineTo(x + 8, cy); ctx.lineTo(x, cy + 8); ctx.lineTo(x - 8, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(x, cy - 6.5); ctx.lineTo(x + 6.5, cy); ctx.lineTo(x, cy + 6.5); ctx.lineTo(x - 6.5, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x - 3, cy - 3, 2, 2);
    ctx.fillStyle = '#1a1020';
    if (hire) { ctx.fillRect(x - 1, cy - 4, 2, 5); ctx.fillRect(x - 1, cy + 2, 2, 2); }
    else { ctx.fillRect(x - 2, cy - 4, 4, 1); ctx.fillRect(x + 1, cy - 3, 1, 2); ctx.fillRect(x - 1, cy - 1, 2, 2); ctx.fillRect(x - 1, cy + 2, 2, 2); }
  },

  // ---------------------------------------------------------------- minimap
  // Small overview in the corner: towns in owner colours and the visible area.
  drawMinimap(mc, game) {
    const c = mc.getContext('2d');
    const k = mc.width / this.W;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.thumb, 0, 0, mc.width, mc.height);
    for (const [id, s] of Object.entries(DATA.spots)) {
      const o = game && game.spots && game.spots[id] ? game.spots[id].owner : s.owner;
      c.fillStyle = '#1a1020'; c.fillRect(s.x * k - 2.5, s.y * k - 2.5, 5, 5);
      c.fillStyle = DATA.factions[o].color; c.fillRect(s.x * k - 1.5, s.y * k - 1.5, 3, 3);
    }
    if (!this.fitAll && this.canvasW) {
      const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.canvasW, this.canvasH);
      c.strokeStyle = '#d0c090'; c.lineWidth = 1.5;
      c.strokeRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    }
  },
};

// Colour helpers for '#rrggbb' strings.
function hexRgb(h) { const n = parseInt(h.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function hexA(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`; }
function lighten(h, k) { const [r, g, b] = hexRgb(h); return `rgb(${[r, g, b].map(v => Math.round(v + (255 - v) * k)).join(',')})`; }
function darken(h, k) { const [r, g, b] = hexRgb(h); return `rgb(${[r, g, b].map(v => Math.round(v * (1 - k))).join(',')})`; }

// Big banner across the map after taking a town (tier 2) or a capital/city (tier 3).
function showCaptureBanner(s, col, tier) {
  const el = document.getElementById('capture-banner');
  if (!el) return;
  el.className = tier === 3 ? 'big' : '';
  el.style.setProperty('--fc', col);
  el.innerHTML = `<div class="cb-kicker">${tier === 3 ? (s.kind === 'capital' ? 'Capital Conquered' : 'City Conquered') : 'Town Taken'}</div>
    <div class="cb-name">${s.name}</div><div class="cb-sub">+${s.income} gold per turn</div>`;
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(showCaptureBanner.t);
  showCaptureBanner.t = setTimeout(() => { el.hidden = true; }, tier === 3 ? 3200 : 2000);
}

const LS = 1;                   // landmarks are drawn at their picture's own size (one art pixel each, like everything else)
// Draw pixel art on the map's art grid (one art pixel per map pixel), k map pixels per image pixel.
function mapDraw(ctx, im, x, y, k = 1, sx = 0, sy = 0, sw = im.width, sh = im.height) {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(im, sx, sy, sw, sh, Math.round(x), Math.round(y), Math.round(sw * k), Math.round(sh * k));
  ctx.imageSmoothingEnabled = prev;
}

function circPath(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

// Pixel text with a dark outline (world coordinates)
function label(ctx, text, x, y, color, align = 'center', size = 8) {
  ctx.font = `${size}px PixelFont`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1a1020';
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(text, Math.round(x) + dx * 0.5, Math.round(y) + dy * 0.5);
  ctx.fillStyle = color;
  ctx.fillText(text, Math.round(x), Math.round(y));
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// Smooth value noise in 0..1
function makeNoise(seed) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
