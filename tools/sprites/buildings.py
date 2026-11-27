#!/usr/bin/env python3
"""Import the free building packs into one atlas for the map and battle towns.

    python3 tools/sprites/buildings.py <folder with the unpacked packs>

Writes assets/buildings/atlas.png and assets/buildings/catalog.json:
{ style: { size: [ {x, y, w, h, src} ... ] } } where style is a region's building style
(castle, village, igloo, treehut, forge, tower, stilthut, spire, adobe) and size 0 village,
1 town, 2 capital, 3 shrine. The game recolours each region's buildings to its own tone
and to the palette (js/art.js). Each picture is cropped to the building and stands on its
bottom row; large ones are halved.

Sources (thank you!):
  Devs in Exile    https://devs-in-exile.itch.io/medieval-buildings-pixel-art-pack (free)
  Pixel-Deck       https://jedimeisterx.itch.io/tiny-top-down-village-58-cute-80x80-pixel-buildings
                   (free for games, modify and recolour allowed; not to be resold or redistributed unchanged)
  MutterPixel Studio https://mutterpixel-studio.itch.io/ruined-village-buildings-pixel-art-assets
                   (free for games, may be edited; raw files not to be shared outside a project)
  Landmarks: Tamal (dead tree), FrakAssets (crystal, CC BY 4.0), SdavGha (pyramid; AI-assisted, cleaned by hand)
"""
import sys, os, glob, json, re
from PIL import Image

DEVS = 'devs-in-exile-medieval-buildings-pixel-art-pack/x/medieval-buildings-pixel-art-pack/medieval-buildings-pixel-art-pack ({}).png'
PD = 'jedimeisterx-tiny-top-down-village-58-cute-80x80-pixel-buildings/x/Tiny Top-Down Village/{}.png'
RUIN = 'mutterpixel-studio-ruined-village-buildings-pixel-art-assets/x/Ruined Village Buildings – Pixel Art Assets/spr_old_building_{}.png'
d = lambda *n: [DEVS.format(i) for i in n]
p = lambda *n: [PD.format(i) for i in n]
r = lambda *n: [RUIN.format(i) for i in n]

# style: [villages, towns, capitals, shrines]
PICKS = {
    'castle':   [d(1, 14, 17, 33, 76, 122), d(2, 6, 29, 30, 77, 78, 110), d(40, 91, 92, 93, 148), d(66, 104, 13)],
    'village':  [p('Farmers House', 'Small Wooden Cottage', 'Mill House', 'Florists House', 'Beekeepers Hut', 'Bakery'),
                 p('Tavern', 'Merchant House', 'Town House', 'General Store', 'Noble House', 'Guard House'),
                 p('Town Hall', 'Mansion', 'Mayors Residence'), p('Church', 'Temple Building')],
    'igloo':    [d(36, 120, 79, 96), d(37, 106, 80, 136), d(116, 150, 105), d(48, 31)],
    'treehut':  [p('Hunters Cabin', 'Lumberjack House', 'Wizard Hut', 'Herbalist House'),
                 p('Carpenters House', 'Stable', 'Storage House', 'Watchmakers House'), p('Adventurers Guild', 'Library'), p('Observatory')],
    'forge':    [d(8, 12, 34, 61, 107), d(55, 124, 137, 34), d(124, 130, 72), d(95)],
    'tower':    [r(1, 2, 3, 5, 6, 7), r(4, 5, 1), p('Abandoned Tower') + d(95, 48), p('Abandoned House', 'Abandoned House 2')],
    'stilthut': [p('Fishermans Hut', 'Beekeepers Hut', 'Potters House'), p('Brewers House', 'Cheese Makers House', 'Butcher Shop'),
                 d(69, 133), p('Fortune Tellers Tent')],
    'spire':    [d(19, 41, 23), d(41, 94, 112, 47), d(98, 94, 145), d(147, 23)],
    'adobe':    [d(25, 125, 141, 85, 64), d(19, 68, 112), d(68, 143, 98), d(74, 75)],
}

# region landmarks drawn from the packs (the rest keep their own drawings: volcano, dead tree...)
LANDMARKS = {'castle': DEVS.format(149), 'icepeak': DEVS.format(116), 'ruins': RUIN.format(4), 'shrine': DEVS.format(75),
             # from the second round of free packs (in the gap folder)
             'deadtree': 'GAP:tamal--dead-tree-pixel-art-128x128/x/upload_19356030/Dead Tree 2/Sprite1.png',
             'crystal': 'GAP:frakassets--free-glowing-crystal/x/free_glowing_crystal_frakassets/crystal_5_64x64_12f_20d.png@64',
             'pyramid': 'GAP:sdavgha--pixel-worlds-desert-egypt-props/x/Pixel_Worlds_Desert_Egypt_Props/Egypt/eg5_01_small_pyramid_1x.png'}

def crop(im):
    a = im.getchannel('A').point(lambda v: 255 if v > 40 else 0)
    b = a.getbbox()
    return im.crop(b) if b else im

def half(im):
    w, h = max(1, im.width // 2), max(1, im.height // 2)
    out = im.resize((w, h), Image.BOX)
    out.putalpha(im.getchannel('A').point(lambda v: 255 if v > 40 else 0).resize((w, h), Image.BOX).point(lambda v: 255 if v >= 128 else 0))
    return out

def main(root, out, gap=''):
    os.makedirs(out, exist_ok=True)
    pics, cat = [], {}
    for style, sizes in PICKS.items():
        cat[style] = {}
        for size, files in enumerate(sizes):
            cat[style][size] = []
            for f in files:
                path = os.path.join(root, f)
                if not os.path.exists(path): print('missing', f); continue
                im = crop(Image.open(path).convert('RGBA'))
                if im.width > 90 or im.height > 76: im = crop(half(im))
                pics.append((style, size, im, os.path.basename(f)))
    for kind, f in LANDMARKS.items():
        fw = None
        if '@' in f: f, fw = f.split('@'); fw = int(fw)
        path = os.path.join(gap, f[4:]) if f.startswith('GAP:') else os.path.join(root, f)
        if not os.path.exists(path): print('missing landmark', kind); continue
        im = Image.open(path).convert('RGBA')
        if fw: im = im.crop((0, 0, fw, im.height))                      # the first frame of a strip
        if kind == 'pyramid': im = half(im)
        im = crop(im)
        pics.append(('_landmarks', kind, im, os.path.basename(f)))
    cat['_landmarks'] = {k: [] for k in LANDMARKS}
    for style, size, im, src, *_ in pics:
        if style == '_landmarks': pass
    # pack into rows
    W = 1024; x = y = rowh = 0; places = []
    for style, size, im, src in pics:
        if x + im.width + 1 > W: x = 0; y += rowh + 1; rowh = 0
        places.append((style, size, im, src, x, y)); x += im.width + 1; rowh = max(rowh, im.height)
    atlas = Image.new('RGBA', (W, y + rowh))
    for style, size, im, src, x, y in places:
        atlas.paste(im, (x, y))
        # the Devs in Exile buildings are drawn small (about 35 px): the game shows them at 2x
        cat[style][size].append({'x': x, 'y': y, 'w': im.width, 'h': im.height, 'src': src, 'k': 2 if src.startswith('medieval-buildings') else 1})
    atlas.save(os.path.join(out, 'atlas.png'), optimize=True)
    json.dump(cat, open(os.path.join(out, 'catalog.json'), 'w'), indent=1)
    print(len(pics), 'buildings,', atlas.size)

if __name__ == '__main__':
    # usage: buildings.py <building packs> [<gap packs>]
    main(sys.argv[1], os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'buildings'), sys.argv[2] if len(sys.argv) > 2 else '')
