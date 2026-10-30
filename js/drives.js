// SD cards: when one is put in (or is already in when Leaflet starts), the Mac app and Leaflet Helper look through it
// for Wild World saves and ROMs and tell the page through window.LeafletDrive({ results, roms, searched }). Leaflet
// then offers what it found: open or back up a save, or read the game art from a ROM.
(function () {
  'use strict';
  const { h, sfx, toast } = UI;
  const mac = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.leaflet;
  const KEY = 'leaflet-drive-scan';
  const enabled = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } };
  const setEnabled = on => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* private mode */ } };
  const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const residents = s => [0, 1, 2, 3].filter(p => s.playerExists(p)).map(p => s.str(s.playerBase(p) + 0x2282, 8));
  const seen = new Set();   // what this window has already offered, so a card isn't announced twice

  // ---------- reading a ROM the app found ----------
  const parts = new Map();
  window.LeafletRomPart = m => {
    const p = parts.get(m.id); if (!p) return;
    if (m.error) { parts.delete(m.id); p.reject(new Error(m.error)); return; }
    p.got[m.i] = fromB64(m.data); p.left = (p.left ?? m.n) - 1;
    if (p.left > 0) return;
    parts.delete(m.id);
    const total = p.got.reduce((n, b) => n + b.length, 0), out = new Uint8Array(total); let at = 0;
    for (const b of p.got) { out.set(b, at); at += b.length; }
    p.resolve(out);
  };
  function readRom(rom) {
    if (window.LeafletHelper && LeafletHelper.readRom) return LeafletHelper.readRom(rom.id).then(b => new Uint8Array(b));
    if (!mac) return Promise.reject(new Error('Open the ROM on the Welcome screen.'));
    return new Promise((resolve, reject) => { parts.set(rom.id, { got: [], resolve, reject }); mac.postMessage({ cmd: 'readRom', id: rom.id }); });
  }
  async function loadRom(rom, done) {
    try {
      toast('Reading game art from the ROM on your SD card…', '🎮');
      const n = await ROM.open(await readRom(rom));
      sfx.bell(); toast(`Game art ready (${n} files kept on this computer)`, '🎨'); done && done();
    } catch (err) { sfx.error(); toast(err.message || 'That ROM couldn’t be read', '⚠️'); }
  }

  // ---------- what was found ----------
  function sheet(drive, saves, roms) {
    const root = document.getElementById('popover-root');
    const close = () => root.replaceChildren();
    const romWanted = !window.ROM || !ROM.ready || ROM.stale;
    const saveRow = r => h('div', { class: 'bk-row' },
      h('span', { class: 'bk-em' }, '🏡'),
      h('div', { class: 'bk-main' }, h('b', null, r.s.str(4, 8)),
        h('div', { class: 'muted' }, `${residents(r.s).join(', ') || 'No residents'} · saved ${new Date(r.modified).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`),
        h('div', { class: 'muted', style: { fontSize: '11px', wordBreak: 'break-all' } }, r.path)),
      h('div', { class: 'bk-btns' },
        h('button', { class: 'btn small leaf', onclick: () => { close(); APP.openBytes(new Uint8Array(r.bytes), `${r.s.str(4, 8)} (${r.name})`); } }, 'Open'),
        h('button', { class: 'btn small', onclick: async e => { if (!window.Backups) return; const rec = await Backups.add(r.bytes, 'manual', { file: r.name }); e.target.disabled = true; e.target.textContent = rec ? 'Backed up' : 'Already backed up'; } }, 'Back up')));
    const romRow = r => h('div', { class: 'bk-row' },
      h('span', { class: 'bk-em' }, '🎮'),
      h('div', { class: 'bk-main' }, h('b', null, r.name), h('div', { class: 'muted' }, romWanted ? 'Your Wild World ROM. Leaflet can read the game’s art, music and script from it.' : 'Your Wild World ROM. Leaflet already has the game art.'),
        h('div', { class: 'muted', style: { fontSize: '11px', wordBreak: 'break-all' } }, r.path)),
      romWanted ? h('div', { class: 'bk-btns' }, h('button', { class: 'btn small leaf', onclick: e => { e.target.disabled = true; loadRom(r, close); } }, 'Use for game art')) : null);
    root.replaceChildren(h('div', { class: 'scrim', onclick: close }),
      h('div', { class: 'sheet', style: { width: 'min(560px, calc(100vw - 32px))', top: '14vh' } },
        h('div', { class: 'sheet-head' }, h('div', { class: 'top' }, h('h3', null, `💾 Found on ${drive}`))),
        h('div', { class: 'sheet-body bk-list', style: { maxHeight: '52vh', overflow: 'auto' } }, saves.map(saveRow), roms.map(romRow)),
        h('div', { class: 'sheet-foot' },
          h('button', { class: 'btn small', style: { marginRight: 'auto' }, onclick: () => { setEnabled(false); close(); toast('Leaflet won’t look at SD cards by itself. Cartridge Sync can still look.', '💾'); } }, 'Don’t look by itself'),
          h('button', { class: 'btn', onclick: close }, 'Close'))));
    if (!saves.length) sfx.bell();   // LeafletSaves rings for saves
  }

  window.LeafletDrive = info => {
    if (!enabled()) return;
    const drive = (info.searched || [])[0] || 'the SD card';
    const saves = (info.results || []).map(r => {
      const bytes = fromB64(r.data); let s = null;
      try { s = new WWSave(bytes, r.name); } catch (e) { /* not one Leaflet reads */ }
      return s ? { bytes, s, name: r.name, path: r.path, modified: r.modified } : null;
    }).filter(Boolean).sort((a, b) => b.modified - a.modified);
    const roms = info.roms || [];
    const key = drive + '|' + saves.map(r => r.path + r.modified).join(',') + '|' + roms.map(r => r.path).join(',');
    if (seen.has(key)) return; seen.add(key);
    // Cartridge Sync's SD card list shows them too.
    if (saves.length && window.LeafletSaves) { try { LeafletSaves({ results: info.results, searched: info.searched }); } catch (e) { /* not built yet */ } }
    if (!saves.length && !roms.length) return;
    sheet(drive, saves, roms);
  };
  window.Drives = { get enabled() { return enabled(); }, setEnabled };
})();
