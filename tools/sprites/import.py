#!/usr/bin/env python3
"""Import free sprite packs into the game: one sheet per character in assets/sprites/,
plus assets/sprites/catalog.json.

    python3 tools/sprites/import.py <folder with the unpacked packs>

Each sheet has one row per animation (idle, run, attack, hurt, death) of equal frames,
facing right, trimmed to the character's own box with the feet on the same row in every
frame. Characters much taller than the game's figures are halved. Colours stay as the
artists made them: the game recolours them per faction and to its palette when loading.

Sources (thank you!):
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

def half(im):
    """Halve a picture, keeping hard pixel edges: colour by 2x2 average, alpha by majority."""
    w, h = im.width // 2, im.height // 2
    rgb = im.convert('RGBA').resize((w, h), Image.BOX)
    a = im.getchannel('A').point(lambda v: 255 if v > 40 else 0).resize((w, h), Image.BOX).point(lambda v: 255 if v >= 128 else 0)
    rgb.putalpha(a)
    return rgb

def main(root, out):
    os.makedirs(out, exist_ok=True)
    cat = {}
    for cid, (folder, scale, credit) in CHARS.items():
        anims = find_anims(os.path.join(root, folder))
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
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'sprites'))
