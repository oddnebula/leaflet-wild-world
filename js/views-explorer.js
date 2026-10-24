// Save Explorer: a developer view of the whole save as typed structs (js/schema.js), with inline editors and an
// editable hex dump that highlights the selected field. Every byte of the main block can be changed here.
(function () {
  'use strict';
  const { h, hex, sfx, toast, itemLabel, pickItem } = UI;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const D = window.WW_DATA;
  const { S, sizeOf } = window.WW_SCHEMA;
  const byId = new Map(D.villagers.map(v => [v.id, v]));
  const FRUIT = ['Apple', 'Orange', 'Pear', 'Peach', 'Cherry'];

  let sel = { path: [], off: 0, type: { t: 'struct', s: 'SaveData' } };   // current node
  let hover = null, query = '';
  let hexFrom = null;                 // first row of the hex window (null: start of the selection)
  const bytePage = new Map();         // raw block offset -> which 64-byte page its bit editor shows
  const open = new Set(['']);

  function typeName(t) {
    if (typeof t === 'string') return t;
    if (t.t === 'str') return `char[${t.n}]`;
    if (t.t === 'bytes') return `u8[0x${t.n.toString(16)}]`;
    if (t.t === 'bits') return `bits${t.size * 8}`;
    if (t.t === 'struct') return t.s;
    if (t.t === 'array') return `${typeName(t.of)}[${t.n}]`;
    return '?';
  }
  function children(t) {
    if (t.t === 'struct') return S[t.s].fields.map(([name, off, type, note]) => ({ name, off, type, note }));
    if (t.t === 'array') return [...Array(t.n).keys()].map(i => ({ name: `[${i}]`, off: i * t.stride, type: t.of }));
    return [];
  }
  const isNode = t => typeof t === 'object' && (t.t === 'struct' || t.t === 'array');

  function read(s, o, t) {
    switch (t) {
      case 'u8': case 'species': case 'personality': case 'emotion': case 'acre': case 'event': return s.u8(o);
      case 's8': return s.u8(o) << 24 >> 24;
      case 'u16': case 'item': return s.u16(o);
      case 's16': return s.u16(o) << 16 >> 16;
      case 'u32': case 'fruit': return s.u32(o);
      case 's32': return s.u32(o) | 0;
    }
    return null;
  }
  function write(s, o, t, v) {
    if (['u8', 's8', 'species', 'personality', 'emotion', 'acre', 'event'].includes(t)) s.set8(o, v & 0xFF);
    else if (['u16', 's16', 'item'].includes(t)) s.set16(o, v & 0xFFFF);
    else s.set32(o, v >>> 0);
  }
  function meaning(s, o, t) {
    const v = read(s, o, t);
    if (t === 'item') return v === 0xFFF1 ? 'Empty' : itemLabel(v);
    if (t === 'species') return v === 0xFF ? 'None' : byId.get(v)?.name || '';
    if (t === 'personality') return D.personalities[v] || '';
    if (t === 'emotion') return v === 0xFF ? 'None' : D.emotions[v] || '';
    if (t === 'fruit') return FRUIT[v] || '';
    if (t === 'event') return window.WW_EVENTS ? WW_EVENTS.name(v) : '';
    if (t === 'acre') { const a = D.acres.find(x => x[0] === v); return a ? a[1] : ''; }
    return '';
  }

  // An inline editor for one leaf field.
  function editor(s, o, t, refresh) {
    if (typeof t === 'string') {
      const signed = t[0] === 's' && t !== 'species';
      const inp = h('input', { class: 'field num w-s mono', type: 'text', value: t === 'item' ? hex(read(s, o, t)) : String(read(s, o, t)), spellcheck: 'false' });
      inp.addEventListener('change', () => {
        const raw = inp.value.trim(), v = /^0x/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
        if (!Number.isFinite(v)) { sfx.error(); inp.value = String(read(s, o, t)); return; }
        write(s, o, t, signed ? v : Math.max(0, v)); sfx.click(); refresh();
      });
      const extra = t === 'item' ? h('button', { class: 'btn small', onclick: async () => { const v = await pickItem(read(s, o, t), { title: 'Choose an item' }); if (v !== null && v !== undefined) { write(s, o, t, v); sfx.bell(); refresh(); } } }, 'Pick…') : null;
      return h('span', { class: 'ex-edit' }, inp, extra, h('span', { class: 'muted ex-mean' }, meaning(s, o, t)));
    }
    if (t.t === 'str') {
      const inp = h('input', { class: 'field w-l', value: s.str(o, t.n), maxlength: t.n });
      inp.addEventListener('change', () => { if (!WWSave.canEncode(inp.value)) { sfx.error(); toast('Some characters can’t be written in-game', '⚠️'); return; } s.setStr(o, t.n, inp.value); sfx.click(); refresh(); });
      return inp;
    }
    if (t.t === 'bits') {
      const raw = t.size === 1 ? s.u8(o) : t.size === 2 ? s.u16(o) : s.u32(o);
      const put = v => { if (t.size === 1) s.set8(o, v); else if (t.size === 2) s.set16(o, v); else s.set32(o, v >>> 0); };
      return h('span', { class: 'ex-bits' }, t.fields.map(([name, shift, width]) => {
        const max = 2 ** width - 1, cur = (raw >>> shift) & max;
        const inp = h('input', { class: 'field num w-s', type: 'number', min: 0, max, value: cur, title: `bits ${shift}–${shift + width - 1}` });
        inp.addEventListener('change', () => { const v = Math.max(0, Math.min(max, Number(inp.value) | 0)); const now = t.size === 1 ? s.u8(o) : t.size === 2 ? s.u16(o) : s.u32(o); put((now & ~(max << shift)) | (v << shift)); sfx.click(); refresh(); });
        return h('label', null, h('span', null, name), inp);
      }));
    }
    if (t.t === 'bytes') {
      if (!window.BitBytes) return null;
      const pages = Math.ceil(t.n / 0x40), pg = Math.min(bytePage.get(o) || 0, pages - 1), at = o + pg * 0x40;
      const nav = pages > 1 ? h('select', { class: 'field w-m', onchange: e => { bytePage.set(o, Number(e.target.value)); refresh(); } },
        [...Array(pages).keys()].map(i => h('option', { value: i, selected: i === pg }, `Bytes ${hex(i * 0x40, 3)}–${hex(Math.min(t.n, (i + 1) * 0x40) - 1, 3)}`))) : null;
      return h('div', { class: 'ex-bytes' }, nav, window.BitBytes(s, at, Math.min(0x40, t.n - pg * 0x40), q => hex(q, 5)));
    }
    return null;
  }

  function tree(s, refresh) {
    const root = { name: 'SaveData', off: 0, type: { t: 'struct', s: 'SaveData' } };
    const rows = [];
    const visit = (node, path, depth, abs) => {
      const key = path.join('/'), kids = isNode(node.type) ? children(node.type) : [];
      const isSel = sel.path.join('/') === key;
      const match = !query || node.name.toLowerCase().includes(query);
      if (match || kids.length) {
        rows.push(h('button', { class: 'ex-node' + (isSel ? ' on' : '') + (!match ? ' dim' : ''), style: { paddingLeft: 8 + depth * 14 + 'px' },
          onclick: () => { if (kids.length) open.has(key) ? open.delete(key) : open.add(key); sel = { path, off: abs, type: node.type, name: node.name, note: node.note }; hexFrom = null; sfx.click(); refresh(); } },
          h('span', { class: 'ex-tw' }, kids.length ? (open.has(key) ? '▾' : '▸') : '·'), h('span', { class: 'ex-nm' }, node.name), h('span', { class: 'ex-ty' }, typeName(node.type))));
      }
      if (kids.length && (open.has(key) || query)) {
        if (query && node.type.t === 'array' && node.type.n > 16) return; // keep searches fast
        kids.forEach(k => { if (isNode(k.type)) visit(k, [...path, k.name], depth + 1, abs + k.off); else if (!query || k.name.toLowerCase().includes(query)) rows.push(h('button', { class: 'ex-node leaf' + (hover && hover[0] === abs + k.off ? ' hl' : ''), style: { paddingLeft: 8 + (depth + 1) * 14 + 'px' }, onclick: () => { sel = { path: [...path, k.name], off: abs + k.off, type: k.type, name: k.name, note: k.note }; hexFrom = null; refresh(); } }, h('span', { class: 'ex-tw' }, '·'), h('span', { class: 'ex-nm' }, k.name), h('span', { class: 'ex-ty' }, typeName(k.type)))); });
      }
    };
    visit(root, [], 0, 0);
    return rows;
  }

  // Hex window of up to 1 KB. Click a byte (or tab between them) to type a new value in hex.
  const WINDOW = 0x400;
  let edited = false;                 // bytes typed since the last re-render
  function hexDump(s, start, len, focus, refresh) {
    const lines = [];
    const first = start & ~15, end = Math.min(0x15FE0, Math.max(start + len, first + 16));
    const from = hexFrom === null ? first : Math.max(first, Math.min(hexFrom, end - 16)), max = Math.min(end, from + WINDOW);
    const cellAt = a => document.querySelector(`.ex-hex .hx[data-a="${a}"]`);
    const edit = cell => {
      const a = Number(cell.dataset.a);
      const inp = h('input', { class: 'hx-in', value: s.u8(a).toString(16).padStart(2, '0').toUpperCase(), maxlength: 2, spellcheck: 'false' });
      let done = false;
      const commit = move => {
        if (done) return; done = true;
        const v = parseInt(inp.value, 16);
        const changed = /^[0-9a-f]{1,2}$/i.test(inp.value) && v !== s.u8(a);
        if (changed) { s.set8(a, v); sfx.click(); edited = true; }
        if (!move && edited && refresh) { edited = false; refresh(); return; }
        cell.classList.toggle('d', !!(s.isDirtyAt && s.isDirtyAt(a)));
        cell.textContent = s.u8(a).toString(16).padStart(2, '0').toUpperCase();
        const next = move && cellAt(a + move);
        if (next) edit(next);
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); commit(1); }
        else if (e.key === 'Tab') { e.preventDefault(); commit(-1); }
        else if (e.key === 'Escape') { done = true; cell.textContent = s.u8(a).toString(16).padStart(2, '0').toUpperCase(); }
      });
      inp.addEventListener('input', () => { if (inp.value.length === 2) commit(1); });
      inp.addEventListener('blur', () => commit(0));
      cell.replaceChildren(inp); inp.focus(); inp.select();
    };
    for (let o = from; o < max; o += 16) {
      const cells = [];
      for (let i = 0; i < 16; i++) {
        const a = o + i, inSel = a >= start && a < start + len, inF = focus && a >= focus[0] && a < focus[0] + focus[1];
        if (a >= 0x15FE0) { cells.push(h('span', { class: 'hx' }, '  ')); continue; }
        const cell = h('span', { class: 'hx' + (inSel ? ' sel' : '') + (inF ? ' f' : '') + (s.isDirtyAt && s.isDirtyAt(a) ? ' d' : ''), title: hex(a, 5), 'data-a': a }, s.u8(a).toString(16).padStart(2, '0').toUpperCase());
        cell.addEventListener('click', () => { if (!cell.querySelector('input')) edit(cell); });
        cells.push(cell);
      }
      lines.push(h('div', { class: 'hx-line' }, h('span', { class: 'hx-off' }, o.toString(16).padStart(5, '0').toUpperCase()), cells));
    }
    if (end - first > WINDOW && refresh) {
      const go = v => { hexFrom = v; refresh(); };
      lines.unshift(h('div', { class: 'hx-nav' },
        h('button', { class: 'btn small', disabled: from <= first, onclick: () => go(Math.max(first, from - WINDOW)) }, '◀ Previous KB'),
        h('span', { class: 'muted' }, `${hex(from, 5)}–${hex(max - 1, 5)} of ${hex(first, 5)}–${hex(end - 1, 5)}`),
        h('button', { class: 'btn small', disabled: max >= end, onclick: () => go(from + WINDOW) }, 'Next KB ▶')));
    }
    return lines;
  }

  VIEWS.push({
    id: 'explorer', group: 'Lab', icon: '🧭', title: () => 'Save Explorer', sub: () => 'Every struct and field in the save, typed and editable',
    tips: ['Values accept decimal or 0x hex.', 'Click any byte in the hex view to type over it; Tab moves to the next byte.', 'Grey “u8[…]” blocks are data whose meaning isn’t known yet: toggle bits there and compare saves with Save Diff.'],
    render(s, { refresh }) {
      const t = sel.type, size = sizeOf(t);
      const kids = isNode(t) ? children(t) : null;
      const c = window.WW_SCHEMA.coverage(), pc = x => (x * 100).toFixed(1);
      const search = h('input', { class: 'field ex-search', placeholder: 'Filter fields…', value: query, type: 'search' });
      search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); refresh(); setTimeout(() => { const q = document.querySelector('.ex-search'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }); });
      const crumbs = h('div', { class: 'ex-crumbs' }, ['SaveData', ...sel.path].map((p, i, a) => h('span', null, p, i < a.length - 1 ? ' › ' : '')));
      const fields = kids
        ? h('table', { class: 'ex-table' }, h('thead', null, h('tr', null, h('th', null, 'Offset'), h('th', null, 'Field'), h('th', null, 'Type'), h('th', null, 'Value'))),
          h('tbody', null, kids.slice(0, 300).map(k => {
            const abs = sel.off + k.off, node = isNode(k.type);
            const tr = h('tr', { class: (typeof k.type === 'object' && k.type.t === 'bytes') ? 'unk' : '', onmouseenter: () => { hover = [abs, sizeOf(k.type)]; const hx = document.querySelector('.ex-hex'); if (hx) hx.replaceChildren(...hexDump(s, sel.off, size, hover, refresh)); } },
              h('td', { class: 'mono muted' }, hex(abs, 5)),
              h('td', null, node ? h('button', { class: 'linkish', onclick: () => { const key = [...sel.path, k.name].join('/'); open.add(sel.path.join('/')); open.add(key); sel = { path: [...sel.path, k.name], off: abs, type: k.type, name: k.name, note: k.note }; hexFrom = null; sfx.click(); refresh(); } }, k.name + ' ›') : h('b', null, k.name), k.note ? h('div', { class: 'muted', style: { fontSize: '11px' } }, k.note) : null),
              h('td', { class: 'mono muted' }, typeName(k.type)),
              h('td', null, node ? h('span', { class: 'muted' }, `${sizeOf(k.type)} bytes`) : editor(s, abs, k.type, refresh)));
            return tr;
          })))
        : h('div', { class: 'card pad' }, h('div', { style: { fontWeight: 800, marginBottom: '8px' } }, sel.name, ' ', h('span', { class: 'mono muted' }, `${typeName(t)} at ${hex(sel.off, 5)}`)), sel.note ? h('div', { class: 'muted' }, sel.note) : null, editor(s, sel.off, t, refresh));
      return [
        h('div', { class: 'ex-top' }, crumbs, h('div', { class: 'ex-cov', title: 'Typed: every field named with its type. Known: raw data whose purpose is known (pixels, bitsets). Unknown: still being researched.' }, h('div', { class: 'ex-bar' }, h('i', { class: 'a', style: { width: pc(c.typed) + '%' } }), h('i', { class: 'b', style: { width: pc(c.known) + '%' } })), h('span', null, `${pc(c.typed)}% typed · ${pc(c.known)}% known raw · ${pc(1 - c.typed - c.known)}% unknown`))),
        h('div', { class: 'ex' },
          h('div', { class: 'ex-tree card' }, search, h('div', { class: 'ex-tree-list' }, tree(s, refresh))),
          h('div', { class: 'ex-main' },
            h('div', { class: 'card ex-fields' }, fields),
            h('div', { class: 'card ex-hex mono' }, hexDump(s, sel.off, size, hover, refresh)))),
      ];
    },
  });
})();
