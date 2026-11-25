#!/usr/bin/env node
// =============================================================================
//  PIXELGEN CLI: write generated pixel art straight to PNG files. Offline, no
//  dependencies beyond Node itself (PNGs are encoded here with zlib).
//
//    node tools/pixelgen/cli.js <kind> [--seed N] [--count N] [--faction F]
//                               [--scale N] [--out DIR] [--name NAME] [--opt k=v ...]
//
//  Examples
//    node tools/pixelgen/cli.js hero --faction ember --cls mage --seed 12
//    node tools/pixelgen/cli.js portrait --faction frost --count 8 --out out/faces
//    node tools/pixelgen/cli.js tile --tile cobble --count 4 --scale 4
//    node tools/pixelgen/cli.js hero --seed 40 --out assets/chars --name 26
//    node tools/pixelgen/cli.js list          (shows every generator and its options)
//
//  Any generator option can be passed as --<option> value (e.g. --weapon spear).
//  --count makes that many in a row from --seed (seed, seed+1, ...).
//  --scale enlarges with hard pixel edges (for looking at, not for the game).
// =============================================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PixelGen = require('./pixelgen.js');

// ---------------------------------------------------------------- PNG encoder
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function scaleRGBA(w, h, rgba, s) {
  if (s <= 1) return rgba;
  const out = new Uint8ClampedArray(w * s * h * s * 4);
  for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) {
    const si = ((Math.floor(y / s) * w) + Math.floor(x / s)) * 4, di = (y * w * s + x) * 4;
    out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
  }
  return out;
}

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const kind = argv[0];
const args = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2), v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  if (k === 'opt') { const [ok, ov] = v.split('='); args[ok] = ov; } else args[k] = v;
}

if (!kind || kind === 'list' || kind === 'help' || kind === '--help') {
  console.log('Generators (node tools/pixelgen/cli.js <kind> [--option value]):\n');
  for (const [k, g] of Object.entries(PixelGen.GENERATORS)) {
    console.log(`  ${k.padEnd(9)} ${g.label} (${g.size})`);
    for (const [ok, vals] of Object.entries(g.options)) console.log(`            --${ok.padEnd(8)} ${vals.join(' | ')}`);
  }
  console.log(`\n  common    --seed N  --count N  --faction ${Object.keys(PixelGen.FACTIONS).join(' | ')}`);
  console.log('            --scale N  --out DIR (default tools/pixelgen/out)  --name NAME');
  process.exit(0);
}

const seed = parseInt(args.seed || '1', 10);
const count = parseInt(args.count || '1', 10);
const scale = parseInt(args.scale || '1', 10);
const outDir = args.out || path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const opts = Object.assign({}, args);
for (const k of ['seed', 'count', 'scale', 'out', 'name']) delete opts[k];

for (let i = 0; i < count; i++) {
  const s = seed + i;
  const res = PixelGen.generate(kind, Object.assign({}, opts, { seed: s }));
  const { w, h } = res.img;
  const png = encodePNG(w * scale, h * scale, scaleRGBA(w, h, res.img.toRGBA(), scale));
  const base = args.name ? (count > 1 ? `${parseInt(args.name, 10) + i || args.name + '-' + i}` : args.name)
    : `${res.name}-${opts.faction || 'neutral'}-${s}`;
  const file = path.join(outDir, base + '.png');
  fs.writeFileSync(file, png);
  console.log(`${file}  (${w}x${h}${scale > 1 ? ' x' + scale : ''})`);
}
