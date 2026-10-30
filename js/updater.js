// Updates and app data.
//  Updates: once a day (and from Backups › Leaflet) Leaflet asks GitHub for its newest release. The Mac app and Leaflet
//  Helper download that release themselves, check it against the SHA-256 GitHub publishes, put it in place of this
//  copy and start it again; in a browser the release page opens instead.
//  App data: settings, backups and Leaflet Link's history live in this window's browser storage, which the Mac app (by
//  its bundle id) and Leaflet Helper (its own Edge profile in local app data) keep in the same place from build to
//  build. As a second copy, the whole lot is written to an app-data file beside the app's other files before every
//  update and every few days, and a new build that starts with empty storage reads it back. Backups › Leaflet can
//  also export it to a file and import it on another computer. The ROM's game art isn't included; it's re-read from
//  the ROM.
(function () {
  'use strict';
  const { h, sfx, toast } = UI;
  const REPO = 'oddnebula/leaflet-wild-world';
  const VERSION = window.LEAFLET_VERSION || '0';
  const mac = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.leaflet;
  const helper = () => window.LeafletHelper && LeafletHelper.alive !== false ? LeafletHelper : null;
  const native = () => mac || helper();
  const KEY = 'leaflet-updates';
  const prefs = (() => { try { return Object.assign({ auto: true, last: 0, snapshot: 0, skip: '', seen: '' }, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { return { auto: true, last: 0, snapshot: 0, skip: '', seen: '' }; } })();
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ } };
  const newer = (a, b) => { const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

  // ---------- app data ----------
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ownKey = k => /^leaflet[-.]/.test(k) && k !== 'leaflet-helper';
  async function snapshot() {
    const local = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (ownKey(k)) local[k] = localStorage.getItem(k); } } catch (e) { /* storage blocked */ }
    const backups = window.Backups ? (await Backups.all()).map(r => ({ ...r, bytes: b64(r.bytes) })) : [];
    return JSON.stringify({ leaflet: 'app-data', version: VERSION, when: Date.now(), local, backups });
  }
  async function restore(text, opt = {}) {
    const d = typeof text === 'string' ? JSON.parse(text) : text;
    if (!d || d.leaflet !== 'app-data') throw new Error('That isn’t a Leaflet app-data file.');
    let keys = 0;
    try { for (const [k, v] of Object.entries(d.local || {})) if (ownKey(k) && (opt.overwrite || localStorage.getItem(k) === null)) { localStorage.setItem(k, v); keys++; } } catch (e) { /* storage blocked */ }
    const added = window.Backups ? await Backups.importRecords((d.backups || []).map(r => ({ ...r, bytes: fromB64(r.bytes) }))) : 0;
    return { keys, added, from: d.version, when: d.when };
  }
  async function isEmpty() {
    try { for (let i = 0; i < localStorage.length; i++) if (ownKey(localStorage.key(i))) return false; } catch (e) { return false; }
    return !window.Backups || !(await Backups.all()).length;
  }
  // The copy beside the app (Mac: ~/Library/Application Support/Leaflet; Windows: %LOCALAPPDATA%\Leaflet).
  async function keepCopy() {
    const text = await snapshot();
    if (mac) mac.postMessage({ cmd: 'appDataSave', data: text });
    else if (helper()) await LeafletHelper.saveAppData(text);
    else return false;
    prefs.snapshot = Date.now(); savePrefs();
    return true;
  }
  let gotCopy = null;
  window.LeafletAppData = text => { if (gotCopy) { gotCopy(text || null); gotCopy = null; } };
  const readCopy = () => mac ? new Promise(res => { gotCopy = res; mac.postMessage({ cmd: 'appDataLoad' }); setTimeout(() => { if (gotCopy) { gotCopy(null); gotCopy = null; } }, 8000); })
    : helper() ? LeafletHelper.loadAppData().catch(() => null) : Promise.resolve(null);
  async function startup() {
    if (!native()) return;
    try {
      if (await isEmpty()) {
        const text = await readCopy();
        if (text) { const r = await restore(text); if (r.keys || r.added) { sfx.bell(); toast(`Your Leaflet settings and ${r.added} backup${r.added === 1 ? '' : 's'} came over from Leaflet ${r.from}`, '🗂️'); } }
      } else if (Date.now() - prefs.snapshot > 3 * 864e5) setTimeout(() => keepCopy().catch(() => {}), 20000);
    } catch (e) { /* the app's own storage still has everything */ }
  }
  function exportFile() {
    snapshot().then(text => {
      const d = new Date(), a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: `Leaflet app data ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      sfx.bell(); toast('App data saved', '🗂️');
    }, () => { sfx.error(); toast('The app data couldn’t be gathered', '⚠️'); });
  }
  function importFile(refresh) {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try { const r = await restore(await f.text(), { overwrite: true }); sfx.bell(); toast(`Brought in ${r.added} backup${r.added === 1 ? '' : 's'} and ${r.keys} setting${r.keys === 1 ? '' : 's'}`, '🗂️'); refresh && refresh(); }
      catch (e) { sfx.error(); toast(e.message || 'That file couldn’t be read', '⚠️'); }
    };
    inp.click();
  }

  // ---------- updates ----------
  const U = { state: '', latest: null, error: '', pct: 0 };
  let paint = null;
  const show = () => { if (paint) paint(); };
  async function check(manual) {
    U.state = 'checking'; U.error = ''; show();
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 403 ? 'GitHub is busy; try again in a little while.' : `GitHub answered ${r.status}.`);
      const j = await r.json();
      U.latest = { version: String(j.tag_name || '').replace(/^v/, ''), name: j.name || j.tag_name, url: j.html_url, notes: j.body || '', when: j.published_at };
      U.state = newer(U.latest.version, VERSION) ? 'available' : 'current';
      prefs.last = Date.now(); savePrefs();
      if (U.state === 'available' && (manual || prefs.skip !== U.latest.version)) offer();
      else if (manual && U.state === 'current') toast(`Leaflet ${VERSION} is the newest`, '🍃');
    } catch (e) { U.state = 'error'; U.error = e.message === 'Failed to fetch' ? 'Leaflet couldn’t reach GitHub. Check the internet connection.' : e.message; if (manual) { sfx.error(); toast(U.error, '⚠️'); } }
    show();
  }
  function offer() {
    const L = U.latest, root = document.getElementById('popover-root');
    if (!root || root.children.length) return;   // something else is open; Backups › Leaflet still shows it
    const close = () => root.replaceChildren();
    const notes = L.notes.split('\n').map(x => x.trim()).filter(x => /^[-*] /.test(x)).slice(0, 6).map(x => x.replace(/^[-*] /, '').replace(/\*\*/g, ''));
    root.replaceChildren(h('div', { class: 'scrim', onclick: close }),
      h('div', { class: 'sheet', style: { width: 'min(480px, calc(100vw - 32px))', top: '16vh' } },
        h('div', { class: 'sheet-head' }, h('div', { class: 'top' }, h('h3', null, `🍃 ${L.name || 'Leaflet ' + L.version} is out`))),
        h('div', { class: 'sheet-body', style: { padding: '14px 16px', lineHeight: 1.5 } },
          h('p', { style: { margin: '0 0 8px' } }, `You have Leaflet ${VERSION}. ${native() ? 'Leaflet can download the new version, check it, and start it again. Your settings and backups come with it.' : 'Download it from GitHub.'}`),
          notes.length ? h('ul', { style: { margin: 0, paddingLeft: '18px' } }, notes.map(n => h('li', null, n))) : null),
        h('div', { class: 'sheet-foot' },
          h('button', { class: 'btn small', style: { marginRight: 'auto' }, onclick: () => { prefs.skip = L.version; savePrefs(); close(); } }, 'Skip this version'),
          h('button', { class: 'btn', onclick: close }, 'Later'),
          h('button', { class: 'btn leaf', onclick: () => { close(); install(); } }, native() ? 'Update now' : 'Open GitHub'))));
    sfx.bell();
  }
  async function install() {
    if (!native()) { window.open(U.latest ? U.latest.url : `https://github.com/${REPO}/releases/latest`, '_blank'); return; }
    if (window.APP && APP.isDirty && APP.isDirty()) { sfx.error(); toast('Save your changes first, then update', '💾'); return; }
    U.state = 'downloading'; U.pct = 0; U.error = ''; show();
    try { await keepCopy(); } catch (e) { /* the app's own storage still has everything */ }
    native().postMessage({ cmd: 'update' });
  }
  // Progress from the Mac app or Leaflet Helper: { state: 'downloading'|'installing'|'done'|'error', pct, error, version }.
  window.LeafletUpdate = m => {
    U.state = m.state; U.pct = m.pct || 0; U.error = m.error || '';
    if (m.state === 'done') {
      sfx.bell(); toast(`Leaflet ${m.version || ''} is installed. Starting it…`, '🍃');
      // Windows: the new copy opens its own window, so this one closes (the Mac app quits and reopens by itself).
      if (!mac) setTimeout(() => { try { window.close(); } catch (e) { /* stays open; the new window is in front */ } }, 6000);
    }
    if (m.state === 'error') { sfx.error(); toast(U.error || 'The update didn’t finish', '⚠️'); }
    show();
  };

  // Backups › Leaflet: the version, updates and app data.
  function cards(refresh) {
    const { row, card, section, switchInput } = UI;
    paint = () => { if (APP.view === 'backups') refresh(); };
    const busy = ['checking', 'downloading', 'installing'].includes(U.state);
    const status = U.state === 'checking' ? 'Asking GitHub…' : U.state === 'downloading' ? `Downloading${U.pct ? ` (${U.pct}%)` : ''}…` : U.state === 'installing' ? 'Putting the new version in place…'
      : U.state === 'done' ? 'Installed. Leaflet is starting again.' : U.state === 'available' ? `Leaflet ${U.latest.version} is out.` : U.state === 'current' ? 'This is the newest version.' : U.state === 'error' ? U.error
      : prefs.last ? `Last checked ${new Date(prefs.last).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Not checked yet.';
    return [section('🍃 Leaflet', `Version ${VERSION}`), card(
      row('Updates', status, h('div', { class: 'btn-row' },
        U.state === 'available' ? h('button', { class: 'btn small leaf', disabled: busy, onclick: install }, native() ? 'Update now' : 'Open GitHub') : null,
        h('button', { class: 'btn small', disabled: busy, onclick: () => check(true) }, 'Check now'))),
      !native() ? null : row('Check every day', 'Leaflet asks GitHub once a day whether there’s a newer version. Nothing about you or your towns is sent.', switchInput(() => prefs.auto, v => { prefs.auto = v; savePrefs(); refresh(); })),
      row('Move to another computer', 'Your settings, every backup and Leaflet Link’s history, in one file. Import it in Leaflet on the other computer. (Game art comes from the ROM there.)',
        h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: exportFile }, 'Export…'), h('button', { class: 'btn small', onclick: () => importFile(refresh) }, 'Import…'))),
      native() ? row('Copy beside the app', prefs.snapshot ? `Kept ${new Date(prefs.snapshot).toLocaleDateString()}, and again before each update. A new version that starts empty reads it back.` : 'Kept before each update and every few days. A new version that starts empty reads it back.',
        h('button', { class: 'btn small', onclick: () => keepCopy().then(ok => { if (ok) { sfx.bell(); toast('Copy kept', '🗂️'); refresh(); } }, () => { sfx.error(); toast('The copy couldn’t be written', '⚠️'); }) }, 'Keep a copy now')) : null)];
  }

  // ---------- what's new ----------
  // Shown once after updating to a new version (not on a first visit: there's nothing to compare with yet).
  const NEW = {
    '2.0.0': [
      ['📱', 'Leaflet on your phone', 'Open Leaflet Link on your 3DS and scan its QR code: Leaflet opens on your phone or tablet, already connected to your game card.'],
      ['🚶', 'Walk around your town', 'Your town in 3D, on foot or from above, lit by the game’s clock and weather.'],
      ['🌹', 'Flower breeding', 'The game’s own hybrid odds, and the pairs already growing side by side in your town.'],
      ['🎖️', 'Badges & Town vs Town', 'Badges earned from each save, and your towns compared side by side.'],
      ['🕰️', 'Match my local time', 'Set the game clock to your own time without turnips spoiling (Town Records › Game clock).'],
      ['🔄', 'Updates for everything', 'Leaflet keeps itself and Leaflet Link up to date, and your settings and backups come along.'],
      ['💾', 'SD cards, found for you', 'Put in a flashcart’s card and Leaflet finds your saves and ROM on it.'],
    ],
  };
  async function whatsNew() {
    if (prefs.seen === VERSION) return;
    const first = await isEmpty();
    prefs.seen = VERSION; savePrefs();
    const list = NEW[VERSION], root = document.getElementById('popover-root');
    if (first || !list || !root || root.children.length) return;
    const close = () => root.replaceChildren();
    root.replaceChildren(h('div', { class: 'scrim', onclick: close }),
      h('div', { class: 'sheet', style: { width: 'min(500px, calc(100vw - 32px))', top: '10vh' } },
        h('div', { class: 'sheet-head' }, h('div', { class: 'top' }, h('h3', null, `🍃 What’s new in Leaflet ${VERSION.replace(/\.0$/, '')}`))),
        h('div', { class: 'sheet-body', style: { padding: '12px 16px', maxHeight: '60vh', overflow: 'auto' } },
          list.map(([em, title, text]) => h('div', { style: { display: 'flex', gap: '12px', padding: '8px 0' } },
            h('span', { style: { fontSize: '24px', lineHeight: 1 } }, em),
            h('div', null, h('b', null, title), h('div', { class: 'muted', style: { fontSize: '13px', marginTop: '2px' } }, text))))),
        h('div', { class: 'sheet-foot' }, h('button', { class: 'btn leaf', onclick: close }, 'Let’s go!'))));
    sfx.bell();
  }

  window.AppData = { snapshot, restore, keepCopy, cards, check, newer };
  setTimeout(() => whatsNew().catch(() => {}), 2500);
  // Wait for Leaflet Helper's first answer on Windows, then look; the daily check (apps only: the web version is always
  // the newest) waits a little longer.
  setTimeout(startup, 1500);
  setTimeout(() => { if (native() && prefs.auto && Date.now() - prefs.last > 864e5) check(false); }, 8000);
})();
