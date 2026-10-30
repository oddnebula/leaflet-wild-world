// Windows: Leaflet Helper (windows/Leaflet Helper.ps1) runs beside Leaflet and does for Cartridge Sync what the Mac
// app does natively: Play on melonDS, installing melonDS, its Wi-Fi settings, finding saves on SD cards and installing
// Leaflet Link. "Start Leaflet" opens this page with the helper's port and token in its address; commands go to it the
// way they go to the Mac app's bridge, and its replies and progress come back to the same window.Leaflet… functions.
(function () {
  'use strict';
  const KEY = 'leaflet-helper';
  const q = new URLSearchParams(location.search);
  let port = q.get('helper'), token = q.get('t');
  try {
    if (port && token) sessionStorage.setItem(KEY, JSON.stringify({ port, token }));
    else ({ port, token } = JSON.parse(sessionStorage.getItem(KEY)) || {});
  } catch (e) { /* storage blocked: only this load has it */ }
  if (!/^\d+$/.test(port || '') || !/^[0-9a-f]{32}$/.test(token || '')) return;
  const base = `http://127.0.0.1:${port}`;
  const deliver = list => (Array.isArray(list) ? list : []).forEach(({ fn, arg }) => { if (/^Leaflet\w+$/.test(fn) && typeof window[fn] === 'function') window[fn](arg); });
  // When the helper has stopped (closed, or a newer one started with another token, which answers 403), the page is
  // told once through window.LeafletHelperLost, and again through LeafletHelperBack if it answers later.
  let alive = true;
  const setAlive = ok => {
    if (ok === alive) return;
    alive = ok;
    const fn = window[ok ? 'LeafletHelperBack' : 'LeafletHelperLost']; if (typeof fn === 'function') fn();
  };
  const json = r => { if (r.status === 403) throw new Error('refused'); if (!r.ok) throw new Error(r.status); return r.json(); };
  const post = m => fetch(`${base}/cmd?t=${token}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(m) })
    .then(json).then(list => { setAlive(true); deliver(list); }, () => setAlive(false));
  window.LeafletHelper = { postMessage: post, get alive() { return alive; } };
  // Progress and melonDS's saves arrive whenever they happen; the helper also uses these visits to know the window is open.
  // If it has gone (closed from Task Manager, say), polling slows down instead of failing every second.
  let misses = 0;
  (function poll() {
    fetch(`${base}/events?t=${token}`).then(json).then(list => { misses = 0; setAlive(true); deliver(list); }, e => { misses++; if (misses >= 3 || e.message === 'refused') setAlive(false); })
      .then(() => setTimeout(poll, misses > 5 ? 10000 : 1000));
  })();
})();
