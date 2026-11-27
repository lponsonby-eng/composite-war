"""Shared helpers for importing free sprite packs: find animation strips, cut frames."""
import glob, os, re
from PIL import Image

ANIM_KEYS = {
    'idle': ['idle', 'combat idle', 'idle_open', 'flight', 'fly'],
    'run': ['run', 'walk', 'move', 'moving', 'flight', 'fly'],
    'attack': ['attack1', 'attack', 'attack_1', 'attack_bite', 'attack2'],
    'hurt': ['take hit', 'take_hit', 'hit', 'get hit', 'hurt'],
    'death': ['death', 'rat-death', 'dead'],
}

def frame_width(im, h):
    """Width of one frame in a horizontal strip. Count the separate figures (runs of opaque
    columns), then take the frame count that divides the width and is nearest to it; a
    square frame wins when it divides evenly and agrees."""
    w = im.width
    a = im.getchannel('A').point(lambda v: 255 if v > 40 else 0)
    col = [a.crop((x, 0, x + 1, h)).getbbox() is not None for x in range(w)]
    runs, on, gap = 0, False, 99
    for c in col:
        if c and not on and gap >= 3: runs += 1
        if c: on, gap = True, 0
        else: on = False; gap += 1
    divs = [n for n in range(1, 41) if w % n == 0 and w // n >= 16]
    if not divs: return w
    if w % h == 0: return h                               # square frames: the packs' usual layout
    n = min(divs, key=lambda n: (abs(n - runs), -n))
    return w // n

def frames_of(path):
    im = Image.open(path).convert('RGBA')
    h = im.height
    f = frame_width(im, h)
    return [im.crop((i * f, 0, i * f + f, h)) for i in range(im.width // f)]

def folder_frames(folder):
    fs = sorted(glob.glob(os.path.join(folder, '*.png')), key=lambda p: int(re.findall(r'(\d+)\.png$', p)[0]) if re.findall(r'(\d+)\.png$', p) else 0)
    return [Image.open(p).convert('RGBA') for p in fs]

def bbox_union(frames):
    box = None
    for fr in frames:
        b = fr.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
        if not b: continue
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box

def find_anims(char_dir):
    """{anim: [frames]} for a character folder (strips named Idle.png... or folders of frames)."""
    out = {}
    files = {os.path.splitext(os.path.basename(p))[0].lower(): p for p in glob.glob(os.path.join(char_dir, '*.png'))}
    dirs = {os.path.basename(p).lower(): p for p in glob.glob(os.path.join(char_dir, '*')) if os.path.isdir(p)}
    for anim, keys in ANIM_KEYS.items():
        for k in keys:
            hit = next((p for name, p in files.items() if name == k or re.sub(r'^[a-z]+-[0-9]+-|^[a-z0-9-]+?-(?=(idle|run|walk|attack|hurt|death|hit))', '', name) == k), None)
            if hit: out[anim] = frames_of(hit); break
            hit = dirs.get(k)
            if hit: out[anim] = folder_frames(hit); break
    return out
