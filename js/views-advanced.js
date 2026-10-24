// Advanced: save health, full region map with hex editor, save diff, raw poke, backups.
(function () {
  'use strict';
  const { h, hex, row, card, section, numberInput, textInput, sfx, toast, say } = UI;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const C = WWSave.C;

  // Region map of the main block, taken from the decompilation's save struct (0x021D7350 in RAM).
  const REGIONS = [
    [0x00000, 0x2, 'Save identifier (0x8A USA, 0xC5 Europe)'], [0x00002, 0xA, 'Town ID and name'],
    ...[0, 1, 2, 3].map(p => [0xC + p * 0x228C, 0x228C, `Resident ${p + 1}`]),
    ...[...Array(8).keys()].map(v => [0x8A3C + v * 0x700, 0x700, `Neighbor ${v + 1}`]),
    [0x0C23C, 0x1C, 'Neighbor friendships (28 pairs)'], [0x0C258, 0x14, 'Who’s outdoors today'], [0x0C26C, 0x90, 'Sick villager record'],
    [0x0C2FC, 0x4, 'Nickname cooldown date'], [0x0C300, 0x10, 'Last move-in and move-out dates'], [0x0C310, 0x14, 'Species history'],
    [0x0C324, 0x4, 'Last moved / last sick indexes'], [0x0C328, 0x2, 'Town tune request'], [0x0C32A, 0x6, 'Furniture drop date'],
    [0x0C330, 0x24, 'Acre layout'], [0x0C354, 0x2000, 'Town map items'], [0x0E354, 0x200, 'Buried flags'],
    [0x0E554, 0x1, 'Grass pattern (2 bits) and ground season (6 bits)'], [0x0E555, 0x1, 'Padding'],
    [0x0E556, 1, 'Gulliver’s UFO parts quest'], [0x0E557, 1, 'The Roost’s guests today'],
    [0x0E558, 0x1594, 'House rooms and loan'], [0x0FAEC, 0xC, 'K.K. song library'], [0x0FAF8, 0x4, 'House state (size, upgrade, roof colors, lights)'], [0x0FAFC, 0x1140, 'Able Sisters displays'],
    [0x10C3C, 0xF4, 'Town exchange: letter'], [0x10D30, 0x48, 'Town exchange: constellation'], [0x10D78, 0x700, 'Town exchange: villager moving in'], [0x11478, 0x10, 'Town exchange: counter, flags, lost child, checksum'],
    [0x11488, 0xB80, 'Bulletin board (15 posts)'], [0x12008, 0x4, 'Town hall donations total'],
    ...[0, 1, 2, 3].map(p => [0x1200C + p * 0x98C, 0x98C, `Mailbox at home, resident ${p + 1}`]),
    [0x1463C, 0x990, 'Letters waiting to be delivered'], [0x14FCC, 0x464, 'Celeste’s constellations (16)'], [0x15430, 0x2D0, 'Dressers (4 × 90 items)'],
    [0x15700, 0x22C, 'Blanca’s face'], [0x1592C, 0x230, 'Town flag and gate'], [0x15B5C, 0xFC, 'Message in a bottle'],
    [0x15C58, 0xF8, 'Received letters (checksummed)'], [0x15D50, 0x64, 'Museum donations and completion date'], [0x15DB4, 0x64, 'Nook’s shop'],
    [0x15E18, 0x3C, 'Weekly event slots'],
    [0x15E54, 0x4, 'Town state: last update'], [0x15E58, 0x4, 'Native fruit (0 apple … 4 cherry)'], [0x15E5C, 0x4, 'Town state: next week date'],
    [0x15E60, 0xA, 'Pelican notices posted'], [0x15E6A, 0xB, 'Slogans posted'], [0x15E75, 0x1, 'Perfect-town streak'], [0x15E76, 0x2, 'Notices started'],
    [0x15E78, 0x30, 'Town events'], [0x15EA8, 0x4, 'Events updated on'], [0x15EAC, 0x10, 'Last-play date per resident'], [0x15EBC, 0x4, 'Bulletin board updated on'],
    [0x15EC0, 0x1E, 'Lost & found'], [0x15EDE, 0x1E, 'Recycling bin'], [0x15EFC, 0x38, 'Tortimer’s contest record'], [0x15F34, 0x18, 'Crazy Redd’s last sale'],
    [0x15F4C, 0x1A, 'Turnip market'], [0x15F66, 0x8, 'Weather (today and tomorrow)'], [0x15F6E, 0x2, 'Padding'], [0x15F70, 0x14, 'Crazy Redd’s shop'], [0x15F84, 0x12, 'Able Sisters’ accessories'],
    [0x15F96, 0x12, 'Snowmen (3)'], [0x15FA8, 0x8, 'Town tune (16 notes)'], [0x15FB0, 0x4, 'Happy Room Academy date'], [0x15FB4, 0x8, 'Clock offset'], [0x15FBC, 0x9, 'Item sort orders'],
    [0x15FC5, 0x5, 'Town founding day'], [0x15FCA, 0xE, 'Katie (lost child) record'], [0x15FD8, 0x4, 'Town event flags (32)'], [0x15FDC, 0x4, 'Checksum and save generation'],
  ];  function regionOf(o) { for (const r of REGIONS) if (o >= r[0] && o < r[0] + r[1]) return r; return null; }
  window.WW_REGIONS = { REGIONS, regionOf };

  let open = REGIONS[0], page = 0, diff = null;

  VIEWS.push({
    id: 'advanced', group: 'Lab', icon: '🧪', title: () => 'Advanced', sub: () => 'Every byte, for the curious',
    tips: ['Yellow bytes in the hex view are ones you’ve changed since opening the file.', 'Use Save Diff: save in-game, change one thing, save again, then compare both files to find where that flag lives!'],
    hello: () => 'Welcome to the lab! Everything here is raw. If a box isn’t labeled, nobody knows what it does yet... maybe you’ll be the first!',
    render(s, { refresh }) {
      const orig = APP.original;
      const origBlock = orig ? orig.slice(s.copyUsed ? C.BLOCK : 0, (s.copyUsed ? C.BLOCK : 0) + C.BLOCK) : null;
      const health = card(
        row('Region', s.region, h('span', { class: 'badge ok' }, s.region)),
        row('Copy 1', s.copyStatus[0] ? 'Checksum valid' : 'Checksum broken', h('span', { class: 'badge ' + (s.copyStatus[0] ? 'ok' : 'warn') }, s.copyStatus[0] ? 'OK' : 'Damaged')),
        row('Copy 2', s.copyStatus[1] ? 'Checksum valid' : 'Checksum broken', h('span', { class: 'badge ' + (s.copyStatus[1] ? 'ok' : 'warn') }, s.copyStatus[1] ? 'OK' : 'Damaged')),
        row('Copy in use', 'The game picks copy 2 when both are valid and their generation bytes match, otherwise copy 1. This editor follows the same rule.', h('b', null, `Copy ${s.copyUsed + 1}`)),
        row('Save generation', 'Byte the game bumps to tell the two copies apart. Saving always writes both copies with this same value.', numberInput(() => s.u8(0x15FDF), UI.guard('gen', 'Change the save generation?', 'The game uses this byte to decide which copy is newest. It is safe only because the editor writes both copies identically, but there is no reason to change it.', v => s.set8(0x15FDF, v)), { max: 255, width: 'w-s' }), 0x15FDF, { risk: 'high' }),
        row('Town hall mailbox checksum', s.lettersValid ? 'Valid' : 'Will be repaired on save', h('span', { class: 'badge ' + (s.lettersValid ? 'ok' : 'warn') }, s.lettersValid ? 'OK' : 'Fix on save')),
        row('Checksums refreshed on save', `Main block, ${C.SUB_BLOCKS.length} inner blocks and the mailbox. Both copies are written identically.`, h('span', { class: 'badge ok' }, 'Automatic')),
        row('Download untouched backup', 'The exact bytes you opened, for safekeeping.', h('button', { class: 'btn small', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([orig])), download: s.fileName.replace(/(\.\w+)?$/, ' (backup)$1') }); document.body.append(a); a.click(); a.remove(); } }, '⬇︎ Backup')));

      // ---- region list + hex ----
      const list = h('div', { class: 'region-list' }, REGIONS.map(r => {
        const changed = origBlock && [...Array(r[1]).keys()].some(i => origBlock[r[0] + i] !== s.u8(r[0] + i));
        return h('div', { class: 'region' + (r === open ? ' on' : ''), onclick: () => { open = r; page = 0; sfx.click(); refresh(); } },
          h('span', { class: 'o' }, hex(r[0], 5)), h('span', { class: 'nm' }, r[2], changed ? ' ✏️' : ''), h('span', { class: 'sz' }, `${r[1].toLocaleString()} B`));
      }));
      const PER = 256, pages = Math.ceil(open[1] / PER);
      const start = open[0] + page * PER, end = Math.min(open[0] + open[1], start + PER);
      let selected = -1;
      const editVal = h('input', { class: 'field mono w-s', placeholder: 'hex', maxlength: 2 });
      const selLabel = h('span', { class: 'mono muted' }, 'Click a byte');
      const hexEl = h('div', { class: 'hex' });
      for (let o = start; o < end; o += 16) {
        const by = h('div', { class: 'by' }), as = [];
        for (let i = o; i < Math.min(o + 16, end); i++) {
          const v = s.u8(i);
          const b = h('span', { class: 'b' + (v === 0 ? ' z' : '') + (origBlock && origBlock[i] !== v ? ' ch' : '') }, v.toString(16).toUpperCase().padStart(2, '0'));
          b.onclick = () => { hexEl.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); selected = i; selLabel.textContent = `${hex(i, 5)} = ${hex(s.u8(i), 2)} (${s.u8(i)})`; editVal.value = s.u8(i).toString(16).toUpperCase(); editVal.focus(); editVal.select(); };
          by.append(b); as.push(v >= 0x20 && v < 0x7F ? String.fromCharCode(v) : '·');
        }
        hexEl.append(h('div', { class: 'ln' }, h('span', { class: 'ad' }, hex(o, 5)), by, h('span', { class: 'as' }, as.join(''))));
      }
      editVal.addEventListener('keydown', e => { if (e.key === 'Enter' && selected >= 0) { const v = parseInt(editVal.value, 16); if (v >= 0 && v <= 255) { s.set8(selected, v); sfx.click(); refresh(); } } });
      const pager = h('div', { class: 'btn-row', style: { padding: '10px 14px', alignItems: 'center' } },
        h('button', { class: 'btn small', disabled: page === 0, onclick: () => { page--; refresh(); } }, '‹'),
        h('span', { class: 'muted' }, `Page ${page + 1} of ${pages}`),
        h('button', { class: 'btn small', disabled: page >= pages - 1, onclick: () => { page++; refresh(); } }, '›'),
        h('span', { class: 'spacer' }), selLabel, editVal, h('span', { class: 'muted', style: { fontSize: '11px' } }, '⏎ to write'));

      // ---- poke ----
      let pokeOff = 0, pokeVal = 0, pokeW = 1;
      const poke = card(row('Write any value', 'Offset inside the main block (0 to 0x15FDB). Checksums are fixed automatically on save.', h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        textInput(() => '0x0', v => { pokeOff = parseInt(v, 16) || 0; }, 8, { width: 'w-s' }),
        h('select', { class: 'field', onchange: e => { pokeW = Number(e.target.value); } }, [1, 2, 4].map(w => h('option', { value: w }, `${w * 8}-bit`))),
        textInput(() => '0', v => { pokeVal = Number(v.startsWith('0x') ? parseInt(v, 16) : v) || 0; }, 12, { width: 'w-s' }),
        h('button', { class: 'btn small leaf', onclick: () => UI.guard('poke', 'Write raw bytes?', 'Raw writes skip every safety check in this editor. A wrong offset can corrupt residents, villagers or the town. Checksums are still fixed on save, but they can’t fix bad data.', () => {
          if (pokeOff < 0 || pokeOff + pokeW > 0x15FDC) { toast('Offset out of range', '⚠️'); return; }
          ({ 1: (o, v) => s.set8(o, v), 2: (o, v) => s.set16(o, v), 4: (o, v) => s.set32(o, v) })[pokeW](pokeOff, pokeVal);
          sfx.bell(); toast(`Wrote ${pokeVal} at ${hex(pokeOff, 5)}`, '✍️'); refresh();
        })() }, 'Write')), undefined, { risk: 'high' }));

      // ---- diff ----
      const diffBody = h('div');
      function showDiff(other, label) {
        let ob;
        try { const o = new WWSave(other, label); ob = o.m; } catch (e) { toast(e.message, '⚠️'); return; }
        const ranges = [];
        for (let i = 0; i < C.BLOCK; i++) {
          if (i >= 0x15FDC) break;
          if (ob[i] !== s.u8(i)) { const last = ranges[ranges.length - 1]; if (last && i - last[1] <= 2) last[1] = i; else ranges.push([i, i]); }
        }
        diff = { label, ranges };
        renderDiff(ob);
      }
      function renderDiff(ob) {
        if (!diff) { diffBody.replaceChildren(h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🔬'), 'Open a second save to see every byte that differs, grouped by region.')); return; }
        diffBody.replaceChildren(h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 't' }, `${diff.ranges.length} changed spots vs “${diff.label}”`))),
          ...diff.ranges.slice(0, 300).map(([a, b]) => {
            const r = regionOf(a);
            const rel = r ? ` (+${(a - r[0]).toString(16).toUpperCase()})` : '';
            return h('div', { class: 'region', onclick: () => { open = r || open; page = r ? Math.floor((a - r[0]) / 256) : 0; refresh(); } },
              h('span', { class: 'o' }, hex(a, 5)), h('span', { class: 'nm' }, (r ? r[2] : '?') + rel),
              h('span', { class: 'mono', style: { fontSize: '11px' } }, `${[...ob.slice(a, b + 1)].map(x => x.toString(16).padStart(2, '0')).join(' ').slice(0, 30)} → ${[...s.bytes(a, b - a + 1)].map(x => x.toString(16).padStart(2, '0')).join(' ').slice(0, 30)}`));
          }));
      }
      renderDiff(null);
      const f2 = h('input', { type: 'file', hidden: true });
      f2.onchange = async () => { const f = f2.files[0]; if (f) showDiff(new Uint8Array(await f.arrayBuffer()), f.name); f2.value = ''; };

      return [section('Save health'), health,
        section('Every region', 'From the decompiled save layout'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: '14px', alignItems: 'start' } },
          h('div', { class: 'card' }, list),
          h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', { class: 't' }, open[2], h('span', { class: 'off' }, `${hex(open[0], 5)} · ${open[1]} bytes`)))), hexEl, pager)),
        section('Raw write'), poke,
        section('Save diff', 'Find hidden flags'),
        h('div', { class: 'btn-row', style: { marginBottom: '10px' } },
          h('button', { class: 'btn', onclick: () => f2.click() }, '📂 Compare with another save…'),
          h('button', { class: 'btn', onclick: () => showDiff(APP.original, 'the file as opened') }, '✏️ Show my edits'), f2),
        h('div', { class: 'card' }, diffBody)];
    },
  });
})();
