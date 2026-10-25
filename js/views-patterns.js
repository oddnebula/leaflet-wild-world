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
        h('div', { class: 'ps-label', style: { marginTop: '8px' } }, 'FOUND IN'),
        h('ul', { class: 'lib-seen' }, e.seen.map(x => h('li', null, `${x.where}, ${x.town} (${x.label})`))),
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
    id: 'patterns', group: 'Home', icon: '🖼️', noSave: true, title: () => 'Pattern Library', sub: () => 'Every design from every version of your towns',
    tips: ['Designs come from your Backups and the open save, each shown once even if it appears in many places.', 'Copying a design into the open save is an ordinary edit: save to keep it.'],
    render(s, { refresh }) {
      if (cache && cache.save !== APP.save) cache = null;
      if (!cache) { build(refresh); return [h('div', { class: 'card pad muted' }, 'Gathering designs from your backups…')]; }
      if (!cache.length) return [h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🖼️'), 'No designs yet. Open a save: its designs, and every version Backups keeps, show up here.'))];
      const towns = [...new Set(cache.flatMap(e => [...e.towns]))];
      const ql = q.trim().toLowerCase();
      const list = cache.filter(e => (kindPick === 'all' || e.kinds.has(kindPick)) && (townPick === 'all' || e.towns.has(townPick)) && (!ql || `${e.name} ${e.by} ${e.byTown}`.toLowerCase().includes(ql)));
      const search = h('input', { class: 'field w-m', type: 'search', placeholder: 'Search names and creators…', value: q });
      search.oninput = () => { q = search.value; clearTimeout(search._t); search._t = setTimeout(() => { refresh(); const el = document.querySelector('.lib-bar input[type=search]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); };
      const sel = (opts, get, set) => { const el = h('select', { class: 'field w-m' }, opts.map(([v, l]) => h('option', { value: v, selected: v === get() }, l))); el.onchange = () => { set(el.value); sfx.click(); refresh(); }; return el; };
      const openEntry = open && cache.find(e => e.key === open);
      return [
        h('div', { class: 'card pad cat-bar lib-bar' }, search,
          sel([['all', 'Everywhere'], ...Object.entries(KIND)], () => kindPick, v => { kindPick = v; }),
          towns.length > 1 ? sel([['all', 'All towns'], ...towns.map(t => [t, t])], () => townPick, v => { townPick = v; }) : null,
          h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => { cache = null; refresh(); } }, 'Refresh')),
        openEntry ? detail(openEntry, refresh) : null,
        section('🖼️ Designs', `${list.length} of ${cache.length}`),
        h('div', { class: 'card' }, h('div', { class: 'patterns' }, list.map(e => tile(e, () => { open = e.key; sfx.pop(); refresh(); document.getElementById('content').scrollTop = 0; })))),
      ];
    },
  });
  if (window.Backups && Backups.onChange) Backups.onChange(() => { cache = null; if (APP.view === 'patterns') APP.go('patterns'); });
  window.WW_PATTERN_LIBRARY = { slots, rebuild: () => { cache = null; } };
})();
