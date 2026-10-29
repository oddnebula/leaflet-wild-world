// Automatic backups. Every save Leaflet opens or writes is kept as a snapshot, unsaved edits are kept as a rolling
// draft, and the open save file is watched so each time the game (or an emulator) writes it, that version is kept too.
// Snapshots live in this browser's IndexedDB (the Mac app keeps it between launches and also copies each one to
// ~/Documents/Leaflet Backups). Nothing leaves the computer.
(function () {
  'use strict';
  const { h, sfx, toast, say, confirmSheet, fmt } = UI;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const DB = 'leaflet-backups', STORE = 'snaps';
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.leaflet;
  const KINDS = { opened: ['📂', 'Opened in Leaflet'], saved: ['💾', 'Saved by Leaflet'], game: ['🎮', 'Saved by the game'], draft: ['📝', 'Unsaved edits'], manual: ['📌', 'Backed up by hand'], cartridge: ['🎮', 'Read from the game card'], sent: ['📤', 'Sent to the game card'] };

  // ---------- settings (per computer) ----------
  const SETTINGS_KEY = 'leaflet-backup-settings';
  const settings = Object.assign({ enabled: true, keep: 40, watch: true }, (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })());
  const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* private mode: defaults stay */ } };

  // ---------- storage ----------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { const st = r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); st.createIndex('key', 'key'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function tx(mode, fn) { const d = await db(); const t = d.transaction(STORE, mode); const out = await fn(t.objectStore(STORE)); await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); }); return out; }
  // If the browser's storage is blocked (another window mid-upgrade, private mode), carry on without backups.
  const all = () => Promise.race([tx('readonly', st => req(st.getAll())).catch(() => []), new Promise(res => setTimeout(() => res([]), 4000))]);

  // FNV-1a over the main block and town hall letters: what changes when a town changes.
  function hash(bytes) { let x = 0x811C9DC5; for (let i = 0; i < bytes.length; i++) { x ^= bytes[i]; x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(16); }
  function describe(bytes) {
    try {
      const s = new WWSave(bytes, 'x.sav');
      return { key: `${s.u16(2)}-${s.str(4, 8)}`, town: s.str(4, 8) || 'Town', residents: [0, 1, 2, 3].filter(p => s.playerExists(p)).map(p => s.str(s.playerBase(p) + 0x2282, 8)) };
    } catch (e) { return null; }
  }

  // Adds a snapshot unless the newest one for that town is identical. Returns the record or null.
  // opt.when: when it was made (default now); opt.history: an older version arriving late (from the 3DS's SD card),
  // so it's skipped if any version of the town is identical, not just the newest.
  async function add(bytes, kind, opt = {}) {
    if (!settings.enabled && kind !== 'manual') return null;
    const info = describe(bytes); if (!info) return null;
    const data = new Uint8Array(bytes), hsh = hash(data);
    const mine = (await all()).filter(r => r.key === info.key).sort((a, b) => b.when - a.when);
    if (kind === 'draft') {
      if (mine.some(r => r.kind === 'draft' && r.hash === hsh)) return null;
      await tx('readwrite', st => { mine.filter(r => r.kind === 'draft').forEach(r => st.delete(r.id)); });
    } else if (opt.history) {
      if (mine.some(r => r.hash === hsh)) return null;
    } else if (kind !== 'manual') {
      const last = mine.find(r => r.kind !== 'draft');
      if (last && last.hash === hsh) return null;
    }
    const rec = { ...info, kind, when: opt.when || Date.now(), hash: hsh, size: data.length, pinned: false, file: opt.file || '', bytes: data };
    rec.id = await tx('readwrite', st => req(st.add(rec)));
    if (kind !== 'draft') await prune(info.key);
    if (native && kind !== 'draft') native.postMessage({ cmd: 'backupFile', town: info.town, name: `${stamp(rec.when)} ${KINDS[kind][1]}.sav`, data: b64(data) });
    listeners.forEach(f => f());
    return rec;
  }
  async function prune(key) {
    if (!settings.keep) return;
    const keep = (await all()).filter(r => r.key === key && r.kind !== 'draft' && !r.pinned).sort((a, b) => b.when - a.when).slice(settings.keep);
    if (keep.length) await tx('readwrite', st => keep.forEach(r => st.delete(r.id)));
  }
  const remove = id => tx('readwrite', st => st.delete(id)).then(() => listeners.forEach(f => f()));
  const update = rec => tx('readwrite', st => st.put(rec)).then(() => listeners.forEach(f => f()));
  const clearDrafts = async key => { const d = (await all()).filter(r => r.kind === 'draft' && (!key || r.key === key)); if (d.length) await tx('readwrite', st => d.forEach(r => st.delete(r.id))); listeners.forEach(f => f()); };
  const listeners = new Set();

  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const pad = n => String(n).padStart(2, '0');
  const stamp = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`; };
  const when = t => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // ---------- hooks used by the app shell ----------
  let lastFileHash = null, draftTimer = null, watchTimer = null, watchName = '';
  function opened(bytes, name) {
    lastFileHash = hash(new Uint8Array(bytes)); watchName = name || '';
    add(bytes, 'opened', { file: name });
    startWatch();
  }
  function saved(bytes, name, sameFile) {
    if (sameFile) lastFileHash = hash(bytes);
    add(bytes, 'saved', { file: name });
    const info = describe(bytes); if (info) clearDrafts(info.key);
  }
  // Unsaved edits: a rolling draft per town, at most once a minute while there are changes.
  function startDrafts() {
    clearInterval(draftTimer);
    draftTimer = setInterval(() => { const s = APP.save; if (s && s.dirty && settings.enabled) add(s.export(), 'draft', { file: s.fileName }); }, 60000);
  }
  // The open file changed on disk: keep that version, and tell the player.
  async function fileChanged(bytes, name) {
    const hsh = hash(bytes); if (hsh === lastFileHash) return;
    lastFileHash = hsh;
    const rec = await add(bytes, 'game', { file: name });
    if (!rec) return;
    sfx.bell();
    toast('The game saved your town. That version is backed up.', '🎮');
    say(`Your game just saved ${rec.town}! I kept a copy in Backups.${APP.save && APP.save.dirty ? ' You still have unsaved edits here, so I didn’t reload.' : ' Open Backups to load the new version.'}`);
  }
  // Watching: in Chrome / Edge the File System Access handle can be re-read; the Mac app watches the file itself.
  function startWatch() {
    clearInterval(watchTimer);
    if (native) { native.postMessage({ cmd: 'watch', on: settings.watch && settings.enabled }); return; }
    const handle = APP.fileHandle;
    if (!handle || !settings.watch || !settings.enabled) return;
    let lastMod = null;
    watchTimer = setInterval(async () => {
      if (APP.fileHandle !== handle) { clearInterval(watchTimer); return; }
      try {
        const f = await handle.getFile();
        if (lastMod === null) { lastMod = f.lastModified; return; }
        if (f.lastModified === lastMod) return;
        lastMod = f.lastModified;
        fileChanged(new Uint8Array(await f.arrayBuffer()), f.name);
      } catch (e) { /* permission revoked or file moved: stop quietly */ clearInterval(watchTimer); }
    }, 4000);
  }
  const watching = () => !!(settings.watch && settings.enabled && (native ? APP.save : APP.fileHandle));

  // ---------- the Backups page ----------
  async function openSnapshot(r) {
    if (APP.save && APP.save.dirty && !await confirmSheet('Open this backup?', 'You have unsaved edits in the town that’s open now. They’ll be kept as an “Unsaved edits” backup, then this version opens.', 'Open backup')) return;
    if (APP.save && APP.save.dirty) await add(APP.save.export(), 'draft', { file: APP.save.fileName });
    await APP.openBytes(new Uint8Array(r.bytes), `${r.town} (${KINDS[r.kind][1].toLowerCase()} ${stamp(r.when)}).sav`, null, { fromBackup: true });
    if (r.kind === 'draft' && APP.save) APP.save.markDirty();   // restored edits still need saving
    toast(`Opened the backup from ${when(r.when)}`, '🗂️');
  }
  function download(r) {
    const a = h('a', { href: URL.createObjectURL(new Blob([r.bytes], { type: 'application/octet-stream' })), download: `${r.town} ${stamp(r.when)}.sav` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  let cache = null;
  async function refreshList(refresh) { cache = await all(); refresh(); }

  // Compare two versions of a town: the diary's story of what changed, and which parts of the save differ.
  const cmp = { key: null, a: null, b: null };
  function compareCard(towns, refresh) {
    const keys = [...towns.keys()].filter(k => towns.get(k).filter(r => r.kind !== 'draft').length > 1);
    if (!keys.length) return null;
    if (!keys.includes(cmp.key)) { cmp.key = keys[0]; cmp.a = cmp.b = null; }
    const list = towns.get(cmp.key).filter(r => r.kind !== 'draft');   // newest first
    if (!list.some(r => r.id === cmp.b)) cmp.b = list[0].id;
    if (!list.some(r => r.id === cmp.a)) cmp.a = list[1].id;
    const label = r => `${new Date(r.when).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${(KINDS[r.kind] || ['', r.kind])[1]}`;
    const opts = list.map(r => [r.id, label(r)]);
    let ra = list.find(r => r.id === cmp.a), rb = list.find(r => r.id === cmp.b);
    if (ra.when > rb.when) [ra, rb] = [rb, ra];   // always older → newer
    let body;
    try {
      const A = new WWSave(new Uint8Array(ra.bytes), 'a.sav'), B = new WWSave(new Uint8Array(rb.bytes), 'b.sav');
      const lines = window.WW_DIARY ? WW_DIARY.diff(A, B) : [];
      const parts = new Map(); let n = 0;
      for (let i = 0; i < A.m.length; i++) if (A.m[i] !== B.m[i]) { n++; const r = window.WW_REGIONS && WW_REGIONS.regionOf(i), k = r ? r[2] : 'Other'; parts.set(k, (parts.get(k) || 0) + 1); }
      let ln = 0; for (let i = 0; i < A.letters.length; i++) if (A.letters[i] !== B.letters[i]) ln++;
      if (ln) parts.set('Town hall letters', ln);
      body = !n && !ln ? h('div', { class: 'muted' }, 'These two versions are identical.') : [
        lines.length ? h('ul', { class: 'sync-diff-list' }, lines.map(([em, t]) => h('li', null, h('span', null, em), t))) : h('div', { class: 'muted' }, 'Nothing the diary describes changed; the differences are below.'),
        h('div', { class: 'sub-h', style: { marginTop: '10px' } }, `${fmt(n + ln)} bytes differ`),
        h('div', { class: 'cmp-parts' }, [...parts.entries()].sort((x, y) => y[1] - x[1]).map(([k, c]) => h('span', { class: 'badge lab' }, `${k}: ${fmt(c)}`)))];
    } catch (e) { body = h('div', { class: 'muted' }, 'One of these versions couldn’t be read.'); }
    return [UI.section('🔍 Compare two versions', 'What changed between any two backups'), h('div', { class: 'card pad' },
      h('div', { class: 'cmp-bar' },
        keys.length > 1 ? UI.selectInput(keys.map((k, i) => [i, towns.get(k)[0].town]), () => keys.indexOf(cmp.key), v => { cmp.key = keys[v]; refresh(); }, { width: 'w-m' }) : null,
        UI.selectInput(opts, () => cmp.a, v => { cmp.a = v; refresh(); }, { width: 'w-l' }), h('b', null, '→'),
        UI.selectInput(opts, () => cmp.b, v => { cmp.b = v; refresh(); }, { width: 'w-l' })),
      body)];
  }

  function rowFor(r, refresh, current) {
    const [em, label] = KINDS[r.kind] || ['•', r.kind];
    return h('div', { class: 'bk-row' + (r.kind === 'draft' ? ' draft' : '') + (r.hash === current ? ' cur' : '') },
      h('span', { class: 'bk-em' }, em),
      h('div', { class: 'bk-main' },
        h('div', null, h('b', null, label), ' · ', h('span', { title: new Date(r.when).toLocaleString() }, when(r.when)), r.pinned ? h('span', { class: 'badge ok', style: { marginLeft: '6px' } }, 'Kept') : null, r.hash === current ? h('span', { class: 'badge lab', style: { marginLeft: '6px' } }, 'Same as open') : null),
        h('div', { class: 'muted', style: { fontSize: '11.5px' } }, `${new Date(r.when).toLocaleString()} · ${r.residents.join(', ') || 'no residents'}${r.file ? ' · ' + r.file : ''}`)),
      h('div', { class: 'bk-btns' },
        h('button', { class: 'btn small leaf', onclick: () => openSnapshot(r) }, 'Open'),
        h('button', { class: 'btn small', title: 'Download a copy', onclick: () => download(r) }, '⬇︎'),
        h('button', { class: 'btn small', title: r.pinned ? 'Let it be cleaned up like the others' : 'Keep this one forever', onclick: async () => { r.pinned = !r.pinned; await update(r); sfx.toggle(r.pinned); refreshList(refresh); } }, r.pinned ? '★' : '☆'),
        h('button', { class: 'btn small danger', title: 'Delete', onclick: async () => { if (!await confirmSheet('Delete this backup?', `${label}, ${new Date(r.when).toLocaleString()}.`, 'Delete')) return; await remove(r.id); sfx.pop(); refreshList(refresh); } }, '✕')));
  }

  VIEWS.push({
    id: 'backups', group: 'Start', icon: '🗂️', noSave: true, title: () => 'Backups', sub: () => 'Every version of your towns, kept automatically',
    tips: ['Each version is kept once: opening the same file twice doesn’t make a second copy.', 'Star a backup to keep it no matter how many newer ones pile up.'],
    render(s, { refresh }) {
      if (!cache) { refreshList(refresh); return [h('div', { class: 'card pad muted' }, 'Looking for backups…')]; }
      const current = s ? hash(s.export()) : null;
      const towns = new Map();
      for (const r of cache.slice().sort((a, b) => b.when - a.when)) { if (!towns.has(r.key)) towns.set(r.key, []); towns.get(r.key).push(r); }
      const total = cache.reduce((n, r) => n + r.size, 0);
      const { row, card, section, switchInput, selectInput } = UI;
      const watchText = !settings.enabled ? 'Backups are off.' : !settings.watch ? 'Off.' : native ? (s ? `Watching ${s.fileName}: each time the game writes it, that version is kept.` : 'Opens a save to start watching it.')
        : APP.fileHandle ? `Watching ${APP.fileHandle.name} while this window is open.` : (s ? 'This browser can’t re-read the file you opened. Open it with the Open button in Chrome or Edge to watch it.' : 'Open a save to start watching it.');
      return [
        section('Automatic backups', `${cache.length} kept · ${(total / 1048576).toFixed(1)} MB on this computer`),
        card(
          row('Back up automatically', 'Keeps a copy each time you open or save a town, and your unsaved edits every minute.', switchInput(() => settings.enabled, v => { settings.enabled = v; saveSettings(); startWatch(); refresh(); })),
          row('Watch the open save for game saves', watchText, switchInput(() => settings.watch, v => { settings.watch = v; saveSettings(); startWatch(); refresh(); })),
          row('Keep per town', 'Older ones are cleaned up automatically. Starred backups are always kept.', selectInput([[10, '10'], [25, '25'], [40, '40'], [100, '100'], [0, 'All of them']], () => settings.keep, v => { settings.keep = v; saveSettings(); for (const k of towns.keys()) prune(k); refreshList(refresh); }, { width: 'w-s' })),
          native ? row('Copies on disk', 'Each backup is also written to Documents › Leaflet Backups, one folder per town.', h('button', { class: 'btn small', onclick: () => native.postMessage({ cmd: 'revealBackups' }) }, 'Show in Finder')) : null,
          s ? row('Back up now', `Keeps the town that’s open (${s.str(4, 8)}), including unsaved edits, and stars it.`, h('button', { class: 'btn small leaf', onclick: async () => { const r = await add(s.export(), 'manual', { file: s.fileName }); if (r) { r.pinned = true; await update(r); } sfx.bell(); toast('Backed up and starred', '📌'); refreshList(refresh); } }, 'Back up')) : null),
        towns.size ? null : h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🗂️'), 'No backups yet. Open a save and Leaflet starts keeping them.')),
        ...(compareCard(towns, refresh) || []),
        ...[...towns.entries()].map(([key, list]) => [
          section(`🏡 ${list[0].town}`, `${list.length} version${list.length === 1 ? '' : 's'} · newest ${when(list[0].when)}`),
          h('div', { class: 'card bk-list' }, list.map(r => rowFor(r, refresh, current))),
        ]),
      ];
    },
  });
  listeners.add(() => { cache = null; if (APP.view === 'backups') APP.go('backups'); });

  // A card for the Welcome screen when unsaved edits were left behind.
  async function draftNotice() {
    const drafts = (await all()).filter(r => r.kind === 'draft').sort((a, b) => b.when - a.when);
    if (!drafts.length || APP.save) return null;
    const d = drafts[0];
    return h('div', { class: 'rom-card bk-draft' }, h('b', null, `📝 Unsaved edits to ${d.town}`),
      h('span', null, `From ${new Date(d.when).toLocaleString()}. Leaflet kept them when the window closed before saving.`),
      h('span', { style: { display: 'flex', gap: '6px' } }, h('button', { class: 'btn small leaf', onclick: () => openSnapshot(d) }, 'Restore them'), h('button', { class: 'btn small', onclick: () => clearDrafts() }, 'Discard')));
  }

  startDrafts();
  window.Backups = { add, opened, saved, fileChanged, startWatch, draftNotice, all, hash, settings, watching, onChange: f => listeners.add(f) };
})();
