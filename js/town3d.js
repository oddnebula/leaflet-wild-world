// The town in 3D, to walk around. Everything on the town map is placed exactly where the save has it (trees, fruit,
// flowers, weeds, rocks, signs and every building with its footprint); the ground (grass, rivers, ponds, beaches,
// cliffs, bridges) is shaped from Leaflet's own acre drawings (js/acreart.js), so it's close to the game's but not
// exact. The town lives by the save: the game clock sets the light, the game's date the season (snow, autumn leaves,
// the cherry blossoms of early April) and the weather the game rolled for today brings clouds, rain or snow. Everything
// is drawn by Leaflet: no game models or art (the optional music is the game's own, from the player's ROM).
(function () {
  'use strict';
  const { h, sfx, item, toast } = UI;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const MAP = 0xC354, ACRES = 0xC330, N = 64, WX = 0x15F66;
  const D = window.WW_DATA;

  // ---------- a tiny renderer: coloured triangles, fog, perspective ----------
  // Each vertex has a colour and a glow (windows at night); `light` tints everything for the hour and weather.
  const VS = 'attribute vec3 p; attribute vec3 c; attribute float g; uniform mat4 m; varying vec3 vc; varying float d; varying float vg; void main() { vec4 q = m * vec4(p, 1.0); gl_Position = q; vc = c; vg = g; d = q.w; }';
  const FS = 'precision mediump float; varying vec3 vc; varying float d; varying float vg; uniform vec3 fog; uniform vec3 light; uniform float far; uniform float night; void main() { float f = clamp((d - far * 0.35) / (far * 0.65), 0.0, 1.0); vec3 col = mix(vc * light, vc * 1.15, vg * night); gl_FragColor = vec4(mix(col, fog, f * (1.0 - vg * night * 0.6)), 1.0); }';
  function mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; }
  function look(e, c) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], nrm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = nrm(sub(e, c)), x = nrm(cross([0, 1, 0], z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  }
  const hexc = (s, k = 1) => [parseInt(s.slice(1, 3), 16) / 255 * k, parseInt(s.slice(3, 5), 16) / 255 * k, parseInt(s.slice(5, 7), 16) / 255 * k];

  // ---------- geometry ----------
  function builder() {
    const P = [], C = [], G = [];
    let glow = 0;
    const tri = (a, b, c, col) => { P.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) { C.push(...col); G.push(glow); } };
    const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
    const lit = (f) => { glow = 1; f(); glow = 0; };
    const shade = (col, k) => col.map(v => Math.min(1, v * k));
    function box(x0, y0, z0, x1, y1, z1, col) {
      quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], col);
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], shade(col, 0.82));
      quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade(col, 0.7));
      quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(col, 0.76));
      quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(col, 0.88));
    }
    // A roof: four sloping faces up to a ridge (or a point when ridge = 0).
    function roof(x0, z0, x1, z1, y, hgt, col) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rz = Math.max(0, (z1 - z0) / 2 - (x1 - x0) / 2) * 0, top = y + hgt;
      const a = [cx, top, cz - rz], b = [cx, top, cz + rz];
      tri([x0, y, z1], [x1, y, z1], b, shade(col, 0.9)); tri([x1, y, z0], [x0, y, z0], a, shade(col, 0.7));
      quad([x1, y, z1], [x1, y, z0], a, b, shade(col, 0.8)); quad([x0, y, z0], [x0, y, z1], b, a, col);
    }
    // A rounded canopy: an eight-sided double cone.
    function blob(cx, cy, cz, r, hgt, col) {
      const k = 8, top = [cx, cy + hgt, cz], bot = [cx, cy - hgt * 0.35, cz];
      for (let i = 0; i < k; i++) {
        const a0 = i / k * Math.PI * 2, a1 = (i + 1) / k * Math.PI * 2, p0 = [cx + r * Math.cos(a0), cy, cz + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cy, cz + r * Math.sin(a1)];
        const lit = 0.75 + 0.25 * Math.cos(a0 - 0.8);
        tri(p0, top, p1, shade(col, lit)); tri(p1, bot, p0, shade(col, lit * 0.75));
      }
    }
    return { P, C, G, box, quad, roof, blob, shade, lit };
  }

  // ---------- the town's day: season, light and weather ----------
  // Snow lies on the ground from mid-December to late February, and every fruit tree is in blossom from April 1 to 10.
  function seasonOf(d) {
    const m = d.getMonth() + 1, day = d.getDate();
    if (m === 4 && day <= 10) return 'bloom';
    if ((m === 12 && day >= 11) || m === 1 || (m === 2 && day <= 24)) return 'snow';
    return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'fall' : 'winter';
  }
  const GRASS = { spring: ['#6dbd63', '#62b25a'], bloom: ['#6dbd63', '#62b25a'], summer: ['#5cb352', '#53a84b'], fall: ['#a9bd5a', '#9eb352'], winter: ['#8fae7a', '#86a572'], snow: ['#f1f5f8', '#e6edf2'] };
  // Light and sky by the hour (a smooth day: night, dawn, day, evening, dusk) and how much windows glow.
  const DAY = [[0, [0.36, 0.4, 0.66], [0.07, 0.09, 0.22], 1], [4.5, [0.36, 0.4, 0.66], [0.07, 0.09, 0.22], 1], [6, [0.95, 0.78, 0.72], [0.98, 0.74, 0.62], 0.3],
    [8, [1, 1, 1], [0.62, 0.84, 0.98], 0], [16, [1, 1, 1], [0.62, 0.84, 0.98], 0], [18, [1, 0.8, 0.62], [0.98, 0.64, 0.46], 0.2], [19.5, [0.62, 0.56, 0.82], [0.34, 0.3, 0.56], 0.7],
    [21, [0.36, 0.4, 0.66], [0.07, 0.09, 0.22], 1], [24, [0.36, 0.4, 0.66], [0.07, 0.09, 0.22], 1]];
  const WX_WORD = ['Clear', 'Some clouds', 'Cloudy', 'Rain', 'Heavy rain'];
  function skyAt(hour, lv, snowy) {
    let i = 0; while (DAY[i + 1][0] <= hour) i++;
    const [h0, l0, s0, n0] = DAY[i], [h1, l1, s1, n1] = DAY[i + 1], f = (hour - h0) / (h1 - h0 || 1), mix = (a, b) => a.map((v, k) => v + (b[k] - v) * f);
    let light = mix(l0, l1), fog = mix(s0, s1); const night = n0 + (n1 - n0) * f;
    // Clouds grey the sky and dim the light; snow days stay bright.
    const grey = [0, 0.15, 0.35, 0.55, 0.7][lv] || 0, dim = [1, 0.97, 0.9, 0.78, 0.68][lv] || 1;
    const luma = fog[0] * 0.3 + fog[1] * 0.55 + fog[2] * 0.15, cloud = snowy && lv >= 3 ? [0.86, 0.88, 0.92].map(v => v * Math.max(0.35, luma / 0.8)) : [0.62, 0.65, 0.7].map(v => v * Math.max(0.3, luma / 0.8));
    fog = fog.map((v, k) => v + (cloud[k] - v) * grey);
    light = light.map(v => v * (snowy && lv >= 3 ? Math.max(dim, 0.85) : dim));
    return { light, fog, night };
  }
  // The weather the game rolled: a 24-hour pattern for the save's weather day (or tomorrow's pattern, rolled yesterday).
  function weatherPattern(s, now) {
    const [d, m, y] = s.bytes(WX, 3); if (!m) return null;
    const day = new Date(2000 + y, m - 1, d), same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(day, now)) return s.u8(WX + 4);
    if (same(new Date(day.getTime() + 86400e3), now)) return s.u8(WX + 5);
    return null;
  }
  const wxLevel = (pat, hour) => pat === null ? 0 : +((D.weather[pat] || '')[(hour + 18) % 24] || 0);

  // ---------- the town ----------
  const TREE = { Cedar: '#2f7a45', Palm: '#57b04a', Apple: '#e4483d', Orange: '#f39a2b', Pear: '#c9d64a', Peach: '#f49ab0', Cherry: '#b8263b', Coconut: '#8a5a2b', Money: '#f2c230', Bells: '#f2c230' };
  const FLOWER = [['Red', '#e8473f'], ['White', '#f6f6f2'], ['Yellow', '#f4d23c'], ['Pink', '#f59ac0'], ['Purple', '#9a63d6'], ['Orange', '#f39a3b'], ['Blue', '#5b8fe6'], ['Black', '#3a3340']];
  const BUILD = [[/Town Hall/, '#c8a46e', '#7a4b2b', 2.2], [/Neighbor House/, null, null, 1.6], [/^House/, '#f2e2c4', '#c8553d', 1.8], [/Museum/, '#d8c8a8', '#6a8a5a', 2.1], [/Nook|Nookington/, '#f2d08a', '#3f8f4f', 1.7],
    [/Able/, '#f6d6e6', '#d0607a', 1.7], [/Gate/, '#e8d6a8', '#c8553d', 1.6], [/Tent/, '#e8d070', '#b04848', 1.4], [/Ship|Car/, '#c8c8d0', '#5070a8', 1.0], [/Sign|Board|Mailbox|Countdown/, '#c08a50', null, 0.9]];
  const NEIGHBOR_COLORS = ['#e9c46a', '#a8d8ea', '#f4a6a6', '#b8e0a8', '#d6b8f0', '#f6d6a8', '#a8c8f0', '#f0b8d8'];

  function build(s, season) {
    const B = builder(), G = window.WW_ACRE_CANVAS, AC = window.WW_ACRE_COLORS;
    const kind = new Uint8Array(N * N);     // 0 grass, 1 water, 2 sand, 3 cliff, 4 bridge
    const solid = new Uint8Array(N * N);    // can't walk here
    const what = new Array(N * N).fill('');
    const pal = [[AC.water, 1], [AC.deep, 1], [AC.foam, 1], [AC.sand, 2], [AC.cliff, 3], [AC.cliffEdge, 3], [AC.wood, 4]].map(([c, k]) => [hexc(c).map(v => v * 255), k]);
    const acreAt = (ax, ay) => s.u8(ACRES + (ay + 1) * 6 + (ax + 1));
    const idx = (x, y) => ((y >> 4) * 4 + (x >> 4)) * 256 + (y & 15) * 16 + (x & 15);
    const pix = {};
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const a = acreAt(x >> 4, y >> 4), cv = G && G[a];
      if (!cv) continue;
      const d = pix[a] || (pix[a] = cv.getContext('2d').getImageData(0, 0, 32, 32).data), o = (((y & 15) * 2 + 1) * 32 + (x & 15) * 2 + 1) * 4;
      let best = 0, bd = 2600;
      for (const [c, k] of pal) { const dd = (d[o] - c[0]) ** 2 + (d[o + 1] - c[1]) ** 2 + (d[o + 2] - c[2]) ** 2; if (dd < bd) { bd = dd; best = k; } }
      kind[y * N + x] = best;
    }
    const height = k => (k === 1 ? -0.3 : k === 3 ? 0.7 : 0);
    // Ground, with banks where it drops to water and rises to a cliff.
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const k = kind[y * N + x], hgt = height(k), chk = (x + y) & 1;
      const snow = season === 'snow', grass = GRASS[season];
      const col = k === 1 ? hexc(snow ? '#7ab3d6' : '#4fa7dc', chk ? 1 : 0.95) : k === 2 ? hexc(snow ? '#eee6d0' : '#ecd9a0', chk ? 1 : 0.96) : k === 3 ? hexc(snow ? '#e3eaef' : '#4c9a52', chk ? 1 : 0.94) : k === 4 ? hexc('#b07a44', chk ? 1 : 0.9) : hexc(grass[chk]);
      const y0 = k === 4 ? 0.05 : hgt;
      B.quad([x, y0, y], [x, y0, y + 1], [x + 1, y0, y + 1], [x + 1, y0, y], col);
      if (k === 1 || k === 3) solid[y * N + x] = 1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nh = kind[ny * N + nx] === 4 ? 0.05 : height(kind[ny * N + nx]); if (nh >= y0) continue;
        const wall = k === 3 ? hexc('#7a6a4a') : hexc('#9a8a5a');
        const ex = dx === 1 ? x + 1 : x, ez = dy === 1 ? y + 1 : y;
        if (dx) B.quad([ex, nh, y], [ex, nh, y + 1], [ex, y0, y + 1], [ex, y0, y], B.shade(wall, 0.8));
        else B.quad([x, nh, ez], [x + 1, nh, ez], [x + 1, y0, ez], [x, y0, ez], B.shade(wall, 0.7));
      }
    }
    // A skirt of ground and sea beyond the edges, so the town doesn't end at a cliff into nothing.
    const skirt = hexc(GRASS[season][1], 0.85);
    B.quad([-40, -0.02, -40], [-40, -0.02, 0], [N + 40, -0.02, 0], [N + 40, -0.02, -40], skirt);
    B.quad([-40, -0.02, 0], [-40, -0.02, N], [0, -0.02, N], [0, -0.02, 0], skirt);
    B.quad([N, -0.02, 0], [N, -0.02, N], [N + 40, -0.02, N], [N + 40, -0.02, 0], skirt);
    B.quad([-40, -0.35, N], [-40, -0.35, N + 60], [N + 40, -0.35, N + 60], [N + 40, -0.35, N], hexc('#3d86c4'));

    const blocks = new Uint8Array(N * N);   // spots an object stands on (trees, rocks, buildings), whatever the ground
    // Everything on the map.
    const ids = new Uint16Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) ids[y * N + x] = s.u16(MAP + idx(x, y) * 2);
    const seen = new Uint8Array(N * N), buildings = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const id = ids[y * N + x], it = item(id), cat = it.cat, name = it.name || '', cx = x + 0.5, cz = y + 0.5, base = height(kind[y * N + x]) > 0 ? height(kind[y * N + x]) : 0;
      if (cat === 'Empty' || cat === 'Occupied Space') continue;
      what[y * N + x] = name;
      if (/Trees|Palm Trees/.test(cat)) {
        solid[y * N + x] = blocks[y * N + x] = 1;
        const small = /Sapling|Small|Young/.test(name) ? 0.45 : /Medium/.test(name) ? 0.7 : 1, palm = cat === 'Palm Trees' || /Palm|Coconut/.test(name), cedar = /Cedar/.test(name);
        B.box(cx - 0.09, base, cz - 0.09, cx + 0.09, base + 1.1 * small, cz + 0.09, hexc('#8a5a32'));
        // Leaves by season: orange and red in autumn, pink in the April blossom, darker in winter with snow on top.
        const leaf = season === 'fall' ? ((x * 7 + y * 3) % 3 ? '#d9882b' : '#c9562b') : season === 'bloom' && !palm ? '#f6b6cb' : season === 'snow' || season === 'winter' ? '#367a46' : '#3f9a4a';
        if (cedar) { B.blob(cx, base + 0.9 * small, cz, 0.55 * small, 1.6 * small, hexc(season === 'snow' || season === 'winter' ? '#2a6b3e' : '#2f7a45')); }
        else if (palm) { B.blob(cx, base + 1.25 * small, cz, 0.7 * small, 0.25 * small, hexc('#57b04a')); }
        else B.blob(cx, base + 1.15 * small, cz, 0.6 * small, 0.65 * small, hexc(leaf));
        if (season === 'snow' && !palm) B.blob(cx, base + (cedar ? 2.05 : 1.62) * small, cz, (cedar ? 0.3 : 0.42) * small, (cedar ? 0.45 : 0.18) * small, hexc('#f6f9fc'));
        const fruit = Object.keys(TREE).find(k => name.includes(k) && k !== 'Cedar' && k !== 'Palm');
        if (fruit && small === 1 && season !== 'bloom') for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; B.box(cx + Math.cos(a) * 0.42 - 0.07, base + 1.05, cz + Math.sin(a) * 0.42 - 0.07, cx + Math.cos(a) * 0.42 + 0.07, base + 1.19, cz + Math.sin(a) * 0.42 + 0.07, hexc(TREE[fruit])); }
      } else if (/Flowers/.test(cat)) {
        const col = (FLOWER.find(([w]) => name.includes(w)) || [0, '#f59ac0'])[1];
        B.box(cx - 0.03, base, cz - 0.03, cx + 0.03, base + 0.22, cz + 0.03, hexc('#4f9a3f'));
        B.blob(cx, base + 0.27, cz, 0.15, 0.08, hexc(col, cat === 'Parched Flowers' ? 0.65 : 1));
      } else if (cat === 'Weeds') B.blob(cx, base + 0.08, cz, 0.22, 0.16, hexc('#8fcf5a'));
      else if (/Rocks/.test(cat)) { solid[y * N + x] = blocks[y * N + x] = 1; B.blob(cx, base + 0.25, cz, 0.42, 0.4, hexc('#9a9a9a')); }
      else if (cat === 'Special Stumps') B.box(cx - 0.25, base, cz - 0.25, cx + 0.25, base + 0.3, cz + 0.25, hexc('#8a5a32'));
      else if (cat === 'Snowmen') { B.blob(cx, base + 0.3, cz, 0.35, 0.3, hexc('#f8f8ff')); B.blob(cx, base + 0.85, cz, 0.25, 0.22, hexc('#f8f8ff')); solid[y * N + x] = blocks[y * N + x] = 1; }
      else if (cat === 'Buildings' && !seen[y * N + x]) {
        // The building's footprint: its own spot and the occupied spots joined to it.
        const q = [[x, y]], foot = []; seen[y * N + x] = 1;
        while (q.length) {
          const [px, py] = q.pop(); foot.push([px, py]);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N || seen[ny * N + nx]) continue;
            if (item(ids[ny * N + nx]).cat === 'Occupied Space') { seen[ny * N + nx] = 1; q.push([nx, ny]); }
          }
        }
        const xs = foot.map(f => f[0]), ys = foot.map(f => f[1]);
        let x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, z0 = Math.min(...ys), z1 = Math.max(...ys) + 1;
        foot.forEach(([fx, fy]) => { solid[fy * N + fx] = blocks[fy * N + fx] = 1; what[fy * N + fx] = name; });
        buildings.push({ name, id, x0, z0, x1, z1 });
        let [, wallC, roofC, hgt] = BUILD.find(([re]) => re.test(name)) || [0, '#e8d8b8', '#8a6a4a', 1.6];
        if (/Neighbor House #(\d)/.test(name)) { const v = +RegExp.$1 - 1; wallC = NEIGHBOR_COLORS[v % 8]; roofC = ['#c8553d', '#4f7fd6', '#3f8f4f', '#9a6fd1', '#e0ae12', '#8a5a32', '#d0607a', '#3a3a44'][v % 8]; }
        if (/Sign|Board|Mailbox|Countdown/.test(name)) { B.box(x0 + 0.3, base, z0 + 0.4, x1 - 0.3, base + hgt, z0 + 0.55, hexc(wallC)); continue; }
        const inset = 0.12; x0 += inset; z0 += inset; x1 -= inset; z1 -= inset;
        B.box(x0, base, z0, x1, base + hgt, z1, hexc(wallC));
        B.box((x0 + x1) / 2 - 0.25, base, z1 - 0.001, (x0 + x1) / 2 + 0.25, base + 0.75, z1 + 0.02, hexc('#7a4b2b'));   // door, facing south
        // Windows either side of the door, lit after dark.
        if (x1 - x0 > 1.2) B.lit(() => { for (const wx of [x0 + 0.18, x1 - 0.48]) B.box(wx, base + hgt * 0.45, z1 - 0.001, wx + 0.3, base + hgt * 0.45 + 0.3, z1 + 0.025, hexc('#f7e3a1')); });
        if (roofC) B.roof(x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, base + hgt, Math.min(1.4, (x1 - x0) * 0.45), hexc(roofC));
      }
    }
    return { P: new Float32Array(B.P), C: new Float32Array(B.C), G: new Float32Array(B.G), kind, solid, blocks, what, ids, buildings };
  }

  // ---------- the viewer: walk, or look from above ----------
  // With the player's ROM, the town can be drawn with the game's own models (js/townmodels.js).
  const VS2 = 'attribute vec3 p; attribute vec2 uv; attribute vec3 c; uniform mat4 m; varying vec2 vuv; varying vec3 vc; varying float d; void main() { vec4 q = m * vec4(p, 1.0); gl_Position = q; vuv = uv; vc = c; d = q.w; }';
  const FS2 = 'precision mediump float; varying vec2 vuv; varying vec3 vc; varying float d; uniform sampler2D tex; uniform vec3 fog; uniform vec3 light; uniform float far; uniform float night; uniform float glow; void main() { vec4 t = texture2D(tex, vuv); if (t.a < 0.5) discard; vec3 base = t.rgb * vc; vec3 col = mix(base * light, base * 1.1, glow * night); float f = clamp((d - far * 0.35) / (far * 0.65), 0.0, 1.0); gl_FragColor = vec4(mix(col, fog, f * (1.0 - glow * night * 0.6)), 1.0); }';
  const opt = { hour: -1, wx: -1, music: false, art: 'game' };   // -1: follow the save; art: 'game' (ROM models) or 'leaflet'
  function townView(s) {
    const W = Math.min(960, Math.max(320, (document.getElementById('content')?.clientWidth || 900) - 110)), H = Math.round(W * 0.58);
    const canvas = h('canvas', { class: 'town3d', tabindex: 0, width: W * 2, height: H * 2, style: { width: W + 'px', height: H + 'px' } });
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return h('div', { class: 'room3d-empty' }, '3D needs WebGL, which this browser has turned off.');
    const CAL = window.WW_CALENDAR, today = CAL.gameNow(s), season = seasonOf(today);
    const T = build(s, season);
    const sh = (t, src) => { const x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); return x; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    const loc = { p: gl.getAttribLocation(prog, 'p'), c: gl.getAttribLocation(prog, 'c'), g: gl.getAttribLocation(prog, 'g') };
    const mk = data => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const stat = { p: mk(T.P), c: mk(T.C), g: mk(T.G), n: T.P.length / 3 }, dyn = { p: gl.createBuffer(), c: gl.createBuffer(), g: gl.createBuffer(), n: 0 };
    const bind = set => {
      for (const [k, size] of [['p', 3], ['c', 3], ['g', 1]]) { gl.bindBuffer(gl.ARRAY_BUFFER, set[k]); gl.enableVertexAttribArray(loc[k]); gl.vertexAttribPointer(loc[k], size, gl.FLOAT, false, 0, 0); }
    };
    const uM = gl.getUniformLocation(prog, 'm'), uFog = gl.getUniformLocation(prog, 'fog'), uFar = gl.getUniformLocation(prog, 'far'), uLight = gl.getUniformLocation(prog, 'light'), uNight = gl.getUniformLocation(prog, 'night');
    gl.enable(gl.DEPTH_TEST);
    // The game's models: one buffer and texture per batch, built once per visit.
    const canGame = !!(window.TownModels && TownModels.available());
    let game = null;
    if (canGame && opt.art === 'game') {
      try {
        const built = TownModels.build(s, { date: today, snowy: season === 'snow', buildings: T.buildings }), list = built.batches;
        const p2 = gl.createProgram(); gl.attachShader(p2, sh(gl.VERTEX_SHADER, VS2)); gl.attachShader(p2, sh(gl.FRAGMENT_SHADER, FS2)); gl.linkProgram(p2);
        const L2 = { p: gl.getAttribLocation(p2, 'p'), uv: gl.getAttribLocation(p2, 'uv'), c: gl.getAttribLocation(p2, 'c'), m: gl.getUniformLocation(p2, 'm'), fog: gl.getUniformLocation(p2, 'fog'), light: gl.getUniformLocation(p2, 'light'), far: gl.getUniformLocation(p2, 'far'), night: gl.getUniformLocation(p2, 'night'), glow: gl.getUniformLocation(p2, 'glow') };
        const texs = new Map();
        const batches = list.map(b => {
          const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, b.data, gl.STATIC_DRAW);
          const key = b.tex, wrap = `${b.repS}${b.flipS}${b.repT}${b.flipT}`;
          let tx = texs.get(key) && texs.get(key)[wrap];
          if (!tx) {
            tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, b.tex.w, b.tex.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(b.tex.px.buffer));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            const wr = (rep, flip) => rep ? (flip ? gl.MIRRORED_REPEAT : gl.REPEAT) : gl.CLAMP_TO_EDGE;
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr(b.repS, b.flipS)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr(b.repT, b.flipT));
            texs.set(key, { ...(texs.get(key) || {}), [wrap]: tx });
          }
          return { buf, tx, n: b.data.length / 8, glow: b.glow };
        });
        if (batches.length) game = { prog: p2, L: L2, batches, height: built.height, water: built.water };
      } catch (e) { game = null; }
    }

    // Start a few steps in front of the first resident's house (doors face south), else the town hall, else the middle,
    // on the nearest spot you can stand on.
    const home = T.buildings.find(b => /^House/.test(b.name)) || T.buildings.find(b => /Town Hall/.test(b.name));
    let sx = home ? (home.x0 + home.x1) / 2 : 32, sz = home ? home.z1 + 3.5 : 32;
    // With the game's acres, the ground's own heights and water decide where you can walk (objects still block their
    // spots); otherwise Leaflet's acre shapes do.
    const blockedAt = k => (game ? T.blocks[k] || game.water[k] : T.solid[k]);
    const groundAt = (x, z) => {
      if (!game) return 0;
      const fx = Math.max(0, Math.min(N - 1.001, x - 0.5)), fz = Math.max(0, Math.min(N - 1.001, z - 0.5)), x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0, H = game.height;
      const hh = (a, b) => H[Math.min(N - 1, b) * N + Math.min(N - 1, a)];
      return (hh(x0, z0) * (1 - tx) + hh(x0 + 1, z0) * tx) * (1 - tz) + (hh(x0, z0 + 1) * (1 - tx) + hh(x0 + 1, z0 + 1) * tx) * tz;
    };
    const okAt = (x, z) => x >= 0 && z >= 0 && x < N && z < N && !blockedAt(Math.floor(z) * N + Math.floor(x));
    if (!okAt(sx, sz)) { let found = false; for (let r = 1; r < 12 && !found; r++) for (let dz = -r; dz <= r && !found; dz++) for (let dx = -r; dx <= r && !found; dx++) if (okAt(sx + dx, sz + dz)) { sx += dx; sz += dz; found = true; } }
    const me = { x: sx, z: sz, yaw: Math.PI, pitch: -0.1 }, sky = { on: false, yaw: 0.6, pitch: 0.95, dist: 60 };
    const keys = new Set(), info = h('div', { class: 'town3d-info' }), mode = h('button', { class: 'btn small' }, '🦅 Bird’s-eye');
    // A step can't climb or drop more than a slope does (so cliffs are only reached by their ramps).
    const free = (x, z) => x >= 0.3 && z >= 0.3 && x < N - 0.3 && z < N - 0.3 && !blockedAt(Math.floor(z) * N + Math.floor(x)) && (!game || Math.abs(groundAt(x, z) - groundAt(me.x, me.z)) < 0.35);
    const pat = weatherPattern(s, today), snowy = season === 'snow' || season === 'winter';
    const drops = [];   // rain or snow around the camera

    // What the town looks like right now: the game clock (or a picked hour) and the save's weather (or a picked one).
    function moment() {
      const now = CAL.gameNow(s), hour = opt.hour >= 0 ? opt.hour + 0.5 : now.getHours() + now.getMinutes() / 60;
      const lv = opt.wx >= 0 ? opt.wx : wxLevel(pat, Math.floor(hour) % 24);
      return { hour, lv, wet: lv >= 3, snow: lv >= 3 && snowy, ...skyAt(hour, lv, snowy) };
    }
    function particles(M, dt, center, r) {
      const want = M.wet ? (M.lv === 4 ? 900 : 550) * (sky.on ? 1.6 : 1) : 0;
      while (drops.length < want) drops.push({ x: center[0] + (Math.random() * 2 - 1) * r, y: Math.random() * 9, z: center[1] + (Math.random() * 2 - 1) * r, k: Math.random() * 6 });
      drops.length = Math.min(drops.length, want);
      for (const d of drops) {
        d.y -= dt * (M.snow ? 1.3 : 13); if (M.snow) { d.x += Math.sin(d.k + d.y) * dt * 0.4; }
        if (d.y < 0 || Math.abs(d.x - center[0]) > r || Math.abs(d.z - center[1]) > r || (!sky.on && Math.hypot(d.x - center[0], d.z - center[1]) < 0.8)) { d.x = center[0] + (Math.random() * 2 - 1) * r; d.z = center[1] + (Math.random() * 2 - 1) * r; d.y = 6 + Math.random() * 3; }
      }
    }
    function dynamic(M) {
      const B = builder();
      const rc = hexc('#c9d6ee'), sc = hexc('#ffffff');
      for (const d of drops) {
        if (M.snow) { const r = sky.on ? 0.12 : 0.025; B.box(d.x - r, d.y - r, d.z - r, d.x + r, d.y + r, d.z + r, sc); }
        else { B.quad([d.x - 0.012, d.y, d.z], [d.x + 0.012, d.y, d.z], [d.x + 0.012, d.y + 0.45, d.z], [d.x - 0.012, d.y + 0.45, d.z], rc); B.quad([d.x, d.y, d.z - 0.012], [d.x, d.y, d.z + 0.012], [d.x, d.y + 0.45, d.z + 0.012], [d.x, d.y + 0.45, d.z - 0.012], rc); }
      }
      for (const [k, arr] of [['p', B.P], ['c', B.C], ['g', B.G]]) { gl.bindBuffer(gl.ARRAY_BUFFER, dyn[k]); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW); }
      dyn.n = B.P.length / 3;
    }
    function frame() {
      const M = moment();
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(...M.fog, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      let eye, at, far;
      if (sky.on) { const cx = 32, cz = 32; eye = [cx + Math.sin(sky.yaw) * Math.cos(sky.pitch) * sky.dist, Math.sin(sky.pitch) * sky.dist, cz + Math.cos(sky.yaw) * Math.cos(sky.pitch) * sky.dist]; at = [cx, 0, cz]; far = 220; }
      else { const gy = 1.25 + groundAt(me.x, me.z); eye = [me.x, gy, me.z]; at = [me.x + Math.sin(me.yaw) * Math.cos(me.pitch), gy + Math.sin(me.pitch), me.z + Math.cos(me.yaw) * Math.cos(me.pitch)]; far = M.wet ? 26 : 34; }
      const MV = mul(persp(1.0, W / H, 0.1, 400), look(eye, at));
      if (game) {
        // Night-light textures (lit windows) only show after dark.
        const { prog: p2, L } = game; gl.useProgram(p2);
        gl.uniformMatrix4fv(L.m, false, MV); gl.uniform3fv(L.fog, M.fog); gl.uniform3fv(L.light, M.light); gl.uniform1f(L.night, M.night); gl.uniform1f(L.far, far);
        for (const k of [loc.p, loc.c, loc.g]) gl.disableVertexAttribArray(k);
        for (const b of game.batches) {
          if (b.glow && M.night < 0.35) continue;
          gl.uniform1f(L.glow, b.glow); gl.bindTexture(gl.TEXTURE_2D, b.tx); gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
          gl.enableVertexAttribArray(L.p); gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 32, 0);
          gl.enableVertexAttribArray(L.uv); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 32, 12);
          gl.enableVertexAttribArray(L.c); gl.vertexAttribPointer(L.c, 3, gl.FLOAT, false, 32, 20);
          gl.drawArrays(gl.TRIANGLES, 0, b.n);
        }
        for (const k of [L.p, L.uv, L.c]) gl.disableVertexAttribArray(k);
        gl.useProgram(prog);
      }
      gl.uniformMatrix4fv(uM, false, MV);
      gl.uniform3fv(uFog, M.fog); gl.uniform3fv(uLight, M.light); gl.uniform1f(uNight, M.night); gl.uniform1f(uFar, far);
      if (!game) { bind(stat); gl.drawArrays(gl.TRIANGLES, 0, stat.n); }
      dynamic(M); if (dyn.n) { bind(dyn); gl.drawArrays(gl.TRIANGLES, 0, dyn.n); }
      const clock = `${Math.floor(M.hour) % 12 || 12} ${Math.floor(M.hour) % 24 < 12 ? 'AM' : 'PM'} · ${M.snow ? 'Snow' : WX_WORD[M.lv]}`;
      if (!sky.on) {
        const ax = Math.floor(me.x + Math.sin(me.yaw) * 1.1), az = Math.floor(me.z + Math.cos(me.yaw) * 1.1);
        const there = ax >= 0 && az >= 0 && ax < N && az < N ? T.what[az * N + ax] : '';
        info.textContent = `${clock} · ${there ? `In front of you: ${there}` : 'Arrow keys or WASD to walk · drag to look around'}`;
      } else info.textContent = `${clock} · Drag to turn the town · scroll to zoom`;
      return M;
    }
    let raf = 0, last = 0;
    const lively = () => moment().wet;
    function loop(t) {
      raf = 0;
      if (!canvas.isConnected) { stopMusic(); return; }
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      if (!sky.on && keys.size) {
        const fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
        const turn = (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0);
        me.yaw += turn * dt * 2.2;
        const sp = fwd * dt * 4.5, nx = me.x + Math.sin(me.yaw) * sp, nz = me.z + Math.cos(me.yaw) * sp;
        if (free(nx, me.z)) me.x = nx;
        if (free(me.x, nz)) me.z = nz;
      }
      const M = moment();
      particles(M, dt, sky.on ? [32, 32] : [me.x, me.z], sky.on ? 34 : 9);
      frame();
      if (keys.size || lively()) raf = requestAnimationFrame(loop); else last = 0;
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    canvas.addEventListener('keydown', e => { const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); keys.add(k); kick(); } });
    canvas.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
    canvas.addEventListener('blur', () => keys.clear());
    let drag = null;
    canvas.addEventListener('pointerdown', e => { canvas.focus(); drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag = [e.clientX, e.clientY];
      if (sky.on) { sky.yaw -= dx * 0.008; sky.pitch = Math.max(0.25, Math.min(1.5, sky.pitch + dy * 0.006)); }
      else { me.yaw -= dx * 0.006; me.pitch = Math.max(-0.9, Math.min(0.6, me.pitch - dy * 0.005)); }
      frame();
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('wheel', e => { if (!sky.on) return; e.preventDefault(); sky.dist = Math.max(20, Math.min(120, sky.dist * (e.deltaY > 0 ? 1.1 : 0.9))); frame(); }, { passive: false });
    mode.onclick = () => { sky.on = !sky.on; drops.length = 0; mode.textContent = sky.on ? '🚶 Walk' : '🦅 Bird’s-eye'; sfx.click(); frame(); kick(); canvas.focus(); };

    // The hourly music of the game clock (SDAT sequence 0x16 + hour, as on Today in Town), from the player's ROM.
    const canPlay = window.GameSound && GameSound.ready();
    let tune = { tok: 0, hour: -1, timer: null };
    function playMusic() {
      const hr = Math.floor(moment().hour) % 24, tok = ++tune.tok; tune.hour = hr;
      const r = GameSound.playMusic(0x16 + hr, { onEnd: () => { if (opt.music && tok === tune.tok && canvas.isConnected) setTimeout(() => opt.music && tok === tune.tok && playMusic(), 400); } });
      if (!r) { opt.music = false; music.classList.remove('on'); toast('The music couldn’t be played', '🎵'); return; }
      clearInterval(tune.timer);
      tune.timer = setInterval(() => { if (!canvas.isConnected) { stopMusic(); return; } if (opt.music && Math.floor(moment().hour) % 24 !== tune.hour) playMusic(); }, 15000);
    }
    function stopMusic() { tune.tok++; clearInterval(tune.timer); if (opt.music && window.GameSound) GameSound.stopMusic(); }
    const music = h('button', { class: 'btn small' + (opt.music ? ' on' : ''), title: canPlay ? 'Play the hour’s music' : 'Open your ROM on the Welcome screen to hear the town’s music', disabled: !canPlay }, '🎵 Music');
    music.onclick = () => { opt.music = !opt.music; music.classList.toggle('on', opt.music); sfx.click(); if (opt.music) playMusic(); else { GameSound.stopMusic(); tune.tok++; clearInterval(tune.timer); } };
    if (opt.music && canPlay) setTimeout(playMusic, 0);

    const hours = [[-1, '🕰️ Game clock'], ...[...Array(24).keys()].map(x => [x, `${x % 12 || 12} ${x < 12 ? 'AM' : 'PM'}`])];
    const hourSel = UI.selectInput(hours, () => opt.hour, v => { opt.hour = v; frame(); kick(); }, { width: 'w-m' });
    const wxSel = UI.selectInput([[-1, pat === null ? '⛅ Save (not rolled)' : '⛅ Save’s weather'], [0, '☀️ Clear'], [2, '☁️ Cloudy'], [3, snowy ? '❄️ Snow' : '🌧️ Rain'], [4, snowy ? '❄️ Heavy snow' : '⛈️ Heavy rain']], () => opt.wx, v => { opt.wx = v; drops.length = 0; frame(); kick(); }, { width: 'w-m' });
    const art = canGame ? h('button', { class: 'btn small', title: 'Switch between the game’s own models and Leaflet’s drawing' }, opt.art === 'game' ? '✏️ Leaflet drawing' : '🎮 Game models') : null;
    if (art) art.onclick = () => { opt.art = opt.art === 'game' ? 'leaflet' : 'game'; sfx.click(); const card = canvas.closest('.town3d-card'); card && card.replaceWith(townView(s)); };
    const photo = Postcard.button(() => { frame(); return canvas; }, () => `${sky.on ? 'Above' : 'Walking in'} ${s.str(4, 8)}`, `${s.str(4, 8)} postcard`);
    frame(); kick();
    const SEASON_WORD = { spring: 'Spring', bloom: 'Cherry blossoms', summer: 'Summer', fall: 'Autumn', winter: 'Winter', snow: 'Snow on the ground' };
    return h('div', { class: 'card pad town3d-card' },
      h('div', { class: 'town3d-bar' }, info, h('span', { class: 'spacer' }), mode),
      canvas,
      h('div', { class: 'town3d-bar town3d-tools' }, hourSel, wxSel, music, photo, art, h('span', { class: 'spacer' }),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, SEASON_WORD[season])),
      h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '6px', textAlign: 'center' } }, game
        ? 'Drawn with the game’s own acres, trees, flowers and buildings from your ROM, laid out flat to walk on (you walk on the acres’ own ground and can’t wade into water), with trees on the game’s own calendar of leaf colours and blossom, lit by the game clock with the weather the game rolled for today. Fruit on trees isn’t shown yet.'
        : 'Every tree, flower, rock and building is where your save has it, lit by the game clock with the weather the game rolled for today. The ground is shaped from each acre’s type, so rivers and cliffs are close to the game’s but not exact. Drawn by Leaflet; no game art.'));
  }

  VIEWS.push({
    id: 'town3d', group: 'Town', icon: '🚶', title: () => 'Walk Around Town', sub: s => `${s.str(4, 8)} in 3D`,
    tips: ['Click the town, then use the arrow keys or WASD to walk. Drag to look around.', 'Bird’s-eye shows the whole town; drag to turn it and scroll to zoom.', 'The light follows the game clock and the weather is the one the game rolled for today. Pick another hour or weather to see the town differently, then 📷 for a postcard.'],
    render(s) { return [townView(s)]; },
  });
})();
