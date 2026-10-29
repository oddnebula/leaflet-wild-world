// Town-wide records that had no editor of their own: the post office (letters waiting for delivery, the message in a
// bottle, letters from other towns), the bulletin board, and Celeste's constellations. Layouts from the
// decompilation: Outbox, BottleLetterRecord, ReceivedLetterBlock, TownExchangeRecord, BbsBoard / BbsPost,
// ConstellationRecord and sConstellationLineCells.
(function () {
  'use strict';
  const { h, hex, row, card, section, numberInput, selectInput, textInput, switchInput, sfx, toast, confirmSheet } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const range = n => [...Array(n).keys()];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateText = (s, o) => { const d = s.u8(o), m = s.u8(o + 1), y = s.u8(o + 2); return m ? `${MONTHS[m - 1] || '?'} ${d}, 20${String(y).padStart(2, '0')}` : 'No date'; };
  function dmy(s, o, refresh) {
    const f = (i, max) => numberInput(() => s.u8(o + i), v => { s.set8(o + i, v); if (refresh) refresh(); }, { max, width: 'w-s' });
    return h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, f(1, 12), '/', f(0, 31), '/', f(2, 99));
  }
  const bitSwitch = (s, o, bit) => switchInput(() => (s.u8(o) >> bit) & 1, v => s.set8(o, (s.u8(o) & ~(1 << bit)) | (v ? 1 << bit : 0)));

  // =====================================================================================
  // Post office
  const OUTBOX = 0x1463C, BOTTLE = 0x15B5C, RECEIVED = 0x15C58, EXCHANGE = 0x10C3C;
  let postPick = 'out0';
  VIEWS.push({
    id: 'post', group: 'Places', icon: '📮', title: () => 'Post Office', sub: () => 'Mail on its way, bottles and letters from other towns',
    tips: ['Letters you mail at the town hall wait here until the next delivery (9 AM and 5 PM).', 'The message in a bottle washes up on the beach; the game picks a message it hasn’t used yet.'],
    render(s, { refresh }) {
      const { letterEditor, mainAcc } = window.LetterEditor, acc = mainAcc(s);
      const from = o => s.str(o + 0x28, 8), to = o => s.str(o + 0x10, 8);
      const label = (o, name) => `${name}${from(o) || to(o) ? ` · ${from(o) || '?'} → ${to(o) || '?'}` : ' · empty'}`;
      const opts = [...range(10).map(k => [`out${k}`, label(OUTBOX + k * 0xF4, `Waiting for delivery ${k + 1}`)]),
        ['bottle', label(BOTTLE, 'Message in a bottle')], ['received', label(RECEIVED, 'Letter from another town')], ['exchange', label(EXCHANGE, 'Letter traveling with a villager')]];
      const pick = h('select', { class: 'field w-l' }, opts.map(([v, l]) => h('option', { value: v, selected: v === postPick }, l)));
      pick.onchange = () => { postPick = pick.value; sfx.click(); refresh(); };
      let editor;
      if (postPick.startsWith('out')) {
        const k = +postPick.slice(3);
        editor = [letterEditor(acc, OUTBOX + k * 0xF4, s, `Waiting for delivery ${k + 1}`),
          section('Delivery round'),
          card(
            row('Last delivery', `${dateText(s, OUTBOX + 0x988)} at ${s.u8(OUTBOX + 0x98B)}:00`, h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, dmy(s, OUTBOX + 0x988, refresh), numberInput(() => s.u8(OUTBOX + 0x98B), v => { s.set8(OUTBOX + 0x98B, v); refresh(); }, { max: 23, width: 'w-s', suffix: ':00' })), OUTBOX + 0x988),
            row('Outbox flags', 'Outbox state bits (Outbox +0x98C).', numberInput(() => s.u16(OUTBOX + 0x98C), v => s.set16(OUTBOX + 0x98C, v), { max: 0xFFFF, width: 'w-s' }), OUTBOX + 0x98C))];
      } else if (postPick === 'bottle') {
        const used = range(40).filter(i => s.bit(BOTTLE + 0xF4, i)).length;
        editor = [letterEditor(acc, BOTTLE, s, 'Message in a bottle'),
          section('Bottle messages', `${used} of the game’s messages already used`),
          card(row('Use every message again', 'Clears the used-message bits so any bottle message can wash up.', h('button', { class: 'btn small', onclick: () => { for (let i = 0; i < 5; i++) s.set8(BOTTLE + 0xF4 + i, 0); sfx.pop(); toast('Fresh messages for the sea', '🍾'); refresh(); } }, 'Reset'), BOTTLE + 0xF4)),
          h('div', { class: 'card' }, window.BitBytes(s, BOTTLE + 0xF4, 5, o => 'messages ' + (o - BOTTLE - 0xF4) * 8 + '–' + ((o - BOTTLE - 0xF4) * 8 + 7)))];
      } else if (postPick === 'received') {
        editor = [letterEditor(acc, RECEIVED, s, 'Letter from another town'), card(row('Checksum', 'Kept valid automatically when you save.', h('span', { class: 'badge ok' }, 'Auto')))];
      } else {
        editor = [letterEditor(acc, EXCHANGE, s, 'Letter traveling with a villager'),
          card(row('Exchange counter', 'Counts town exchanges (TownExchangeRecord counter).', numberInput(() => s.u8(EXCHANGE + 0x83C), v => s.set8(EXCHANGE + 0x83C, v), { max: 255, width: 'w-s' }), EXCHANGE + 0x83C),
            row('Exchange flags', null, numberInput(() => s.u8(EXCHANGE + 0x83D), v => s.set8(EXCHANGE + 0x83D, v), { max: 255, width: 'w-s' }), EXCHANGE + 0x83D))];
      }
      return [section('Choose a letter', '10 waiting at the post office, a bottle, and letters from other towns'), card(row('Letter', null, pick)), section(''), editor];
    },
  });

  // =====================================================================================
  // Bulletin board: 15 posts (192 characters, date, bits 0–3 read by resident 1–4, bit 4 typed by a resident).
  const BBS = 0x11488, POST = 0xC4;
  VIEWS.push({
    id: 'bbs', group: 'Places', icon: '📌', title: () => 'Bulletin Board', sub: () => 'Notices by the train station',
    tips: ['Residents can post their own notes; the game also posts event notices and slogans.', 'Each post remembers which residents have read it.'],
    render(s, { refresh }) {
      const count = s.u8(BBS + 0xB7E);
      const residents = range(4).filter(q => s.playerExists(q));
      const posts = range(15).map(k => {
        const o = BBS + k * POST, empty = !s.u8(o) && !s.u8(o + 0xC1);
        const body = h('textarea', { class: 'field bbs-text', rows: 4, maxlength: 192, spellcheck: 'false' });
        body.value = s.str(o, 0xC0);
        body.addEventListener('change', () => { if (!WWSave.canEncode(body.value)) { sfx.error(); toast('Some characters can’t be written in-game', '⚠️'); return; } s.setStr(o, 0xC0, body.value); sfx.click(); });
        return h('div', { class: 'card bbs-post' + (empty ? ' empty' : '') },
          h('div', { class: 'bbs-head' }, h('b', null, `Post ${k + 1}`), h('span', { class: 'mono muted' }, hex(o, 5)), h('span', { class: 'muted' }, dateText(s, o + 0xC0))),
          body,
          row('Posted on', null, dmy(s, o + 0xC0, refresh), o + 0xC0),
          row('Written by a resident', 'Off for notices the game posts itself.', bitSwitch(s, o + 0xC3, 4), o + 0xC3),
          row('Read by', null, h('span', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' } }, (residents.length ? residents : [0, 1, 2, 3]).map(q => h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px' } }, s.playerExists(q) ? s.str(s.playerBase(q) + 0x2282, 8) : `Resident ${q + 1}`, bitSwitch(s, o + 0xC3, q)))), o + 0xC3));
      });
      return [
        section('Board', `${count} post${count === 1 ? '' : 's'} up`),
        card(
          row('Posts on the board', 'How many of the 15 slots the game shows, newest last.', numberInput(() => s.u8(BBS + 0xB7E), v => { s.set8(BBS + 0xB7E, v); refresh(); }, { max: 15, width: 'w-s' }), BBS + 0xB7E),
          row('Current notice', 'Id of the latest event notice (BbsBoard notice id).', numberInput(() => s.u16(BBS + 0xB7C), v => s.set16(BBS + 0xB7C, v), { max: 0xFFFF, width: 'w-s' }), BBS + 0xB7C),
          // TownState +0x68 (0x15EBC): the day TownBbs_UpdateDaily last posted, d / m / y, 0xFF = never; +0x22: posting has started.
          row('Notices last posted', s.u8(0x15EBD) === 0xFF ? 'Never: the board posts everything due when you next play.' : `${dateText(s, 0x15EBC)}. The game posts every notice due since then (up to 31 days) when you next play.`,
            h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, dmy(s, 0x15EBC, refresh), h('button', { class: 'btn small', title: 'Post everything again next time', onclick: () => { s.set8(0x15EBC, 0xFF); s.set8(0x15EBD, 0xFF); s.set8(0x15EBE, 0xFF); sfx.pop(); refresh(); } }, 'Never')), 0x15EBC),
          row('Event notices started', 'Set once the town hall has posted its first event notices. A brand-new town keeps it off until the first day is over.', switchInput(() => s.u8(0x15E76), v => s.set8(0x15E76, v ? 1 : 0)), 0x15E76),
          row('Mark everything read', null, h('button', { class: 'btn small', onclick: () => { for (let k = 0; k < 15; k++) s.set8(BBS + k * POST + 0xC3, s.u8(BBS + k * POST + 0xC3) | 15); sfx.pop(); refresh(); } }, 'All read')),
          row('Notices already posted', 'Pelly’s notices and the town slogans the game has put up, one bit each (TownState).', h('span', { class: 'muted' }, 'below'))),
        h('div', { class: 'card' }, window.BitBytes(s, 0x15E60, 10, o => 'notices ' + (o - 0x15E60) * 8 + '+'), window.BitBytes(s, 0x15E6A, 11, o => 'slogans ' + (o - 0x15E6A) * 8 + '+')),
        section('Posts'),
        h('div', { class: 'bbs-grid' }, posts),
      ];
    },
  });

  // =====================================================================================
  // Celeste's constellations: 16 records (creator, name, up to 16 sky segments) plus used and new masks.
  // Segment n covers up to four cells of the 64×32 sky (D.skyLines from sConstellationLineCells).
  const SKY = 0x14FCC, REC = 0x46, EX_SKY = EXCHANGE + 0xF4;
  let skyPick = 0;
  // free: a slot the game hasn't used yet (its lines read as zeros, not 0xFFFF); claim() marks it used on first edit.
  function skyEditor(s, o, refresh, free = false, claim = null) {
    const lines = () => free ? [] : [...new Set(range(16).map(i => s.u16(o + 0x26 + i * 2)).filter(v => v !== 0xFFFF && v < D.skyLines.length))];
    const setLines = arr => { range(16).forEach(i => s.set16(o + 0x26 + i * 2, i < arr.length ? arr[i] : 0xFFFF)); if (free && claim) claim(); };
    const cur = new Set(lines()), C = 10, NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${64 * C} ${32 * C}`); svg.setAttribute('class', 'sky');
    const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.append(e); return e; };
    const stars = new Set();
    D.skyLines.forEach((cells, n) => {
      if (!cells.length) return;
      const pts = cells.map(([x, y]) => `${x * C + C / 2},${y * C + C / 2}`).join(' ');
      cells.forEach(([x, y]) => stars.add(x + ',' + y));
      const on = cur.has(n);
      const line = add('polyline', { points: pts, class: 'sky-seg' + (on ? ' on' : '') });
      const hit = add('polyline', { points: pts, class: 'sky-hit' });
      hit.addEventListener('mouseenter', () => line.classList.add('hover'));
      hit.addEventListener('mouseleave', () => line.classList.remove('hover'));
      hit.addEventListener('click', () => {
        const l = lines();
        if (cur.has(n)) setLines(l.filter(v => v !== n));
        else if (l.length >= 16) { sfx.error(); toast('A constellation holds up to 16 lines', '✨'); return; }
        else setLines([...l, n]);
        sfx.toggle(!cur.has(n)); refresh();
      });
      const title = document.createElementNS(NS, 'title'); title.textContent = `Line ${n}`; hit.append(title);
    });
    for (const k of stars) { const [x, y] = k.split(',').map(Number); add('circle', { cx: x * C + C / 2, cy: y * C + C / 2, r: 1.4, class: 'sky-star' }); }
    for (const n of cur) for (const [x, y] of D.skyLines[n] || []) add('circle', { cx: x * C + C / 2, cy: y * C + C / 2, r: 3, class: 'sky-star on' });
    return [h('div', { class: 'card sky-card' }, svg, h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '6px' } }, `${cur.size} of 16 lines · click a line in the sky to add or remove it`)),
      card(
        row('Name', null, textInput(() => s.str(o + 0x16, 16), v => s.setStr(o + 0x16, 16, v), 16, { check: WWSave.canEncode }), o + 0x16),
        row('Made by', `${s.str(o + 0xC, 8) || 'Nobody'} from ${s.str(o + 2, 8) || '?'}`, h('span', { style: { display: 'flex', gap: '6px' } }, textInput(() => s.str(o + 0xC, 8), v => s.setStr(o + 0xC, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }), textInput(() => s.str(o + 2, 8), v => s.setStr(o + 2, 8, v), 8, { width: 'w-s', check: WWSave.canEncode })), o),
        row('Line numbers', lines().join(', ') || 'None', h('button', { class: 'btn small danger', onclick: () => { setLines([]); sfx.pop(); refresh(); } }, 'Erase lines'), o + 0x26),
        row('Share it', 'A short code a friend can paste into their own sky, or a picture to post.', h('span', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
          h('button', { class: 'btn small', disabled: !cur.size, onclick: () => { const code = skyCode(s.str(o + 0x16, 16), lines()); (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast('Code copied', '✨'), () => UI.confirmSheet('Your constellation code', code, 'Done')); } }, '📋 Copy code'),
          h('button', { class: 'btn small', disabled: !cur.size, onclick: () => skyPicture(s.str(o + 0x16, 16), lines()) }, '🖼️ Picture'),
          h('input', { class: 'field w-m', placeholder: 'Paste a code: WWSKY:…', spellcheck: 'false', onchange: e => { const r = readSkyCode(e.target.value); if (!r) { sfx.error(); toast('That isn’t a constellation code', '⚠️'); return; } setLines(r.lines); s.setStr(o + 0x16, 16, r.name); sfx.bell(); toast(`${r.name || 'The constellation'} is in your sky`, '✨'); refresh(); } }))))];
  }
  // Share codes: "WWSKY:<name>:<line numbers in base 36>", made by Leaflet (the game has no such code).
  function skyCode(name, lines) { return `WWSKY:${encodeURIComponent(name)}:${lines.map(n => n.toString(36)).join('.')}`; }
  function readSkyCode(t) {
    const m = /WWSKY:([^:\s]*):([0-9a-z.]+)/i.exec(t.trim()); if (!m) return null;
    const lines = [...new Set(m[2].split('.').filter(Boolean).map(x => parseInt(x, 36)))].filter(n => n >= 0 && n < D.skyLines.length && D.skyLines[n].length).slice(0, 16);
    let name = ''; try { name = decodeURIComponent(m[1]); } catch (e) { /* keep it blank */ }
    name = [...name].filter(c => WWSave.canEncode(c)).join('').slice(0, 16);
    return lines.length ? { name, lines } : null;
  }
  // A picture of one constellation on Leaflet's own night sky (no game art).
  function skyPicture(name, lines) {
    const C = 16, cv = document.createElement('canvas'); cv.width = 64 * C; cv.height = 32 * C + 60;
    const g = cv.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, cv.height);
    grad.addColorStop(0, '#141b3d'); grad.addColorStop(1, '#2b2f6b'); g.fillStyle = grad; g.fillRect(0, 0, cv.width, cv.height);
    const at = ([x, y]) => [x * C + C / 2, y * C + C / 2 + 10];
    const stars = new Set(); D.skyLines.forEach(cells => cells.forEach(c => stars.add(c.join(','))));
    g.fillStyle = 'rgba(255,255,255,.35)'; for (const k of stars) { const [x, y] = at(k.split(',').map(Number)); g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
    g.strokeStyle = '#ffe48a'; g.lineWidth = 4; g.lineCap = g.lineJoin = 'round'; g.shadowColor = '#ffd84a'; g.shadowBlur = 10;
    for (const n of lines) { const pts = D.skyLines[n].map(at); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
    g.fillStyle = '#fff6c8'; for (const n of lines) for (const c of D.skyLines[n]) { const [x, y] = at(c); g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); }
    g.shadowBlur = 0; g.fillStyle = '#fff9e8'; g.font = '800 26px Nunito, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(name || 'My constellation', cv.width / 2, cv.height - 22);
    cv.toBlob(b => { const a = h('a', { href: URL.createObjectURL(b), download: `${name || 'Constellation'}.png` }); document.body.append(a); a.click(); a.remove(); });
    sfx.pop();
  }
  VIEWS.push({
    id: 'sky', group: 'Places', icon: '✨', title: () => 'Celeste’s Sky', sub: () => 'The constellations your town has made',
    tips: ['Celeste lets you design constellations from the observatory; up to 16 are kept.', 'A constellation can also arrive with a villager moving in from another town.'],
    render(s, { refresh }) {
      const used = s.u16(SKY + 0x460), fresh = s.u16(SKY + 0x462);
      const opts = [...range(16).map(k => [k, `${k + 1}. ${s.str(SKY + k * REC + 0x16, 16) || ((used >> k) & 1 ? '(unnamed)' : '(free slot)')}`]), [16, 'From another town (town exchange)']];
      const o = skyPick === 16 ? EX_SKY : SKY + skyPick * REC;
      return [
        section('Constellations', `${range(16).filter(k => (used >> k) & 1).length} of 16 slots used`),
        card(row('Constellation', null, selectInput(opts, () => skyPick, v => { skyPick = v; refresh(); }, { width: 'w-l' })),
          skyPick < 16 ? row('Slot in use', 'Off frees the slot (ConstellationRecords used mask).', switchInput(() => (s.u16(SKY + 0x460) >> skyPick) & 1, v => { s.set16(SKY + 0x460, (s.u16(SKY + 0x460) & ~(1 << skyPick)) | (v ? 1 << skyPick : 0)); refresh(); }), SKY + 0x460) : null,
          skyPick < 16 ? row('Not seen yet', 'New constellations Celeste hasn’t shown you (new mask).', switchInput(() => (fresh >> skyPick) & 1, v => s.set16(SKY + 0x462, (s.u16(SKY + 0x462) & ~(1 << skyPick)) | (v ? 1 << skyPick : 0))), SKY + 0x462) : null),
        ...skyEditor(s, o, refresh, skyPick < 16 && !((used >> skyPick) & 1), () => { s.set16(SKY + 0x460, s.u16(SKY + 0x460) | (1 << skyPick)); s.set16(SKY + 0x462, s.u16(SKY + 0x462) | (1 << skyPick)); }),
      ];
    },
  });
})();
