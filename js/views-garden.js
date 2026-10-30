// Flower breeding: the game's own hybrid table (data_020da300 in the decompilation, read by func_020492fc). When two
// flowers of the same kind grow side by side, the game can grow a new one in an empty spot beside them; its colour is
// drawn from this table with these odds. Colours are numbered 1… in item order within each kind.
(function () {
  'use strict';
  const { h, section, sfx, itemIcon } = UI;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const MAP = 0xC354;
  // [lo colour, hi colour, [[weight %, flower id], …]] per kind: tulips, pansies, cosmos, roses.
  const HYB = [[[1,1,[[80,0],[20,5]]],[1,2,[[35,0],[35,1],[30,3]]],[1,3,[[40,0],[40,2],[20,4]]],[1,4,[[50,0],[50,3]]],[1,5,[[50,0],[50,4]]],[1,6,[[50,0],[50,5]]],[2,2,[[100,1]]],[2,3,[[50,1],[50,2]]],[2,4,[[50,1],[50,3]]],[2,5,[[50,1],[50,4]]],[2,6,[[50,1],[50,5]]],[3,3,[[80,2],[20,5]]],[3,4,[[50,2],[50,3]]],[3,5,[[50,2],[50,4]]],[3,6,[[50,2],[50,5]]],[4,4,[[100,3]]],[4,5,[[50,3],[50,4]]],[4,6,[[50,3],[50,5]]],[5,5,[[100,4]]],[5,6,[[50,4],[50,5]]],[6,6,[[100,5]]]],[[1,1,[[80,6],[20,11]]],[1,2,[[50,6],[50,7]]],[1,3,[[50,6],[50,8]]],[1,4,[[50,6],[50,9]]],[1,5,[[50,6],[50,10]]],[1,6,[[50,6],[50,11]]],[2,2,[[100,7]]],[2,3,[[30,7],[30,8],[40,10]]],[2,4,[[50,7],[50,9]]],[2,5,[[50,7],[50,10]]],[2,6,[[50,7],[50,11]]],[3,3,[[70,8],[30,9]]],[3,4,[[50,8],[50,9]]],[3,5,[[50,8],[50,10]]],[3,6,[[50,8],[50,11]]],[4,4,[[100,9]]],[4,5,[[50,9],[50,10]]],[4,6,[[50,9],[50,11]]],[5,5,[[100,10]]],[5,6,[[50,10],[50,11]]],[6,6,[[100,11]]]],[[1,1,[[100,12]]],[1,2,[[35,12],[35,13],[30,15]]],[1,3,[[50,12],[50,14]]],[1,4,[[50,12],[50,15]]],[1,5,[[50,12],[50,16]]],[1,6,[[80,12],[20,17]]],[2,2,[[80,13],[20,17]]],[2,3,[[35,13],[35,14],[30,16]]],[2,4,[[50,13],[50,15]]],[2,5,[[50,13],[50,16]]],[2,6,[[50,13],[50,17]]],[3,3,[[100,14]]],[3,4,[[50,14],[50,15]]],[3,5,[[50,14],[50,16]]],[3,6,[[80,14],[20,17]]],[4,4,[[100,15]]],[4,5,[[50,15],[50,16]]],[4,6,[[80,15],[20,17]]],[5,5,[[100,16]]],[5,6,[[80,16],[20,17]]],[6,6,[[50,13],[50,17]]]],[[1,1,[[80,18],[20,24]]],[1,2,[[35,18],[35,19],[30,21]]],[1,3,[[35,18],[35,20],[30,22]]],[1,4,[[50,18],[50,21]]],[1,5,[[50,18],[50,22]]],[1,6,[[80,18],[20,23]]],[1,7,[[50,18],[50,24]]],[1,8,[[100,18]]],[2,2,[[80,19],[20,23]]],[2,3,[[50,19],[50,20]]],[2,4,[[35,19],[35,18],[30,21]]],[2,5,[[50,19],[50,22]]],[2,6,[[50,19],[50,23]]],[2,7,[[50,19],[50,24]]],[2,8,[[80,19],[20,25]]],[3,3,[[100,20]]],[3,4,[[50,20],[50,21]]],[3,5,[[35,20],[35,18],[30,22]]],[3,6,[[50,20],[50,23]]],[3,7,[[80,20],[20,24]]],[3,8,[[100,20]]],[4,4,[[100,21]]],[4,5,[[50,21],[50,22]]],[4,6,[[80,21],[20,23]]],[4,7,[[70,21],[30,24]]],[4,8,[[80,21],[20,25]]],[5,5,[[100,22]]],[5,6,[[50,22],[50,23]]],[5,7,[[50,22],[50,24]]],[5,8,[[80,22],[20,25]]],[6,6,[[100,23]]],[6,7,[[40,23],[40,24],[20,25]]],[6,8,[[80,23],[20,25]]],[7,7,[[50,24],[50,18]]],[7,8,[[80,24],[20,25]]],[8,8,[[20,25],[40,24],[40,23]]]]];
  const KINDS = [
    { name: 'Tulips', em: '🌷', base: 0x00, colors: ['Red', 'White', 'Yellow', 'Pink', 'Purple', 'Black'] },
    { name: 'Pansies', em: '🌼', base: 0x06, colors: ['White', 'Yellow', 'Red', 'Purple', 'Orange', 'Blue'] },
    { name: 'Cosmos', em: '🌸', base: 0x0C, colors: ['White', 'Red', 'Yellow', 'Pink', 'Orange', 'Black'] },
    { name: 'Roses', em: '🌹', base: 0x12, colors: ['Red', 'White', 'Yellow', 'Pink', 'Orange', 'Purple', 'Black', 'Blue'] },
  ];
  const SWATCH = { Red: '#e8473f', White: '#f6f6f2', Yellow: '#f4d23c', Pink: '#f59ac0', Purple: '#9a63d6', Black: '#3a3340', Orange: '#f39a3b', Blue: '#5b8fe6', Gold: '#e0b23a' };
  // A map item's kind and colour index (1-based), counting watered flowers as their plain colour.
  function flowerOf(v) {
    if (v >= 0x8A && v <= 0xA3) v -= 0x8A;
    if (v > 0x19) return null;
    const k = v < 0x06 ? 0 : v < 0x0C ? 1 : v < 0x12 ? 2 : 3;
    return { k, c: v - KINDS[k].base + 1 };
  }
  const results = (k, a, b) => { const [lo, hi] = a <= b ? [a, b] : [b, a]; const r = HYB[k].find(e => e[0] === lo && e[1] === hi); return r ? r[2] : []; };
  const colorOfId = (k, id) => KINDS[k].colors[id - KINDS[k].base];
  const dot = c => h('i', { class: 'fl-dot', style: { background: SWATCH[c] || '#ccc' }, title: c });

  let kind = 3, target = null;
  function render(s, refresh) {
    const K = KINDS[kind];
    // Which colours of this kind the town already grows.
    const grown = new Set();
    for (let i = 0; i < 4096; i++) { const f = flowerOf(s.u16(MAP + i * 2)); if (f && f.k === kind) grown.add(f.c); }
    // Every way to get each colour, best chance first.
    const ways = K.colors.map((c, ci) => {
      const list = [];
      for (const [lo, hi, res] of HYB[kind]) for (const [w, id] of res) if (colorOfId(kind, id) === c && !(lo === hi && lo === ci + 1) && lo !== ci + 1 && hi !== ci + 1) list.push({ lo, hi, w });
      return list.sort((a, b) => b.w - a.w);
    });
    // Pairs already side by side in town.
    const pairs = new Map();
    const at = (x, y) => s.u16(MAP + (((y >> 4) * 4 + (x >> 4)) * 256 + (y & 15) * 16 + (x & 15)) * 2);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const a = flowerOf(at(x, y)); if (!a || a.k !== kind) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= 64 || ny >= 64) continue;
        const b = flowerOf(at(nx, ny)); if (!b || b.k !== kind) continue;
        const key = a.c <= b.c ? a.c + ',' + b.c : b.c + ',' + a.c, e = pairs.get(key) || { lo: Math.min(a.c, b.c), hi: Math.max(a.c, b.c), n: 0, where: [] };
        e.n++; if (e.where.length < 3) e.where.push(String.fromCharCode(65 + (y >> 4)) + '-' + ((x >> 4) + 1)); pairs.set(key, e);
      }
    }
    const resultChips = res => res.map(([w, id]) => { const c = colorOfId(kind, id); return h('span', { class: 'fl-res' + (grown.has(id - K.base + 1) ? '' : ' new'), title: grown.has(id - K.base + 1) ? 'You already grow this colour' : 'A colour your town doesn’t have yet' }, dot(c), c, ' ', h('b', null, w + '%')); });
    const tabs = h('div', { class: 'tabs' }, KINDS.map((k, i) => h('button', { class: 'tab' + (i === kind ? ' on' : ''), onclick: () => { kind = i; target = null; sfx.click(); refresh(); } }, k.em, ' ', k.name)));
    const goal = h('div', { class: 'fl-goals' }, K.colors.map((c, ci) => h('button', { class: 'fl-goal' + (target === ci ? ' on' : '') + (grown.has(ci + 1) ? ' have' : ''), onclick: () => { target = target === ci ? null : ci; sfx.pop(); refresh(); } },
      dot(c), h('b', null, c), h('span', { class: 'muted' }, grown.has(ci + 1) ? 'in town' : ways[ci].length ? 'Hybrid' : 'Plant it'))));
    const best = target === null ? null : ways[target];
    return [
      tabs,
      section(`${K.em} Which colour do you want?`, 'Pick one to see the pairs that can make it'), h('div', { class: 'card pad' }, goal,
        best ? (best.length ? h('div', { class: 'fl-ways' }, best.slice(0, 8).map(wy => h('div', { class: 'fl-way' }, dot(K.colors[wy.lo - 1]), K.colors[wy.lo - 1], ' + ', dot(K.colors[wy.hi - 1]), K.colors[wy.hi - 1],
          h('span', { class: 'sp' }), h('b', null, wy.w + '%'), h('span', { class: 'muted' }, ' chance it’s ' + K.colors[target].toLowerCase()))))
          : h('div', { class: 'muted fl-ways' }, `${K.colors[target]} ${K.name.toLowerCase()} don’t come from crossing two other colours: plant them (Nook sells the bags), or breed two of them for more.`)) : null),
      section('🌱 Side by side in your town', pairs.size ? `${pairs.size} kind${pairs.size === 1 ? '' : 's'} of pair` : `No ${K.name.toLowerCase()} next to each other yet`),
      h('div', { class: 'card pad' }, pairs.size ? h('div', { class: 'fl-pairs' }, [...pairs.values()].sort((a, b) => b.n - a.n).map(p => h('div', { class: 'fl-pair' },
        h('div', null, dot(K.colors[p.lo - 1]), K.colors[p.lo - 1], ' + ', dot(K.colors[p.hi - 1]), K.colors[p.hi - 1], h('span', { class: 'muted' }, ` · ${p.n} pair${p.n === 1 ? '' : 's'} (${p.where.join(', ')})`)),
        h('div', { class: 'fl-resrow' }, resultChips(results(kind, p.lo, p.hi))))))
        : h('div', { class: 'muted' }, `Plant two ${K.name.toLowerCase()} next to each other (diagonals count too) with an empty spot beside them.`)),
      section(`📋 Every pair of ${K.name.toLowerCase()}`, 'The game’s own odds for the new flower’s colour'),
      h('div', { class: 'card pad fl-table-wrap' }, h('table', { class: 'fl-table' },
        h('tr', null, h('th'), K.colors.map(c => h('th', null, dot(c), h('span', null, c)))),
        K.colors.map((a, ai) => h('tr', null, h('th', null, dot(a), h('span', null, a)), K.colors.map((b, bi) => bi < ai ? h('td', { class: 'dim' }) : h('td', null, results(kind, ai + 1, bi + 1).map(([w, id]) => h('div', { class: 'fl-cell' }, dot(colorOfId(kind, id)), w + '%')))))))),
      kind === 3 ? h('div', { class: 'muted', style: { fontSize: '12px', textAlign: 'center', marginTop: '8px' } }, 'Gold roses don’t come from any pair: water a black rose with the golden watering can.') : null,
    ];
  }

  VIEWS.push({
    id: 'garden', group: 'Town', icon: '🌹', title: () => 'Flower Breeding', sub: () => 'The game’s own hybrid odds, and the pairs in your town',
    tips: ['Two flowers of the same kind growing side by side (diagonals count) can grow a new flower in an empty spot next to them.', 'Watered flowers count as their plain colour here.'],
    render(s, { refresh }) { return render(s, refresh); },
  });
})();
