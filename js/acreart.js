// Original acre thumbnails (32×32, one pixel per two map spots), drawn from each acre's description: rivers and their
// directions, forks, waterfalls, bridges, ponds, beaches, cliffs and buildings. No game artwork is used.
(function () {
  'use strict';
  const C = { grass: '#5fae5a', grass2: '#6dbd63', water: '#4fa7dc', deep: '#3d86c4', sand: '#ecd9a0', cliff: '#3f7d45', cliffEdge: '#2f5f35', wood: '#a8743f', foam: '#e8f6ff' };
  const SIDES = { N: [16, 0], S: [16, 32], E: [32, 16], W: [0, 16] };

  function draw(name) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = C.grass; g.fillRect(0, 0, 32, 32);
    g.fillStyle = C.grass2; for (let y = 0; y < 32; y += 4) for (let x = (y / 4) % 2 * 2; x < 32; x += 4) g.fillRect(x, y, 1, 1);
    const river = sides => {
      g.strokeStyle = C.water; g.lineWidth = 5; g.lineCap = 'round';
      for (const s of sides) { g.beginPath(); g.moveTo(16, 16); g.lineTo(...SIDES[s]); g.stroke(); }
    };
    if (name === 'Ocean') { g.fillStyle = C.deep; g.fillRect(0, 0, 32, 32); return c; }
    if (/^Beachfront/.test(name)) {
      g.fillStyle = C.sand; g.fillRect(0, 18, 32, 8); g.fillStyle = C.water; g.fillRect(0, 26, 32, 6); g.fillStyle = C.foam; g.fillRect(0, 26, 32, 1);
      const m = name.match(/w\/ (\w+) River/); if (m) { g.save(); g.beginPath(); g.rect(0, 0, 32, 26); g.clip(); river(m[1].split('').filter(ch => SIDES[ch])); g.restore(); }
    }
    let m;
    if ((m = name.match(/^([NSEW])-([NSEW])/))) river([m[1], m[2]]);
    if ((m = name.match(/^([NSEW]{3}) Fork/))) river(m[1].split(''));
    if (/^Waterfall/.test(name)) { river(['N', 'S']); g.fillStyle = C.foam; g.fillRect(13, 0, 6, 4); g.fillStyle = C.cliff; g.fillRect(0, 0, 13, 4); g.fillRect(19, 0, 13, 4); }
    if (/Bridge/.test(name)) { const ns = /^N-S|^Beachfront w\/ S /.test(name); g.fillStyle = C.wood; if (ns) g.fillRect(11, 14, 10, 4); else g.fillRect(14, 11, 4, 10); }
    if (/Lake|Pond/.test(name)) { g.fillStyle = C.water; g.beginPath(); g.ellipse(/Pond/.test(name) ? 23 : 16, /Pond/.test(name) ? 23 : 16, 6, 4, 0, 0, 7); g.fill(); }
    if (/Wall|Corner/.test(name)) {
      g.fillStyle = C.cliff; g.strokeStyle = C.cliffEdge; g.lineWidth = 1;
      if (/^N |NW Corner|NE Corner/.test(name)) { g.fillRect(0, 0, 32, 7); g.fillStyle = C.cliffEdge; g.fillRect(0, 7, 32, 1); g.fillStyle = C.cliff; }
      if (/^W |NW Corner/.test(name)) { g.fillStyle = /Ocean/.test(name) ? C.deep : C.cliff; g.fillRect(0, 0, 7, 32); }
      if (/^E |NE Corner/.test(name)) { g.fillStyle = /Ocean/.test(name) ? C.deep : C.cliff; g.fillRect(25, 0, 7, 32); }
      if (/Gatehouse/.test(name)) { g.fillStyle = C.grass; g.fillRect(12, 0, 8, 8); }
      if (/Waterfall Gap/.test(name)) { g.fillStyle = C.water; g.fillRect(13, 0, 6, 8); }
    }
    const building = (col, w, h) => { g.fillStyle = col; g.fillRect(16 - w / 2, 12 - h / 2, w, h); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(16 - w / 2, 12 + h / 2, w, 1); };
    if (/^Gate/.test(name)) building('#c8553d', 10, 6);
    if (/^Home/.test(name)) { building('#e9c46a', 6, 5); g.fillStyle = '#e9c46a'; g.fillRect(6, 20, 5, 4); g.fillRect(21, 20, 5, 4); }
    if (/^Museum/.test(name)) building('#8d6e63', 12, 7);
    if (/^Store/.test(name)) building('#e07a5f', 9, 6);
    if (/^Town Hall/.test(name)) building('#c0a080', 12, 8);
    return c;
  }

  const images = {}, canvases = {};
  for (const [id, name] of window.WW_DATA.acres) { canvases[id] = draw(name); images[id] = canvases[id].toDataURL(); }
  window.WW_ACRE_IMAGES = images;
  window.WW_ACRE_CANVAS = canvases;   // the same drawings as pixels (the 3D town reads its ground from them)
  window.WW_ACRE_COLORS = C;
})();
