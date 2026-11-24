// =============================================================================
//  MAIN: starts the game, runs the frame loop, handles mouse input.
// =============================================================================
(async function main() {
  const canvas = $('#view');
  const ctx = canvas.getContext('2d');

  // Wait for the pixel font and all images before drawing anything.
  try { await document.fonts.load('8px PixelFont'); } catch (e) {}
  await Assets.load();
  MapView.init();

  // Keep the canvas sized to its box, in real device pixels (crisp on high-DPI screens).
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---- mouse / touch on the map ----
  const worldPos = e => {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    return MapView.toWorld((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  };
  canvas.addEventListener('pointermove', e => {
    if (Game.mode !== 'map') return;
    const [x, y] = worldPos(e);
    Game.ui.hover = MapView.spotAt(x, y);
    canvas.style.cursor = Game.ui.hover ? 'pointer' : 'default';
  });
  canvas.addEventListener('click', e => {
    if (Game.mode !== 'map') return;
    const [x, y] = worldPos(e);
    Game.clickSpot(MapView.spotAt(x, y));
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && Game.mode === 'map' && !Game.busy) Game.clearSelection();
  });

  // ---- top bar buttons ----
  $('#end-turn').onclick = () => Game.endTurn();
  $('#btn-save').onclick = () => Game.log(Game.save() ? 'Game saved.' : 'Could not save in this browser.', 'muted');
  $('#btn-sound').onclick = () => { $('#btn-sound').textContent = Assets.toggleMute() ? 'Sound off' : 'Sound on'; };
  $('#btn-sound').textContent = Assets.muted ? 'Sound off' : 'Sound on';
  $('#btn-help').onclick = () => modal($('#help-text').innerHTML, [['Got it', null]]);

  Game.showTitle();

  // ---- frame loop ----
  let last = performance.now(), hudT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (Game.mode === 'battle' && Game.battle) {
      const b = Game.battle;
      const steps = Game.battleSpeed;                 // run the simulation several times per frame to speed up
      for (let i = 0; i < steps && !b.done; i++) b.update(dt);
      b.render(ctx, canvas);
      hudT -= dt;
      if (hudT <= 0) { Game.updateBattleHud(); hudT = 0.15; }
      if (b.done && !b.notified) { b.notified = true; Game.updateBattleHud(); b.onDone(); }
    } else if (Game.mode === 'map' || Game.mode === 'over') {
      MapView.render(ctx, canvas, Game, Game.ui, dt);
    } else {
      MapView.render(ctx, canvas, { spots: Object.fromEntries(Object.entries(DATA.spots).map(([k, s]) => [k, { owner: s.owner }])),
        generalsAt: () => [], player: null }, { targets: {} }, dt);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
