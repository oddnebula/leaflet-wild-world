// The town built from the game's own models, read from the player's ROM (nothing is bundled with Leaflet):
//  - each acre's ground, bg/a{id >> 4}/{id}.arc, with the season's ground textures bg/ct{grass}/grd_set{grass}{a–l}.nsbtx
//    picked from the save's grass byte (0xE554: grass pattern in the low two bits, ground season above them), the way
//    the game builds the name ("/bg/ct%d/grd_set%d%c.nsbtx"). The game draws acres bent around its rolling world (a
//    circle of radius 32 model units, one acre); Leaflet unbends them so the town lies flat to walk on;
//  - trees, cedars and palms by growth stage (fg/tree), summer or winter, with fruit on fruit-bearing trees and the
//    leaves coloured by the time of year from the tree palettes (tree_set{A–C}, one per grass pattern);
//  - flowers in their colours (fg/flower and their palette files), weeds, dandelions, clovers and rocks;
//  - every building: str/arc/{n}/str{n}{s|w}.arc for building item 0x50nn, the player's house with its roof colour
//    (str/plHsTex/home{roof}), each neighbour's house shape and one of the town's four house textures (the villager's
//    house byte from the ROM and the four style bytes at 0x1592C), and the gate (str/chkp/obj_check{0x15B58}).
// Models are 2 units per map spot; Leaflet's town is 1 unit per spot, so everything is halved.
(function () {
  'use strict';
  const M3 = () => window.Model3D, R = () => window.ROM;
  const MAP = 0xC354, ACRES = 0xC330, N = 64, GRASS = 0xE554, HOUSE_STYLES = 0x1592C, GATE = 0x15B58, HOUSE_STATE = 0xFAF8, VB = 0x8A3C;
  const hex4 = n => n.toString(16).padStart(4, '0');

  // ---------- cached ROM reads ----------
  const texSets = new Map(), models = new Map(), decoded = new Map();
  function texSet(path) {
    if (!texSets.has(path)) { let T = null; try { const f = R().file(path); if (f) T = M3().parseTex(f, 0); } catch (e) { T = null; } texSets.set(path, T); }
    return texSets.get(path);
  }
  function model(path) {
    if (!models.has(path)) {
      let m = null;
      try {
        const f = R().file(path), b = f && window.Room3D.narcFind(f, 'BMD0');
        if (b && String.fromCharCode(...b.subarray(0, 4)) === 'BMD0') m = { M: M3().parseModel(b), own: M3().ownTex(b) };
      } catch (e) { m = null; }
      models.set(path, m);
    }
    return models.get(path);
  }
  // A decoded texture; identical requests share one object, so they share one GPU texture and one batch.
  function tex(T, key, name, pal, palT) {
    const k = `${key}|${name}|${pal}|${palT ? palT.key : ''}`;
    if (!decoded.has(k)) { let d = null; try { if (T && name in T.texs) d = M3().decodeTex(T, name, pal, palT ? palT.T : null); } catch (e) { d = null; } decoded.set(k, d); }
    return decoded.get(k);
  }
  const first = o => Object.keys(o || {})[0];

  // ---------- batching: every triangle that shares a texture goes into one buffer ----------
  function batcher() {
    const B = new Map();
    function add(groups, xf, lit) {
      for (const g of groups) {
        if (!g.tex || !g.verts.length) continue;
        const glow = lit && lit.has(g.tex) ? 1 : 0, wrap = `${g.repS}${g.flipS}${g.repT}${g.flipT}${glow}`;
        let byTex = B.get(g.tex); if (!byTex) B.set(g.tex, byTex = new Map());
        let e = byTex.get(wrap); if (!e) byTex.set(wrap, e = { tex: g.tex, repS: g.repS, repT: g.repT, flipS: g.flipS, flipT: g.flipT, glow, data: [] });
        for (const v of g.verts) { const p = xf(v); e.data.push(p[0], p[1], p[2], v[3] / g.tw, v[4] / g.th, v[5], v[6], v[7]); }
      }
    }
    const list = () => [...B.values()].flatMap(m => [...m.values()]).map(e => ({ ...e, data: new Float32Array(e.data) }));
    return { add, list };
  }
  // Places a model (groups in model units) centred at map position (cx, cz), turned by `turn` quarter turns.
  const at = (cx, cz, y0 = 0, turn = 0, dx = 0, dz = 0) => v => {
    const c = Math.round(Math.cos(turn * Math.PI / 2)), s = Math.round(Math.sin(turn * Math.PI / 2)), x = v[0] + dx, z = v[2] + dz;
    return [cx + (x * c + z * s) / 2, y0 + v[1] / 2, cz + (-x * s + z * c) / 2];
  };

  // ---------- the time of year ----------
  // Leaf colours run through 22 palettes over the year: spring green, the April blossom, summer greens, yellowing,
  // autumn reds, bare browns and winter. The game's exact day-by-day table isn't decoded yet, so this follows the date.
  function leafIndex(d) {
    const doy = (d.getMonth() + 1) * 100 + d.getDate();
    if (doy < 225) return 20;
    if (doy < 301) return 21;
    const T = [[301, 0], [401, 1], [406, 2], [411, 3], [501, 4], [601, 5], [701, 6], [801, 7], [816, 8], [901, 9], [916, 10], [1001, 11], [1011, 12], [1016, 13], [1021, 14], [1101, 15], [1111, 16], [1121, 17], [1201, 18], [1211, 19], [1225, 20]];
    let k = 0; for (const [from, i] of T) if (doy >= from) k = i;
    return k;
  }

  // Flowers: model, and the palette index of each colour in item order (fg/flower/{kind}/{kind}_palette.nsbtx).
  const FLOWERS = [['tulip', 0x00, 6], ['pansy', 0x06, 6], ['cosmos', 0x0C, 6], ['rose', 0x12, 8]];
  function flower(id) {
    const base = id >= 0x1408 ? id - 0x1408 : id >= 0x6E && id <= 0x89 ? id - 0x6E : id;
    const parched = id >= 0x6E && id <= 0x89;
    if (base === 0x1A) return { kind: 'suzuran', idx: 0, parched };
    if (base === 0x1B) return { kind: 'rafflesia', idx: 0, parched };
    if (base === 0x1C) return { kind: 'rose', idx: 8, parched };
    for (const [kind, from, n] of FLOWERS) if (base >= from && base < from + n) return { kind, idx: base - from, parched };
    return null;
  }

  // Trees: [kind, size] from the item id; size is 'baby', '01'–'04', 'dead', or a stump.
  function tree(id) {
    const G = ['baby', '01', '02', '03', '04', '04'];
    if (id >= 0x25 && id <= 0x2A) return { kind: 'tree', size: G[id - 0x25] };
    if (id >= 0x2B && id <= 0x2E) return { kind: 'tree', stump: id - 0x2B + 1 };
    if (id >= 0x2F && id <= 0x5B) { const st = (id - 0x2F) % 8; return { kind: 'tree', size: ['baby', '01', '02', '03', '04', '04', '04', '04'][st], fruit: st === 4 }; }
    if (id >= 0x5C && id <= 0x60) return { kind: 'cedar', size: ['baby', '01', '02', '03', '04'][id - 0x5C] };
    if (id >= 0x61 && id <= 0x64) return { kind: 'cedar', stump: id - 0x61 + 1 };
    if (id === 0xC7) return { kind: 'palm', size: 'dead' };
    if (id >= 0xC8 && id <= 0xCF) return { kind: 'palm', size: ['baby', '01', '02', '03', '04', '04', '04', '04'][id - 0xC8] };
    if (id >= 0xD0 && id <= 0xD3) return { kind: 'palm', stump: id - 0xD0 + 1 };
    if (id >= 0xFF && id <= 0x102) return { kind: 'tree', stump: id - 0xFF + 1 };
    return null;
  }

  function available() {
    const r = R(); return !!(r && r.ready && r.file('bg/a0/0000.arc') && r.file('str/arc/0/str0s.arc') && r.file('fg/tree/tree_mdl/tree_04s.nsbmd'));
  }

  // buildings: [{ name, x0, z0, x1, z1 }] from Leaflet's own pass over the map (footprints from Occupied Space).
  function build(s, opts) {
    M3().lightNormals = true;
    try { return buildAll(s, opts); } finally { M3().lightNormals = false; }
  }
  function buildAll(s, { date, snowy, buildings }) {
    const B = batcher(), lit = new Set(), sw = snowy ? 'w' : 's';
    // Buildings share one palette per season (str/house_pl), bound by name.
    const housePal = texSet(`str/house_pl/house_pl_${sw}.nsbtx`), HP = housePal ? { T: housePal, key: `house_pl_${sw}` } : null;
    const grass = s.u8(GRASS), pattern = Math.min(2, grass & 3), gseason = Math.min(11, grass >> 2);
    const gpath = `bg/ct${pattern}/grd_set${pattern}${'abcdefghijkl'[gseason]}.nsbtx`, GT = texSet(gpath);
    // Ground.
    const unbend = v => { const yy = v[1] + 0.62, th = Math.atan2(v[2], yy), d = Math.hypot(v[2], yy); return [v[0], d - 32, 32 * th]; };
    for (let ay = 0; ay < 6; ay++) for (let ax = 0; ax < 6; ax++) {
      const id = s.u8(ACRES + ay * 6 + ax), m = model(`bg/a${id >> 4}/${hex4(id)}.arc`); if (!m || !GT) continue;
      const g = M3().modelGroups(m.M, null, mat => tex(GT, gpath, mat.tex, mat.pal in GT.pals ? mat.pal : first(GT.pals))).groups;
      B.add(g, v => { const u = unbend(v); return [(ax - 1) * 16 + u[0] / 2, u[1] / 2, (ay - 1) * 16 + u[2] / 2]; });
    }
    // A model with its own texture file (or textures inside it), optionally recoloured from a palette file.
    const put = (mpath, tpath, xf, palFor) => {
      const m = model(mpath); if (!m) return false;
      const T = tpath ? texSet(tpath) : null;
      const g = M3().modelGroups(m.M, null, mat => {
        const P = palFor && palFor(mat), src = T && mat.tex in T.texs ? T : m.own;
        const t = src ? tex(src, src === T ? tpath : mpath, mat.tex, P ? P.name : mat.pal, P ? P.palT : null) : null;
        if (t && /^lt_/.test(mat.tex)) lit.add(t);
        return t;
      }).groups;
      B.add(g, xf, lit);
      return true;
    };
    // Trees, flowers, weeds, rocks.
    const leafSet = texSet(`fg/tree/tree_pal/tree_set${'ABC'[pattern]}.nsbtx`), leaf = String(leafIndex(date)).padStart(2, '0');
    const leafPal = leafSet ? { T: leafSet, key: `set${pattern}` } : null;
    const idx = (x, y) => ((y >> 4) * 4 + (x >> 4)) * 256 + (y & 15) * 16 + (x & 15);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const id = s.u16(MAP + idx(x, y) * 2), cx = x + 0.5, cz = y + 0.5, xf = at(cx, cz);
      const t = tree(id);
      if (t) {
        if (t.stump) { const k = t.kind === 'tree' ? 'tree' : t.kind; put(`fg/tree/stamp/${k}0${Math.min(4, t.stump)}_stamp.nsbmd`, `fg/tree/stamp/${k}0${Math.min(4, t.stump)}_stamp.nsbtx`, xf); continue; }
        const sfx = snowy ? 'w' : t.fruit && t.kind === 'tree' ? 'f' : 's', name = `${t.kind}_${t.size}${sfx}`;
        put(`fg/tree/${t.kind}_mdl/${name}.nsbmd`, `fg/tree/${t.kind}_tex/${name}.nsbtx`, xf,
          t.kind === 'tree' && leafPal ? mat => (/leaf/.test(mat.tex) && t.size !== 'baby' && t.size !== 'dead' ? { name: `tree_leaf${leaf}_pl`, palT: leafPal } : null) : null);
        continue;
      }
      const f = flower(id);
      if (f) {
        const dir = f.kind === 'suzuran' || f.kind === 'rafflesia' || ['tulip', 'pansy', 'cosmos', 'rose'].includes(f.kind) ? `fg/flower/${f.kind}/` : 'fg/flower/';
        const palFile = texSet(`${dir}${f.kind}_palette.nsbtx`), palName = f.parched && palFile && `a_${f.kind}_s00_pl` in palFile.pals ? `a_${f.kind}_s00_pl` : `${f.kind}${String(f.idx).padStart(2, '0')}_pl`;
        put(`${dir}${f.kind}.nsbmd`, `${dir}${f.kind}.nsbtx`, xf, palFile ? () => ({ name: palName, palT: { T: palFile, key: f.kind } }) : null);
        continue;
      }
      if (id === 0x1D || id === 0x1E) { put('fg/flower/tanpopo.nsbmd', null, xf, null); continue; }
      if (id === 0x1F || id === 0x20) { put('fg/grass/clover.nsbmd', null, xf, null); continue; }
      if (id >= 0x21 && id <= 0x24) { const gp = texSet('fg/grass/grass_palette.nsbtx'); put(`fg/grass/grass${'ABCD'[id - 0x21]}.nsbmd`, null, xf, gp ? () => ({ name: `grass0${Math.min(9, gseason)}_pl`, palT: { T: gp, key: 'grass' } }) : null); continue; }
      if ((id >= 0xE3 && id <= 0xEC) || id === 0xE2) { put(`fg/stone/obj_stn${sw}.nsbmd`, null, xf, null); continue; }
    }
    // Buildings: centred on the spots they cover.
    const houseStyles = [0, 1, 2, 3].map(i => s.u8(HOUSE_STYLES + i)), houses = R().file('leaflet/houses.bin');
    const roof = (s.u32(HOUSE_STATE) >>> 6) & 15;
    for (const b of buildings) {
      const id = b.id, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const center = path => { const m = model(path); if (!m) return null; const g = M3().modelGroups(m.M, null, () => null).groups; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const gr of g) for (const v of gr.verts) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); } return [-(x0 + x1) / 2, -(z0 + z1) / 2]; };
      // Textures come from an override set (house colours, roofs), the model's own set, then its night-light set.
      const place = (mpath, tpath, override, litPath) => {
        const c = center(mpath); if (!c) return false;
        const m = model(mpath), srcs = [[override, texSet(override)], [tpath, texSet(tpath)], [litPath || tpath.replace('.nsbtx', '_lt.nsbtx'), texSet(litPath || tpath.replace('.nsbtx', '_lt.nsbtx'))]].filter(x => x[0] && x[1]);
        const g = M3().modelGroups(m.M, null, mat => {
          const src = srcs.find(([, T]) => mat.tex in T.texs); if (!src) return m.own && mat.tex in m.own.texs ? tex(m.own, mpath, mat.tex, mat.pal) : null;
          const t = mat.pal === 'house_pl' && HP ? tex(src[1], src[0], mat.tex, 'house_pl', HP) : tex(src[1], src[0], mat.tex, mat.pal in src[1].pals ? mat.pal : first(src[1].pals));
          if (t && /^lt_/.test(mat.tex)) lit.add(t);
          return t;
        }).groups;
        B.add(g, at(cx, cz, 0, 0, c[0], c[1]), lit);
        return true;
      };
      if (id >= 0x5001 && id <= 0x5008) {
        // A neighbour's house: its model and texture from the villager's house byte.
        const v = id - 0x5001, sp = s.u8(s.villagerBase(v) + 0x6CB), hb = houses && sp < 150 ? houses[4 + sp] : 0, t = hb & 31, slot = (hb >> 5) & 3, style = Math.min(24, houseStyles[slot]);
        const nm = `obj_house${t >> 2}_${t & 3}`, letter = 'ABCDE'[Math.floor(style / 5)];
        place(`str/npcHs/${t >> 2}/${nm}${sw}.arc`, `str/npcHs/${t >> 2}/${nm}${sw}.nsbtx`, `str/npcHsTex/${letter}/house_${letter}${style % 5}${sw}.nsbtx`, `str/npcHsTex/${letter}/light_${letter}${style % 5}.nsbtx`);
      } else if (id >= 0x5014 && id <= 0x501A) {
        const n = id & 0xFF;
        place(`str/arc/${n}/str${n}${sw}.arc`, `str/arc/${n}/str${n}${sw}.nsbtx`, `str/plHsTex/home${roof.toString(16).toUpperCase()}${sw}.nsbtx`);
      } else if (id === 0x500B) {
        const g = Math.min(2, s.u8(GATE));
        place(`str/chkp/obj_check${g}${sw}.arc`, `str/chkp/obj_check${g}${sw}.nsbtx`);
      } else if (id >= 0x5000 && id <= 0x5021) {
        const n = id & 0xFF;
        if (!place(`str/arc/${n}/str${n}${sw}.arc`, `str/arc/${n}/str${n}${sw}.nsbtx`) && sw === 's') place(`str/arc/${n}/str${n}w.arc`, `str/arc/${n}/str${n}w.nsbtx`);
      }
    }
    return B.list();
  }

  window.TownModels = { available, build, leafIndex };
})();
