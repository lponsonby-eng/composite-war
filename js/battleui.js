// =============================================================================
//  BATTLE UI: commanding your squads in battle.
//    Click a squad to select it (Shift adds), drag a box to select several.
//    Right-click the ground to move there in formation, right-click an enemy
//    to attack it. Right-drag draws a front line: the selection spreads along it
//    (the drag's length sets how wide each squad stands) and faces across it, to
//    the left of the drag direction. Click a squad's banner to select it.
//    On touch screens, tap the ground to move. Middle-drag scrolls.
//    Space pauses; Z / X / C cast the selected hero's skills; 1-9 pick squads.
//    Arrow keys / WASD scroll, the wheel zooms, the minimap jumps.
// =============================================================================
const BattleUI = {
  b: null,           // the battle being shown
  aiming: null,      // { q, id } while choosing where a ground skill lands

  start(battle) {
    this.b = battle; this.aiming = null; this._skillsHtml = null;
    this.buildHud();
  },

  // ------------------------------------------------------------------ input
  attach(canvas) {
    const dev = e => { const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
    const on = () => Game.mode === 'battle' && this.b && !this.b.done;
    let down = null; const pts = new Map(); let pinch = null;
    canvas.addEventListener('contextmenu', e => { if (on()) e.preventDefault(); });
    canvas.addEventListener('pointerdown', e => {
      if (!on()) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      pts.set(e.pointerId, dev(e));
      if (pts.size === 2) { const [a, c] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - c[0], a[1] - c[1]), z: this.b.cam.z, mid: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], cam: { ...this.b.cam } }; down = null; return; }
      const touch = e.pointerType === 'touch';
      down = { p: dev(e), btn: e.button, touch, shift: e.shiftKey, cam: { ...this.b.cam }, moved: false,
        form: e.button === 2 && !touch && this.b.sel.size > 0 && !this.aiming };    // right-drag with a selection: draw a formation
    });
    canvas.addEventListener('pointermove', e => {
      if (!on()) return;
      const p = dev(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      const b = this.b;
      if (e.pointerType !== 'touch') b.hover = b.toWorld(...p);
      if (pinch && pts.size === 2) {               // two fingers: pan and zoom
        const [a, c] = [...pts.values()], d = Math.hypot(a[0] - c[0], a[1] - c[1]), mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        b.cam.z = clamp(pinch.z * d / pinch.d, 0.4, 4);
        b.cam.x = pinch.cam.x - (mid[0] - pinch.mid[0]) / b.scale; b.cam.y = pinch.cam.y - (mid[1] - pinch.mid[1]) / b.scale;
        return;
      }
      if (!down) return;
      if (Math.hypot(p[0] - down.p[0], p[1] - down.p[1]) > 8) down.moved = true;
      if (!down.moved) return;
      if (down.btn === 0 && !down.touch) {            // left drag: selection box
        const [x0, y0] = b.toWorld(...down.p), [x1, y1] = b.toWorld(...p);
        b.box = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
      } else if (down.form) {                          // right drag: lay out a front line
        this.formLine(b.toWorld(...down.p), b.toWorld(...p));
      } else {                                         // right/middle drag, or a finger: scroll
        b.cam.x = down.cam.x - (p[0] - down.p[0]) / b.scale; b.cam.y = down.cam.y - (p[1] - down.p[1]) / b.scale;
      }
    });
    const up = e => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (!on() || !down) { down = null; return; }
      const b = this.b, [wx, wy] = b.toWorld(...dev(e));
      if (down.form && b.ghost) {                      // a front line was drawn: march to it
        const g = b.ghost[0].face, line = b.ghostLine;
        b.orderMove([...b.sel], (line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2, b.formation, g, Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]));
        b.ghost = null; b.ghostLine = null;
        Assets.sfx('menu-1', 0.3);
      } else if (b.box) {
        const inBox = u => u.x >= b.box.x0 && u.x <= b.box.x1 && u.y >= b.box.y0 && u.y <= b.box.y1;
        if (!down.shift) b.sel.clear();
        for (const q of this.mine()) if ([q.leader, ...q.members].some(u => u.alive && inBox(u))) b.sel.add(q);
        b.box = null;
      } else if ((!down.moved || down.form) && e.type === 'pointerup') this.click(wx, wy, down, dev(e));   // (a too-short line is a click)
      b.ghost = null; b.ghostLine = null;
      down = null;
      this.refresh();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { if (this.b) this.b.hover = null; });
    canvas.addEventListener('wheel', e => {
      if (!on()) return;
      e.preventDefault();
      this.b.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, ...dev(e));
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (!on() || e.target.closest?.('input,textarea')) return;
      const k = e.key.toLowerCase(), b = this.b;
      if (k === ' ') { e.preventDefault(); this.togglePause(); }
      else if (k === 'escape') { if (this.aiming) this.aiming = null; else b.sel.clear(); this.refresh(); }
      else if ('zxcvb'.includes(k) && k.length === 1) { const q = this.focus(); if (q) this.useSkill(q, q.skills['zxcvb'.indexOf(k)]); }
      else if (k >= '1' && k <= '9') { const q = this.mine()[+k - 1]; if (q) { if (!e.shiftKey) b.sel.clear(); b.sel.add(q); if (e.ctrlKey || e.metaKey) this.centre(q); this.refresh(); } }
      else if (k === 'q' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); }
      else if (k === 'e') { b.sel = new Set(this.mine()); this.refresh(); }
      else if (k === 'f' && this.focus()) this.centre(this.focus());
    });
  },

  // Keys held down scroll the battle camera.
  scrollKeys(dt) {
    const b = this.b, keys = MapView.keys;
    if (!b || !keys) return;
    const sp = 620 * dt / b.cam.z;
    if (keys.has('arrowleft') || keys.has('a')) b.cam.x -= sp;
    if (keys.has('arrowright') || keys.has('d')) b.cam.x += sp;
    if (keys.has('arrowup') || keys.has('w')) b.cam.y -= sp;
    if (keys.has('arrowdown') || keys.has('s')) b.cam.y += sp;
  },

  mine() { const b = this.b; return b.squads.filter(q => q.side === b.playerSide && q.leader.alive); },
  focus() { return [...this.b.sel].find(q => q.leader.alive) || null; },
  centre(q) { this.b.cam.x = q.leader.x; this.b.cam.y = q.leader.y; },

  squadAt(wx, wy, side) {
    let best = null, bd = 16;
    for (const u of this.b.units) {
      if (!u.alive || u.escaped || u.routing || (side != null && u.side !== side) || !this.b.seenByPlayer(u)) continue;
      const d = Math.hypot(u.x - wx, u.y - 9 - wy);
      if (d < bd) { bd = d; best = u.sq; }
    }
    return best;
  },

  // Preview of a front line dragged from a to b (world points). Facing is across the
  // line, to the left of the drag direction; a very short drag is just a click.
  formLine(a, c) {
    const b = this.b, dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 24) { b.ghost = null; b.ghostLine = null; return; }
    const face = [dy / len, -dx / len];
    b.ghostLine = [a, c];
    b.ghost = b.planFormation([...b.sel], (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, b.formation, face, len);
  },

  // A click (or tap) on the battlefield.
  click(wx, wy, down, px) {
    const b = this.b, me = b.playerSide;
    const flag = px && !this.aiming && b.bannerAt(...px);           // squad banners are easy targets from far away
    if (flag && !(down.btn === 2 && flag.side === me)) {
      if (down.btn === 2 || (down.touch && flag.side !== me && b.sel.size)) {
        if (flag.side !== me) { b.orderAttack([...b.sel], flag.leader); Assets.sfx('menu-2', 0.3); }
        return;
      }
      if (flag.side === me) {
        if (down.shift) { if (b.sel.has(flag)) b.sel.delete(flag); else b.sel.add(flag); }
        else { b.sel.clear(); b.sel.add(flag); }
        Assets.sfx('menu-1', 0.25);
      }
      return;
    }
    if (this.aiming) {                                  // placing a ground skill
      const { q, id } = this.aiming; this.aiming = null;
      if (down.btn === 0) b.cast(q, id, wx, wy);
      return;
    }
    const own = this.squadAt(wx, wy, me), foe = this.squadAt(wx, wy, 1 - me);
    const command = down.btn === 2 || (down.touch && !own && b.sel.size);
    if (command) {
      if (foe) { b.orderAttack([...b.sel], foe.leader); Assets.sfx('menu-2', 0.3); }
      else if (b.sel.size) { b.orderMove([...b.sel], wx, wy); Assets.sfx('menu-1', 0.3); }
      return;
    }
    if (own) {
      if (down.shift) { if (b.sel.has(own)) b.sel.delete(own); else b.sel.add(own); }
      else { b.sel.clear(); b.sel.add(own); }
      Assets.sfx('menu-1', 0.25);
    } else if (!down.shift) b.sel.clear();
  },

  useSkill(q, id) {
    const b = this.b;
    if (!id || !b.canCast(q, id)) return;
    if (b.sk(id).target !== 'self') { this.aiming = { q, id }; b.paused = b.paused; }
    else b.cast(q, id);
    this.refresh();
  },

  togglePause() { this.b.paused = !this.b.paused; this.refresh(); },

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const b = this.b;
    const side = s => {
      const f = b.factions[s];
      return `<div class="bh-side bh-${s}"><div class="bh-name" style="color:${DATA.factions[f].color}">${DATA.factions[f].name}</div>
        <div class="bh-gens" id="bh-gens-${s}"></div></div>`;
    };
    $('#battle-hud').innerHTML = `${side(0)}<div class="bh-mid"><div id="bh-time"></div>
      <div class="bh-where">${b.opts.spotName}<br><span class="bh-terr">${b.terrain.describe()}</span></div></div>${side(1)}`;
    $('#battle-ctrl').innerHTML = `<div class="bc-row">
        <button data-act="pause" class="bc-pause"></button>
        <button data-s="1">x1</button><button data-s="2">x2</button><button data-s="4">x4</button>
        <span class="sep"></span><span id="bc-sel" class="muted"></span>
        <button data-o="advance">Advance</button><button data-o="hold">Hold</button><button data-o="retreat">Retreat</button>
      </div>
      <div class="bc-row"><span class="muted">Formation</span>
        <button data-f="auto" title="Frontline in front, backline behind">Auto</button><button data-f="line">Line</button>
        <button data-f="column">Column</button><button data-f="wedge">Wedge</button>
        <span class="sep"></span><span id="bc-skills"></span>
      </div>
      <div class="bc-hint muted">Drag to select - right-click: move / attack - right-drag: draw a front line - Space pause - Z X C V B skills</div>`;
    const ctr = $('#battle-ctrl');
    ctr.querySelector('[data-act="pause"]').onclick = () => this.togglePause();
    ctr.querySelectorAll('[data-s]').forEach(bt => bt.onclick = () => { Game.battleSpeed = +bt.dataset.s; this.refresh(); });
    ctr.querySelectorAll('[data-o]').forEach(bt => bt.onclick = () => {
      const list = b.sel.size ? [...b.sel] : this.mine();
      b.orderSet(list, bt.dataset.o); this.refresh();
    });
    ctr.querySelectorAll('[data-f]').forEach(bt => bt.onclick = () => {
      b.formation = bt.dataset.f;
      if (b.sel.size) {                                 // regroup the selection in the new formation where it stands
        const c = centroid([...b.sel].map(q => q.leader)), [fx, fy] = [...b.sel][0].face;
        b.orderMove([...b.sel], c.x + fx * 30, c.y + fy * 30, b.formation);
      }
      this.refresh();
    });
    this.refresh();
  },

  refresh() {
    const b = this.b; if (!b) return;
    const ctr = $('#battle-ctrl');
    ctr.querySelector('[data-act="pause"]').textContent = b.paused ? 'Play' : 'Pause';
    ctr.querySelector('[data-act="pause"]').classList.toggle('on', b.paused);
    ctr.querySelectorAll('[data-s]').forEach(bt => bt.classList.toggle('on', Game.battleSpeed === +bt.dataset.s));
    ctr.querySelectorAll('[data-f]').forEach(bt => bt.classList.toggle('on', b.formation === bt.dataset.f));
    const sel = [...b.sel].filter(q => q.leader.alive);
    const orders = new Set(sel.map(q => q.order === 'move' ? 'hold' : q.order === 'attack' ? 'advance' : q.order));
    ctr.querySelectorAll('[data-o]').forEach(bt => bt.classList.toggle('on', orders.size === 1 && orders.has(bt.dataset.o)));
    $('#bc-sel').textContent = sel.length ? `${sel.length === 1 ? DATA.generals[sel[0].id].name : sel.length + ' squads'}:` : 'All squads:';
    const q = this.focus();
    const html = q ? q.skills.map((id, i) => {
      const S = b.sk(id), ready = b.canCast(q, id), cd = Math.max(0, Math.ceil((q.cd[id] || 0) - b.time));
      return `<button data-sk="${id}" ${ready ? '' : 'disabled'} class="${this.aiming && this.aiming.id === id ? 'on' : ''} ${S.sig ? 'sig' : ''}" title="${S.desc}${S.sig ? ' ' + DATA.sigText(S) : ` (${S.mp} MP)`} - key ${'ZXCVB'[i]}">${S.sig ? '&#9733;' : ''}${S.name} <small>${cd ? cd + 's' : S.mp + 'mp'}</small></button>`;
    }).join('') + ` <button data-auto class="${q.auto ? 'on' : ''}" title="Let this hero use skills by themself">Auto</button>`
      + (this.aiming ? ' <span class="good">Click where it should land</span>' : '') : '<span class="muted">Select a squad for its skills</span>';
    if (html === this._skillsHtml) return;                 // only rebuild when something changed (keeps clicks working)
    this._skillsHtml = html;
    $('#bc-skills').innerHTML = html;
    $('#bc-skills').querySelectorAll('[data-sk]').forEach(bt => bt.onclick = () => this.useSkill(q, bt.dataset.sk));
    const ab = $('#bc-skills').querySelector('[data-auto]'); if (ab) ab.onclick = () => { q.auto = !q.auto; this.refresh(); };
  },

  // Portraits along the top: HP, MP and troops; click one of yours to select it.
  updateHud() {
    const b = this.b; if (!b) return;
    for (const s of [0, 1]) {
      const el = $('#bh-gens-' + s);
      const html = b.sideInfo(s).map(x => `<div class="bh-gen ${x.alive ? '' : 'dead'} ${b.sel.has(x.q) ? 'sel' : ''}" data-q="${x.id}">
        <img src="${Assets.portrait(x.id)}" title="${DATA.generals[x.id].name} Lv ${Game.gens[x.id].level}"><div class="bh-bar"><i style="width:${x.hp * 100}%"></i></div>
        ${s === b.playerSide ? `<div class="bh-bar mp"><i style="width:${x.mp * 100}%"></i></div>` : ''}<div class="bh-bar mo ${x.state}" title="Morale: ${x.state}"><i style="width:${x.morale * 100}%"></i></div><span>${x.troops}</span><b class="bh-st ${x.state}">${x.alive ? { steady: 'Steady', wavering: 'Wavering', routing: 'Routing', lost: 'Broken' }[x.state] : 'Fallen'}</b></div>`).join('');
      if (el._html === html) continue;
      el._html = html; el.innerHTML = html;
      if (s === b.playerSide) el.querySelectorAll('[data-q]').forEach(d => {
        const q = b.squads.find(z => z.id === d.dataset.q);
        d.onclick = e => { if (!q.leader.alive) return; if (!e.shiftKey) b.sel.clear(); b.sel.add(q); this.refresh(); };
        d.ondblclick = () => this.centre(q);
      });
    }
    const left = Math.max(0, Math.ceil(b.limit - b.time));
    $('#bh-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (!this.aiming || !b.canCast(this.aiming.q, this.aiming.id)) { if (this.aiming && !b.canCast(this.aiming.q, this.aiming.id)) this.aiming = null; }
    this.refresh();
  },
};
