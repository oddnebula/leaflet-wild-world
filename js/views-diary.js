// The town diary: every backup Leaflet has kept is a snapshot of the town, so comparing each one with the one before
// tells the town's story (who moved in, what was caught and donated, bells saved, the loan paid off, songs learned).
// Nothing new is stored: it reads the Backups store.
(function () {
  'use strict';
  const { h, fmt, section, sfx } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const byId = new Map(D.villagers.map(v => [v.id, v]));
  const HOBBIES = ['catching bugs', 'fishing', 'digging up fossils', 'clothes', 'collecting furniture', 'gardening', 'collecting shells', 'going for walks'];
  const WINGS = [
    ['donated', 0x00, D.fossils], ['donated', 0x1B, D.critters.fish.map(c => c.name)], ['donated', 0x38, D.critters.bugs.map(c => c.name)], ['donated', 0x55, D.paintings]];
  const MUSEUM = 0x15D50, VB = 0x8A3C;
  const list = (a, n = 6) => a.length <= n ? a.join(', ') : `${a.slice(0, n).join(', ')} and ${a.length - n} more`;
  const name = (s, p) => s.str(s.playerBase(p) + 0x2282, 8);
  const sp = (s, n) => s.u8(VB + n * 0x700 + 0x6CB);
  const nib = (s, off, i) => { const b = s.u8(MUSEUM + off + (i >> 1)); return i & 1 ? b >> 4 : b & 15; };

  // What changed from save a (older) to save b (newer), as diary lines [emoji, text].
  function diff(a, b) {
    const out = [], add = (em, text) => out.push([em, text]);
    const ra = new Map(), rb = new Map();
    for (let p = 0; p < 4; p++) { if (a.playerExists(p)) ra.set(p, name(a, p)); if (b.playerExists(p)) rb.set(p, name(b, p)); }
    for (const [p, n] of rb) if (ra.get(p) !== n) add('🧳', `${n} moved into town${ra.has(p) ? ` (replacing ${ra.get(p)})` : ''}.`);
    for (const [p, n] of ra) if (!rb.has(p)) add('👋', `${n} left town for good.`);
    // Neighbors
    for (let n = 0; n < 8; n++) {
      const x = sp(a, n), y = sp(b, n);
      if (x === y) {
        if (y === 0xFF) continue;
        const ha = a.u8(VB + n * 0x700 + 0x65C + 0x10), hb = b.u8(VB + n * 0x700 + 0x65C + 0x10);
        if (ha !== hb && hb < 8) add('💭', `${byId.get(y)?.name || 'A neighbor'} got into ${HOBBIES[hb]}.`);
        continue;
      }
      if (x !== 0xFF) add('📦', `${byId.get(x)?.name || 'A neighbor'} moved away.`);
      if (y !== 0xFF) add('🏡', `${byId.get(y)?.name || 'A new neighbor'} moved in.`);
    }
    // Per resident
    for (const [p, n] of rb) {
      if (!ra.has(p) || ra.get(p) !== n) continue;
      const pa = a.playerBase(p), pb = b.playerBase(p);
      const bells = s => s.u32(s.playerBase(p) + 0x1B40) + s.u32(s.playerBase(p) + 0x21E4);
      const d = bells(b) - bells(a);
      if (Math.abs(d) >= 100) add(d > 0 ? '💰' : '🛍️', `${n} ${d > 0 ? 'gained' : 'spent'} ${fmt(Math.abs(d))} bells (wallet and bank).`);
      const caught = [];
      for (let i = 1; i <= 112; i++) if (!a.bit(pa + 0x1BDD, i) && b.bit(pb + 0x1BDD, i)) caught.push(i <= 56 ? D.critters.bugs[i - 1].name : D.critters.fish[i - 57].name);
      if (caught.length) add('🎣', `${n} caught a${/^[AEIOU]/.test(caught[0]) ? 'n' : ''} ${list(caught)} for the first time.`);
      if (window.WW_CATALOG) {
        const C = WW_CATALOG, got = C.ENTRIES.filter(e => !C.has(a, p, e) && C.has(b, p, e)).map(e => e.name);
        if (got.length) add('📖', `${n} added ${got.length} item${got.length === 1 ? '' : 's'} to the catalog: ${list(got, 5)}.`);
      }
      const nookA = a.u16(pa + 0x2208), nookB = b.u16(pb + 0x2208);
      if (nookB > nookA) add('🏷️', `${n} earned ${fmt(nookB - nookA)} Nook Points.`);
    }
    // Museum
    for (const [verb, off, names] of WINGS) {
      const by = new Map();
      names.forEach((nm, i) => { if (!nib(a, off, i) && nib(b, off, i)) { const who = nib(b, off, i); const k = who >= 1 && who <= 4 ? name(b, who - 1) : 'A former resident'; by.set(k, [...(by.get(k) || []), nm]); } });
      for (const [k, items] of by) add('🏛️', `${k} ${verb} ${list(items)} to the museum.`);
    }
    // House and town
    const loanA = a.u32(0xFAE8), loanB = b.u32(0xFAE8);
    if (loanB < loanA) add('🏦', loanB ? `${fmt(loanA - loanB)} bells paid toward the house loan.` : 'The house loan is paid off!');
    if (window.WW_HOUSE) { const za = WW_HOUSE.getF(a, 'size'), zb = WW_HOUSE.getF(b, 'size'); if (zb > za) add('🏠', 'The house got bigger.'); }
    const songs = D.songs.filter((nm, i) => nm && i < 70 && !a.bit(0xFAEC, i) && b.bit(0xFAEC, i));
    if (songs.length) add('🎸', `K.K. taught the house ${list(songs)}.`);
    const don = b.u32(0x12008) - a.u32(0x12008);
    if (don > 0) add('🙏', `${fmt(don)} bells donated at the town hall.`);
    if (a.bytes(0x15FA8, 8).join() !== b.bytes(0x15FA8, 8).join()) add('🎵', 'The town tune changed.');
    if (a.bytes(0x15930, 0x200).join() !== b.bytes(0x15930, 0x200).join()) add('🚩', 'A new town flag went up.');
    const streak = b.u8(0x15E75) << 24 >> 24;
    if (streak >= 15 && (a.u8(0x15E75) << 24 >> 24) < 15) add('🚿', 'The town stayed perfect for 15 days in a row.');
    return out;
  }

  let cache = null, pick = null;
  async function load(refresh) {
    const all = (await Backups.all()).filter(r => r.kind !== 'draft').sort((x, y) => x.when - y.when);
    cache = all; refresh();
  }
  const KIND_WORD = { opened: 'Opened in Leaflet', saved: 'Saved by Leaflet', game: 'Saved by the game', manual: 'Backed up by hand', cartridge: '🎮 From your game card', sent: 'Sent to the game card' };
  const kindWord = r => r.kind === 'game' && r.file === 'melonDS' ? '🖥️ Played on melonDS' : r.kind === 'game' && /^\//.test(r.file || '') ? '🎮 Saved on your 3DS' : r.kind === 'sent' && /^\//.test(r.file || '') ? 'Sent to your 3DS’s SD card' : KIND_WORD[r.kind] || r.kind;

  VIEWS.push({
    id: 'diary', group: 'Town', icon: '📔', noSave: true, title: () => 'Town Diary', sub: () => 'Your town’s story, told from its backups',
    tips: ['Every time the game saves while Leaflet watches the file, a new chapter appears here.', 'Connect to your 3DS in Cartridge Sync and what you played on the real game card joins the diary too, including the backups Leaflet Link made on its own.', 'Entries compare each backup with the one before it, so keep backups on to keep the diary going.'],
    render(s, { refresh }) {
      if (!window.Backups) return [h('div', { class: 'card pad muted' }, 'Backups aren’t available here.')];
      if (!cache) { load(refresh); return [h('div', { class: 'card pad muted' }, 'Reading your backups…')]; }
      const towns = [...new Map(cache.map(r => [r.key, r.town])).entries()];
      if (!towns.length) return [h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '📔'), 'No backups yet. Open a save and play: each new version becomes a diary entry.'))];
      const openKey = s ? `${s.u16(2)}-${s.str(4, 8)}` : null;
      if (!pick || !towns.some(([k]) => k === pick)) pick = towns.some(([k]) => k === openKey) ? openKey : towns[0][0];
      const snaps = cache.filter(r => r.key === pick);
      const entries = [];
      let prev = null;
      for (const r of snaps) {
        let cur; try { cur = new WWSave(new Uint8Array(r.bytes), 'x.sav'); } catch (e) { continue; }
        if (prev) { const lines = diff(prev, cur); if (lines.length) entries.push({ r, lines }); }
        prev = cur;
      }
      entries.reverse();
      const first = snaps[0];
      return [
        h('div', { class: 'card pad cat-bar' }, h('b', null, '📔'), UI.selectInput(towns.map(([k, t], i) => [i, t]), () => towns.findIndex(([k]) => k === pick), v => { pick = towns[v][0]; sfx.click(); refresh(); }, { width: 'w-m' }),
          h('span', { class: 'muted', style: { fontSize: '12px' } }, `${snaps.length} version${snaps.length === 1 ? '' : 's'} since ${new Date(first.when).toLocaleDateString()}`),
          h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => { cache = null; refresh(); } }, 'Refresh')),
        entries.length ? entries.map(({ r, lines }) => [
          section(new Date(r.when).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), `${new Date(r.when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${kindWord(r)}`),
          h('div', { class: 'card pad diary-day' }, lines.map(([em, text]) => h('div', { class: 'diary-line' }, h('span', { class: 'em' }, em), h('span', null, text))))])
          : h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🌱'), snaps.length < 2 ? 'Only one version so far. Play a little and save, and the first entry will appear.' : 'Nothing has changed between the versions kept so far.')),
        h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '6px' } }, 'Built from the versions in Backups, oldest first. Deleting a backup merges its changes into the next entry.'),
      ];
    },
  });
  // A new backup means a new entry.
  if (window.Backups && Backups.onChange) Backups.onChange(() => { cache = null; if (APP.view === 'diary') APP.go('diary'); });
  window.WW_DIARY = { diff };
})();
