// For completionists: a Happy Room Academy estimate for every room, and a K.K. jukebox.
//
// HRA: the parts confirmed in the decompilation are each piece's base points by class (sFtrClassBasePoints) and the
// bonuses for a full series (20,000; 25,000 with its wallpaper or carpet; 30,000 with both), a theme with its wallpaper
// and carpet ((n + 1) × 3,000) and a set (n × 1,000). Feng Shui colours and any other room rules aren't confirmed, so
// they're left out and the score is marked as an estimate. Item data comes from the person's ROM (js/views-catalog.js).
(function () {
  'use strict';
  const { h, fmt, section, sfx, toast, itemIcon } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const HOUSE = 0xE558, ROOM = 0x450, SONGS = 0xFAEC;
  const ROOMS = ['Main room', 'Back room', 'East room', 'West room', 'Upstairs'];

  // ---------- Happy Room Academy ----------
  // Everything in one room: its furniture (both layers, each piece once), wallpaper and flooring.
  function roomOf(s, r) {
    const base = HOUSE + r * ROOM, pieces = [];
    for (let k = 0; k < 0x400; k += 2) { const id = s.u16(base + k); if (id >= 0x3000 && id < 0x5000) pieces.push(id & ~3); }
    return { pieces, wall: s.u16(base + 0x448), floor: s.u16(base + 0x44A) };
  }
  // Every series, theme and set, with its pieces (furniture) and its wallpaper and carpet.
  let groupsFor = null, groups = null;
  function seriesGroups(R) {
    if (groupsFor === R) return groups;
    const C = window.WW_CATALOG, m = new Map();
    for (const e of C.ENTRIES) {
      const g = R.get(e.id); if (g.series >= 73 || !R.series[g.series] || R.series[g.series].type > 2) continue;
      if (!m.has(g.series)) m.set(g.series, { i: g.series, type: R.series[g.series].type, name: R.series[g.series].name, items: [], walls: [] });
      (e.kind === 'Wallpaper' || e.kind === 'Carpets' ? m.get(g.series).walls : e.id >= 0x3000 ? m.get(g.series).items : []).push(e);
    }
    groupsFor = R; groups = [...m.values()].filter(g => g.items.length);
    return groups;
  }
  function score(s, r, R) {
    const room = roomOf(s, r), have = new Set(room.pieces);
    const base = room.pieces.reduce((n, id) => n + R.get(id).points, 0);
    const bonuses = [], ideas = [];
    for (const g of seriesGroups(R)) {
      const got = g.items.filter(e => have.has(e.id)), n = g.items.length, missing = g.items.filter(e => !have.has(e.id));
      const wallOk = g.walls.some(e => e.id === room.wall), floorOk = g.walls.some(e => e.id === room.floor);
      let pts = 0, full = 0;
      if (g.type === 0) { full = 20000 + (g.walls.length ? 10000 : 0); if (got.length === n) pts = 20000 + (wallOk ? 5000 : 0) + (floorOk ? 5000 : 0); }
      else if (g.type === 1) { full = (n + 1) * 3000; if (got.length === n && wallOk && floorOk) pts = full; }
      else { full = n * 1000; if (got.length === n) pts = full; }
      if (pts) bonuses.push({ g, pts });
      // Worth finishing: at least half there, or one piece away.
      const needDecor = g.type === 1 ? (!wallOk || !floorOk) : g.type === 0 && got.length === n && (!wallOk || !floorOk);
      if ((missing.length || needDecor) && got.length && (got.length >= n / 2 || missing.length === 1) && full > pts)
        ideas.push({ g, missing, needDecor, gain: full - pts, got: got.length, n });
    }
    ideas.sort((a, b) => b.gain / (a.missing.length + 1) - a.gain / (b.missing.length + 1));
    return { room, base, bonuses, ideas, total: base + bonuses.reduce((n, b) => n + b.pts, 0) };
  }

  const KIND = ['Series', 'Theme', 'Set'];
  VIEWS.push({
    id: 'hra', group: 'Home', icon: '🏅', title: () => 'Happy Room Academy', sub: () => 'Each room’s score, and what would raise it',
    tips: ['Points come from each piece’s class and from complete series, themes and sets in one room.', 'Feng Shui isn’t counted yet, so the real score can be higher.'],
    render(s, { go }) {
      const C = window.WW_CATALOG, R = C && C.romInfo();
      if (!R) return [h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🏅'), 'Happy Room Academy points come from your ROM. Open it on the Welcome screen to score your rooms.'))];
      const rooms = ROOMS.map((name, r) => ({ name, r, ...score(s, r, R) })).filter(x => x.room.pieces.length);
      const total = rooms.reduce((n, x) => n + x.total, 0);
      return [
        h('div', { class: 'card pad hra-top' },
          h('div', { class: 'hra-total' }, h('span', { class: 'muted' }, 'Estimated house score'), h('b', null, fmt(total)), h('span', { class: 'badge lab', title: 'Base points and series, theme and set bonuses are from the game; Feng Shui isn’t counted yet.' }, 'Estimate')),
          h('p', { class: 'muted', style: { margin: '6px 0 0' } }, 'From each piece’s class and every complete series, theme and set, room by room. Feng Shui colours aren’t counted, so the game may give more.')),
        ...rooms.map(x => [
          section(`${x.name}`, `${fmt(x.total)} points · ${x.room.pieces.length} piece${x.room.pieces.length === 1 ? '' : 's'}`),
          h('div', { class: 'card pad' },
            h('div', { class: 'hra-line' }, h('span', null, 'Furniture, by class'), h('b', null, fmt(x.base))),
            x.bonuses.map(b => h('div', { class: 'hra-line ok' }, h('span', null, `✓ ${KIND[b.g.type]}: ${b.g.name}`), h('b', null, `+${fmt(b.pts)}`))),
            x.ideas.length ? h('div', { class: 'sub-h', style: { marginTop: '10px' } }, 'To raise it') : null,
            x.ideas.slice(0, 4).map(i => h('div', { class: 'hra-idea' },
              h('div', null, h('b', null, `${KIND[i.g.type]}: ${i.g.name}`), h('span', { class: 'muted' }, ` · ${i.got} of ${i.n} here`), h('span', { class: 'hra-gain' }, `up to +${fmt(i.gain)}`)),
              h('div', { class: 'hra-missing' },
                i.missing.slice(0, 8).map(e => h('span', { class: 'hra-it', title: e.name }, itemIcon(e.id), e.name)),
                i.missing.length > 8 ? h('span', { class: 'muted' }, `and ${i.missing.length - 8} more`) : null,
                i.needDecor ? h('span', { class: 'hra-it' }, `🧱 its ${i.g.type === 1 ? 'wallpaper and carpet' : 'wallpaper or carpet'}`) : null))),
            h('div', { class: 'btn-row', style: { marginTop: '10px' } }, h('button', { class: 'btn small', onclick: () => go('house') }, 'Open the house')))]),
        rooms.length ? null : h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🏠'), 'No furniture in the house yet.')),
      ];
    },
  });

  // ---------- K.K. jukebox ----------
  // The songs K.K. has taught the house (bit i at 0xFAEC), each playable from the ROM: sequence 176 + i on a stereo,
  // 99 + i live (FtrStereo::startSong, the Roost show).
  const J = { filter: 0, live: false, queue: [], at: -1, playing: null, shuffle: false };
  let paintJ = null;
  function stop() { if (J.playing) { const p = J.playing; J.playing = null; p.stop(); } J.at = -1; if (paintJ) paintJ(); }
  function playAt(k) {
    if (J.playing) { const p = J.playing; J.playing = null; p.stop(); }
    if (k < 0 || k >= J.queue.length) { J.at = -1; if (paintJ) paintJ(); return; }
    J.at = k;
    const i = J.queue[k];
    const r = GameSound.playMusic((J.live ? 99 : 176) + i, { onEnd: () => { if (J.playing && J.playing.i === i) { J.playing = null; setTimeout(() => playAt(J.at + 1), 600); } } });
    if (!r) { sfx.error(); toast('That song couldn’t be played', '🎸'); J.at = -1; }
    else J.playing = { i, stop: r.stop };
    if (paintJ) paintJ();
  }
  function start(list) {
    J.queue = J.shuffle ? list.map(i => [Math.random(), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]) : list.slice();
    playAt(0);
  }

  VIEWS.push({
    id: 'jukebox', group: 'Home', icon: '🎸', title: () => 'K.K. Jukebox', sub: () => 'Every song, the ones you have, and the ones still to learn',
    tips: ['K.K. plays at the Roost on Saturday nights; ask for a song and he gives you a copy.', 'Songs marked as learned are the ones the game records for the house.'],
    render(s, { refresh }) {
      const songs = D.songs.map((name, i) => ({ name, i })).filter(x => x.name && x.i < 70);
      const has = x => !!s.bit(SONGS, x.i);
      const mine = songs.filter(has), missing = songs.filter(x => !has(x));
      const list = [songs, mine, missing][J.filter];
      const canPlay = window.GameSound && GameSound.ready();
      const root = h('div');
      const draw = () => {
        const now = J.at >= 0 ? J.queue[J.at] : -1;
        root.replaceChildren(
          h('div', { class: 'card pad cat-bar' },
            UI.seg([[0, `All ${songs.length}`], [1, `Learned ${mine.length}`], [2, `Still to learn ${missing.length}`]], () => J.filter, v => { J.filter = v; refresh(); }),
            h('span', { class: 'spacer' }),
            canPlay ? [
              h('label', { class: 'sync-check' }, (() => { const c = h('input', { type: 'checkbox', checked: J.live }); c.onchange = () => { J.live = c.checked; }; return c; })(), ' Live at the Roost'),
              h('label', { class: 'sync-check' }, (() => { const c = h('input', { type: 'checkbox', checked: J.shuffle }); c.onchange = () => { J.shuffle = c.checked; }; return c; })(), ' Shuffle'),
              h('button', { class: 'btn small leaf', disabled: !list.length, onclick: () => { sfx.click(); start(list.map(x => x.i)); } }, `▶ Play ${J.filter === 1 ? 'mine' : 'these'}`),
              now >= 0 ? h('button', { class: 'btn small', onclick: stop }, '■ Stop') : null] : null),
          !canPlay ? h('div', { class: 'callout' }, h('span', { class: 'em' }, '🎮'), h('div', null, 'Open your ROM on the Welcome screen to listen. The list works without it.')) : null,
          now >= 0 ? h('div', { class: 'card pad jb-now' }, h('span', { class: 'em' }, '🎶'), h('b', null, D.songs[now]), h('span', { class: 'muted' }, ` · ${J.at + 1} of ${J.queue.length}${J.live ? ' · live' : ''}`),
            h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => playAt(J.at + 1) }, 'Next ⏭')) : null,
          h('div', { class: 'card jb-list' }, list.map(x => h('div', { class: 'jb-row' + (has(x) ? ' got' : '') + (x.i === now ? ' on' : '') },
            h('span', { class: 'jb-n' }, has(x) ? '💿' : '◌'), h('b', null, x.name),
            h('span', { class: 'muted' }, has(x) ? 'Learned' : 'Not yet'),
            h('span', { class: 'spacer' }),
            canPlay ? h('button', { class: 'btn small', onclick: () => { if (x.i === now) stop(); else { J.queue = [x.i]; playAt(0); } } }, x.i === now ? '■' : '▶') : null,
            h('button', { class: 'btn small', title: has(x) ? 'Forget it' : 'Mark it as learned', onclick: () => { s.setBit(SONGS, x.i, !has(x)); sfx.toggle(has(x)); refresh(); } }, has(x) ? '✕' : '＋')))),
        );
      };
      paintJ = () => { if (root.isConnected) draw(); };
      draw();
      return root;
    },
  });
})();
