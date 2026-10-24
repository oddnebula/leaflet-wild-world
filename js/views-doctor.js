// Save Doctor: looks for states the game never makes on its own (usually left by older editors or cheat codes) and
// explains each one, with a fix where a safe one exists. Checksums are always repaired on save, so they're only noted.
(function () {
  'use strict';
  const { h, fmt, section, sfx, toast, hex } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const byId = new Map(D.villagers.map(v => [v.id, v]));
  const VB = 0x8A3C, MAP = 0xC354, HOUSE = 0xE558, EMPTY = 0xFFF1;
  const known = id => id === EMPTY || UI.item(id).name !== 'Unknown item';
  const vname = id => byId.get(id)?.name || `villager ${hex(id, 2)}`;

  function examine(s) {
    const out = [], issue = (sev, title, body, fix, go) => out.push({ sev, title, body, fix, go });
    const ps = [0, 1, 2, 3].filter(p => s.playerExists(p));
    // Save structure
    if (!s.copyStatus[0] || !s.copyStatus[1]) issue('note', 'One of the two copies inside the file was damaged', 'Leaflet loaded the healthy one. Saving writes both copies again.', null);
    if (!s.lettersValid) issue('note', 'The town hall mailbox checksum was off', 'It is recalculated when you save.', null);
    if (!s.str(4, 8).trim()) issue('warn', 'The town has no name', 'Some screens show a blank where the town name goes.', null, 'town');
    if (s.u8(0x15FDE) === 0x1C) issue('note', 'The last session ended without saving', 'Mr. Resetti will be waiting next time you play.', ['Mark as saved properly', () => s.set8(0x15FDE, 2)]);
    if (s.u32(0x15E58) > 4) issue('error', `The native fruit is ${s.u32(0x15E58)}`, 'Only 0–4 (apple, orange, pear, peach, cherry) exist.', ['Set it to apples', () => s.set32(0x15E58, 0)], 'town');
    // Residents
    for (const p of ps) {
      const b = s.playerBase(p), n = s.str(b + 0x2282, 8) || `Resident ${p + 1}`;
      if (!s.str(b + 0x2282, 8).trim()) issue('warn', `Resident ${p + 1} has no name`, 'Villagers will call them by an empty name.', null, 'player' + p);
      if (s.u32(b + 0x1B40) > 99999) issue('error', `${n}’s wallet holds ${fmt(s.u32(b + 0x1B40))} bells`, 'A wallet can hold at most 99,999 bells. More can roll over or confuse shops.', ['Cap at 99,999', () => s.set32(b + 0x1B40, 99999)], 'player' + p);
      if (s.u32(b + 0x21E4) > 999999999) issue('error', `${n}’s savings are ${fmt(s.u32(b + 0x21E4))} bells`, 'The bank stops at 999,999,999.', ['Cap the savings', () => s.set32(b + 0x21E4, 999999999)], 'player' + p);
      const bm = s.u8(b + 0x2219), bd = s.u8(b + 0x2218);
      if (bm > 12 || (bm && (bd < 1 || bd > new Date(2001, bm, 0).getDate()))) issue('warn', `${n}’s birthday is ${bm}/${bd}`, 'That date doesn’t exist, so the birthday party never happens.', null, 'player' + p);
      const bad = [];
      for (let k = 0; k < 15; k++) if (!known(s.u16(b + 0x1B22 + k * 2))) bad.push(b + 0x1B22 + k * 2);
      for (let k = 0; k < 90; k++) if (!known(s.u16(0x15430 + p * 0xB4 + k * 2))) bad.push(0x15430 + p * 0xB4 + k * 2);
      if (bad.length) issue('error', `${n} carries ${bad.length} item${bad.length === 1 ? '' : 's'} the game doesn’t have`, `Item ids ${[...new Set(bad.map(o => hex(s.u16(o))))].slice(0, 6).join(', ')} aren’t real items; touching them in game can freeze it.`, ['Remove them', () => bad.forEach(o => s.set16(o, EMPTY))], 'player' + p);
    }
    // Neighbors
    const seen = new Map();
    for (let n = 0; n < 8; n++) {
      const id = s.u8(VB + n * 0x700 + 0x6CB); if (id === 0xFF) continue;
      if (!byId.has(id)) issue('error', `Neighbor slot ${n + 1} holds an unknown villager (${hex(id, 2)})`, 'Only 150 villagers exist. Pick one in the Neighbors page.', null, 'villager' + n);
      if (seen.has(id)) issue('error', `${vname(id)} lives here twice`, `Slots ${seen.get(id) + 1} and ${n + 1} are the same villager. The game expects each one only once.`, null, 'villager' + n);
      else seen.set(id, n);
    }
    // Map: neighbor houses and unknown items
    const houses = new Array(8).fill(0), mapBad = [];
    for (let k = 0; k < 16 * 256; k++) {
      const id = s.u16(MAP + k * 2);
      if (id >= 0x5001 && id <= 0x5008) houses[id - 0x5001]++;
      else if (!known(id)) mapBad.push(MAP + k * 2);
    }
    for (let n = 0; n < 8; n++) {
      const lives = s.u8(VB + n * 0x700 + 0x6CB) !== 0xFF;
      if (lives && houses[n] === 0) issue('error', `${vname(s.u8(VB + n * 0x700 + 0x6CB))} has no house on the map`, 'Their house building is missing, so they have nowhere to go. Move their house in the Neighbors page to place it again.', null, 'villager' + n);
      if (houses[n] > 1) issue('warn', `Neighbor ${n + 1}’s house appears ${houses[n]} times on the map`, 'Only one is the real house; the others are copies that can’t be entered properly.', null, 'map');
      if (!lives && houses[n]) issue('warn', `An empty lot still has a house (neighbor slot ${n + 1})`, 'Nobody lives in it. The game usually removes the house when a villager leaves.', null, 'map');
    }
    if (mapBad.length) issue('error', `${mapBad.length} spot${mapBad.length === 1 ? '' : 's'} on the town map hold items the game doesn’t have`, `Ids like ${[...new Set(mapBad.map(o => hex(s.u16(o))))].slice(0, 6).join(', ')}. Walking over them can crash the game.`, ['Clear those spots', () => mapBad.forEach(o => s.set16(o, EMPTY))], 'map');
    // House rooms (both layers, the first 0x400 bytes of each room)
    const roomBad = [];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 512; k++) { const o = HOUSE + r * 0x450 + k * 2, id = s.u16(o); if (!known(id) && !(id >= 0xF000 && id < 0xF100)) roomBad.push(o); }
    if (roomBad.length) issue('error', `${roomBad.length} unknown item${roomBad.length === 1 ? '' : 's'} in the house`, `Ids like ${[...new Set(roomBad.map(o => hex(s.u16(o))))].slice(0, 6).join(', ')}.`, ['Remove them', () => roomBad.forEach(o => s.set16(o, EMPTY))], 'house');
    // Calendar
    for (let k = 0; k < 5; k++) {
      const o = 0x15E18 + 0x14 + k * 6, m = s.u8(o + 1), d = s.u8(o);
      if (s.u8(o + 2) !== 99 && (m > 12 || d > 31)) issue('warn', `Visitor slot ${k + 1} has the date ${m}/${d}`, 'That day can’t come, so the visitor never shows up. Re-roll the week in Town Records.', null, 'records');
    }
    return out;
  }

  const SEV = { error: ['🚑', 'Needs fixing'], warn: ['⚠️', 'Worth a look'], note: ['ℹ️', 'Good to know'] };
  VIEWS.push({
    id: 'doctor', group: 'Lab', icon: '🩺', title: () => 'Save Doctor', sub: () => 'Checks for anything the game wouldn’t do itself',
    badge: s => { const n = examine(s).filter(i => i.sev === 'error').length; return n || ''; },
    tips: ['Problems usually come from old editors, cheat codes or a save that was cut off mid-write.', 'Every fix is an ordinary edit: nothing is written until you save, and Backups keeps the version you opened.'],
    render(s, { refresh, go }) {
      const list = examine(s);
      const fixable = list.filter(i => i.fix);
      return [
        h('div', { class: 'card pad', style: { display: 'flex', gap: '12px', alignItems: 'center' } }, h('span', { style: { fontSize: '30px' } }, list.some(i => i.sev === 'error') ? '🚑' : list.length ? '🩹' : '💚'),
          h('div', { style: { flex: 1 } }, h('b', null, list.length ? `${list.length} thing${list.length === 1 ? '' : 's'} found` : 'Your town is perfectly healthy'), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, list.length ? 'Each one says what’s wrong and, where it’s safe, offers a fix.' : 'Every check passed: residents, neighbors, houses, items, money and dates.')),
          fixable.length > 1 ? h('button', { class: 'btn small leaf', onclick: () => { fixable.forEach(i => i.fix[1]()); sfx.bell(); toast(`Fixed ${fixable.length} things`, '🩺'); refresh(); } }, `Fix all ${fixable.length}`) : null),
        ...['error', 'warn', 'note'].map(sev => { const l = list.filter(i => i.sev === sev); return l.length ? [section(`${SEV[sev][0]} ${SEV[sev][1]}`, `${l.length}`),
          h('div', { class: 'card' }, l.map(i => h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 't' }, i.title), h('div', { class: 'd' }, i.body)),
            h('div', { class: 'row-ctl', style: { display: 'flex', gap: '6px' } }, i.go ? h('button', { class: 'btn small', onclick: () => go(i.go) }, 'Go there') : null,
              i.fix ? h('button', { class: 'btn small leaf', onclick: () => { i.fix[1](); sfx.pop(); toast('Fixed', '🩺'); refresh(); } }, i.fix[0]) : null))))] : null; }),
        section('What gets checked'),
        h('div', { class: 'card pad muted', style: { fontSize: '12.5px', lineHeight: 1.6 } }, 'Both copies and the mailbox checksum, the town name and native fruit, how the last session ended; each resident’s name, wallet and savings limits, birthday and any items in pockets or dressers that don’t exist; neighbors that don’t exist or live here twice; that every neighbor has exactly one house on the map and empty lots have none; unknown items on the map and in the house; and visitor days that can’t happen.'),
      ];
    },
  });
  window.WW_DOCTOR = { examine };
})();
