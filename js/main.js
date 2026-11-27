// =============================================================================
//  MAIN: starts the game, runs the frame loop, and wires up the controls.
// =============================================================================
(async function main() {
  const canvas = $('#view');
  const ctx = canvas.getContext('2d');
  const mini = $('#minimap');

  // Wait for the pixel font and all images before drawing anything.
  try { await document.fonts.load('8px PixelFont'); } catch (e) {}
  await Assets.load();
  if (typeof Chars !== 'undefined') await Chars.load();   // animated characters from the free sprite packs
  // effects, tiles and the older sprites from image files: into the palette too
  if (typeof Palette !== 'undefined') for (const [k, im] of Object.entries(Assets.img)) {
    if (!/^(fx|tile|c\d|m\d)/.test(k) || !im || !im.width) continue;
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    c.getContext('2d').drawImage(im, 0, 0);
    Assets.img[k] = Object.assign(Palette.canvas(c), { fw: im.fw, fh: im.fh, pad: im.pad, rows: im.rows });
  }
  MapView.init();
  if (typeof Gen !== 'undefined') Gen.warm();          // make the generated sprites in the background

  // Keep the canvas sized to its box, in real device pixels (crisp on high-DPI screens).
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---- map: drag to scroll, wheel / pinch to zoom, click a town ----
  MapView.attach(canvas,
    id => { if (Game.mode === 'map') Game.clickSpot(id); },
    id => { if (Game.mode === 'map') Game.ui.hover = id; },
    () => Game.mode !== 'battle');
  BattleUI.attach(canvas);
  // battle minimap: click or drag to look there
  const bmini = $('#bminimap');
  const bjump = e => { const b = Game.battle; if (!b) return; const r = bmini.getBoundingClientRect();
    b.cam.x = (e.clientX - r.left) / r.width * b.W; b.cam.y = (e.clientY - r.top) / r.height * b.H; };
  let bdrag = false;
  bmini.addEventListener('pointerdown', e => { bdrag = true; bjump(e); try { bmini.setPointerCapture(e.pointerId); } catch (err) {} });
  bmini.addEventListener('pointermove', e => { if (bdrag) bjump(e); });
  bmini.addEventListener('pointerup', () => { bdrag = false; });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && Game.mode === 'map' && !Game.busy) Game.clearSelection();
    if ((e.key === '+' || e.key === '=') && Game.mode === 'map') MapView.zoomAt(1.25, canvas.width / 2, canvas.height / 2);
    if ((e.key === '-' || e.key === '_') && Game.mode === 'map') MapView.zoomAt(0.8, canvas.width / 2, canvas.height / 2);
  });

  // ---- minimap: click or drag to jump there ----
  const jump = e => {
    const r = mini.getBoundingClientRect();
    MapView.centerOn((e.clientX - r.left) / r.width * MapView.W, (e.clientY - r.top) / r.height * MapView.H);
  };
  let miniDrag = false;
  mini.addEventListener('pointerdown', e => { miniDrag = true; jump(e); try { mini.setPointerCapture(e.pointerId); } catch (err) {} });
  mini.addEventListener('pointermove', e => { if (miniDrag) jump(e); });
  mini.addEventListener('pointerup', () => { miniDrag = false; });
  $('#zoom-in').onclick = () => MapView.zoomAt(1.25, canvas.width / 2, canvas.height / 2);
  $('#zoom-out').onclick = () => MapView.zoomAt(0.8, canvas.width / 2, canvas.height / 2);
  $('#zoom-home').onclick = () => Game.centerOnHome();

  // ---- top bar buttons ----
  $('#end-turn').onclick = () => Game.endTurn();
  $('#btn-save').onclick = () => Game.log(Game.save() ? 'Game saved.' : 'Could not save in this browser.', 'muted');
  $('#btn-sound').onclick = () => { $('#btn-sound').textContent = Assets.toggleMute() ? 'Sound off' : 'Sound on'; };
  $('#btn-sound').textContent = Assets.muted ? 'Sound off' : 'Sound on';
  $('#btn-help').onclick = () => modal($('#help-text').innerHTML, [['Got it', null]]);

  Game.showTitle();

  // ---- frame loop ----
  let last = performance.now(), hudT = 0, miniT = 0;
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));   // never negative: the first frame can be stamped before the loop began
    last = now;
    if (Game.mode === 'battle' && Game.battle) {
      const b = Game.battle;
      const steps = Game.battleSpeed;                 // run the simulation several times per frame to speed up
      for (let i = 0; i < steps && !b.done; i++) b.update(dt);
      BattleUI.scrollKeys(dt);
      b.render(ctx, canvas);
      hudT -= dt;
      if (hudT <= 0) { Game.updateBattleHud(); b.drawMinimap(bmini); hudT = 0.15; }
      if (b.done && !b.notified) { b.notified = true; Game.updateBattleHud(); b.onDone(); }
    } else {
      const title = Game.mode === 'title';
      MapView.fitAll = title;
      const view = title ? { spots: Object.fromEntries(Object.entries(DATA.spots).map(([k, s]) => [k, { owner: s.owner }])),
        generalsAt: () => [], player: null } : Game;
      MapView.render(ctx, canvas, view, title ? { targets: {} } : Game.ui, dt);
      miniT -= dt;
      if (miniT <= 0 && !title) { MapView.drawMinimap(mini, Game); miniT = 0.1; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
