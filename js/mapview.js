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
      cdist[gy * cw + gx] = d; creg[gy * cw + gx] = reg;
    }
    const distAt = (x, y) => {                                     // bilinear
      const fx = x / G, fy = y / G, ix = Math.min(cw - 2, Math.floor(fx)), iy = Math.min(ch - 2, Math.floor(fy)), tx = fx - ix, ty = fy - iy;
      const a = cdist[iy * cw + ix], b = cdist[iy * cw + ix + 1], c = cdist[(iy + 1) * cw + ix], d = cdist[(iy + 1) * cw + ix + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
    const regCoarse = (x, y) => creg[Math.max(0, Math.min(ch - 1, Math.round(y / G))) * cw + Math.max(0, Math.min(cw - 1, Math.round(x / G)))];
    // jitter the lookup a little so region borders look ragged rather than blocky
    const regAt = (x, y) => regCoarse(x + (noise(x / 7 + 3, y / 7) - 0.5) * 18, y + (noise(x / 7, y / 7 + 5) - 0.5) * 18);
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

    // 3. Paint
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const rng = makeRng(99);
    const WATER = {
      frost: ['#bcd8ee', '#a6c8e4', '#e8f4fc'],       // icy water
      bog: ['#4a5a3a', '#3e4c30', '#6a7a4a'],         // murky
      azure: ['#3cc4d8', '#2aa6c4', '#a8f4ff'],       // bright lagoon
    };
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const x = gx * CELL, y = gy * CELL, v = cellAt(gx, gy), reg = regAt(x, y);
      const pal = DATA.regions[reg].ground;
      const n = fbm(x / 30 + 50, y / 30);
      let col;
      if (v === 1) {
        if (near(gx, gy, 1, c => c === 0)) col = reg === 'frost' ? '#e4eef6' : reg === 'ember' ? '#3e3434' : reg === 'bog' ? '#6a5a3a' : '#e9d38f';
        else if (near(gx, gy, 1, c => c === 3)) col = '#2a201e';
        else col = n > 0.6 ? pal[2] : n < 0.35 ? pal[0] : pal[1];
        if (rng() < 0.04) col = pal[3];
      } else if (v === 3) {                                         // lava
        col = fbm(x / 8, y / 8) > 0.55 ? '#ffb03a' : '#e8501e';
        if (rng() < 0.05) col = '#ffe070';
      } else if (v === 2) {                                         // lake
        const w = WATER[reg] || ['#4a8ad0', '#3a74bc', '#9fd0f4'];
        col = near(gx, gy, 1, c => c === 1) ? w[0] : w[1];
        if (rng() < 0.02) col = w[2];
        if (reg === 'frost' && n > 0.5) col = '#e8f4fc';            // frozen
      } else {
        const w = WATER[reg];
        if (near(gx, gy, 2, c => c === 1)) col = w ? w[0] : '#5fa8dc';
        else col = n > 0.55 ? '#2e5f9f' : '#3a71b5';
        if (reg === 'frost' && n > 0.6 && fbm(x / 12, y / 12) > 0.55) col = '#f0f8ff';   // ice floes
        if (rng() < 0.015) col = '#8cc6ee';
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, CELL, CELL);
    }

    // 4. Roads, styled per region (stone, sand, planks...)
    const ROAD = { frost: ['#8a9cb0', '#c8d6e4'], ember: ['#2a2220', '#6a5a50'], sun: ['#b08850', '#e8cc90'],
      darkwood: ['#3a2c1e', '#6a5236'], azure: ['#c8b890', '#f4ead0'], shadow: ['#4a4a5a', '#8a8a9c'], bog: ['#4a3a22', '#7a6440'] };
    for (const [a, b] of segs) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let i = 0; i <= len; i += 1) {
        const t = i / len, wob = Math.sin(t * Math.PI) * Math.sin(t * 9 + a.x) * 3;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        const x = a.x + (b.x - a.x) * t + nx * wob, y = a.y + (b.y - a.y) * t + ny * wob;
        const [dark, lite] = ROAD[regAt(x, y)] || ['#9b7a4a', '#d3b27a'];
        const wet = cellAt(Math.floor(x / CELL), Math.floor(y / CELL)) !== 1;
        ctx.fillStyle = wet ? '#5a3e22' : dark; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
        ctx.fillStyle = wet ? (i % 3 ? '#a8804a' : '#5a3e22') : lite; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);   // bridges over water
      }
    }

    // 5. Scenery, kept away from towns, roads and landmarks
    const lm = Object.entries(MAP.landmarks);
    const deco = [];
    for (let y = 8; y < H; y += 11) for (let x = 6; x < W; x += 12) {
      const cx = x + (rng() - 0.5) * 8, cy = y + (rng() - 0.5) * 6;
      const gx = Math.floor(cx / CELL), gy = Math.floor(cy / CELL);
      if (cellAt(gx, gy) !== 1 || cellAt(gx - 5, gy) !== 1 || cellAt(gx + 5, gy) !== 1 || near(gx, gy, 2, c => c !== 1)) continue;
      if (distAt(cx, cy) < 22) continue;
      let ds = 1e9;
      for (const s of spots) ds = Math.min(ds, Math.hypot(cx - s.x, cy - s.y + 6));
      if (ds < 36 || lm.some(([, p]) => Math.abs(cx - p.x) < 48 && cy < p.y + 8 && cy > p.y - 70)) continue;
      const reg = regAt(cx, cy), list = DATA.regions[reg].deco;
      const f = fbm(cx / 55 + 200, cy / 55);
      const dense = reg === 'darkwood' ? 0.42 : reg === 'sun' || reg === 'shadow' ? 0.7 : 0.55;
      if (f > dense) deco.push([list[Math.floor(fbm(cx / 40 + 400, cy / 40) * 3.99) % list.length], cx, cy]);
      else if (rng() < (reg === 'sun' ? 0.1 : 0.06)) deco.push([list[Math.floor(rng() * list.length)], cx, cy]);
      else if (rng() < 0.04 && reg !== 'frost' && reg !== 'sun' && reg !== 'ember') deco.push([['grass_tuft', 'bush'][Math.floor(rng() * 2)], cx, cy]);
    }
    for (const [reg, p] of lm) deco.push(['@' + reg, p.x, p.y]);
    deco.sort((a, b) => a[2] - b[2]);
    for (const [name, x, y] of deco) {
      const big = name[0] === '@';
      const im = big ? Art.landmark(DATA.regions[name.slice(1)].landmark) : Art.deco(name);
      if (!im || !im.width) continue;
      ctx.drawImage(im, Math.round(x - im.width / 2), Math.round(y - im.height + (big ? 2 : 1)));
      if (big) label(ctx, DATA.regions[name.slice(1)].name, x, y + 12, '#f6ecd0', 'center', 10);   // region name
    }
    return cv;
  },

  // ---------------------------------------------------------------- camera
  fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    if (this.fitAll) {
      this.scale = Math.min(canvas.width / this.W, canvas.height / this.H);
    } else {
      const minZ = Math.max(canvas.width / this.W, canvas.height / this.H) / dpr;   // never smaller than the screen
      this.cam.z = Math.max(minZ, Math.min(4, this.cam.z));
      this.scale = this.cam.z * dpr;
      const hw = canvas.width / 2 / this.scale, hh = canvas.height / 2 / this.scale;
      this.cam.x = Math.max(hw, Math.min(this.W - hw, this.cam.x));
      this.cam.y = Math.max(hh, Math.min(this.H - hh, this.cam.y));
    }
    const cx = this.fitAll ? this.W / 2 : this.cam.x, cy = this.fitAll ? this.H / 2 : this.cam.y;
    this.ox = Math.round(canvas.width / 2 - cx * this.scale);
    this.oy = Math.round(canvas.height / 2 - cy * this.scale);
  },
  toWorld(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; },
  centerOn(x, y) { this.cam.x = x; this.cam.y = y; },
  zoomAt(factor, px, py) {                     // px, py: device pixels to keep still
    const [wx, wy] = this.toWorld(px, py);
    this.cam.z = Math.max(0.3, Math.min(4, this.cam.z * factor));
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
  attach(canvas, onClick, onHover) {
    const pts = new Map();
    let drag = null, pinch = null;
    const dev = e => { const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
    canvas.addEventListener('pointerdown', e => {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      pts.set(e.pointerId, dev(e));
      if (pts.size === 1) drag = { start: dev(e), cam: { ...this.cam }, moved: false };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.cam.z }; drag = null; }
    });
    canvas.addEventListener('pointermove', e => {
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
    this.fit(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1d3557';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, 0, 0);

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
    for (const id of order) if (vis(DATA.spots[id].x, DATA.spots[id].y)) this.drawSpot(ctx, id, game, ui);
    this.drawWeather(ctx, vis, vx0, vy0, vx1, vy1);
  },

  // Volcano smoke, crystal sparkles, fireflies.
  drawLandmarkFx(ctx, vis) {
    const t = this.time;
    for (const [reg, p] of Object.entries(MAP.landmarks)) {
      if (!vis(p.x, p.y, 120)) continue;
      const type = DATA.regions[reg].landmark;
      if (type === 'volcano') {
        for (let i = 0; i < 6; i++) {
          const k = (t * 0.25 + i / 6) % 1;
          ctx.fillStyle = `rgba(70,60,60,${0.55 * (1 - k)})`;
          circPath(ctx, p.x + Math.sin(k * 6 + i) * 6 + k * 14, p.y - 54 - k * 40, 3 + k * 9);
        }
        ctx.fillStyle = `rgba(255,120,40,${0.25 + 0.15 * Math.sin(t * 3)})`;
        circPath(ctx, p.x, p.y - 52, 10);
      } else if (type === 'crystal') {
        ctx.fillStyle = `rgba(255,150,220,${0.12 + 0.1 * Math.sin(t * 2)})`;
        circPath(ctx, p.x, p.y - 30, 34);
        for (let i = 0; i < 5; i++) {
          const k = (t * 0.6 + i / 5) % 1;
          ctx.fillStyle = `rgba(255,255,255,${1 - k})`;
          ctx.fillRect(Math.round(p.x - 24 + ((i * 13) % 48)), Math.round(p.y - 20 - k * 40), 1, 1);
        }
      } else if (type === 'deadtree' || type === 'giantshroom') {
        for (let i = 0; i < 8; i++) {
          const a = t * 0.7 + i * 0.8;
          ctx.fillStyle = `rgba(200,255,106,${0.5 + 0.5 * Math.sin(t * 4 + i)})`;
          ctx.fillRect(Math.round(p.x + Math.sin(a) * 30), Math.round(p.y - 30 + Math.cos(a * 1.3) * 18), 1, 1);
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
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, r, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    };
    if (ui.selected === id) ring(`rgba(255,240,120,${0.6 + pulse * 0.4})`, 26);
    else if (ui.targets[id] === 'attack') ring(`rgba(255,70,50,${0.5 + pulse * 0.5})`, 24);
    else if (ui.targets[id] === 'move') ring(`rgba(255,255,255,${0.5 + pulse * 0.5})`, 24);
    else if (ui.hover === id) ring('rgba(255,255,255,0.5)', 24);

    // faction-coloured ground circle
    ctx.fillStyle = color + '66';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, 22, 9, 0, 0, Math.PI * 2); ctx.fill();

    // building in the region's style, with a flag in the owner's colour
    const style = DATA.regions[s.region].building;
    const size = { village: 0, town: 1, capital: 2, city: 2, shrine: style === 'village' ? 3 : 0 }[s.kind] || 0;
    const im = Art.building(style, size);
    const bx = Math.round(s.x - 24), by = Math.round(s.y - 34);
    ctx.drawImage(im, bx, by);
    const fx = bx + im.box.x1 - 2, fy = by + im.box.y0 - 10;
    const wave = Math.floor(this.time * 4 + s.x) % 2;
    ctx.fillStyle = '#1a1020'; ctx.fillRect(fx, fy - 1, 10 + wave, 8);
    ctx.fillStyle = '#3b2a1a'; ctx.fillRect(fx, fy, 1, 13);
    ctx.fillStyle = color;
    ctx.fillRect(fx + 1, fy, 8, 4);
    ctx.fillRect(fx + 1, fy + 4, 7 + wave, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(fx + 1, fy + 5, 7 + wave, 1);
    if (style === 'forge') {                                      // forge smoke
      const k = (this.time * 0.5 + s.x / 100) % 1;
      ctx.fillStyle = `rgba(80,70,70,${0.5 * (1 - k)})`;
      circPath(ctx, bx + im.box.x1 - 6 + k * 4, by + im.box.y0 + 8 - k * 12, 1.5 + k * 3);
    }

    // generals standing in front of the building
    const gens = game.generalsAt(id);
    const shown = gens.slice(0, 4);
    const startX = s.x - (shown.length * 11) / 2;
    shown.forEach((g, i) => {
      Assets.drawUnit(ctx, Assets.genSprite(g.id), 0, 0, false, startX + i * 11 - 2, s.y - 6);
      if (g.acted && owner === game.player) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(Math.round(startX + i * 11 - 2), s.y - 6, 16, 16);
      }
    });
    if (gens.length > 4) label(ctx, '+' + (gens.length - 4), s.x + 24, s.y + 6, '#fff', 'left');

    // wandering generals stand beside the building, marked with a gold coin
    const free = game.wanderersAt ? game.wanderersAt(id) : [];
    free.slice(0, 2).forEach((g, i) => {
      const wx = s.x + 14 + i * 10, wy = s.y - 16;
      const bob = Math.floor(this.time * 2 + i) % 2;
      Assets.drawUnit(ctx, Assets.genSprite(g.id), 0, 0, false, wx, wy);
      const cx = wx + 8, cy = wy - 4 - bob;
      ctx.fillStyle = '#1a1020'; ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b8860b'; ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 2, 1, 4);
      ctx.fillStyle = '#fff6b0'; ctx.fillRect(Math.round(cx) - 2, Math.round(cy) - 2, 1, 1);
    });

    label(ctx, s.name, s.x, s.y + 21, owner === game.player ? '#fff6b0' : '#ffffff', 'center', 12);
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
      c.strokeStyle = '#ffe680'; c.lineWidth = 1.5;
      c.strokeRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    }
  },
};

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
