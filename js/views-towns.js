// Badges and Town vs Town: every town Leaflet knows (the open save and the newest backup of each other town), with
// badges earned from what each save records (golden tools, the museum, songs, the house, the town rating, letters from
// the town hall and the ATM) and the towns side by side.
(function () {
  'use strict';
  const { h, section, fmt, sfx } = UI;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const D = window.WW_DATA;
  const range = n => [...Array(n).keys()];
  const MUSEUM = 0x15D50, SONGS = 0xFAEC, HOUSE = 0xFAF8, LOAN = 0xFAE8, MAP = 0xC354, TOWN_FLAGS = 0x15FD8, SKY = 0x14FCC;

  // What a save says about its town.
  function stats(s) {
    const ps = range(4).filter(p => s.playerExists(p));
    const pflag = (p, n) => (s.u32(s.playerBase(p) + 0x21FC + (n >> 5) * 4) >>> (n & 31)) & 1;
    const anyFlag = n => ps.some(p => pflag(p, n));
    let exhibits = 0; for (let i = 0; i < 0x60; i++) { const b = s.u8(MUSEUM + i); exhibits += (b & 15 ? 1 : 0) + (b >> 4 ? 1 : 0); }
    let songs = 0; for (let i = 0; i < 70; i++) songs += s.bit(SONGS, i) ? 1 : 0;
    let flowers = 0, gold = false; for (let i = 0; i < 4096; i++) { const v = s.u16(MAP + i * 2); if (v <= 0x1D || (v >= 0x8A && v <= 0xA5)) flowers++; if (v === 0x1C || v === 0xA5) gold = true; }
    const neighbors = range(8).filter(v => s.u8(s.villagerBase(v) + 0x6CB) !== 0xFF).length;
    const bells = Math.max(0, ...ps.map(p => s.u32(s.playerBase(p) + 0x1B40) + s.u32(s.playerBase(p) + 0x21E4)));
    const points = Math.max(0, ...ps.map(p => s.u16(s.playerBase(p) + 0x2208)));
    const size = s.u32(HOUSE) & 7, loan = s.u32(LOAN), T = window.WW_PERFECT.town(s);
    const tflag = n => (s.u32(TOWN_FLAGS) >>> n) & 1;
    const constellations = range(16).filter(k => (s.u16(SKY + 0x460) >> k) & 1).length;
    return { town: s.str(4, 8), residents: ps.map(p => s.str(s.playerBase(p) + 0x2282, 8)), exhibits, songs, flowers, gold, neighbors, bells, points, size, loan, rating: T.rating, ratingWord: T.word, anyFlag, tflag, constellations };
  }
  // Each badge: [emoji, name, how to earn it, test].
  const BADGES = [
    ['🏛️', 'Full museum', 'Every one of the 184 exhibits donated.', x => x.exhibits >= 184 || x.tflag(3)],
    ['🎸', 'K.K.’s biggest fan', 'All 70 K.K. songs in the house.', x => x.songs >= 70],
    ['🏰', 'Mansion', 'The house fully built.', x => x.size >= 6],
    ['🔑', 'Debt-free', 'The mansion, and every bell of the loan paid off.', x => x.size >= 6 && x.loan === 0],
    ['🌟', 'Perfect town', 'A perfect rating: every acre at 95+ and 8 at 101+.', x => x.rating === 4],
    ['🪣', 'Golden Can', 'Given for keeping the town perfect.', x => x.anyFlag(32)],
    ['🎣', 'Golden Rod', 'Given for completing the fish encyclopedia.', x => x.anyFlag(33)],
    ['🦋', 'Golden Net', 'Given for completing the bug encyclopedia.', x => x.anyFlag(34)],
    ['🪙', 'Millionaire', 'A million bells in savings (Pelly’s letter).', x => x.anyFlag(17)],
    ['💰', 'Bell tycoon', '100 million bells in savings.', x => x.anyFlag(19)],
    ['🤑', 'Maxed out', '999,999,999 bells in savings.', x => x.anyFlag(21)],
    ['💎', 'Platinum member', '20,000 Nook Points.', x => x.anyFlag(31) || x.points >= 20000],
    ['🏡', 'House of dreams', 'The Mansion model from the Happy Room Academy (150,000 points).', x => x.tflag(11)],
    ['🌹', 'Golden gardener', 'A gold rose growing in town.', x => x.gold],
    ['🌷', 'Blooming town', '100 or more flowers in town.', x => x.flowers >= 100],
    ['🏘️', 'Full town', 'All eight houses lived in.', x => x.neighbors >= 8],
    ['✨', 'Stargazer', 'A constellation of your own in Celeste’s sky.', x => x.constellations > 0],
  ];

  let towns = null, loading = false;
  async function load(current, refresh) {
    if (loading) return; loading = true;
    const list = [], seen = new Set();
    const add = (s, label, when) => { const key = `${s.u16(2)}-${s.str(4, 8)}`; if (seen.has(key)) return; seen.add(key); list.push({ key, label, when, x: stats(s) }); };
    try { add(current, 'Open now', Date.now()); } catch (e) { /* skip */ }
    try {
      const recs = (await window.Backups.all()).filter(r => r.kind !== 'draft').sort((a, b) => b.when - a.when);
      for (const r of recs) { try { add(new WWSave(new Uint8Array(r.bytes), 'b.sav'), 'Last backup', r.when); } catch (e) { /* unreadable */ } }
    } catch (e) { /* no backups */ }
    towns = list; loading = false; refresh();
  }

  VIEWS.push({
    id: 'badges', group: 'Museum', icon: '🎖️', title: () => 'Badges & Towns', sub: () => 'Badges earned in each town, and your towns side by side',
    tips: ['Badges come from what each save records, so they follow you from backup to backup.', 'Every town you’ve opened in Leaflet keeps backups; the newest one of each is compared here.'],
    render(s, { refresh }) {
      if (!towns || towns[0]?.key !== `${s.u16(2)}-${s.str(4, 8)}`) { load(s, refresh); if (!towns) return [h('div', { class: 'card pad muted' }, 'Looking through your towns…')]; }
      const earned = t => BADGES.filter(b => { try { return b[3](t.x); } catch (e) { return false; } });
      const me = towns[0], mine = new Set(earned(me).map(b => b[1]));
      const best = f => { const vals = towns.map(t => f(t.x)), m = Math.max(...vals), tied = vals.every(v => v === m); return vals.map(v => !tied && v === m); };   // a crown only for whoever is ahead
      const ROWS = [
        ['Residents', t => t.residents.join(', ') || '—', null],
        ['Neighbors', t => `${t.neighbors} of 8`, t => t.neighbors],
        ['Museum', t => `${t.exhibits} of 184`, t => t.exhibits],
        ['K.K. songs', t => `${t.songs} of 70`, t => t.songs],
        ['House', t => ['Small', 'Medium', 'Large', 'Upstairs', 'West room', 'East room', 'Mansion'][t.size] + (t.loan ? ` · ${fmt(t.loan)} owed` : ' · paid off'), t => t.size * 1e9 - t.loan],
        ['Town rating', t => t.ratingWord, t => t.rating],
        ['Flowers', t => fmt(t.flowers), t => t.flowers],
        ['Most bells (one resident)', t => fmt(t.bells), t => t.bells],
        ['Most Nook Points', t => fmt(t.points), t => t.points],
        ['Badges', t => `${earned({ x: t }).length} of ${BADGES.length}`, t => earned({ x: t }).length],
      ];
      return [
        section(`🎖️ ${me.x.town}’s badges`, `${mine.size} of ${BADGES.length} earned`),
        h('div', { class: 'badge-grid' }, BADGES.map(([em, name, how]) => h('div', { class: 'badge-card' + (mine.has(name) ? ' got' : '') },
          h('span', { class: 'em' }, mine.has(name) ? em : '🔒'), h('b', null, name), h('span', { class: 'muted' }, how)))),
        section('🏘️ Town vs Town', towns.length > 1 ? `${towns.length} towns` : 'Only one town so far'),
        towns.length > 1 ? h('div', { class: 'card pad vs-wrap' }, h('table', { class: 'vs-table' },
          h('tr', null, h('th'), towns.map(t => h('th', null, h('b', null, t.x.town), h('div', { class: 'muted' }, t.label === 'Open now' ? 'Open now' : `Backup, ${new Date(t.when).toLocaleDateString()}`)))),
          ROWS.map(([name, show, score]) => { const top = score ? best(score) : towns.map(() => false); return h('tr', null, h('th', null, name), towns.map((t, i) => h('td', { class: top[i] ? 'top' : '' }, show(t.x)))); })))
          : h('div', { class: 'card pad muted' }, 'Open another town (or a friend’s save) and it’ll appear here next to this one. Leaflet keeps a backup of every town you open.'),
      ];
    },
  });
})();
