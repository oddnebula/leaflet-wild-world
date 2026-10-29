// Pattern library: every design in every version Leaflet has kept (Backups) and in the save that's open, found once
// each: residents' 8 designs, the Able Sisters' 8 displays, the town flag and each neighbor's design. Any of them can
// be downloaded or copied into a slot of the open save.
(function () {
  'use strict';
  const { h, sfx, toast, drawPattern, section } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const byId = new Map(D.villagers.map(v => [v.id, v]));
  const SIZE = 0x228, ABLE = 0xFAFC, FLAG = 0x15930, VB = 0x8A3C;

  // Every pattern slot in a save, with a label for where it is.
  function slots(s) {
    const out = [];
    for (let p = 0; p < 4; p++) {
      if (!s.playerExists(p)) continue;
      const b = s.playerBase(p), n = s.str(b + 0x2282, 8);
      for (let k = 0; k < 8; k++) out.push({ off: b + k * SIZE, kind: 'resident', where: `${n}’s design ${k + 1}` });
    }
    for (let k = 0; k < 8; k++) out.push({ off: ABLE + k * SIZE, kind: 'able', where: `Able Sisters display ${k + 1}` });
    out.push({ off: FLAG, kind: 'flag', where: 'Town flag' });
    for (let v = 0; v < 8; v++) { const id = s.u8(VB + v * 0x700 + 0x6CB); if (id !== 0xFF) out.push({ off: VB + v * 0x700 + 0x340, kind: 'villager', where: `${byId.get(id)?.name || 'A neighbor'}’s design` }); }
    return out;
  }
  const KIND = { resident: '🧑 Residents', able: '🧵 Able Sisters', flag: '🚩 Town flag', villager: '🐾 Neighbors' };
  function key(b) { let x = 0x811C9DC5; for (let i = 0; i < 0x200; i++) { x ^= b[i]; x = Math.imul(x, 0x01000193) >>> 0; } return `${x.toString(16)}-${b[0x226] >> 4}`; }
  const empty = b => { for (let i = 0; i < 0x200; i++) if (b[i]) return false; return true; };
  const view = b => ({ u8: o => b[o] });   // drawPattern reads through u8()
  const str = (s, b, o, n) => s.str(o, n, b);

  // ---------- Leaflet's pattern pack ----------
  // Original designs drawn for Leaflet, in the spirit of Wild World's (no designs copied from the game, guide books
  // or other players). Each is written in plain colours; Leaflet picks the game palette and colours that fit best.
  const W = '#ffffff', CREAM = '#fff7bd';
  const PACK = [
    ['Gingham picnic', (x, y) => ((x >> 2) & 1) && ((y >> 2) & 1) ? '#ff0000' : ((x >> 2) & 1) || ((y >> 2) & 1) ? '#ff8c8c' : W],
    ['Mint gingham', (x, y) => ((x >> 2) & 1) && ((y >> 2) & 1) ? '#5acea5' : ((x >> 2) & 1) || ((y >> 2) & 1) ? '#b5ffde' : W],
    ['Polka dots', (x, y) => (((x % 8) - 3.5) ** 2 + ((y % 8) - 3.5) ** 2 < 5 ? W : '#ff4a6b')],
    ['Sky dots', (x, y) => (((x + (y >> 3 & 1) * 4) % 8 - 3.5) ** 2 + ((y % 8) - 3.5) ** 2 < 4 ? W : '#5aadff')],
    ['Leaf', (x, y) => { const dx = x - 15.5, dy = y - 15.5, r = (dx * dx) / 150 + (dy * dy) / 300; return Math.abs(dx - dy * 0.2) < 0.8 && r < 1 ? '#009c00' : r < 1 ? '#5ace6b' : '#b5ffde'; }],
    ['Falling leaves', (x, y) => { const cx = (x % 16) - 7.5, cy = (y % 16) - 7.5, r = (cx + cy) ** 2 / 40 + (cx - cy) ** 2 / 14; return r < 1 ? ((x >> 4) + (y >> 4)) & 1 ? '#ff7b00' : '#d6b500' : '#ffefad'; }],
    ['Apple', (x, y) => { const r = Math.hypot(x - 15.5, y - 18); return r < 10 ? (Math.hypot(x - 12, y - 14) < 3 ? '#ffd6d6' : '#ff0000') : x >= 15 && x <= 16 && y >= 4 && y < 9 ? '#7b1000' : Math.hypot(x - 20, y - 6) < 3 ? '#00ff00' : W; }],
    ['Cherries', (x, y) => Math.hypot(x - 10, y - 21) < 5 || Math.hypot(x - 21, y - 22) < 5 ? '#bd1000' : Math.abs(y - (6 + (x - 10) * 0.4)) < 0.8 && x > 9 && x < 22 || (Math.abs(x - 15) < 0.8 && y > 6 && y < 17) ? '#00847b' : '#ffd6d6'],
    ['Strawberry', (x, y) => { const r = Math.hypot((x - 15.5) * 1.1, (y - 17) * 0.9); return y < 9 && Math.abs(x - 15.5) < 7 - (9 - y) * 0.6 ? '#00ff00' : r < 11 ? ((x + y * 3) % 6 === 0 ? '#fffff0' : '#ff0000') : W; }],
    ['Waves', (x, y) => (Math.abs(((y + 2 * Math.sin(x / 2.6)) % 8) - 4) < 1.1 ? W : '#0052ad')],
    ['Sea waves', (x, y) => { const cx = x % 16, cy = (y % 8) * 2; const r = Math.hypot(cx - 8, cy - 16); return Math.floor(r / 2.6) % 2 ? '#5aadff' : '#0052ad'; }],
    ['Sunset', (x, y) => ['#ffbd9c', '#ffb55a', '#ff5200', '#ff0000', '#a54a31', '#7b1000'][Math.min(5, y / 5.4 | 0)]],
    ['Rainbow', (x, y) => ['#ff0000', '#ff7b00', '#ffff00', '#00ff00', '#0000ff', '#7b00ff', '#ff94ff'][Math.min(6, y / 4.6 | 0)]],
    ['Starry night', (x, y) => ((x * 7 + y * 13) % 29 === 0 || (x * 11 + y * 5) % 37 === 0 ? '#ffff00' : y < 16 ? '#00008c' : '#1821b5')],
    ['Big star', (x, y) => { const a = Math.atan2(y - 16, x - 16), r = Math.hypot(x - 16, y - 16); return r < 6 + 7 * Math.abs(Math.cos(2.5 * a)) ** 3 ? '#ffff00' : '#0000ff'; }],
    ['Heart', (x, y) => { const u = (x - 15.5) / 11, v = (14 - y) / 11; return (u * u + v * v - 1) ** 3 - u * u * v * v * v < 0 ? '#ff0839' : '#ffceff'; }],
    ['Bricks', (x, y) => (y % 6 === 0 || (x + ((y / 6 | 0) % 2) * 4) % 8 === 0 ? '#ffde8c' : '#bd634a')],
    ['Wood planks', (x, y) => (x % 8 === 0 ? '#7b1000' : (Math.sin(y / 2 + x * 0.3) > 0.7 ? '#a54a29' : '#d68c5a'))],
    ['Tatami', (x, y) => (x % 16 === 0 || y % 16 === 0 ? '#426342' : (y % 2 ? '#c6d6c6' : '#849c84'))],
    ['Checkerboard', (x, y) => (((x >> 3) + (y >> 3)) & 1 ? '#000000' : W)],
    ['Pastel check', (x, y) => [['#ffd6d6', '#d6d6ff'], ['#d6ffd6', '#ffffd6']][(y >> 3) & 1][(x >> 3) & 1]],
    ['Stripes', (x, y) => ((x >> 2) & 1 ? '#ffff00' : '#ff7b00')],
    ['Candy stripes', (x, y) => (((x + y) >> 2) & 1 ? '#ff0000' : W)],
    ['Zigzag', (x, y) => ((((y + Math.abs((x % 8) - 4)) >> 2) & 1) ? '#0000ff' : '#ffff00')],
    ['Flower field', (x, y) => { const cx = (x % 8) - 3.5, cy = (y % 8) - 3.5, r = Math.hypot(cx, cy); return r < 1.2 ? '#ffff00' : r < 3 && Math.abs(Math.sin(Math.atan2(cy, cx) * 2.5)) > 0.3 ? ((x >> 3) + (y >> 3)) & 1 ? W : '#ff8cff' : '#00ff00'; }],
    ['Clover', (x, y) => { const p = [[12, 11], [20, 11], [16, 17], [16, 6]].slice(0, 3); return p.some(([a, b]) => Math.hypot(x - a, y - b) < 5) ? '#009c00' : Math.abs(x - 16 - (y - 22) * 0.3) < 0.9 && y > 18 ? '#003100' : '#d6ffd6'; }],
    ['Mushroom', (x, y) => y < 17 && Math.hypot(x - 15.5, (y - 17) * 1.3) < 14 ? (Math.hypot(x - 10, y - 9) < 3 || Math.hypot(x - 20, y - 7) < 3 || Math.hypot(x - 16, y - 13) < 2.5 ? W : '#ff0000') : y >= 17 && y < 29 && Math.abs(x - 15.5) < 5 ? '#ffefad' : '#00a5c6'],
    ['Fishbone', (x, y) => ((Math.abs(y % 8 - 4) < 0.6 && x % 16 > 2) || (x % 16 > 3 && x % 16 < 13 && x % 3 === 0 && Math.abs(y % 8 - 4) < 3) || Math.hypot(x % 16 - 2, y % 8 - 4) < 2 ? '#d6dee7' : '#739cb5')],
    ['Cloud puffs', (x, y) => { const cx = x % 16, cy = y % 16; return Math.hypot(cx - 5, cy - 9) < 4 || Math.hypot(cx - 10, cy - 8) < 5 || Math.hypot(cx - 8, cy - 11) < 3.5 ? W : '#84c6ff'; }],
    ['Seigaiha', (x, y) => { const row = y >> 3, cx = (x + (row & 1) * 4) % 8, cy = y % 8; const r = Math.hypot(cx - 4, cy - 8); return Math.floor(r) % 2 ? '#0052ad' : W; }],
    ['Grass', (x, y) => ((x * 5 + y * 3) % 7 === 0 ? '#ccf7aa' : (x + y * 2) % 5 === 0 ? '#319c31' : '#5ace6b')],
    ['Plaid', (x, y) => { const a = (x % 12) < 3, b = (y % 12) < 3; return a && b ? '#7b1000' : a || b ? '#bd634a' : (x + y) % 2 ? '#d6ad42' : '#ffde8c'; }],
  ];
  function packRecord(name, f) {
    const px = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) px.push(f(x, y));
    const rgb = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const want = [...new Set(px)].map(c => [c, rgb(c)]);
    let best = null;
    D.palettes.forEach((pal, pi) => {
      const P = pal.map(rgb); let err = 0; const map = new Map();
      for (const [c, v] of want) { let bi = 0, bd = 1e9; P.forEach((q, i) => { const d = (q[0] - v[0]) ** 2 + (q[1] - v[1]) ** 2 + (q[2] - v[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); err += bd; map.set(c, bi + 1); }
      if (!best || err < best.err) best = { err, pi, map };
    });
    const b = new Uint8Array(SIZE);
    for (let i = 0; i < 1024; i += 2) b[i >> 1] = best.map.get(px[i]) | (best.map.get(px[i + 1]) << 4);
    b.set(WWSave.encode('Leaflet', 8), 0x20C);
    b.set(WWSave.encode(name, 16), 0x216);
    b[0x226] = best.pi << 4;
    return { key: 'pack-' + name, bytes: b, name, by: 'Leaflet', byTown: '', kinds: new Set(['pack']), towns: new Set(), seen: [], first: Date.now(), last: Date.now(), pack: true };
  }
  let pack = null;
  const packList = () => pack || (pack = PACK.map(([n, f]) => packRecord(n, f)));

  let cache = null, q = '', kindPick = 'all', townPick = 'all', open = null;
  async function build(refresh) {
    const found = new Map();
    const addFrom = (s, town, when, label) => {
      for (const sl of slots(s)) {
        const b = s.m.slice(sl.off, sl.off + SIZE);
        if (empty(b)) continue;
        const k = key(b);
        if (!found.has(k)) found.set(k, { key: k, bytes: b, name: str(s, b, 0x216, 16) || 'Untitled', by: str(s, b, 0x20C, 8), byTown: str(s, b, 0x202, 8), kinds: new Set(), towns: new Set(), seen: [], first: when, last: when });
        const e = found.get(k);
        e.kinds.add(sl.kind); e.towns.add(town); e.first = Math.min(e.first, when); e.last = Math.max(e.last, when);
        if (e.seen.length < 30 && !e.seen.some(x => x.where === sl.where && x.town === town)) e.seen.push({ where: sl.where, town, label });
      }
    };
    const snaps = window.Backups ? (await Backups.all()).filter(r => r.kind !== 'draft').sort((a, b) => a.when - b.when) : [];
    for (const r of snaps) { try { addFrom(new WWSave(new Uint8Array(r.bytes), 'x.sav'), r.town, r.when, new Date(r.when).toLocaleDateString()); } catch (e) { /* skip damaged */ } }
    if (APP.save) addFrom(APP.save, APP.save.str(4, 8), Date.now(), 'open now');
    cache = [...found.values()].sort((a, b) => b.last - a.last);
    cache.save = APP.save;
    refresh();
  }

  function tile(e, onClick) {
    const cv = h('canvas', { width: 32, height: 32 });
    drawPattern(cv, view(e.bytes), 0);
    return h('button', { class: 'pattern-tile lib', onclick: onClick }, cv, h('div', { class: 'nm' }, e.name), h('div', { class: 's' }, e.by ? `by ${e.by}` : [...e.kinds].map(k => KIND[k].split(' ')[0]).join(' ')));
  }
  function download(name, blob) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

  // Where a library pattern can go in the open save.
  function destinations(s) { return slots(s).map((sl, i) => [i, `${sl.where}${empty(s.m.slice(sl.off, sl.off + 0x200)) ? ' (empty)' : ` · ${s.str(sl.off + 0x216, 16) || 'Untitled'}`}`, sl]); }

  function detail(e, refresh) {
    const big = h('canvas'); drawPattern(big, view(e.bytes), 0, 8);
    const s = APP.save, dests = s ? destinations(s) : [];
    let to = 0;
    return h('div', { class: 'card pad lib-detail' },
      h('div', { class: 'lib-big' }, big),
      h('div', { class: 'lib-info' },
        h('div', { style: { fontWeight: 800, fontSize: '18px' } }, e.name),
        h('div', { class: 'muted' }, e.by ? `Made by ${e.by}${e.byTown ? ` of ${e.byTown}` : ''}` : 'No creator recorded'),
        h('div', { class: 'muted', style: { fontSize: '12px' } }, `Palette ${(e.bytes[0x226] >> 4) + 1} · first kept ${new Date(e.first).toLocaleDateString()}`),
        e.pack ? h('div', { class: 'muted', style: { marginTop: '8px' } }, 'From Leaflet’s pattern pack: an original design, free to use and share.') : [
          h('div', { class: 'ps-label', style: { marginTop: '8px' } }, 'FOUND IN'),
          h('ul', { class: 'lib-seen' }, e.seen.map(x => h('li', null, `${x.where}, ${x.town} (${x.label})`)))],
        s ? h('div', { class: 'ps-row', style: { marginTop: '8px' } },
          UI.selectInput(dests.map(([i, label]) => [i, label]), () => to, v => { to = v; }, { width: 'w-l' }),
          h('button', { class: 'btn small leaf', onclick: async () => {
            const sl = dests[to][2];
            if (!empty(s.m.slice(sl.off, sl.off + 0x200)) && !await UI.confirmSheet('Replace this design?', `${sl.where} already has “${s.str(sl.off + 0x216, 16) || 'Untitled'}”. It stays in Backups if you change your mind.`, 'Replace')) return;
            s.setBytes(sl.off, e.bytes); if (window.PatternStudio) PatternStudio.forget(sl.off); sfx.bell(); toast(`Copied into ${sl.where}`, '🎨');
          } }, 'Copy into this save')) : h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, 'Open a save to copy this design into it.'),
        h('div', { class: 'btn-row', style: { marginTop: '8px' } },
          h('button', { class: 'btn small', onclick: () => { const c = h('canvas'); drawPattern(c, view(e.bytes), 0, 8); c.toBlob(b => download(`${e.name}.png`, b)); } }, '⬇︎ PNG'),
          h('button', { class: 'btn small', onclick: () => download(`${e.name}.acww`, new Blob([e.bytes])) }, '⬇︎ .acww'),
          h('button', { class: 'btn small', onclick: () => { open = null; refresh(); } }, 'Close'))));
  }

  VIEWS.push({
    id: 'patterns', group: 'Home', icon: '🖼️', noSave: true, title: () => 'Pattern Library', sub: () => 'Wendell’s designs, Leaflet’s pattern pack, and every design from your towns',
    tips: ['Designs come from your Backups and the open save, each shown once even if it appears in many places.', 'Copying a design into the open save is an ordinary edit: save to keep it.'],
    render(s, { refresh }) {
      if (cache && cache.save !== APP.save) cache = null;
      if (!cache) { build(refresh); return [h('div', { class: 'card pad muted' }, 'Gathering designs from your backups…')]; }
      const towns = [...new Set(cache.flatMap(e => [...e.towns]))];
      const ql = q.trim().toLowerCase();
      const list = cache.filter(e => (kindPick === 'all' || e.kinds.has(kindPick)) && (townPick === 'all' || e.towns.has(townPick)) && (!ql || `${e.name} ${e.by} ${e.byTown}`.toLowerCase().includes(ql)));
      const search = h('input', { class: 'field w-m', type: 'search', placeholder: 'Search names and creators…', value: q });
      search.oninput = () => { q = search.value; clearTimeout(search._t); search._t = setTimeout(() => { refresh(); const el = document.querySelector('.lib-bar input[type=search]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); };
      const sel = (opts, get, set) => { const el = h('select', { class: 'field w-m' }, opts.map(([v, l]) => h('option', { value: v, selected: v === get() }, l))); el.onchange = () => { set(el.value); sfx.click(); refresh(); }; return el; };
      const openEntry = open && (cache.find(e => e.key === open) || packList().find(e => e.key === open));
      // Wendell: the 32 designs he trades for fish, by name from the ROM; the ones already in your towns can be used.
      const builtIn = window.ROM && ROM.ready && ROM.builtInDesigns ? ROM.builtInDesigns() : null;
      const wendellNames = builtIn ? builtIn.filter(d => d.by === 'Wendell').map(d => d.name) : [];
      const fromWendell = cache.filter(e => e.by === 'Wendell');
      const owned = n => fromWendell.find(e => e.name.toLowerCase() === n.toLowerCase());
      const pick = e => { open = e.key; sfx.pop(); refresh(); document.getElementById('content').scrollTop = 0; };
      const wendell = [
        h('div', { class: 'wendell-hero' },
          h('div', { class: 'wh-sea' }, h('span', { class: 'wh-boat' }, '⛵'), h('span', { class: 'wh-fish' }, '🐟')),
          h('div', { class: 'wh-text' },
            h('h2', null, '🎨 Wendell’s corner'),
            h('p', null, 'Wendell the wandering artist turns up on a weekday, hungry. Give him a fish or some fruit and he hands over one of his designs. Here are all of his designs, the ones you’ve already been given, and Leaflet’s own pattern pack.'))),
        section('🐟 Wendell’s designs', builtIn ? `${wendellNames.filter(owned).length} of ${wendellNames.length} in your towns` : `${fromWendell.length} in your towns`),
        h('div', { class: 'card' }, h('div', { class: 'patterns wendell-list' },
          builtIn ? wendellNames.map(n => { const e = owned(n); return e ? tile(e, () => pick(e)) : h('div', { class: 'pattern-tile lib missing', title: 'Not in any of your towns yet' }, h('div', { class: 'wh-q' }, '?'), h('div', { class: 'nm' }, n), h('div', { class: 's' }, 'Trade Wendell a fish')); })
            : fromWendell.map(e => tile(e, () => pick(e)))),
          h('div', { class: 'muted', style: { padding: '0 16px 12px', fontSize: '12px' } }, builtIn
            ? 'Names from your ROM. A design appears here, ready to copy into any slot, once it’s in one of your towns: in the open save or any version in Backups.'
            : fromWendell.length ? 'Open your ROM on the Welcome screen to see the whole list of his designs.' : 'Open your ROM on the Welcome screen to see his whole list. Designs he gave you appear here once they’re in a save Leaflet has opened.')),
        section('🍃 Leaflet’s pattern pack', `${packList().length} original designs, free to use`),
        h('div', { class: 'card' }, h('div', { class: 'patterns' }, packList().map(e => tile(e, () => pick(e))))),
      ];
      return [
        openEntry ? detail(openEntry, refresh) : null,
        ...wendell,
        section('🏡 From your towns', 'Every design from every version Backups has kept'),
        h('div', { class: 'card pad cat-bar lib-bar' }, search,
          sel([['all', 'Everywhere'], ...Object.entries(KIND)], () => kindPick, v => { kindPick = v; }),
          towns.length > 1 ? sel([['all', 'All towns'], ...towns.map(t => [t, t])], () => townPick, v => { townPick = v; }) : null,
          h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => { cache = null; refresh(); } }, 'Refresh')),
        section('🖼️ Designs', `${list.length} of ${cache.length}`),
        cache.length ? null : h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🖼️'), 'No designs from your towns yet. Open a save: its designs, and every version Backups keeps, show up here.')),
        h('div', { class: 'card' }, h('div', { class: 'patterns' }, list.map(e => tile(e, () => { open = e.key; sfx.pop(); refresh(); document.getElementById('content').scrollTop = 0; })))),
      ];
    },
  });
  if (window.Backups && Backups.onChange) Backups.onChange(() => { cache = null; if (APP.view === 'patterns') APP.go('patterns'); });
  window.WW_PATTERN_LIBRARY = { slots, rebuild: () => { cache = null; } };
})();
