// Resident (player) editor plus the shared pattern and letter editors.
(function () {
  'use strict';
  const { h, hex, fmt, row, card, section, numberInput, textInput, selectInput, switchInput, seg, slot, sfx, say, toast, item, itemLabel, drawPattern, confirmSheet } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const TANS = ['No tan', 'Tan level 1', 'Tan level 2', 'Tan level 3', 'Tan level 4', 'Tan level 5', 'Tan level 6', 'Tan level 7'];
  const CONCEPTS = ['No feedback (0)', 'Concept 1', '“Formal, refined” (2)', 'Concept 3', 'Concept 4', 'Concept 5', 'Concept 6', 'No feedback (7)', 'Concept 8', '“Basic, yet new!” (9)', 'Concept 10', 'Concept 11', 'Concept 12', 'Concept 13', 'Concept 14', 'Concept 15'];

  const range = n => [...Array(n).keys()];
  const options = list => list.map((n, i) => [i, n]);

  // ---------- accessors so the letter editor works on the main block and on town-hall storage ----------
  function mainAcc(s) { return { u8: o => s.u8(o), u16: o => s.u16(o), set8: (o, v) => s.set8(o, v), set16: (o, v) => s.set16(o, v), str: (o, n) => s.str(o, n), setStr: (o, n, v) => s.setStr(o, n, v) }; }
  function lettersAcc(s) {
    const L = s.letters, base = WWSave.C.LETTERS;
    return {
      u8: o => L[o - base], u16: o => L[o - base] | (L[o - base + 1] << 8),
      set8: (o, v) => { L[o - base] = v; s.markDirty(); }, set16: (o, v) => { L[o - base] = v & 255; L[o - base + 1] = v >> 8; s.markDirty(); },
      str: (o, n) => s.str(o - base, n, L), setStr: (o, n, v) => s.setStr(o - base, n, v, L),
    };
  }
  const LETTER_STATES = [[0, 'Empty'], [1, 'Draft'], [2, 'Sent, unread'], [3, 'Read'], [4, 'Bottle draft'], [5, 'Bottle, unread'], [6, 'Bottle, read'], [7, 'From a villager, unread'], [8, 'From a villager, read']];
  const paperName = p => item(0x1000 + p * 4).name.replace(/\s*\(\d\)$/, '');

  // =====================================================================================
  // Letter editor
  function letterEditor(acc, off, s, title) {
    const empty = acc.u16(off + 0xF0) === 0 && !acc.str(off + 0x4C, 129) && !acc.str(off + 0x28, 8);
    const body = h('textarea', { class: 'field', rows: 5, maxlength: 128, spellcheck: 'false' });
    body.value = acc.str(off + 0x4C, 128);
    body.addEventListener('change', () => { if (!WWSave.canEncode(body.value.replace(/\n/g, ''))) { toast('Some characters can’t be written in-game', '⚠️'); return; } acc.setStr(off + 0x4C, 128, body.value); sfx.click(); });
    const intro = h('input', { class: 'field', style: { width: '100%', fontWeight: 700 }, maxlength: 24, value: acc.str(off + 0x34, 24) });
    intro.addEventListener('change', () => { acc.setStr(off + 0x34, 24, intro.value); sfx.click(); });
    const end = h('input', { class: 'field', style: { width: '100%', textAlign: 'right' }, maxlength: 32, value: acc.str(off + 0xCC, 32) });
    end.addEventListener('change', () => { acc.setStr(off + 0xCC, 32, end.value); sfx.click(); });
    const att = slot(() => acc.u16(off + 0xF0) || 0xFFF1, v => acc.set16(off + 0xF0, v), { emptyLabel: 'No present', title: 'Attach a present' });
    // LetterView::status (+0xEE): low 6 bits the letter's state, top 2 bits the present's (1 = still wrapped).
    const st = () => acc.u8(off + 0xEE);
    const stateSel = selectInput(LETTER_STATES, () => st() & 0x3F, v => acc.set8(off + 0xEE, (st() & 0xC0) | v), { width: 'w-m' });
    const giftSel = selectInput([[0, 'No present / opened'], [1, 'Present still wrapped'], [2, 'State 2'], [3, 'State 3']], () => st() >> 6, v => acc.set8(off + 0xEE, (st() & 0x3F) | (v << 6)), { width: 'w-m' });
    const flagBits = h('span', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } }, stateSel, giftSel);
    // The letter on its own stationery, drawn from the ROM when it's loaded.
    const paperCard = h('div', { class: 'letter-card' }, intro, body, end);
    const dress = () => {
      const pp = window.ROM && ROM.ready && ROM.paperURL ? ROM.paperURL(acc.u8(off + 0xED) & 63) : null;
      paperCard.classList.toggle('paper', !!pp);
      paperCard.style.backgroundImage = pp ? `url(${pp.url})` : '';
      paperCard.style.aspectRatio = pp ? `${pp.w} / ${pp.h}` : '';
    };
    dress();
    return h('div', { class: 'card' },
      h('div', { style: { padding: '14px 16px 6px', display: 'flex', alignItems: 'center', gap: '10px' } }, h('b', null, title), empty ? h('span', { class: 'badge lab' }, 'Empty') : null, h('span', { class: 'off mono muted', style: { fontSize: '10.5px' } }, hex(off, 5))),
      h('div', { style: { padding: '0 16px 12px', display: 'grid', gridTemplateColumns: '1fr 150px', gap: '14px' } },
        paperCard,
        h('div', null, att, h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '8px' } }, 'Stationery'),
          selectInput(range(64).map(p => [p, paperName(p)]), () => acc.u8(off + 0xED), v => { acc.set8(off + 0xED, v); dress(); }, { width: 'w-m' }))),
      row('From', 'Sender name and town', h('span', { style: { display: 'flex', gap: '6px' } },
        textInput(() => acc.str(off + 0x28, 8), v => acc.setStr(off + 0x28, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }),
        textInput(() => acc.str(off + 0x1E, 8), v => acc.setStr(off + 0x1E, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }))),
      row('Sender IDs', 'Player ID / town ID', h('span', { style: { display: 'flex', gap: '6px' } },
        numberInput(() => acc.u16(off + 0x26), v => acc.set16(off + 0x26, v), { max: 0xFFFF, width: 'w-s' }), numberInput(() => acc.u16(off + 0x1C), v => acc.set16(off + 0x1C, v), { max: 0xFFFF, width: 'w-s' }))),
      row('To', 'Recipient name and town', h('span', { style: { display: 'flex', gap: '6px' } },
        textInput(() => acc.str(off + 0x10, 8), v => acc.setStr(off + 0x10, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }),
        textInput(() => acc.str(off + 0x6, 8), v => acc.setStr(off + 0x6, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }))),
      row('Recipient IDs', 'Player ID / town ID. For villagers the first byte is the list slot and the second the villager ID.', h('span', { style: { display: 'flex', gap: '6px' } },
        numberInput(() => acc.u16(off + 0xE), v => acc.set16(off + 0xE, v), { max: 0xFFFF, width: 'w-s' }), numberInput(() => acc.u16(off + 0x4), v => acc.set16(off + 0x4, v), { max: 0xFFFF, width: 'w-s' }))),
      row('Name position in greeting', 'Where the recipient’s name is inserted into the first line.', numberInput(() => acc.u8(off + 0xEC), v => acc.set8(off + 0xEC, v), { max: 255, width: 'w-s' })),
      row('Letter state', 'Whether it’s a draft, unread or read, and whether the present has been unwrapped (LetterView status).', flagBits),
      row('Letter kind', 'Which template the game wrote it from (0 for letters people write; 0x11 marks one that has been delivered, 0x0C a bottle).', numberInput(() => acc.u8(off + 0xEF), v => acc.set8(off + 0xEF, v), { max: 255, width: 'w-s' })),
      row('Party types', 'Recipient / sender kind: 1 your future self, 2 a resident, 4 a bottle, 5–6 special senders (LetterParty).', h('span', { style: { display: 'flex', gap: '6px' } },
        numberInput(() => acc.u8(off + 0x1A), v => acc.set8(off + 0x1A, v), { max: 255, width: 'w-s' }), numberInput(() => acc.u8(off + 0x32), v => acc.set8(off + 0x32, v), { max: 255, width: 'w-s' }))),
      row('Clear this letter', null, h('button', { class: 'btn small danger', onclick: async () => {
        if (!await confirmSheet('Throw away this letter?', 'The letter and its present will be erased.', 'Throw away')) return;
        for (let i = 0; i < 0xF4; i++) acc.set8(off + i, 0);
        acc.set16(off + 0xF0, 0xFFF1); sfx.toggle(false); APP.go(APP.view);
      } }, 'Erase')));
  }
  window.LetterEditor = { letterEditor, mainAcc, lettersAcc };

  // =====================================================================================
  // Pattern editor (shared by residents, villagers, Able Sisters, town flag, Blanca)
  function patternTile(s, off, label, onOpen) {
    const cv = h('canvas', { width: 32, height: 32 });
    drawPattern(cv, s, off);
    return h('div', { class: 'pattern-tile', onclick: onOpen }, cv, h('div', { class: 'nm' }, s.str(off + 0x216, 16) || 'Untitled'), h('div', { class: 's' }, label));
  }
  function patternEditor(s, off, opts = {}) {
    let color = 1;
    const big = h('canvas', { class: 'big', width: 384, height: 384 });
    const preview = h('canvas', { width: 32, height: 32, style: { width: '96px', height: '96px', imageRendering: 'pixelated', borderRadius: '10px' } });
    const pal = () => D.palettes[s.u8(off + 0x226) >> 4];
    const px = i => { const b = s.u8(off + (i >> 1)); return i & 1 ? b >> 4 : b & 15; };
    const setPx = (i, c) => { const a = off + (i >> 1), b = s.u8(a); s.set8(a, i & 1 ? (b & 0x0F) | (c << 4) : (b & 0xF0) | c); };
    function draw() { drawPattern(big, s, off, 12); drawPattern(preview, s, off, 1); const g = big.getContext('2d'); g.strokeStyle = 'rgba(0,0,0,.06)'; for (let k = 1; k < 32; k++) { g.beginPath(); g.moveTo(k * 12, 0); g.lineTo(k * 12, 384); g.moveTo(0, k * 12); g.lineTo(384, k * 12); g.stroke(); } }
    let down = false, history = [];
    const at = e => { const r = big.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * 32), y = Math.floor((e.clientY - r.top) / r.height * 32); return x >= 0 && y >= 0 && x < 32 && y < 32 ? y * 32 + x : -1; };
    big.addEventListener('pointerdown', e => { history.push(s.bytes(off, 0x200)); if (history.length > 40) history.shift(); down = true; big.setPointerCapture(e.pointerId); const i = at(e); if (i >= 0) { if (e.altKey) { color = px(i); drawSw(); } else setPx(i, color); draw(); } });
    big.addEventListener('pointermove', e => { if (!down) return; const i = at(e); if (i >= 0 && !e.altKey) { setPx(i, color); draw(); } });
    big.addEventListener('pointerup', () => { down = false; sfx.click(); });
    const sw = h('div', { class: 'swatches' });
    function drawSw() {
      sw.replaceChildren(h('button', { class: 'swatch clear' + (color === 0 ? ' on' : ''), title: 'Transparent', onclick: () => { color = 0; drawSw(); } }),
        ...pal().map((c, i) => h('button', { class: 'swatch' + (color === i + 1 ? ' on' : ''), style: { background: c }, title: c, onclick: () => { color = i + 1; drawSw(); sfx.click(); } })));
    }
    const pals = h('div', { class: 'palettes' }, D.palettes.map((p, i) => {
      const el = h('button', { class: 'pal' + ((s.u8(off + 0x226) >> 4) === i ? ' on' : ''), title: `Palette ${i + 1}`, onclick: () => { s.set8(off + 0x226, (s.u8(off + 0x226) & 0x0F) | (i << 4)); pals.querySelectorAll('.pal').forEach((x, k) => x.classList.toggle('on', k === i)); drawSw(); draw(); sfx.pop(); } }, p.map(c => h('i', { style: { background: c } })));
      return el;
    }));
    const fileIn = h('input', { type: 'file', hidden: true, accept: '.acww,.bin,.png,image/png' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      if (/\.png$/i.test(f.name) || f.type === 'image/png') { await importPng(f); }
      else { const b = new Uint8Array(await f.arrayBuffer()); if (b.length < 0x228) { toast('That file is not a Wild World pattern', '⚠️'); return; } s.setBytes(off, b.slice(0, opts.full === false ? 0x200 : 0x228)); }
      draw(); drawSw(); sfx.bell(); toast('Pattern imported', '🎨'); fileIn.value = '';
    });
    async function importPng(f) {
      const img = new Image(); img.src = URL.createObjectURL(f); await img.decode();
      const c = h('canvas', { width: 32, height: 32 }); const g = c.getContext('2d'); g.drawImage(img, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data;
      // Pick the palette with the smallest total color error, then map each pixel to its nearest color.
      const rgb = hx => [1, 3, 5].map(k => parseInt(hx.substr(k, 2), 16));
      let best = 0, bestErr = Infinity;
      D.palettes.forEach((p, pi) => { const cols = p.map(rgb); let err = 0; for (let i = 0; i < 1024; i++) { if (d[i * 4 + 3] < 128) continue; err += Math.min(...cols.map(c2 => (c2[0] - d[i * 4]) ** 2 + (c2[1] - d[i * 4 + 1]) ** 2 + (c2[2] - d[i * 4 + 2]) ** 2)); } if (err < bestErr) { bestErr = err; best = pi; } });
      s.set8(off + 0x226, (s.u8(off + 0x226) & 0x0F) | (best << 4));
      const cols = D.palettes[best].map(rgb);
      for (let i = 0; i < 1024; i++) {
        if (d[i * 4 + 3] < 128) { setPx(i, 0); continue; }
        let k = 0, e = Infinity; cols.forEach((c2, ci) => { const ee = (c2[0] - d[i * 4]) ** 2 + (c2[1] - d[i * 4 + 1]) ** 2 + (c2[2] - d[i * 4 + 2]) ** 2; if (ee < e) { e = ee; k = ci; } });
        setPx(i, k + 1);
      }
      pals.querySelectorAll('.pal').forEach((x, k) => x.classList.toggle('on', k === best));
    }
    function download(name, blob) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); }
    draw(); drawSw();
    const nm = s.str(off + 0x216, 16) || 'pattern';
    return h('div', { class: 'card' },
      h('div', { class: 'pe' }, big,
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
          h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, preview, h('div', null, h('div', { style: { fontWeight: 800, fontSize: '16px' } }, opts.title || 'Pattern'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Click or drag to draw · Alt-click to pick a color'))),
          h('div', null, h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px', fontWeight: 700 } }, 'COLORS'), sw),
          h('div', null, h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px', fontWeight: 700 } }, 'PALETTE (16 to choose from)'), pals),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn small', onclick: () => { const b = history.pop(); if (b) { s.setBytes(off, b); draw(); } } }, '↶ Undo'),
            h('button', { class: 'btn small', onclick: () => { history.push(s.bytes(off, 0x200)); for (let i = 0; i < 1024; i++) setPx(i, color); draw(); } }, '🪣 Fill'),
            h('button', { class: 'btn small', onclick: () => { history.push(s.bytes(off, 0x200)); const b = s.bytes(off, 0x200); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const i = y * 32 + x, j = y * 32 + 31 - x; const v = j & 1 ? b[j >> 1] >> 4 : b[j >> 1] & 15; setPx(i, v); } draw(); } }, '⇋ Flip'),
            h('button', { class: 'btn small leaf', onclick: () => window.PatternImport.open(s, off, () => { draw(); drawSw(); pals.querySelectorAll('.pal').forEach((x, k) => x.classList.toggle('on', k === (s.u8(off + 0x226) >> 4))); }) }, '⬆︎ Import (picture, QR, file)'),
            h('button', { class: 'btn small', onclick: () => download(nm + '.acww', new Blob([s.bytes(off, 0x228)])) }, '⬇︎ .acww'),
            h('button', { class: 'btn small', onclick: () => { const c = h('canvas'); drawPattern(c, s, off, 8); c.toBlob(b => download(nm + '.png', b)); } }, '⬇︎ PNG'), fileIn))),
      opts.full === false ? null : [
        row('Pattern name', null, textInput(() => s.str(off + 0x216, 16), v => s.setStr(off + 0x216, 16, v), 16, { check: WWSave.canEncode }), off + 0x216),
        row('Made by', 'Creator name and home town', h('span', { style: { display: 'flex', gap: '6px' } },
          textInput(() => s.str(off + 0x20C, 8), v => s.setStr(off + 0x20C, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }),
          textInput(() => s.str(off + 0x202, 8), v => s.setStr(off + 0x202, 8, v), 8, { width: 'w-s', check: WWSave.canEncode })), off + 0x202),
        row('Creator IDs', 'Player ID / town ID. A pattern only counts as “yours” when these match you.', h('span', { style: { display: 'flex', gap: '6px' } },
          numberInput(() => s.u16(off + 0x20A), v => s.set16(off + 0x20A, v), { max: 0xFFFF, width: 'w-s' }), numberInput(() => s.u16(off + 0x200), v => s.set16(off + 0x200, v), { max: 0xFFFF, width: 'w-s' }))),
        row('Creator gender', null, seg([[0, 'Boy'], [1, 'Girl']], () => s.u8(off + 0x214), v => s.set8(off + 0x214, v))),
        row('Design concept', 'The Able Sisters’ feedback category saved after you design.', selectInput(options(CONCEPTS), () => s.u8(off + 0x226) & 0x0F, v => s.set8(off + 0x226, (s.u8(off + 0x226) & 0xF0) | v), { width: 'w-m' })),
        row('Pattern origin byte', 'Seems to be 0 for your own designs and 1 for the starter patterns.', numberInput(() => s.u8(off + 0x215), v => s.set8(off + 0x215, v), { max: 255, width: 'w-s' }), off + 0x215),
        opts.owner ? row('Make it mine', `Stamp ${opts.owner.name} as the creator so it can be edited in-game.`, h('button', { class: 'btn small leaf', onclick: () => {
          const b = opts.owner.base;
          s.setBytes(off + 0x200, s.bytes(b + 0x2276, 2)); s.setBytes(off + 0x202, s.bytes(b + 0x2278, 8));
          s.setBytes(off + 0x20A, s.bytes(b + 0x2280, 2)); s.setBytes(off + 0x20C, s.bytes(b + 0x2282, 8)); s.set8(off + 0x214, s.u8(b + 0x228A));
          sfx.bell(); APP.go(APP.view);
        } }, 'Claim')) : null]);
  }
  window.PatternEditor = { patternEditor, patternTile };

  // =====================================================================================
  function bitBytes(s, start, len, labelFn) {
    const grid = h('div', { class: 'bitgrid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } });
    grid.append(h('div', { class: 'muted', style: { gridColumn: '1 / -1', fontSize: '12px' } }, '⚠ Raw bits: nobody fully knows what these do yet. Change one at a time, test in-game, and keep your backup.'));
    for (let o = start; o < start + len; o++) {
      const bits = h('div', { style: { display: 'flex', gap: '2px' } }, range(8).map(b => {
        const btn = h('button', { class: 'bit' + ((s.u8(o) >> b) & 1 ? ' on' : ''), style: { width: '15px', padding: 0 }, title: `${hex(o, 5)} bit ${b}` });
        btn.onclick = () => { s.set8(o, s.u8(o) ^ (1 << b)); btn.classList.toggle('on'); sfx.toggle(btn.classList.contains('on')); val.textContent = s.u8(o).toString(16).toUpperCase().padStart(2, '0'); };
        return btn;
      }).reverse());
      const val = h('span', { class: 'mono', style: { fontSize: '11px', width: '18px' } }, s.u8(o).toString(16).toUpperCase().padStart(2, '0'));
      grid.append(h('div', { class: 'dex-item', style: { gap: '6px', padding: '5px 7px' } }, h('span', { class: 'mono muted', style: { fontSize: '10.5px', width: '44px' } }, labelFn ? labelFn(o) : '+' + (o - start).toString(16).toUpperCase()), bits, val));
    }
    return grid;
  }
  window.BitBytes = bitBytes;

  // Named event-flag list (resident flags at +0x21FC, town flags at 0x15FD8).
  function flagList(s, base, count, table, label) {
    const named = Object.keys(table).map(Number).filter(n => n < count);
    const list = h('div', { class: 'flag-list' }, named.map(n => {
      const f = table[n];
      const sw = switchInput(() => s.bit(base, n), v => s.setBit(base, n, v));
      const el = h('div', { class: 'flag' }, h('span', { class: 'n' }, '#' + n),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 700, fontSize: '12.5px' } }, f.name, ' ', h('span', { class: 'badge ' + (f.sure ? 'ok' : 'lab') }, f.sure ? 'Confirmed' : 'Inferred')),
          h('div', { class: 'ex-meta' }, f.who || '', f.note ? ` · ${f.note}` : '')), sw);
      UI.register(el, f.name, `${label} flag #${n}`);
      return el;
    }));
    const rest = h('div', { class: 'bitgrid' }, [...Array(count).keys()].filter(n => !table[n]).map(n => {
      const b = h('button', { class: 'bit' + (s.bit(base, n) ? ' on' : ''), title: `${label} flag #${n} (meaning unknown)` }, n);
      b.onclick = () => { s.setBit(base, n, !s.bit(base, n)); b.classList.toggle('on'); sfx.toggle(b.classList.contains('on')); };
      return b;
    }));
    return h('div', { class: 'card' }, list, h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 't' }, 'Unnamed flags'), h('div', { class: 'd' }, 'Used by the game, but what they do hasn’t been worked out yet.'))), rest);
  }
  window.FlagList = flagList;

  // Day/month/year editor for a ClockDate or ShopDate.
  function dmy(s, o) {
    const f = (i, max) => numberInput(() => s.u8(o + i), v => s.set8(o + i, v), { max, width: 'w-s' });
    return h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, f(1, 12), '/', f(0, 31), '/', f(2, 99));
  }
  // Bits of one byte as a switch.
  function bitSwitch(s, o, bit) { return switchInput(() => (s.u8(o) >> bit) & 1, v => s.set8(o, (s.u8(o) & ~(1 << bit)) | (v ? 1 << bit : 0))); }
  const vname = (s, o) => { const id = s.u8(o + 0xB); return !s.u16(o) || id === 0xFF ? null : (D.villagers.find(x => x.id === id)?.name || s.str(o + 2, 8) + ' villager'); };

  // PlayerErrands (+0x1D64): two favors (an errand record and the two villagers involved), the Roost part-time job's
  // three customers, a parcel to deliver and a house-visit invitation.
  function errands(s, b, refresh) {
    const E = b + 0x1D64;
    const errandRows = (o, label) => [
      row(label, s.u16(o + 8) !== 0xFFF1 && s.u16(o + 8) ? `Item: ${item(s.u16(o + 8)).name}` : 'No item', slot(() => s.u16(o + 8), v => s.set16(o + 8, v), { emptyLabel: 'None' }), o + 8),
      row('Kind and step', s.u8(o + 0xA) < 0x16 ? `Errand kind ${s.u8(o + 0xA)}, step ${s.u8(o + 0xB) & 31}.` : 'No errand (kind 22 means none).', h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        numberInput(() => s.u8(o + 0xA), v => { s.set8(o + 0xA, v); refresh(); }, { max: 22, width: 'w-s' }), numberInput(() => s.u8(o + 0xB) & 31, v => s.set8(o + 0xB, (s.u8(o + 0xB) & 0xE0) | (v & 31)), { max: 31, width: 'w-s' }),
        s.u8(o + 0xA) < 0x16 ? h('button', { class: 'btn small', onclick: () => { s.set8(o + 0xA, 0x16); s.set16(o + 8, 0xFFF1); s.set8(o + 0xB, 0); sfx.pop(); toast('Errand called off', '📦'); refresh(); } }, 'Call off') : null), o + 0xA),
    ];
    return [
      section('Errands', 'Favors neighbors asked you to run'),
      ...[0, 1].map(k => { const o = E + k * 0x28, a = vname(s, o + 0xC), c = vname(s, o + 0x18); return card(...errandRows(o, `Favor ${k + 1}${a ? ` · from ${a}` : ''}${c ? ` for ${c}` : ''}`)); }),
      card(
        row('Part-time job at the Roost', 'On duty right now.', bitSwitch(s, E + 0x74, 0), E + 0x74),
        row('Today’s customers', [0, 1, 2].map(k => vname(s, E + 0x50 + k * 0xC)).filter(Boolean).join(', ') || 'Nobody yet', h('span', { class: 'muted' }, '☕')),
        ...errandRows(E + 0x78, 'Parcel to deliver'),
        row('Parcel recipients', 'Villager slot it goes to, and how many are left.', h('span', { style: { display: 'flex', gap: '6px' } }, numberInput(() => s.u8(E + 0x84), v => s.set8(E + 0x84, v), { max: 255, width: 'w-s' }), numberInput(() => s.u8(E + 0x85), v => s.set8(E + 0x85, v), { max: 255, width: 'w-s' })), E + 0x84),
        row('House visit invite', vname(s, E + 0x88) ? `From ${vname(s, E + 0x88)}` : 'No invitation', h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'muted' }, 'accepted'), bitSwitch(s, E + 0xA8, 0)), E + 0x88)),
    ];
  }

  // FriendList (+0x1E60): 32 Wi-Fi friends (DWC friend data, player name, town name) and a checksum kept by the editor.
  function friends(s, b, refresh) {
    const F = b + 0x1E60, used = k => s.bytes(F + k * 0x1C, 0xC).some(x => x);
    const list = [...Array(32).keys()].filter(used);
    return [
      section('Wi-Fi friends', `${list.length} of 32 · checksum kept valid`),
      card(...(list.length ? list.map(k => row(`Friend ${k + 1}`, `${s.str(F + k * 0x1C + 0xC, 8) || '?'} from ${s.str(F + k * 0x1C + 0x14, 8) || '?'}`,
        h('span', { style: { display: 'flex', gap: '6px' } }, textInput(() => s.str(F + k * 0x1C + 0xC, 8), v => s.setStr(F + k * 0x1C + 0xC, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }), textInput(() => s.str(F + k * 0x1C + 0x14, 8), v => s.setStr(F + k * 0x1C + 0x14, 8, v), 8, { width: 'w-s', check: WWSave.canEncode })), F + k * 0x1C))
        : [row('No friends registered', 'Friend codes added at the gate show up here.', h('span', { class: 'muted' }, '📡'))]),
        list.length ? row('Forget every friend', 'Clears the roster. Friend codes would need to be exchanged again.', h('button', { class: 'btn small danger', onclick: () => { for (let i = 0; i < 0x380; i++) s.set8(F + i, 0); sfx.pop(); toast('Friend roster cleared', '📡'); refresh(); } }, 'Clear'), F, { risk: 'med', why: 'This can’t be undone in-game.' }) : null),
    ];
  }

  // PlayerDailyTalkFlags (+0x21F0): the date they belong to, then two words of "already did this today" bits
  // (Talk_CheckAndSetPlayerFlag callers in the special-character overlays). The game clears them when the date changes.
  const TALK = {
    2: { name: 'Talked to Celeste', who: 'Celeste', sure: true },
    7: { name: 'Talked to Gracie', who: 'Gracie', sure: true },
    8: { name: 'Gracie: first stage done', who: 'Gracie', sure: false },
    9: { name: 'Gracie: second stage done', who: 'Gracie', sure: false },
    10: { name: 'Talked to Wendell', who: 'Wendell', sure: true },
    11: { name: 'Talked to Saharah', who: 'Saharah', sure: true },
    15: { name: 'Talked to Mabel', who: 'Mabel', sure: true },
    20: { name: 'Shot down Gulliver’s UFO', who: 'Gulliver', sure: true, note: 'Cleared for everyone once the UFO crashes' },
    24: { name: 'Pascal visited', who: 'Pascal', sure: true, note: 'He won’t come back today while this is on' },
    28: { name: 'Talked to Tortimer at the Bug-Off', who: 'Tortimer', sure: true },
    29: { name: 'Talked to Tortimer at the Flower Fest', who: 'Tortimer', sure: true },
    30: { name: 'Talked to Tortimer at the fireworks', who: 'Tortimer', sure: true },
    31: { name: 'Talked to Tortimer on Bright Nights', who: 'Tortimer', sure: true },
    40: { name: 'Talked to Lyle', who: 'Lyle', sure: true },
  };

  // =====================================================================================
  for (let p = 0; p < 4; p++) {
    VIEWS.push({
      id: 'player' + p, group: 'Residents', icon: ['🧒', '👧', '🧑', '👦'][p],
      title: s => (s && s.playerExists(p)) ? s.str(s.playerBase(p) + 0x2282, 8) : `Player ${p + 1}`,
      sub: s => s.playerExists(p) ? `Resident ${p + 1} of 4` : 'Empty resident slot',
      badge: s => s.playerExists(p) ? '' : 'empty',
      tips: ['Wallets max out at 99,999 bells in-game, and the bank at 999,999,999.', 'Right-click a pocket slot to empty it instantly.', 'The Hidden Flags tab shows every unexplained bit stored for this resident.'],
      render(s, ctx) {
        const { refresh } = ctx;
        const vid = 'player' + p, tab = UI.tabOf(vid, 'profile');
        const b = s.playerBase(p);
        if (!s.playerExists(p)) return h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🏕️'), h('b', null, 'Nobody has moved into this slot yet.'), h('br'), 'Create the resident in-game first (choose “New Resident” on the title screen), then come back to edit them.'));
        const tabs = [['profile', '🪪 Profile'], ['money', '🔔 Money & gear'], ['pockets', '🎒 Pockets & outfit'], ['dresser', '🗄️ Dresser'], ['patterns', '🎨 Patterns'], ['mail', '✉️ Mail'], ['catalog', '📖 Catalog & encyclopedia'], ['flags', '🧪 Hidden flags']];
        const nav = h('div', { class: 'tabs' }, tabs.map(([id, label]) => h('button', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { UI.setTab(vid, id); sfx.click(); refresh(); } }, label)));
        const bodies = { profile, money, pockets, dresser, patterns, mail, catalog, flags };
        if (ctx.indexing) { for (const [id] of tabs) { UI.setRegistryTab(id); bodies[id](); } return []; }
        UI.setRegistryTab(tab);
        return [nav, bodies[tab]()];

        function profile() {
          const date = s.u16(b + 0x2216);
          const dY = date & 0x7F, dM = (date >> 7) & 0xF, dD = date >> 11;
          const setDate = (y, m, d) => s.set16(b + 0x2216, (y & 0x7F) | ((m & 0xF) << 7) | ((d & 0x1F) << 11));
          const model = window.PocketScreen && PocketScreen.player3D(s, b, 230);
          return [
            model ? h('div', { class: 'card pad villager-hero' }, model, h('div', null,
              h('div', { class: 'vh-name' }, s.str(b + 0x2282, 8)),
              h('div', { class: 'muted' }, `${s.u8(b + 0x228A) ? 'Girl' : 'Boy'} · lives in ${s.str(b + 0x2278, 8)}`),
              h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '8px' } }, 'Drag to turn · drawn from your ROM with this resident’s hair, face, tan and outfit. Change clothes on the Pockets & outfit tab.'))) : null,
            section('Identity'),
            card(
              row('Name', 'Up to 8 characters.', textInput(() => s.str(b + 0x2282, 8), v => { s.setStr(b + 0x2282, 8, v); refresh(); }, 8, { check: WWSave.canEncode }), b + 0x2282),
              row('Gender', 'Changes clothing fit and some dialogue.', seg([[0, '👦 Boy'], [1, '👧 Girl']], () => s.u8(b + 0x228A), v => s.set8(b + 0x228A, v)), b + 0x228A),
              row('Player ID', 'Links this resident to their letters, patterns and house.', numberInput(() => s.u16(b + 0x2280), UI.guard('pid' + p, 'Change this Player ID?', 'Letters, patterns, villager memories and town hall mail all point at this ID. A mismatch can make your own designs uneditable, and 0 makes the slot look empty, so the resident disappears from the title screen.', v => s.set16(b + 0x2280, v)), { max: 0xFFFF, width: 'w-s' }), b + 0x2280, { risk: 'high', why: '0 deletes the resident from the title screen.' }),
              row('Home town', 'The town name and ID stored on this resident. Must match the town’s own name and ID or the game treats you as a visitor.', h('span', { style: { display: 'flex', gap: '6px' } }, textInput(() => s.str(b + 0x2278, 8), v => s.setStr(b + 0x2278, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }), numberInput(() => s.u16(b + 0x2276), v => s.set16(b + 0x2276, v), { max: 0xFFFF, width: 'w-s' })), b + 0x2276),
              row('Birthday', 'Villagers throw you a party on this day!', h('span', { style: { display: 'flex', gap: '6px' } },
                selectInput(MONTHS.map((m, i) => [i + 1, m]), () => s.u8(b + 0x2219), v => s.set8(b + 0x2219, v), { width: 'w-m' }),
                numberInput(() => s.u8(b + 0x2218), v => s.set8(b + 0x2218, v), { min: 1, max: 31, width: 'w-s' })), b + 0x2218),
              row('Last played', 'The date the game thinks you last saved. Changing it affects weeds, villagers moving and “long time no see” events.', h('span', { style: { display: 'flex', gap: '6px' } },
                numberInput(() => 2000 + dY, v => setDate(v - 2000, dM, dD), { min: 2000, max: 2127, width: 'w-s' }),
                selectInput(MONTHS.map((m, i) => [i + 1, m]), () => dM, v => setDate(dY, v, dD), { width: 'w-m' }),
                numberInput(() => dD, v => setDate(dY, dM, v), { min: 1, max: 31, width: 'w-s' })), b + 0x2216, { risk: 'med', why: 'An old date makes weeds spread and villagers think about moving away.' }),
            ),
            section('Appearance'),
            card(
              row('Hairstyle', null, selectInput(options(D.hairstyles), () => s.bits(b + 0x223C, 4, 4), v => s.setBits(b + 0x223C, 4, 4, v)), b + 0x223C),
              row('Face', 'Normally fixed when you answer Rover’s questions on the train.', selectInput(options(D.faces), () => s.bits(b + 0x223C, 0, 4), v => s.setBits(b + 0x223C, 0, 4, v)), b + 0x223C),
              row('Hair color', 'Harriet’s Shampoodle colors.', selectInput(options(D.hairColors), () => s.bits(b + 0x223D, 0, 3), v => s.setBits(b + 0x223D, 0, 3, v), { width: 'w-m' }), b + 0x223D),
              row('Suntan', 'Builds up in summer, fades in winter.', selectInput(options(TANS), () => s.bits(b + 0x223D, 3, 3), v => s.setBits(b + 0x223D, 3, 3, v), { width: 'w-m' }), b + 0x223D),
              row('Today’s fortune', 'Set when you read a fortune (Katrina, or a fortune cookie). It changes your luck for the day.', selectInput([[0, 'No fortune'], [1, 'Fortune 1'], [2, 'Fortune 2'], [3, 'Fortune 3']], () => s.bits(b + 0x223D, 6, 2), v => s.setBits(b + 0x223D, 6, 2, v), { width: 'w-m' }), b + 0x223D),
            ),
            section('Emotions', 'Learned from villagers. Four slots.'),
            card(...range(4).map(k => row(`Emotion slot ${k + 1}`, null, selectInput([[0xFF, '— Not learned —'], ...D.emotions.map((e, i) => [i, `${i}. ${e}`]).slice(1)], () => s.u8(b + 0x21EC + k), v => s.set8(b + 0x21EC + k, v)), b + 0x21EC + k))),
            section('Townsfolk progress', 'Counters the special characters keep for you'),
            card(
              row('🧵 Chats with Sable', 'Talk to her daily and she opens up, then teaches you about patterns.', numberInput(() => s.u8(b + 0x2222), v => s.set8(b + 0x2222, v), { max: 255, width: 'w-s' }), b + 0x2222),
              row('☕ Visits to the Roost', 'Coffees bought from Brewster. Enough visits unlock the part-time job.', numberInput(() => s.u8(b + 0x2223), v => s.set8(b + 0x2223, v), { max: 255, width: 'w-s' }), b + 0x2223),
              row('☕ Part-time job talks', 'How far along you are working at the Roost.', numberInput(() => s.u8(b + 0x2251), v => s.set8(b + 0x2251, v), { max: 255, width: 'w-s' }), b + 0x2251),
              row('💇 Shampoodle visits', 'Haircuts from Harriet. Enough visits unlock colors and Mii hairstyles.', numberInput(() => s.u8(b + 0x2224), v => s.set8(b + 0x2224, v), { max: 255, width: 'w-s' }), b + 0x2224),
              row('🌰 Acorn prize step', 'Which Acorn Festival prize Tortimer gives next.', numberInput(() => s.u8(b + 0x2226), v => s.set8(b + 0x2226, v), { max: 255, width: 'w-s' }), b + 0x2226),
              row('😠 Mr. Resetti visits', 'How many times you’ve reset without saving. His lectures get longer.', h('span', { style: { display: 'flex', gap: '6px' } }, numberInput(() => s.u8(b + 0x2227), v => s.set8(b + 0x2227, v), { max: 255, width: 'w-s' }), h('button', { class: 'btn small', onclick: () => { s.set8(b + 0x2227, 0); sfx.pop(); toast('Resetti forgets your past', '😇'); refresh(); } }, 'Forgive')), b + 0x2227),
              row('👗 Gracie style score', 'Your score from Gracie’s fashion checks.', numberInput(() => s.u8(b + 0x2228), v => s.set8(b + 0x2228, v), { max: 255, width: 'w-s' }), b + 0x2228),
              row('🩹 Insurance claims', 'Bee stings and other mishaps Pelly and Phyllis paid out for.', numberInput(() => s.u8(b + 0x2229), v => s.set8(b + 0x2229, v), { max: 255, width: 'w-s' }), b + 0x2229),
              row('🎈 Balloons shot', 'Present balloons popped with the slingshot. Pop enough and a golden slingshot floats by.', numberInput(() => s.u8(b + 0x2252), v => s.set8(b + 0x2252, v), { max: 255, width: 'w-s' }), b + 0x2252),
              row('🌰 Acorns delivered', 'Acorns handed to Tortimer at the Acorn Festival.', numberInput(() => s.u8(b + 0x2225), v => s.set8(b + 0x2225, v), { max: 255, width: 'w-s' }), b + 0x2225),
              row('🎆 Fireworks given', 'Fireworks handed out at the summer show (0–10).', numberInput(() => (s.u8(b + 0x222A) >> 2) & 15, v => s.set8(b + 0x222A, (s.u8(b + 0x222A) & ~0x3C) | ((Math.min(v, 15) & 15) << 2)), { max: 10, width: 'w-s' }), b + 0x222A),
              row('🎣 Entered the Fishing Tourney', null, bitSwitch(s, b + 0x222A, 0), b + 0x222A),
              row('🐞 Entered the Bug-Off', null, bitSwitch(s, b + 0x222A, 1), b + 0x222A),
              row('🎁 Festival gift waiting', 'Set when a festival host has a gift for you.', bitSwitch(s, b + 0x222A, 6), b + 0x222A),
              row('🩹 Last insurance payout', 'Pelly and Phyllis pay out once a day at most.', dmy(s, b + 0x221A), b + 0x221A),
              row('☕ Last shift at the Roost', null, dmy(s, b + 0x221E), b + 0x221E),
              row('💌 Last letter from Mom', `She also sends a birthday letter once a year (last for 20${String(s.u8(b + 0x2241)).padStart(2, '0')}).`, dmy(s, b + 0x223E), b + 0x223E),
            ),
            section('A friend who moved away', 'A former neighbor who now lives in another town and still writes'),
            card(
              row('Villager', 'Who moved away.', selectInput([[0xFF, '— Nobody —'], ...D.villagers.map(x => [x.id, x.name])], () => s.u8(b + 0x225C + 0x15), v => s.set8(b + 0x225C + 0x15, v)), b + 0x225C + 0xA),
              row('Their new town', null, textInput(() => s.str(b + 0x225E, 8), v => s.setStr(b + 0x225E, 8, v), 8, { check: WWSave.canEncode }), b + 0x225C),
              row('Present they’ll send', null, slot(() => s.u16(b + 0x2272), v => s.set16(b + 0x2272, v), { title: 'Present' }), b + 0x2272),
              row('Friendship', '−128 to 127.', numberInput(() => s.u8(b + 0x2274) << 24 >> 24, v => s.set8(b + 0x2274, v & 0xFF), { min: -128, max: 127, width: 'w-s' }), b + 0x2274),
            ),
            section('Letter writing defaults'),
            card(
              row('Default greeting', 'Used at the top of letters you write.', textInput(() => s.str(b + 0x1AD0, 24), v => s.setStr(b + 0x1AD0, 24, v), 24, { width: 'w-l', check: WWSave.canEncode }), b + 0x1AD0),
              row('Default sign-off', 'Used at the bottom of letters you write.', textInput(() => s.str(b + 0x1B00, 32), v => s.setStr(b + 0x1B00, 32, v), 32, { width: 'w-l', check: WWSave.canEncode }), b + 0x1B00),
              row('Name position in greeting', null, numberInput(() => s.u8(b + 0x1B20), v => s.set8(b + 0x1B20, v), { max: 255, width: 'w-s' }), b + 0x1B20),
              row('Greeting to your future self', 'Used when you write a letter to yourself at the post office.', textInput(() => s.str(b + 0x1AE8, 24), v => s.setStr(b + 0x1AE8, 24, v), 24, { width: 'w-l', check: WWSave.canEncode }), b + 0x1AE8),
              row('Name position (future self)', null, numberInput(() => s.u8(b + 0x1B21), v => s.set8(b + 0x1B21, v), { max: 255, width: 'w-s' }), b + 0x1B21),
            ),
            // PlayerOptions (+0x1C6B): bit 0 kana text, bit 1 stereo sound, bits 2–3 the talking voice.
            section('Options', 'What you picked in the game’s options'),
            card(
              row('Stereo sound', 'Off means mono.', bitSwitch(s, b + 0x1C6B, 1), b + 0x1C6B),
              row('Talking voice', 'How characters sound when they talk (order as in the options menu).', selectInput([[0, 'Animalese'], [1, 'Bebebese'], [2, 'Silent'], [3, 'Value 3']], () => (s.u8(b + 0x1C6B) >> 2) & 3, v => s.set8(b + 0x1C6B, (s.u8(b + 0x1C6B) & ~0xC) | (v << 2)), { width: 'w-m' }), b + 0x1C6B),
              row('Kana text', 'A Japanese-version text option; leave it off.', bitSwitch(s, b + 0x1C6B, 0), b + 0x1C6B, { risk: 'med' })),
            // birthdayNoticeDays (+0x2254): per neighbor, the day you were last told about their birthday (0xFF none).
            section('Birthday reminders', 'When a neighbor last reminded you of an upcoming birthday'),
            card(range(8).map(k => { const vb = s.villagerBase(k), id = s.u8(vb + 0x6CB), nm = id === 0xFF ? `Neighbor slot ${k + 1} (empty)` : (D.villagers.find(x => x.id === id)?.name || `Neighbor ${k + 1}`);
              return row(nm, s.u8(b + 0x2254 + k) === 0xFF ? 'No reminder' : `Day ${s.u8(b + 0x2254 + k)}`, h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, numberInput(() => s.u8(b + 0x2254 + k), v => { s.set8(b + 0x2254 + k, v); refresh(); }, { max: 255, width: 'w-s' }), h('button', { class: 'btn small', onclick: () => { s.set8(b + 0x2254 + k, 0xFF); sfx.pop(); refresh(); } }, 'Clear')), b + 0x2254 + k); })),
            // MotherLetterState (+0x223E): last letter date, birthday letter year, one bit per letter already sent.
            section('Letters from Mom', 'Which of her letters have already arrived'),
            card(row('Birthday letter year', 'The year (20xx) of the last birthday letter she sent.', numberInput(() => s.u8(b + 0x2241), v => s.set8(b + 0x2241, v), { max: 255, width: 'w-s' }), b + 0x2241),
              row('Send them all again', 'Clears every “sent” bit so her letters can arrive again.', h('button', { class: 'btn small', onclick: () => { for (let i = 0; i < 15; i++) s.set8(b + 0x2242 + i, 0); sfx.pop(); toast('Mom has plenty more to say', '💌'); refresh(); } }, 'Reset'), b + 0x2242)),
            h('div', { class: 'card' }, bitBytes(s, b + 0x2242, 15, o => 'letters ' + (o - b - 0x2242) * 8 + '–' + ((o - b - 0x2242) * 8 + 7))),
            // DramaRecord (+0x222B) and the resident's own lost-child record (+0x2230).
            section('Other records'),
            card(
              row('Last show watched', 'A packed show/part byte and the date you watched it (DramaRecord).', h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, numberInput(() => s.u8(b + 0x222B), v => s.set8(b + 0x222B, v), { max: 255, width: 'w-s' }), dmy(s, b + 0x222C)), b + 0x222B),
              row('Katie escort: her town', s.str(b + 0x2232, 8) || 'Not set', textInput(() => s.str(b + 0x2232, 8), v => s.setStr(b + 0x2232, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }), b + 0x2230),
              row('Katie escort: days left', null, numberInput(() => s.u8(b + 0x223A) & 15, v => s.set8(b + 0x223A, (s.u8(b + 0x223A) & 0xF0) | (v & 15)), { max: 15, width: 'w-s' }), b + 0x223A),
              row('Katie escort: escorting now', null, bitSwitch(s, b + 0x223A, 5), b + 0x223A)),
          ];
        }
        function money() {
          const quick = (o, v, label) => h('button', { class: 'btn small bell', onclick: () => { s.set32(o, v); sfx.bell(); toast(`${label}: ${fmt(v)} bells`, '🔔'); refresh(); } }, 'Max');
          return [
            section('Bells'),
            card(
              row('🔔 Wallet', 'Bells you’re carrying. 99,999 is the most the game shows.', h('span', { style: { display: 'flex', gap: '6px' } }, numberInput(() => s.u32(b + 0x1B40), v => s.set32(b + 0x1B40, v), { max: 99999 }), quick(b + 0x1B40, 99999, 'Wallet')), b + 0x1B40),
              row('🏦 Savings account', 'Money at the town hall. Earns interest at the start of each month.', h('span', { style: { display: 'flex', gap: '6px' } }, numberInput(() => s.u32(b + 0x21E4), v => s.set32(b + 0x21E4, v), { max: 999999999 }), quick(b + 0x21E4, 999999999, 'Savings')), b + 0x21E4),
              row('🎟️ Nook Points', 'Points on your Nook Point Card. Enough points earn a Bronze, Silver, Gold and Platinum card.', numberInput(() => s.u16(b + 0x2208), v => s.set16(b + 0x2208, v), { max: 0xFFFF, width: 'w-s' }), b + 0x2208),
              row('🌰 Acorn Festival acorns', 'Acorns turned in to Tortimer this year.', numberInput(() => s.u8(b + 0x2225), v => s.set8(b + 0x2225, v), { max: 255, width: 'w-s' }), b + 0x2225),
            ),
            section('What you’re wearing and holding'),
            h('div', { class: 'card' }, h('div', { class: 'slots' },
              [['Held tool', 0x220A], ['Shirt', 0x220C], ['Hat', 0x220E], ['Face accessory', 0x2210], ['Bed', 0x2212], ['Pocket screen design', 0x2214]].map(([label, o]) => {
                const el = slot(() => s.u16(b + o), v => s.set16(b + o, v), { emptyLabel: 'Nothing', title: label });
                return h('div', null, el, h('div', { class: 'muted', style: { fontSize: '11.5px', textAlign: 'center', marginTop: '4px', fontWeight: 650 } }, label));
              }))),
          ];
        }
        function pockets() {
          return [section('Pockets & outfit', 'Like the pocket screen in the game · right-click any slot to empty it'),
            window.PocketScreen.screen(s, p, b, refresh),
            section('Looks', 'Hair, face and tan'),
            window.PocketScreen.looks(s, b, refresh),
            h('div', { class: 'btn-row', style: { marginTop: '12px' } },
              h('button', { class: 'btn', onclick: () => { range(15).forEach(k => s.set16(b + 0x1B22 + k * 2, 0xFFF1)); sfx.toggle(false); refresh(); } }, '🧺 Empty pockets'),
              h('button', { class: 'btn', onclick: () => { const ids = range(15).map(k => s.u16(b + 0x1B22 + k * 2)).sort((a, c) => a - c); ids.forEach((v, k) => s.set16(b + 0x1B22 + k * 2, v)); sfx.pop(); refresh(); } }, '✨ Sort'),
              h('button', { class: 'btn', onclick: () => { [0x1369, 0x136B, 0x1374, 0x1370, 0x1378, 0x137A].forEach((v, k) => s.set16(b + 0x1B22 + k * 2, v)); sfx.bell(); refresh(); } }, '🛠️ Starter tool kit'),
              h('button', { class: 'btn bell', onclick: () => { range(15).forEach(k => s.set16(b + 0x1B22 + k * 2, 0x14FD)); sfx.bell(); toast('Pockets full of 99,000 bell bags', '💰'); refresh(); } }, '💰 Fill with bell bags'))];
        }
        function dresser() {
          const base = 0x15430 + p * 0xB4;
          const grid = h('div', { class: 'slots' }, range(90).map(k => slot(() => s.u16(base + k * 2), v => s.set16(base + k * 2, v), { index: k })));
          return [section('Dresser', '90 slots shared by every dresser you own'), h('div', { class: 'card' }, grid),
            h('div', { class: 'btn-row', style: { marginTop: '12px' } },
              h('button', { class: 'btn', onclick: () => { const ids = range(90).map(k => s.u16(base + k * 2)).sort((a, c) => a - c); ids.forEach((v, k) => s.set16(base + k * 2, v)); sfx.pop(); refresh(); } }, '✨ Sort'),
              h('button', { class: 'btn danger', onclick: async () => { if (await confirmSheet('Empty the dresser?', 'All 90 slots will be cleared.', 'Empty it')) { range(90).forEach(k => s.set16(base + k * 2, 0xFFF1)); refresh(); } } }, 'Empty all'))];
        }
        function patterns() {
          const { patternEditor, patternTile } = window.PatternEditor;
          let open = window.__openPattern?.[p] ?? 0;
          const tiles = h('div', { class: 'patterns' }, range(8).map(k => patternTile(s, b + k * 0x228, `Slot ${k + 1}`, () => { (window.__openPattern ||= {})[p] = k; sfx.pop(); refresh(); })));
          return [section('Design slots', 'Click one to edit'), h('div', { class: 'card' }, tiles),
            section(`Editing slot ${open + 1}`), patternEditor(s, b + open * 0x228, { title: `Slot ${open + 1}`, owner: { name: s.str(b + 0x2282, 8), base: b } }),
            section('Pattern order'),
            card(row('Pattern menu order', 'The order your 8 designs appear in the menu.', textInput(() => [...s.bytes(b + 0x1140, 8)].join(' '), v => { const a = v.trim().split(/\s+/).map(Number); if (a.length === 8 && a.every(x => x >= 0 && x < 256)) s.setBytes(b + 0x1140, a); }, 40, { width: 'w-m' }), b + 0x1140),
              row('Reset pattern order', 'Puts the menu back to 1 through 8.', h('button', { class: 'btn small', onclick: () => { s.setBytes(b + 0x1140, range(8)); sfx.pop(); refresh(); } }, 'Reset')))];
        }
        function mail() {
          const { letterEditor, mainAcc, lettersAcc } = window.LetterEditor;
          const acc = mainAcc(s), lacc = lettersAcc(s);
          let which = window.__openMail?.[p] ?? 'pocket0';
          const pick = h('select', { class: 'field w-l' });
          range(10).forEach(k => pick.append(h('option', { value: 'pocket' + k, selected: which === 'pocket' + k }, `Pocket letter ${k + 1}${acc.str(b + 0x1148 + k * 0xF4 + 0x28, 8) ? ' · from ' + acc.str(b + 0x1148 + k * 0xF4 + 0x28, 8) : ''}`)));
          const home = 0x1200C + p * 0x98C;
          range(10).forEach(k => pick.append(h('option', { value: 'home' + k, selected: which === 'home' + k }, `Home mailbox ${k + 1}${acc.str(home + k * 0xF4 + 0x28, 8) ? ' · from ' + acc.str(home + k * 0xF4 + 0x28, 8) : ''}`)));
          pick.append(h('option', { value: 'future', selected: which === 'future' }, 'Letter to my future self'));
          const lbase = WWSave.C.LETTERS + p * 0x477C;
          range(75).forEach(k => pick.append(h('option', { value: 'hall' + k, selected: which === 'hall' + k }, `Town hall mailbox ${k + 1}${lacc.str(lbase + k * 0xF4 + 0x28, 8) ? ' · from ' + lacc.str(lbase + k * 0xF4 + 0x28, 8) : ''}`)));
          pick.addEventListener('change', () => { (window.__openMail ||= {})[p] = pick.value; refresh(); });
          let editor;
          if (which.startsWith('home')) { const k = +which.slice(4); editor = [letterEditor(acc, home + k * 0xF4, s, `Home mailbox ${k + 1}`),
            card(row('Last Wi-Fi letter number', 'The mailbox remembers the last letter that arrived over Nintendo Wi-Fi.', numberInput(() => s.u16(home + 0x988), v => s.set16(home + 0x988, v), { max: 0xFFFF, width: 'w-s' }), home + 0x988))]; }
          else if (which.startsWith('pocket')) { const k = +which.slice(6); editor = letterEditor(acc, b + 0x1148 + k * 0xF4, s, `Pocket letter ${k + 1}`); }
          else if (which === 'future') {
            editor = [letterEditor(acc, b + 0x1C6C, s, 'Letter to my future self'),
              card(row('Delivery date', 'Day, month and year (2-digit) the letter arrives.', h('span', { style: { display: 'flex', gap: '6px' } },
                numberInput(() => s.u8(b + 0x1D60), v => s.set8(b + 0x1D60, v), { max: 31, width: 'w-s' }), numberInput(() => s.u8(b + 0x1D61), v => s.set8(b + 0x1D61, v), { max: 12, width: 'w-s' }), numberInput(() => s.u8(b + 0x1D62), v => s.set8(b + 0x1D62, v), { max: 99, width: 'w-s' })), b + 0x1D60))];
          } else { const k = +which.slice(4); editor = letterEditor(lacc, lbase + k * 0xF4, s, `Town hall mailbox ${k + 1}`); }
          return [section('Choose a letter', '10 in your pockets, 10 in your mailbox at home, 1 future letter, 75 at the town hall'), card(row('Letter', null, pick)), section(''), editor];
        }
        function catalog() {
          const CAT = b + 0x1B48, LEN = 0x123;
          const ENC = b + 0x1BDD, encNames = D.encyclopedia;
          const isEnc = o => (o > ENC && o < ENC + 14) ? 0xFF : o === ENC ? 0xFE : o === ENC + 14 ? 0x01 : 0;
          let catOn = 0, catAll = 0;
          for (let o = CAT; o < CAT + LEN; o++) { const m = ~isEnc(o) & 0xFF; catAll += popcnt(m); catOn += popcnt(s.u8(o) & m); }
          const dex = h('div', { class: 'dex' });
          encNames.forEach((n, i) => {
            if (!n) return;
            const on = s.bit(ENC, i);
            const cb = h('input', { type: 'checkbox' }); cb.checked = !!on;
            const el = h('label', { class: 'dex-item' + (on ? ' on' : '') }, cb, i <= 56 ? '🦋' : '🐟', n);
            cb.addEventListener('change', () => { s.setBit(ENC, i, cb.checked); el.classList.toggle('on', cb.checked); sfx.toggle(cb.checked); });
            dex.append(el);
          });
          const fill = (mask, on) => { for (let o = CAT; o < CAT + LEN; o++) { const m = mask(o); s.set8(o, on ? s.u8(o) | m : s.u8(o) & ~m); } sfx.bell(); refresh(); };
          return [section('Catalog', `${catOn} of ${catAll} entries registered`),
            card(row('📚 Fill the whole catalog', 'Marks every furniture, clothing, wallpaper, carpet and song as “seen”, so you can order it from Nook.', h('button', { class: 'btn small leaf', onclick: () => fill(o => ~isEnc(o) & 0xFF, true) }, 'Fill')),
              row('Clear the catalog', null, h('button', { class: 'btn small danger', onclick: () => fill(o => ~isEnc(o) & 0xFF, false) }, 'Clear')),
              row('Catalog progress', null, h('div', { class: 'progress' }, h('i', { style: { width: (catOn / catAll * 100).toFixed(1) + '%' } })))),
            section('Encyclopedia', 'Bugs and fish you’ve caught'),
            h('div', { class: 'btn-row', style: { marginBottom: '10px' } }, h('button', { class: 'btn small leaf', onclick: () => fill(isEnc, true) }, 'Catch them all'), h('button', { class: 'btn small', onclick: () => fill(isEnc, false) }, 'Forget all')),
            h('div', { class: 'card' }, dex),
            section('Raw catalog bits', 'Every bit, for researchers'), h('div', { class: 'card' }, bitBytes(s, CAT, LEN))];
        }
        function flags() {
          return [
            h('div', { class: 'callout' }, h('span', { class: 'em' }, '🧪'), h('div', null, h('b', null, 'Event flags change what happens in-game'), 'Turning a “received” flag on can make a character skip giving you an item, and turning it off can make them give it again. Story flags can repeat or skip events. Change one at a time.')),
            card(row('Clear Resetti for everyone', 'Turns off flag #2 on all residents, so nobody gets a lecture next time.', h('button', { class: 'btn small', onclick: () => { for (let q = 0; q < 4; q++) s.setBit(s.playerBase(q) + 0x21FC, 2, false); sfx.bell(); toast('Resetti’s taking the day off', '😴'); refresh(); } }, 'All residents'))),
            section('Event flags', '64 per resident, found in the decompilation'),
            flagList(s, b + 0x21FC, 64, window.WW_FLAGS.player, 'Resident'),
            section('Today’s chats', `For ${[s.u8(b + 0x21F1), s.u8(b + 0x21F0)].join('/')}/20${String(s.u8(b + 0x21F2)).padStart(2, '0')} · cleared on a new day`),
            card(row('Fresh day', 'Clear every bit so the characters treat you as if you haven’t spoken yet today.', h('button', { class: 'btn small', onclick: () => { for (let i = 0; i < 8; i++) s.set8(b + 0x21F4 + i, 0); sfx.pop(); toast('Everyone has something new to say', '💬'); refresh(); } }, 'Clear today'))),
            flagList(s, b + 0x21F4, 64, TALK, 'Daily'),
            ...errands(s, b, refresh),
            ...friends(s, b, refresh),
            section('Raw resident data', 'The same records bit by bit, for researchers'),
            h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 't' }, 'Daily talk flags and day stamp', h('span', { class: 'off' }, hex(b + 0x21F0, 5))), h('div', { class: 'd' }, 'Who you’ve already talked to today, with the date they belong to (0x21F0–0x21FB), and the date of your last daily update (0x2204–0x2207).'))), bitBytes(s, b + 0x21F0, 0xC, o => hex(o - b, 4)), bitBytes(s, b + 0x2204, 0x4, o => hex(o - b, 4))),
            h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 't' }, 'Special-character records', h('span', { class: 'off' }, hex(b + 0x221A, 5))), h('div', { class: 'd' }, 'Service dates (0x221A–0x2221), the counters shown on the Profile tab (0x2222–0x2229) and a flag byte (0x222A), then the last show you watched with its date (0x222B–0x222F) and your Katie escort record (0x2230–0x223B).'))), bitBytes(s, b + 0x221A, 0x22, o => hex(o - b, 4))),
            h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 't' }, 'Mom’s letters, birthdays and more', h('span', { class: 'off' }, hex(b + 0x223E, 5))), h('div', { class: 'd' }, 'Letters from your mom (0x223E–0x2250), the part-time job and balloon counters (0x2251–0x2252), birthday reminders (0x2253–0x225B), the friend who moved away (0x225C–0x2275).'))), bitBytes(s, b + 0x223E, 0x38, o => hex(o - b, 4))),
            h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 't' }, 'Wi-Fi identity (checksummed)', h('span', { class: 'off' }, hex(b + 0x1E10, 5))), h('div', { class: 'd' }, 'Used by Copper and Booker at the gate and by the Wi-Fi screens. The game protects it with its own checksum, which this editor keeps valid. The friend roster after it (0x1E60) is listed above.'))), bitBytes(s, b + 0x1E10, 0x4C, o => hex(o - b, 4))),
            h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 't' }, 'Errands', h('span', { class: 'off' }, hex(b + 0x1D64, 5))), h('div', { class: 'd' }, 'Favors your neighbors asked you to run (deliveries, item requests, letters to pass on) and how far along each one is.'))), bitBytes(s, b + 0x1D64, 0xAC, o => hex(o - b, 4))),
          ];
        }
      },
    });
  }
  function popcnt(x) { let n = 0; while (x) { n += x & 1; x >>= 1; } return n; }
})();
