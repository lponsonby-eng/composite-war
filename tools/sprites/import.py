#!/usr/bin/env python3
"""Import free sprite packs into the game: one sheet per character in assets/sprites/,
plus assets/sprites/catalog.json.

    python3 tools/sprites/import.py <folder with the unpacked packs>

Each sheet has one row per animation (idle, run, attack, hurt, death) of equal frames,
facing right, trimmed to the character's own box with the feet on the same row in every
frame. Characters much taller than the game's figures are halved. Colours stay as the
artists made them: the game recolours them per faction and to its palette when loading.

Sources (thank you!) - more in assets/sprites/CREDITS.md:
  LuizMelo   https://luizmelo.itch.io   CC0 (public domain)
  Sven Thole https://sventhole.itch.io  free for any game, commercial or not (not for resale as assets)
"""
import sys, os, json, glob, re
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from scan import find_anims, bbox_union, frames_of

LM, SV = ('LuizMelo', 'https://luizmelo.itch.io', 'CC0'), ('Sven Thole', 'https://sventhole.itch.io', 'free for any game; no resale as an asset')
# id: (folder under the packs root, scale, credit)
CHARS = {
    # heroes and generals
    'sven_knight':     ('sven-hero-knight/x/Hero Knight/Sprites/HeroKnight', 1, SV),
    'lm_hero_knight':  ('luizmelo-hero-knight/x/Hero Knight/Sprites', 1, LM),
    'lm_hero_knight2': ('luizmelo-hero-knight-2/x/Hero Knight 2/Sprites', 1, LM),
    'lm_fantasy_warrior': ('luizmelo-fantasy-warrior/x/Fantasy Warrior/Sprites', 1, LM),
    'lm_martial_hero': ('luizmelo-martial-hero/x/Martial Hero/Sprites', 1, LM),
    'lm_martial_hero2': ('luizmelo-martial-hero-2/x/Martial Hero 2/Sprites', 1, LM),
    'lm_martial_hero3': ('luizmelo-martial-hero-3/x/Martial Hero 3/Sprite', 1, LM),
    'lm_king':         ('luizmelo-medieval-king-pack/x/Medieval King Pack', 0.5, LM),
    'lm_king2':        ('luizmelo-medieval-king-pack-2/x/Medieval King Pack 2/Sprites', 1, LM),
    'lm_warrior':      ('luizmelo-medieval-warrior-pack/x/Medieval Warrior Pack', 0.5, LM),
    'lm_warrior2':     ('luizmelo-medieval-warrior-pack-2/x/Medieval Warrior Pack 2/Sprites', 1, LM),
    'lm_warrior3':     ('luizmelo-medieval-warrior-pack-3/x/Medieval Warrior Pack 3/Sprites', 1, LM),
    'lm_huntress':     ('luizmelo-huntress/x/Huntress/Sprites', 1, LM),
    'lm_huntress2':    ('luizmelo-huntress-2/x/Huntress 2/Sprites/Character', 1, LM),
    'lm_evil_wizard':  ('luizmelo-evil-wizard/x/Evil Wizard/Sprites', 1, LM),
    'lm_evil_wizard2': ('luizmelo-evil-wizard-2/x/EVil Wizard 2/Sprites', 0.5, LM),
    'lm_evil_wizard3': ('luizmelo-evil-wizard-3/x/Evil Wizard 3/Sprites', 1, LM),
    'lm_wizard':       ('luizmelo-wizard-pack/x/Wizard Pack', 0.5, LM),
    'sv_bandit_heavy': ('sventhole-bandits/x/Bandits/Sprites/Heavy Bandit', 1, SV),
    'sv_bandit_light': ('sventhole-bandits/x/Bandits/Sprites/Light Bandit', 1, SV),
    # monsters
    'lm_skeleton':     ('luizmelo-monsters-creatures-fantasy/x/Monsters_Creatures_Fantasy/Skeleton', 1, LM),
    'lm_goblin':       ('luizmelo-monsters-creatures-fantasy/x/Monsters_Creatures_Fantasy/Goblin', 1, LM),
    'lm_mushroom':     ('luizmelo-monsters-creatures-fantasy/x/Monsters_Creatures_Fantasy/Mushroom', 1, LM),
    'lm_flying_eye':   ('luizmelo-monsters-creatures-fantasy/x/Monsters_Creatures_Fantasy/Flying eye', 1, LM),
    'lm_bat':          ('luizmelo-monsters-creatures-fantasy-2/x/Monsters Creatures Fantasy 2/Bat', 1, LM),
    'lm_rat':          ('luizmelo-monsters-creatures-fantasy-2/x/Monsters Creatures Fantasy 2/Rat', 1, LM),
    'lm_slime':        ('luizmelo-monsters-creatures-fantasy-2/x/Monsters Creatures Fantasy 2/Slime', 1, LM),
    'lm_fire_worm':    ('luizmelo-fire-worm/x/Fire Worm/Sprites/Worm', 1, LM),
}
# single still pictures (no animation: the game bobs them as they move)
STILLS = {
    'sv_wraith':       ('sventhole-wraith-48x48/x/wraith.png', SV),
    'sv_flame_demon':  ('sventhole-flame-demons-64-x64/x/FlameDemon.png', SV),
    'sv_flame_demon2': ('sventhole-flame-demons-64-x64/x/FlameDemon Evolved.png', SV),
    'sv_berserker':    ('sventhole-khorneberzerker/x/chaosBerserker.png', SV),
}
ORDER = ['idle', 'run', 'attack', 'hurt', 'death']

# ---- packs laid out their own way: each loader returns {anim: [frames]} (facing right)
def grid(path, fw, fh, n=None, row=None):
    im = Image.open(path).convert('RGBA'); cols, rows = im.width // fw, im.height // fh
    cells = [(c, r) for r in range(rows) for c in range(cols)] if row is None else [(c, row) for c in range(cols)]
    out = [im.crop((c * fw, r * fh, c * fw + fw, r * fh + fh)) for c, r in cells]
    out = [f for f in out if f.getchannel('A').getbbox()]
    return out[:n] if n else out
def flip(frames): return [f.transpose(Image.FLIP_LEFT_RIGHT) for f in frames]
def over(a, b): return [Image.alpha_composite(x, y) for x, y in zip(a, b)]
def strip(path, fw): im = Image.open(path).convert('RGBA'); return [im.crop((i * fw, 0, i * fw + fw, im.height)) for i in range(im.width // fw)]
def folder(path): return [Image.open(p).convert('RGBA') for p in sorted(glob.glob(os.path.join(path, '*.png')))]
def down(frames, k):
    return [f.resize((f.width // k, f.height // k), Image.NEAREST) for f in frames]

def ad_rider(root):                     # Admurin: horse and rider drawn separately on the same 64 px grid (facing left)
    H = root + '/admurin--pixel-character-horse-rider/x/PixelHorse_V1.0/Horse I/Horse Black/64x64_Atlas_Horse_{}.png'
    R = root + '/admurin--pixel-character-horse-rider/x/PixelHorse_V1.0/Rider/Rider Complete/64x64_Atlas_HorseRider_Mount{}.png'
    a = lambda k: flip(over(grid(H.format(k), 64, 64), grid(R.format(k), 64, 64)))
    return {'idle': a('Idle'), 'run': a('Run'), 'attack': a('Raise'), 'hurt': a('Stop'), 'death': a('Stop')[-1:]}
def ot_camel(root):                     # Othur: 128 px, a row per direction (row 14 faces right)
    W = root + '/othur--camel-rider-sprite-128x128/x/128x128_{}-loop.png'
    w = [half(f) for f in grid(W.format('walk'), 128, 128, row=14)]
    r = [half(f) for f in grid(W.format('run'), 128, 128, row=14)]
    return {'idle': w[:1], 'run': w, 'attack': r, 'hurt': w[:1]}
def pr_yeti(root):
    Y = root + '/pixelrazastudio--yeti-asset-pack/x/YETI ASSET PACK(FREE)/Yeti-{}.png'
    g = lambda k, fw: [half(f) for f in strip(Y.format(k), fw)]
    return {'idle': g('Idle-192x192', 192), 'run': g('walk-278x192', 278), 'attack': g('attack-1-256x192', 256), 'hurt': g('damage-192x192', 192), 'death': g('dead-192x192', 192)}
def bestiary(name, sz):
    def f(root):
        B = root + '/michelclauwaertgmailcom--pixel-bestiary-beasts-animated-side-view-monsters-free/x/PixelBestiaryBeasts/'
        pick = lambda k: next(iter(sorted(glob.glob(B + f'*/{name}_{k}_{sz}_*.png'))), None)
        out = {}
        for anim, keys in [('idle', ['idle']), ('run', ['run', 'walk', 'fly', 'slither']), ('attack', ['attack', 'maul']), ('hurt', ['hurt']), ('death', ['death'])]:
            for k in keys:
                p = pick(k)
                if p: out[anim] = strip(p, sz); break
        return out
    return f
def tw_beast(name):
    def f(root):
        B = glob.glob(root + f'/twizzydoesntcode--free-pixel-art-{name}-*/x/{name.title()}')[0]
        g = lambda k: [half(half(x)) for x in folder(os.path.join(B, k, 'frames'))]
        idle = g('idle')
        return {'idle': idle, 'run': idle, 'attack': g('attack'), 'death': g('death')}
    return f
def el_crab(root):                      # Elthen: 4 x 4 of 32 px; rows idle, walk, attack, death
    rows = [grid(root + '/elthen--2d-pixel-art-crab-sprites/x/upload_3764527.png', 32, 32, row=r) for r in range(4)]
    up = lambda fr: [f.resize((f.width * 2, f.height * 2), Image.NEAREST) for f in fr]   # a small crab: shown at 2x as a giant one
    return {'idle': up(rows[0]), 'run': up(rows[1]), 'attack': up(rows[2]), 'death': up(rows[3])}
def pg_beetle(root):
    fr = [half(f) for f in folder(root + '/pinogames--beetle-soldier-pixel-art-pack/x/Beetle Soldier idle.png')]
    return {'idle': fr, 'run': fr, 'attack': fr}
def pd_cannon(root):                    # Pedro: one strip of 62 px, the shot and its smoke
    fr = strip(root + '/pedrogn--pixelart-cannon/x/Cannon/cannon-Sheet.png', 62)
    return {'idle': fr[:1], 'run': fr[:1], 'attack': fr}
def np_catapult(root):                  # nicolaspla77: drawn at 16 px per pixel
    im = Image.open(root + '/nicolaspla77--catapult/x/upload_11167877.png').convert('RGBA')
    fr = [im.resize((64, 64), Image.NEAREST)]
    return {'idle': fr, 'run': fr, 'attack': fr}
GAP = ('gap',)
CUSTOM = {
    'ad_rider': (ad_rider, ('Admurin', 'https://admurin.itch.io/pixel-character-horse-rider', 'free for projects; not for resale as an asset')),
    'ot_camel': (ot_camel, ('Othur', 'https://othur.itch.io/camel-rider-sprite-128x128', 'free, commercial use allowed')),
    'pr_yeti': (pr_yeti, ('PixelRaza Studio', 'https://pixelrazastudio.itch.io/yeti-asset-pack', 'free to use, commercial projects')),
    'pb_dire_bear': (bestiary('dire_bear', 64), ('Michel Clauwaert', 'https://michelclauwaertgmailcom.itch.io/pixel-bestiary-beasts-animated-side-view-monsters-free', 'use in games; no standalone redistribution')),
    'pb_hawk': (bestiary('hawk', 32), ('Michel Clauwaert', 'https://michelclauwaertgmailcom.itch.io/pixel-bestiary-beasts-animated-side-view-monsters-free', 'use in games; no standalone redistribution')),
    'pb_wolf': (bestiary('alpha_wolf', 64), ('Michel Clauwaert', 'https://michelclauwaertgmailcom.itch.io/pixel-bestiary-beasts-animated-side-view-monsters-free', 'use in games; no standalone redistribution')),
    'pb_scorpion': (bestiary('scorpion', 32), ('Michel Clauwaert', 'https://michelclauwaertgmailcom.itch.io/pixel-bestiary-beasts-animated-side-view-monsters-free', 'use in games; no standalone redistribution')),
    'tw_boar': (tw_beast('boar'), ('twizzydoesntcode', 'https://twizzydoesntcode.itch.io/free-pixel-art-boar-idle-attack-death', 'CC0')),
    'el_crab': (el_crab, ('Elthen', 'https://elthen.itch.io/2d-pixel-art-crab-sprites', 'free for commercial and non-commercial projects')),
    'pg_beetle': (pg_beetle, ('Pino Games', 'https://pinogames.itch.io/beetle-soldier-pixel-art-pack', 'free asset')),
    'pd_cannon': (pd_cannon, ('PedroGN', 'https://pedrogn.itch.io/pixelart-cannon', 'free asset')),
    'np_catapult': (np_catapult, ('nicolaspla77', 'https://nicolaspla77.itch.io/catapult', 'free asset')),
}

def half(im):
    """Halve a picture, keeping hard pixel edges: colour by 2x2 average, alpha by majority."""
    w, h = im.width // 2, im.height // 2
    rgb = im.convert('RGBA').resize((w, h), Image.BOX)
    a = im.getchannel('A').point(lambda v: 255 if v > 40 else 0).resize((w, h), Image.BOX).point(lambda v: 255 if v >= 128 else 0)
    rgb.putalpha(a)
    return rgb

def main(root, out, gap=None):
    os.makedirs(out, exist_ok=True)
    cat = {}
    jobs = [(cid, (lambda f=f: find_anims(os.path.join(root, f))), scale, credit) for cid, (f, scale, credit) in CHARS.items()]
    if gap: jobs += [(cid, (lambda fn=fn: fn(gap)), 1, credit) for cid, (fn, credit) in CUSTOM.items()]
    for cid, load, scale, credit in jobs:
        try: anims = load()
        except Exception as e: print('FAILED', cid, e); continue
        folder = cid
        if not anims: print('MISSING', cid, folder); continue
        if 'idle' not in anims: anims['idle'] = anims.get('run')[:1]
        if 'run' not in anims: anims['run'] = anims['idle']
        if 'attack' not in anims: anims['attack'] = anims['idle']
        if scale != 1: anims = {k: [half(f) for f in v] for k, v in anims.items()}
        allf = [f for k in ORDER if k in anims for f in anims[k]]
        x0, y0, x1, y1 = bbox_union(allf)
        stand = bbox_union(anims['idle'] + anims['run'])        # feet: the bottom of the standing frames
        pad = 1
        fw, fh = x1 - x0 + pad * 2, y1 - y0 + pad * 2
        rows = [k for k in ORDER if k in anims]
        n = max(len(anims[k]) for k in rows)
        sheet = Image.new('RGBA', (fw * n, fh * len(rows)))
        meta = {'w': fw, 'h': fh, 'feet': stand[3] - y0 + pad - 1, 'anims': {}, 'height': stand[3] - stand[1],
                'credit': credit[0], 'source': credit[1], 'license': credit[2]}
        for r, k in enumerate(rows):
            for i, f in enumerate(anims[k]):
                sheet.paste(f.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad)), (i * fw, r * fh))
            meta['anims'][k] = {'row': r, 'n': len(anims[k])}
        sheet.save(os.path.join(out, cid + '.png'), optimize=True)
        cat[cid] = meta
        print(f'{cid:20s} {fw}x{fh} feet {meta["feet"]} height {meta["height"]} {[(k, len(anims[k])) for k in rows]}')
    for cid, (path, credit) in STILLS.items():
        im = Image.open(os.path.join(root, path)).convert('RGBA')
        b = im.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
        im = im.crop((b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1))
        im.save(os.path.join(out, cid + '.png'), optimize=True)
        cat[cid] = {'w': im.width, 'h': im.height, 'feet': im.height - 2, 'height': b[3] - b[1], 'still': True,
                    'anims': {k: {'row': 0, 'n': 1} for k in ORDER}, 'credit': credit[0], 'source': credit[1], 'license': credit[2]}
        print(f'{cid:20s} still {im.width}x{im.height}')
    json.dump(cat, open(os.path.join(out, 'catalog.json'), 'w'), indent=1)

if __name__ == '__main__':
    # usage: import.py <character packs> [<gap packs>]
    main(sys.argv[1], os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'sprites'), sys.argv[2] if len(sys.argv) > 2 else None)
