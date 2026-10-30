// Pattern studio: the drawing part of every pattern editor (resident designs, Able Sisters, the town flag, villagers,
// Blanca). The game stores one 32×32 picture with 15 colors from one of 16 palettes; the studio adds layers (kept while
// Leaflet is open and flattened into that picture after every stroke), mirror drawing, pencil / line / box / bucket /
// eyedropper tools, flips, turns and wrap-around shifts, undo and redo, a tiled preview, and a palette swapper.
(function () {
  'use strict';
  const { h, sfx, toast, drawPattern } = UI;
  const D = window.WW_DATA;
  const N = 1024, MAX_LAYERS = 8, CELL = 12;
  const sessions = new Map();   // pattern offset -> { sig, layers, active, undo, redo }
  const prefs = { tool: 'pen', mirror: 0, palMode: 0, tiled: false };
  const TOOLS = [['pen', '✏️', 'Pencil'], ['line', '📏', 'Line'], ['rect', '▭', 'Box'], ['fillrect', '■', 'Filled box'], ['bucket', '🪣', 'Bucket fill'], ['pick', '💧', 'Eyedropper (or Alt-click)']];
  const MIRRORS = [[0, 'Off'], [1, '⇆ Left-right'], [2, '⇅ Top-bottom'], [3, '✣ Four ways']];

  const pixels = (s, off) => { const p = new Uint8Array(N); for (let i = 0; i < N; i++) { const b = s.u8(off + (i >> 1)); p[i] = i & 1 ? b >> 4 : b & 15; } return p; };
  function signature(s, off) { let x = 0x811C9DC5; for (let i = 0; i < 0x200; i++) { x ^= s.u8(off + i); x = Math.imul(x, 0x01000193) >>> 0; } return `${x}-${s.u8(off + 0x226) >> 4}`; }
  function session(s, off) {
    const sig = signature(s, off);
    let S = sessions.get(off);
    // Anything that changed the pattern outside the studio (an import, another editor) starts a fresh single layer.
    if (!S || S.sig !== sig || S.save !== s) { S = { save: s, sig, layers: [{ name: 'Layer 1', px: pixels(s, off), hidden: false }], active: 0, undo: [], redo: [] }; sessions.set(off, S); }
    return S;
  }
  function composite(S) {
    const out = new Uint8Array(N);
    for (const L of S.layers) if (!L.hidden) for (let i = 0; i < N; i++) if (L.px[i]) out[i] = L.px[i];
    return out;
  }
  function commit(s, off, S) {
    const c = composite(S), b = new Uint8Array(0x200);
    for (let i = 0; i < 0x200; i++) b[i] = c[i * 2] | (c[i * 2 + 1] << 4);
    s.setBytes(off, b);
    S.sig = signature(s, off);
  }
  const snap = (s, off, S) => ({ layers: S.layers.map(L => ({ ...L, px: L.px.slice() })), active: S.active, pal: s.u8(off + 0x226) });
  function remember(s, off, S) { S.undo.push(snap(s, off, S)); if (S.undo.length > 60) S.undo.shift(); S.redo = []; }
  function restore(s, off, S, st) { S.layers = st.layers; S.active = st.active; s.set8(off + 0x226, st.pal); commit(s, off, S); }

  // ---------- drawing helpers ----------
  function mirrored(x, y) {
    const pts = [[x, y]], m = prefs.mirror;
    if (m & 1) pts.push([31 - x, y]);
    if (m & 2) pts.push([x, 31 - y]);
    if (m === 3) pts.push([31 - x, 31 - y]);
    return pts;
  }
  function plot(px, x, y, c) { for (const [a, b] of mirrored(x, y)) if (a >= 0 && b >= 0 && a < 32 && b < 32) px[b * 32 + a] = c; }
  function line(px, x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) { plot(px, x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  }
  function box(px, x0, y0, x1, y1, c, filled) {
    const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [p, q] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (let y = p; y <= q; y++) for (let x = a; x <= b; x++) if (filled || y === p || y === q || x === a || x === b) plot(px, x, y, c);
  }
  function bucket(px, x, y, c) {
    for (const [sx, sy] of mirrored(x, y)) {
      const from = px[sy * 32 + sx]; if (from === c) continue;
      const stack = [[sx, sy]];
      while (stack.length) {
        const [a, b] = stack.pop(); if (a < 0 || b < 0 || a > 31 || b > 31 || px[b * 32 + a] !== from) continue;
        px[b * 32 + a] = c; stack.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
      }
    }
  }
  const transform = (px, f) => { const out = new Uint8Array(N); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const [a, b] = f(x, y); out[b * 32 + a] = px[y * 32 + x]; } return out; };

  // Palette helpers: hex to RGB and the nearest color of another palette.
  const rgb = hx => [1, 3, 5].map(k => parseInt(hx.substr(k, 2), 16));
  function nearestMap(fromPal, toPal) {
    const T = toPal.map(rgb);
    return [0, ...fromPal.map(c => { const f = rgb(c); let k = 0, e = Infinity; T.forEach((t, i) => { const d = (t[0] - f[0]) ** 2 + (t[1] - f[1]) ** 2 + (t[2] - f[2]) ** 2; if (d < e) { e = d; k = i; } }); return k + 1; })];
  }

  // ---------- the studio ----------
  function studio(s, off, opts = {}) {
    const S = session(s, off);
    let color = 1, dragging = null, last = null, base = null;
    const pal = () => D.palettes[s.u8(off + 0x226) >> 4] || D.palettes[0];
    const big = h('canvas', { class: 'big', width: 32 * CELL, height: 32 * CELL });
    const preview = h('canvas', { class: 'ps-preview' });
    const layerList = h('div', { class: 'ps-layers' });
    const sw = h('div', { class: 'swatches' });
    const swapRow = h('div', { class: 'ps-swap' });
    const pals = h('div', { class: 'palettes' });
    const status = h('div', { class: 'muted ps-status' });

    function draw() {
      const c = composite(S), P = pal(), g = big.getContext('2d');
      g.clearRect(0, 0, big.width, big.height);
      for (let i = 0; i < N; i++) if (c[i]) { g.fillStyle = P[c[i] - 1]; g.fillRect((i & 31) * CELL, (i >> 5) * CELL, CELL, CELL); }
      g.strokeStyle = 'rgba(0,0,0,.07)'; g.lineWidth = 1;
      for (let k = 1; k < 32; k++) { g.beginPath(); g.moveTo(k * CELL + .5, 0); g.lineTo(k * CELL + .5, 384); g.moveTo(0, k * CELL + .5); g.lineTo(384, k * CELL + .5); g.stroke(); }
      g.strokeStyle = 'rgba(58,154,62,.75)'; g.lineWidth = 2;
      if (prefs.mirror & 1) { g.beginPath(); g.moveTo(192, 0); g.lineTo(192, 384); g.stroke(); }
      if (prefs.mirror & 2) { g.beginPath(); g.moveTo(0, 192); g.lineTo(384, 192); g.stroke(); }
      // Preview: the pattern alone, or 3×3 tiles to check how it repeats on floors and walls.
      const t = prefs.tiled ? 3 : 1, scale = prefs.tiled ? 1 : 3;
      preview.width = preview.height = 32 * t * scale;
      const pg = preview.getContext('2d'); pg.clearRect(0, 0, preview.width, preview.height);
      for (let ty = 0; ty < t; ty++) for (let tx = 0; tx < t; tx++) for (let i = 0; i < N; i++) if (c[i]) { pg.fillStyle = P[c[i] - 1]; pg.fillRect((tx * 32 + (i & 31)) * scale, (ty * 32 + (i >> 5)) * scale, scale, scale); }
      drawLayers();
    }
    function drawLayers() {
      layerList.replaceChildren(...S.layers.map((L, i) => ({ L, i })).reverse().map(({ L, i }) => {
        const cv = h('canvas', { width: 32, height: 32 }), g = cv.getContext('2d'), P = pal();
        for (let k = 0; k < N; k++) if (L.px[k]) { g.fillStyle = P[L.px[k] - 1]; g.fillRect(k & 31, k >> 5, 1, 1); }
        return h('div', { class: 'ps-layer' + (i === S.active ? ' on' : '') + (L.hidden ? ' hidden' : ''), onclick: () => { S.active = i; sfx.click(); drawLayers(); } },
          h('button', { class: 'ps-eye', title: L.hidden ? 'Show' : 'Hide', onclick: e => { e.stopPropagation(); remember(s, off, S); L.hidden = !L.hidden; commit(s, off, S); draw(); } }, L.hidden ? '🙈' : '👁️'),
          cv, h('span', null, L.name));
      }));
    }
    function drawSw() {
      const P = pal();
      sw.replaceChildren(h('button', { class: 'swatch clear' + (color === 0 ? ' on' : ''), title: 'Transparent (eraser)', onclick: () => { color = 0; drawSw(); } }),
        ...P.map((c, i) => h('button', { class: 'swatch' + (color === i + 1 ? ' on' : ''), style: { background: c }, title: `Color ${i + 1}`, onclick: () => { color = i + 1; drawSw(); sfx.click(); } })));
      swapRow.replaceChildren(h('span', { class: 'muted' }, color ? 'Swap this color with' : 'Pick a color to swap'),
        ...(color ? P.map((c, i) => i + 1 === color ? null : h('button', { class: 'swatch mini', style: { background: c }, title: `Swap color ${color} and color ${i + 1} everywhere`, onclick: () => swapColors(color, i + 1) })) : []));
      pals.replaceChildren(...D.palettes.map((p, i) => h('button', { class: 'pal' + ((s.u8(off + 0x226) >> 4) === i ? ' on' : ''), title: `Palette ${i + 1}`, onclick: () => setPalette(i) }, p.map(c => h('i', { style: { background: c } })))));
    }
    function setPalette(i) {
      const cur = s.u8(off + 0x226) >> 4; if (cur === i) return;
      remember(s, off, S);
      if (prefs.palMode === 1) { const m = nearestMap(D.palettes[cur], D.palettes[i]); for (const L of S.layers) for (let k = 0; k < N; k++) L.px[k] = m[L.px[k]]; }
      s.set8(off + 0x226, (s.u8(off + 0x226) & 0x0F) | (i << 4));
      commit(s, off, S); draw(); drawSw(); sfx.pop();
    }
    function swapColors(a, b) {
      remember(s, off, S);
      for (const L of S.layers) for (let k = 0; k < N; k++) L.px[k] = L.px[k] === a ? b : L.px[k] === b ? a : L.px[k];
      commit(s, off, S); draw(); drawSw(); sfx.pop(); toast(`Swapped colors ${a} and ${b}`, '🎨');
    }
    const act = () => S.layers[S.active];
    const at = e => { const r = big.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * 32), y = Math.floor((e.clientY - r.top) / r.height * 32); return x >= 0 && y >= 0 && x < 32 && y < 32 ? [x, y] : null; };

    big.addEventListener('pointerdown', e => {
      const p = at(e); if (!p) return;
      const [x, y] = p;
      if (prefs.tool === 'pick' || e.altKey) { color = composite(S)[y * 32 + x]; drawSw(); return; }
      if (act().hidden) { toast('This layer is hidden. Show it to draw on it.', '🙈'); return; }
      remember(s, off, S);
      big.setPointerCapture(e.pointerId);
      dragging = [x, y]; last = [x, y]; base = act().px.slice();
      if (prefs.tool === 'bucket') { bucket(act().px, x, y, color); dragging = null; }
      else if (prefs.tool === 'pen') plot(act().px, x, y, color);
      else box(act().px, x, y, x, y, color, true);
      commit(s, off, S); draw();
    });
    big.addEventListener('pointermove', e => {
      const p = at(e); if (p) status.textContent = `${p[0]}, ${p[1]}`;
      if (!dragging || !p) return;
      const [x, y] = p, L = act();
      if (prefs.tool === 'pen') { line(L.px, last[0], last[1], x, y, color); last = [x, y]; }
      else { L.px = base.slice(); if (prefs.tool === 'line') line(L.px, dragging[0], dragging[1], x, y, color); else box(L.px, dragging[0], dragging[1], x, y, color, prefs.tool === 'fillrect'); }
      commit(s, off, S); draw();
    });
    const end = () => { if (dragging) sfx.click(); dragging = null; };
    big.addEventListener('pointerup', end); big.addEventListener('pointercancel', end);

    const op = (fn, msg) => () => { remember(s, off, S); fn(); commit(s, off, S); draw(); drawSw(); sfx.pop(); if (msg) toast(msg, '🎨'); };
    const onActive = f => op(() => { act().px = transform(act().px, f); });
    const toolBtns = h('div', { class: 'ps-tools' }, TOOLS.map(([k, em, label]) => h('button', { class: 'ps-tool' + (prefs.tool === k ? ' on' : ''), title: label, onclick: e => { prefs.tool = k; e.currentTarget.parentNode.querySelectorAll('.ps-tool').forEach(b => b.classList.toggle('on', b === e.currentTarget)); sfx.click(); } }, em)));
    const mirrorSel = UI.seg(MIRRORS, () => prefs.mirror, v => { prefs.mirror = v; draw(); });
    const layerBtns = h('div', { class: 'btn-row' },
      h('button', { class: 'btn small', title: 'New empty layer above this one', onclick: () => { if (S.layers.length >= MAX_LAYERS) { toast(`Up to ${MAX_LAYERS} layers`, '🗂️'); return; } op(() => { S.layers.splice(S.active + 1, 0, { name: `Layer ${S.layers.length + 1}`, px: new Uint8Array(N), hidden: false }); S.active++; })(); } }, '＋ Layer'),
      h('button', { class: 'btn small', title: 'Copy this layer', onclick: () => { if (S.layers.length >= MAX_LAYERS) return; op(() => { const L = act(); S.layers.splice(S.active + 1, 0, { name: `${L.name} copy`, px: L.px.slice(), hidden: false }); S.active++; })(); } }, '⧉ Copy'),
      h('button', { class: 'btn small', title: 'Move up', onclick: () => { if (S.active >= S.layers.length - 1) return; op(() => { const i = S.active; [S.layers[i], S.layers[i + 1]] = [S.layers[i + 1], S.layers[i]]; S.active++; })(); } }, '↑'),
      h('button', { class: 'btn small', title: 'Move down', onclick: () => { if (S.active <= 0) return; op(() => { const i = S.active; [S.layers[i], S.layers[i - 1]] = [S.layers[i - 1], S.layers[i]]; S.active--; })(); } }, '↓'),
      h('button', { class: 'btn small', title: 'Merge into the layer below', onclick: () => { if (S.active <= 0) return; op(() => { const top = act(), below = S.layers[S.active - 1]; for (let k = 0; k < N; k++) if (top.px[k] && !top.hidden) below.px[k] = top.px[k]; S.layers.splice(S.active, 1); S.active--; })(); } }, 'Merge'),
      h('button', { class: 'btn small danger', title: 'Delete this layer', onclick: () => { if (S.layers.length < 2) { toast('A pattern needs at least one layer', '🗂️'); return; } op(() => { S.layers.splice(S.active, 1); S.active = Math.max(0, S.active - 1); })(); } }, '✕'));
    const fileIn = h('input', { type: 'file', hidden: true, accept: '.acww,.bin' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      const b = new Uint8Array(await f.arrayBuffer()); if (b.length < 0x228) { toast('That file is not a Wild World pattern', '⚠️'); return; }
      s.setBytes(off, b.slice(0, opts.full === false ? 0x200 : 0x228)); sessions.delete(off); sfx.bell(); toast('Pattern imported', '🎨'); APP.go(APP.view);
    });
    const nm = () => s.str(off + 0x216, 16) || 'pattern';
    const download = (name, blob) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); };
    const label = t => h('div', { class: 'ps-label' }, t);

    window.addEventListener('keydown', function keys(e) {
      if (!big.isConnected) { window.removeEventListener('keydown', keys); return; }
      if (!(e.metaKey || e.ctrlKey) || e.target.closest('input, textarea')) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); const st = (e.shiftKey ? S.redo : S.undo).pop(); if (st) { (e.shiftKey ? S.undo : S.redo).push(snap(s, off, S)); restore(s, off, S, st); draw(); drawSw(); } }
    });

    draw(); drawSw();
    return h('div', { class: 'card' }, h('div', { class: 'pe ps' },
      h('div', { class: 'ps-canvas' }, big, h('div', { class: 'ps-under' }, toolBtns, status),
        h('div', { class: 'ps-row' }, label('MIRROR'), mirrorSel)),
      h('div', { class: 'ps-side' },
        h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, h('div', { class: 'ps-prev' }, preview),
          h('div', null, h('div', { style: { fontWeight: 800, fontSize: '16px' } }, opts.title || 'Pattern'),
            h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Draw with the tools below the canvas. Alt-click picks a color; ' + UI.mod + 'Z undoes, add Shift to redo.'),
            h('label', { class: 'ps-check' }, UI.switchInput(() => prefs.tiled, v => { prefs.tiled = v; draw(); }), 'Tiled preview'))),
        h('div', null, label('COLORS'), sw),
        h('div', null, label('LAYERS (flattened into the one picture the game keeps)'), layerList, layerBtns),
        h('div', null, label('PALETTE'), pals,
          h('div', { class: 'ps-row', style: { marginTop: '8px' } }, h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Changing palette'),
            UI.seg([[0, 'Recolors'], [1, 'Keeps the look']], () => prefs.palMode, v => { prefs.palMode = v; })),
          swapRow),
        h('div', null, label('TRANSFORM THIS LAYER'), h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', title: 'Flip left-right', onclick: onActive((x, y) => [31 - x, y]) }, '⇆'),
          h('button', { class: 'btn small', title: 'Flip top-bottom', onclick: onActive((x, y) => [x, 31 - y]) }, '⇅'),
          h('button', { class: 'btn small', title: 'Turn right', onclick: onActive((x, y) => [31 - y, x]) }, '↻'),
          h('button', { class: 'btn small', title: 'Shift left (wraps around)', onclick: onActive((x, y) => [(x + 31) & 31, y]) }, '←'),
          h('button', { class: 'btn small', title: 'Shift right (wraps around)', onclick: onActive((x, y) => [(x + 1) & 31, y]) }, '→'),
          h('button', { class: 'btn small', title: 'Shift up (wraps around)', onclick: onActive((x, y) => [x, (y + 31) & 31]) }, '↑'),
          h('button', { class: 'btn small', title: 'Shift down (wraps around)', onclick: onActive((x, y) => [x, (y + 1) & 31]) }, '↓'),
          h('button', { class: 'btn small', title: 'Fill the layer with the current color', onclick: op(() => act().px.fill(color)) }, '🪣 All'),
          h('button', { class: 'btn small danger', title: 'Clear this layer', onclick: op(() => act().px.fill(0)) }, 'Clear'))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', onclick: () => { const st = S.undo.pop(); if (st) { S.redo.push(snap(s, off, S)); restore(s, off, S, st); draw(); drawSw(); sfx.click(); } } }, '↶ Undo'),
          h('button', { class: 'btn small', onclick: () => { const st = S.redo.pop(); if (st) { S.undo.push(snap(s, off, S)); restore(s, off, S, st); draw(); drawSw(); sfx.click(); } } }, '↷ Redo'),
          h('button', { class: 'btn small leaf', onclick: () => window.PatternImport.open(s, off, () => { sessions.delete(off); APP.go(APP.view); }) }, '⬆︎ Import (picture, QR, file)'),
          h('button', { class: 'btn small', onclick: () => fileIn.click() }, '⬆︎ .acww'),
          h('button', { class: 'btn small', onclick: () => download(nm() + '.acww', new Blob([s.bytes(off, 0x228)])) }, '⬇︎ .acww'),
          h('button', { class: 'btn small', onclick: () => { const c = h('canvas'); drawPattern(c, s, off, 8); c.toBlob(b => download(nm() + '.png', b)); } }, '⬇︎ PNG'), fileIn))));
  }

  window.PatternStudio = { studio, forget: off => sessions.delete(off) };
})();
