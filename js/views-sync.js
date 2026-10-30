// Cartridge Sync: moves a town between a real Wild World game card and Leaflet over Wi-Fi, through Leaflet Link (the
// 3DS homebrew app in link/). Reading is harmless; writing is guarded on both sides:
//  - Leaflet reads the cartridge again right before sending, shows what will change, and asks before replacing a
//    different town;
//  - the save goes with its CRC-32, and Leaflet Link checks it, every checksum, the card and the battery, then waits
//    for A on the console;
//  - Leaflet Link keeps the cartridge's old save on the SD card, writes, and reads everything back; Leaflet then reads
//    the cartridge over Wi-Fi once more and compares it with what it sent.
// Both the cartridge's old save and what was sent are also kept in Backups.
(function () {
  'use strict';
  const { h, sfx, toast, say, confirmSheet, section, fmt } = UI;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const PORT = 8226, SIZE = 0x40000, ADDR_KEY = 'leaflet-link-address';

  // ---------- helpers ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const hex8 = n => n.toString(16).padStart(8, '0');
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
  const pages = (a, b) => { let n = 0; for (let p = 0; p < SIZE; p += 256) { for (let i = p; i < p + 256; i++) if (a[i] !== b[i]) { n++; break; } } return n; };
  const store = { get() { try { return localStorage.getItem(ADDR_KEY) || ''; } catch (e) { return ''; } }, set(v) { try { localStorage.setItem(ADDR_KEY, v); } catch (e) { /* private mode */ } } };
  const residents = s => [0, 1, 2, 3].filter(p => s.playerExists(p)).map(p => s.str(s.playerBase(p) + 0x2282, 8));
  const townKey = s => `${s.u16(2)}-${s.str(4, 8)}`;
  const blank = b => b.every(x => x === 0xFF);
  function parse(bytes) { try { return new WWSave(bytes, 'cartridge.sav'); } catch (e) { return null; } }
  function download(name, bytes) { const a = h('a', { href: URL.createObjectURL(new Blob([bytes])), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

  // Address as typed: "192.168.1.23", with or without the port.
  function base(addr) {
    const a = addr.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return `http://${/:\d+$/.test(a) ? a : `${a}:${PORT}`}`;
  }
  async function call(path, opt = {}, ms = 8000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(base(S.addr) + path, { ...opt, signal: ctl.signal, cache: 'no-store' });
      return r;
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'The 3DS stopped answering. Check it’s still on and showing Leaflet Link.' : 'Couldn’t reach the 3DS. Check the address, and that the 3DS and this computer are on the same Wi-Fi.');
    } finally { clearTimeout(t); }
  }
  async function json(path, opt, ms) {
    const r = await call(path, opt, ms);
    let j;
    try { j = await r.json(); } catch (e) { throw new Error(r.ok ? 'The 3DS’s answer was cut off part-way. Try again.' : `The 3DS answered ${r.status}.`); }
    if (!r.ok) throw new Error(j.error || `The 3DS answered ${r.status}.`);
    return j;
  }

  // ---------- the town's clock (js/gameclock.js) ----------
  // S.dsDelta: seconds the 3DS's clock is ahead of this computer's (from Leaflet Link 1.2's /info), or null if unknown.
  // melonDS runs on this computer's clock plus its own RTC.Offset. Moving a town shifts its game clock by the
  // difference, so the game's time carries on and turnips don't spoil.
  const GC = window.WW_GAMECLOCK;
  function noteClock(j) { const t = GC && GC.parseWall(j.clock); S.dsDelta = t == null ? null : Math.round((t - GC.wallNow()) / 1000); }
  const emuDelta = () => (E.status && E.status.rtcOffset) || 0;
  const toEmulator = bytes => (GC && S.dsDelta != null ? GC.shift(bytes, S.dsDelta - emuDelta()) : { bytes, seconds: 0 });
  const fromEmulator = bytes => (GC && S.dsDelta != null ? GC.shift(bytes, emuDelta() - S.dsDelta) : { bytes, seconds: 0 });
  // Two saves the same apart from their game clock (an emulator copy whose clock was moved).
  function sameIgnoringClock(a, b) {
    const x = parse(a), y = parse(b);
    if (!x || !y) return same(a, b);
    y.setBytes(GC.OFFSET, x.bytes(GC.OFFSET, 6));   // the clock bytes exactly as stored (the same time can be written two ways)
    return same(x.export().slice(0, SIZE), y.export().slice(0, SIZE));
  }

  // ---------- state ----------
  // phase: off · connecting · ready · review · sending · result
  // Opened from Leaflet Link itself (a phone scanning the 3DS's QR code): this page's own address is the 3DS.
  const PHONE = !!window.LEAFLET_PHONE, FROM_LINK = !!window.LEAFLET_FROM_LINK;
  const S = { addr: FROM_LINK ? location.host : store.get(), phase: 'off', info: null, err: '', note: '', cart: null, cartAt: 0, reading: false, src: 0, file: null, fileName: '', replaceOk: false, job: 0, status: null, sent: null, after: '' };
  let root = null, infoTimer = 0;
  const paint = () => { if (root && root.isConnected) root.replaceChildren(...body()); };
  const fail = (e, phase) => { S.err = e.message || String(e); if (phase) S.phase = phase; sfx.error(); paint(); };

  // quiet: used while waiting for Leaflet Link to start; failures don't show, and it returns whether it connected.
  async function connect(quiet) {
    if (!S.addr.trim()) { S.err = 'Type the address shown on the 3DS.'; paint(); return false; }
    S.phase = 'connecting'; S.err = ''; if (!quiet) S.note = ''; paint();
    try {
      const j = await json('/info', {}, quiet ? 2500 : 8000);
      if (j.app !== 'Leaflet Link') throw new Error('Something answered at that address, but it isn’t Leaflet Link.');
      if (j.protocol > 1) throw new Error('This Leaflet Link is newer than this Leaflet. Update Leaflet to use it.');
      S.info = j; noteClock(j); S.phase = 'ready'; S.note = ''; store.set(S.addr.trim()); markInstalled();
      sfx.bell(); paint();
      watchInfo();
      if (j.card.ready) readCart().then(diaryFromSD); else diaryFromSD();
      autoUpdateLink();
      return true;
    } catch (e) { if (!quiet) fail(e, 'off'); return false; }
  }
  // Keeps trying for a while: Leaflet Link takes a few seconds to start and join the Wi-Fi.
  async function reconnect(seconds, note) {
    S.note = note; S.phase = 'connecting'; paint();
    for (const until = Date.now() + seconds * 1000; Date.now() < until;) {
      if (await connect(true)) return true;
      await new Promise(r => setTimeout(r, 1500));
    }
    S.phase = 'off'; S.note = ''; S.err = 'Leaflet Link didn’t answer yet. When the 3DS shows its address, click Connect.'; paint();
    return false;
  }
  // ---------- installing and updating Leaflet Link ----------
  // js/linkapp.js carries the Leaflet Link this Leaflet was built with (tools/build_link_js.py).
  const APPB = window.LEAFLET_LINK_APP || null;
  const appBytes = () => Uint8Array.from(atob(APPB.data), c => c.charCodeAt(0));
  // The Mac app's bridge, or on Windows Leaflet Helper (js/winhelper.js), which takes the same commands.
  const mac = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.leaflet;
  const native = mac || window.LeafletHelper || null;
  const onWindows = /Windows/.test(navigator.userAgent);
  const HERE = mac ? 'this Mac' : 'this PC';
  const INSTALLED_KEY = 'leaflet-link-installed';
  const installedBefore = () => { try { return !!localStorage.getItem(INSTALLED_KEY); } catch (e) { return false; } };
  function markInstalled() { try { localStorage.setItem(INSTALLED_KEY, '1'); } catch (e) { /* private mode */ } }
  const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  const I = { state: '', progress: 0, error: '', manual: '', open: false };   // wireless install (Mac app)
  const U = { state: '', message: '' };                                        // update over Leaflet Link

  // The Mac app's LinkInstaller reports here: searching, sending (progress), done, notFound, error.
  window.LeafletLinkInstall = info => {
    Object.assign(I, { state: info.state, progress: info.progress || 0, error: info.error || '' });
    if (info.state === 'done') {
      markInstalled(); sfx.save(); toast('Leaflet Link is on your 3DS', '🎮');
      S.addr = info.address; store.set(info.address);
      reconnect(45, 'Leaflet Link is starting on your 3DS. Connecting…').then(ok => { if (ok) I.state = ''; });
    } else if (info.state === 'notFound' || info.state === 'error') sfx.error();
    paint();
  };
  function sendToLauncher() {
    Object.assign(I, { state: 'searching', progress: 0, error: '' }); sfx.click(); paint();
    native.postMessage({ cmd: 'install3ds', data: APPB.data, address: I.manual.trim().replace(/:\d+$/, '') });
  }
  function downloadApp() { download('LeafletLink.3dsx', appBytes()); sfx.pop(); }

  // Everything updates together: when this Leaflet carries a newer Leaflet Link than the 3DS has, it sends it once
  // the card has been read (once per version per session). The 3DS still asks before installing it.
  const autoTried = new Set();
  function autoUpdateLink() {
    if (PHONE || !APPB || !S.info || !newer(APPB.version, S.info.version) || autoTried.has(APPB.version) || U.state) return;
    autoTried.add(APPB.version);
    const go = () => { if (S.phase !== 'ready' || !S.info) return; if (S.reading || HC.job) { setTimeout(go, 1500); return; } updateLink(); };
    setTimeout(go, 2500);
  }
  async function updateLink() {
    clearInterval(infoTimer);
    const job = (Math.random() * 1e9) >>> 0;
    Object.assign(U, { state: 'sending', message: '' }); S.note = ''; paint();
    try {
      const q = new URLSearchParams({ crc: APPB.crc, version: APPB.version, job });
      let st = await json(`/update?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: appBytes() }, 60000);
      U.state = st.state; paint();
      while (st.state === 'confirm' || st.state === 'updating') {
        await new Promise(r => setTimeout(r, 400));
        st = await json('/status', {}, 5000);
        if (st.job !== job) throw new Error('Leaflet Link moved on to something else. Check the 3DS.');
        if (st.state !== U.state) { U.state = st.state; paint(); }
      }
      if (st.state === 'idle') { U.state = ''; S.note = 'The update was cancelled on the 3DS. Nothing changed.'; watchInfo(); paint(); return; }
      if (st.state !== 'done') throw new Error(st.message);
      U.state = 'restart'; sfx.save(); paint();
      // The old version closes when A is pressed; wait for the new one to answer.
      for (const until = Date.now() + 5 * 60000; Date.now() < until;) {
        await new Promise(r => setTimeout(r, 1500));
        try { const j = await json('/info', {}, 2500); if (j.version === APPB.version) { S.info = j; U.state = ''; toast(`Leaflet Link ${j.version} is ready`, '🎮'); watchInfo(); paint(); return; } } catch (e) { /* not back yet */ }
      }
      throw new Error('Leaflet Link hasn’t come back yet. Open it from the Homebrew Launcher, then click Connect.');
    } catch (e) { U.state = 'failed'; U.message = e.message; sfx.error(); watchInfo(); paint(); }
  }

  // ---------- friend code on emulators (js/wfc.js) ----------
  // The town's save holds its Nintendo WFC user ID; giving melonDS the same ID keeps the friend code there.
  const W = { melon: null, asked: false, busy: false, msg: '', bad: false };
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  window.LeafletMelonWfc = info => {
    W.melon = info; W.busy = false;
    if (info.error) { W.msg = info.error; W.bad = true; sfx.error(); }
    else if (info.ok) { W.msg = `Done. melonDS now has this town’s Wi-Fi ID${info.backup ? `; its old settings are kept next to it as “${info.backup}”` : ''}. Open melonDS and connect as usual.`; W.bad = false; sfx.save(); toast('melonDS will keep your friend code', '🤝'); }
    paint();
  };
  function wfcSource() {
    if (S.cart && S.cart.save) return { s: S.cart.save, where: 'the game card' };
    if (APP.save) return { s: APP.save, where: 'the town open in Leaflet' };
    return null;
  }
  // melonDS on this computer: 'none' (no settings yet), 'match', 'other', or 'damaged'.
  function melonState(id) {
    if (!W.melon) return '';
    if (!W.melon.exists) return 'none';
    try { const e = WW_WFC.emulatorId(fromB64(W.melon.data), 'wfcsettings'); return !e.ok.every(Boolean) ? 'damaged' : e.id === id ? 'match' : 'other'; } catch (e) { return 'damaged'; }
  }
  function setUpMelon(id) {
    W.msg = ''; W.bad = false;
    try {
      const st = melonState(id);
      const base = st === 'match' || st === 'other' ? fromB64(W.melon.data) : WW_WFC.melonDefault();
      W.busy = true; paint();
      native.postMessage({ cmd: 'melonWfcWrite', data: toB64(WW_WFC.apply(base, 'wfcsettings', id).bytes) });
    } catch (e) { W.busy = false; W.msg = e.message; W.bad = true; sfx.error(); paint(); }
  }
  function downloadWfc(id) { download('wfcsettings.bin', WW_WFC.apply(WW_WFC.melonDefault(), 'wfcsettings', id).bytes); sfx.pop(); }
  function updateWfcFile(id) {
    const inp = h('input', { type: 'file', accept: '.bin' });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const b = new Uint8Array(await f.arrayBuffer());
      try {
        const r = WW_WFC.apply(b, b.length >= 0x20000 ? 'firmware' : 'wfcsettings', id);
        download(f.name, r.bytes);
        W.msg = r.changed ? `Updated ${f.name}: it now has this town’s Wi-Fi ID. Replace the old file with the one just downloaded.` : `${f.name} already has this town’s Wi-Fi ID. Nothing to change.`; W.bad = false; sfx.save();
      } catch (e) { W.msg = e.message; W.bad = true; sfx.error(); }
      paint();
    };
    inp.click();
  }
  function wfcCard() {
    const src = wfcSource();
    if (!src || !window.WW_WFC) return [];
    const t = WW_WFC.town(src.s);
    if (native && !W.asked) { W.asked = true; native.postMessage({ cmd: 'melonWfcRead' }); }
    const people = h('ul', { class: 'sync-fc' }, t.people.map(x => h('li', null, h('b', null, x.name), x.friendCode ? h('span', { class: 'fc' }, x.friendCode) : h('span', { class: 'muted' }, x.ok ? 'no friend code yet' : 'not set up for Wi-Fi'))));
    const parts = [people];
    if (!t.userId) parts.push(h('p', { class: 'muted' }, 'No one in this town has connected to Nintendo Wi-Fi Connection yet (today through a replacement service such as Wiimmfi). The friend code is made the first time you connect. Do that on the system you’ll play on most, then come back here.'));
    else {
      parts.push(h('p', { style: { margin: '10px 0' } }, 'Wild World only keeps a friend code on a system whose Nintendo WFC ID matches the one in the save. Leaflet gives melonDS this town’s ID, so the same friend code and the same friends work there and on your DS.'));
      if (t.mixed) parts.push(h('div', { class: 'sync-msg bad' }, '⚠️ These residents registered on different systems. melonDS can only match one, so it gets the first resident’s ID; the others get new friend codes there.'));
      if (native) {
        const st = melonState(t.userId);
        const line = W.melon && !mac && !W.melon.installed ? 'Install melonDS (Play on melonDS) and Leaflet can set it up here.' : { none: `melonDS on ${HERE} isn’t set up for Wi-Fi yet.`, match: `✅ melonDS on ${HERE} already has this town’s ID.`, other: `melonDS on ${HERE} has a different Wi-Fi ID, so this town would get a new friend code there.`, damaged: `melonDS’s Wi-Fi settings on ${HERE} are damaged; Leaflet can replace them with fresh ones.` }[st] || `Checking melonDS on ${HERE}…`;
        parts.push(h('div', { class: 'sync-row' },
          h('span', { class: 'sync-dot' + (st === 'match' ? ' ok' : '') }), h('span', null, line), h('span', { class: 'spacer' }),
          h('button', { class: 'btn leaf', disabled: W.busy || st === 'match' || !st, onclick: () => setUpMelon(t.userId) }, W.busy ? 'Setting up…' : '🤝 Give melonDS this ID')));
        if (W.melon && W.melon.running && st !== 'match') parts.push(h('div', { class: 'fine' }, 'Quit melonDS first, so it doesn’t write over the new settings.'));
      }
      parts.push(h('div', { class: 'btn-row', style: { marginTop: '10px' } },
        h('button', { class: 'btn small', onclick: () => downloadWfc(t.userId) }, '⬇︎ wfcsettings.bin for melonDS'),
        h('button', { class: 'btn small', onclick: () => updateWfcFile(t.userId) }, 'Update my own file…')));
      parts.push(h('div', { class: 'fine', style: { marginTop: '8px' } }, native ? `Elsewhere, put wfcsettings.bin in melonDS’s folder (${mac ? 'next to melonDS.exe on Windows' : `on this PC it’s ${W.melon && W.melon.path ? W.melon.path : 'next to melonDS.exe'}; ~/Library/Preferences/melonDS on a Mac`}) and use its built-in firmware. With your own firmware dump, update that file instead. Play online on one system at a time.` : 'Put wfcsettings.bin in melonDS’s folder (next to melonDS.exe on Windows; ~/Library/Preferences/melonDS on a Mac) and use its built-in firmware. With your own firmware dump, update that file instead. Play online on one system at a time.'));
    }
    if (W.msg) parts.push(h('div', { class: 'sync-msg' + (W.bad ? ' bad' : ' ok') }, W.msg));
    return [section('🤝 Keep your friend code on an emulator', `From ${src.where}`), h('div', { class: 'card pad sync-wfc' }, parts)];
  }

  // ---------- Play on melonDS (Mac app; mac/EmulatorSession.swift) ----------
  // Leaflet copies the game card's town into melonDS's play folder, starts melonDS, keeps every save it writes in
  // Backups, and when melonDS quits offers to send the town back (through the usual review and checks).
  const E = { status: null, asked: false, phase: '', saves: 0, session: null, err: '', setup: false, blocked: false };
  const M = { state: '', progress: 0, version: '', error: '' };   // installing melonDS (mac/MelonInstaller.swift)
  window.LeafletMelonInstall = info => {
    Object.assign(M, { state: info.state, progress: info.progress || 0, version: info.version || M.version, error: info.error || '' });
    if (info.state === 'done') { sfx.save(); toast(`melonDS ${M.version} is installed`, '🎮'); }
    else if (info.state === 'error') sfx.error();
    paint();
  };
  // If melonDS hasn't started after a while, macOS is most likely holding it back (first launch of a download).
  // On Windows the helper starts it directly, so a long wait means something else went wrong.
  let startWatch = 0;
  function watchStart() {
    clearTimeout(startWatch);
    startWatch = setTimeout(() => {
      if (E.phase !== 'starting') return;
      E.phase = ''; E.blocked = !!mac; sfx.error();
      E.err = mac ? 'melonDS hasn’t opened. If macOS showed a message about it, open Privacy & Security, click Open Anyway next to melonDS, then press Play again. Your town is safe; nothing changed.'
        : 'melonDS hasn’t opened. If Windows showed a message about it, allow it, then press Play again. Make sure Start Leaflet is what opened this window. Your town is safe; nothing changed.';
      paint();
    }, 25000);
  }
  const blockedHelp = () => E.blocked ? h('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: () => native.postMessage({ cmd: 'openSecuritySettings' }) }, 'Open Privacy & Security') : null;
  window.LeafletEmu = info => {
    if (info.state === 'status') {
      E.status = info;
      if (info.pending && !info.pending.active && E.phase !== 'playing') { E.session = info.pending; E.phase = 'back'; }
      if (!info.pending && E.phase === 'back') { E.phase = ''; E.session = null; }
    } else if (info.state === 'error') { E.err = info.error; E.blocked = !!info.blocked; if (E.phase === 'starting') E.phase = ''; sfx.error(); }
    else if (info.state === 'playing') { E.phase = 'playing'; E.saves = 0; E.err = ''; E.blocked = false; E.setup = false; toast(`${info.emulator || 'melonDS'} is starting with your town`, '🎮'); }
    else if (info.state === 'saved') {
      E.saves++;
      if (window.Backups) Backups.add(fromB64(info.data), 'game', { file: 'melonDS' });
    } else if (info.state === 'closed') {
      E.phase = 'back'; E.session = info; sfx.bell();
      say(`Welcome back! ${info.town} is ready to go back to your game card whenever you are.`);
    }
    paint();
  };
  function emuReady(c) {
    const st = E.status || {};
    if (!st.rom) return 'Choose your ROM backup first.';
    if (c && st.romCode && st.romCode !== c) return `Your ROM backup is the ${st.romCode} version, but this game card is ${c}. Choose the backup of this game card.`;
    if (!st.emulator) return 'Leaflet couldn’t find melonDS. Choose where it is.';
    return '';
  }
  function playOnEmu() {
    const c = S.cart, code = S.info && S.info.card.code;
    E.err = '';
    if (!c || !c.save) return;
    if (emuReady(code)) { E.setup = true; sfx.open(); paint(); return; }
    if (window.Backups) Backups.add(c.bytes, 'cartridge');
    // Keep the friend code: give melonDS this town's Nintendo WFC ID first, when it differs.
    const t = window.WW_WFC ? WW_WFC.town(c.save) : null;
    if (t && t.userId && ['none', 'other'].includes(melonState(t.userId))) {
      try { const base = melonState(t.userId) === 'other' ? fromB64(W.melon.data) : WW_WFC.melonDefault(); native.postMessage({ cmd: 'melonWfcWrite', data: toB64(WW_WFC.apply(base, 'wfcsettings', t.userId).bytes) }); } catch (e) { /* the friend-code card explains */ }
    }
    E.phase = 'starting'; E.blocked = false; sfx.click(); paint(); watchStart();
    const played = toEmulator(c.bytes);
    if (played.seconds) toast(`Town clock moved ${played.seconds > 0 ? 'ahead' : 'back'} ${GC.span(played.seconds)} to suit melonDS`, '🕰');
    native.postMessage({ cmd: 'emuPlay', data: toB64(played.bytes), start: toB64(c.bytes), cardCode: code, town: c.save.str(4, 8) });
  }
  function sendEmuBack() {
    const fin = fromB64(E.session.data), s = parse(fin);
    if (!s) { E.err = 'The save melonDS wrote isn’t one Leaflet can read, so it can’t go back to the game card. It’s kept in Backups.'; sfx.error(); paint(); return; }
    S.file = s; S.fileName = `${E.session.town}, played on melonDS`; S.emuStart = fromB64(E.session.start);
    startReview(1);
  }
  function emuCard() {
    if (!native) return [];
    if (!E.asked) { E.asked = true; native.postMessage({ cmd: 'emuStatus' }); }
    if (E.phase === 'starting') return [h('div', { class: 'card pad sync-update' }, h('span', { class: 'sync-spin' }), h('b', null, 'Starting melonDS with your town…'))];
    if (E.phase === 'playing') return [h('div', { class: 'card pad sync-emu' },
      h('div', { class: 'big' }, '🎮'),
      h('div', null, h('h3', null, 'Playing on melonDS'), h('p', { class: 'muted' }, `Every save is kept in Backups as you play${E.saves ? ` (${E.saves} so far)` : ''}. Save in the game, then quit melonDS when you’re done; Leaflet offers to send your town back to the game card.`)))];
    if (E.phase === 'back' && E.session) {
      const start = parse(fromB64(E.session.start)), fin = parse(fromB64(E.session.data));
      const lines = start && fin && window.WW_DIARY ? WW_DIARY.diff(start, fin) : [];
      const unchanged = sameIgnoringClock(fromB64(E.session.start), fromB64(E.session.data));
      const connected = S.info && S.phase !== 'off' && S.phase !== 'connecting';
      return [section('🎮 Back from melonDS', E.session.town), h('div', { class: 'card pad sync-emu-back' },
        unchanged ? h('p', null, 'You didn’t save in melonDS, so there’s nothing to send back.')
          : [h('p', { style: { marginTop: 0 } }, `${E.session.town} was saved in melonDS. Here’s what changed while you played:`),
            lines.length ? h('ul', { class: 'sync-diff-list' }, lines.slice(0, 10).map(([em, t]) => h('li', null, h('span', null, em), t)), lines.length > 10 ? h('li', { class: 'muted' }, `…and ${lines.length - 10} more`) : null) : h('p', { class: 'muted' }, 'Small changes the town diary doesn’t describe (items, letters, designs or settings).')],
        !fin && !unchanged ? h('div', { class: 'sync-msg bad' }, '⚠️ The save melonDS wrote isn’t one Leaflet can read. It’s kept in Backups; the game card hasn’t been touched.') : null,
        E.err ? h('div', { class: 'sync-msg bad' }, h('div', null, '⚠️ ', E.err), blockedHelp()) : null,
        h('div', { class: 'btn-row', style: { marginTop: '12px' } },
          !unchanged ? h('button', { class: 'btn leaf big', disabled: !connected || !fin, onclick: sendEmuBack }, '📤 Send it to the game card') : null,
          h('button', { class: 'btn', onclick: () => { E.err = ''; E.blocked = false; native.postMessage({ cmd: 'emuResume' }); E.phase = 'starting'; watchStart(); paint(); } }, '🎮 Keep playing'),
          h('button', { class: 'btn', onclick: async () => { if (!unchanged && !await confirmSheet('Set this town aside?', 'It stays in Backups and in Leaflet’s play folder, but won’t be offered for sending again.', 'Set aside')) return; native.postMessage({ cmd: 'emuClose' }); E.phase = ''; E.session = null; paint(); } }, unchanged ? 'Done' : 'Set aside')),
        !connected && !unchanged ? h('div', { class: 'fine' }, 'Connect to your 3DS below to send it.') : null)];
    }
    if (E.setup) {
      const st = E.status || {}, code = S.info && S.info.card.code;
      const installing = ['checking', 'downloading', 'installing'].includes(M.state);
      const romLine = !st.rom ? 'Not chosen yet' : st.romCode && code && st.romCode !== code ? `${st.rom} is the ${st.romCode} version; this game card is ${code}` : `${st.rom} (${st.romCode})`;
      return [section('🎮 Play on melonDS: one-time setup'), h('div', { class: 'card pad sync-emu-setup' },
        h('div', { class: 'sync-row' }, h('span', { class: 'sync-dot' + (st.rom && (!code || st.romCode === code) ? ' ok' : '') }), h('span', null, h('b', null, 'Your ROM backup: '), romLine), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => native.postMessage({ cmd: 'emuChooseRom' }) }, st.rom ? 'Change…' : 'Choose…')),
        h('div', { class: 'sync-row', style: { marginTop: '8px' } }, h('span', { class: 'sync-dot' + (st.emulator ? ' ok' : '') }),
          h('span', null, h('b', null, 'melonDS: '), installing ? { checking: 'finding the latest version…', downloading: `downloading ${M.version} (${Math.round(M.progress * 100)}%)…`, installing: 'checking and installing…' }[M.state] : st.emulator ? `found (${st.emulator})` : M.state === 'done' ? 'installed ✓' : 'not installed'),
          h('span', { class: 'spacer' }),
          !st.emulator ? h('button', { class: 'btn small leaf', disabled: installing, onclick: () => { Object.assign(M, { state: 'checking', error: '' }); sfx.click(); paint(); native.postMessage({ cmd: 'melonInstall' }); } }, '⬇︎ Install melonDS') : null,
          h('button', { class: 'btn small', disabled: installing, onclick: () => native.postMessage({ cmd: 'emuChooseEmulator' }) }, st.emulator ? 'Change…' : 'Choose…')),
        installing && M.state === 'downloading' ? h('div', { class: 'sync-bar', style: { marginTop: '8px' } }, h('span', { style: { width: `${Math.round(M.progress * 100)}%` } })) : null,
        M.state === 'error' ? h('div', { class: 'sync-msg bad' }, '⚠️ ', M.error) : null,
        !st.emulator && !installing ? h('div', { class: 'fine', style: { marginTop: '6px' } }, mac ? 'Leaflet downloads the latest melonDS from its official GitHub page, checks it against the checksum GitHub publishes, and puts it in your Applications folder. The first time it opens, macOS asks you to allow it (Privacy & Security › Open Anyway), because Apple hasn’t checked it.'
          : 'Leaflet downloads the latest melonDS from its official GitHub page, checks it against the checksum GitHub publishes, and puts it in your user’s Programs folder (no administrator needed). Updating it later keeps its settings.') : null,
        h('div', { class: 'fine', style: { marginTop: '10px' } }, `Use a backup you made yourself from this game card. Leaflet keeps a copy of it in its own play folder on ${HERE} (${mac ? 'never in iCloud' : 'in your local app data, never in OneDrive'}), so melonDS can keep the save next to it.`),
        E.err ? h('div', { class: 'sync-msg bad' }, h('div', null, '⚠️ ', E.err), blockedHelp()) : null,
        h('div', { class: 'btn-row', style: { marginTop: '12px' } }, h('button', { class: 'btn leaf', disabled: !!emuReady(code) || installing, onclick: playOnEmu }, '🎮 Play on melonDS'), h('button', { class: 'btn', onclick: () => { E.setup = false; paint(); } }, 'Not now')))];
    }
    return E.err ? [h('div', { class: 'sync-msg bad' }, h('div', null, '⚠️ ', E.err), blockedHelp())] : [];
  }

  // ---------- saves on SD cards (flashcarts such as the R4) ----------
  const F = { busy: false, results: null, searched: [], err: '' };
  // Windows: Leaflet Helper has stopped (its window was closed from Task Manager, or Start Leaflet ran again with a new
  // token). Everything waiting on it is cleared and the page says how to get it back.
  let helperLost = false;
  window.LeafletHelperLost = () => {
    helperLost = true; F.busy = false; W.busy = false;
    if (E.phase === 'starting') E.phase = '';
    if (['checking', 'downloading', 'installing'].includes(M.state)) { M.state = 'error'; M.error = 'Leaflet Helper stopped before melonDS was installed.'; }
    if (I.state === 'searching' || I.state === 'sending') { I.state = 'error'; I.error = 'Leaflet Helper stopped.'; }
    paint();
  };
  window.LeafletHelperBack = () => { helperLost = false; paint(); };
  function foundSave(bytes, name, where, modified) {
    const ok = bytes.length >= SIZE && [bytes[0], bytes[0x15FE0]].some(x => x === 0x8A || x === 0xC5 || x === 0x32);
    if (!ok) return null;
    const s = parse(bytes);
    return { bytes, name, where, modified, s, japanese: !s && (bytes[0] === 0x32 || bytes[0x15FE0] === 0x32) };
  }
  window.LeafletSaves = info => {
    F.busy = false; F.searched = info.searched || [];
    F.results = (info.results || []).map(r => foundSave(fromB64(r.data), r.name, r.path, r.modified)).filter(Boolean);
    F.results.sort((a, b) => b.modified - a.modified);
    F.results.length ? sfx.bell() : sfx.cancel();
    paint();
  };
  function searchSD(folder) {
    F.err = '';
    if (native) { F.busy = true; paint(); native.postMessage({ cmd: folder ? 'findSavesIn' : 'findSaves' }); return; }
    const inp = h('input', { type: 'file', webkitdirectory: true, multiple: true });
    inp.onchange = async () => {
      F.busy = true; paint();
      const files = [...inp.files].filter(f => /\.(sav|dsv|bin)$/i.test(f.name) && f.size >= SIZE && f.size <= 0x100000);
      const out = [];
      for (const f of files.slice(0, 200)) { const r = foundSave(new Uint8Array(await f.arrayBuffer()), f.name, f.webkitRelativePath || f.name, f.lastModified); if (r) out.push(r); }
      F.searched = inp.files.length ? [(inp.files[0].webkitRelativePath || '').split('/')[0] || 'the folder'] : [];
      F.busy = false; F.results = out.sort((a, b) => b.modified - a.modified);
      out.length ? sfx.bell() : sfx.cancel();
      paint();
    };
    inp.click();
  }
  function sdCard() {
    const connected = S.info && S.phase === 'ready' && S.info.card.writable;
    const rows = (F.results || []).map(r => h('div', { class: 'bk-row' },
      h('span', { class: 'bk-em' }, r.s ? '🏡' : '⚠️'),
      h('div', { class: 'bk-main' },
        h('b', null, r.s ? r.s.str(4, 8) : r.japanese ? 'A Japanese or Korean save' : 'A save Leaflet can’t read'),
        h('div', { class: 'muted' }, r.s ? `${residents(r.s).join(', ') || 'No residents'} · ${r.s.region} · saved ${new Date(r.modified).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'Only USA and European saves are supported.'),
        h('div', { class: 'muted', style: { fontSize: '11px' } }, r.where)),
      r.s ? h('div', { class: 'bk-btns' },
        h('button', { class: 'btn small', onclick: () => { APP.openBytes(new Uint8Array(r.bytes), `${r.s.str(4, 8)} (${r.name})`); } }, 'Open'),
        h('button', { class: 'btn small', onclick: async () => { if (window.Backups) { const rec = await Backups.add(r.bytes, 'manual', { file: r.name }); toast(rec ? 'Backed up' : 'Already in Backups', '📌'); } } }, 'Back up'),
        connected ? h('button', { class: 'btn small leaf', onclick: () => { S.file = r.s; S.fileName = `${r.name} from the SD card`; S.emuStart = null; startReview(1, 'ds'); } }, 'Send to game card') : null) : null));
    return [section('🔎 Saves on an SD card', 'R4 and other flashcarts, or your 3DS’s SD card'), h('div', { class: 'card' + (rows.length ? ' bk-list' : ' pad') },
      F.results && !rows.length && native && !F.searched.length ? h('div', { class: 'pad muted', style: { padding: '14px 16px' } }, `No SD card found. Put the card in ${HERE}, or choose a folder.`) : F.results && !rows.length ? h('div', { class: 'pad muted', style: { padding: '14px 16px' } }, `No Wild World saves found${F.searched.length ? ` on ${F.searched.join(', ')}` : ''}. Flashcarts keep the save next to the game, with the same name ending in .sav; TWiLight Menu++ keeps it in a saves folder beside the game.`) : null,
      rows,
      h('div', { style: { padding: rows.length ? '10px 16px' : 0 } },
        !F.results ? h('p', { class: 'muted', style: { margin: '0 0 10px' } }, native ? `Put your flashcart’s microSD card in ${HERE}. Leaflet looks through every SD card and drive you plug in for Wild World saves, so you can open them, back them up or put them on your game card.` : 'Flashcarts such as the R4 keep each game’s save next to it on the microSD card. Choose the card (or a folder on it) and Leaflet finds every Wild World save there.') : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn' + (F.results ? ' small' : ' leaf'), disabled: F.busy, onclick: () => searchSD(false) }, F.busy ? 'Looking…' : native ? (F.results ? 'Look again' : '🔎 Look on SD cards') : '🔎 Choose the SD card…'),
          native ? h('button', { class: 'btn small', disabled: F.busy, onclick: () => searchSD(true) }, 'Choose a folder…') : null),
        native && window.Drives ? h('label', { class: 'muted', style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', fontSize: '12.5px' } },
          h('input', { type: 'checkbox', checked: Drives.enabled, onchange: e => { Drives.setEnabled(e.target.checked); sfx.click(); } }), 'Look through SD cards by itself when they’re put in (saves and your ROM)') : null))];
  }

  // ---------- the 3DS's own SD card (Leaflet Link 1.3) ----------
  // Leaflet Link lists Wild World saves on the 3DS's SD card: its own backups (made before each write, or with X on the
  // console) and the save files of TWiLight Menu++, nds-bootstrap forwarders and other DS loaders.
  const T = { list: null, busy: false, err: '', job: 0, status: null, target: '', msg: '', bad: false };
  const feature = f => !!(S.info && (S.info.features || []).includes(f));
  const IMPORTED_KEY = 'leaflet-link-diary';
  const imported = { get() { try { return new Set(JSON.parse(localStorage.getItem(IMPORTED_KEY)) || []); } catch (e) { return new Set(); } }, set(v) { try { localStorage.setItem(IMPORTED_KEY, JSON.stringify([...v].slice(-400))); } catch (e) { /* private mode */ } } };
  // A time on the 3DS's clock ("2026-10-28 14:03:22"), as a time on this computer.
  function consoleTime(text) {
    const w = GC && GC.parseWall(text); if (w == null) return null;
    const d = new Date(w - (S.dsDelta || 0) * 1000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
  }
  const showTime = t => t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'date unknown';
  const fileName = p => p.split('/').pop();
  // Leaflet Link names each backup for why it was made.
  const backupWhy = p => /before restoring/.test(p) ? 'Leaflet Link backup, kept before a save was put back' : /before Leaflet/.test(p) ? 'Leaflet Link backup, kept before Leaflet saved over it' : 'Leaflet Link backup, made on the 3DS';

  // Reads one save from the 3DS's SD card, checked against its CRC like the game card (three tries).
  async function pullSD(path) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 700));
      const r = await call(`/sd/file?path=${encodeURIComponent(path)}`, {}, 60000);
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `The 3DS answered ${r.status}.`); }
      let b; try { b = new Uint8Array(await r.arrayBuffer()); } catch (e) { continue; }
      if (b.length === SIZE && r.headers.get('X-Leaflet-CRC32') === hex8(crc32(b))) return b;
    }
    throw new Error('The save didn’t arrive intact, three times in a row. Move the 3DS closer to your router and try again.');
  }
  let listing = null;
  // full: the whole SD card. Leaflet Link 2.0 otherwise looks only in the folders where it found saves before (quick).
  function listSD(quiet, full) {
    if (!feature('sd')) return Promise.resolve();
    if (listing) return listing;   // one look at a time
    T.busy = true; T.err = ''; if (!quiet) paint();
    // A busy 3DS (say, waiting for A) keeps the list it had.
    // Leaflet Link 1.3.1 looks through the SD card a slice at a time and says "scanning" until it's done.
    listing = (async () => {
      let j = await json(full ? '/sd?full=1' : '/sd?fresh=1', {}, 30000);
      for (let i = 0; j.scanning && i < 300; i++) { await new Promise(r => setTimeout(r, 300)); j = await json('/sd', {}, 30000); }
      T.list = j.saves; T.quick = !!j.quick;
    })().catch(e => { if (!T.list) T.err = e.message; }).then(() => { T.busy = false; listing = null; paint(); });
    return listing;
  }
  // The Town Diary: versions of the town the 3DS kept on its SD card (Leaflet Link's backups, and TWiLight Menu++ saves)
  // join Backups with the time they were made, so the diary tells what happened on the real console too.
  async function diaryFromSD() {
    if (!window.Backups || !feature('sd')) return;
    await listSD(true);
    // The whole backlog, oldest first; it stops when you start something else and carries on next time.
    const seen = imported.get(), todo = (T.list || []).filter(x => x.ok && !seen.has(`${x.path}|${x.size}|${x.saved}`)).reverse();
    let added = 0;
    for (const x of todo) {
      if (S.phase !== 'ready') break;
      try {
        const b = await pullSD(x.path);
        if (await Backups.add(b, x.kind === 'backup' ? 'cartridge' : 'game', { when: consoleTime(x.saved) || Date.now(), file: x.path, history: true })) added++;
        seen.add(`${x.path}|${x.size}|${x.saved}`); imported.set(seen);
      } catch (e) { break; }   // try again next time
    }
    if (added) toast(`${added} version${added === 1 ? '' : 's'} from your 3DS joined the Town Diary`, '📔');
  }

  async function openSD(x) {
    try {
      const b = await pullSD(x.path), s = parse(b);
      if (!s) throw new Error('Leaflet can’t read that save.');
      if (APP.save && APP.save.dirty) {
        if (!await confirmSheet('Open this town?', `${APP.save.str(4, 8)} has unsaved edits. They’re kept in Backups as unsaved edits, so you can get them back.`, 'Open it')) return;
        if (window.Backups) await Backups.add(APP.save.export(), 'draft', { file: APP.save.fileName });
      }
      await APP.openBytes(b, `${s.str(4, 8)} (${fileName(x.path)}).sav`);
    } catch (e) { T.err = e.message; sfx.error(); paint(); }
  }
  async function cardFromSD(x) {
    try { const b = await pullSD(x.path), s = parse(b); if (!s) throw new Error('Leaflet can’t read that save.'); S.file = s; S.fileName = `${fileName(x.path)} from the 3DS’s SD card`; S.emuStart = null; startReview(1, 'ds'); }
    catch (e) { T.err = e.message; sfx.error(); paint(); }
  }
  // Puts the town open in Leaflet into a game's save file on the 3DS's SD card (TWiLight Menu++ and forwarders).
  async function sendToSD(x) {
    const s = APP.save; if (!s) return;
    T.err = T.msg = ''; T.bad = false;
    try {
      const out = s.export().slice(0, SIZE), o = new WWSave(out, 'out.sav');
      if (o.region !== x.region) throw new Error(`That save file is from the ${x.region} version of the game, and ${o.str(4, 8)} is from the ${o.region} one. They can’t read each other’s saves.`);
      const now = await pullSD(x.path), was = parse(now);
      if (same(now, out)) { T.msg = `${fileName(x.path)} already holds exactly this save.`; sfx.pop(); paint(); return; }
      const lines = was && townKey(was) === townKey(o) && window.WW_DIARY ? WW_DIARY.diff(was, o) : [];
      const what = was && townKey(was) !== townKey(o) ? `It replaces ${was.str(4, 8)} in that file.` : lines.length ? `${lines.length} change${lines.length === 1 ? '' : 's'}, such as: ${lines.slice(0, 3).map(l => l[1]).join(' ')}` : 'Small changes the town diary doesn’t describe.';
      if (!await confirmSheet(`Save ${o.str(4, 8)} to ${fileName(x.path)}?`, `${what} The 3DS keeps a copy of the old file in its backups first, and you confirm there with A.`, 'Send')) return;
      if (window.Backups && was) await Backups.add(now, 'game', { file: x.path, when: consoleTime(x.saved) || Date.now(), history: true });
      T.job = (Math.random() * 1e9) >>> 0; T.target = x.path;
      const q = new URLSearchParams({ path: x.path, crc: hex8(crc32(out)), town: o.str(4, 8), residents: residents(o).join(', '), job: T.job });
      T.status = await json(`/sd/file?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: out }, 60000);
      paint();
      let misses = 0;
      while (!['done', 'failed', 'idle'].includes(T.status.state)) {
        await new Promise(r => setTimeout(r, 400));
        let st;
        try { st = await json('/status', {}, 5000); misses = 0; } catch (e) { if (++misses > 20) throw new Error('Lost touch with the 3DS. Look at its screen: it says whether the save finished.'); continue; }
        if (st.job !== T.job) throw new Error('The 3DS moved on to something else. Check its screen.');
        const moved = st.state !== T.status.state;
        T.status = st; if (moved) paint();
      }
      const st = T.status; T.status = null;
      if (st.state === 'idle') { T.msg = 'Cancelled on the 3DS. Nothing changed.'; sfx.cancel(); }
      else if (st.state === 'done') {
        const back = await pullSD(x.path).catch(() => null);
        if (back && !same(back, out)) throw new Error('The 3DS saved it, but reading the file back from here found a difference. The old file is in Leaflet Link’s backups; try again.');
        if (window.Backups) await Backups.add(out, 'sent', { file: x.path });
        T.msg = `${st.message}${back ? ' Leaflet read it back too: identical.' : ''}`; sfx.save(); UI.confetti();
      } else { T.msg = st.message; T.bad = true; sfx.error(); }
      listSD(true);
    } catch (e) { T.status = null; T.msg = e.message; T.bad = true; sfx.error(); }
    paint();
  }

  function consoleSDCard() {
    if (!feature('sd')) return [];
    if (!T.list && !T.busy && !T.err) listSD(true);
    const writable = S.info && S.phase === 'ready' && S.info.card.writable;
    const st = T.status;
    if (st) return [section('📀 On your 3DS’s SD card'), h('div', { class: 'card pad sync-update' }, h('span', { class: 'sync-spin' }),
      h('b', null, st.state === 'confirm' ? `Press A on your 3DS to save into ${fileName(T.target)}.` : st.state === 'backup' ? 'Keeping a copy of the old file…' : 'Saving to the SD card…'),
      h('span', { class: 'spacer' }), st.state === 'confirm' ? h('button', { class: 'btn small', onclick: cancelOnLeaflet }, 'Cancel') : null)];
    const rows = (T.list || []).map(x => h('div', { class: 'bk-row' },
      h('span', { class: 'bk-em' }, !x.ok ? '⚠️' : x.kind === 'backup' ? '🛟' : '🎮'),
      h('div', { class: 'bk-main' },
        h('b', null, x.ok ? x.town : `${x.town} (damaged)`),
        h('div', { class: 'muted' }, `${x.residents || 'No residents'} · ${x.region} · ${x.kind === 'backup' ? 'backed up' : 'saved'} ${showTime(consoleTime(x.saved))}`),
        h('div', { class: 'muted', style: { fontSize: '11px' } }, x.kind === 'backup' ? backupWhy(x.path) : `${fileName(x.path)} · ${x.path.replace(/\/[^/]*$/, '') || '/'}`)),
      x.ok ? h('div', { class: 'bk-btns' },
        h('button', { class: 'btn small', onclick: () => openSD(x) }, 'Open'),
        writable ? h('button', { class: 'btn small leaf', title: 'Put this town on the game card', onclick: () => cardFromSD(x) }, 'To game card') : null,
        x.kind === 'game' && APP.save ? h('button', { class: 'btn small', title: `Save ${APP.save.str(4, 8)} (open in Leaflet) into this file`, onclick: () => sendToSD(x) }, `Save ${APP.save.str(4, 8)} here`) : null) : null));
    return [section('📀 On your 3DS’s SD card', 'Leaflet Link backups · TWiLight Menu++ and forwarder saves'), h('div', { class: 'card' + (rows.length ? ' bk-list' : ' pad') },
      T.list && !rows.length ? h('div', { class: 'muted', style: { padding: '0 0 10px' } }, 'No Wild World saves on the 3DS’s SD card yet. Press X in Leaflet Link to back up the game card, or play Wild World through TWiLight Menu++ and its save shows up here.') : null,
      rows,
      T.err || T.msg ? h('div', { class: 'sync-msg ' + (T.err || T.bad ? 'bad' : 'ok'), style: { margin: rows.length ? '10px 16px' : '0 0 10px' } }, T.err || T.msg) : null,
      h('div', { style: { padding: rows.length ? '10px 16px' : 0 } }, h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', disabled: T.busy, onclick: () => { T.msg = ''; listSD(); } }, T.busy ? 'Looking…' : 'Look again'),
        T.quick && feature('sdfull') ? h('button', { class: 'btn small', disabled: T.busy, title: 'Leaflet Link looked only in the folders where it found saves before. This looks through the whole SD card.', onclick: () => { T.msg = ''; listSD(false, true); } }, 'Look everywhere') : null,
        h('span', { class: 'fine' }, T.quick ? 'Looked in the usual folders. Versions found here also join the Town Diary.' : 'Versions found here also join the Town Diary.'))))];
  }

  // ---------- game card health check (Leaflet Link 1.3) ----------
  const HC = { status: null, job: false };
  async function checkCard() {
    HC.job = true; HC.status = { state: 'checking', progress: 0 }; sfx.click(); paint();
    try {
      let st = await json('/health', { method: 'POST' }, 8000);
      while (st.state === 'checking') {
        HC.status = st; paint();
        await new Promise(r => setTimeout(r, 400));
        st = await json('/status', {}, 5000);
      }
      HC.status = st;
      if (st.state === 'done' && !st.caution) sfx.save(); else if (st.state === 'idle') sfx.cancel(); else sfx.bell();
    } catch (e) { HC.status = { state: 'failed', title: 'Couldn’t check the game card', message: e.message }; sfx.error(); }
    HC.job = false; paint();
  }
  function healthCard() {
    const st = HC.status;
    if (!st) return null;
    if (st.state === 'checking') return h('div', { class: 'card pad sync-progress' },
      h('h3', null, '🩺 Checking the game card'), h('p', { class: 'muted' }, 'Reading the save chip six times and comparing every byte. Nothing is written.'),
      h('div', { class: 'sync-bar' }, h('span', { style: { width: `${Math.round((st.progress || 0) * 100)}%` } })),
      h('div', { class: 'btn-row', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: cancelOnLeaflet }, 'Stop')));
    const hl = st.health, good = st.state === 'done' && !st.caution;
    return h('div', { class: 'card pad sync-result ' + (good ? 'good' : st.state === 'done' ? 'safe' : 'bad') },
      h('div', { class: 'big' }, good ? '🩺' : st.state === 'done' ? '🧽' : '⚠️'),
      h('h3', null, st.state === 'idle' ? 'Check stopped' : st.title), h('p', null, st.state === 'idle' ? 'Nothing was changed.' : st.message),
      hl && st.state === 'done' ? h('ul', { class: 'sync-checks' },
        h('li', null, `${hl.unstable ? '•' : '✓'} Read ${hl.passes} times${hl.ms >= 500 ? ` in ${(hl.ms / 1000).toFixed(1)} s` : ''}: ${hl.unstable ? `${hl.unstable} of 64 areas changed between reads` : 'identical every time'}`),
        h('li', null, `${hl.idStable ? '✓' : '•'} The save chip ${hl.idStable ? 'gave the same ID every time' : 'gave different IDs'}`),
        h('li', null, hl.blank ? '✓ No town saved on it yet' : hl.check ? `• ${hl.checkWhy}` : '✓ Both copies of the town and the town hall letters pass their checksums')) : null,
      h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '10px' } },
        h('button', { class: 'btn leaf', onclick: () => { HC.status = null; sfx.click(); paint(); } }, 'Done'),
        st.state === 'done' && st.caution && hl && hl.unstable ? h('button', { class: 'btn', onclick: checkCard }, 'Check again') : null));
  }

  function disconnect() { clearInterval(infoTimer); Object.assign(S, { phase: 'off', info: null, cart: null, err: '', status: null }); Object.assign(T, { list: null, err: '', msg: '' }); HC.status = null; sfx.close(); paint(); }
  // Notices the card going in or out while connected.
  function watchInfo() {
    clearInterval(infoTimer);
    infoTimer = setInterval(async () => {
      if (!root || !root.isConnected) { clearInterval(infoTimer); return; }
      if (S.phase === 'sending' || S.reading || HC.job || T.status) return;
      try {
        const j = await json('/info', {}, 5000);
        const was = S.info && S.info.card;
        S.info = j; noteClock(j);
        if (!j.card.ready) { if (S.cart) { S.cart = null; paint(); } else if (!was || was.ready !== j.card.ready || was.why !== j.card.why) paint(); }
        else if (!was || !was.ready || was.code !== j.card.code) { paint(); readCart(); }
      } catch (e) { S.info = null; S.phase = 'off'; S.err = 'Lost the connection to the 3DS.'; clearInterval(infoTimer); paint(); }
    }, 3000);
  }

  // Reads the game card's save and checks it against the CRC the 3DS computed. Reading changes nothing, so a read
  // that's cut off or damaged on the way is simply tried again (three times in all).
  async function pull() {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 700));
      const r = await call('/save', {}, 60000);
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `The 3DS answered ${r.status}.`); }
      let b;
      try { b = new Uint8Array(await r.arrayBuffer()); } catch (e) { last = 'stopped arriving part-way through'; continue; }
      if (b.length !== SIZE) { last = 'arrived incomplete'; continue; }
      if (r.headers.get('X-Leaflet-CRC32') !== hex8(crc32(b))) { last = 'was damaged on its way over Wi-Fi'; continue; }
      return b;
    }
    const old = S.info && APPB && newer(APPB.version, S.info.version);
    throw new Error(`The save ${last}, three times in a row. ${old ? 'Update Leaflet Link (the button above) — this version can cut saves off — then try again.' : 'Move the 3DS closer to your router and try again.'}`);
  }
  async function readCart() {
    S.reading = true; S.err = ''; paint();
    try {
      const b = await pull(); S.cart = { bytes: b, save: parse(b), blank: blank(b) }; S.cartAt = Date.now();
      // Every read is a page of the Town Diary (an unchanged card adds nothing).
      if (window.Backups && S.cart.save) Backups.add(b, 'cartridge');
    } catch (e) { S.err = e.message; sfx.error(); }
    S.reading = false; paint();
  }

  // ---------- actions ----------
  async function openInLeaflet() {
    const c = S.cart;
    if (!c || !c.save) return;
    if (APP.save && APP.save.dirty) {
      if (!await confirmSheet('Open the game card’s town?', `${APP.save.str(4, 8)} has unsaved edits. They’re kept in Backups as unsaved edits, so you can get them back.`, 'Open it')) return;
      if (window.Backups) await Backups.add(APP.save.export(), 'draft', { file: APP.save.fileName });
    }
    if (window.Backups) await Backups.add(c.bytes, 'cartridge');
    await APP.openBytes(new Uint8Array(c.bytes), `${c.save.str(4, 8)} (from game card).sav`);
  }
  function forEmulator() {
    const c = S.cart; if (!c) return;
    if (window.Backups && c.save) Backups.add(c.bytes, 'cartridge');
    const out = c.save ? toEmulator(c.bytes) : { bytes: c.bytes, seconds: 0 };
    download(`Animal Crossing - Wild World${c.save ? ` (${c.save.str(4, 8)})` : ''}.sav`, out.bytes);
    if (out.seconds) toast(`Town clock moved ${GC.span(out.seconds)} to suit this computer’s clock`, '🕰');
    toast('Saved for your emulator', '💾');
  }
  function startReview(src, playedOn) { if (src !== 1) S.emuStart = null; S.phase = 'review'; S.src = src === 1 ? 1 : APP.save ? 0 : 1; S.playedOn = playedOn || (S.src === 1 ? 'emu' : 'ds'); S.replaceOk = S.changedOk = false; S.err = S.note = ''; sfx.open(); paint(); readCart(); }
  async function pickFile() {
    const inp = h('input', { type: 'file', accept: '.sav,.dsv,.bin' });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const b = new Uint8Array(await f.arrayBuffer());
      const s = parse(b);
      if (!s) { S.file = null; S.err = `${f.name} isn’t a Wild World save Leaflet can read.`; sfx.error(); paint(); return; }
      S.file = s; S.fileName = f.name; S.err = ''; S.replaceOk = false; S.emuStart = null; sfx.pop(); paint();
    };
    inp.click();
  }
  // What would be sent: always exactly 256 KB with fresh checksums (an emulator's footer is left off).
  function outgoing() {
    const s = S.src === 0 ? APP.save : S.file;
    if (!s) return null;
    const shifted = S.playedOn === 'emu' ? fromEmulator(s.export().slice(0, SIZE)) : { bytes: s.export().slice(0, SIZE), seconds: 0 };
    const bytes = shifted.bytes;
    return { s: new WWSave(bytes, 'out.sav'), bytes, clock: shifted.seconds, label: S.src === 0 ? `${s.str(4, 8)}, open in Leaflet${s.dirty ? ' (with your unsaved edits)' : ''}` : S.fileName };
  }

  async function send() {
    const out = outgoing(), c = S.cart;
    if (!out || !c) return;
    S.phase = 'sending'; S.err = S.note = ''; S.status = { state: 'sending', title: 'Sending to your 3DS…', message: '' }; S.sent = out.bytes; S.after = '';
    paint();
    try {
      if (window.Backups && c.save) await Backups.add(c.bytes, 'cartridge');
      // The cartridge must still hold what was reviewed.
      const now = await pull();
      if (!same(now, c.bytes)) { S.cart = { bytes: now, save: parse(now), blank: blank(now) }; throw new Error('The cartridge changed since you reviewed it (was the game saved?). Check the changes again before sending.'); }
      S.job = (Math.random() * 1e9) >>> 0;
      const q = new URLSearchParams({ crc: hex8(crc32(out.bytes)), town: out.s.str(4, 8), residents: residents(out.s).join(', '), job: S.job });
      S.status = await json(`/save?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: out.bytes }, 60000);
      sfx.open(); paint();
      await follow();
    } catch (e) { S.phase = 'review'; fail(e); }
  }
  async function follow() {
    let misses = 0;
    for (;;) {
      await new Promise(r => setTimeout(r, 350));
      let st;
      try { st = await json('/status', {}, 5000); misses = 0; } catch (e) { if (++misses < 20) continue; throw new Error('Lost touch with the 3DS while it was saving. Look at the 3DS screen: it says whether the save finished.'); }
      if (st.job !== S.job) throw new Error('The 3DS moved on to something else. Check its screen.');
      const changed = !S.status || st.state !== S.status.state;
      S.status = st;
      if (changed || st.state === 'writing') paint();
      if (st.state === 'idle') { S.phase = 'review'; S.note = st.message; sfx.cancel(); paint(); return; }
      if (st.state === 'done' || st.state === 'failed') break;
    }
    S.phase = 'result';
    if (S.status.state === 'done') {
      if (window.Backups) await Backups.add(S.sent, 'sent');
      if (native && S.emuStart && E.session) { native.postMessage({ cmd: 'emuClose' }); E.phase = ''; E.session = null; S.emuStart = null; }
      // Leaflet's own check, over Wi-Fi.
      try { const b = await pull(); S.cart = { bytes: b, save: parse(b), blank: blank(b) }; S.cartAt = Date.now(); S.after = same(b, S.sent) ? 'yes' : 'no'; }
      catch (e) { S.after = 'unknown'; }
      if (S.after !== 'no') { sfx.save(); UI.confetti(); say(`${S.status.town} is safe on your cartridge!`); }
      else sfx.error();
    } else {
      sfx.error();
      try { const b = await pull(); S.cart = { bytes: b, save: parse(b), blank: blank(b) }; S.cartAt = Date.now(); } catch (e) { /* the 3DS's own message says enough */ }
    }
    paint();
  }
  async function cancelOnLeaflet() { try { await json('/cancel', { method: 'POST' }); } catch (e) { /* the 3DS shows its own state */ } }

  // ---------- drawing ----------
  function hero() {
    const on = S.phase !== 'off' && S.phase !== 'connecting';
    return h('div', { class: 'hero sync-hero' },
      h('h2', null, 'Cartridge Sync'),
      h('p', null, 'Move your town between your Wild World game card and Leaflet over Wi-Fi.'),
      h('div', { class: 'sync-link' + (on ? ' on' : '') },
        h('span', { class: 'node' }, h('b', null, '🎮'), h('i', null, 'Game card')),
        h('span', { class: 'wire' }, h('span'), h('span'), h('span')),
        h('span', { class: 'node' }, h('b', null, PHONE ? '📱' : '🍃'), h('i', null, PHONE ? 'This phone' : 'Leaflet')),
        PHONE ? null : h('span', { class: 'wire' }, h('span'), h('span'), h('span')),
        PHONE ? null : h('span', { class: 'node' }, h('b', null, '🖥️'), h('i', null, 'Emulator'))));
  }
  function errBox() { return S.err ? h('div', { class: 'sync-msg bad' }, '⚠️ ', S.err) : S.note ? h('div', { class: 'sync-msg' }, '↩️ ', S.note) : null; }

  // ---------- finding Leaflet Link on the network (Mac app and Windows: Leaflet Link 1.3.1 answers a broadcast) ----------
  // auto: looked for by itself (no address yet, or the old one stopped answering), so finding nothing stays quiet.
  let findAuto = false;
  function findLink(auto) {
    if (!native || S.finding) return;
    findAuto = !!auto; S.finding = true; S.err = ''; if (!auto) sfx.click(); paint();
    native.postMessage({ cmd: 'findLink' });
  }
  window.LeafletLinkFound = info => {
    S.finding = false;
    const found = (info.found || []).slice().sort((a, b) => (b.card ? 1 : 0) - (a.card ? 1 : 0));   // a 3DS with a game card in first
    if (found.length) { S.addr = found[0].address; paint(); connect(); return; }
    if (!findAuto) { S.err = 'No 3DS answered. Check Leaflet Link is open and the 3DS is on the same Wi-Fi, or type the address it shows. (Leaflet Link 1.3 and earlier don’t answer; type the address once and update it.)'; sfx.error(); }
    paint();
  };

  function connectCard() {
    const inp = h('input', { class: 'field sync-addr', placeholder: '192.168.1.23', value: S.addr, inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' });
    inp.oninput = () => { S.addr = inp.value; };
    inp.onkeydown = e => { if (e.key === 'Enter') connect(); };
    const busy = S.phase === 'connecting';
    return h('div', { class: 'card pad sync-connect' },
      h('ol', { class: 'sync-steps' },
        h('li', null, h('b', null, 'Insert your Wild World game card, '), 'then open Leaflet Link from the Homebrew Launcher.'),
        FROM_LINK ? h('li', null, h('b', null, 'Keep Leaflet Link open. '), 'This page came from your 3DS, so it connects by itself.')
          : PHONE ? h('li', null, h('b', null, 'Scan the QR code on the 3DS’s lower screen '), 'with this phone’s camera, or type the address it shows. Both need to be on the same Wi-Fi.')
          : native ? h('li', null, h('b', null, 'Click Find my 3DS, '), 'or type the address the 3DS shows. Both need to be on the same Wi-Fi.')
          : h('li', null, h('b', null, 'Type the address the 3DS shows. '), 'Both need to be on the same Wi-Fi.')),
      h('div', { class: 'sync-row' },
        native ? h('button', { class: 'btn leaf big', disabled: busy || S.finding, onclick: () => findLink(false) }, S.finding ? 'Looking for your 3DS…' : '🔎 Find my 3DS') : null,
        inp,
        h('button', { class: 'btn big' + (native ? '' : ' leaf'), disabled: busy || S.finding, onclick: () => connect() }, busy ? 'Connecting…' : 'Connect')),
      errBox());
  }

  function installCard() {
    if (!APPB) return [];
    if (installedBefore() && !I.open && !I.state) return [h('div', { class: 'sync-install-mini' }, 'Leaflet Link isn’t on this 3DS yet? ', h('button', { class: 'btn small', onclick: () => { I.open = true; sfx.open(); paint(); } }, 'Install it'))];
    const fine = h('div', { class: 'fine' }, 'Needs a 3DS that can run homebrew. Leaflet Link is saved in the SD card’s ', h('code', null, '3ds'), ' folder, so after this you just open it from the Homebrew Launcher.');
    let parts;
    if (native) {
      const busy = I.state === 'searching' || I.state === 'sending';
      const manual = h('input', { class: 'field sync-addr small', placeholder: 'Address (optional)', value: I.manual, inputmode: 'decimal', spellcheck: 'false' });
      manual.oninput = () => { I.manual = manual.value; };
      manual.onkeydown = e => { if (e.key === 'Enter' && !busy) sendToLauncher(); };
      const msg = I.state === 'notFound' ? h('div', { class: 'sync-msg bad' }, '🔎 No 3DS answered. Check the Homebrew Launcher says it’s waiting (press Y), and that both are on the same Wi-Fi. Or type the address it shows, then send again.')
        : I.state === 'error' ? h('div', { class: 'sync-msg bad' }, '⚠️ ', I.error)
        : I.state === 'done' ? h('div', { class: 'sync-msg ok' }, '✅ Installed! Leaflet Link is starting on your 3DS.') : null;
      parts = [
        h('ol', { class: 'sync-steps' },
          h('li', null, h('b', null, 'On your 3DS, open the Homebrew Launcher and press Y. '), 'It says it’s waiting for a connection.'),
          h('li', null, h('b', null, 'Click Send to my 3DS. '), 'Leaflet finds it, installs Leaflet Link and starts it, then connects.')),
        h('div', { class: 'sync-row' },
          h('button', { class: 'btn leaf big', disabled: busy, onclick: sendToLauncher }, I.state === 'searching' ? 'Looking for your 3DS…' : I.state === 'sending' ? `Sending… ${Math.round(I.progress * 100)}%` : '📡 Send to my 3DS'),
          manual),
        I.state === 'sending' ? h('div', { class: 'sync-bar', style: { marginTop: '10px' } }, h('span', { style: { width: `${Math.round(I.progress * 100)}%` } })) : null,
        msg, fine];
    } else if (onWindows) {
      parts = [
        h('ol', { class: 'sync-steps' },
          h('li', null, h('b', null, 'Double-click Install Leaflet Link '), 'in your Leaflet folder, next to Start Leaflet.'),
          h('li', null, h('b', null, 'On your 3DS, open the Homebrew Launcher and press Y, '), 'then press Enter in the installer. It finds the 3DS and installs Leaflet Link, which starts by itself.')),
        h('div', { class: 'fine' }, 'No installer in your folder? ', h('a', { href: '#', onclick: e => { e.preventDefault(); downloadApp(); } }, 'Download LeafletLink.3dsx'), ' and copy it into the SD card’s ', h('code', null, '3ds'), ' folder.'),
        fine];
    } else {
      parts = [
        h('p', { style: { margin: '0 0 10px' } }, 'Copy Leaflet Link into the ', h('code', null, '3ds'), ' folder on your SD card. The Leaflet app for Mac installs it over Wi-Fi with one click, and the Windows download has an installer that does the same.'),
        h('div', { class: 'sync-row' }, h('button', { class: 'btn leaf', onclick: downloadApp }, `⬇︎ Download LeafletLink.3dsx (${APPB.version})`)),
        fine];
    }
    return [section('Install Leaflet Link on your 3DS', 'Only needed once'), h('div', { class: 'card pad sync-install' }, parts)];
  }

  function updateCard() {
    if (!APPB || !S.info || (!U.state && !newer(APPB.version, S.info.version))) return null;
    const busy = { sending: 'Sending the update…', confirm: 'Press A on your 3DS to update Leaflet Link.', updating: 'Installing the update…' }[U.state];
    if (busy) return h('div', { class: 'card pad sync-update' }, h('span', { class: 'sync-spin' }), h('b', null, busy));
    if (U.state === 'restart') return h('div', { class: 'card pad sync-update' }, h('span', { class: 'sync-spin' }), h('div', null, h('b', null, 'Updated! '), 'Press A on the 3DS to close the old version, then open Leaflet Link again from the Homebrew Launcher. Leaflet reconnects by itself.'));
    return h('div', { class: 'card pad sync-update' + (U.state === 'failed' ? ' bad' : '') },
      h('div', null, U.state === 'failed' ? ['⚠️ ', U.message, ' The old version is still installed.'] : [h('b', null, `Leaflet Link ${APPB.version} is ready. `), `This 3DS has ${S.info.version}. The update goes over Wi-Fi; you confirm it on the 3DS.`]),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn leaf', onclick: updateLink }, U.state === 'failed' ? 'Try again' : 'Update over Wi-Fi'));
  }

  // Leaflet on a phone: Leaflet Link 1.4 serves Leaflet itself, so a phone on the same Wi-Fi scans this and opens it
  // from the 3DS (a page from the internet isn't allowed to talk to the 3DS; one the 3DS serves is).
  let showPhone = false;
  function phoneCard() {
    if (PHONE || !feature('web')) return null;
    const url = `${base(S.addr)}/`;
    if (!showPhone) return h('div', { class: 'sync-install-mini' }, 'Want Leaflet on your phone or tablet too? ', h('button', { class: 'btn small', onclick: () => { showPhone = true; sfx.open(); paint(); } }, '📱 Show a QR code'));
    const code = window.QR && QR.svg(url, `QR code for ${url}`);
    return h('div', { class: 'card pad sync-phone' },
      code ? h('div', { class: 'sync-qr' }, code) : null,
      h('div', null, h('b', null, '📱 Leaflet on your phone'),
        h('p', { class: 'muted', style: { margin: '6px 0' } }, 'Point your phone’s camera at the code (or at the one on the 3DS’s lower screen), or type this address in its browser:'),
        h('code', { class: 'sync-url' }, url),
        h('p', { class: 'fine' }, 'Leaflet comes straight from Leaflet Link on your 3DS, so both need to be on the same Wi-Fi and Leaflet Link needs to stay open. Your phone keeps its own backups.'),
        h('button', { class: 'btn small', onclick: () => { showPhone = false; paint(); } }, 'Hide')));
  }

  function statusCard() {
    const c = S.info.card, p = S.info.power;
    const dot = ok => h('span', { class: 'sync-dot' + (ok ? ' ok' : ok === null ? ' wait' : '') });
    return h('div', { class: 'card pad sync-status' },
      h('div', { class: 'sync-line' }, dot(true), h('span', null, h('b', null, 'Connected'), ` to Leaflet Link ${S.info.version} at ${S.addr.trim()}`), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: disconnect }, 'Disconnect')),
      h('div', { class: 'sync-line' }, dot(c.ready && c.writable), h('span', null, c.ready ? h('b', null, `Animal Crossing: Wild World (${c.code})`) : h('b', null, c.present ? 'Game card not ready' : 'No game card'), c.ready ? (c.writable ? ', save chip ready' : `: ${c.why}`) : ` · ${c.why}`),
        h('span', { class: 'spacer' }), feature('health') && c.ready && c.writable && S.phase === 'ready' ? h('button', { class: 'btn small', disabled: HC.job || S.reading, title: 'Reads the save chip six times to make sure it reads the same every time. Nothing is written.', onclick: checkCard }, '🩺 Check the card') : null),
      p && !p.ok ? h('div', { class: 'sync-line' }, dot(false), h('span', null, h('b', null, 'Battery low. '), 'Plug in the 3DS before saving to the cartridge.')) : null,
      S.dsDelta != null && Math.abs(S.dsDelta) >= 60 ? h('div', { class: 'sync-line' }, h('span', { class: 'sync-dot ok' }), h('span', null, h('b', null, '🕰 3DS clock: '), `${GC.span(S.dsDelta)} ${S.dsDelta > 0 ? 'ahead of' : 'behind'} this computer. Leaflet keeps your town’s time in step when it moves, so turnips don’t spoil.`)) : null);
  }

  function townSummary(s, b) {
    if (!s) return h('div', { class: 'muted' }, b && blank(b) ? 'No town yet: this game card has never been saved.' : 'The save on this card isn’t one Leaflet can read (it may be damaged).');
    const r = residents(s);
    return h('div', { class: 'sync-town' },
      h('div', { class: 'nm' }, `🏡 ${s.str(4, 8)}`),
      h('div', { class: 'muted' }, `${r.length ? r.join(', ') : 'No residents yet'} · ${s.region}`));
  }

  function cartCard() {
    const c = S.cart;
    if (S.reading && !c) return h('div', { class: 'card pad sync-reading' }, h('span', { class: 'sync-spin' }), 'Reading your game card…');
    if (!c) return S.info.card.ready ? h('div', { class: 'card pad' }, h('button', { class: 'btn leaf', onclick: readCart }, 'Read the game card')) : null;
    const tile = (em, title, desc, onclick, dis) => h('button', { class: 'sync-tile', disabled: !!dis || HC.job, onclick }, h('span', { class: 'em' }, em), h('b', null, title), h('span', null, desc));
    return [
      section('On your game card', S.reading ? 'Reading…' : `Read at ${new Date(S.cartAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
      h('div', { class: 'card pad' },
        h('div', { class: 'sync-row' }, townSummary(c.save, c.bytes), h('span', { class: 'spacer' }), h('button', { class: 'btn small', disabled: S.reading || HC.job, onclick: readCart }, 'Read again')),
        h('div', { class: 'sync-tiles' },
          tile('📖', 'Open in Leaflet', 'Edit the town on the card. Save to a file as usual.', openInLeaflet, !c.save),
          native ? tile('🎮', 'Play on melonDS', 'Starts melonDS with this town and brings it back to the card when you’re done.', playOnEmu, !c.save || E.phase === 'playing' || E.phase === 'starting' || (E.phase === 'back' && E.session)) : null,
          PHONE ? tile('💾', 'Save a copy', 'This town as a .sav file, to keep or to play on another system.', forEmulator, !c.save) : tile('💾', 'Save for an emulator', 'A .sav for melonDS, DeSmuME or another emulator.', forEmulator, !c.save),
          tile('📤', 'Send to the game card', PHONE ? 'Put a town from Leaflet back on the card.' : 'Put a town from Leaflet or an emulator back on the card.', () => startReview(), !S.info.card.writable)),
        // Why sending is off. The Sanyo chip (62 16 00) in some Wild World cards needs Leaflet Link 1.3.2 or newer.
        !S.info.card.writable ? h('div', { class: 'sync-msg bad', style: { marginTop: '10px' } }, '⚠️ ',
          S.info.card.chipId === '621600' && newer('1.3.2', S.info.version) ? `Sending is off because Leaflet Link ${S.info.version} doesn’t know this card’s save chip. Update Leaflet Link (above) to 1.3.2 or newer and sending works.`
            : S.info.card.why || 'This card can’t be written right now.') : null),
    ];
  }

  function reviewCard() {
    const c = S.cart, out = outgoing();
    const opts = [[0, APP.save ? `🍃 ${APP.save.str(4, 8)}, open in Leaflet` : '🍃 Town open in Leaflet'], [1, S.emuStart ? '🎮 Your melonDS game' : '📁 A save file…']];
    const src = h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: S.src === v ? 'on' : '', disabled: v === 0 && !APP.save, onclick: () => { S.src = v; S.playedOn = v === 1 ? 'emu' : 'ds'; S.replaceOk = S.changedOk = false; S.err = ''; if (v === 0) S.emuStart = null; sfx.click(); if (v === 1 && !S.file) pickFile(); else paint(); } }, l)));
    const parts = [h('div', { class: 'sync-row' }, h('b', null, 'Send'), src, S.src === 1 && S.file && !S.emuStart ? h('button', { class: 'btn small', onclick: pickFile }, 'Choose another…') : null)];
    let can = !!(out && c && !S.reading), warn = null, list = null, why = '';
    if (S.reading) parts.push(h('div', { class: 'sync-reading' }, h('span', { class: 'sync-spin' }), 'Reading the game card to compare…'));
    else if (!c) why = 'Read the game card first.';
    else if (!out) why = S.src === 0 ? 'Open a town in Leaflet first.' : 'Choose a save file, for example the .sav your emulator wrote.';
    else {
      const was = c.save, n = pages(c.bytes, out.bytes);
      if (was && was.region !== out.s.region) { can = false; warn = h('div', { class: 'sync-msg bad' }, `🚫 The game card is the ${was.region === 'USA' ? 'USA' : 'European'} version, but this save is from the ${out.s.region === 'USA' ? 'USA' : 'European'} version. They can’t read each other’s saves.`); }
      else if (!n) { can = false; warn = h('div', { class: 'sync-msg ok' }, '✅ The game card already has exactly this save. Nothing to send.'); }
      else if (S.src === 1 && S.emuStart && !same(c.bytes, S.emuStart)) {
        const cb = h('input', { type: 'checkbox', checked: S.changedOk });
        cb.onchange = () => { S.changedOk = cb.checked; sfx.toggle(cb.checked); paint(); };
        can = S.changedOk;
        warn = h('div', { class: 'sync-msg bad' }, h('div', null, '⚠️ The game card changed since you started playing on melonDS (was it played on the 3DS too?). Sending replaces what was saved on the card since then. That version is kept in Backups and on the 3DS’s SD card.'),
          h('label', { class: 'sync-check' }, cb, ' Replace it with the melonDS version'));
      }
      else if (was && townKey(was) !== townKey(out.s)) {
        const cb = h('input', { type: 'checkbox', checked: S.replaceOk });
        cb.onchange = () => { S.replaceOk = cb.checked; sfx.toggle(cb.checked); paint(); };
        can = S.replaceOk;
        warn = h('div', { class: 'sync-msg bad' }, h('div', null, `⚠️ The game card has a different town, ${was.str(4, 8)}. Sending replaces it with ${out.s.str(4, 8)}. ${was.str(4, 8)} is kept in Backups and on the 3DS’s SD card.`),
          h('label', { class: 'sync-check' }, cb, ` Replace ${was.str(4, 8)} with ${out.s.str(4, 8)}`));
      }
      if (was && townKey(was) === townKey(out.s) && n) {
        const lines = window.WW_DIARY ? WW_DIARY.diff(was, out.s) : [];
        list = h('div', { class: 'sync-diff' },
          h('div', { class: 'k' }, `What changes on the game card · ${n} of 1,024 pages`),
          lines.length ? h('ul', null, lines.slice(0, 12).map(([em, t]) => h('li', null, h('span', null, em), t)), lines.length > 12 ? h('li', { class: 'muted' }, `…and ${lines.length - 12} more`) : null)
            : h('div', { class: 'muted' }, 'Small changes the town diary doesn’t describe (items, letters, designs or settings).'));
      } else if (!was && n) list = h('div', { class: 'sync-diff' }, h('div', { class: 'k' }, `The game card has ${c.blank ? 'no town yet' : 'a save Leaflet can’t read'}. Sending puts ${out.s.str(4, 8)} on it.`));
      parts.push(h('div', { class: 'sync-compare' },
        h('div', null, h('div', { class: 'k' }, 'Now on the game card'), townSummary(was, c.bytes)),
        h('div', { class: 'arrow' }, '→'),
        h('div', null, h('div', { class: 'k' }, 'After sending'), townSummary(out.s, out.bytes))), warn, list);
    }
    if (out && c && !S.reading) parts.push(clockLine(out));
    if (why) parts.push(h('div', { class: 'muted' }, why));
    parts.push(errBox(),
      h('div', { class: 'sync-row end' },
        h('span', { class: 'fine' }, '🛟 The game card’s current save is kept in Backups and on the 3DS’s SD card first.'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => { S.phase = 'ready'; S.err = ''; sfx.close(); paint(); } }, 'Back'),
        h('button', { class: 'btn leaf big', disabled: !can, onclick: send }, '📤 Send to the game card')));
    return [section('Send to the game card'), h('div', { class: 'card pad sync-review' }, parts)];
  }

  // How the town's clock is kept in step for this send.
  function clockLine(out) {
    if (!GC) return null;
    if (S.dsDelta == null) return h('div', { class: 'sync-clock' }, '🕰 Update Leaflet Link to keep your town’s clock in step: this version doesn’t say what time the 3DS shows.');
    const where = S.emuStart ? h('b', null, `melonDS on ${HERE}`) : (() => {
      const sel = h('select', { class: 'field w-l' }, [['emu', 'an emulator on this computer'], ['ds', 'a DS or 3DS']].map(([v, l]) => h('option', { value: v, selected: S.playedOn === v }, l)));
      sel.onchange = () => { S.playedOn = sel.value; sfx.click(); paint(); };
      return sel;
    })();
    const then = GC.showGameTime(GC.gameTime(out.s, GC.wallNow() + S.dsDelta * 1000));
    const msg = out.clock ? `The 3DS’s clock and ${S.playedOn === 'emu' ? 'the emulator’s' : 'that system’s'} differ by ${GC.span(out.clock)}, so Leaflet moves your town’s clock to match: on the 3DS it’ll be ${then} in the game, just as it was, and your turnips stay fresh.`
      : S.playedOn === 'emu' ? `The 3DS and this computer agree on the time, so your town’s clock carries on as it is (${then} in the game).` : `Your town’s clock is left as it is (${then} in the game on the 3DS).`;
    return h('div', { class: 'sync-clock' }, h('div', { class: 'sync-row' }, h('span', null, '🕰 Last played on'), where), h('div', { class: 'muted', style: { marginTop: '4px' } }, msg));
  }

  const STEPS = [['backup', 'Copy', 'The 3DS keeps the card’s current save on its SD card'], ['writing', 'Save', 'Only the parts that changed are written'], ['verifying', 'Check', 'Every byte is read back and compared']];
  function progressCard() {
    const st = S.status || {};
    if (st.state === 'confirm' || st.state === 'sending') {
      return h('div', { class: 'card pad sync-confirm' },
        h('div', { class: 'sync-ds' }, h('div', { class: 'scr' }, h('b', null, st.town || '…')), h('div', { class: 'scr low' }, h('span', { class: 'a' }, 'A'), ' Save')),
        h('div', null,
          h('h3', null, st.state === 'sending' ? 'Sending to your 3DS…' : 'Press A on your 3DS'),
          h('p', { class: 'muted' }, st.state === 'sending' ? 'The save and its checksum are on their way.' : `The 3DS is showing ${st.town}. Nothing is written until you press A there (or tap Save). Press B to cancel.`),
          st.state === 'confirm' ? h('button', { class: 'btn small', onclick: cancelOnLeaflet }, 'Cancel') : null));
    }
    const at = st.state === 'backup' ? 0 : st.state === 'writing' || st.state === 'restoring' ? 1 : 2;
    const pct = st.state === 'backup' ? 5 : st.state === 'verifying' ? 92 : 8 + 80 * (st.progress || 0);
    return h('div', { class: 'card pad sync-progress' + (st.state === 'restoring' ? ' restoring' : '') },
      h('h3', null, st.title || 'Saving…'),
      h('p', { class: 'muted' }, st.state === 'restoring' ? st.message : 'Keep the 3DS on and the game card in.'),
      h('div', { class: 'sync-stepper' }, STEPS.map(([, name, desc], i) => h('div', { class: 'st' + (i < at ? ' done' : i === at ? ' now' : '') }, h('span', { class: 'b' }, i < at ? '✓' : i + 1), h('b', null, name), h('span', null, desc)))),
      h('div', { class: 'sync-bar' }, h('span', { style: { width: `${pct}%` } })),
      st.state === 'writing' ? h('div', { class: 'fine' }, `${fmt(st.written)} of ${fmt(st.changed)} changed pages`) : null);
  }

  function resultCard() {
    const st = S.status, ok = st.state === 'done', mismatch = S.after === 'no';
    const good = ok && !mismatch;
    return h('div', { class: 'card pad sync-result ' + (good ? 'good' : st.restored ? 'safe' : 'bad') },
      h('div', { class: 'big' }, good ? '✅' : st.restored ? '🛟' : '⚠️'),
      h('h3', null, good ? st.title : mismatch ? 'The game card doesn’t match' : st.title),
      h('p', null, mismatch ? 'The 3DS checked the save, but reading it again from here found a difference. Send it again; the previous save is safe on the SD card and in Backups.' : st.message),
      good ? h('ul', { class: 'sync-checks' },
        h('li', null, '✓ Checked on the 3DS: all 262,144 bytes match'),
        S.after === 'yes' ? h('li', null, '✓ Checked again by Leaflet over Wi-Fi: identical') : h('li', null, 'Leaflet couldn’t read it back over Wi-Fi, but the 3DS’s own check passed.'),
        h('li', null, '✓ The previous save is in Backups and on the 3DS’s SD card')) : null,
      h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '10px' } },
        h('button', { class: 'btn leaf', onclick: () => { S.phase = 'ready'; S.status = null; sfx.click(); paint(); } }, 'Done'),
        !good ? h('button', { class: 'btn', onclick: () => { S.phase = 'review'; S.status = null; paint(); } }, 'Back to sending') : null));
  }

  function body() {
    const out = [hero()];
    if (helperLost && !mac) out.push(h('div', { class: 'callout', style: { marginBottom: '12px' } }, h('span', { class: 'em' }, '⚠️'), h('div', null, h('b', null, 'Leaflet Helper has stopped'), 'Close this window and open Start Leaflet again to use melonDS, SD cards and finding your 3DS. Everything else here still works.')));
    // Phones skip what needs a computer: melonDS, SD card readers and installing Leaflet Link.
    const pc = cards => PHONE ? [] : cards;
    out.push(...pc(emuCard()));
    if (S.phase === 'off' || S.phase === 'connecting' || !S.info) out.push(...pc(installCard()), section('Connect to your 3DS'), connectCard(), ...pc(wfcCard()));
    else {
      out.push(statusCard(), phoneCard(), pc(updateCard()));
      if (S.phase === 'sending') out.push(progressCard());
      else if (S.phase === 'result') out.push(resultCard());
      else if (S.phase === 'review') out.push(...reviewCard());
      else out.push(healthCard(), ...[cartCard()].flat().filter(Boolean), errBox(), ...consoleSDCard(), ...pc(wfcCard()));
    }
    if (!['sending', 'result', 'review'].includes(S.phase)) out.push(...pc(sdCard()));
    out.push(h('div', { class: 'fine sync-fine' }, 'Leaflet Link only reads and writes the save on your own game card. It doesn’t copy the game itself. Writing only happens after you confirm on the 3DS.'));
    return out.filter(Boolean);   // some cards return null when there's nothing to show
  }

  VIEWS.push({
    id: 'sync', group: 'Start', icon: '🎮', noSave: true, title: () => 'Cartridge Sync', sub: () => 'Your game card ⇄ Leaflet ⇄ emulators',
    tips: ['Play on an emulator with prettier graphics: choose Save for an emulator, play, then Send to the game card and pick the emulator’s .sav.', 'Each send is checked three times: by its CRC on arrival, on the 3DS after writing, and by Leaflet reading the card back.'],
    render(s, ctx) {
      root = h('div', { class: 'sync' });
      root.append(...body());
      // The address that worked last time, else a look around the network (it may have a new address).
      if (!ctx.indexing && S.phase === 'off' && (S.addr || native) && !S.err && !S.tried) {
        S.tried = true;
        setTimeout(async () => { const ok = S.addr.trim() ? await connect(true) : false; if (!ok) { if (S.phase === 'connecting') S.phase = 'off'; paint(); findLink(true); } }, 0);
      }
      return root;
    },
  });
})();
