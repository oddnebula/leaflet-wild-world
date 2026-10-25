// Town card: one shareable image of the town, drawn entirely by Leaflet (no game art): the map from above, native
// fruit, town tune, flag, residents, neighbors and a few milestones. Export as PNG or copy to the clipboard.
(function () {
  'use strict';
  const { h, fmt, sfx, toast, item, card, row, section } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const byId = new Map(D.villagers.map(v => [v.id, v]));
  const MAP = 0xC354, ACRES = 0xC330, VB = 0x8A3C, FLAG = 0x15930, MUSEUM = 0x15D50, SONGS = 0xFAEC;
  const FRUIT = [['🍎', 'Apples'], ['🍊', 'Oranges'], ['🍐', 'Pears'], ['🍑', 'Peaches'], ['🍒', 'Cherries']];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const HOUSE = ['Small house', 'Medium house', 'Large house', 'Two floors', 'Two floors + west room', 'Two floors + east room', 'Mansion'];
  const NOTE_COL = ['#e2574c', '#f08a3e', '#f2c230', '#9bcf3c', '#4fbf6a', '#3cb9b0', '#43a3e6', '#5a7be0', '#8f6ee0', '#c463d6', '#e65fa8', '#e2574c', '#f08a3e'];
  const NOTE_NAME = ['G', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'E'];
  const THEMES = {
    meadow: { bg: ['#bfe7b0', '#8fd18a'], card: '#fff9e8', ink: '#5a3b1c', soft: '#8a6a44', edge: '#e5c98f', accent: '#3a9a3e' },
    sunset: { bg: ['#ffd6a0', '#f59a7a'], card: '#fff6ea', ink: '#5a2f1c', soft: '#9a5f44', edge: '#f0c08f', accent: '#d9603b' },
    night: { bg: ['#28305f', '#46407a'], card: '#f6f1ff', ink: '#2c2450', soft: '#6a5f94', edge: '#c9bdf0', accent: '#6c5fd6' },
    snow: { bg: ['#dceffc', '#b5d6ee'], card: '#ffffff', ink: '#30465c', soft: '#6a8299', edge: '#c5dbec', accent: '#3d86c4' },
  };
  const opts = { map: true, flag: true, tune: true, residents: true, neighbors: true, stats: true, theme: 'meadow', square: false };
  const FONT = '"Nunito", ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  function rr(g, x, y, w, hh, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const text = (g, t, x, y, size, color, weight = 800, align = 'left') => { g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(t, x, y); return g.measureText(t).width; };
  const emoji = (g, e, x, y, size) => { g.font = `${size}px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, x, y); };
  function fit(g, t, max, size, weight = 800) { g.font = `${weight} ${size}px ${FONT}`; while (size > 10 && g.measureText(t).width > max) { size--; g.font = `${weight} ${size}px ${FONT}`; } return size; }

  // The town from above: Leaflet's own acre drawings with a dot for every tree, flower, rock and building.
  async function drawMap(g, s, x, y, size) {
    const cell = size / 64, imgs = {};
    await Promise.all([...Array(16).keys()].map(k => new Promise(res => {
      const a = s.u8(ACRES + ((k >> 2) + 1) * 6 + (k & 3) + 1), url = window.WW_ACRE_IMAGES && WW_ACRE_IMAGES[a];
      if (!url) return res(); const im = new Image(); im.onload = im.onerror = res; im.src = url; imgs[k] = im;
    })));
    g.save(); rr(g, x, y, size, size, 18); g.clip();
    g.fillStyle = '#5fae5a'; g.fillRect(x, y, size, size);
    g.imageSmoothingEnabled = false;
    for (let k = 0; k < 16; k++) if (imgs[k] && imgs[k].complete && imgs[k].naturalWidth) g.drawImage(imgs[k], x + (k & 3) * 16 * cell, y + (k >> 2) * 16 * cell, 16 * cell, 16 * cell);
    const col = window.WW_MAP_COLORS || (() => null);
    for (let i = 0; i < 4096; i++) {
      const id = s.u16(MAP + i * 2), c = col(id); if (!c || item(id).cat === 'Occupied Space') continue;
      const a = i >> 8, px = x + ((a & 3) * 16 + (i & 15)) * cell, py = y + ((a >> 2) * 16 + ((i >> 4) & 15)) * cell;
      g.fillStyle = c;
      if (item(id).cat === 'Buildings') { rr(g, px - cell * 0.3, py - cell * 0.3, cell * 1.6, cell * 1.6, 3); g.fill(); }
      else { g.beginPath(); g.arc(px + cell / 2, py + cell / 2, cell * 0.42, 0, 7); g.fill(); }
    }
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 5; rr(g, x, y, size, size, 18); g.stroke();
  }
  function drawFlag(g, s, x, y, size, T) {
    const pal = D.palettes[s.u8(FLAG + 0x226) >> 4] || D.palettes[0], c = size / 32;
    g.fillStyle = T.edge; rr(g, x - 6, y - 6, size + 12, size + 12, 12); g.fill();
    g.fillStyle = '#fff'; g.fillRect(x, y, size, size);
    for (let i = 0; i < 1024; i++) { const b = s.u8(FLAG + (i >> 1)), v = i & 1 ? b >> 4 : b & 15; if (!v) continue; g.fillStyle = pal[v - 1]; g.fillRect(x + (i & 31) * c, y + (i >> 5) * c, Math.ceil(c), Math.ceil(c)); }
  }
  function drawTune(g, s, x, y, w, hh) {
    const notes = []; for (let i = 0; i < 8; i++) { const b = s.u8(0x15FA8 + i); notes.push(b & 15, b >> 4); }
    const bw = w / 16;
    notes.forEach((n, i) => {
      const bx = x + i * bw + 2;
      if (n <= 12) { const bh = 14 + (n / 12) * (hh - 30); g.fillStyle = NOTE_COL[n]; rr(g, bx, y + hh - 16 - bh, bw - 4, bh, 6); g.fill(); text(g, NOTE_NAME[n], bx + (bw - 4) / 2, y + hh - 2, 12, '#00000088', 800, 'center'); }
      else { text(g, n === 13 ? '?' : n === 14 ? '—' : '·', bx + (bw - 4) / 2, y + hh - 22, 18, '#00000066', 900, 'center'); }
    });
  }
  function chips(g, list, x, y, w, T, max = 8) {
    let cx = x, cy = y; const H = 38;
    for (const [em, label] of list.slice(0, max)) {
      g.font = `800 17px ${FONT}`; const tw = g.measureText(label).width + 52;
      if (cx + tw > x + w) { cx = x; cy += H + 8; }
      g.fillStyle = '#ffffff'; rr(g, cx, cy, tw, H, 19); g.fill(); g.strokeStyle = T.edge; g.lineWidth = 2; g.stroke();
      emoji(g, em, cx + 20, cy + H / 2 + 1, 20); text(g, label, cx + 36, cy + 25, 17, T.ink);
      cx += tw + 8;
    }
    return cy + H;
  }
  function stats(s) {
    let museum = 0;
    for (const [o, n] of [[0, 52], [0x1B, 56], [0x38, 56], [0x55, 20]]) for (let i = 0; i < n; i++) { const b = s.u8(MUSEUM + o + (i >> 1)); if (i & 1 ? b >> 4 : b & 15) museum++; }
    const songs = D.songs.filter((n, i) => n && i < 70 && s.bit(SONGS, i)).length;
    const size = window.WW_HOUSE ? WW_HOUSE.getF(s, 'size') : 0;
    return [['🏛️', `${museum}/184`, 'Museum'], ['🎸', `${songs}/70`, 'K.K. songs'], ['🏠', HOUSE[Math.min(size, 6)], 'House']];
  }

  async function render(s) {
    const T = THEMES[opts.theme] || THEMES.meadow, W = opts.square ? 1080 : 1200, H = opts.square ? 1080 : 675;
    const cv = h('canvas', { width: W, height: H }), g = cv.getContext('2d');
    try { await document.fonts.load(`900 40px Nunito`); await document.fonts.load(`800 18px Nunito`); } catch (e) { /* system font */ }
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, T.bg[0]); bg.addColorStop(1, T.bg[1]); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.12)'; for (let yy = 0; yy < H; yy += 28) for (let xx = (yy / 28 % 2) * 14; xx < W; xx += 28) { g.beginPath(); g.arc(xx, yy, 3, 0, 7); g.fill(); }
    const M = 28; g.fillStyle = T.card; rr(g, M, M, W - 2 * M, H - 2 * M, 34); g.fill(); g.strokeStyle = T.edge; g.lineWidth = 4; g.stroke();
    const town = s.str(4, 8) || 'My town', fruit = FRUIT[s.u32(0x15E58)] || FRUIT[0];
    const fd = s.u8(0x15FC5), fm = s.u8(0x15FC6), fy = s.u8(0x15FC7);
    const x0 = M + 30, y0 = M + 30, inner = W - 2 * M - 60, sq = opts.square;
    // Wide: map on the left, everything else beside it. Square: name, fruit and tune across the top, then the map
    // with people and milestones beside it.
    let mapSize = 0, cx = x0, cw = inner;
    if (opts.map && !sq) { mapSize = H - 2 * M - 60; await drawMap(g, s, x0, y0, mapSize); cx = x0 + mapSize + 34; cw = W - M - 30 - cx; }
    const ts = fit(g, town, cw - (opts.flag ? 130 : 0), sq ? 76 : 64, 900);
    text(g, town, cx, y0 + ts, ts, T.ink, 900);
    const sub = fm ? `A Wild World town since ${MONTHS[fm - 1]} ${fd}, 20${String(fy).padStart(2, '0')}` : 'A Wild World town';
    text(g, sub, cx, y0 + ts + 32, fit(g, sub, cw - (opts.flag ? 130 : 0), 19, 750), T.soft, 750);
    if (opts.flag) drawFlag(g, s, cx + cw - 104, y0 + 4, 96, T);
    let y = Math.max(y0 + ts + 62, opts.flag ? y0 + 120 : 0);
    g.fillStyle = '#ffffff'; rr(g, cx, y, 180, 64, 18); g.fill(); g.strokeStyle = T.edge; g.lineWidth = 2; g.stroke();
    emoji(g, fruit[0], cx + 34, y + 33, 34); text(g, fruit[1], cx + 62, y + 28, 19, T.ink); text(g, 'native fruit', cx + 62, y + 49, 14, T.soft, 700);
    if (opts.tune) { const tx = cx + 196, tw = Math.min(cw - 196, 460); g.fillStyle = '#ffffff'; rr(g, tx, y, tw, 64, 18); g.fill(); g.stroke(); drawTune(g, s, tx + 8, y + 4, tw - 16, 58); }
    y += 90;
    if (opts.map && sq) { mapSize = Math.min(H - M - 60 - y, Math.round(inner * 0.6)); await drawMap(g, s, x0, y, mapSize); cx = x0 + mapSize + 30; cw = inner - mapSize - 30; }
    const ps = [0, 1, 2, 3].filter(p => s.playerExists(p));
    if (opts.residents && ps.length) { text(g, 'RESIDENTS', cx, y + 4, 14, T.accent, 900); y = chips(g, ps.map(p => ['🙂', s.str(s.playerBase(p) + 0x2282, 8)]), cx, y + 14, cw, T) + 26; }
    if (opts.neighbors) {
      const ns = [...Array(8).keys()].map(n => s.u8(VB + n * 0x700 + 0x6CB)).filter(id => id !== 0xFF).map(id => { const v = byId.get(id); return [window.WW_SPECIES_EMOJI ? WW_SPECIES_EMOJI(v?.species) : '🐾', v?.name || '?']; });
      if (ns.length) { text(g, 'NEIGHBORS', cx, y + 4, 14, T.accent, 900); y = chips(g, ns, cx, y + 14, cw, T) + 26; }
    }
    if (opts.stats) {
      const st = stats(s), stack = sq && opts.map;   // beside a square map there's room for one column
      const sw = stack ? cw : (cw - 24) / 3;
      st.forEach(([em, val, label], i) => {
        const bx = stack ? cx : cx + i * (sw + 12), by = stack ? y + i * 80 : y;
        g.fillStyle = '#ffffff'; rr(g, bx, by, sw, 70, 18); g.fill(); g.strokeStyle = T.edge; g.lineWidth = 2; g.stroke();
        emoji(g, em, bx + 30, by + 35, 28); const vs = fit(g, val, sw - 66, 22, 900); text(g, val, bx + 54, by + 33, vs, T.ink, 900); text(g, label, bx + 54, by + 55, 14, T.soft, 700);
      });
    }
    text(g, '🍃 Made with Leaflet · a Wild World save editor', W - M - 26, H - M - 18, 14, T.soft, 750, 'right');
    return cv;
  }

  VIEWS.push({
    id: 'card', group: 'Town', icon: '🪪', title: () => 'Town Card', sub: s => `A picture of ${s.str(4, 8)} to share`,
    tips: ['The card is drawn entirely by Leaflet, so it has no game art in it and is safe to post anywhere.', 'Turn sections off to keep things private, for example resident names.'],
    render(s, { refresh }) {
      const holder = h('div', { class: 'tc-holder' }, h('div', { class: 'muted', style: { padding: '40px', textAlign: 'center' } }, 'Drawing your town…'));
      let cv = null;
      render(s).then(c => { cv = c; c.className = 'tc-canvas'; holder.replaceChildren(c); }).catch(e => { holder.replaceChildren(h('div', { class: 'muted', style: { padding: '20px' } }, 'The card couldn’t be drawn: ' + e.message)); });
      const name = () => `${(s.str(4, 8) || 'town').trim()} town card.png`;
      const download = () => { if (!cv) return; cv.toBlob(b => { const a = h('a', { href: URL.createObjectURL(b), download: name() }); document.body.append(a); a.click(); a.remove(); sfx.bell(); toast('Town card saved', '🪪'); }); };
      const copy = () => { if (!cv) return; cv.toBlob(async b => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); sfx.bell(); toast('Copied. Paste it anywhere', '📋'); } catch (e) { toast('Copying images isn’t allowed here. Use Download instead.', '⚠️'); } }); };
      const sw = (k, label) => h('label', { class: 'cal-filter' }, UI.switchInput(() => opts[k], v => { opts[k] = v; refresh(); }), label);
      return [
        h('div', { class: 'card pad cat-bar' },
          sw('map', '🗺️ Map'), sw('flag', '🚩 Flag'), sw('tune', '🎵 Tune'), sw('residents', '🙂 Residents'), sw('neighbors', '🐾 Neighbors'), sw('stats', '🏛️ Milestones'),
          h('span', { class: 'spacer' }),
          UI.selectInput([[0, 'Meadow'], [1, 'Sunset'], [2, 'Night'], [3, 'Snow']], () => Object.keys(THEMES).indexOf(opts.theme), v => { opts.theme = Object.keys(THEMES)[v]; refresh(); }, { width: 'w-m' }),
          UI.seg([[0, 'Wide'], [1, 'Square']], () => (opts.square ? 1 : 0), v => { opts.square = !!v; refresh(); })),
        h('div', { class: 'card pad' }, holder,
          h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '12px' } },
            h('button', { class: 'btn leaf', onclick: download }, '⬇︎ Download PNG'), h('button', { class: 'btn', onclick: copy }, '📋 Copy image'))),
        h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '6px' } }, 'Everything on the card is drawn by Leaflet from your save, with no game art, so it’s yours to share.'),
      ];
    },
  });
  window.WW_TOWN_CARD = { render, opts };
})();
