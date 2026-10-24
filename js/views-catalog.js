// The real catalog: every item Nook's catalog can hold, with what each resident has registered (the catalog bits at
// player +0x1B48, laid out by Catalog_GetBit), and, once the player has opened their ROM, the game's own price, series,
// colors and Happy Room Academy points from ftr_info/*.bin and item_info/*.bin (FtrInfo_GetPrice / _GetSeries /
// _GetColor1/2 / _GetClass, Series_GetName). Also a set tracker with the HRA bonus each full set is worth.
(function () {
  'use strict';
  const { h, fmt, row, card, section, sfx, toast, itemIcon, itemLabel } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const CAT = 0x1B48;
  // sFtrClassBasePoints: HRA points per furniture class (FtrClass_GetBasePoints).
  const CLASS_POINTS = [51, 51, 51, 51, 151, 412, 1000, 828, 3, 3, 3, 3, 5, 3, 3, 300, 1000, 1111, 888, 412, 83, 1543, 3200, 3, 0, 0, 412, 1280, 325, 3, 912, 800, 800, 800, 3, 3, 3, 0, 151, 0, 1111, 1111, 0, 151, 151, 210];
  const COLORS = ['', 'Yellow', 'Red', 'Orange', 'Green', 'Blue', 'White', 'Black', 'Purple', 'Brown', 'Pink', 'Gray', 'Beige'];
  const SWATCH = ['', '#f3d43c', '#e2574c', '#f59a3b', '#5cc35a', '#4f8fe0', '#ffffff', '#3b3b3b', '#9b6ad6', '#9c6b3c', '#ff9ec7', '#a9a9a9', '#e8d3a8'];
  const SERIES_KIND = ['Series', 'Theme', 'Set', 'Other'];

  // ---------- the item list ----------
  const twin = new Map(D.items.filter(([id]) => id >= 0x1000 && id < 0x1600).map(([id, n, c]) => [n, c]));
  const fossils = new Set(D.fossils), paintings = new Set(D.paintings);
  const ENTRIES = [];
  for (const [id, name, cat] of D.items) {
    let kind = null;
    if (cat === 'Furniture') {
      if (id >= 0x42A4 && id <= 0x4463) continue;   // fish and bug models: the encyclopedia keeps those bits
      const t = twin.get(name);
      if (name === 'Garbage' || t === 'Flowers') continue;
      kind = t === 'Shirts' ? 'Clothing' : t === 'Umbrellas' ? 'Umbrellas' : t === 'Hats' || t === 'Glasses/Masks' ? 'Accessories'
        : fossils.has(name) || /(Skull|Torso|Tail|Chest|Hip|Neck|Body|Wing)$/.test(name) && id >= 0x450C ? 'Fossils'
        : paintings.has(name.replace(/ \(fake\)$/, '')) || name === 'Forged Painting' ? 'Art' : /oid$/.test(name) ? 'Gyroids' : /'s Pic$/.test(name) ? 'Pics' : 'Furniture';
    } else if (id >= 0x1100 && id <= 0x1143) kind = 'Wallpaper';
    else if (id >= 0x1144 && id <= 0x1187) kind = 'Carpets';
    else if (id >= 0x1323 && id <= 0x1368) kind = 'Songs';
    else if (id >= 0x1000 && id <= 0x10FF && (id & 3) === 0) kind = 'Stationery';
    if (kind) ENTRIES.push({ id, name, kind });
  }
  const KINDS = ['Furniture', 'Clothing', 'Accessories', 'Umbrellas', 'Wallpaper', 'Carpets', 'Songs', 'Stationery', 'Gyroids', 'Fossils', 'Art', 'Pics'];
  const KIND_EM = { Furniture: '🛋️', Clothing: '👕', Accessories: '🎩', Umbrellas: '☂️', Wallpaper: '🧱', Carpets: '🟫', Songs: '🎵', Stationery: '✉️', Gyroids: '🗿', Fossils: '🦴', Art: '🖼️', Pics: '📷' };

  // Catalog bit for an item (Catalog_GetBit): furniture by index, then wallpaper, carpets, songs and stationery.
  function bitOf(id) {
    if (id >= 0x3000 && id < 0x5000) return (id - 0x3000) >> 2;
    if (id >= 0x1100 && id <= 0x1143) return 0x100 * 8 + (id - 0x1100);
    if (id >= 0x1144 && id <= 0x1187) return 0x109 * 8 + (id - 0x1144);
    if (id >= 0x1323 && id <= 0x1368) return 0x112 * 8 + (id - 0x1323);
    if (id >= 0x1000 && id <= 0x10FF) return 0x11B * 8 + ((id - 0x1000) >> 2);
    return -1;
  }

  // ---------- game data from the ROM ----------
  let info = null, infoFor = null;
  function romInfo() {
    if (!window.ROM || !ROM.ready) return null;
    const fa = ROM.file('ftr_info/always.bin'), fd = ROM.file('ftr_info/dma.bin'), ia = ROM.file('item_info/always.bin'), ser = ROM.file('item_info/series.bin');
    if (!fa || !fd || !ia) return null;
    if (infoFor === fa) return info;
    const series = [];
    for (let i = 0; ser && i < 0x4A; i++) { let n = ''; for (let k = 1; k < 20 && ser[i * 20 + k]; k++) n += String.fromCharCode(ser[i * 20 + k]); series.push({ i, type: ser[i * 20], name: n.replace(/^Asian$/, 'Exotic').replace(/^T rex$/, 'T-Rex').replace('Savertooth', 'Sabertooth').replace('Seizmo', 'Seismo').trim() }); }
    const get = id => {
      if (id >= 0x3000 && id < 0x5000) {
        const n = Math.min((id - 0x3000) >> 2, 0x6E8), a = fa.subarray(n * 8, n * 8 + 8);
        return { price: fd[n * 0x1C] | (fd[n * 0x1C + 1] << 8), series: a[0], colors: [a[1], a[2]], cls: a[4], points: CLASS_POINTS[a[4]] || 0 };
      }
      const rec = k => { const i = Math.min(k & 0xFFF, 0x56D) * 12; return ia.subarray(i, i + 12); };
      let price = rec(id)[0] | (rec(id)[1] << 8);
      if (id >= 0x1000 && id <= 0x10FF) { const r = rec((id - 0x1000) | 3); price = ((r[0] | (r[1] << 8)) * ((id & 3) + 1)) << 14 >> 16; }
      return { price, series: rec(id)[5], colors: [0, 0], cls: -1, points: 0 };
    };
    info = { get, series }; infoFor = fa;
    return info;
  }

  // Where each item is right now: in the house (all rooms, both layers) or any resident's pockets and dresser.
  function placed(s) {
    const house = new Map(), kept = new Set();
    for (let k = 0; k < 5 * 0x450; k += 2) { const id = s.u16(0xE558 + k); if (id >= 0x3000 && id < 0x5000) { const b = id & ~3; house.set(b, (house.get(b) || 0) + 1); } }
    for (let p = 0; p < 4; p++) {
      if (!s.playerExists(p)) continue;
      const b = s.playerBase(p);
      for (let k = 0; k < 15; k++) kept.add(s.u16(b + 0x1B22 + k * 2));
      for (let k = 0; k < 90; k++) kept.add(s.u16(0x15430 + p * 0xB4 + k * 2));
    }
    return { house, kept };
  }

  // Shared with the Completion page and the Town Diary.
  window.WW_CATALOG = { ENTRIES, KINDS, KIND_EM, bitOf, romInfo, has: (s, p, e) => { const n = bitOf(e.id); return n >= 0 && !!s.bit(s.playerBase(p) + CAT, n); } };

  let who = null, kind = 'Furniture', q = '', status = 0, seriesPick = -1, color = 0, limit = 120, sort = 0;
  const players = s => [0, 1, 2, 3].filter(p => s.playerExists(p));
  const pname = (s, p) => s.str(s.playerBase(p) + 0x2282, 8);

  VIEWS.push({
    id: 'catalog', group: 'Museum', icon: '📖', title: () => 'Catalog', sub: () => 'Every item, your catalog, sets and HRA points',
    tips: ['Ticking an item registers it in that resident’s catalog, so Nook can order it.', 'Prices, series, colors and Happy Room Academy points come from your ROM. Open it on the Welcome screen to see them.'],
    hello: () => 'Psst! Here’s every item the catalog can hold. Tick what you want to be able to order from Nook!',
    render(s, { refresh, go }) {
      const ps = players(s);
      if (who === null || !ps.includes(who)) who = ps[0] ?? 0;
      const base = s.playerBase(who) + CAT;
      const has = e => { const n = bitOf(e.id); return n >= 0 && s.bit(base, n); };
      const set = (e, on) => { const n = bitOf(e.id); if (n >= 0) s.setBit(base, n, on); };
      const R = romInfo(), where = placed(s);
      const seriesName = i => (R && R.series[i] && R.series[i].name) || `Series ${i}`;
      const tab = UI.tabOf('catalog', 'items');
      const tabs = h('div', { class: 'seg', style: { marginBottom: '12px' } }, [['items', '📖 Items'], ['sets', '🧩 Sets and series']].map(([k, l]) =>
        h('button', { class: tab === k ? 'on' : '', onclick: () => { UI.setTab('catalog', k); sfx.click(); refresh(); } }, l)));
      const whoPick = h('select', { class: 'field w-m', onchange: e => { who = +e.target.value; refresh(); } }, ps.map(p => h('option', { value: p, selected: p === who }, `${pname(s, p)}’s catalog`)));
      const romNote = R ? null : h('div', { class: 'callout' }, h('span', { class: 'em' }, '🎮'), h('div', null, h('b', null, 'Prices, series and HRA points come from your ROM'), ' Open your Wild World ROM on the Welcome screen (once) to see them here.', ROM && ROM.ready ? ' Your saved game art is from an older Leaflet: open the ROM again to add these tables.' : ''));
      if (!ps.length) return [h('div', { class: 'card' }, h('div', { class: 'empty-note' }, 'No residents yet, so there’s no catalog to fill.'))];

      if (tab === 'sets') return [tabs, romNote, ...setsView(s, R, where, has, set, seriesName, whoPick, refresh)];

      // ---------- items ----------
      const totals = KINDS.map(k => { const l = ENTRIES.filter(e => e.kind === k); return [k, l.length, l.filter(has).length]; });
      let list = ENTRIES.filter(e => e.kind === kind);
      const ql = q.trim().toLowerCase();
      if (ql) list = ENTRIES.filter(e => e.name.toLowerCase().includes(ql));
      if (status === 1) list = list.filter(e => !has(e)); else if (status === 2) list = list.filter(has);
      else if (status === 3) list = list.filter(e => where.house.has(e.id));
      if (R && seriesPick >= 0) list = list.filter(e => R.get(e.id).series === seriesPick);
      if (R && color) list = list.filter(e => R.get(e.id).colors.includes(color));
      if (R && sort) list = list.slice().sort((a, b) => sort === 1 ? R.get(b.id).price - R.get(a.id).price : R.get(b.id).points - R.get(a.id).points);
      const shown = list.slice(0, limit);
      const search = h('input', { class: 'field w-m', type: 'search', placeholder: 'Search every item…', value: q });
      search.oninput = () => { q = search.value; limit = 120; clearTimeout(search._t); search._t = setTimeout(() => { refresh(); const el = document.querySelector('.cat-bar input[type=search]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); };
      const seriesOpts = R ? [[-1, 'Any series or set'], ...R.series.filter(x => x.type < 3).map(x => [x.i, `${x.name} (${SERIES_KIND[x.type].toLowerCase()})`])] : [];
      const rowFor = e => {
        const g = R ? R.get(e.id) : null, on = has(e), inHouse = where.house.get(e.id), kept = where.kept.has(e.id);
        const cb = h('input', { type: 'checkbox', title: on ? 'In the catalog' : 'Not in the catalog' });
        cb.checked = on;
        cb.onchange = () => { set(e, cb.checked); sfx.toggle(cb.checked); el.classList.toggle('on', cb.checked); };
        const el = h('label', { class: 'cat-row' + (on ? ' on' : '') }, cb, h('span', { class: 'cat-ico' }, itemIcon(e.id)),
          h('div', { class: 'cat-main' }, h('b', null, e.name),
            h('div', { class: 'muted' }, [g && g.series < 73 ? seriesName(g.series) : null, inHouse ? `${inHouse} in the house` : null, kept ? 'in pockets or a dresser' : null, ql ? e.kind : null].filter(Boolean).join(' · '))),
          g ? h('span', { class: 'cat-sw' }, g.colors.filter(Boolean).map(c => h('i', { style: { background: SWATCH[c] }, title: COLORS[c] }))) : null,
          g && g.points ? h('span', { class: 'cat-pts', title: 'Happy Room Academy points' }, `${fmt(g.points)} pts`) : null,
          g ? h('span', { class: 'cat-price' }, g.price ? `${fmt(g.price)} 🔔` : '—') : null);
        return el;
      };
      const fillShown = on => { for (const e of list) set(e, on); sfx.bell(); toast(on ? `Added ${list.length} items to the catalog` : `Removed ${list.length} items`, '📖'); refresh(); };
      return [tabs, romNote,
        h('div', { class: 'cat-kinds' }, totals.map(([k, n, got]) => h('button', { class: 'cat-kind' + (k === kind && !ql ? ' on' : ''), onclick: () => { kind = k; q = ''; limit = 120; seriesPick = -1; sfx.click(); refresh(); } },
          h('span', { class: 'em' }, KIND_EM[k]), h('b', null, k), h('span', { class: 'muted' }, `${got} / ${n}`), h('div', { class: 'progress' }, h('i', { style: { width: (got / n * 100).toFixed(1) + '%' } }))))),
        h('div', { class: 'card pad cat-bar' }, whoPick, search,
          UI.selectInput([[0, 'Everything'], [1, 'Not in the catalog'], [2, 'In the catalog'], [3, 'In the house now']], () => status, v => { status = v; limit = 120; refresh(); }, { width: 'w-m' }),
          R ? UI.selectInput(seriesOpts, () => seriesPick, v => { seriesPick = v; limit = 120; refresh(); }, { width: 'w-m' }) : null,
          R ? UI.selectInput(COLORS.map((c, i) => [i, i ? c : 'Any color']), () => color, v => { color = v; refresh(); }, { width: 'w-m' }) : null,
          R ? UI.selectInput([[0, 'By name'], [1, 'Priciest first'], [2, 'Most HRA points']], () => sort, v => { sort = v; refresh(); }, { width: 'w-m' }) : null),
        section(ql ? `Matching “${q}”` : `${KIND_EM[kind]} ${kind}`, `${list.length} item${list.length === 1 ? '' : 's'} · ${list.filter(has).length} in ${pname(s, who)}’s catalog`),
        h('div', { class: 'btn-row', style: { marginBottom: '8px' } },
          h('button', { class: 'btn small leaf', onclick: () => fillShown(true) }, `Add all ${list.length}`), h('button', { class: 'btn small', onclick: () => fillShown(false) }, 'Remove all')),
        h('div', { class: 'card cat-list' }, shown.length ? shown.map(rowFor) : h('div', { class: 'empty-note' }, 'Nothing matches.')),
        list.length > limit ? h('div', { style: { textAlign: 'center', margin: '10px 0' } }, h('button', { class: 'btn small', onclick: () => { limit += 240; refresh(); } }, `Show more (${list.length - limit} left)`)) : null,
      ];
    },
  });

  // ---------- sets and series ----------
  function setsView(s, R, where, has, set, seriesName, whoPick, refresh) {
    if (!R) return [h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🧩'), 'Sets and series are read from your ROM. Open it on the Welcome screen to track them.'))];
    const groups = new Map();
    for (const e of ENTRIES) { if (e.kind === 'Wallpaper' || e.kind === 'Carpets' || e.id < 0x3000) continue; const g = R.get(e.id); if (g.series >= 73) continue; if (!groups.has(g.series)) groups.set(g.series, []); groups.get(g.series).push(e); }
    const walls = ENTRIES.filter(e => e.kind === 'Wallpaper' || e.kind === 'Carpets');
    const block = type => [...groups.entries()].filter(([i]) => R.series[i] && R.series[i].type === type).map(([i, items]) => {
      const n = items.length, got = items.filter(has).length, home = items.filter(e => where.house.has(e.id)).length;
      const wf = walls.filter(e => R.get(e.id).series === i);
      const bonus = type === 0 ? `${fmt(20000)} pts for all 10 in one room, ${fmt(30000)} with the matching wallpaper and carpet` : type === 1 ? `${fmt((n + 1) * 3000)} pts with the theme’s wallpaper and carpet` : `${fmt(n * 1000)} pts for the full set in one room`;
      return h('div', { class: 'set-card' + (got === n ? ' done' : '') },
        h('div', { class: 'set-h' }, h('b', null, seriesName(i)), h('span', { class: 'muted' }, `${got} / ${n} in catalog · ${home} in the house`), got === n ? h('span', { class: 'badge ok' }, 'Complete') : null),
        h('div', { class: 'progress' }, h('i', { style: { width: (got / n * 100).toFixed(1) + '%' } })),
        h('div', { class: 'set-items' }, [...items, ...wf].map(e => {
          const on = has(e);
          return h('button', { class: 'set-it' + (on ? ' on' : '') + (where.house.has(e.id) ? ' home' : ''), title: `${e.name}${on ? ' · in the catalog' : ''}${where.house.has(e.id) ? ' · in the house' : ''}. Click to toggle.`, onclick: () => { set(e, !on); sfx.toggle(!on); refresh(); } }, itemIcon(e.id), h('span', null, e.name));
        })),
        h('div', { class: 'set-f' }, h('span', { class: 'muted' }, `HRA: ${bonus}.`), got < n ? h('button', { class: 'btn small', onclick: () => { [...items, ...wf].forEach(e => set(e, true)); sfx.bell(); refresh(); } }, 'Add the rest') : null));
    });
    return [h('div', { class: 'card pad cat-bar' }, whoPick, h('span', { class: 'muted' }, 'Gold outline: in the house right now. Ticked: in the catalog.')),
      section('🛋️ Furniture series', 'Ten matching pieces, plus wallpaper and carpet'), h('div', { class: 'set-grid' }, block(0)),
      section('🎭 Themes', 'Every piece of a theme with its wallpaper and carpet'), h('div', { class: 'set-grid' }, block(1)),
      section('🧸 Sets', 'Small groups that score as a set'), h('div', { class: 'set-grid' }, block(2))];
  }
})();
