#!/usr/bin/env python3
"""PixelLab API helper: make pixel art for the game from a text description.

Your API key is read from (first match wins):
  1. the PIXELLAB_API_KEY environment variable
  2. a file named .pixellab_key in the project folder (one line, the key only)
Both are kept out of git (.pixellab_key is in .gitignore). Never put the key in js/ files:
the game runs in the browser, so anyone playing it could read it.

Run:
  python3 tools/pixellab.py balance
  python3 tools/pixellab.py image "a knight in blue armour, facing right" assets/chars/new.png
  python3 tools/pixellab.py image "snowy pine tree" assets/tiles/pine.png --size 64x64 --transparent

Options for `image`:
  --size WxH          16..400 each side (default 64x64)
  --transparent       remove the background (transparent up to 200x200 of area)
  --view VIEW         side | low top-down | high top-down
  --direction DIR     north, north-east, east, south-east, south, south-west, west, north-west
  --outline STYLE     single color black outline | single color outline | selective outline | lineless
  --shading STYLE     flat shading | basic shading | medium shading | detailed shading | highly detailed shading
  --detail STYLE      low detail | medium detail | highly detailed
  --seed N            repeatable result

Each `image` call spends one generation (or credits) from your PixelLab account.
API reference: https://api.pixellab.ai/v2/docs  (all endpoints: https://www.pixellab.ai/llms.txt)
"""
import argparse, base64, csv, datetime, json, os, sys, urllib.error, urllib.request
from pathlib import Path

API = 'https://api.pixellab.ai/v2'
ROOT = Path(__file__).resolve().parent.parent
KEY_FILE = ROOT / '.pixellab_key'
LOG = ROOT / 'tools' / 'generator-log.csv'


def api_key():
    key = os.environ.get('PIXELLAB_API_KEY', '').strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
    if not key:
        sys.exit('No PixelLab API key. Set PIXELLAB_API_KEY or put the key in .pixellab_key '
                 '(get one at https://www.pixellab.ai/account).')
    return key


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        'Authorization': 'Bearer ' + api_key(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'PixelLab error {e.code}: {e.read().decode(errors="replace")[:1000]}')


def save_image(img, out):
    b64 = img['base64']
    if b64.startswith('data:'):
        b64 = b64.split(',', 1)[1]
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64))
    return out


def cmd_balance(_):
    print(json.dumps(call('GET', '/balance'), indent=2))


def cmd_image(a):
    w, h = (int(n) for n in a.size.lower().split('x'))
    body = {'description': a.description, 'image_size': {'width': w, 'height': h},
            'no_background': a.transparent}
    for k in ('view', 'direction', 'outline', 'shading', 'detail', 'seed'):
        v = getattr(a, k)
        if v is not None:
            body[k] = v
    res = call('POST', '/create-image-pixflux', body)
    out = save_image(res['image'], a.out)
    print(f'Saved {out}  ({w}x{h})  usage: {res.get("usage")}')
    log('pixellab', 'create-image-pixflux', a.description, f'{w}x{h}', out, res.get('usage'))


def log(service, endpoint, prompt, size, out, usage):
    new = not LOG.exists()
    with LOG.open('a', newline='') as f:
        w = csv.writer(f)
        if new:
            w.writerow(['date', 'service', 'endpoint', 'prompt', 'size', 'file', 'usage'])
        w.writerow([datetime.date.today().isoformat(), service, endpoint, prompt, size,
                    str(Path(out).resolve().relative_to(ROOT)) if Path(out).resolve().is_relative_to(ROOT) else out,
                    json.dumps(usage)])


def main():
    p = argparse.ArgumentParser(description='PixelLab pixel-art generator for Composite War')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('balance', help='show remaining generations / credits').set_defaults(fn=cmd_balance)
    i = sub.add_parser('image', help='generate one image from a description')
    i.add_argument('description')
    i.add_argument('out', help='where to save the PNG, e.g. assets/chars/26.png')
    i.add_argument('--size', default='64x64')
    i.add_argument('--transparent', action='store_true')
    i.add_argument('--view')
    i.add_argument('--direction')
    i.add_argument('--outline')
    i.add_argument('--shading')
    i.add_argument('--detail')
    i.add_argument('--seed', type=int)
    i.set_defaults(fn=cmd_image)
    a = p.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
