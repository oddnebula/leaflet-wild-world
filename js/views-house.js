// House editor: in-game style rooms, both furniture layers, decor, roof, upgrades, lights, loan, K.K. songs.
(function () {
  'use strict';
  const { h, hex, fmt, row, card, section, numberInput, selectInput, switchInput, slot, sfx, say, toast, item, itemEmoji, itemLabel, pickItem, confirmSheet } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  // K.K. songs played from the ROM's own sequences: song i is 176 + i on a stereo (aircheck) and 99 + i live.
  let songBase = 176, nowPlaying = null;
  function songButton(i) {
    if (i >= 70 || !window.GameSound || !GameSound.ready()) return null;
    const b = h('button', { class: 'song-play' + (nowPlaying && nowPlaying.i === i ? ' on' : ''), title: 'Listen' }, nowPlaying && nowPlaying.i === i ? '■' : '▶');
    b.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      if (nowPlaying && nowPlaying.i === i) { nowPlaying.stop(); return; }
      if (nowPlaying) nowPlaying.stop();
      document.querySelectorAll('.song-play.on').forEach(x => { x.classList.remove('on'); x.textContent = '▶'; });
      const r = GameSound.playMusic(songBase + i, { onEnd: () => { b.classList.remove('on'); b.textContent = '▶'; if (nowPlaying && nowPlaying.i === i) nowPlaying = null; } });
      if (!r) { sfx.error(); UI.toast('That song couldn’t be played', '🎸'); return; }
      nowPlaying = { i, stop: r.stop }; b.classList.add('on'); b.textContent = '■';
    };
    return b;
  }
  const HOUSE = 0xE558, ROOM = 0x450, LOAN = 0xFAE8, SONGS = 0xFAEC, STATE = 0xFAF8;
  const ROOMS = ['Main room', 'Back room', 'East room', 'West room', 'Upstairs'];
  const ROOM_EMOJI = ['🛋️', '🚪', '➡️', '⬅️', '🪜'];
  // Loan for each house size, from the game's own table (data_020cb560 in the decompilation).
  const SIZES = [['Small house', 19800], ['Medium house', 120000], ['Large house', 298000], ['Upstairs added', 598000], ['West room added', 728000], ['East room added', 848000], ['Back room added (mansion)', 948000]];
  // Which size unlocks each room, and roughly how big its floor is (the main room grows 4×4 → 6×6 → 8×8).
  const UNLOCK = [0, 6, 5, 4, 3];
  const roomSize = (r, size) => r === 0 ? [4, 6, 8, 8, 8, 8, 8][size] : r === 4 ? 8 : 6;
  const range = n => [...Array(n).keys()];

  // House state: one u32 bitfield (decompilation struct Unk_0206022c_Bits).
  const FIELDS = { size: [0, 3], target: [3, 3], roof: [6, 4], roofNext: [10, 4], roofAfter: [14, 4], lights: [18, 6], counter: [24, 8] };
  const getF = (s, f) => (s.u32(STATE) >>> FIELDS[f][0]) & ((1 << FIELDS[f][1]) - 1);
  const setF = (s, f, v) => { const [sh, w] = FIELDS[f], m = ((1 << w) - 1) << sh; s.set32(STATE, ((s.u32(STATE) & ~m) | ((v << sh) & m)) >>> 0); };
  const ROOF_RGB = ['#e05a4f', '#f0954a', '#f2cf4a', '#a9d86e', '#4fb366', '#7cc6ea', '#4a7fd6', '#9a6fd1', '#f29ac0', '#3a3a44', '#f4f2ec', '#9c6b45'];
  window.WW_HOUSE = { getF, setF, SIZES };

  let room = 0, showOutside = false, show3d = false;

  function editSpot(s, r, x, y, refresh) {
    const k = y * 16 + x, o1 = r + k * 2, o2 = r + 0x200 + k * 2;
    const root = document.getElementById('popover-root');
    const close = () => { root.replaceChildren(); refresh(); };
    const rot = o => { const id = s.u16(o); if (id >= 0x3000 && id < 0x5000) { s.set16(o, (id & 0xFFFC) | ((id + 1) & 3)); sfx.click(); close(); } };
    root.replaceChildren(h('div', { class: 'scrim', onclick: close }), h('div', { class: 'sheet', style: { width: 'min(420px, calc(100vw - 32px))', top: '18vh' } },
      h('div', { class: 'sheet-head' }, h('div', { class: 'top' }, h('h3', null, `Spot ${x}, ${y}`), h('button', { class: 'btn', onclick: close }, 'Done'))),
      h('div', { class: 'sheet-body', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '14px' } },
        h('div', null, h('div', { class: 'muted', style: { fontWeight: 700, fontSize: '12px', marginBottom: '6px' } }, 'ON THE FLOOR'),
          slot(() => s.u16(o1), v => s.set16(o1, v), { title: 'Place on the floor' }),
          h('button', { class: 'btn small', style: { marginTop: '6px' }, onclick: () => rot(o1) }, '↻ Rotate')),
        h('div', null, h('div', { class: 'muted', style: { fontWeight: 700, fontSize: '12px', marginBottom: '6px' } }, 'ON TOP (TABLES, DRESSERS)'),
          slot(() => s.u16(o2), v => s.set16(o2, v), { title: 'Place on top' }),
          h('button', { class: 'btn small', style: { marginTop: '6px' }, onclick: () => rot(o2) }, '↻ Rotate')))));
  }

  // ---------- moving a piece with its whole footprint ----------
  // A piece's own tile holds its id; the other tiles it covers hold 0xF031 ("part of a larger piece"). Items on top ride
  // along, and so does its switch (a lamp left on stays on). Footprints come from the ROM's furniture info.
  const OCC = 0xF031, EMPTY = 0xFFF1, isFtr = id => id >= 0x3000 && id < 0x5000, at = (x, y) => y * 16 + x;
  const cellsOf = (id, x, y) => window.Room3D.footprint(id).map(([dx, dy]) => [x + dx, y + dy]);
  const exact = () => !!(window.ROM && ROM.ready && ROM.file('ftr_info/always.bin'));
  // Which piece covers each tile: at(x, y) -> its anchor [x, y].
  function owners(s, r) {
    const own = new Map();
    for (let k = 0; k < 256; k++) { const id = s.u16(r + k * 2); if (isFtr(id)) for (const [x, y] of cellsOf(id, k & 15, k >> 4)) if (x >= 0 && y >= 0 && x < 16 && y < 16) own.set(at(x, y), [k & 15, k >> 4]); }
    return own;
  }
  function fits(s, r, area, from, to, nid) {
    const mine = from ? new Set(cellsOf(s.u16(r + at(...from) * 2), ...from).map(c => at(...c))) : new Set();
    return cellsOf(nid, ...to).every(([x, y]) => x >= area.x && y >= area.y && x < area.x + area.w && y < area.y + area.h && (mine.has(at(x, y)) || s.u16(r + at(x, y) * 2) === EMPTY));
  }
  // Moves (or with copy, copies) the piece anchored at `from` to `to`, optionally as a new id (turning it). False if it
  // doesn't fit there.
  function movePiece(s, r, area, from, to, newId, copy) {
    const fk = at(...from), id = s.u16(r + fk * 2); if (!isFtr(id)) return false;
    const nid = newId ?? id, old = cellsOf(id, ...from).filter(([x, y]) => x >= 0 && y >= 0 && x < 16 && y < 16);
    if (!fits(s, r, area, copy ? null : from, to, nid)) return false;
    const tops = old.map(c => s.u16(r + 0x200 + at(...c) * 2)), sw = s.bit(r + 0x400, fk);
    if (!copy) for (const c of old) { const k = at(...c); if (k === fk || s.u16(r + k * 2) === OCC) s.set16(r + k * 2, EMPTY); s.set16(r + 0x200 + k * 2, EMPTY); }
    cellsOf(nid, ...to).forEach((c, i) => { s.set16(r + at(...c) * 2, i ? OCC : nid); if (!copy) s.set16(r + 0x200 + at(...c) * 2, tops[i] ?? EMPTY); });
    if (!copy && fk !== at(...to)) { s.setBit(r + 0x400, at(...to), sw); s.setBit(r + 0x400, fk, true); }
    return true;
  }
  function removePiece(s, r, from) {
    const id = s.u16(r + at(...from) * 2); if (!isFtr(id)) return;
    for (const c of cellsOf(id, ...from)) { const k = at(...c); if (k < 0 || k > 255) continue; if (k === at(...from) || s.u16(r + k * 2) === OCC) s.set16(r + k * 2, EMPTY); s.set16(r + 0x200 + k * 2, EMPTY); }
  }
  const turned = id => (id & 0xFFFC) | ((id + 1) & 3);

  // The room in 3D with the game's own furniture, wallpaper and flooring from the player's ROM (js/room3d.js). Drag a
  // piece to move it (it snaps to the floor tiles, green where it fits), click one to pick it, then click a free spot,
  // use the arrow keys, R to turn it or Delete to put it away. Dragging anywhere else turns the room.
  const view3 = { angle: 0, pitch: 0.75 };
  let sel = null, refocus = false;
  function view3d(s, r, area, refresh, title) {
    const need = msg => h('div', { class: 'room3d-empty' }, h('span', { class: 'em' }, '🪑'), msg);
    if (!window.ROM || !ROM.ready) return need('Open your Wild World ROM on the Welcome screen to see this room in 3D with the game’s own furniture.');
    const TILE = window.Room3D.TILE;
    const build = () => window.Room3D.scene({ area, wall: s.u16(r + 0x448), floor: s.u16(r + 0x44A), items: (x, y, L) => s.u16(r + L * 0x200 + at(x, y) * 2) });
    const sc = build();
    if (!sc) return need('Your saved game art is from an older Leaflet. Open the ROM again on the Welcome screen to add the furniture models.');
    if (sel && !isFtr(s.u16(r + at(...sel) * 2))) sel = null;
    // Flat coloured tiles just above the floor: the picked piece, and where a dragged one would land.
    const mark = (cells, rgb) => cells.map(([x, y]) => {
      const x0 = x * TILE - 0.08, x1 = (x + 1) * TILE + 0.08, z0 = y * TILE - 0.08, z1 = (y + 1) * TILE + 0.08, v = (px, pz) => [px, 0.05, pz, 0, 0, ...rgb];
      return { verts: [v(x0, z1), v(x1, z1), v(x1, z0), v(x0, z1), v(x1, z0), v(x0, z0)], tex: null, tw: 1, th: 1 };
    });
    const marks = ghost => [
      ...(sel ? mark(cellsOf(s.u16(r + at(...sel) * 2), ...sel), [1, 0.84, 0.3]) : []),
      ...(ghost ? mark(cellsOf(ghost.id, ...ghost.to), ghost.ok ? [0.45, 0.85, 0.45] : [0.95, 0.45, 0.4]) : []),
    ];
    let own = owners(s, r);
    const floorTile = e => { const p = cv.pick(e.clientX, e.clientY, 0); return p && [Math.floor(p[0] / TILE), Math.floor(p[1] / TILE)]; };
    // Under the pointer: the piece whose top or side is there (trying heights from the top down), else the floor tile.
    function hit(e) {
      for (const hy of [4, 3, 2.2, 1.4, 0.7]) {
        const p = cv.pick(e.clientX, e.clientY, hy); if (!p) continue;
        const tx = Math.floor(p[0] / TILE), ty = Math.floor(p[1] / TILE), o = own.get(at(tx, ty));
        if (o && window.Room3D.height(s.u16(r + at(...o) * 2)) * TILE / 2 >= hy - 0.4) return { tile: [tx, ty], owner: o };
      }
      const t = floorTile(e); return t ? { tile: t, owner: own.get(at(...t)) || null } : null;
    }
    // Each move, turn or put-away is its own undo step.
    const commit = (ok, msg) => { if (ok) { s.sealStep(); sfx.bell(); refocus = true; refresh(); } else { sfx.error(); toast(msg || 'It doesn’t fit there', '🪑'); } };
    const moveSel = to => { if (!sel || (to[0] === sel[0] && to[1] === sel[1])) return; const ok = movePiece(s, r, area, sel, to); if (ok) sel = to; commit(ok); };
    const cv = window.Model3D.viewer(sc.groups.concat(marks()), {
      size: Math.min(620, Math.max(320, (document.getElementById('content')?.clientWidth || 700) - 80)), spin: false, zoom: 1.55, view: view3,
      frame: { min: [area.x * TILE, 0, area.y * TILE], max: [(area.x + area.w) * TILE, window.Room3D.WALL_H, (area.y + area.h) * TILE] },
      grab: e => {
        cv.focus();
        const k = hit(e); if (!k || !k.owner) return null;
        sel = k.owner; const id = s.u16(r + at(...sel) * 2), off = [k.tile[0] - sel[0], k.tile[1] - sel[1]];
        cv.update(sc.groups.concat(marks())); showPick();
        let to = sel;
        return {
          move(ev) { const t = floorTile(ev); if (!t) return; const nt = [t[0] - off[0], t[1] - off[1]]; if (nt[0] === to[0] && nt[1] === to[1]) return; to = nt; cv.update(sc.groups.concat(marks({ id, to, ok: fits(s, r, area, sel, to, id) }))); },
          up(ev, still) { if (still) { sfx.pop(); showPick(); return; } if (to[0] === sel[0] && to[1] === sel[1]) { cv.update(sc.groups.concat(marks())); return; } moveSel(to); if (!fits(s, r, area, sel, sel, id)) cv.update(sc.groups.concat(marks())); },
        };
      },
      click: e => { const k = hit(e); if (sel && k && !k.owner) moveSel(k.tile); else if (sel) { sel = null; cv.update(sc.groups.concat(marks())); showPick(); } },
    });
    if (!cv) return need('3D needs WebGL, which this browser has turned off.');
    cv.tabIndex = 0; cv.classList.add('room3d-canvas');
    const label = () => sel ? `Picked: ${item(s.u16(r + at(...sel) * 2)).name} · drag it, click a free spot, arrow keys to nudge, R to turn, Delete to put away` : 'Drag a piece to move it · click one to pick it · drag the floor to look around';
    const info = h('div', { class: 'muted room3d-info' }, label());
    const turnBtn = h('button', { class: 'btn small', disabled: !sel, onclick: () => turn() }, '↻ Turn'), awayBtn = h('button', { class: 'btn small', disabled: !sel, onclick: () => remove() }, '🗑 Put away');
    // The line under the room and the buttons follow whichever piece is picked.
    function showPick() { info.textContent = label(); turnBtn.disabled = awayBtn.disabled = !sel; }
    const turn = () => { if (!sel) return; const id = s.u16(r + at(...sel) * 2); commit(movePiece(s, r, area, sel, sel, turned(id)), 'There’s no room to turn it'); };
    const remove = () => { if (!sel) return; const nm = item(s.u16(r + at(...sel) * 2)).name; removePiece(s, r, sel); s.sealStep(); sel = null; sfx.toggle(false); toast(`Put away the ${nm} (${UI.mod}Z to undo)`, '🪑'); refocus = true; refresh(); };
    cv.addEventListener('keydown', e => {
      const k = e.key, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (d && sel) { e.preventDefault(); moveSel([sel[0] + d[0], sel[1] + d[1]]); }
      else if ((k === 'r' || k === 'R') && sel) { e.preventDefault(); turn(); }
      else if ((k === 'Delete' || k === 'Backspace') && sel) { e.preventDefault(); remove(); }
      else if (k === 'Escape' && sel) { sel = null; cv.update(sc.groups.concat(marks())); showPick(); }
    });
    if (refocus) { refocus = false; setTimeout(() => cv.isConnected && cv.focus(), 0); }
    return h('div', { class: 'room3d' }, cv, info,
      h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '8px' } },
        turnBtn, awayBtn,
        Postcard.button(() => { cv.draw(); return cv; }, `${title} at home in ${s.str(4, 8)}`, `${s.str(4, 8)} ${title}`)),
      sc.missing.length ? h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '6px', textAlign: 'center' } }, `${sc.missing.length} piece${sc.missing.length === 1 ? ' has' : 's have'} no model in the ROM and isn’t shown.`) : null);
  }

  VIEWS.push({
    id: 'house', group: 'Home', icon: '🏠', title: () => 'My House', sub: () => 'Shared by every resident in Wild World',
    tips: ['Drag furniture to move it. Hold Alt (Option) while dropping to copy instead.', 'Right-click furniture to spin it, or right-click anything else to clear it.', 'Small icons in a corner are items sitting on top of that furniture.'],
    hello: () => 'Your cozy home! In Wild World everyone in town shares one house, so it’s a group project.',
    render(s, { refresh }) {
      const size = getF(s, 'size'), target = getF(s, 'target');
      const r = HOUSE + room * ROOM;
      const built = size >= UNLOCK[room];
      const n = roomSize(room, Math.min(size, 6));
      const area = { x: 8 - n / 2, y: 14 - n, w: n, h: n };
      const view = window.RoomView.room({
        cols: 16, rows: 16, area, showOutside, wall: s.u16(r + 0x448), floor: s.u16(r + 0x44A), title: ROOMS[room],
        locked: built ? null : `Built at “${SIZES[UNLOCK[room]][0]}”`,
        cell: (x, y) => ({ main: s.u16(r + (y * 16 + x) * 2), top: s.u16(r + 0x200 + (y * 16 + x) * 2) }),
        onCell: (x, y, e, ctx) => {
          const o = r + (y * 16 + x) * 2, id = s.u16(o);
          if (ctx) {
            if (isFtr(id) && exact()) { if (!movePiece(s, r, area, [x, y], [x, y], turned(id))) { sfx.error(); toast('There’s no room to turn it', '🪑'); return; } }
            else if (isFtr(id)) s.set16(o, turned(id)); else { s.set16(o, 0xFFF1); s.set16(o + 0x200, 0xFFF1); }
            sfx.click(); refresh(); return;
          }
          sfx.pop(); editSpot(s, r, x, y, refresh);
        },
        onMove: ([fx, fy], [tx, ty], copy) => {
          if (fx === tx && fy === ty) return;
          // With the ROM, a piece moves with every tile it covers; without it, the two spots swap as before.
          if (isFtr(s.u16(r + at(fx, fy) * 2)) && exact()) {
            if (movePiece(s, r, area, [fx, fy], [tx, ty], undefined, copy)) { s.sealStep(); sfx.bell(); refresh(); } else { sfx.error(); toast('It doesn’t fit there', '🪑'); }
            return;
          }
          for (const L of [0, 0x200]) {
            const a = r + L + (fy * 16 + fx) * 2, b = r + L + (ty * 16 + tx) * 2;
            const va = s.u16(a), vb = s.u16(b);
            s.set16(b, va); if (!copy) s.set16(a, vb);
          }
          sfx.bell(); refresh();
        },
      });
      const count = range(256).filter(k => { const id = s.u16(r + k * 2); return id !== 0xFFF1 && item(id).cat !== 'Occupied Space'; }).length;
      const roomTabs = h('div', { class: 'tabs' }, ROOMS.map((nm, i) => h('button', { class: 'tab' + (room === i ? ' on' : ''), onclick: () => { room = i; sfx.click(); refresh(); } }, ROOM_EMOJI[i], ' ', nm, size >= UNLOCK[i] ? '' : ' 🔒')));
      const songOpts = [[0xFFF1, '— No music —'], ...D.items.filter(i => i[2] === 'Songs').map(i => [i[0], i[1]])];
      const songsGrid = h('div', { class: 'dex' }, D.songs.map((nm, i) => {
        if (!nm) return null;
        const cb = h('input', { type: 'checkbox' }); cb.checked = !!s.bit(SONGS, i);
        const el = h('label', { class: 'dex-item' + (cb.checked ? ' on' : '') }, cb, '🎵', nm, songButton(i));
        cb.onchange = () => { s.setBit(SONGS, i, cb.checked); el.classList.toggle('on', cb.checked); sfx.toggle(cb.checked); };
        return el;
      }));
      const owned = D.songs.filter((nm, i) => nm && s.bit(SONGS, i)).length;
      const roofRow = (field, label, desc) => row(label, desc, h('div', { class: 'roof-swatches' }, ROOF_RGB.map((c, i) => h('button', {
        class: 'roof-swatch' + (getF(s, field) === i ? ' on' : ''), title: window.WW_FLAGS.roofColors[i], style: { background: c },
        onclick: () => { setF(s, field, i); sfx.pop(); refresh(); },
      }))), STATE);
      const lights = h('div', { class: 'btn-row' }, range(6).map(i => {
        const on = (getF(s, 'lights') >> i) & 1;
        return h('button', { class: 'btn small' + (on ? ' bell' : ''), onclick: () => { setF(s, 'lights', getF(s, 'lights') ^ (1 << i)); sfx.toggle(!on); refresh(); } }, on ? '💡 ' : '🌑 ', ROOMS[i] || 'Extra');
      }));
      return [
        section('Rooms', built ? `${count} pieces in the ${ROOMS[room].toLowerCase()}` : 'Not built yet'), roomTabs,
        h('div', { class: 'card pad' },
          h('div', { class: 'btn-row', style: { justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
            h('span', { class: 'muted', style: { fontSize: '12px' } }, show3d ? (window.LEAFLET_PHONE ? 'Arrange in 3D: drag furniture to move it' : 'Arrange in 3D: drag furniture to move it, or pick a piece and use the arrow keys') : `${UI.Click} a spot to edit it · drag to move · ${UI.rclick} to spin or clear`),
            h('span', { style: { display: 'flex', gap: '14px', alignItems: 'center' } },
              h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12.5px', fontWeight: 650 } }, '3D view', switchInput(() => show3d, v => { show3d = v; refresh(); })),
              show3d ? null : h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12.5px', fontWeight: 650 } }, 'Show outside the walls', switchInput(() => showOutside, v => { showOutside = v; refresh(); })))),
          show3d ? view3d(s, r, area, refresh, ROOMS[room]) : view,
          !built ? h('div', { class: 'callout', style: { marginTop: '12px' } }, h('span', { class: 'em' }, '⚠️'), h('div', null, h('b', null, 'This room isn’t built yet'), 'Furniture placed here only shows up after the matching upgrade. Changing the house size by hand without the upgrade can leave furniture stuck inside walls.')) : null,
          showOutside ? h('div', { class: 'callout', style: { marginTop: '12px' } }, h('span', { class: 'em' }, '⚠️'), h('div', null, h('b', null, 'Outside the walls'), 'Spots outside the room are normally empty. Furniture placed there may be unreachable or invisible.')) : null),
        card(
          row('Wallpaper', null, slot(() => s.u16(r + 0x448), v => s.set16(r + 0x448, v), { categories: ['Wallpaper'], title: 'Choose wallpaper' }), r + 0x448),
          row('Flooring', null, slot(() => s.u16(r + 0x44A), v => s.set16(r + 0x44A, v), { categories: ['Carpets'], title: 'Choose flooring' }), r + 0x44A),
          row('Room music', 'The song playing on this room’s stereo.', selectInput(songOpts, () => s.u16(r + 0x44C), v => s.set16(r + 0x44C, v)), r + 0x44C),
          row('Clear this room', 'Removes every item on both layers.', h('button', { class: 'btn small danger', onclick: async () => {
            if (!await confirmSheet('Clear this room?', 'Everything on the floor and on top of furniture in this room will be removed.', 'Clear')) return;
            range(256).forEach(k => { for (const L of [0, 0x200]) { const o = r + L + k * 2; if (item(s.u16(o)).cat !== 'Occupied Space') s.set16(o, 0xFFF1); } }); sfx.toggle(false); refresh();
          } }, 'Clear')),
        ),
        section('Outside', `Roof: ${window.WW_FLAGS.roofColors[getF(s, 'roof')] || '?'}`),
        card(
          row('House size', 'Each upgrade adds space. The loan below is not changed for you.', selectInput(SIZES.map(([nm], i) => [i, nm]), () => size,
            UI.guard('hsize', 'Change the house size?', 'The game builds rooms from this value. Shrinking the house hides furniture in removed rooms, and growing it skips Nook’s construction, so expect the loan and upgrade dialogue to be out of step until the next upgrade.', v => { setF(s, 'size', v); setF(s, 'target', v); refresh(); })), STATE, { risk: 'med' }),
          row('Upgrade in progress', target !== size ? `Nook is building the “${SIZES[target] ? SIZES[target][0] : '?'}” overnight.` : 'No construction pending. Setting a bigger size here makes Nook finish it overnight.',
            selectInput(SIZES.map(([nm], i) => [i, nm]), () => target, UI.guard('htarget', 'Order an upgrade?', 'This tells the game an upgrade has been paid for. It will rebuild the house the next time a day passes. Only pick the next size up from the current one.', v => { setF(s, 'target', v); refresh(); })), STATE, { risk: 'med' }),
          roofRow('roof', 'Roof color', 'The color you see now.'),
          roofRow('roofNext', 'Requested roof color', 'The color you asked Nook to paint. It applies overnight.'),
          roofRow('roofAfter', 'Roof color after the upgrade', 'Used when the next upgrade finishes.'),
          row('Lights on', 'Which rooms have their lights on.', lights, STATE),
          row('House counter', 'A counter stored with the house state that tops out at 10. Its meaning isn’t known yet.', h('span', null, h('span', { class: 'badge lab' }, 'Research'), ' ', numberInput(() => getF(s, 'counter'), v => setF(s, 'counter', v), { max: 255, width: 'w-s' })), STATE),
          row('Loan remaining', `The usual loan at this size is ${fmt(SIZES[Math.min(size, 6)][1])} bells.`, h('span', { style: { display: 'flex', gap: '6px' } }, numberInput(() => s.u32(LOAN), v => s.set32(LOAN, v), { max: 99999999 }),
            h('button', { class: 'btn small bell', onclick: () => { s.set32(LOAN, 0); sfx.bell(); say('Hm-hm-hmmm! Paid in full! Tom Nook would be thrilled... and a little suspicious.'); refresh(); } }, 'Pay off')), LOAN),
        ),
        section('K.K. song library', `${owned} of 70 songs collected`),
        h('div', { class: 'btn-row', style: { marginBottom: '10px' } },
          h('button', { class: 'btn small leaf', onclick: () => { D.songs.forEach((nm, i) => { if (nm) s.setBit(SONGS, i, true); }); sfx.save(); toast('Every K.K. song unlocked', '🎸'); refresh(); } }, 'Unlock every song'),
          h('button', { class: 'btn small', onclick: () => { range(72).forEach(i => s.setBit(SONGS, i, false)); refresh(); } }, 'Clear')),
        window.GameSound && GameSound.ready() ? card(row('Listen', 'Press ▶ on a song to hear it with the game’s own instruments, read from your ROM.', UI.selectInput([[176, 'Stereo (aircheck)'], [99, 'Live at the Roost']], () => songBase, v => { songBase = v; }, { width: 'w-m' }))) : null,
        h('div', { class: 'card' }, songsGrid),
        // RoomFtrState (+0x400): a 16×16 furniture-switch bit grid per layer (rows of u16, bit x; reset to all 1s, a
        // switched piece such as a lamp, tape deck or jack-in-the-box reads 0), then the gyroid table:
        // up to four gyroids with their spot (x, y nibbles), an in-use mask and a 4-bit beat each.
        section('Furniture switches', `Lamps, stereos, jack-in-the-boxes… in the ${ROOMS[room].toLowerCase()} · lit spots are switched from their default · click to flip`),
        h('div', { class: 'switch-wrap' }, [0, 1].map(L => h('div', { class: 'card pad' }, h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px', fontWeight: 700 } }, L ? 'Items on top' : 'Floor items'),
          h('div', { class: 'switch-grid' }, range(256).map(k => {
            const id = s.u16(r + L * 0x200 + k * 2), has = id !== 0xFFF1 && item(id).cat !== 'Occupied Space', on = !s.bit(r + 0x400 + L * 0x20, k);
            const b = h('button', { class: 'sw' + (on ? ' on' : '') + (has ? ' has' : ''), title: `${has ? item(id).name : 'Empty'} (${k & 15}, ${k >> 4})${on ? ' · switched' : ''}` }, has ? itemEmoji(id) : '');
            b.onclick = () => { const v = !s.bit(r + 0x400 + L * 0x20, k); s.setBit(r + 0x400 + L * 0x20, k, v); b.classList.toggle('on', !v); sfx.toggle(!v); };
            return b;
          }))))),
        section('Gyroids', 'Gyroids in this room keep a beat setting'),
        card(range(4).map(i => { const G = r + 0x440, used = (s.u8(G + 4) >> i) & 1, pos = s.u8(G + i), beat = (s.u8(G + 5 + (i >> 1)) >> ((i & 1) * 4)) & 15;
          const atId = s.u16(r + ((pos >> 4) * 16 + (pos & 15)) * 2);
          return row(`Gyroid ${i + 1}`, used ? `At (${pos & 15}, ${pos >> 4})${atId !== 0xFFF1 ? ' · ' + item(atId).name : ''}` : 'Unused',
            h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('span', { class: 'muted' }, 'x'), numberInput(() => s.u8(G + i) & 15, v => { s.set8(G + i, (s.u8(G + i) & 0xF0) | (v & 15)); refresh(); }, { max: 15, width: 'w-s' }),
              h('span', { class: 'muted' }, 'y'), numberInput(() => s.u8(G + i) >> 4, v => { s.set8(G + i, (s.u8(G + i) & 15) | ((v & 15) << 4)); refresh(); }, { max: 15, width: 'w-s' }),
              h('span', { class: 'muted' }, 'beat'), numberInput(() => beat, v => { const o = G + 5 + (i >> 1), sh = (i & 1) * 4; s.set8(o, (s.u8(o) & ~(15 << sh)) | ((v & 15) << sh)); refresh(); }, { max: 15, width: 'w-s' }),
              switchInput(() => used, v => { s.set8(G + 4, (s.u8(G + 4) & ~(1 << i)) | (v ? 1 << i : 0)); refresh(); })), G + i); })),
        card(
          row('Wallpaper is a custom design', 'Set when the room’s wallpaper came from a design rather than the catalog.', switchInput(() => s.u16(r + 0x44E) & 1, v => s.set16(r + 0x44E, (s.u16(r + 0x44E) & ~1) | (v ? 1 : 0))), r + 0x44E),
          row('Flooring is a custom design', null, switchInput(() => (s.u16(r + 0x44E) >> 1) & 1, v => s.set16(r + 0x44E, (s.u16(r + 0x44E) & ~2) | (v ? 2 : 0))), r + 0x44E)),
      ];
    },
  });
})();
