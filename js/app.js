// App shell: navigation, file open/save, search, keyboard shortcuts.
(function () {
  'use strict';
  const { h, sfx, say, toast, confetti, fmt } = UI;
  const VIEWS = window.VIEWS;
  const $ = id => document.getElementById(id);

  const state = { save: null, view: 'welcome', original: null, fileHandle: null };
  window.APP = state;

  const PHONE = !!window.LEAFLET_PHONE;
  const GREETINGS = PHONE ? [
    'Hi hi! Open your town’s save, or read it right off your game card, and we’ll take a stroll through it together!',
    'Ooh, a new day in town! Bring me your save and let’s get to work!',
  ] : [
    'Hi hi! Drop your town’s save file right here and we’ll take a stroll through it together!',
    'Ooh, a new day in town! Bring me a .sav file and let’s get to work!',
  ];

  // ---------- navigation ----------
  const iconOf = v => (typeof v.icon === 'function' ? (state.save ? v.icon(state.save) : '🏠') : v.icon);
  function buildNav() {
    const nav = $('nav');
    nav.replaceChildren();
    // Pages are listed by group (in the order each group first appears), whatever order their scripts loaded in.
    const groups = [...new Set(VIEWS.map(v => v.group))];
    let group = null;
    for (const v of groups.flatMap(g => VIEWS.filter(x => x.group === g))) {
      if (v.hidden && v.hidden(state.save)) continue;
      if (v.group !== group) { group = v.group; nav.append(h('div', { class: 'nav-group' }, group)); }
      const badge = state.save && v.badge ? v.badge(state.save) : '';
      nav.append(h('button', {
        class: 'nav-item' + (state.view === v.id ? ' active' : ''), disabled: !state.save && v.id !== 'welcome' && !v.noSave,
        onclick: () => go(v.id), 'data-v': v.id,
      }, h('span', { class: 'nav-ico' }, iconOf(v)), v.title(state.save), badge !== '' ? h('span', { class: 'nav-badge' }, badge) : null));
    }
  }
  function go(id, focusOpt) {
    let v = VIEWS.find(x => x.id === id) || VIEWS[0];
    if (!state.save && !v.noSave) v = VIEWS[0];   // views edit a loaded save, except Welcome and Backups
    state.view = v.id;
    if (state.save) state.save.sealStep();   // a new page, or a page redrawn after a change, starts a new undo step
    $('pageTitle').textContent = v.title(state.save);
    $('pageSub').textContent = state.save && v.sub ? v.sub(state.save) : '';
    UI.setRegistryView(v.id);
    UI.registry.length = 0;
    const page = h('div', { class: 'page' }, v.render(state.save, { go, refresh }));
    $('content').replaceChildren(page);
    $('content').scrollTop = 0;
    buildNav();
    if (focusOpt) {
      const el = document.getElementById(focusOpt);
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
    }
    if (v.hello && state.save && !v._greeted) { v._greeted = true; setTimeout(() => say(v.hello(state.save)), 350); }
  }
  function refresh() { go(state.view); }

  // ---------- search ----------
  let searchIndexed = false, searchIndex = [];
  function indexAll() {
    if (searchIndexed || !state.save) return;
    const keep = state.view, wasDirty = state.save.dirty;
    searchIndex = [];
    for (const v of VIEWS) {
      if (v.id === 'welcome' || v.noSave || (v.hidden && v.hidden(state.save))) continue;
      UI.setRegistryView(v.id);
      UI.registry.length = 0;
      try { v.render(state.save, { go, refresh, indexing: true }); } catch (e) { console.warn('index', v.id, e); }
      searchIndex.push(...UI.registry);
    }
    state.save.dirty = wasDirty;
    searchIndexed = true;
    go(keep);
  }
  function runSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) { buildNav(); return; }
    indexAll();
    const seen = new Set();
    const hits = searchIndex.filter(r => r.text.includes(q) && !seen.has(r.view + r.tab + r.label) && seen.add(r.view + r.tab + r.label)).slice(0, 60);
    const nav = $('nav');
    nav.replaceChildren(h('div', { class: 'nav-group' }, `${hits.length || 'No'} matching options`));
    for (const r of hits) {
      const v = VIEWS.find(x => x.id === r.view);
      nav.append(h('button', { class: 'nav-item', onclick: () => {
        $('globalSearch').value = '';
        if (r.tab) UI.setTab(r.view, r.tab);
        // Re-render the target view so the row exists with a fresh id, then find it by label.
        go(r.view);
        const hit = UI.registry.find(x => x.view === r.view && x.label === r.label && (!r.tab || x.tab === r.tab));
        if (hit) { const el = document.getElementById(hit.id); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); } }
      } },
        h('span', { class: 'nav-ico' }, v ? iconOf(v) : '•'),
        h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.label),
          h('span', { style: { fontSize: '11px', fontWeight: 550, opacity: .7 } }, v ? v.title(state.save) : ''))));
    }
  }

  // ---------- files ----------
  // opt.fromBackup: a version restored from Backups (it is already kept there, and isn't the file on disk).
  async function openBytes(bytes, name, handle, opt = {}) {
    try {
      const save = new WWSave(bytes, name);
      state.save = save; state.original = new Uint8Array(bytes); state.fileHandle = handle || null;
      if (window.Backups && !opt.fromBackup) Backups.opened(state.original, name);
      searchIndexed = false;
      VIEWS.forEach(v => { v._greeted = false; });
      save.onChange(updateChrome);
      updateChrome();
      go('overview');
      sfx.bell();
      const town = save.str(4, 8);
      const notes = [];
      if (!save.copyStatus[0] || !save.copyStatus[1]) notes.push('One of the two backup copies inside the file was damaged, so I used the healthy one.');
      if (!save.lettersValid) notes.push('Your town hall mailbox checksum looked off. Saving will repair it.');
      say(`Welcome to ${town}! I found everything I need. ${notes.join(' ')} Pick anything from the sidebar to start editing!`);
    } catch (e) {
      sfx.error();
      say(e.message);
      toast(e.message, '⚠️');
    }
  }
  // Inside the native macOS app (WKWebView) file panels are provided by Swift.
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.leaflet;
  if (native) document.documentElement.classList.add('native-mac');
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  state.nativeOpened = (b64, name) => openBytes(fromB64(b64), name);
  state.nativeSaved = (ok, name, sameFile) => { if (ok) { if (window.Backups && pendingSave) Backups.saved(pendingSave, name, !!sameFile); afterSave(name); } pendingSave = null; };
  state.nativeFileChanged = (b64, name) => { if (window.Backups) Backups.fileChanged(fromB64(b64), name); };
  let pendingSave = null;
  state.isDirty = () => !!(state.save && state.save.dirty);

  async function openFile() {
    if (native) { native.postMessage({ cmd: 'open' }); return; }
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Wild World save', accept: { 'application/octet-stream': ['.sav', '.dsv', '.bin'] } }], excludeAcceptAllOption: false });
        const f = await handle.getFile();
        return openBytes(new Uint8Array(await f.arrayBuffer()), f.name, handle);
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    $('fileInput').click();
  }
  $('fileInput').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    await openBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    e.target.value = '';
  });

  async function saveFile() {
    const s = state.save; if (!s) return;
    const out = s.export();
    if (!s.verify(out)) { sfx.error(); toast('Checksum verification failed. Nothing was written.', '⚠️'); return; }
    if (native) { pendingSave = out; native.postMessage({ cmd: 'save', name: s.fileName, data: toB64(out) }); return; }
    let done = false, sameFile = false;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: s.fileName, types: [{ description: 'Wild World save', accept: { 'application/octet-stream': ['.sav'] } }] });
        const w = await handle.createWritable(); await w.write(out); await w.close();
        sameFile = !!(state.fileHandle && await handle.isSameEntry(state.fileHandle).catch(() => false));
        done = true;
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    if (!done) {
      const a = h('a', { href: URL.createObjectURL(new Blob([out], { type: 'application/octet-stream' })), download: s.fileName });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    if (window.Backups) Backups.saved(out, s.fileName, sameFile);
    afterSave();
  }
  function afterSave(name) {
    const s = state.save;
    if (name) s.fileName = name;
    s.dirty = false; updateChrome();
    sfx.save(); confetti();
    say('All saved! Both copies are in sync and every checksum is fixed. Load it up and say hi to everyone for me!');
  }
  state.openFile = openFile;
  state.saveFile = saveFile;

  function updateChrome() {
    const s = state.save;
    $('saveBtn').disabled = !s;
    $('undoBtn').disabled = !(s && s.canUndo); $('redoBtn').disabled = !(s && s.canRedo);
    if (s && s.canUndo) { const u = s.history.undo[s.history.undo.length - 1]; $('undoBtn').title = `Undo${u.label ? ` (a change on ${u.label})` : ''} (${UI.mod}Z)`; }
    $('saveBtn').classList.toggle('pulse', !!(s && s.dirty));
    const chip = $('bellChip');
    if (s && s.playerExists(0)) {
      let total = 0;
      for (let p = 0; p < 4; p++) if (s.playerExists(p)) total += s.u32(s.playerBase(p) + 0x1B40) + s.u32(s.playerBase(p) + 0x21E4);
      chip.hidden = false; chip.replaceChildren('🔔 ', fmt(total), h('span', { style: { fontWeight: 600, opacity: .7 } }, ' bells in town'));
    } else chip.hidden = true;
    $('sidebarFoot').replaceChildren(s ? h('div', null, h('b', null, s.fileName), h('br'),
      `${s.region} · loaded copy ${s.copyUsed + 1} of 2`, s.dirty ? h('span', { style: { color: 'var(--bell-deep)', fontWeight: 750 } }, ' · unsaved') : '') : 'No save loaded');
    document.title = s ? `${s.dirty ? '• ' : ''}${s.str(4, 8)} · Leaflet` : 'Leaflet: Wild World Editor';
  }

  // ---------- chrome wiring ----------
  // The toolbar's shortcut hints, written for a Mac in index.html, say Ctrl elsewhere.
  if (UI.mod !== '⌘') document.querySelectorAll('.tb-btn[title]').forEach(b => { b.title = b.title.replace('⇧⌘', 'Ctrl+Shift+').replace('⌘', 'Ctrl+'); });
  // Small screens: the sidebar is a drawer behind the ☰ button, closed again by choosing a page, the scrim or Escape.
  const setNav = open => { document.body.classList.toggle('nav-open', open); $('navScrim').hidden = !open; $('menuBtn').setAttribute('aria-expanded', open); };
  $('menuBtn').addEventListener('click', () => { sfx.click(); setNav(!document.body.classList.contains('nav-open')); });
  $('navScrim').addEventListener('click', () => setNav(false));
  $('nav').addEventListener('click', e => { if (e.target.closest('.nav-item')) setNav(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setNav(false); });
  $('openBtn').addEventListener('click', () => { sfx.click(); openFile(); });
  $('saveBtn').addEventListener('click', saveFile);
  const soundBtn = $('soundBtn');
  const drawSound = () => { soundBtn.textContent = UI.soundOn ? '🔊' : '🔈'; soundBtn.setAttribute('aria-pressed', UI.soundOn); };
  soundBtn.addEventListener('click', () => { UI.setSound(!UI.soundOn); drawSound(); sfx.toggle(UI.soundOn); });
  drawSound();
  $('guideSprout').addEventListener('click', () => {
    const v = VIEWS.find(x => x.id === state.view);
    const tips = (v && v.tips) || ['Tip: right-click any item slot to empty it.', `Tip: press ${UI.mod}F to search every option in the editor.`, `Tip: ${UI.mod}S saves a fresh copy with all checksums fixed.`];
    say(tips[Math.floor(Math.random() * tips.length)]);
  });
  $('globalSearch').addEventListener('input', e => runSearch(e.target.value));
  // Undo and redo: every change to the open save, on any page.
  function undoRedo(redo) {
    const s = state.save; if (!s) return;
    const st = redo ? s.redo() : s.undo();
    if (!st) { sfx.error(); return; }
    sfx.click(); toast(`${redo ? 'Redone' : 'Undone'}: ${st.edits.length === 1 ? 'a change' : `${st.edits.length} changes`}${st.label ? ` on ${st.label}` : ''}`, redo ? '↷' : '↶');
    const c = $('content'), top = c.scrollTop;
    refresh();
    c.scrollTop = top;   // stay where you were on the page
  }
  $('undoBtn').addEventListener('click', () => undoRedo(false));
  $('redoBtn').addEventListener('click', () => undoRedo(true));
  WWSave.label = () => { const v = VIEWS.find(x => x.id === state.view); return v ? v.title(state.save) : ''; };
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    // Text fields keep their own undo while you type.
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); undoRedo(e.shiftKey); return; }
    if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); undoRedo(true); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); }
    else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(); }
    else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('globalSearch').focus(); }
  });
  window.addEventListener('beforeunload', e => { if (state.save && state.save.dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('dragover', e => { e.preventDefault(); document.querySelector('.drop')?.classList.add('over'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.querySelector('.drop')?.classList.remove('over'); });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    document.querySelector('.drop')?.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (/\.nds$/i.test(f.name) || f.size > 1024 * 1024) loadRom(f); else openBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  });

  // ---------- game art from the player's ROM ----------
  async function loadRom(f) {
    try {
      toast('Reading game art from your ROM…', '🎮');
      const n = await ROM.open(new Uint8Array(await f.arrayBuffer()));
      sfx.bell(); toast(`Game art ready (${n} files kept on this computer)`, '🎨');
    } catch (err) { sfx.error(); toast(err.message || 'That ROM couldn’t be read', '⚠️'); }
  }
  function pickRom() {
    const inp = h('input', { type: 'file', accept: '.nds' });
    inp.addEventListener('change', () => { if (inp.files[0]) loadRom(inp.files[0]); });
    inp.click();
  }
  ROM.onChange(() => { buildNav(); refresh(); });
  ROM.restore();
  window.APP.pickRom = pickRom;

  // ---------- welcome view ----------
  VIEWS.unshift({
    id: 'welcome', group: 'Start', icon: '🍃', title: () => 'Welcome',
    render() {
      return h('div', { class: 'welcome' }, h('div', { class: 'drop' },
        h('span', { class: 'big-leaf' }, '🍃'),
        h('h2', null, 'Let’s visit your town!'),
        h('p', null, PHONE ? 'Open an Animal Crossing: Wild World save (.sav), or read the one on your game card with Cartridge Sync. Your original is never changed. Saving always makes a new copy.'
          : 'Drop an Animal Crossing: Wild World save (.sav) anywhere on this window, or open one. Your original file is never changed. Saving always writes a new copy.'),
        h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
          window.LEAFLET_FROM_LINK ? h('button', { class: 'btn leaf', style: { height: '36px', padding: '0 18px', fontSize: '14px' }, onclick: () => go('sync') }, '🎮  Read My Game Card') : null,
          h('button', { class: 'btn' + (window.LEAFLET_FROM_LINK ? '' : ' leaf'), style: { height: '36px', padding: '0 18px', fontSize: '14px' }, onclick: openFile }, '📂  Open Save File')),
        h('div', { class: 'rom-card' + (ROM.ready ? ' on' : '') },
          h('b', null, ROM.ready ? '🎨 Game art is on' : '🎮 Want the real game look?'),
          h('span', null, ROM.ready ? 'Item icons, encyclopedia pictures, 3D models and music come from your ROM.' : 'Optional: open a backup (.nds) you dumped yourself from your own Wild World cartridge to use the game’s item icons, 3D models and music. Leaflet includes no game files, and what it reads stays on this device. Please don’t download ROMs.'),
          ROM.stale ? h('span', { class: 'rom-stale' }, 'This version reads more from the ROM (such as held tools). Open it again to add them.') : null,
          ROM.stale ? h('button', { class: 'btn small', onclick: pickRom }, 'Open ROM again…') : null,
          h('button', { class: 'btn small', onclick: ROM.ready ? () => ROM.forget() : pickRom }, ROM.ready ? 'Forget game art' : 'Open ROM…')),
        (() => { const slot = h('div'); if (window.Backups) Backups.draftNotice().then(c => { if (c) slot.replaceWith(c); }); return slot; })(),
        h('div', { class: 'fine' }, 'Works with USA and European saves (256 KB) from flashcarts, DeSmuME, melonDS and save dumpers.', PHONE ? null : [h('br'), 'Shortcuts: ', h('span', { class: 'kbd' }, UI.mod + 'O'), ' open · ', h('span', { class: 'kbd' }, UI.mod + 'S'), ' save · ', h('span', { class: 'kbd' }, UI.mod + 'F'), ' search'])));
    },
  });

  // Backups sits right under Welcome: it works before any save is open.
  { const bi = VIEWS.findIndex(v => v.id === 'backups'); if (bi > 1) VIEWS.splice(1, 0, ...VIEWS.splice(bi, 1)); }
  { const si = VIEWS.findIndex(v => v.id === 'sync'); if (si > 2) VIEWS.splice(2, 0, ...VIEWS.splice(si, 1)); }
  { const i = VIEWS.findIndex(v => v.id === 'patterns'), o = VIEWS.findIndex(v => v.id === 'house'); if (i > o && o >= 0) VIEWS.splice(o + 1, 0, ...VIEWS.splice(i, 1)); }
  // Today and the calendar come right after the town overview.
  for (const id of ['card', 'diary', 'calendar', 'today']) { const i = VIEWS.findIndex(v => v.id === id), o = VIEWS.findIndex(v => v.id === 'overview'); if (i > o && o >= 0) VIEWS.splice(o + 1, 0, ...VIEWS.splice(i, 1)); }
  buildNav();
  go('welcome');
  updateChrome();
  setTimeout(() => { if (!state.save) say(GREETINGS[Math.floor(Math.random() * GREETINGS.length)], { quiet: true }); }, 600);
  window.APP.openBytes = openBytes;
  window.APP.go = go;
})();
