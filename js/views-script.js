// Game Script: every line of dialogue, letter and sign in the game, read from the player's own ROM (script/ENG/**.bmg,
// "MESGbmg1" message files: an INF1 table of offsets into DAT1, text in the game's single-byte encoding with 0x1A control
// codes for names, colours and pauses). Nothing is bundled with Leaflet; the text stays on this computer.
(function () {
  'use strict';
  const { h, section, sfx } = UI;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const u16 = (b, o) => b[o] | (b[o + 1] << 8), u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  // ---------- reading ----------
  // Messages of one file: [{ i, parts }] where a part is text or { code: [bytes] }.
  function parse(b) {
    if (!b || String.fromCharCode(...b.subarray(0, 8)) !== 'MESGbmg1') return [];
    const nsec = u32(b, 0xC); let o = 0x20, inf = null, dat = null;
    for (let k = 0; k < nsec && o + 8 <= b.length; k++) {
      const mag = String.fromCharCode(...b.subarray(o, o + 4)), sz = u32(b, o + 4);
      if (mag === 'INF1') inf = { o, n: u16(b, o + 8), esz: u16(b, o + 10) };
      if (mag === 'DAT1') dat = o + 8;
      if (!sz) break; o += sz;
    }
    if (!inf || dat === null) return [];
    const out = [];
    for (let i = 0; i < inf.n; i++) {
      const off = u32(b, inf.o + 16 + i * inf.esz); if (!off && i) continue;
      const parts = []; let s = '', p = dat + off;
      while (p < b.length && b[p] !== 0) {
        if (b[p] === 0x1A) { const len = b[p + 1] || 2; if (s) { parts.push(s); s = ''; } parts.push({ code: [...b.subarray(p + 2, p + len)] }); p += len; continue; }
        s += String.fromCharCode(b[p]); p++;   // Latin-1, which covers the accented letters in the English text
      }
      if (s) parts.push(s);
      if (parts.length) out.push({ i, parts });
    }
    return out;
  }
  // Control codes, shown as small chips. The first byte picks the kind; these labels are best guesses from where they
  // appear (names come out of the save or the conversation at run time).
  const codeLabel = c => ({ 0: 'pause', 1: 'name', 2: 'colour', 3: 'value', 5: 'choice', 6: 'sound' }[c[0]] || 'code');

  // ---------- where a file belongs ----------
  const PERSONALITY = { bo: 'Lazy', fu: 'Normal', ge: 'Peppy', ha: 'Jock', ko: 'Cranky', ta: 'Snooty' };
  const NPC = { raccoon: 'Tom Nook', owl: 'Blathers', fox: 'Crazy Redd', barber: 'Harriet', boar: 'Joan', ypelican: 'Pelly', opelican: 'Phyllis', mpelican: 'Pete', turtle: 'Tortimer',
    reaction: 'Dr. Shrunk', reset: 'Mr. Resetti', camel: 'Saharah', giraffe: 'Gracie', gull: 'Gulliver', walrus: 'Wendell', panther: 'Katrina', dog: 'K.K. Slider', cafe: 'Brewster',
    astro: 'Celeste', osister: 'Sable', ysister: 'Mabel', gatekeeper: 'Copper and Booker', gatekeeper2: 'Copper and Booker', mysterycat: 'Blanca', atm: 'The ATM', insurance: 'Insurance',
    missing1: 'Katie', missing2: 'Katie', snowman: 'Snowman', board: 'Bulletin board', museum: 'Museum', player: 'You', sequence1: 'The opening', sequence2: 'The opening' };
  const AREA = { 'mail': 'Letters', 'mailz': 'Letters (more)', 'bbs': 'Bulletin board', 'string': 'Names and words', '2d': 'Menus', 'select': 'Choices' };
  function label(path) {
    const p = path.replace(/^script\/ENG\//, '').replace(/\.bmg$/, ''), seg = p.split('/');
    if (seg[0] === 'message' && PERSONALITY[seg[1]]) return { group: `${PERSONALITY[seg[1]]} neighbors`, name: seg.slice(2).join(' / ') };
    if (seg[0] === 'message' && seg[1] === 'sp') { const base = seg[seg.length - 1].replace(/^sp_npc_/, '').replace(/_$/, ''); return { group: 'Special characters', name: NPC[base] || NPC[base.replace(/\d+$/, '')] || base }; }
    if (seg[0] === 'message') return { group: 'Other dialogue', name: seg.slice(1).join(' / ') };
    return { group: AREA[seg[0]] || seg[0], name: seg.slice(1).join(' / ') || seg[0] };
  }

  // ---------- the index ----------
  let index = null, building = false;
  async function build(refresh) {
    if (building) return; building = true;
    const paths = window.ROM.list('script/ENG/').filter(p => p.endsWith('.bmg')).sort(), out = [];
    for (let k = 0; k < paths.length; k++) {
      const msgs = parse(window.ROM.file(paths[k])), L = label(paths[k]);
      for (const m of msgs) out.push({ path: paths[k], group: L.group, name: L.name, i: m.i, parts: m.parts, text: m.parts.filter(x => typeof x === 'string').join('').toLowerCase() });
      if (k % 120 === 119) await new Promise(r => setTimeout(r, 0));
    }
    index = out; building = false; refresh();
  }

  const state = { q: '', group: '', file: '' };
  function line(e, q) {
    const parts = e.parts.map(x => {
      if (typeof x !== 'string') return h('span', { class: 'scr-code', title: x.code.map(v => v.toString(16).padStart(2, '0')).join(' ') }, codeLabel(x.code));
      if (!q) return x;
      const lo = x.toLowerCase(), out = []; let at = 0, k;
      while (q && (k = lo.indexOf(q, at)) >= 0) { out.push(x.slice(at, k), h('mark', null, x.slice(k, k + q.length))); at = k + q.length; }
      out.push(x.slice(at)); return out;
    });
    return h('div', { class: 'scr-line' }, h('div', { class: 'scr-where' }, h('b', null, e.name), h('span', { class: 'muted' }, ` · ${e.group} · #${e.i}`)), h('div', { class: 'scr-text' }, parts));
  }

  VIEWS.push({
    id: 'script', group: 'Lab', icon: '📜', title: () => 'Game Script', sub: () => 'Every line of dialogue and every letter, from your ROM',
    tips: ['Search any word to find every line that says it: villagers by personality, Nook, Blathers, letters, signs and menus.', 'The small chips stand for things the game fills in while you play, like names and pauses.'],
    render(s, { refresh }) {
      if (!window.ROM || !ROM.ready) return [h('div', { class: 'card pad muted' }, '📜 Open your Wild World ROM on the Welcome screen to read the game’s script here.')];
      if (!ROM.list('script/ENG/').length) return [h('div', { class: 'card pad muted' }, '📜 Your saved game art is from an older Leaflet. Open the ROM again on the Welcome screen to add the script.')];
      if (!index) { build(refresh); return [h('div', { class: 'card pad muted' }, 'Reading the script from your ROM…')]; }
      const groups = [...new Set(index.map(e => e.group))];
      const q = state.q.trim().toLowerCase();
      let rows = index;
      if (state.group) rows = rows.filter(e => e.group === state.group);
      if (state.file) rows = rows.filter(e => e.path === state.file);
      if (q) rows = rows.filter(e => e.text.includes(q));
      const files = state.group ? [...new Map(index.filter(e => e.group === state.group).map(e => [e.path, e.name])).entries()] : [];
      const input = h('input', { class: 'field w-l', type: 'search', placeholder: 'Search the script…', value: state.q });
      let timer = null;
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = input.value; refresh(); setTimeout(() => { const el = document.querySelector('.scr-bar input'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); }, 250); });
      const shown = rows.slice(0, 300);
      return [
        h('div', { class: 'card pad scr-bar' }, input,
          UI.selectInput([[-1, `Everything (${index.length.toLocaleString()} lines)`], ...groups.map((g, i) => [i, g])], () => groups.indexOf(state.group), v => { state.group = v < 0 ? '' : groups[v]; state.file = ''; refresh(); }, { width: 'w-m' }),
          files.length ? UI.selectInput([[-1, 'Every file'], ...files.map(([p, n], i) => [i, n])], () => files.findIndex(f => f[0] === state.file), v => { state.file = v < 0 ? '' : files[v][0]; refresh(); }, { width: 'w-m' }) : null),
        section(q ? `“${state.q.trim()}”` : state.group || 'The whole script', `${rows.length.toLocaleString()} line${rows.length === 1 ? '' : 's'}${rows.length > shown.length ? `, showing the first ${shown.length}` : ''}`),
        h('div', { class: 'card pad scr-list' }, shown.length ? shown.map(e => line(e, q)) : h('div', { class: 'muted' }, 'Nothing says that.')),
        h('div', { class: 'muted', style: { fontSize: '11.5px', textAlign: 'center', marginTop: '6px' } }, 'Read from your own ROM on this computer. The game’s text is Nintendo’s; Leaflet doesn’t include or share it.'),
      ];
    },
  });
})();
