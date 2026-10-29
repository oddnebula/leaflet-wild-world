// Renders Wild World's own 3D models (NSBMD + NSBTX, read from the player's ROM) with WebGL.
// Villager model = npc/model/{species & 0xF8}/{species}.nsbmd; its eyes are in the matching .nsbtx and the shirt
// texture ("cloth") comes from cloth/{i >> 4}/cloth{i}.nsbtx with i = shirt item − 0x11A8 (ClothTex_LoadItem).
(function () {
  'use strict';
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const s16 = (b, o) => (u16(b, o) << 16) >> 16;
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const s32 = (b, o) => u32(b, o) | 0;
  const sx = (v, bits) => (v & (1 << (bits - 1))) ? v - (1 << bits) : v;
  const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // Row-vector 4×4 matrices (translation in the last row): v' = v · M.
  function mul(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j]; o[i * 4 + j] = s; } return o; }
  const apply = (M, x, y, z) => [x * M[0] + y * M[4] + z * M[8] + M[12], x * M[1] + y * M[5] + z * M[9] + M[13], x * M[2] + y * M[6] + z * M[10] + M[14]];

  // "Info block" (dictionary) used throughout the NITRO formats.
  function dict(b, o) {
    const n = b[o + 1], d = o + 0xC + 4 * n, esz = u16(b, d), dsz = u16(b, d + 2);
    const out = [];
    for (let i = 0; i < n; i++) {
      let name = ''; for (let k = 0; k < 16; k++) { const c = b[d + dsz + i * 16 + k]; if (!c) break; name += String.fromCharCode(c); }
      out.push({ name, at: d + 4 + i * esz });
    }
    return out;
  }

  function pivot(sel, neg, a, b) {
    const o = neg & 1 ? -1 : 1, c = neg & 2 ? -b : b, d = neg & 4 ? -a : a;
    return [[o, 0, 0, 0, a, b, 0, c, d], [0, o, 0, a, 0, b, c, 0, d], [0, 0, o, a, b, 0, c, d, 0], [0, a, b, o, 0, 0, 0, c, d], [a, 0, b, 0, o, 0, c, 0, d],
      [a, b, 0, 0, 0, o, c, d, 0], [0, a, b, 0, c, d, o, 0, 0], [a, 0, b, c, 0, d, 0, o, 0], [a, b, 0, c, d, 0, 0, 0, o]][sel] || [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  function parseModel(m) {
    const mdl = u32(m, 0x10), mo = mdl + u32(m, dict(m, mdl + 8)[0].at);
    const sbc = u32(m, mo + 4), mat = u32(m, mo + 8), shp = u32(m, mo + 0xC), up = s32(m, mo + 0x1C) / 4096;
    const objs = dict(m, mo + 0x40).map(e => {
      const p = mo + 0x40 + u32(m, e.at), fl = u16(m, p), m0 = s16(m, p + 2) / 4096;
      let q = p + 4, T = [0, 0, 0], R = [1, 0, 0, 0, 1, 0, 0, 0, 1], S = [1, 1, 1];
      if (!(fl & 1)) { T = [0, 1, 2].map(i => s32(m, q + i * 4) / 4096); q += 12; }
      if (!(fl & 2)) {
        if (fl & 8) { R = pivot((fl >> 4) & 15, (fl >> 8) & 15, s16(m, q) / 4096, s16(m, q + 2) / 4096); q += 4; }
        else { R = [m0, ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => s16(m, q + i * 2) / 4096)]; q += 16; }
      }
      if (!(fl & 4)) { S = [0, 1, 2].map(i => s32(m, q + i * 4) / 4096); }
      return [R[0] * S[0], R[1] * S[0], R[2] * S[0], 0, R[3] * S[1], R[4] * S[1], R[5] * S[1], 0, R[6] * S[2], R[7] * S[2], R[8] * S[2], 0, T[0], T[1], T[2], 1];
    });
    const shapes = dict(m, mo + shp).map(e => { const p = mo + shp + u32(m, e.at); const dl = p + u32(m, p + 8); return m.subarray(dl, dl + u32(m, p + 0xC)); });
    const mb = mo + mat, tdict = u16(m, mb), pdict = u16(m, mb + 2);
    const mats = dict(m, mb + 4).map(e => { const p = mb + u32(m, e.at); return { name: e.name, params: u32(m, p + 0x14), w: u16(m, p + 0x20), h: u16(m, p + 0x22), diffuse: u32(m, p + 4) & 0x7FFF }; });
    const bind = (off, key) => { for (const e of dict(m, mb + off)) { const lo = u16(m, e.at), n = m[e.at + 2]; for (let k = 0; k < n; k++) { const mm = mats[m[mb + lo + k]]; if (mm) mm[key] = e.name; } } };
    bind(tdict, 'tex'); bind(pdict, 'pal');
    return { sbc: m.subarray(mo + sbc, mo + mat), objs, shapes, mats, up };
  }

  // Walks the render bytecode; returns [shape, material, matrix stack, current matrix] for each draw.
  function runSBC(M, root) {
    const b = M.sbc, stack = {}, draws = [], nodes = {};
    let p = 0, cur = root || I4(), mat = 0;
    while (p < b.length) {
      const op = b[p], base = op & 0x1F;
      if (base === 0x01) break;
      else if (base === 0x00) p += 1;
      else if (base === 0x02) p += 3;
      else if (base === 0x03) { cur = stack[b[p + 1]] || I4(); p += 2; }
      else if (base === 0x04) { mat = b[p + 1]; p += 2; }
      else if (base === 0x05) { draws.push([b[p + 1], mat, { ...stack }, cur]); p += 2; }
      else if (base === 0x06) {
        const node = b[p + 1]; let q = p + 4, dest = null, src = null;
        if (op & 0x20) dest = b[q++];
        if (op & 0x40) src = b[q++];
        if (src !== null) cur = stack[src] || root || I4();
        cur = mul(M.objs[node] || I4(), cur);
        nodes[node] = cur;
        if (dest !== null) stack[dest] = cur;
        p = q;
      } else if (base === 0x07 || base === 0x08) p += op & 0x20 ? 3 : 2;
      else if (base === 0x09) p += 3 + 3 * b[p + 2];
      else if (base === 0x0B) p += 1;
      else if (base === 0x0C || base === 0x0D) p += 3;
      else break;
    }
    draws.nodes = nodes;
    return draws;
  }

  const NPARAM = { 0x10: 1, 0x12: 1, 0x13: 1, 0x14: 1, 0x16: 16, 0x17: 12, 0x18: 16, 0x19: 12, 0x1A: 9, 0x1B: 3, 0x1C: 3, 0x20: 1, 0x21: 1, 0x22: 1, 0x23: 2, 0x24: 1, 0x25: 1, 0x26: 1, 0x27: 1, 0x28: 1, 0x29: 1, 0x2A: 1, 0x2B: 1, 0x30: 1, 0x31: 1, 0x32: 1, 0x33: 1, 0x34: 32, 0x40: 1, 0x50: 1, 0x60: 1, 0x70: 3, 0x71: 2, 0x72: 1 };
  // Decodes a GX display list into triangles: arrays of [x, y, z, s, t, r, g, b].
  function runDL(dl, stack, scale, start) {
    const out = []; let p = 0, cur = start || I4(), pos = [0, 0, 0], uv = [0, 0], col = [1, 1, 1], prim = 0, buf = [];
    const emit = () => {
      const v = apply(cur, pos[0] * scale, pos[1] * scale, pos[2] * scale);
      buf.push([v[0], v[1], v[2], uv[0], uv[1], col[0], col[1], col[2]]);
      const n = buf.length;
      if (prim === 0 && n === 3) { out.push(...buf); buf = []; }
      else if (prim === 1 && n === 4) { out.push(buf[0], buf[1], buf[2], buf[0], buf[2], buf[3]); buf = []; }
      else if (prim === 2 && n >= 3) { const [a, b, c] = buf.slice(-3); out.push(...(n % 2 ? [a, b, c] : [b, a, c])); }
      else if (prim === 3 && n >= 4 && n % 2 === 0) { const [a, b, c, d] = buf.slice(-4); out.push(a, b, d, a, d, c); }
    };
    while (p + 4 <= dl.length) {
      const cmds = [dl[p], dl[p + 1], dl[p + 2], dl[p + 3]]; p += 4;
      for (const c of cmds) {
        const n = NPARAM[c] || 0, a = []; for (let i = 0; i < n; i++) a.push(u32(dl, p + i * 4)); p += 4 * n;
        if (c === 0x14) cur = stack[a[0] & 31] || cur;
        else if (c === 0x20) col = [(a[0] & 31) / 31, ((a[0] >> 5) & 31) / 31, ((a[0] >> 10) & 31) / 31];
        // A normal makes the DS light the vertex itself (replacing its colour). With lightNormals on, a soft light from
        // above stands in for the game's lights; otherwise the colour is kept as before.
        else if (c === 0x21 && window.Model3D.lightNormals) { const ny = sx((a[0] >> 10) & 0x3FF, 10) / 512, nz = sx((a[0] >> 20) & 0x3FF, 10) / 512, k = Math.min(1, 0.62 + 0.3 * Math.max(0, ny) + 0.12 * Math.max(0, nz)); col = [k, k, k]; }
        else if (c === 0x22) uv = [sx(a[0] & 0xFFFF, 16) / 16, sx(a[0] >>> 16, 16) / 16];
        else if (c === 0x23) { pos = [sx(a[0] & 0xFFFF, 16) / 4096, sx(a[0] >>> 16, 16) / 4096, sx(a[1] & 0xFFFF, 16) / 4096]; emit(); }
        else if (c === 0x24) { pos = [sx(a[0] & 0x3FF, 10) / 64, sx((a[0] >> 10) & 0x3FF, 10) / 64, sx((a[0] >> 20) & 0x3FF, 10) / 64]; emit(); }
        else if (c === 0x25) { pos = [sx(a[0] & 0xFFFF, 16) / 4096, sx(a[0] >>> 16, 16) / 4096, pos[2]]; emit(); }
        else if (c === 0x26) { pos = [sx(a[0] & 0xFFFF, 16) / 4096, pos[1], sx(a[0] >>> 16, 16) / 4096]; emit(); }
        else if (c === 0x27) { pos = [pos[0], sx(a[0] & 0xFFFF, 16) / 4096, sx(a[0] >>> 16, 16) / 4096]; emit(); }
        else if (c === 0x28) { pos = [pos[0] + sx(a[0] & 0x3FF, 10) / 4096, pos[1] + sx((a[0] >> 10) & 0x3FF, 10) / 4096, pos[2] + sx((a[0] >> 20) & 0x3FF, 10) / 4096]; emit(); }
        else if (c === 0x40) { prim = a[0] & 3; buf = []; }
        else if (c === 0x41) buf = [];
      }
    }
    return out;
  }

  // ---------- textures (TEX0) ----------
  function parseTex(t, base) {
    const tex0 = base + u32(t, base + 0x10);
    const texInfo = tex0 + u16(t, tex0 + 0xE), palInfo = tex0 + u32(t, tex0 + 0x34);
    const T = { t, texdata: tex0 + u32(t, tex0 + 0x14), cmp: tex0 + u32(t, tex0 + 0x24), cmpIdx: tex0 + u32(t, tex0 + 0x28), paldata: tex0 + u32(t, tex0 + 0x38), texs: {}, pals: {} };
    for (const e of dict(t, texInfo)) T.texs[e.name] = u32(t, e.at);
    for (const e of dict(t, palInfo)) T.pals[e.name] = u16(t, e.at) << 3;
    return T;
  }
  const bgr = c => [(c & 31) * 255 / 31 | 0, ((c >> 5) & 31) * 255 / 31 | 0, ((c >> 10) & 31) * 255 / 31 | 0];
  // palT: optionally take the palette from another texture set (the game binds skin and hair palettes by name).
  function decodeTex(T, name, palName, palT) {
    const t = T.t, par = T.texs[name];
    if (par === undefined) return null;
    const off = (par & 0xFFFF) << 3, w = 8 << ((par >> 20) & 7), h = 8 << ((par >> 23) & 7), fmt = (par >> 26) & 7, c0 = (par >> 29) & 1;
    const PT = palT && palName in palT.pals ? palT : T;
    const pal = PT.paldata + (PT.pals[palName] ?? Object.values(PT.pals)[0] ?? 0), base = T.texdata + off;
    const pt = PT.t;
    const px = new Uint8ClampedArray(w * h * 4);
    const put = (i, rgb, a) => { px[i * 4] = rgb[0]; px[i * 4 + 1] = rgb[1]; px[i * 4 + 2] = rgb[2]; px[i * 4 + 3] = a; };
    const col = i => bgr(u16(pt, pal + i * 2));
    if (fmt === 2) for (let i = 0; i < w * h; i++) { const v = (t[base + (i >> 2)] >> ((i & 3) * 2)) & 3; put(i, col(v), c0 && !v ? 0 : 255); }
    else if (fmt === 3) for (let i = 0; i < w * h; i++) { const v = (t[base + (i >> 1)] >> ((i & 1) * 4)) & 15; put(i, col(v), c0 && !v ? 0 : 255); }
    else if (fmt === 4) for (let i = 0; i < w * h; i++) { const v = t[base + i]; put(i, col(v), c0 && !v ? 0 : 255); }
    else if (fmt === 1) for (let i = 0; i < w * h; i++) { const v = t[base + i]; put(i, col(v & 31), Math.round((v >> 5) * 255 / 7)); }
    else if (fmt === 6) for (let i = 0; i < w * h; i++) { const v = t[base + i]; put(i, col(v & 7), Math.round((v >> 3) * 255 / 31)); }
    else if (fmt === 7) for (let i = 0; i < w * h; i++) { const c = u16(t, base + i * 2); put(i, bgr(c), c & 0x8000 ? 255 : 0); }
    else if (fmt === 5) {
      const cb = T.cmp + off, ib = T.cmpIdx + (off >> 1);
      for (let by = 0; by < h / 4; by++) for (let bx = 0; bx < w / 4; bx++) {
        const k = by * (w / 4) + bx, blk = u32(t, cb + k * 4), ix = u16(t, ib + k * 2), pa = pal + (ix & 0x3FFF) * 4, mode = ix >> 14;
        const c = [0, 1, 2, 3].map(j => bgr(u16(pt, pa + j * 2))), a = [255, 255, 255, 255];
        if (mode === 0) a[3] = 0;
        else if (mode === 1) { c[2] = c[0].map((x, i) => (x + c[1][i]) >> 1); a[3] = 0; }
        else if (mode === 3) { c[2] = c[0].map((x, i) => (5 * x + 3 * c[1][i]) >> 3); c[3] = c[0].map((x, i) => (3 * x + 5 * c[1][i]) >> 3); }
        for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) { const v = (blk >>> ((yy * 4 + xx) * 2)) & 3; put((by * 4 + yy) * w + bx * 4 + xx, c[v], a[v]); }
      }
    } else return null;
    return { w, h, px };
  }

  // A custom design (WW pattern, 32×32) as a shirt texture.
  function patternTex(s, off) {
    const pal = window.WW_DATA.palettes[s.u8(off + 0x226) >> 4] || window.WW_DATA.palettes[0];
    const px = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < 1024; i++) {
      const b = s.u8(off + (i >> 1)), v = i & 1 ? b >> 4 : b & 15, c = pal[v - 1] || '#ffffff';
      px[i * 4] = parseInt(c.slice(1, 3), 16); px[i * 4 + 1] = parseInt(c.slice(3, 5), 16); px[i * 4 + 2] = parseInt(c.slice(5, 7), 16); px[i * 4 + 3] = 255;
    }
    return { w: 32, h: 32, px };
  }

  // ---------- building a villager ----------
  function villagerMesh(species, shirt, opts = {}) {
    const R = window.ROM; if (!R || !R.ready) return null;
    const dir = species & 0xF8, m = R.file(`npc/model/${dir}/${species}.nsbmd`); if (!m) return null;
    const M = parseModel(m);
    const own = u16(m, 0xE) > 1 ? parseTex(m, u32(m, 0x14)) : null;
    const eyesFile = R.file(`npc/model/${dir}/${species}.nsbtx`), eyes = eyesFile ? parseTex(eyesFile, 0) : null;
    let cloth = null;
    if (opts.shirtTex) cloth = opts.shirtTex;
    else if (shirt >= 0x11A8 && shirt <= 0x12A7) { const i = shirt - 0x11A8, f = R.file(`cloth/${i >> 4}/cloth${String(i).padStart(3, '0')}.nsbtx`); if (f) { const T = parseTex(f, 0); const n = Object.keys(T.texs)[0]; cloth = decodeTex(T, n, Object.keys(T.pals)[0]); } }
    const groups = [];
    for (const [sh, mi, stack, cur] of runSBC(M)) {
      const mat = M.mats[mi] || {};
      let tex = null;
      if (mat.tex === 'cloth' && cloth) tex = cloth;
      else for (const T of [own, eyes]) if (T && mat.tex in T.texs) { tex = decodeTex(T, mat.tex, mat.pal); break; }
      const verts = runDL(M.shapes[sh], stack, M.up, cur);
      groups.push({ verts, tex, tw: tex ? tex.w : mat.w || 1, th: tex ? tex.h : mat.h || 1, repS: (mat.params >> 16) & 1, repT: (mat.params >> 17) & 1, flipS: (mat.params >> 18) & 1, flipT: (mat.params >> 19) & 1 });
    }
    return groups;
  }

  // Builds draw groups for one model. texFor(mat) returns a decoded texture or null.
  function modelGroups(M, root, texFor) {
    const draws = runSBC(M, root), groups = [];
    for (const [sh, mi, stack, cur] of draws) {
      const mat = M.mats[mi] || {}, tex = texFor(mat);
      groups.push({ verts: runDL(M.shapes[sh], stack, M.up, cur), tex, tw: tex ? tex.w : mat.w || 1, th: tex ? tex.h : mat.h || 1, repS: (mat.params >> 16) & 1, repT: (mat.params >> 17) & 1, flipS: (mat.params >> 18) & 1, flipT: (mat.params >> 19) & 1 });
    }
    return { groups, nodes: draws.nodes };
  }
  const ownTex = m => (u16(m, 0xE) > 1 ? parseTex(m, u32(m, 0x14)) : null);
  const firstOf = o => Object.keys(o)[0];
  function shirtTex(R, shirt, opts) {
    if (opts && opts.shirtTex) return opts.shirtTex;
    if (shirt >= 0x11A8 && shirt <= 0x12A7) { const i = shirt - 0x11A8, f = R.file(`cloth/${i >> 4}/cloth${String(i).padStart(3, '0')}.nsbtx`); if (f) { const T = parseTex(f, 0); return decodeTex(T, firstOf(T.texs), firstOf(T.pals)); } }
    return null;
  }

  // The player, assembled the way PlayerActor does: body (boy/grl) + head (hair, or hat-hair and a hat, or full
  // headwear) + glasses, with the face texture (e.0/m.0) from PFcTx/{face} and the skin and hair palettes from PPal
  // (skin = tan + face·8, hair = 0x80 + color·8 + tan), all attached to the body's "head" bone; a held tool goes in "Rhand".
  function playerMesh(look) {
    const R = window.ROM; if (!R || !R.ready) return null;
    const bodyF = R.file(look.girl ? 'PBody/grl.nsbmd' : 'PBody/boy.nsbmd'); if (!bodyF) return null;
    const pal = n => { const f = R.file(`PPal/${n >> 5}/${n}.nsbtx`); return f ? parseTex(f, 0) : null; };
    const skinT = pal(Math.min(0x7F, look.tan + look.face * 8)), hairT = pal(0x80 + look.hairColor * 8 + look.tan);
    const faceF = R.file(`PFcTx/0/${look.face & 0x1F}.nsbtx`), faceT = faceF ? parseTex(faceF, 0) : null;
    const cloth = shirtTex(R, look.shirt, look);
    const groups = [];
    const body = parseModel(bodyF), bodyT = ownTex(bodyF);
    const b = modelGroups(body, null, mat => mat.tex === 'cloth' && cloth ? cloth : bodyT ? decodeTex(bodyT, mat.tex, mat.pal, mat.pal === 'skin_pl' ? skinT : null) : null);
    groups.push(...b.groups);
    const headM = b.nodes[15] || I4();
    // Head models: hair, or hat-hair plus a hat (sHatModelIds 0x40+), or full headwear replacing the hair (0x20+).
    let hair = look.hairstyle & 15, hat = null;
    const H = look.hat;
    if (H >= 0x13A8 && H <= 0x13C7) hair = 0x20 + (H - 0x13A8);
    else if (H >= 0x13C8 && H <= 0x1407) { hair = 0x10 + (look.hairstyle & 15); hat = 0x40 + (H - 0x13C8); }
    else if (H >= 0x1429 && H <= 0x1430) { hair = 0x10 + (look.hairstyle & 15); hat = look.girl ? 0x81 : 0x80; }
    const attach = (id, extraTex) => {
      const f = R.file(`PHead/${id >> 5}/${id}.nsbmd`); if (!f) return;
      const M = parseModel(f), T = ownTex(f);
      groups.push(...modelGroups(M, headM, mat => {
        if ((mat.tex === 'e.0' || mat.tex === 'm.0') && faceT) return decodeTex(faceT, mat.tex, 'skin_pl', skinT);
        if (mat.tex === 'myD' && extraTex) return extraTex;
        if (!T) return null;
        return decodeTex(T, mat.tex, mat.pal, mat.pal === 'hair_pl' ? hairT : mat.pal === 'skin_pl' ? skinT : null);
      }).groups);
    };
    attach(hair);
    if (hat !== null) attach(hat, look.hatTex);
    if (look.glasses >= 0x1431 && look.glasses <= 0x1470) {
      const g = look.glasses - 0x1431, f = R.file(`PGls/${g >> 5}/${g}.nsbmd`);
      if (f) { const M = parseModel(f), T = ownTex(f); groups.push(...modelGroups(M, headM, mat => T ? decodeTex(T, mat.tex, mat.pal) : null).groups); }
    }
    // Held item (HeldItem_GetModelId): the 63 holdable items 0x1369–0x13A7 index sHeldItemModelIds; the model hangs
    // from the right hand. Custom umbrellas draw the player's own design on their "myD" canopy.
    if (look.held >= 0x1369 && look.held <= 0x13A7) {
      const x = HELD_MODELS[look.held - 0x1369], f = R.file(`PItm/Mdl${x >> 5}/${x}.nsbmd`);
      // Without the game's arm animation the hand points sideways, so umbrellas keep only the hand's position and
      // stand upright (+Z turned to +Y, as they're carried), while tools follow the hand bone.
      const hand = b.nodes[14] || I4(), root = look.held >= 0x1380 ? [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, hand[12], hand[13], hand[14], 1] : hand;   // umbrella models run along +Z
      if (f) { const M = parseModel(f), T = ownTex(f); groups.push(...modelGroups(M, root, mat => (mat.tex === 'myD' ? look.heldTex || null : T ? decodeTex(T, mat.tex, mat.pal) : null)).groups); }
    }
    return groups;
  }
  const HELD_MODELS = [0x10, 0x04, 0x06, 0x06, 0x06, 0x07, 0x07, 0x07, 0x08, 0x08, 0x00, 0x0f, 0x03, 0x0d, 0x02, 0x0b, 0x01, 0x11, 0x05, 0x0e,
    0x09, 0x0a, 0x0a, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25,
    0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c];

  // ---------- WebGL ----------
  const VS = 'attribute vec3 p;attribute vec2 uv;attribute vec3 c;uniform mat4 mvp;varying vec2 vuv;varying vec3 vc;void main(){gl_Position=mvp*vec4(p,1.0);vuv=uv;vc=c;}';
  const FS = 'precision mediump float;varying vec2 vuv;varying vec3 vc;uniform sampler2D tex;uniform float has;void main(){vec4 t=has>0.5?texture2D(tex,vuv):vec4(1.0);if(t.a<0.5)discard;gl_FragColor=vec4(t.rgb*vc,1.0);}';

  // opts.view ({ angle, pitch }) is kept up to date so a rebuilt viewer can keep the same angle; opts.frame ({ min, max })
  // fixes what the camera centers on. With opts.grab(e) returning { move(e), up(e) } the viewer hands that drag over
  // instead of turning; opts.click(e) gets plain clicks. canvas.pick(x, y, h) is the world (x, z) under a page point at
  // height h, canvas.update(groups) swaps the geometry in place, and canvas.draw() renders now.
  function viewer(groups, { size = 220, yaw = 0.35, spin = true, pitch: pitch0 = 0.12, zoom = 1.7, view = null, frame = null, grab = null, click = null } = {}) {
    const canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr; canvas.height = size * dpr; canvas.style.width = canvas.style.height = size + 'px';
    canvas.className = 'model3d';
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9], parts = [];
    const texCache = new Map();
    function upload(list) {
      for (const part of parts) gl.deleteBuffer(part.buf);
      parts = list.map(g => {
        const data = new Float32Array(g.verts.length * 8);
        g.verts.forEach((v, i) => {
          if (!frame) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
          data.set([v[0], v[1], v[2], v[3] / g.tw, v[4] / g.th, v[5], v[6], v[7]], i * 8);
        });
        const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        let tex = null;
        if (g.tex) {
          const key = g.tex.px.buffer, wrapKey = `${g.repS}${g.flipS}${g.repT}${g.flipT}`;
          tex = texCache.get(key) && texCache.get(key)[wrapKey];
          if (!tex) {
            tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, g.tex.w, g.tex.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(g.tex.px.buffer));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            const wrap = (rep, flip) => rep ? (flip ? gl.MIRRORED_REPEAT : gl.REPEAT) : gl.CLAMP_TO_EDGE;
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(g.repS, g.flipS)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(g.repT, g.flipT));
            texCache.set(key, { ...(texCache.get(key) || {}), [wrapKey]: tex });
          }
        }
        return { buf, tex, n: g.verts.length };
      });
    }
    if (frame) { min = frame.min; max = frame.max; }
    upload(groups);
    const ctr = [0, 1, 2].map(k => (min[k] + max[k]) / 2), ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    const loc = { p: gl.getAttribLocation(prog, 'p'), uv: gl.getAttribLocation(prog, 'uv'), c: gl.getAttribLocation(prog, 'c'), mvp: gl.getUniformLocation(prog, 'mvp'), has: gl.getUniformLocation(prog, 'has') };
    gl.enable(gl.DEPTH_TEST);
    let angle = view && view.angle !== undefined ? view.angle : yaw, pitch = view && view.pitch !== undefined ? view.pitch : pitch0, dragging = null, raf = 0, M = null;
    const mm = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = v; } return o; };
    function draw() {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const s = zoom / ext, ca = Math.cos(angle), sa = Math.sin(angle), cp = Math.cos(pitch), sp = Math.sin(pitch);
      // Column-major MVP: center, yaw, pitch, scale, and depth into clip range.
      const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -ctr[0], -ctr[1], -ctr[2], 1];
      const Ry = [ca, 0, -sa, 0, 0, 1, 0, 0, sa, 0, ca, 0, 0, 0, 0, 1];
      const Rx = [1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1];
      const S = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, -s * 0.5, 0, 0, 0, 0, 1];
      M = mm(S, mm(Rx, mm(Ry, T)));
      gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(M));
      for (const part of parts) {
        gl.bindBuffer(gl.ARRAY_BUFFER, part.buf);
        gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 32, 12);
        gl.enableVertexAttribArray(loc.c); gl.vertexAttribPointer(loc.c, 3, gl.FLOAT, false, 32, 20);
        gl.uniform1f(loc.has, part.tex ? 1 : 0); if (part.tex) gl.bindTexture(gl.TEXTURE_2D, part.tex);
        gl.drawArrays(gl.TRIANGLES, 0, part.n);
      }
      if (view) { view.angle = angle; view.pitch = pitch; }
    }
    // The projection has no perspective, so a page point at a known height maps back to one (x, z).
    canvas.pick = (px, py, hgt = 0) => {
      if (!M) draw();
      const r = canvas.getBoundingClientRect(), nx = (px - r.left) / r.width * 2 - 1, ny = 1 - (py - r.top) / r.height * 2;
      const a = M[0], b = M[8], c = M[1], d = M[9], ex = nx - M[4] * hgt - M[12], ey = ny - M[5] * hgt - M[13], det = a * d - b * c;
      return Math.abs(det) < 1e-9 ? null : [(ex * d - b * ey) / det, (a * ey - c * ex) / det];
    };
    canvas.update = list => { upload(list); draw(); };
    canvas.draw = draw;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function tick() { if (!canvas.isConnected) return; if (!dragging && spin && !reduce) angle += 0.006; draw(); raf = requestAnimationFrame(tick); }
    let handed = null, down = null;
    canvas.addEventListener('pointerdown', e => {
      down = [e.clientX, e.clientY]; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
      handed = grab ? grab(e) : null;
      if (!handed) dragging = [e.clientX, e.clientY, angle, pitch];
    });
    canvas.addEventListener('pointermove', e => {
      if (handed) { handed.move(e); return; }
      if (!dragging) return; angle = dragging[2] + (e.clientX - dragging[0]) * 0.012; pitch = Math.max(-0.6, Math.min(1.2, dragging[3] + (e.clientY - dragging[1]) * 0.008)); if (reduce || !spin) draw();
    });
    canvas.addEventListener('pointerup', e => {
      const still = down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5;
      if (handed) { const hnd = handed; handed = null; hnd.up(e, still); }
      else if (still && click) click(e);
      dragging = null; down = null;
    });
    draw();
    requestAnimationFrame(() => { if (canvas.isConnected) tick(); else setTimeout(() => canvas.isConnected && tick(), 300); });
    void raf;
    return canvas;
  }

  window.Model3D = { lightNormals: false, villagerMesh, playerMesh, viewer, parseModel, runSBC, runDL, parseTex, decodeTex, patternTex, modelGroups, ownTex };
})();
