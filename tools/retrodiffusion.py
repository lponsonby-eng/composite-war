#!/usr/bin/env python3
"""Retro Diffusion API helper: pixel art from a text description, with a free price check first.

Your API key (starts with rdpk-) is read from (first match wins):
  1. the RD_API_KEY environment variable
  2. a file named .retrodiffusion_key in the project folder (git-ignored)
Create a key at https://www.retrodiffusion.ai/app/devtools. Never put it in js/ files.

Run:
  python3 tools/retrodiffusion.py balance
  python3 tools/retrodiffusion.py styles
  python3 tools/retrodiffusion.py image "knight in blue armour" assets/chars/26.png            # price only
  python3 tools/retrodiffusion.py image "knight in blue armour" assets/chars/26.png --yes      # really spend

`image` always runs the free price check first and spends nothing unless you add --yes.
Options for `image`:
  --style STYLE     default rd_fast__default ($0.03). rd_lite__default ($0.05) is better quality.
                    Others: rd_lite__fantasy, rd_lite__topdown, rd_lite__isometric, rd_fast__portrait,
                    rd_fast__game_asset, rd_fast__item_sheet ... (see `styles`)
  --size WxH        default 64x64 (price is flat per image, size does not change it)
  --transparent     remove the background
  --tile            seamless tiling in both directions
  --seed N          repeatable result

Full reference: https://www.retrodiffusion.ai/app/guide/api
"""
import argparse, base64, csv, datetime, json, os, sys, time, urllib.error, urllib.request, uuid
from pathlib import Path

API = 'https://api.retrodiffusion.ai/v2'
ROOT = Path(__file__).resolve().parent.parent
KEY_FILE = ROOT / '.retrodiffusion_key'
LOG = ROOT / 'tools' / 'generator-log.csv'


def api_key():
    key = os.environ.get('RD_API_KEY', '').strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
    if not key:
        sys.exit('No Retro Diffusion API key. Set RD_API_KEY or put the key in .retrodiffusion_key '
                 '(create one at https://www.retrodiffusion.ai/app/devtools).')
    return key


def call(method, path, body=None, idem=None):
    headers = {'X-RD-Token': api_key(), 'Content-Type': 'application/json', 'Accept': 'application/json'}
    if idem:
        headers['Idempotency-Key'] = idem
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'Retro Diffusion error {e.code}: {e.read().decode(errors="replace")[:1000]}')


def cmd_balance(_):
    print(json.dumps(call('GET', '/inferences/credits'), indent=2))


def cmd_styles(_):
    print(json.dumps(call('GET', '/styles/selector'), indent=2))


def cmd_image(a):
    w, h = (int(n) for n in a.size.lower().split('x'))
    body = {'prompt': a.description, 'prompt_style': a.style, 'width': w, 'height': h, 'num_images': 1}
    if a.transparent:
        body['remove_bg'] = True
    if a.tile:
        body['tile_x'] = body['tile_y'] = True
    if a.seed is not None:
        body['seed'] = a.seed
    est = call('POST', '/inferences', {**body, 'check_cost': True})
    print(f'Price: ${est.get("balance_cost")}   balance: ${est.get("remaining_balance")}')
    if not a.yes:
        print('Nothing spent. Add --yes to generate.')
        return
    task = call('POST', '/inferences', body, idem=str(uuid.uuid4()))
    tid = task['task_id']
    while True:
        t = call('GET', f'/inferences/tasks/{tid}')
        if t['status'] in ('pending', 'running', 'queued'):
            time.sleep(2)
            continue
        if t['status'] == 'failed':
            sys.exit(f'Generation failed (refunded): {t.get("error")}')
        res = t['result']
        break
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if res.get('base64_images'):
        out.write_bytes(base64.b64decode(res['base64_images'][0]))
    elif res.get('output_urls'):
        with urllib.request.urlopen(res['output_urls'][0], timeout=120) as r:
            out.write_bytes(r.read())
    else:
        sys.exit(f'No image in result: {json.dumps(res)[:500]}')
    print(f'Saved {out}  cost ${res.get("balance_cost")}  remaining ${res.get("remaining_balance")}')
    new = not LOG.exists()
    with LOG.open('a', newline='') as f:
        wr = csv.writer(f)
        if new:
            wr.writerow(['date', 'service', 'endpoint', 'prompt', 'size', 'file', 'usage'])
        wr.writerow([datetime.date.today().isoformat(), 'retrodiffusion', a.style, a.description,
                     f'{w}x{h}', str(out), json.dumps({'usd': res.get('balance_cost')})])


def main():
    p = argparse.ArgumentParser(description='Retro Diffusion pixel-art generator for Composite War')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('balance', help='show remaining balance').set_defaults(fn=cmd_balance)
    sub.add_parser('styles', help='list styles your account can use').set_defaults(fn=cmd_styles)
    i = sub.add_parser('image', help='price-check, and with --yes generate, one image')
    i.add_argument('description')
    i.add_argument('out')
    i.add_argument('--style', default='rd_fast__default')
    i.add_argument('--size', default='64x64')
    i.add_argument('--transparent', action='store_true')
    i.add_argument('--tile', action='store_true')
    i.add_argument('--seed', type=int)
    i.add_argument('--yes', action='store_true', help='actually spend balance')
    i.set_defaults(fn=cmd_image)
    a = p.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
