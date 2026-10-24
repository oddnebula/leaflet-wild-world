// Pattern import: pictures, New Leaf QR codes, .acnl and .acww files.
// New Leaf design layout (620 bytes): name UTF-16 at 0x00 (21 chars), creator at 0x2C (9 chars), town at 0x42 (9 chars),
// 15 palette indexes into New Leaf's 256-color table at 0x58, design type at 0x69 (9 = normal), pixels at 0x6C (4bpp, low nibble first).
(function () {
  'use strict';
  const { h, sfx, toast } = UI;
  const D = window.WW_DATA;
  const rgb = hx => [1, 3, 5].map(k => parseInt(hx.substr(k, 2), 16));
  const dist = (a, b) => (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2 * 0.59 + (a[2] - b[2]) ** 2 * 0.11;
  const WW = D.palettes.map(p => p.map(rgb));

  // Turns 1024 RGBA-ish pixels (null = transparent) into { palette, pixels[1024] (0 = transparent, 1-15 = color) }.
  function quantize(px, opts = {}) {
    let best = opts.palette ?? -1;
    if (best < 0) {
      let bestErr = Infinity;
      WW.forEach((cols, pi) => {
        let err = 0;
        for (const p of px) if (p) err += Math.min(...cols.map(c => dist(c, p)));
        if (err < bestErr) { bestErr = err; best = pi; }
      });
    }
    const cols = WW[best], out = new Uint8Array(1024);
    const work = px.map(p => p && [...p]);
    for (let i = 0; i < 1024; i++) {
      const p = work[i]; if (!p) continue;
      let k = 0, e = Infinity; cols.forEach((c, ci) => { const d = dist(c, p); if (d < e) { e = d; k = ci; } });
      out[i] = k + 1;
      if (opts.dither) { // Floyd–Steinberg
        const err = [0, 1, 2].map(j => p[j] - cols[k][j]), x = i & 31, y = i >> 5;
        const spread = (dx, dy, f) => { const n = work[(y + dy) * 32 + x + dx]; if (x + dx >= 0 && x + dx < 32 && y + dy < 32 && n) for (let j = 0; j < 3; j++) n[j] += err[j] * f; };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
    }
    return { palette: best, pixels: out };
  }

  async function imageToPixels(blob, fit) {
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const c = h('canvas', { width: 32, height: 32 }), g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const sw = img.naturalWidth, sh = img.naturalHeight;
    if (fit === 'crop') { const m = Math.min(sw, sh); g.drawImage(img, (sw - m) / 2, (sh - m) / 2, m, m, 0, 0, 32, 32); }
    else { const sc = Math.min(32 / sw, 32 / sh); g.drawImage(img, (32 - sw * sc) / 2, (32 - sh * sc) / 2, sw * sc, sh * sc); }
    const d = g.getImageData(0, 0, 32, 32).data, px = [];
    for (let i = 0; i < 1024; i++) px.push(d[i * 4 + 3] < 128 ? null : [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
    return px;
  }

  function utf16(bytes, off, n) {
    let s = '';
    for (let i = 0; i < n; i++) { const c = bytes[off + i * 2] | (bytes[off + i * 2 + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
    return s;
  }
  function parseNewLeaf(bytes) {
    if (bytes.length < 0x26C) throw new Error(`This isn’t a New Leaf design (expected 620 bytes, got ${bytes.length}).`);
    const type = bytes[0x69];
    if (type !== 0x09) throw new Error('This is a New Leaf Pro Design. It’s spread over 4 QR codes and is too big for a Wild World pattern, so only normal designs can be imported.');
    const pal = [...bytes.slice(0x58, 0x67)].map(i => rgb(D.nlPalette[i] || '#ffffff'));
    const px = [];
    for (let i = 0; i < 1024; i++) {
      const b = bytes[0x6C + (i >> 1)], c = i & 1 ? b >> 4 : b & 15;
      px.push(c === 15 ? null : pal[c]);
    }
    return { name: utf16(bytes, 0, 21), creator: utf16(bytes, 0x2C, 9), town: utf16(bytes, 0x42, 9), px };
  }

  function decodeQR(px, w, hh) {
    if (!window.jsQR) throw new Error('QR reader failed to load.');
    const r = window.jsQR(px, w, hh, { inversionAttempts: 'attemptBoth' });
    if (!r) throw new Error('No QR code found. Try a sharper, straight-on picture with the whole code visible.');
    return new Uint8Array(r.binaryData);
  }
  async function blobToRGBA(blob) {
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = h('canvas', { width: Math.round(img.naturalWidth * sc), height: Math.round(img.naturalHeight * sc) }), g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    return [g.getImageData(0, 0, c.width, c.height).data, c.width, c.height];
  }

  function writePattern(s, off, q, meta) {
    const bytes = new Uint8Array(0x200);
    for (let i = 0; i < 1024; i++) bytes[i >> 1] |= (i & 1) ? q.pixels[i] << 4 : q.pixels[i];
    s.setBytes(off, bytes);
    s.set8(off + 0x226, (s.u8(off + 0x226) & 0x0F) | (q.palette << 4));
    if (meta && meta.name) {
      const clean = [...meta.name].filter(ch => WWSave.canEncode(ch)).join('').slice(0, 16);
      if (clean) s.setStr(off + 0x216, 16, clean);
    }
  }

  function open(s, off, done) {
    const root = document.getElementById('popover-root');
    let tab = 'picture', source = null, meta = null, fit = 'crop', dither = false, palette = -1;
    const preview = h('canvas', { width: 32, height: 32, style: { width: '192px', height: '192px', imageRendering: 'pixelated', borderRadius: '12px', background: 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/16px 16px' } });
    const info = h('div', { class: 'muted', style: { fontSize: '12.5px', lineHeight: 1.5 } });
    const body = h('div');
    const close = () => { root.replaceChildren(); document.removeEventListener('paste', onPaste); };
    let result = null;
    function render() {
      const g = preview.getContext('2d'); g.clearRect(0, 0, 32, 32);
      if (!source) { result = null; info.textContent = 'Nothing loaded yet.'; return; }
      result = quantize(source, { dither, palette });
      const cols = D.palettes[result.palette];
      for (let i = 0; i < 1024; i++) if (result.pixels[i]) { g.fillStyle = cols[result.pixels[i] - 1]; g.fillRect(i & 31, i >> 5, 1, 1); }
      info.replaceChildren(meta && meta.name ? h('div', null, h('b', null, meta.name), meta.creator ? ` by ${meta.creator}` : '', meta.town ? ` from ${meta.town}` : '') : null,
        `Using Wild World palette ${result.palette + 1}${palette < 0 ? ' (picked automatically)' : ''}.`);
    }
    async function loadFile(f) {
      try {
        meta = null;
        if (tab === 'qr') {
          const [px, w, hh] = await blobToRGBA(f);
          const p = parseNewLeaf(decodeQR(px, w, hh)); source = p.px; meta = p; sfx.bell();
        } else if (/\.acnl$/i.test(f.name) || (tab === 'file' && f.size >= 0x26C && f.size < 0x900 && !/\.acww$/i.test(f.name))) {
          const p = parseNewLeaf(new Uint8Array(await f.arrayBuffer())); source = p.px; meta = p;
        } else if (/\.(acww|bin)$/i.test(f.name) || f.size === 0x228) {
          const b = new Uint8Array(await f.arrayBuffer());
          if (b.length < 0x200) throw new Error('That file is too small to be a pattern.');
          s.setBytes(off, b.slice(0, Math.min(b.length, 0x228)));
          sfx.bell(); toast('Pattern imported exactly as saved', '🎨'); close(); done(); return;
        } else {
          source = await imageToPixels(f, fit); source.blob = f;
        }
        render();
      } catch (e) { sfx.error(); toast(e.message, '⚠️'); info.textContent = e.message; }
    }
    const onPaste = e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); loadFile(f); } };
    document.addEventListener('paste', onPaste);
    const fileIn = h('input', { type: 'file', hidden: true });
    fileIn.addEventListener('change', () => { if (fileIn.files[0]) loadFile(fileIn.files[0]); fileIn.value = ''; });
    function drawBody() {
      const tabs = h('div', { class: 'tabs' }, [['picture', '🖼️ Picture'], ['qr', '📱 New Leaf QR code'], ['file', '📄 Pattern file']].map(([id, l]) =>
        h('button', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; source = null; meta = null; drawBody(); render(); } }, l)));
      const blurb = {
        picture: 'Any picture works (PNG, JPEG, GIF, WebP, HEIC on Mac). It’s shrunk to 32 × 32 and matched to the closest Wild World palette.',
        qr: 'Pick a screenshot or photo of a New Leaf (or Happy Home Designer) design QR code. Normal designs only; Pro Designs don’t fit in Wild World.',
        file: '.acww files (from this editor or WildStorage) are copied exactly. .acnl files from New Leaf tools are converted.',
      }[tab];
      fileIn.accept = tab === 'file' ? '.acww,.acnl,.bin' : 'image/*';
      const drop = h('div', { class: 'drop', style: { padding: '20px', borderRadius: '16px' } },
        h('div', { style: { fontSize: '30px' } }, tab === 'qr' ? '📱' : tab === 'file' ? '📄' : '🖼️'),
        h('div', { style: { fontWeight: 750, margin: '6px 0' } }, 'Drop it here, paste it (⌘V), or'),
        h('button', { class: 'btn leaf', onclick: () => fileIn.click() }, 'Choose…'));
      drop.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
      const opts = tab === 'file' ? null : h('div', { class: 'btn-row', style: { alignItems: 'center', marginTop: '10px' } },
        tab === 'picture' ? UI.seg([[0, 'Crop to square'], [1, 'Fit whole picture']], () => (fit === 'crop' ? 0 : 1), v => { fit = v ? 'fit' : 'crop'; if (source && source.blob) loadFile(source.blob); }) : null,
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12.5px', fontWeight: 650 } }, UI.switchInput(() => dither, v => { dither = v; render(); }), 'Dithering'),
        h('select', { class: 'field w-m', onchange: e => { palette = Number(e.target.value); render(); } },
          h('option', { value: -1 }, 'Best palette (auto)'), D.palettes.map((p, i) => h('option', { value: i, selected: palette === i }, `Palette ${i + 1}`))));
      body.replaceChildren(tabs, h('div', { class: 'muted', style: { marginBottom: '10px', fontSize: '12.5px' } }, blurb),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 200px', gap: '16px', alignItems: 'start' } }, drop, h('div', null, preview, info)), opts, fileIn);
    }
    drawBody(); render();
    root.replaceChildren(h('div', { class: 'scrim', onclick: close }), h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, h('div', { class: 'top' }, h('h3', null, '🎨 Import a pattern'))),
      h('div', { class: 'sheet-body', style: { padding: '14px 16px' } }, body),
      h('div', { class: 'sheet-foot' }, h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h('button', { class: 'btn leaf', onclick: () => { if (!result) { toast('Load something first', '🎨'); return; } writePattern(s, off, result, meta); sfx.save(); toast('Pattern imported!', '🎨'); close(); done(); } }, 'Import into this slot'))));
  }
  window.PatternImport = { open, parseNewLeaf, quantize, decodeQR, blobToRGBA, imageToPixels, writePattern };
})();
