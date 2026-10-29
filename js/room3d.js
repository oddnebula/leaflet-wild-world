// A house room in 3D with the game's own furniture models, read from the player's ROM: ftr/{n >> 8}/{(n & 0xFF) >> 4}/{n}.arc
// (an LZ-compressed NARC holding the NSBMD) and its textures in the matching .nsbtx, wallpaper wall/wall_{k}.nsbtx and
// flooring carpet/floor_{k}.nsbtx. Placement follows FtrActor: a tile is 2 units, the model sits on its anchor tile's
// center turned by direction × 90°, 2×2 pieces move to the middle of their four tiles, a 2×1 piece reaches along its own
// +x, and items on the top layer rest at the height of the piece below them (FtrInfo_GetDmaUnk03Fx). The floor and walls
// are drawn by Leaflet itself.
(function () {
  'use strict';
  const M3 = () => window.Model3D;
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const TILE = 2, WALL_H = 5;
  // Footprint tiles per shape (ftr_info/always.bin byte 5) and direction (sFtrFootprintTables).
  const FOOT = [
    [[[0, 0]], [[0, 0]], [[0, 0]], [[0, 0]]],
    [[[0, 0], [1, 0]], [[0, 0], [0, -1]], [[0, 0], [-1, 0]], [[0, 0], [0, 1]]],
    [[[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]]],
  ];

  // The member of a NARC with the given magic (a furniture .arc can also hold BMA0 / BTA0 animations).
  function narcFind(b, magic) {
    if (!b || String.fromCharCode(...b.subarray(0, 4)) !== 'NARC') return b;
    const fat = 0x10, n = u16(b, fat + 8);
    let o = fat + u32(b, fat + 4); o += u32(b, o + 4);   // skip BTAF and BTNF to GMIF
    for (let i = 0; i < n; i++) {
      const f = b.subarray(o + 8 + u32(b, fat + 12 + i * 8), o + 8 + u32(b, fat + 16 + i * 8));
      if (String.fromCharCode(...f.subarray(0, 4)) === magic) return f;
    }
    return null;
  }
  const info = () => { const R = window.ROM; return { a: R.file('ftr_info/always.bin'), d: R.file('ftr_info/dma.bin') }; };

  // One piece of furniture in its own coordinates, cached per furniture index.
  const cache = new Map();
  function piece(n) {
    if (cache.has(n)) return cache.get(n);
    const R = window.ROM, dir = `ftr/${n >> 8}/${(n & 0xFF) >> 4}/${n.toString(16).padStart(4, '0')}`;
    let out = null;
    try {
      const m = narcFind(R.file(dir + '.arc'), 'BMD0');
      if (m && String.fromCharCode(...m.subarray(0, 4)) === 'BMD0') {
        const M = M3().parseModel(m), own = M3().ownTex(m), tf = R.file(dir + '.nsbtx'), T = tf ? M3().parseTex(tf, 0) : null;
        out = M3().modelGroups(M, null, mat => { for (const X of [T, own]) if (X && mat.tex in X.texs) return M3().decodeTex(X, mat.tex, mat.pal); return null; }).groups;
      }
    } catch (e) { out = null; }
    cache.set(n, out);
    return out;
  }
  // Copies groups with each vertex turned by `ang` around Y, then moved to (tx, ty, tz).
  function place(groups, ang, tx, ty, tz) {
    const c = Math.round(Math.cos(ang)), s = Math.round(Math.sin(ang));
    return groups.map(g => ({ ...g, verts: g.verts.map(v => [v[0] * c + v[2] * s + tx, v[1] + ty, -v[0] * s + v[2] * c + tz, v[3], v[4], v[5], v[6], v[7]]) }));
  }
  // A textured quad (two triangles) with texture repeats given in pixels.
  function quad(p, tex, us, vs, shade) {
    const [a, b, c, d] = p, S = tex ? tex.w * us : 1, T = tex ? tex.h * vs : 1;
    const v = (q, s, t) => [q[0], q[1], q[2], s, t, shade, shade, shade];
    return { verts: [v(a, 0, T), v(b, S, T), v(c, S, 0), v(a, 0, T), v(c, S, 0), v(d, 0, 0)], tex, tw: tex ? tex.w : 1, th: tex ? tex.h : 1, repS: 1, repT: 1, flipS: 0, flipT: 0 };
  }
  function decor(file, name) {
    const f = window.ROM.file(file); if (!f) return null;
    const T = M3().parseTex(f, 0); return M3().decodeTex(T, name in T.texs ? name : Object.keys(T.texs)[0], Object.keys(T.pals)[0]);
  }

  // The whole room: items(x, y, layer) gives the item id on that tile. area = {x, y, w, h} in tiles.
  function scene({ items, area, wall, floor }) {
    const R = window.ROM;
    if (!R || !R.ready || !R.file('ftr_info/always.bin') || !R.file('ftr/0/0/0000.arc')) return null;
    const { a, d } = info(), groups = [], missing = [];
    const x0 = area.x * TILE, z0 = area.y * TILE, x1 = (area.x + area.w) * TILE, z1 = (area.y + area.h) * TILE;
    const fl = floor >= 0x1144 && floor <= 0x1187 ? decor(`carpet/floor_${floor - 0x1144}.nsbtx`, 'floor') : null;
    const wl = wall >= 0x1100 && wall <= 0x1143 ? decor(`wall/wall_${wall - 0x1100}.nsbtx`, 'wall') : null;
    const fw = area.w / 2, fh = area.h / 2, ww = area.w;
    groups.push(quad([[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]], fl, fw, fh, 1));
    groups.push(quad([[x0, 0, z0], [x1, 0, z0], [x1, WALL_H, z0], [x0, WALL_H, z0]], wl, ww, 1, 0.95));
    groups.push(quad([[x0, 0, z1], [x0, 0, z0], [x0, WALL_H, z0], [x0, WALL_H, z1]], wl, area.h, 1, 0.8));
    groups.push(quad([[x1, 0, z0], [x1, 0, z1], [x1, WALL_H, z1], [x1, WALL_H, z0]], wl, area.h, 1, 0.8));
    // Floor layer first, remembering which piece covers each tile so top items know how high to sit.
    const under = new Map();
    for (const layer of [0, 1]) {
      for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) {
        const id = items(x, y, layer);
        if (id < 0x3000 || id >= 0x5000) continue;
        const n = Math.min((id - 0x3000) >> 2, 0x6E8), dirn = id & 3, shape = a[n * 8 + 5] || 0;
        const g = piece(n);
        if (!g) { missing.push(id); continue; }
        let tx = x * TILE + 1, tz = y * TILE + 1;
        if (shape === 2) { tx += 1; tz += 1; }
        const ty = layer ? (under.get(y * 16 + x) || 0) : 0;
        groups.push(...place(g, dirn * Math.PI / 2, tx, ty, tz));
        if (!layer) for (const [dx, dz] of FOOT[shape] ? FOOT[shape][dirn] : [[0, 0]]) under.set((y + dz) * 16 + x + dx, d[n * 0x1C + 3] / 16);
      }
    }
    return { groups, missing };
  }

  // The tiles a piece covers, as [dx, dy] from its anchor (by shape and the direction in its id's low two bits), and how
  // tall it is in room units (where items placed on top of it sit). Without the ROM, one tile.
  function footprint(id) {
    if (id < 0x3000 || id >= 0x5000 || !window.ROM || !ROM.ready) return [[0, 0]];
    const a = ROM.file('ftr_info/always.bin'); if (!a) return [[0, 0]];
    const n = Math.min((id - 0x3000) >> 2, 0x6E8), shape = a[n * 8 + 5] || 0;
    return FOOT[shape] ? FOOT[shape][id & 3] : [[0, 0]];
  }
  function height(id) {
    if (id < 0x3000 || id >= 0x5000 || !window.ROM || !ROM.ready) return 1;
    const d = ROM.file('ftr_info/dma.bin'); if (!d) return 1;
    return d[Math.min((id - 0x3000) >> 2, 0x6E8) * 0x1C + 3] / 16;
  }
  window.Room3D = { scene, piece, footprint, height, TILE };
})();
