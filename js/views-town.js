// Town views: overview, town settings, map painter, acre layout.
(function () {
  'use strict';
  const { h, hex, fmt, row, card, section, guard, numberInput, textInput, selectInput, switchInput, sfx, say, toast, item, itemEmoji, itemLabel, pickItem, confirmSheet } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const C = WWSave.C;
  const MAP = 0xC354, BURIED = 0xE354, ACRES = 0xC330, EMPTY = 0xFFF1;

  const VILLAGER_NAME = new Map(D.villagers.map(v => [v.id, v]));
  const AVATAR_COLORS = ['#f2846b', '#6cc3ec', '#9b7be0', '#42b36b', '#f2bf3a', '#d96aa0', '#56b6a8', '#e39b4f'];
  const SPECIES_EMOJI = { Alligator: '🐊', Anteater: '🐜', Bear: '🐻', Bird: '🐦', Bull: '🐂', Cat: '🐱', Chicken: '🐔', Cow: '🐄', Cub: '🧸', Deer: '🦌', Dog: '🐶', Duck: '🦆', Eagle: '🦅', Elephant: '🐘', Frog: '🐸', Goat: '🐐', Gorilla: '🦍', Hamster: '🐹', Hippo: '🦛', Horse: '🐴', Kangaroo: '🦘', Koala: '🐨', Lion: '🦁', Monkey: '🐵', Mouse: '🐭', Octopus: '🐙', Ostrich: '🦤', Penguin: '🐧', Pig: '🐷', Rabbit: '🐰', Rhino: '🦏', Sheep: '🐑', Squirrel: '🐿️', Tiger: '🐯', Wolf: '🐺', Special: '⭐' };
  const speciesEmoji = s => SPECIES_EMOJI[(s || '').replace(/s$/, '')] || '🐾';
  window.WW_SPECIES_EMOJI = speciesEmoji;

  function counts(s) {
    const players = [0, 1, 2, 3].filter(p => s.playerExists(p));
    const villagers = [...Array(8).keys()].filter(v => s.u8(s.villagerBase(v) + 0x6CB) !== 0xFF);
    let donated = 0;
    for (let i = 0; i < 0x5F * 2; i++) { const b = s.u8(0x15D50 + (i >> 1)); if ((i & 1 ? b >> 4 : b & 15)) donated++; }
    return { players, villagers, donated };
  }

  // =====================================================================================
  VIEWS.push({
    id: 'overview', group: 'Town', icon: '🏡', title: s => s ? s.str(4, 8) : 'Overview', sub: () => 'Town overview',
    tips: ['Click any resident card to jump straight into their editor.', 'The bell counter in the toolbar adds up every wallet and bank account in town.'],
    render(s, { go }) {
      const c = counts(s);
      let bells = 0; c.players.forEach(p => { bells += s.u32(s.playerBase(p) + 0x1B40) + s.u32(s.playerBase(p) + 0x21E4); });
      const houseSizes = ['Small', 'Medium', 'Large', 'Two floors', 'West room', 'East room', 'Mansion'];
      const people = h('div', { class: 'people' });
      for (let p = 0; p < 4; p++) {
        const b = s.playerBase(p), ex = s.playerExists(p);
        people.append(h('button', { class: 'person' + (ex ? '' : ' empty'), onclick: () => go('player' + p) },
          h('div', { class: 'avatar', style: { background: AVATAR_COLORS[p] } }, ex ? (s.u8(b + 0x228A) ? '👧' : '👦') : '＋'),
          h('div', null, h('div', { class: 'n' }, ex ? s.str(b + 0x2282, 8) : `Player ${p + 1}`), h('div', { class: 's' }, ex ? `🔔 ${fmt(s.u32(b + 0x1B40))} in wallet` : 'No resident yet'))));
      }
      const neigh = h('div', { class: 'people' });
      for (let v = 0; v < 8; v++) {
        const b = s.villagerBase(v), id = s.u8(b + 0x6CB), info = VILLAGER_NAME.get(id);
        neigh.append(h('button', { class: 'person' + (id === 0xFF ? ' empty' : ''), onclick: () => go('villager' + v) },
          h('div', { class: 'avatar', style: { background: AVATAR_COLORS[(v + 3) % 8] } }, id === 0xFF ? '＋' : speciesEmoji(info && info.species)),
          h('div', null, h('div', { class: 'n' }, id === 0xFF ? 'Empty lot' : (info ? info.name : hex(id, 2))),
            h('div', { class: 's' }, id === 0xFF ? 'Nobody lives here' : `${D.personalities[s.u8(b + 0x6CA)] || 'Unknown'} · “${s.str(b + 0x6DE, 10)}”`))));
      }
      return [
        h('div', { class: 'hero' }, h('span', { class: 'clouds' }, '☁️'),
          h('h2', null, s.str(4, 8)), h('p', null, `${s.region} save · Town ID ${hex(s.u16(2))} · ${c.players.length} resident${c.players.length === 1 ? '' : 's'}, ${c.villagers.length} neighbors`)),
        h('div', { class: 'stat-row' },
          stat('🔔', 'Bells in town', fmt(bells)),
          stat('🏛️', 'Museum', `${c.donated} / 184`),
          stat('🏠', 'House', houseSizes[s.u8(0xFAF8) & 7] || '?'),
          stat('💸', 'Loan left', fmt(s.u32(0xFAE8)))),
        section('Residents', 'Up to four per town'), people,
        section('Neighbors', 'Eight houses'), neigh,
      ];
    },
  });
  function stat(em, k, v) { return h('div', { class: 'stat' }, h('div', { class: 'k' }, em, k), h('div', { class: 'v' }, v)); }

  // =====================================================================================
  function eachMapCell(s, fn) { for (let i = 0; i < 4096; i++) fn(i, s.u16(MAP + i * 2)); }
  const isWeed = id => (id >= 0x1D && id <= 0x24) || id === 0x1B || id === 0x89;
  const FRUIT_FULL = [[0x34, 0x36, 0x33], [0x3C, 0x3E, 0x3B], [0x44, 0x46, 0x44], [0x4C, 0x4E, 0x4B], [0x54, 0x56, 0x53], [0xCD, 0xCF, 0xCC]];

  const CHORES = [
    ['🌿', 'Pull every weed', 'Removes weeds (and the Rafflesia) from the whole map.', s => { let n = 0; eachMapCell(s, (i, id) => { if (isWeed(id)) { s.set16(MAP + i * 2, EMPTY); n++; } }); return `Pulled ${n} weeds`; }],
    ['💧', 'Water all flowers', 'Turns normal flowers into freshly watered ones (they can spread or hybridize).', s => { let n = 0; eachMapCell(s, (i, id) => { if (id >= 0x6E && id <= 0x88) { s.set16(MAP + i * 2, id - 0x6E + 0x8A); n++; } }); return `Watered ${n} flowers`; }],
    ['🌷', 'Revive wilted flowers', 'Brings parched and watered flowers back to normal, healthy flowers.', s => { let n = 0; eachMapCell(s, (i, id) => { if (id >= 0x6E && id <= 0x89) { s.set16(MAP + i * 2, id - 0x6E); n++; } else if (id >= 0x8A && id <= 0xA4) { s.set16(MAP + i * 2, id - 0x8A); n++; } }); return `Revived ${n} flowers`; }],
    ['🍎', 'Regrow all fruit', 'Puts fruit back on every picked fruit tree.', s => { let n = 0; eachMapCell(s, (i, id) => { for (const [lo, hi, full] of FRUIT_FULL) if (id >= lo && id <= hi) { s.set16(MAP + i * 2, full); n++; } }); return `Restocked ${n} trees`; }],
    ['⛏️', 'Dig up everything buried', 'Clears every buried flag, so items lie on the ground instead.', s => { let n = 0; for (let i = 0; i < 0x200; i++) { const b = s.u8(BURIED + i); if (b) { for (let k = 0; k < 8; k++) n += (b >> k) & 1; s.set8(BURIED + i, 0); } } return `Unburied ${n} items`; }],
    ['🧹', 'Tidy dropped items', 'Removes furniture, paper and gyroids left lying around the map.', s => { let n = 0; eachMapCell(s, (i, id) => { const t = id & 0xF000; if (t === 0x1000 || t === 0x3000 || t === 0x4000) { s.set16(MAP + i * 2, EMPTY); n++; } }); return `Tidied ${n} items`; }],
    ['🪨', 'Remove all rocks', 'Clears regular and money rocks (new ones may appear the next day).', s => { let n = 0; eachMapCell(s, (i, id) => { if (id >= 0xE3 && id <= 0xFB) { s.set16(MAP + i * 2, EMPTY); n++; } }); return `Removed ${n} rocks`; }],
    ['🕳️', 'Fill holes and pitfalls', 'Removes buried pitfall seeds and leftover holes.', s => { let n = 0; eachMapCell(s, (i, id) => { if (id === 0x1566 || id === 0xA6 || id === 0x103) { s.set16(MAP + i * 2, EMPTY); n++; } }); return `Filled ${n} spots`; }],
  ];

  function perfectTown(s) {
    const res = [];
    for (let ay = 0; ay < 4; ay++) for (let ax = 0; ax < 4; ax++) {
      let trees = 0, flowers = 0, weeds = 0, junk = 0;
      for (let k = 0; k < 256; k++) {
        const id = s.u16(MAP + ((ay * 4 + ax) * 256 + k) * 2);
        if (isWeed(id)) weeds++;
        else if (id >= 0x25 && id <= 0x6D) trees++;
        else if (id <= 0x1A || (id >= 0x6E && id <= 0xA5)) flowers++;
        else if ((id & 0xF000) === 0x1000 || (id & 0xF000) === 0x3000 || (id & 0xF000) === 0x4000 || (id >= 0x137D && id <= 0x137F)) junk++;
      }
      const bad = weeds > 2 || junk > 2;
      const perfect = !bad && ((trees >= 12 && trees <= 15 && flowers >= 3) || (trees < 12 && flowers >= 3 + (12 - trees) * 2) || (trees > 15 && flowers >= 3 + (trees - 15) * 2));
      res.push({ trees, flowers, weeds, junk, status: bad ? 'bad' : perfect ? 'perfect' : 'ok' });
    }
    return res;
  }

  VIEWS.push({
    id: 'town', group: 'Town', icon: '⛲', title: () => 'Town Settings', sub: () => 'Name, ground cover, gate and groundskeeping',
    tips: ['Changing the Town ID can break the link between residents and your town. Only change it if you know why.', 'The perfect-town check uses the community-researched rules: 12–15 trees per acre plus flowers, and no more than 2 weeds or junk items.'],
    render(s, { refresh }) {
      let propagate = true;
      const grassNames = [[0, 'Triangles (snow: squares)'], [1, 'Circles (snow: stars)'], [2, 'Squares (snow: hexagons)']];
      const gate = [[0, 'Red roof'], [1, 'Green roof'], [2, 'Blue roof']];
      const FRUITS = [[0, '🍎 Apple'], [1, '🍊 Orange'], [2, '🍐 Pear'], [3, '🍑 Peach'], [4, '🍒 Cherry']];
      const pt = perfectTown(s);
      const ptGrid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', padding: '12px' } },
        pt.map(a => h('div', { class: 'dex-item' + (a.status === 'perfect' ? ' on' : ''), style: { flexDirection: 'column', alignItems: 'flex-start', gap: '2px' } },
          h('b', null, a.status === 'perfect' ? '🌟 Perfect' : a.status === 'ok' ? '🙂 Okay' : '😟 Needs work'),
          h('span', { class: 'muted', style: { fontSize: '11.5px' } }, `🌳${a.trees} 🌷${a.flowers} 🌿${a.weeds} 📦${a.junk}`))));
      const perfectCount = pt.filter(a => a.status === 'perfect').length;
      return [
        section('Identity'),
        card(
          row('Town name', 'Up to 8 characters. Shown on signs, letters and passports.',
            textInput(() => s.str(4, 8), v => {
              const old = s.str(4, 8);
              s.setStr(4, 8, v);
              if (propagate) for (let p = 0; p < 4; p++) if (s.playerExists(p) && s.str(s.playerBase(p) + 0x2278, 8) === old) s.setStr(s.playerBase(p) + 0x2278, 8, v);
              toast(`Welcome to ${v}!`, '🏡'); refresh();
            }, 8, { check: WWSave.canEncode }), 0x4),
          row('Also rename on every resident', 'Keeps each resident’s home town matching (they’re stored separately).', switchInput(() => propagate, v => { propagate = v; })),
          row('Town ID', 'Hidden number that links residents, letters and patterns to this town.', numberInput(() => s.u16(2), UI.guard('townid', 'Change the Town ID?', 'Every resident, villager, pattern and letter stores this ID. If they stop matching, the game may treat your residents as visitors or refuse to load them. Only change it to match another copy of this town.', v => s.set16(2, v)), { max: 0xFFFF, width: 'w-s' }), 0x2, { risk: 'high', why: 'Residents and letters must match this ID.' }),
        ),
        section('Look & feel'),
        card(
          row('Grass pattern', 'The worn-path shape left when grass wears down. In winter it shows as snow shapes.', selectInput(grassNames, () => s.u8(0xE554) & 3, v => { s.set8(0xE554, (s.u8(0xE554) & ~3) | v); refresh(); }), 0xE554),
          row('Ground season', 'Which seasonal ground texture is showing. The game updates this itself as the seasons change.', numberInput(() => s.u8(0xE554) >> 2, v => s.set8(0xE554, (s.u8(0xE554) & 3) | (v << 2)), { max: 63, width: 'w-s' }), 0xE554, { risk: 'med', why: 'The game resets this on the next season change anyway.' }),
          row('Town gate roof', 'Color of the roof on the gate house.', selectInput(gate, () => s.u8(0x15B58), v => s.set8(0x15B58, v)), 0x15B58),
        ),
        section('🎵 Town tune', 'Plays at the gate, the town hall and when your neighbors hum'),
        window.TuneEditor.editor(s, refresh),
        window.TuneEditor.book(s, refresh),
        section('🍐 Native fruit'),
        card(
          row('Native fruit', 'Your town’s own fruit. It sells for 100 bells here, while the other four fruits sell for 500. Trees already planted keep the fruit they grow.',
            selectInput(FRUITS, () => s.u32(0x15E58), v => s.set32(0x15E58, v)), 0x15E58, { risk: 'med', why: 'Changes which fruit counts as foreign for selling and for your neighbors’ requests. Existing trees don’t change.' }),
        ),
        // 0x15FC5: the date the town was founded and a flag that stays set through its first day (a SaveRecord4); 0x15FDE:
        // the save footer's state byte, 2 after a proper save and 0x1C when the game was switched off without saving.
        section('📆 Town history'),
        card(
          row('Founded on', (() => { const d = s.u8(0x15FC5), m = s.u8(0x15FC6), y = s.u8(0x15FC7); return m ? `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] || '?'} ${d}, 20${String(y).padStart(2, '0')}` : 'Not set'; })(),
            h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, ...[[1, 12], [0, 31], [2, 99]].flatMap(([i, max], k) => [k ? '/' : null, numberInput(() => s.u8(0x15FC5 + i), v => { s.set8(0x15FC5 + i, v); refresh(); }, { max, width: 'w-s' })])), 0x15FC5),
          row('Still the first day', 'On the first day of a new town no visitors come and some events wait.', switchInput(() => s.u8(0x15FC8), v => s.set8(0x15FC8, v ? 1 : 0)), 0x15FC8),
          row('Last session ended', s.u8(0x15FDE) === 0x1C ? 'Without saving: Mr. Resetti will be waiting.' : s.u8(0x15FDE) === 2 ? 'With a proper save.' : `State ${s.u8(0x15FDE)}.`,
            selectInput([[2, 'Saved properly'], [0x1C, 'Quit without saving']], () => s.u8(0x15FDE), v => { s.set8(0x15FDE, v); refresh(); }, { width: 'w-m' }), 0x15FDE, { risk: 'med', why: '“Quit without saving” makes Mr. Resetti lecture you next time.' })),
        section('Groundskeeping', 'One-click chores'),
        card(...CHORES.map(([em, label, desc, fn]) => row(`${em}  ${label}`, desc, h('button', { class: 'btn small', onclick: async () => { const msg = fn(s); sfx.bell(); toast(msg, em); refresh(); } }, 'Do it')))),
        section('Town event flags', '32 town-wide flags at 0x15FD8'),
        h('div', { class: 'callout' }, h('span', { class: 'em' }, '🧪'), h('div', null, h('b', null, 'These change what happens in-game'), 'Some are cleared every day by the game. Turning a “received” flag off can make a gift arrive again.')),
        window.FlagList(s, 0x15FD8, 32, window.WW_FLAGS.town, 'Town'),
        section('Perfect town check', `${perfectCount} of 16 acres look perfect`),
        h('div', { class: 'card' }, ptGrid),
      ];
    },
  });

  // =====================================================================================
  const MAP_COLORS = (id) => {
    const it = item(id);
    switch (it.cat) {
      case 'Empty': return null;
      case 'Trees': case 'Special Trees': case 'Palm Trees': return '#1f6b3a';
      case 'Flowers': case 'Watered Flowers': return '#f58fb5';
      case 'Parched Flowers': return '#b88a6a';
      case 'Weeds': return '#9bd16b';
      case 'Rocks': case 'Unused Rocks': return '#8d8d8d';
      case 'Buildings': return '#a05f2c';
      case 'Occupied Space': return 'rgba(0,0,0,.18)';
      case 'Patterns': return '#7f6be0';
      case 'Special Stumps': return '#7a5530';
      default: return '#f2bf3a';
    }
  };
  window.WW_MAP_COLORS = MAP_COLORS;
  VIEWS.push({
    id: 'map', group: 'Town', icon: '🗺️', title: () => 'Town Map', sub: () => '4,096 spots across 16 acres',
    tips: ['Pick a brush item, then click and drag to paint. Hold Shift while painting to bury items instead.', 'The eyedropper copies any spot’s item into your brush.', 'Buildings are drawn in brown. Moving them can confuse the game, so tread lightly!'],
    hello: () => 'Here’s your whole town from above! Pick a tool on the right and click or drag on the map.',
    render(s) {
      const CELL = 20, W = 64 * CELL;
      const cv = h('canvas', { width: W, height: W });
      const tip = h('div', { class: 'map-tip', hidden: true });
      const stage = h('div', { class: 'map-stage' }, cv, tip);
      let tool = 'inspect', brush = 0x0000, showGrid = true, showEmoji = true, sel = -1;
      const imgs = {};
      const acreAt = (ax, ay) => s.u8(ACRES + (ay + 1) * 6 + (ax + 1));
      const idx = (x, y) => ((y >> 4) * 4 + (x >> 4)) * 256 + (y & 15) * 16 + (x & 15);
      const buried = i => (s.u8(BURIED + (i >> 3)) >> (i & 7)) & 1;
      const setBuried = (i, on) => { const a = BURIED + (i >> 3); s.set8(a, on ? s.u8(a) | (1 << (i & 7)) : s.u8(a) & ~(1 << (i & 7))); };
      const g = cv.getContext('2d');
      const iconImgs = new Map();
      function drawCell(x, y) {
        const i = idx(x, y), id = s.u16(MAP + i * 2);
        const ax = x >> 4, ay = y >> 4, img = imgs[acreAt(ax, ay)];
        const px = x * CELL, py = y * CELL;
        if (img && img.complete) g.drawImage(img, (x & 15) * 2, (y & 15) * 2, 2, 2, px, py, CELL, CELL);
        else { g.fillStyle = '#4c9a5f'; g.fillRect(px, py, CELL, CELL); }
        const col = MAP_COLORS(id), cat = item(id).cat;
        if (col) {
          if (cat === 'Occupied Space') { g.fillStyle = 'rgba(80,50,20,.22)'; g.fillRect(px, py, CELL, CELL); }
          else if (cat === 'Buildings') {
            g.fillStyle = col; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2;
            g.beginPath(); g.roundRect ? g.roundRect(px + 1, py + 1, CELL - 2, CELL - 2, 4) : g.rect(px + 1, py + 1, CELL - 2, CELL - 2); g.fill(); g.stroke();
          } else {
            g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5;
            g.beginPath(); g.arc(px + CELL / 2, py + CELL / 2, CELL * 0.42, 0, 7); g.fill(); g.stroke();
          }
          const url = showEmoji && cat !== 'Occupied Space' && cat !== 'Buildings' && window.ROM && ROM.iconURL(id);
          if (url) {
            let im = iconImgs.get(url);
            if (!im) { im = new Image(); im.src = url; iconImgs.set(url, im); }
            if (im.complete) g.drawImage(im, px + 1, py + 1, CELL - 2, CELL - 2); else im.addEventListener('load', () => drawCell(x, y), { once: true });
          } else if (showEmoji && cat !== 'Occupied Space') {
            g.font = `${CELL - 3}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(itemEmoji(id), px + CELL / 2, py + CELL / 2 + 1);
          }
        }
        if (buried(i)) { g.strokeStyle = '#5b3b16'; g.lineWidth = 3; g.beginPath(); g.moveTo(px + 4, py + 4); g.lineTo(px + CELL - 4, py + CELL - 4); g.moveTo(px + CELL - 4, py + 4); g.lineTo(px + 4, py + CELL - 4); g.stroke(); }
        if (i === sel) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3); }
      }
      function drawAll() {
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) drawCell(x, y);
        if (showGrid) { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(k * 16 * CELL, 0); g.lineTo(k * 16 * CELL, W); g.moveTo(0, k * 16 * CELL); g.lineTo(W, k * 16 * CELL); g.stroke(); } }
      }
      for (let ay = 0; ay < 4; ay++) for (let ax = 0; ax < 4; ax++) {
        const a = acreAt(ax, ay);
        if (!imgs[a] && window.WW_ACRE_IMAGES[a]) { const im = new Image(); im.onload = () => drawAll(); im.src = window.WW_ACRE_IMAGES[a]; imgs[a] = im; }
      }
      const info = h('div', { class: 'row-label', style: { padding: '12px' } }, h('div', { class: 'd' }, 'Hover or click a spot to see what’s there.'));
      function showInfo(i) {
        const id = s.u16(MAP + i * 2), a = i >> 8, x = (a % 4) * 16 + (i & 15), y = (a >> 2) * 16 + ((i >> 4) & 15);
        info.replaceChildren(h('div', { class: 't', style: { fontSize: '15px' } }, itemEmoji(id), ' ', itemLabel(id)),
          h('div', { class: 'd' }, `Acre ${String.fromCharCode(65 + (a >> 2))}-${(a % 4) + 1} · spot (${x}, ${y}) · ${hex(id)} · ${buried(i) ? 'buried' : 'on the ground'}`),
          h('div', { class: 'btn-row', style: { marginTop: '8px' } },
            h('button', { class: 'btn small', onclick: async () => { const v = await pickItem(id, { title: 'Place on this spot' }); if (v !== null) { s.set16(MAP + i * 2, v); drawAll(); showInfo(i); sfx.bell(); } } }, 'Change…'),
            h('button', { class: 'btn small', onclick: () => { setBuried(i, !buried(i)); drawAll(); showInfo(i); sfx.toggle(buried(i)); } }, buried(i) ? 'Dig up' : 'Bury'),
            h('button', { class: 'btn small danger', onclick: () => { s.set16(MAP + i * 2, EMPTY); setBuried(i, false); drawAll(); showInfo(i); sfx.toggle(false); } }, 'Clear')));
      }
      const cellFromEvent = e => {
        const r = cv.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * 64), y = Math.floor((e.clientY - r.top) / r.height * 64);
        return x >= 0 && y >= 0 && x < 64 && y < 64 ? { x, y, i: idx(x, y) } : null;
      };
      let painting = false, buildingOk = false;
      const confirmBuilding = () => UI.confirmSheet('⚠ Edit a building?', 'Buildings (houses, shops, the town hall, signs) and the “occupied” tiles around them are part of how the game lays out the town. Removing or adding them by hand can leave invisible walls, stuck villagers or a town that won’t load. To move a neighbor’s house, use their Home tab instead, which moves the whole footprint safely.', 'Edit anyway');
      function apply(c, e) {
        const cur = s.u16(MAP + c.i * 2);
        if (tool === 'inspect') { sel = c.i; drawAll(); showInfo(c.i); return; }
        if (tool === 'pick') { brush = cur; drawBrush(); tool = 'place'; drawTools(); sfx.pop(); return; }
        if (tool === 'place') {
          const risky = (brush >= 0x5000 && brush < 0x5100) || brush === 0xF030 || (cur >= 0x5000 && cur < 0x5100) || cur === 0xF030;
          if (risky && !buildingOk) { painting = false; confirmBuilding().then(ok => { if (ok) { buildingOk = true; apply(c, e); } }); return; }
          if (e.shiftKey) setBuried(c.i, true); if (cur !== brush) s.set16(MAP + c.i * 2, brush);
        }
        if (tool === 'erase') {
          if (((cur >= 0x5000 && cur < 0x5100) || cur === 0xF030) && !buildingOk) { painting = false; confirmBuilding().then(ok => { if (ok) { buildingOk = true; apply(c, e); } }); return; }
          s.set16(MAP + c.i * 2, EMPTY); setBuried(c.i, false);
        }
        if (tool === 'bury') { if (!painting || !buried(c.i)) setBuried(c.i, !buried(c.i) || painting); }
        drawCell(c.x, c.y);
      }
      cv.addEventListener('pointerdown', e => { const c = cellFromEvent(e); if (!c) return; cv.setPointerCapture(e.pointerId); apply(c, e); painting = tool !== 'inspect' && tool !== 'pick'; if (painting) sfx.click(); });
      cv.addEventListener('pointermove', e => {
        const c = cellFromEvent(e); if (!c) { tip.hidden = true; return; }
        const id = s.u16(MAP + c.i * 2);
        tip.hidden = false; tip.textContent = `${itemLabel(id)}${buried(c.i) ? ' (buried)' : ''}`;
        const r = stage.getBoundingClientRect(); tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px';
        if (painting) apply(c, e);
      });
      cv.addEventListener('pointerup', () => { if (painting) { painting = false; drawAll(); } });
      cv.addEventListener('pointerleave', () => { tip.hidden = true; });

      const TOOLS = [['inspect', '🔍', 'Inspect'], ['place', '🌱', 'Place'], ['erase', '🧽', 'Erase'], ['bury', '⛏️', 'Bury'], ['pick', '💧', 'Eyedrop'], ['replace', '🔁', 'Replace all']];
      const toolsEl = h('div', { class: 'tools' });
      function drawTools() {
        toolsEl.replaceChildren(...TOOLS.map(([id, em, label]) => h('button', { class: 'tool' + (tool === id ? ' on' : ''), onclick: async () => {
          sfx.click();
          if (id === 'replace') {
            const from = await pickItem(brush, { title: 'Replace every…' }); if (from === null) return;
            const to = await pickItem(EMPTY, { title: `…${itemLabel(from)} with` }); if (to === null) return;
            let n = 0; eachMapCell(s, (i, v) => { if (v === from) { s.set16(MAP + i * 2, to); n++; } });
            drawAll(); toast(`Replaced ${n} spots`, '🔁'); sfx.bell(); return;
          }
          tool = id; drawTools();
        } }, h('span', null, em), label)));
      }
      const brushEl = h('div', { class: 'brush' });
      function drawBrush() { brushEl.replaceChildren(h('span', { class: 'em' }, itemEmoji(brush)), h('div', null, h('div', { style: { fontWeight: 750 } }, itemLabel(brush)), h('div', { class: 'muted mono', style: { fontSize: '11px' } }, `Brush · ${hex(brush)}`))); }
      brushEl.addEventListener('click', async () => { const v = await pickItem(brush, { title: 'Choose a brush item' }); if (v !== null) { brush = v; drawBrush(); tool = 'place'; drawTools(); } });
      drawTools(); drawBrush(); drawAll();
      return h('div', { class: 'map-wrap' }, stage, h('div', { class: 'tool-panel' },
        h('div', { class: 'card' }, toolsEl, brushEl),
        h('div', { class: 'card' }, info),
        h('div', { class: 'card' },
          row('Show item icons', null, switchInput(() => showEmoji, v => { showEmoji = v; drawAll(); })),
          row('Acre grid lines', null, switchInput(() => showGrid, v => { showGrid = v; drawAll(); })),
          h('div', { class: 'legend' }, [['#1f6b3a', 'Trees'], ['#f58fb5', 'Flowers'], ['#9bd16b', 'Weeds'], ['#8d8d8d', 'Rocks'], ['#a05f2c', 'Buildings'], ['#f2bf3a', 'Items']].map(([c, n]) => h('span', null, h('i', { style: { background: c } }), n))))));
    },
  });

  // =====================================================================================
  VIEWS.push({
    id: 'acres', group: 'Town', icon: '🧩', title: () => 'Acre Layout', sub: () => '6 × 6 acres, including cliffs and beach',
    tips: ['The outer ring is cliffs, beach and ocean. The inner 4 × 4 is where your town lives.', 'Each building acre must appear exactly once, or the game can get confused.'],
    hello: () => 'This is your town’s jigsaw! Acre edits are powerful but risky. Rivers need to connect, and each building should only appear once.',
    render(s, { refresh }) {
      const acres = new Map(D.acres.map(a => [a[0], a]));
      const grid = h('div', { class: 'acre-grid' });
      for (let i = 0; i < 36; i++) {
        const id = s.u8(ACRES + i), x = i % 6, y = (i / 6) | 0, town = x >= 1 && x <= 4 && y >= 1 && y <= 4;
        const a = acres.get(id);
        grid.append(h('button', { class: 'acre' + (town ? ' town' : ''), title: `${a ? a[1] : 'Unknown'} (${hex(id, 2)})`, onclick: () => pickAcre(i) },
          window.WW_ACRE_IMAGES[id] ? h('img', { src: window.WW_ACRE_IMAGES[id], alt: '' }) : null, h('span', { class: 'hx' }, id.toString(16).toUpperCase().padStart(2, '0'))));
      }
      async function pickAcre(i) {
        sfx.pop();
        const cur = s.u8(ACRES + i);
        const root = document.getElementById('popover-root');
        const close = () => root.replaceChildren();
        const cats = [...new Set(D.acres.map(a => a[2]))];
        const body = h('div', { class: 'sheet-body' }, cats.map(c => [h('div', { class: 'section-title' }, c),
          h('div', { class: 'acre-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', maxWidth: 'none', padding: '0 4px' } },
            D.acres.filter(a => a[2] === c).map(a => h('button', { class: 'acre', title: `${a[1]} (${hex(a[0], 2)})`, style: a[0] === cur ? { borderColor: 'var(--leaf)' } : null,
              onclick: () => { close(); UI.guard('acres', 'Change an acre?', 'Acres decide the shape of the land: cliffs, rivers, the beach and where buildings sit. Rivers that don’t connect, a missing town hall or two copies of one building can crash the game or leave you stuck. Keep your backup handy and change one acre at a time.', () => { s.set8(ACRES + i, a[0]); sfx.bell(); refresh(); })(); } },
              window.WW_ACRE_IMAGES[a[0]] ? h('img', { src: window.WW_ACRE_IMAGES[a[0]], alt: '' }) : null, h('span', { class: 'hx' }, a[0].toString(16).toUpperCase())))) ]));
        root.replaceChildren(h('div', { class: 'scrim', onclick: close }), h('div', { class: 'sheet' },
          h('div', { class: 'sheet-head' }, h('div', { class: 'top' }, h('h3', null, `Acre ${i % 6 + 1}, row ${((i / 6) | 0) + 1}`), h('button', { class: 'btn', onclick: close }, 'Done'))), body));
      }
      return [h('div', { class: 'callout' }, h('span', { class: 'em' }, '⚠️'), h('div', null, h('b', null, 'Acre edits can break a town'), 'Each building acre (town hall, museum, shop, gate, your house) must appear exactly once, rivers must line up, and the outer ring must stay cliffs, waterfall and ocean. Items sitting on an acre you replace stay where they are, even if that spot is now water.')),
        section('Layout', 'Click an acre to swap it'), h('div', { class: 'card' }, grid),
        section('Raw acre IDs'), card(row('All 36 acre IDs', 'Row by row from the top-left, in hex. Paste a layout from another town here.',
          textInput(() => [...s.bytes(ACRES, 36)].map(b => b.toString(16).padStart(2, '0')).join(' '), UI.guard('acres', 'Change acres?', 'Acres decide the shape of the land: cliffs, rivers, the beach and where buildings sit. Rivers that don’t connect, a missing town hall or two copies of one building can crash the game or leave you stuck. Keep your backup handy and change one acre at a time.', v => {
            const bytes = v.trim().split(/[\s,]+/).map(x => parseInt(x, 16));
            if (bytes.length !== 36 || bytes.some(b => !(b >= 0 && b <= 255))) { toast('Need exactly 36 hex bytes', '⚠️'); return; }
            s.setBytes(ACRES, bytes); refresh();
          }), 200, { width: 'w-l' }), ACRES, { risk: 'high' }))];
    },
  });
})();
