#!/usr/bin/env python3
"""Generates js/map.js: towns, roads, regions and landmarks for the big map.

Run:  python3 tools/genmap.py  [seed]

The output is plain data, so you can also hand-edit js/map.js afterwards
(move a town, rename it, add a road). Re-running this script overwrites it.
"""
import json, math, random, sys
from pathlib import Path

SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 7
rng = random.Random(SEED)
W, H = 1600, 960
MIN_DIST = 100           # spacing between towns

# 3 x 3 layout of regions. 'free' is the neutral heartland in the middle.
GRID = [['frost', 'darkwood', 'ember'],
        ['aster', 'free', 'shadow'],
        ['bog', 'azure', 'sun']]
OWNER = {'frost': 'frost', 'darkwood': 'thorn', 'ember': 'ember', 'aster': 'aster', 'free': 'neutral',
         'shadow': 'shadow', 'bog': 'horde', 'azure': 'azure', 'sun': 'sun'}
SEEDS = {}
for r, row in enumerate(GRID):
    for c, reg in enumerate(row):
        SEEDS[reg] = (270 + c * 530 + rng.uniform(-40, 40), 175 + r * 305 + rng.uniform(-30, 30))

# Battlefield types per region (weighted)
TERRAIN = {
    'frost': ['snow', 'snow', 'snow', 'forest', 'river'],
    'darkwood': ['forest', 'forest', 'forest', 'swamp'],
    'ember': ['lava', 'lava', 'plains', 'forest'],
    'aster': ['plains', 'plains', 'river', 'forest'],
    'free': ['plains', 'river', 'forest', 'plains', 'swamp'],
    'shadow': ['swamp', 'plains', 'forest', 'river'],
    'bog': ['swamp', 'swamp', 'swamp', 'forest'],
    'azure': ['crystal', 'river', 'river', 'crystal', 'plains'],
    'sun': ['dunes', 'dunes', 'dunes', 'plains'],
}

NAMES = {
    'frost': ['Frosthold', 'Rimeholm', 'Whitefang', 'Snowmere', 'Icewall', 'Coldharbor', 'Glacier Gate', 'Hailstead',
              'Winterwatch', 'Bleakpeak', 'Sleetby', 'Northvigil', 'Shiverstone'],
    'darkwood': ['Thornheart', 'Gloomroot', 'Briarwick', 'Nightbough', 'Hollowell', 'Mossgrave', 'Ravenbark', 'Darkholt',
                 'Witchwood', 'Owlsnest', 'Blackbriar', 'Fernshade', 'Wraithwood'],
    'ember': ['Emberkeep', 'Ashford', 'Cinderfall', 'Redpine', 'Magmaw', 'Smoulder', 'Pyre Hill', 'Kilnmouth',
              'Blazegate', 'Charwell', 'Scorchfield', 'Flintforge', 'Burnmark'],
    'aster': ['Asterhold', 'Brookfield', 'Westwatch', 'Goldmeadow', 'Lindale', 'Kingsbridge', 'Haverton', 'Oakbury',
              'Silverford', 'Fairhaven', 'Highcairn', 'Wheatley', 'Lanceford'],
    'free': ['Crossroads', 'Millcross', 'Pinewood', 'Old Shrine', 'Stonegate', 'Middlemarch', 'Freeport', 'Tollbridge',
             'Greenhollow', 'Market Hill', 'Wayrest', 'Heartstone', 'Sanctum', 'Fallowfield', 'Duskmeet'],
    'shadow': ['Nightspire', 'Gloomvale', 'Mistfen', 'Shroudmoor', 'Duskhollow', 'Veilgate', 'Grimward', 'Hushmere',
               'Wanlight', 'Cairnmoor', 'Sorrowdeep', 'Pallmarsh', 'Ghostlamp'],
    'bog': ['Bogmire', 'Mosshollow', 'Murkwater', 'Toadstool', 'Slimepit', 'Reedmarsh', 'Mudhaven', 'Croakwell',
            'Sporeholm', 'Fenwick', 'Quagby', 'Bramblebog', 'Leechford'],
    'azure': ['Crystalis', 'Tidewater', 'Pearlhaven', 'Shimmerlake', 'Coralport', 'Glasswater', 'Prism Isle', 'Wavecrest',
              'Saltspire', 'Bluefen', 'Mirrormere', 'Seafoam', 'Lumen Bay'],
    'sun': ['Sunscar', 'Dunerest', 'Sandreach', 'Oasis', 'Mirage', 'Dustmouth', 'Goldsand', 'Scorpion Well',
            'Sunspire', 'Drybone', 'Saffron Gate', 'Heatshimmer', 'Cactus Rock'],
}


def region_of(x, y):
    # nearest seed, with a gentle wobble so borders are not straight lines
    best, bd = None, 1e18
    for reg, (sx, sy) in SEEDS.items():
        d = math.hypot(x - sx, y - sy) + 28 * math.sin(x / 70 + sy / 50) + 22 * math.cos(y / 60 + sx / 40)
        if d < bd:
            best, bd = reg, d
    return best


# ---------------------------------------------------------------- 1. towns (Poisson disc)
pts = []
for reg, (sx, sy) in SEEDS.items():      # capitals first, at the region seeds
    pts.append([sx, sy])
tries = 0
while tries < 60000:
    tries += 1
    x, y = rng.uniform(55, W - 55), rng.uniform(60, H - 45)
    # soften the corners of the world so the continent is roundish
    if ((x - W / 2) / (W / 2 + 20)) ** 2 + ((y - H / 2) / (H / 2 + 50)) ** 2 > 1.04:
        continue
    if all(math.hypot(x - px, y - py) >= MIN_DIST for px, py in pts):
        pts.append([x, y])
pts = [[round(x), round(y)] for x, y in pts]
regions = [region_of(x, y) for x, y in pts]
for i, reg in enumerate(SEEDS):           # the seeds keep their own region
    regions[i] = reg

# ---------------------------------------------------------------- 2. roads (Gabriel graph, pruned)
n = len(pts)
edges = set()
for i in range(n):
    for j in range(i + 1, n):
        (ax, ay), (bx, by) = pts[i], pts[j]
        mx, my, r2 = (ax + bx) / 2, (ay + by) / 2, ((ax - bx) ** 2 + (ay - by) ** 2) / 4
        if math.hypot(ax - bx, ay - by) > 185:
            continue
        if all((pts[k][0] - mx) ** 2 + (pts[k][1] - my) ** 2 >= r2 for k in range(n) if k not in (i, j)):
            edges.add((i, j))

def length(e):
    (ax, ay), (bx, by) = pts[e[0]], pts[e[1]]
    return math.hypot(ax - bx, ay - by)

# Only a few roads between neighbouring regions, so each region has border passes.
cross = {}
for e in sorted(edges, key=length):
    a, b = regions[e[0]], regions[e[1]]
    if a != b:
        cross.setdefault(tuple(sorted((a, b))), []).append(e)
for pair, es in cross.items():
    keep = 3 if 'free' in pair else 2
    for e in es[keep:]:
        edges.discard(e)

# thin out: drop long roads between towns that still have plenty of others
for e in sorted(edges, key=length, reverse=True):
    deg = lambda i: sum(1 for x in edges if i in x)
    if length(e) > 105 and deg(e[0]) > 3 and deg(e[1]) > 3:
        edges.discard(e)

# keep everything connected
def components():
    parent = list(range(n))
    def f(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for a, b in edges:
        parent[f(a)] = f(b)
    return f
f = components()
while len({f(i) for i in range(n)}) > 1:
    best = min(((i, j) for i in range(n) for j in range(i + 1, n) if f(i) != f(j)), key=length)
    edges.add(best)
    f = components()

adj = {i: set() for i in range(n)}
for a, b in edges:
    adj[a].add(b); adj[b].add(a)

# ---------------------------------------------------------------- 3. kinds, owners, names
ids, spots = [], {}
used = {r: 0 for r in NAMES}
capital_of = {reg: i for i, reg in enumerate(SEEDS)}
owner_start = {}
for reg, cap in capital_of.items():
    if OWNER[reg] == 'neutral':
        continue
    # the faction starts with its capital and the 3 closest connected towns of its region
    near = sorted((j for j in range(n) if regions[j] == reg and j != cap),
                  key=lambda j: (0 if j in adj[cap] else 1, math.hypot(pts[j][0] - pts[cap][0], pts[j][1] - pts[cap][1])))
    for j in [cap] + near[:3]:
        owner_start[j] = OWNER[reg]

for i, (x, y) in enumerate(pts):
    reg = regions[i]
    name = NAMES[reg][used[reg] % len(NAMES[reg])]
    used[reg] += 1
    sid = name.lower().replace(' ', '')
    while sid in spots:
        sid += 'x'
    ids.append(sid)
    is_cap = capital_of.get(reg) == i
    if reg == 'free' and is_cap:
        kind = 'city'
    elif is_cap:
        kind = 'capital'
    else:
        kind = 'town' if rng.random() < 0.4 else 'village'
    if reg == 'free' and kind == 'village' and rng.random() < 0.25:
        kind = 'shrine'
    income = {'capital': 30, 'city': 30, 'town': 15, 'village': 10, 'shrine': 10}[kind]
    owner = owner_start.get(i, 'neutral')
    s = {'name': name, 'x': x, 'y': y, 'region': reg, 'kind': kind, 'income': income, 'owner': owner,
         'terrain': rng.choice(TERRAIN[reg])}
    if kind in ('capital', 'city') or (kind == 'town' and rng.random() < 0.3):
        s['walls'] = True
    if owner == 'neutral':
        s['garrison'] = {'capital': 8, 'city': 8, 'town': 6, 'village': 4, 'shrine': 5}[kind]
    spots[sid] = s

links = sorted([sorted([ids[a], ids[b]]) for a, b in edges])

# ---------------------------------------------------------------- 4. landmarks
# Each region's landmark goes where it is furthest from towns and roads.
def dist_seg(px, py, a, b):
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - (ax + dx * t), py - (ay + dy * t))

# Each faction's landmark stands beside its capital (its power covers the capital; see
# DATA.landmarkPower), on the side away from other regions' towns and clear of towns and
# roads. The Heartlands landmark has no capital and goes where it is furthest from towns.
BOX = {'aster': (50, 84), 'frost': (55, 73), 'darkwood': (38, 88), 'ember': (53, 73), 'shadow': (42, 52),
       'bog': (43, 69), 'azure': (41, 81), 'sun': (52, 87), 'free': (42, 41)}   # half width, height (drawn 1.4x)
landmarks = {}
for reg, (sx, sy) in SEEDS.items():
    cap = next((s for s in spots.values() if s['region'] == reg and s['kind'] == 'capital'), None)
    hw, ht = BOX.get(reg, (45, 80))
    best, bd = None, None
    if cap:
        for r in range(50, 175, 3):
            for k in range(72):
                a = k / 72 * 2 * math.pi
                gx, gy = cap['x'] + math.cos(a) * r, cap['y'] + math.sin(a) * r * 0.85
                if not (hw + 20 < gx < W - hw - 20 and ht + 14 < gy < H - 30):
                    continue
                def ov(t):     # overlap of the landmark with a town's building, banner, generals and name
                    top = 108 if t['kind'] in ('capital', 'city') else 88
                    ox = (hw + 30) - abs(gx - t['x']); oy = min((gy + 6) - (t['y'] - top), (t['y'] + 34) - (gy - ht))
                    return ox * oy if ox > 0 and oy > 0 else 0
                ovs = [ov(t) for t in spots.values()]
                if max(ovs) > 900 or ov(cap) > 300:
                    continue
                dr = min(dist_seg(gx, gy - 20, pts[a_], pts[b_]) for a_, b_ in edges)
                if dr < 14:
                    continue
                foreign = min((math.hypot(gx - t['x'], gy - t['y']) for t in spots.values() if t['region'] != reg), default=400)
                score = -sum(ovs) * 0.04 + min(dr, 50) * 0.3 - math.hypot(gx - cap['x'], gy - cap['y']) * 0.6 + min(foreign, 260) * 0.3
                if bd is None or score > bd:
                    best, bd = (round(gx), round(gy)), score
    if best is None:
        bd = -1
        for gx in range(int(sx - 240), int(sx + 240), 10):
            for gy in range(int(sy - 150), int(sy + 150), 10):
                if not (70 < gx < W - 70 and 80 < gy < H - 50) or region_of(gx, gy) != reg:
                    continue
                if ((gx - W / 2) / (W / 2 - 40)) ** 2 + ((gy - H / 2) / (H / 2 - 20)) ** 2 > 0.95:
                    continue
                d = min(math.hypot(gx - x, gy - y) for x, y in pts)
                d = min(d, min(dist_seg(gx, gy, pts[a], pts[b]) + 15 for a, b in edges))
                d -= 0.08 * math.hypot(gx - sx, gy - sy)          # prefer near the middle of the region
                if d > bd:
                    best, bd = (gx, gy), d
    landmarks[reg] = {'x': best[0], 'y': best[1]}

out = {'width': W, 'height': H, 'landmarks': landmarks, 'spots': spots, 'links': links}
js = ('// =============================================================================\n'
      '//  MAP: generated by tools/genmap.py (seed %d). Safe to hand-edit.\n'
      '//  spots: towns. region picks the look; terrain/walls pick the battlefield;\n'
      '//  owner is who holds it at the start; garrison = militia in a free town.\n'
      '//  links: roads. landmarks: where each region\'s landmark is drawn.\n'
      '// =============================================================================\n'
      'window.MAP = ' % SEED) + json.dumps(out, indent=1) + ';\n'
Path(__file__).resolve().parent.parent.joinpath('js', 'map.js').write_text(js)
from collections import Counter
print('towns', n, 'roads', len(links), dict(Counter(regions)))
print('owned', Counter(owner_start.values()))
print('max degree', max(len(v) for v in adj.values()), 'avg', round(2 * len(edges) / n, 2))
