// Game artwork, read from the player's own Wild World ROM. Nothing from the ROM ships with Leaflet: the files the editor
// needs are pulled out when you open your ROM and kept in this browser's IndexedDB on your machine only.
// Formats (from the decompilation): .bch = 4bpp tiles, .bpl = BGR555 palettes, many files LZ77 (type 0x10) compressed.
(function () {
  'use strict';
  const DB = 'leaflet-rom', STORE = 'files', KEY = 'ADME';
  const WANT = [/^menu\/icon\/(icon\d\d\.bch|b_obj_itm\.bpl)$/, /^item_info\/always\.bin$/, /^item_info\/series\.bin$/, /^ftr_info\/(always|dma)\.bin$/, /^ftr\/\d+\/\d+\//, /^(wall|carpet)\//, /^menu\/(fish|bug)_pic\//, /^npc\/model\//, /^cloth\//, /^sound_dataENG\.sdat$/, /^menu\/inventory\//, /^menu\/paper\//, /^P(Body|Head|FcTx|Pal|Gls)\//, /^PItm\/Mdl/, /^fg_data\//, /^font\/fontA_(head|attr|img)\.bin$/, /^myOrg\//];
  let files = null;            // Map path -> Uint8Array (raw, possibly compressed)
  let stale = false;           // a cache from an older Leaflet that lacks files this version reads (the start card asks for the ROM again)
  const listeners = new Set();
  const iconCache = new Map(), picCache = new Map(), sheetCache = new Map();

  // ---------- NDS file system ----------
  function listFS(rom) {
    const v = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    const fnt = v.getUint32(0x40, true), fat = v.getUint32(0x48, true);
    const out = [];
    const walk = (dir, path) => {
      const o = fnt + (dir & 0xFFF) * 8;
      let p = fnt + v.getUint32(o, true), fid = v.getUint16(o + 4, true);
      for (;;) {
        const len = rom[p++]; if (!len) break;
        const name = String.fromCharCode(...rom.subarray(p, p + (len & 0x7F))); p += len & 0x7F;
        if (len & 0x80) { const sub = v.getUint16(p, true); p += 2; walk(sub, path + name + '/'); }
        else { const s = v.getUint32(fat + fid * 8, true), e = v.getUint32(fat + fid * 8 + 4, true); out.push([path + name, s, e]); fid++; }
      }
    };
    walk(0xF000, '');
    return out;
  }

  function lz10(d) {
    if (!(d[0] === 0x4C && d[1] === 0x5A && d[2] === 0x37 && d[3] === 0x37)) return d;
    d = d.subarray(4);
    if (d[0] !== 0x10) return d;
    const n = d[1] | (d[2] << 8) | (d[3] << 16), out = new Uint8Array(n);
    let p = 4, o = 0;
    while (o < n) {
      const flags = d[p++];
      for (let b = 0; b < 8 && o < n; b++) {
        if (flags & (0x80 >> b)) {
          const x = (d[p] << 8) | d[p + 1]; p += 2;
          const len = (x >> 12) + 3, disp = (x & 0xFFF) + 1;
          for (let k = 0; k < len && o < n; k++, o++) out[o] = out[o - disp];
        } else out[o++] = d[p++];
      }
    }
    return out;
  }

  // ---------- IndexedDB cache ----------
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function saveCache(map) {
    try {
      const db = await idb();
      await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(map, KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (e) { /* storage unavailable: the art still works for this session */ }
  }
  async function loadCache() {
    try {
      const db = await idb();
      return await new Promise(res => { const r = db.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
    } catch (e) { return null; }
  }
  async function forget() {
    files = null; stale = false; iconCache.clear(); picCache.clear(); sheetCache.clear();
    if (window.GameSound && GameSound.unload) GameSound.unload();
    try { const db = await idb(); db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY); } catch (e) { /* ignore */ }
    listeners.forEach(f => f());
  }

  async function open(bytes) {
    const rom = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const code = String.fromCharCode(...rom.subarray(0xC, 0x10));
    if (!/^ADM[EJPK]$/.test(code)) throw new Error('This isn’t an Animal Crossing: Wild World ROM.');
    const map = new Map();
    for (const [path, s, e] of listFS(rom)) if (WANT.some(re => re.test(path))) map.set(path, rom.slice(s, e));
    if (!map.has('menu/icon/b_obj_itm.bpl')) throw new Error('The ROM’s pocket icons couldn’t be found.');
    files = map; stale = false; iconCache.clear(); picCache.clear(); sheetCache.clear();
    loadSound();
    await saveCache(map);
    listeners.forEach(f => f());
    return map.size;
  }

  function file(path) { const d = files && files.get(path); return d ? lz10(d) : null; }
  const bgr = c => [(c & 31) * 255 / 31 | 0, ((c >> 5) & 31) * 255 / 31 | 0, ((c >> 10) & 31) * 255 / 31 | 0];
  function palette(d, n) { const out = []; for (let i = 0; i < 16; i++) out.push(bgr(d[(n * 16 + i) * 2] | (d[(n * 16 + i) * 2 + 1] << 8))); return out; }

  // Draws 4bpp tiles to a canvas. tileAt(tx, ty) returns the tile index for that 8×8 cell.
  function drawTiles(tiles, pal, wTiles, hTiles, tileAt) {
    const c = document.createElement('canvas'); c.width = wTiles * 8; c.height = hTiles * 8;
    const ctx = c.getContext('2d'), img = ctx.createImageData(c.width, c.height);
    for (let ty = 0; ty < hTiles; ty++) for (let tx = 0; tx < wTiles; tx++) {
      const t = tileAt(tx, ty);
      for (let i = 0; i < 32; i++) {
        const b = tiles[t * 32 + i];
        for (let j = 0; j < 2; j++) {
          const v = j ? b >> 4 : b & 15; if (!v) continue;
          const x = tx * 8 + (i % 4) * 2 + j, y = ty * 8 + (i >> 2), q = (y * c.width + x) * 4, [r, g, bl] = pal[v];
          img.data[q] = r; img.data[q + 1] = g; img.data[q + 2] = bl; img.data[q + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ---------- pocket icons ----------
  // Item -> icon (Item_GetInfoUnk02): 0x1xxx items look it up in item_info/always.bin (12-byte records, icon at +2);
  // furniture shows the leaf, fossils 0xA7, gyroids 1.
  function iconIndex(id) {
    const cls = id >> 12;
    if (cls === 1) { const a = file('item_info/always.bin'); if (!a) return 0; const k = Math.min(id & 0xFFF, 0x56D) * 12 + 2; return a[k] | (a[k + 1] << 8); }
    if (cls === 3 || cls === 4) { if (id >= 0x450C && id <= 0x45DB) return 0xA7; if (id >= 0x45DC && id <= 0x47D7) return 1; }
    return 0;
  }
  function iconURL(id) {
    if (!files || id === 0xFFF1 || id >= 0xF000 || id < 0x1000) return null;
    const ix = iconIndex(id);
    if (iconCache.has(ix)) return iconCache.get(ix);
    const sheet = file(`menu/icon/icon${String(ix >> 4).padStart(2, '0')}.bch`), pals = file('menu/icon/b_obj_itm.bpl');
    if (!sheet || !pals) return null;
    const k = ix & 15, pal = palette(pals, (window.WW_DATA.iconPalettes[ix] || 7) - 7);
    // Menu_GetIconCharIndex: icon k starts at tile 2k in a 32-tile-wide (2D-mapped) sheet.
    const url = drawTiles(sheet, pal, 2, 2, (tx, ty) => k * 2 + tx + ty * 32).toDataURL();
    iconCache.set(ix, url);
    return url;
  }

  // ---------- encyclopedia pictures (96×96, 12 per folder, palette = entry % 12) ----------
  function creatureURL(kind, n) {
    if (!files) return null;
    const key = kind + n; if (picCache.has(key)) return picCache.get(key);
    const dir = kind === 'fish' ? 'menu/fish_pic' : 'menu/bug_pic', q = Math.floor(n / 12);
    const tiles = file(`${dir}/${q}/${q}_${String(n).padStart(2, '0')}.bch`), pals = file(`${dir}/${q}/${q}.bpl`);
    if (!tiles || !pals) return null;
    const url = drawTiles(tiles, palette(pals, n % 12), 12, 12, (tx, ty) => ty * 12 + tx).toDataURL();
    picCache.set(key, url);
    return url;
  }


  function loadSound() { const d = files && files.get('sound_dataENG.sdat'); if (d && window.GameSound) GameSound.load(d); }
  // A 256×192 background screen: .bsc tile map (tile 10 bits, h/v flip, palette 4 bits) over .bch tiles and .bpl palettes.
  function screenURL(bsc, bch, bpl) {
    const key = bsc + bch; if (sheetCache.has(key)) return sheetCache.get(key);
    const m = file(bsc), t = file(bch), pl = file(bpl); if (!m || !t || !pl) return null;
    const c = document.createElement('canvas'); c.width = 256; c.height = 192;
    const ctx = c.getContext('2d'), img = ctx.createImageData(256, 192), nPal = pl.length >> 5;
    for (let ty = 0; ty < 24; ty++) for (let tx = 0; tx < 32; tx++) {
      const e = m[(ty * 32 + tx) * 2] | (m[(ty * 32 + tx) * 2 + 1] << 8), ti = e & 0x3FF, hf = (e >> 10) & 1, vf = (e >> 11) & 1, pal = palette(pl, (e >> 12) % nPal);
      if ((ti + 1) * 32 > t.length) continue;
      for (let i = 0; i < 32; i++) {
        const b = t[ti * 32 + i];
        for (let j = 0; j < 2; j++) {
          const v = j ? b >> 4 : b & 15; if (!v) continue;
          let x = (i % 4) * 2 + j, y = i >> 2; if (hf) x = 7 - x; if (vf) y = 7 - y;
          const q = ((ty * 8 + y) * 256 + tx * 8 + x) * 4, [r, g, bl] = pal[v];
          img.data[q] = r; img.data[q + 1] = g; img.data[q + 2] = bl; img.data[q + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL(); sheetCache.set(key, url);
    return url;
  }

  // A neighbor's room layout (VillagerRoom_LoadLayout): table nr (40 layouts) normally, nf (10) while packing to move.
  // Entries are { code u16, x u8, y u8 } in a 16×16 grid; codes 0xF000–0xF02F place a furniture slot with facing code & 3.
  function roomLayout(index, moving) {
    const tab = moving ? 'nf' : 'nr', hd = file(`fg_data/${tab}_h.bin`), d = file(`fg_data/${tab}.bin`);
    if (!hd || !d) return null;
    const n = hd.length >> 1; if (index >= n) return null;
    let off = 0; for (let j = 0; j < index; j++) off += hd[j * 2] | (hd[j * 2 + 1] << 8);
    const size = hd[index * 2] | (hd[index * 2 + 1] << 8), out = [];
    for (let k = 0; k < size; k += 4) out.push({ code: d[off + k] | (d[off + k + 1] << 8), x: d[off + k + 2], y: d[off + k + 3] });
    return out;
  }

  // Stationery: menu/paper/{scr,chr,plt}/NNN for paper NNN (the letter's paper byte). The 32×32 map numbers its tiles
  // from 16 and its palettes from slot 12; the result is cropped to the sheet itself (everything but the backdrop tile).
  function paperURL(n) {
    const key = 'paper' + n; if (sheetCache.has(key)) return sheetCache.get(key);
    const id = String(n).padStart(3, '0'), m = file(`menu/paper/scr/${id}.bsc`), t = file(`menu/paper/chr/${id}.bch`), pl = file(`menu/paper/plt/${id}.bpl`);
    if (!m || !t || !pl) return null;
    const at = (tx, ty) => m[(ty * 32 + tx) * 2] | (m[(ty * 32 + tx) * 2 + 1] << 8), back = at(0, 0), nPal = pl.length >> 5;
    let x0 = 32, x1 = -1, y0 = 24, y1 = -1;
    for (let ty = 0; ty < 24; ty++) for (let tx = 0; tx < 32; tx++) if (at(tx, ty) !== back) { x0 = Math.min(x0, tx); x1 = Math.max(x1, tx); y0 = Math.min(y0, ty); y1 = Math.max(y1, ty); }
    if (x1 < 0) return null;
    const w = (x1 - x0 + 1) * 8, hh = (y1 - y0 + 1) * 8, c = document.createElement('canvas'); c.width = w; c.height = hh;
    const ctx = c.getContext('2d'), img = ctx.createImageData(w, hh);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const e = at(tx, ty), ti = (e & 0x3FF) - 16, hf = (e >> 10) & 1, vf = (e >> 11) & 1, pal = palette(pl, (((e >> 12) - 12) % nPal + nPal) % nPal);
      if (ti < 0 || (ti + 1) * 32 > t.length) continue;
      for (let i = 0; i < 32; i++) {
        const b = t[ti * 32 + i];
        for (let j = 0; j < 2; j++) {
          const v = j ? b >> 4 : b & 15; if (!v) continue;
          let x = (i % 4) * 2 + j, y = i >> 2; if (hf) x = 7 - x; if (vf) y = 7 - y;
          const q = (((ty - y0) * 8 + y) * w + (tx - x0) * 8 + x) * 4, [r, g, bl] = pal[v];
          img.data[q] = r; img.data[q + 1] = g; img.data[q + 2] = bl; img.data[q + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const out = { url: c.toDataURL(), w, h: hh }; sheetCache.set(key, out);
    return out;
  }

  // The game's letter font (font/fontA_*): head = glyph count (u32) and cell size (u16 width, u16 height); attr = for
  // each glyph its character code (u16, Latin-1) and width in pixels (u16); img = 1-bit cells, one u16 per row with the
  // leftmost pixel in the top bit. All but head are LZ77 compressed.
  let fontCache = null, fontFor = null;
  function font() {
    if (fontCache && fontFor === files) return fontCache;
    const hd = file('font/fontA_head.bin'), at = file('font/fontA_attr.bin'), im = file('font/fontA_img.bin');
    if (!hd || !at || !im) return null;
    const n = hd[0] | (hd[1] << 8), cw = hd[4] | (hd[5] << 8), ch = hd[6] | (hd[7] << 8), rowBytes = cw >> 3, cell = rowBytes * ch;
    if (cw !== 16 || at.length < n * 4 || im.length < n * cell) return null;
    const glyphs = new Map();
    for (let i = 0; i < n; i++) glyphs.set(at[i * 4] | (at[i * 4 + 1] << 8), { w: at[i * 4 + 2] | (at[i * 4 + 3] << 8), i });
    const width = c => (glyphs.get(c.charCodeAt(0)) || glyphs.get(0x3F)).w + 1;
    // Draws text at (x, y) on a 2D context in the given colour; characters the font lacks become "?".
    function draw(ctx, text, x, y, color, scale = 1) {
      ctx.fillStyle = color;
      for (const c of text) {
        const g = glyphs.get(c.charCodeAt(0)) || glyphs.get(0x3F);
        for (let r = 0; r < ch; r++) {
          const row = (im[g.i * cell + r * 2] << 8) | im[g.i * cell + r * 2 + 1];
          for (let px = 0; px < cw; px++) if (row & (0x8000 >> px)) ctx.fillRect(x + px * scale, y + r * scale, scale, scale);
        }
        x += (g.w + 1) * scale;
      }
      return x;
    }
    fontCache = { height: ch, width: t => [...t].reduce((n, c) => n + width(c), 0), draw }; fontFor = files;
    return fontCache;
  }

  // The game's built-in designs' names (myOrg/myD.bin: 50 records of 0x2C bytes; +0 palette, +1 kind, +2 name,
  // +0x13 creator, +0x1E town, all ASCII). Records 18–49 are Wendell's, from Tuskany.
  function builtInDesigns() {
    const f = file('myOrg/myD.bin'); if (!f) return null;
    const txt = (o, n) => { let t = ''; for (let i = 0; i < n && f[o + i]; i++) t += String.fromCharCode(f[o + i]); return t; };
    const out = [];
    for (let k = 0; k * 0x2C + 0x2C <= f.length; k++) { const o = k * 0x2C; out.push({ k, palette: f[o], name: txt(o + 2, 16), by: txt(o + 0x13, 9), town: txt(o + 0x1E, 14) }); }
    return out;
  }

  async function restore() {
    const map = await loadCache();
    if (map && map.size) { files = map; stale = WANT.some(re => ![...map.keys()].some(k => re.test(k))); loadSound(); listeners.forEach(f => f()); }
  }

  window.ROM = {
    open, restore, forget, font, builtInDesigns, iconURL, iconIndex, creatureURL, screenURL, paperURL, roomLayout, file, lz10, palette, drawTiles,
    get ready() { return !!files; },
    get stale() { return stale; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
})();
