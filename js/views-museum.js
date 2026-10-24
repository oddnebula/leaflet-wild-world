// Museum, Critterpedia, Now Catchable and the completion dashboard.
(function () {
  'use strict';
  const { h, hex, fmt, row, card, section, sfx, say, toast, itemIcon } = UI;
  // The encyclopedia picture from the player's ROM for fish and bugs, otherwise the pocket icon (or emoji).
  function art(id) {
    const fish = id >= 0x12E8 && id < 0x1320, bug = id >= 0x12B0 && id < 0x12E8;
    const url = window.ROM && (fish ? ROM.creatureURL('fish', id - 0x12E8) : bug ? ROM.creatureURL('bug', id - 0x12B0) : null);
    return url ? h('img', { class: 'gi pic', src: url, alt: '' }) : itemIcon(id);
  }
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const MUSEUM = 0x15D50;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const range = n => [...Array(n).keys()];

  // ---------- data ----------
  // Museum layout confirmed in the decompilation: one nibble per exhibit, low nibble first; 1-4 = resident, 5 = former resident.
  const WINGS = [
    { id: 'fossils', name: 'Fossils', em: '🦴', off: 0x00, list: D.fossils.map((n, i) => ({ name: n, item: 0x450C + i * 4 })) },
    { id: 'fish', name: 'Fish', em: '🐟', off: 0x1B, list: D.critters.fish.map(c => ({ ...c })) },
    { id: 'bugs', name: 'Bugs', em: '🦋', off: 0x38, list: D.critters.bugs.map(c => ({ ...c })) },
    { id: 'art', name: 'Art', em: '🖼️', off: 0x55, list: D.paintings.map((n, i) => ({ name: n, item: 0x3894 + i * 4 })) },
  ];
  const nib = (s, w, i) => { const b = s.u8(MUSEUM + w.off + (i >> 1)); return i & 1 ? b >> 4 : b & 15; };
  const setNib = (s, w, i, v) => { const a = MUSEUM + w.off + (i >> 1), b = s.u8(a); s.set8(a, i & 1 ? (b & 0x0F) | (v << 4) : (b & 0xF0) | v); };
  // Encyclopedia bits per resident at +0x1BDD: bit 1..56 bugs, 57..112 fish.
  const encBit = (kind, i) => (kind === 'bugs' ? 1 + i : 57 + i);
  const caught = (s, p, kind, i) => !!s.bit(s.playerBase(p) + 0x1BDD, encBit(kind, i));
  const setCaught = (s, p, kind, i, on) => s.setBit(s.playerBase(p) + 0x1BDD, encBit(kind, i), on);
  const players = s => [0, 1, 2, 3].filter(p => s.playerExists(p));
  const pname = (s, p) => s.str(s.playerBase(p) + 0x2282, 8);

  // ---------- availability ----------
  const halfMonth = d => d.getMonth() * 2 + (d.getDate() > 15 ? 1 : 0);
  function chance(c, hm, hr) { if (c.special) return 1; let best = 0; for (const [m, a, b, p] of c.runs) if (m === hm && hr >= a && hr < b) best = Math.max(best, p); return best; }
  function hoursIn(c, hm) { const hrs = new Set(); if (c.special) range(24).forEach(x => hrs.add(x)); for (const [m, a, b] of c.runs) if (m === hm) for (let x = a; x < b; x++) hrs.add(x); return hrs; }
  const inHalf = (c, hm) => c.special || c.runs.some(r => r[0] === hm);
  const inMonth = (c, mo) => inHalf(c, mo * 2) || inHalf(c, mo * 2 + 1);
  function hoursText(hrs) {
    if (hrs.size === 24) return 'All day';
    if (!hrs.size) return '—';
    const on = range(24).map(x => hrs.has(x)); const out = [];
    let start = on.findIndex((v, i) => v && !on[(i + 23) % 24]);
    if (start < 0) start = 0;
    for (let k = 0, i = start; k < 24; k++, i = (i + 1) % 24) {
      if (on[i] && !on[(i + 23) % 24]) { let j = i; while (on[(j + 1) % 24] && (j + 1) % 24 !== i) j = (j + 1) % 24; out.push(`${fmtH(i)}–${fmtH((j + 1) % 24)}`); }
    }
    return out.join(', ');
  }
  const fmtH = x => (x % 12 || 12) + (x < 12 ? 'am' : 'pm');
  function nextWindow(c, now) {
    const hm = halfMonth(now);
    for (let k = 1; k <= 24; k++) { const t = (hm + k) % 24; if (inHalf(c, t)) return t; }
    return null;
  }
  const hmLabel = t => `${t & 1 ? 'late' : 'early'} ${MONTHS[t >> 1]}`;
  const hmStart = (t, now) => { let y = now.getFullYear(); const d = new Date(y, t >> 1, t & 1 ? 16 : 1); if (d < now) d.setFullYear(y + 1); return d; };
  function rarity(c) { const peak = c.runs.reduce((m, r) => Math.max(m, r[3]), 0); return c.special ? 'Special' : peak >= 15 ? 'Common' : peak >= 6 ? 'Uncommon' : peak >= 2 ? 'Rare' : 'Very rare'; }
  window.WW_AVAIL = { chance, hoursIn, inMonth, halfMonth, nextWindow, rarity };

  // ---------- shared bits ----------
  function bar(done, total, color) {
    return h('div', { class: 'pbar' }, h('i', { style: { width: (total ? done / total * 100 : 0).toFixed(1) + '%', background: color || '' } }), h('span', null, `${done} / ${total}`));
  }
  function monthStrip(c, now) {
    return h('div', { class: 'mstrip' }, range(12).map(m => h('i', {
      class: (inMonth(c, m) ? 'on' : '') + (m === now.getMonth() ? ' now' : ''), title: MONTHS[m],
    }, MONTHS[m][0])));
  }
  function counts(s) {
    const out = {};
    for (const w of WINGS) out[w.id] = w.list.filter((_, i) => nib(s, w, i)).length;
    out.total = Object.values(out).reduce((a, b) => a + b, 0);
    out.max = WINGS.reduce((a, w) => a + w.list.length, 0);
    return out;
  }
  window.WW_MUSEUM = { WINGS, nib, setNib, counts, caught, setCaught };

  // =====================================================================================
  // Museum (Blathers' collection)
  let filter = 'all', donorPick = 0;
  VIEWS.push({
    id: 'museum', group: 'Museum', icon: '🏛️', title: () => 'Museum', sub: () => 'Blathers’ collection and your encyclopedia',
    badge: s => `${counts(s).total}`,
    tips: ['Hoo! Click any exhibit to mark who donated it, and who has caught it for their encyclopedia.', 'The month dots show when a fish or bug appears. The highlighted dot is this month.', 'Filter by “Available now” to plan tonight’s fishing trip!'],
    hello: () => 'Hoo, hoo! Welcome to the museum! Each wing tracks what’s on display, and the bug and fish wings also show when each one is around.',
    render(s, ctx) {
      const { refresh } = ctx;
      if (ctx.indexing) {
        WINGS.forEach(w => { UI.setRegistryTab(w.id); w.list.forEach(x => UI.register(h('div'), `${x.name} (museum ${w.name.toLowerCase()})`, x.where || 'Museum exhibit')); });
        return [];
      }
      const wid = UI.tabOf('museum', 'fish'), w = WINGS.find(x => x.id === wid) || WINGS[1];
      UI.setRegistryTab(w.id);
      const now = new Date(), hm = halfMonth(now), c = counts(s), ps = players(s);
      donorPick = donorPick || (ps[0] ?? 0) + 1;
      const hero = h('div', { class: 'museum-hero' },
        h('div', { class: 'owl' }, '🦉'),
        h('div', { style: { flex: 1 } }, h('div', { class: 'mh-title' }, 'Town Museum'),
          h('div', { class: 'mh-sub' }, c.total === c.max ? 'Hoo! The collection is complete! A marvel!' : `${c.max - c.total} exhibits still to go. Keep at it!`),
          bar(c.total, c.max, 'linear-gradient(90deg,#f2bf3a,#ffe08a)')),
        h('div', { class: 'ring', style: { '--p': (c.total / c.max * 100).toFixed(1) } }, h('span', null, Math.round(c.total / c.max * 100) + '%')));
      const wings = h('div', { class: 'wing-tabs' }, WINGS.map(x => h('button', { class: 'wing' + (x === w ? ' on' : ''), onclick: () => { UI.setTab('museum', x.id); sfx.click(); refresh(); } },
        h('span', { class: 'wem' }, x.em), h('span', { class: 'wn' }, x.name), bar(c[x.id], x.list.length))));
      const isCritter = w.id === 'fish' || w.id === 'bugs';
      const FILTERS = [['all', 'All'], ['missing', 'Not donated'], ['donated', 'Donated'], ...(isCritter ? [['now', 'Out right now'], ['month', 'This month'], ['leaving', 'Leaving soon']] : [])];
      const fbar = h('div', { class: 'cat-chips', style: { marginBottom: '10px' } }, FILTERS.map(([id, l]) => h('button', { class: 'cat-chip' + (filter === id ? ' on' : ''), onclick: () => { filter = id; sfx.click(); refresh(); } }, l)));
      const donorSel = h('select', { class: 'field w-m', onchange: e => { donorPick = Number(e.target.value); } },
        [...ps.map(p => [p + 1, pname(s, p)]), [5, 'Former resident']].map(([v, l]) => h('option', { value: v, selected: v === donorPick }, l)));
      const cards = w.list.map((x, i) => ({ x, i })).filter(({ x, i }) => {
        const d = nib(s, w, i);
        if (filter === 'missing') return !d;
        if (filter === 'donated') return !!d;
        if (filter === 'now') return chance(x, hm, now.getHours()) > 0;
        if (filter === 'month') return inMonth(x, now.getMonth());
        if (filter === 'leaving') return inHalf(x, hm) && !inHalf(x, (hm + 1) % 24);
        return true;
      }).map(({ x, i }) => {
        const d = nib(s, w, i);
        const now_ = isCritter && chance(x, hm, now.getHours()) > 0;
        const el = h('div', { class: 'exhibit' + (d ? ' donated' : '') },
          h('div', { class: 'ex-top' }, h('span', { class: 'ex-em' }, art(x.item)), h('span', { class: 'ex-num' }, '#' + (i + 1)),
            d ? h('span', { class: 'stamp', title: 'Donated' }, d === 5 ? '★' : (pname(s, d - 1)[0] || '?').toUpperCase()) : null),
          h('div', { class: 'ex-name' }, x.name),
          isCritter ? [
            h('div', { class: 'ex-meta' }, x.where || ''),
            monthStrip(x, now),
            h('div', { class: 'ex-meta' }, '🕒 ', hoursText(hoursIn(x, inHalf(x, hm) ? hm : (nextWindow(x, now) ?? hm)))),
            h('div', { class: 'ex-tags' }, now_ ? h('span', { class: 'badge ok' }, 'Out now') : null, h('span', { class: 'badge lab' }, rarity(x)),
              inHalf(x, hm) && !inHalf(x, (hm + 1) % 24) ? h('span', { class: 'badge warn' }, 'Leaving soon') : null),
            h('div', { class: 'ex-caught' }, ps.map(p => {
              const on = caught(s, p, w.id, i);
              const b = h('button', { class: 'cbadge' + (on ? ' on' : ''), title: `${pname(s, p)} ${on ? 'has caught it' : 'hasn’t caught it'} (encyclopedia)` }, (pname(s, p)[0] || '?').toUpperCase());
              b.onclick = e => { e.stopPropagation(); setCaught(s, p, w.id, i, !on); sfx.toggle(!on); refresh(); };
              return b;
            })),
          ] : h('div', { class: 'ex-meta' }, w.id === 'fossils' ? 'Dig up a fossil, then have Blathers identify it.' : 'Buy from Crazy Redd. Some of his paintings are forgeries!'));
        el.onclick = () => { setNib(s, w, i, d ? 0 : donorPick); sfx[d ? 'toggle' : 'bell'](!d); refresh(); };
        UI.register(el, `${x.name} (museum ${w.name.toLowerCase()})`, x.where || 'Museum exhibit');
        return el;
      });
      return [hero, wings,
        h('div', { class: 'btn-row', style: { alignItems: 'center', margin: '14px 0 10px' } }, fbar, h('span', { class: 'spacer' }),
          h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Donor for clicks:'), donorSel,
          h('button', { class: 'btn small leaf', onclick: () => { w.list.forEach((_, i) => { if (!nib(s, w, i)) setNib(s, w, i, donorPick); }); sfx.save(); toast(`${w.name} wing complete!`, w.em); refresh(); } }, 'Fill this wing'),
          h('button', { class: 'btn small', onclick: () => { w.list.forEach((_, i) => setNib(s, w, i, 0)); sfx.toggle(false); refresh(); } }, 'Empty wing'),
          isCritter && ps.length ? h('button', { class: 'btn small', onclick: () => { ps.forEach(p => w.list.forEach((_, i) => { if (nib(s, w, i)) setCaught(s, p, w.id, i, true); })); sfx.bell(); toast('Encyclopedias now include everything on display', '📖'); refresh(); } }, 'Sync encyclopedia') : null),
        cards.length ? h('div', { class: 'exhibits' }, cards) : h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🦉'), 'Hoo… nothing matches that filter right now.')),
        h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '10px' } }, 'Click a card to donate or remove it. Letters on a card show which residents have it in their encyclopedia; click them to toggle. Spawn data parsed from the game by DrewPag.')];
    },
  });

  // =====================================================================================
  // Now Catchable
  let when = null, onlyNeeded = true, who = 'museum';
  VIEWS.push({
    id: 'catchable', group: 'Museum', icon: '🎣', title: () => 'Now Catchable', sub: () => 'What’s out, what’s leaving, what’s next',
    tips: ['Times use your computer’s clock, or pick any date and time to plan ahead.', 'Percentages are the chance a given spawn picks that critter, straight from the game’s spawn tables.', 'Wild World has no hemispheres, so these dates work everywhere.'],
    hello: () => 'Let’s go catch something! Here’s everything out right now, sorted by what you still need.',
    render(s, { refresh }) {
      const now = when ? new Date(when) : new Date();
      const hm = halfMonth(now), hr = now.getHours(), ps = players(s);
      const needed = (kind, i) => who === 'museum' ? !nib(s, WINGS.find(w => w.id === kind), i) : !caught(s, Number(who), kind, i);
      const picker = h('input', { class: 'field', type: 'datetime-local', value: new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16) });
      picker.onchange = () => { when = picker.value ? new Date(picker.value).getTime() : null; refresh(); };
      const lp = ps.length ? s.u16(s.playerBase(ps[0]) + 0x2216) : 0;
      const lastPlayed = lp ? new Date(2000 + (lp & 0x7F), ((lp >> 7) & 0xF) - 1, lp >> 11, 12) : null;
      const controls = h('div', { class: 'card pad', style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
        h('b', null, '🗓️'), picker,
        h('button', { class: 'btn small', onclick: () => { when = null; refresh(); } }, 'Now'),
        lastPlayed ? h('button', { class: 'btn small', onclick: () => { when = lastPlayed.getTime(); refresh(); } }, 'Last played day') : null,
        h('button', { class: 'btn small', onclick: () => { when = now.getTime() + 3600e3; refresh(); } }, '+1 hour'),
        h('button', { class: 'btn small', onclick: () => { when = now.getTime() + 86400e3; refresh(); } }, '+1 day'),
        h('span', { class: 'spacer' }),
        h('select', { class: 'field w-m', onchange: e => { who = e.target.value; refresh(); } },
          h('option', { value: 'museum', selected: who === 'museum' }, 'Needed for the museum'),
          ps.map(p => h('option', { value: String(p), selected: who === String(p) }, `Needed for ${pname(s, p)}’s encyclopedia`))),
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12.5px', fontWeight: 650 } }, UI.switchInput(() => onlyNeeded, v => { onlyNeeded = v; refresh(); }), 'Only what I need'));

      function group(kind, label, em) {
        const list = D.critters[kind].map((c, i) => ({ c, i, p: chance(c, hm, hr), need: needed(kind, i) }));
        const total = list.length, have = list.filter(x => !x.need).length;
        const outNow = list.filter(x => x.p > 0 && (!onlyNeeded || x.need)).sort((a, b) => (b.need - a.need) || (a.p - b.p));
        const laterToday = list.filter(x => x.p === 0 && hoursIn(x.c, hm).size && !x.c.special && (!onlyNeeded || x.need));
        const leaving = list.filter(x => x.need && inHalf(x.c, hm) && !inHalf(x.c, (hm + 1) % 24));
        const card_ = x => h('div', { class: 'catch' + (x.need ? ' need' : '') },
          h('span', { class: 'ex-em' }, art(x.c.item)),
          h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'ex-name' }, x.c.name), h('div', { class: 'ex-meta' }, x.c.where || '', ' · ', hoursText(hoursIn(x.c, hm)))),
          h('div', { class: 'odds', title: x.p ? 'Chance per spawn right now' : 'When it starts appearing today' }, x.c.special ? '✨' : x.p ? `${x.p}%` : h('span', { style: { fontSize: '11px' } }, fmtH(range(24).map(k => (hr + k) % 24).find(k => chance(x.c, hm, k) > 0) ?? 0))),
          x.need ? h('span', { class: 'badge warn' }, 'Need') : h('span', { class: 'badge ok' }, '✓'));
        return [
          section(`${em} ${label}`, `${have} of ${total} ${who === 'museum' ? 'donated' : 'caught'}`), h('div', { style: { marginBottom: '10px' } }, bar(have, total)),
          h('div', { class: 'card pad' }, h('div', { class: 'sub-h' }, `Out at ${fmtH(hr)} (${outNow.length})`),
            outNow.length ? h('div', { class: 'catch-grid' }, outNow.map(card_)) : h('div', { class: 'muted' }, onlyNeeded ? 'Nothing you still need is out right now.' : 'Nothing is out right now.'),
            laterToday.length ? [h('div', { class: 'sub-h', style: { marginTop: '14px' } }, `Later today (${laterToday.length})`), h('div', { class: 'catch-grid' }, laterToday.map(card_))] : null,
            leaving.length ? h('div', { class: 'callout', style: { marginTop: '14px', marginBottom: 0 } }, h('span', { class: 'em' }, '⏳'), h('div', null, h('b', null, `Leaving after ${hmLabel(hm)}`), leaving.map(x => x.c.name).join(', '))) : null),
        ];
      }
      // Coming up: every needed critter not out this half-month, by when it next appears.
      const upcoming = [];
      for (const kind of ['bugs', 'fish']) D.critters[kind].forEach((c, i) => {
        if (!needed(kind, i) || inHalf(c, hm)) return;
        const t = nextWindow(c, now); if (t !== null) upcoming.push({ c, kind, t, date: hmStart(t, now) });
      });
      upcoming.sort((a, b) => a.date - b.date);
      const days = d => Math.max(0, Math.ceil((d - now) / 86400e3));
      const heat = h('div', { class: 'heat' }, range(12).map(m => {
        const n = ['bugs', 'fish'].reduce((a, kind) => a + D.critters[kind].filter((c, i) => needed(kind, i) && inMonth(c, m)).length, 0);
        return h('div', { class: 'heat-col' + (m === now.getMonth() ? ' now' : '') }, h('div', { class: 'heat-bar', style: { height: Math.min(100, n * 4) + '%' } }), h('b', null, n), h('span', null, MONTHS[m]));
      }));
      return [controls, ...group('bugs', 'Bugs', '🦋'), ...group('fish', 'Fish', '🐟'),
        section('📅 Coming up', `${upcoming.length} still to come`),
        h('div', { class: 'card pad' }, upcoming.length ? h('div', { class: 'catch-grid' }, upcoming.map(u => h('div', { class: 'catch' },
          h('span', { class: 'ex-em' }, art(u.c.item)),
          h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'ex-name' }, u.c.name), h('div', { class: 'ex-meta' }, `From ${hmLabel(u.t)} · ${hoursText(hoursIn(u.c, u.t))}`)),
          h('span', { class: 'badge lab' }, `in ${days(u.date)}d`)))) : h('div', { class: 'muted' }, 'Everything you still need is already around. Go get it!')),
        section('📊 What you still need, month by month'), h('div', { class: 'card pad' }, heat)];
    },
  });

  // =====================================================================================
  // Completion dashboard
  const GOLDEN = [
    ['Golden Net', 0x1377, 'Catch every bug (fill the bug encyclopedia). Tortimer brings it to you.', 34],
    ['Golden Rod', 0x1375, 'Catch every fish (fill the fish encyclopedia). Tortimer brings it to you.', 33],
    ['Golden Can', 0x1379, 'Keep a perfect town rating for 15 days in a row. Pelly or Phyllis gives it at the town hall.', 32],
    ['Golden Slingshot', 0x137B, 'Shoot down 14 balloon presents. The next balloon is golden.', 48],
    ['Golden Shovel', 0x136A, 'Bury a regular shovel, then dig it up a day later.', 39],
    ['Golden Axe', 0x1373, 'Finish the trading chain: Red Turnip → Wendell → Sahara → … → give Pascal a scallop.', null],
  ];
  function townHas(s, id) {
    const spots = [];
    for (const p of players(s)) {
      const b = s.playerBase(p);
      for (let k = 0; k < 15; k++) if (s.u16(b + 0x1B22 + k * 2) === id) spots.push(`${pname(s, p)}’s pockets`);
      if (s.u16(b + 0x220A) === id) spots.push(`${pname(s, p)}’s hands`);
      for (let k = 0; k < 90; k++) if (s.u16(0x15430 + p * 0xB4 + k * 2) === id) spots.push(`${pname(s, p)}’s dresser`);
    }
    for (let k = 0; k < 5 * 0x450; k += 2) if (s.u16(0xE558 + k) === id) { spots.push('the house'); break; }
    return [...new Set(spots)];
  }
  // Unassessed fossils (item 0x1549) wait in pockets and dressers until Blathers looks at them. Assessing here turns
  // each into a fossil the museum still lacks (or, once the wing is full, one the resident doesn't carry yet).
  const FOSSIL = 0x1549;
  function fossilAssessor(s, refresh) {
    const spots = [];
    for (const p of players(s)) {
      const b = s.playerBase(p);
      for (let k = 0; k < 15; k++) if (s.u16(b + 0x1B22 + k * 2) === FOSSIL) spots.push({ o: b + 0x1B22 + k * 2, where: `${pname(s, p)}’s pockets` });
      for (let k = 0; k < 90; k++) if (s.u16(0x15430 + p * 0xB4 + k * 2) === FOSSIL) spots.push({ o: 0x15430 + p * 0xB4 + k * 2, where: `${pname(s, p)}’s dresser` });
    }
    const wing = WINGS[0], missing = wing.list.map((f, i) => ({ f, i })).filter(({ i }) => !nib(s, wing, i));
    const assess = list => {
      const pool = missing.slice(), got = [];
      for (const sp of list) {
        const pick = pool.length ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : { f: wing.list[Math.floor(Math.random() * wing.list.length)] };
        s.set16(sp.o, pick.f.item); got.push(pick.f.name);
      }
      sfx.bell(); say(`Hoo! Let me see… ${got.join(', ')}! ${pool.length < missing.length ? 'The museum would love to have ' + (got.length > 1 ? 'these' : 'it') + '.' : ''}`); refresh();
    };
    return h('div', { class: 'card pad' },
      spots.length ? [h('div', { class: 'gold-list' }, spots.map(sp => h('div', { class: 'gold' }, h('span', { class: 'ex-em' }, '🦴'), h('div', null, h('b', null, 'Unassessed fossil'), h('div', { class: 'ex-meta' }, sp.where)),
          h('button', { class: 'btn small', onclick: () => assess([sp]) }, 'Assess')))),
        h('div', { class: 'btn-row', style: { marginTop: '10px' } }, h('button', { class: 'btn small leaf', onclick: () => assess(spots) }, `Assess all ${spots.length}`),
          h('span', { class: 'muted', style: { fontSize: '12px' } }, missing.length ? `Picks from the ${missing.length} fossils the museum still needs.` : 'The fossil wing is full, so any fossil can come out.'))]
        : h('div', { class: 'muted' }, `No unassessed fossils right now. Dig up the star-shaped cracks around town. ${missing.length ? `The museum still needs ${missing.length}: ${missing.slice(0, 8).map(m => m.f.name).join(', ')}${missing.length > 8 ? '…' : ''}.` : 'The fossil wing is complete!'}`));
  }

  VIEWS.push({
    id: 'progress', group: 'Museum', icon: '🏆', title: () => 'Completion', sub: () => 'Everything left to do in town',
    tips: ['Each section links to where you can fix it in the editor.', 'Golden tools are tracked through the game’s own event flags and by finding the items in pockets, dressers and the house.'],
    render(s, { go, refresh }) {
      const ps = players(s), c = counts(s);
      const songs = D.songs.filter((n, i) => n && s.bit(0xFAEC, i)).length;
      const house = window.WW_HOUSE.getF(s, 'size');
      const loan = s.u32(0xFAE8);
      const pt = (() => { let perfect = 0; for (let a = 0; a < 16; a++) { let t = 0, f = 0, w = 0; for (let k = 0; k < 256; k++) { const id = s.u16(0xC354 + (a * 256 + k) * 2); if ((id >= 0x1D && id <= 0x24) || id === 0x1B || id === 0x89) w++; else if (id >= 0x25 && id <= 0x6D) t++; else if (id <= 0x1A || (id >= 0x6E && id <= 0xA5)) f++; } if (w <= 2 && ((t >= 12 && t <= 15 && f >= 3) || (t < 12 && f >= 3 + (12 - t) * 2) || (t > 15 && f >= 3 + (t - 15) * 2))) perfect++; } return perfect; })();
      const tile = (em, title, done, total, link, note) => h('button', { class: 'goal' + (done >= total ? ' done' : ''), onclick: () => go(link) },
        h('div', { class: 'goal-h' }, h('span', { class: 'goal-em' }, em), h('b', null, title), done >= total ? h('span', { class: 'badge ok' }, 'Complete!') : null),
        bar(done, total), note ? h('div', { class: 'ex-meta', style: { marginTop: '6px' } }, note) : null);
      const per = ps.map(p => {
        const enc = kind => D.critters[kind].filter((_, i) => caught(s, p, kind, i)).length;
        const b = s.playerBase(p);
        return h('div', { class: 'card pad' },
          h('div', { style: { fontWeight: 800, fontSize: '15px', marginBottom: '10px' } }, `🧑 ${pname(s, p)}`),
          h('div', { class: 'goal-grid' },
            tile('🦋', 'Bug encyclopedia', enc('bugs'), 56, 'museum', 'Complete it for the Golden Net.'),
            tile('🐟', 'Fish encyclopedia', enc('fish'), 56, 'museum', 'Complete it for the Golden Rod.'),
            tile('💰', 'Savings', Math.min(s.u32(b + 0x21E4), 999999999), 999999999, 'player' + p),
            ...(window.WW_CATALOG ? (() => { const C = WW_CATALOG, l = C.ENTRIES.filter(e => e.kind !== 'Pics' && e.kind !== 'Gyroids'); return [
              tile('📖', 'Catalog', l.filter(e => C.has(s, p, e)).length, l.length, 'catalog', 'Everything Nook can order, not counting gyroids and pics.'),
              tile('🗿', 'Gyroids', C.ENTRIES.filter(e => e.kind === 'Gyroids' && C.has(s, p, e)).length, C.ENTRIES.filter(e => e.kind === 'Gyroids').length, 'catalog'),
              tile('📷', 'Villager pics', C.ENTRIES.filter(e => e.kind === 'Pics' && C.has(s, p, e)).length, C.ENTRIES.filter(e => e.kind === 'Pics').length, 'catalog', 'A neighbor sends their pic at best friendship.')]; })() : [])),
          h('div', { class: 'sub-h', style: { marginTop: '14px' } }, 'Golden tools'),
          h('div', { class: 'gold-list' }, GOLDEN.map(([nm, id, how, flag]) => {
            const where = townHas(s, id), got = (flag !== null && s.bit(b + 0x21FC, flag)) || where.length > 0;
            return h('div', { class: 'gold' + (got ? ' got' : '') }, h('span', { class: 'ex-em' }, got ? '🏅' : '⬜'),
              h('div', null, h('b', null, nm), h('div', { class: 'ex-meta' }, got ? (where.length ? `Found in ${where.join(', ')}` : 'The game says you received it') : how)));
          })));
      });
      return [
        h('div', { class: 'museum-hero', style: { background: 'linear-gradient(135deg,#ffe7a0,#f6c25a)' } }, h('div', { class: 'owl' }, '🏆'),
          h('div', { style: { flex: 1 } }, h('div', { class: 'mh-title' }, 'Town completion'), h('div', { class: 'mh-sub' }, 'Museum, music, home and more. Click any card to jump there.'))),
        section('Town'),
        h('div', { class: 'goal-grid' },
          tile('🏛️', 'Museum', c.total, c.max, 'museum', s.bit(0x15FD8, 3) ? 'Blathers already sent you the Museum Model!' : 'Blathers sends a Museum Model when it’s full.'),
          ...WINGS.map(w => tile(w.em, `Museum: ${w.name}`, c[w.id], w.list.length, 'museum')),
          tile('🎸', 'K.K. songs', songs, 70, 'house', 'K.K. plays at The Roost on Saturdays, 8pm to midnight. Request a song to get a copy.'),
          tile('🏠', 'House upgrades', house, 6, 'house', loan ? `${fmt(loan)} bells still owed to Nook.` : 'Loan fully paid!'),
          tile('🌳', 'Perfect acres', pt, 16, 'town', 'All 16 perfect, then keep it up for 15 days for the Golden Can.')),
        section('Residents'), per.length ? per : h('div', { class: 'card' }, h('div', { class: 'empty-note' }, 'No residents yet.')),
        section('🦴 Fossil assessor', 'Unassessed fossils in pockets and dressers'), fossilAssessor(s, refresh),
        section('Town milestones', 'From the game’s town event flags'),
        card(...[[3, 'Museum Model from Blathers'], [1, 'One-story house model'], [2, 'Two-story house model'], [11, 'Mansion model']].map(([f, nm]) =>
          row(nm, (window.WW_FLAGS.town[f] || {}).sure ? 'Confirmed in the decompilation.' : 'Best guess from where the game uses it.', h('span', { class: 'badge ' + (s.bit(0x15FD8, f) ? 'ok' : 'lab') }, s.bit(0x15FD8, f) ? 'Done' : 'Not yet')))),
      ];
    },
  });
})();
