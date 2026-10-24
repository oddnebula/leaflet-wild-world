// Moves a neighbor's house on the town map, keeping the building, its footprint and the villager's coordinates in sync.
// Neighbor n's house is building item 0x5001+n; the villager stores (mapX + 16, mapY + 16) at +0x6E8.
(function () {
  'use strict';
  const { h, sfx, toast, item } = UI;
  const MAP = 0xC354, BURIED = 0xE354, ACRES = 0xC330, EMPTY = 0xFFF1, OCC = 0xF030;
  // Occupied tiles around a house, relative to the building tile (measured from real saves).
  const FOOT = [[-2, -1], [-1, -1], [0, -1], [1, -1], [-2, 0], [-1, 0], [1, 0], [-2, 1], [-1, 1], [0, 1], [1, 1], [0, 2]];
  const idx = (x, y) => ((y >> 4) * 4 + (x >> 4)) * 256 + (y & 15) * 16 + (x & 15);
  const get = (s, x, y) => s.u16(MAP + idx(x, y) * 2);
  const put = (s, x, y, v) => s.set16(MAP + idx(x, y) * 2, v);
  const unbury = (s, x, y) => { const i = idx(x, y), a = BURIED + (i >> 3); s.set8(a, s.u8(a) & ~(1 << (i & 7))); };

  function find(s, v) {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (get(s, x, y) === 0x5001 + v) return [x, y];
    return null;
  }
  function check(s, v, tx, ty, from) {
    const cells = [[0, 0], ...FOOT].map(([dx, dy]) => [tx + dx, ty + dy]);
    if (cells.some(([x, y]) => x < 0 || y < 0 || x > 63 || y > 63)) return 'The house would hang off the edge of town.';
    const own = new Set(from ? [[0, 0], ...FOOT].map(([dx, dy]) => `${from[0] + dx},${from[1] + dy}`) : []);
    const blocked = cells.filter(([x, y]) => !own.has(`${x},${y}`) && get(s, x, y) !== EMPTY);
    if (blocked.length) return `${blocked.length} spot${blocked.length > 1 ? 's are' : ' is'} taken by trees, flowers or buildings. Clear them on the Town Map first.`;
    return null;
  }
  function move(s, v, tx, ty) {
    const from = find(s, v);
    if (from) for (const [dx, dy] of [[0, 0], ...FOOT]) {
      const x = from[0] + dx, y = from[1] + dy;
      if (x < 0 || y < 0 || x > 63 || y > 63) continue;
      const cur = get(s, x, y);
      if (cur === OCC || cur === 0x5001 + v) put(s, x, y, EMPTY);
    }
    put(s, tx, ty, 0x5001 + v); unbury(s, tx, ty);
    for (const [dx, dy] of FOOT) { put(s, tx + dx, ty + dy, OCC); unbury(s, tx + dx, ty + dy); }
    const b = s.villagerBase(v);
    s.set8(b + 0x6E8, tx + 16); s.set8(b + 0x6E9, ty + 16);
  }

  function panel(s, v, refresh) {
    const S = 6, cv = h('canvas', { width: 64 * S, height: 64 * S });
    const g = cv.getContext('2d');
    const from = find(s, v);
    let hover = null;
    const imgs = {};
    function draw() {
      for (let ay = 0; ay < 4; ay++) for (let ax = 0; ax < 4; ax++) {
        const a = s.u8(ACRES + (ay + 1) * 6 + ax + 1), im = imgs[a];
        if (im && im.complete) g.drawImage(im, ax * 16 * S, ay * 16 * S, 16 * S, 16 * S); else { g.fillStyle = '#5aa86a'; g.fillRect(ax * 16 * S, ay * 16 * S, 16 * S, 16 * S); }
      }
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const id = get(s, x, y); if (id === EMPTY) continue;
        const cat = item(id).cat;
        g.fillStyle = id === 0x5001 + v ? '#f2bf3a' : cat === 'Buildings' ? '#a05f2c' : cat === 'Occupied Space' ? 'rgba(80,50,20,.35)' : /Trees/.test(cat) ? '#1f6b3a' : 'rgba(255,255,255,.55)';
        g.fillRect(x * S, y * S, S, S);
      }
      if (from) { g.strokeStyle = '#f2bf3a'; g.lineWidth = 3; g.strokeRect((from[0] - 2) * S - 2, (from[1] - 1) * S - 2, 4 * S + 4, 4 * S + 4); }
      if (hover) {
        const bad = check(s, v, hover[0], hover[1], from);
        g.fillStyle = bad ? 'rgba(226,87,76,.55)' : 'rgba(66,179,107,.6)';
        for (const [dx, dy] of [[0, 0], ...FOOT]) g.fillRect((hover[0] + dx) * S, (hover[1] + dy) * S, S, S);
      }
    }
    for (let ay = 0; ay < 4; ay++) for (let ax = 0; ax < 4; ax++) {
      const a = s.u8(ACRES + (ay + 1) * 6 + ax + 1);
      if (!imgs[a] && window.WW_ACRE_IMAGES[a]) { const im = new Image(); im.onload = draw; im.src = window.WW_ACRE_IMAGES[a]; imgs[a] = im; }
    }
    const at = e => { const r = cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * 64), Math.floor((e.clientY - r.top) / r.height * 64)]; };
    const status = h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, from ? 'Click anywhere on the map to move the house there. Green means it fits.' : 'Their house isn’t on the map. Click a spot to build it there.');
    cv.addEventListener('pointermove', e => { hover = at(e); draw(); const bad = check(s, v, hover[0], hover[1], from); status.textContent = bad || `Move here: spot ${hover[0]}, ${hover[1]}`; });
    cv.addEventListener('pointerleave', () => { hover = null; draw(); });
    cv.addEventListener('click', e => {
      const [x, y] = at(e), bad = check(s, v, x, y, from);
      if (bad) { sfx.error(); toast(bad, '🚧'); return; }
      UI.guard('movehouse', 'Move this house?', 'The building, the occupied tiles around it and the villager’s stored position all move together. The ground under the new spot can’t be checked for water or cliffs, so make sure it’s on dry, flat land in the game’s map view first.', () => {
        move(s, v, x, y); sfx.save(); toast('House moved!', '🚚'); refresh();
      })();
    });
    draw();
    return h('div', { class: 'card pad' },
      h('div', { class: 'callout info' }, h('span', { class: 'em' }, '🚚'), h('div', null, h('b', null, 'Move their house'), 'Hover to preview the footprint, then click to move. Trees, flowers and items in the way must be cleared first.')),
      h('div', { class: 'mini-map' }, cv), status);
  }
  window.HouseMover = { panel, find, check, move, FOOT };
})();
