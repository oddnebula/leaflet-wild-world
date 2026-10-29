// The town in 3D, to walk around. Everything on the town map is placed exactly where the save has it (trees, fruit,
// flowers, weeds, rocks, signs and every building with its footprint); the ground (grass, rivers, ponds, beaches,
// cliffs, bridges) is shaped from Leaflet's own acre drawings (js/acreart.js), so it's close to the game's but not
// exact. Everything is drawn by Leaflet: no game models or art.
(function () {
  'use strict';
  const { h, sfx, item } = UI;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const MAP = 0xC354, ACRES = 0xC330, N = 64;

  // ---------- a tiny renderer: coloured triangles, fog, perspective ----------
  const VS = 'attribute vec3 p; attribute vec3 c; uniform mat4 m; varying vec3 vc; varying float d; void main() { vec4 q = m * vec4(p, 1.0); gl_Position = q; vc = c; d = q.w; }';
  const FS = 'precision mediump float; varying vec3 vc; varying float d; uniform vec3 fog; uniform float far; void main() { float f = clamp((d - far * 0.35) / (far * 0.65), 0.0, 1.0); gl_FragColor = vec4(mix(vc, fog, f), 1.0); }';
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
    const P = [], C = [];
    const tri = (a, b, c, col) => { P.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) C.push(...col); };
    const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
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
    return { P, C, box, quad, roof, blob, shade };
  }

  // ---------- the town ----------
  const TREE = { Cedar: '#2f7a45', Palm: '#57b04a', Apple: '#e4483d', Orange: '#f39a2b', Pear: '#c9d64a', Peach: '#f49ab0', Cherry: '#b8263b', Coconut: '#8a5a2b', Money: '#f2c230', Bells: '#f2c230' };
  const FLOWER = [['Red', '#e8473f'], ['White', '#f6f6f2'], ['Yellow', '#f4d23c'], ['Pink', '#f59ac0'], ['Purple', '#9a63d6'], ['Orange', '#f39a3b'], ['Blue', '#5b8fe6'], ['Black', '#3a3340']];
  const BUILD = [[/Town Hall/, '#c8a46e', '#7a4b2b', 2.2], [/Neighbor House/, null, null, 1.6], [/^House/, '#f2e2c4', '#c8553d', 1.8], [/Museum/, '#d8c8a8', '#6a8a5a', 2.1], [/Nook|Nookington/, '#f2d08a', '#3f8f4f', 1.7],
    [/Able/, '#f6d6e6', '#d0607a', 1.7], [/Gate/, '#e8d6a8', '#c8553d', 1.6], [/Tent/, '#e8d070', '#b04848', 1.4], [/Ship|Car/, '#c8c8d0', '#5070a8', 1.0], [/Sign|Board|Mailbox|Countdown/, '#c08a50', null, 0.9]];
  const NEIGHBOR_COLORS = ['#e9c46a', '#a8d8ea', '#f4a6a6', '#b8e0a8', '#d6b8f0', '#f6d6a8', '#a8c8f0', '#f0b8d8'];

  function build(s) {
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
      const col = k === 1 ? hexc('#4fa7dc', chk ? 1 : 0.95) : k === 2 ? hexc('#ecd9a0', chk ? 1 : 0.96) : k === 3 ? hexc('#4c9a52', chk ? 1 : 0.94) : k === 4 ? hexc('#b07a44', chk ? 1 : 0.9) : hexc(chk ? '#6dbd63' : '#62b25a');
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
    B.quad([-40, -0.02, -40], [-40, -0.02, 0], [N + 40, -0.02, 0], [N + 40, -0.02, -40], hexc('#4f9e52'));
    B.quad([-40, -0.02, 0], [-40, -0.02, N], [0, -0.02, N], [0, -0.02, 0], hexc('#4f9e52'));
    B.quad([N, -0.02, 0], [N, -0.02, N], [N + 40, -0.02, N], [N + 40, -0.02, 0], hexc('#4f9e52'));
    B.quad([-40, -0.35, N], [-40, -0.35, N + 60], [N + 40, -0.35, N + 60], [N + 40, -0.35, N], hexc('#3d86c4'));

    // Everything on the map.
    const ids = new Uint16Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) ids[y * N + x] = s.u16(MAP + idx(x, y) * 2);
    const seen = new Uint8Array(N * N), buildings = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const id = ids[y * N + x], it = item(id), cat = it.cat, name = it.name || '', cx = x + 0.5, cz = y + 0.5, base = height(kind[y * N + x]) > 0 ? height(kind[y * N + x]) : 0;
      if (cat === 'Empty' || cat === 'Occupied Space') continue;
      what[y * N + x] = name;
      if (/Trees|Palm Trees/.test(cat)) {
        solid[y * N + x] = 1;
        const small = /Sapling|Small|Young/.test(name) ? 0.45 : /Medium/.test(name) ? 0.7 : 1, palm = cat === 'Palm Trees' || /Palm|Coconut/.test(name), cedar = /Cedar/.test(name);
        B.box(cx - 0.09, base, cz - 0.09, cx + 0.09, base + 1.1 * small, cz + 0.09, hexc('#8a5a32'));
        if (cedar) { B.blob(cx, base + 0.9 * small, cz, 0.55 * small, 1.6 * small, hexc('#2f7a45')); }
        else if (palm) { B.blob(cx, base + 1.25 * small, cz, 0.7 * small, 0.25 * small, hexc('#57b04a')); }
        else B.blob(cx, base + 1.15 * small, cz, 0.6 * small, 0.65 * small, hexc('#3f9a4a'));
        const fruit = Object.keys(TREE).find(k => name.includes(k) && k !== 'Cedar' && k !== 'Palm');
        if (fruit && small === 1) for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; B.box(cx + Math.cos(a) * 0.42 - 0.07, base + 1.05, cz + Math.sin(a) * 0.42 - 0.07, cx + Math.cos(a) * 0.42 + 0.07, base + 1.19, cz + Math.sin(a) * 0.42 + 0.07, hexc(TREE[fruit])); }
      } else if (/Flowers/.test(cat)) {
        const col = (FLOWER.find(([w]) => name.includes(w)) || [0, '#f59ac0'])[1];
        B.box(cx - 0.03, base, cz - 0.03, cx + 0.03, base + 0.22, cz + 0.03, hexc('#4f9a3f'));
        B.blob(cx, base + 0.27, cz, 0.15, 0.08, hexc(col, cat === 'Parched Flowers' ? 0.65 : 1));
      } else if (cat === 'Weeds') B.blob(cx, base + 0.08, cz, 0.22, 0.16, hexc('#8fcf5a'));
      else if (/Rocks/.test(cat)) { solid[y * N + x] = 1; B.blob(cx, base + 0.25, cz, 0.42, 0.4, hexc('#9a9a9a')); }
      else if (cat === 'Special Stumps') B.box(cx - 0.25, base, cz - 0.25, cx + 0.25, base + 0.3, cz + 0.25, hexc('#8a5a32'));
      else if (cat === 'Snowmen') { B.blob(cx, base + 0.3, cz, 0.35, 0.3, hexc('#f8f8ff')); B.blob(cx, base + 0.85, cz, 0.25, 0.22, hexc('#f8f8ff')); solid[y * N + x] = 1; }
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
        foot.forEach(([fx, fy]) => { solid[fy * N + fx] = 1; what[fy * N + fx] = name; });
        buildings.push({ name, x0, z0, x1, z1 });
        let [, wallC, roofC, hgt] = BUILD.find(([re]) => re.test(name)) || [0, '#e8d8b8', '#8a6a4a', 1.6];
        if (/Neighbor House #(\d)/.test(name)) { const v = +RegExp.$1 - 1; wallC = NEIGHBOR_COLORS[v % 8]; roofC = ['#c8553d', '#4f7fd6', '#3f8f4f', '#9a6fd1', '#e0ae12', '#8a5a32', '#d0607a', '#3a3a44'][v % 8]; }
        if (/Sign|Board|Mailbox|Countdown/.test(name)) { B.box(x0 + 0.3, base, z0 + 0.4, x1 - 0.3, base + hgt, z0 + 0.55, hexc(wallC)); continue; }
        const inset = 0.12; x0 += inset; z0 += inset; x1 -= inset; z1 -= inset;
        B.box(x0, base, z0, x1, base + hgt, z1, hexc(wallC));
        B.box((x0 + x1) / 2 - 0.25, base, z1 - 0.001, (x0 + x1) / 2 + 0.25, base + 0.75, z1 + 0.02, hexc('#7a4b2b'));   // door, facing south
        if (roofC) B.roof(x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, base + hgt, Math.min(1.4, (x1 - x0) * 0.45), hexc(roofC));
      }
    }
    return { P: new Float32Array(B.P), C: new Float32Array(B.C), kind, solid, what, ids, buildings };
  }

  // ---------- the viewer: walk, or look from above ----------
  function townView(s) {
    const W = Math.min(960, Math.max(320, (document.getElementById('content')?.clientWidth || 900) - 110)), H = Math.round(W * 0.58);
    const canvas = h('canvas', { class: 'town3d', tabindex: 0, width: W * 2, height: H * 2, style: { width: W + 'px', height: H + 'px' } });
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return h('div', { class: 'room3d-empty' }, '3D needs WebGL, which this browser has turned off.');
    const T = build(s);
    const sh = (t, src) => { const x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); return x; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    const buf = (data, name) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); const l = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0); };
    buf(T.P, 'p'); buf(T.C, 'c');
    const uM = gl.getUniformLocation(prog, 'm'), uFog = gl.getUniformLocation(prog, 'fog'), uFar = gl.getUniformLocation(prog, 'far');
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.disable(gl.CULL_FACE);

    // Start a few steps in front of the first resident's house (doors face south), else the town hall, else the middle,
    // on the nearest spot you can stand on.
    const home = T.buildings.find(b => /^House/.test(b.name)) || T.buildings.find(b => /Town Hall/.test(b.name));
    let sx = home ? (home.x0 + home.x1) / 2 : 32, sz = home ? home.z1 + 3.5 : 32;
    const okAt = (x, z) => x >= 0 && z >= 0 && x < N && z < N && !T.solid[Math.floor(z) * N + Math.floor(x)];
    if (!okAt(sx, sz)) { let found = false; for (let r = 1; r < 12 && !found; r++) for (let dz = -r; dz <= r && !found; dz++) for (let dx = -r; dx <= r && !found; dx++) if (okAt(sx + dx, sz + dz)) { sx += dx; sz += dz; found = true; } }
    const me = { x: sx, z: sz, yaw: Math.PI, pitch: -0.1 }, sky = { on: false, yaw: 0.6, pitch: 0.95, dist: 60 };
    const keys = new Set(), info = h('div', { class: 'town3d-info' }), mode = h('button', { class: 'btn small' }, '🦅 Bird’s-eye');
    const free = (x, z) => x >= 0.3 && z >= 0.3 && x < N - 0.3 && z < N - 0.3 && !T.solid[Math.floor(z) * N + Math.floor(x)];
    function frame() {
      const fogC = [0.62, 0.84, 0.98];
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(...fogC, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      let eye, at, far;
      if (sky.on) { const cx = 32, cz = 32; eye = [cx + Math.sin(sky.yaw) * Math.cos(sky.pitch) * sky.dist, Math.sin(sky.pitch) * sky.dist, cz + Math.cos(sky.yaw) * Math.cos(sky.pitch) * sky.dist]; at = [cx, 0, cz]; far = 220; }
      else { eye = [me.x, 1.25, me.z]; at = [me.x + Math.sin(me.yaw) * Math.cos(me.pitch), 1.25 + Math.sin(me.pitch), me.z + Math.cos(me.yaw) * Math.cos(me.pitch)]; far = 34; }
      gl.uniformMatrix4fv(uM, false, mul(persp(1.0, W / H, 0.1, 400), look(eye, at)));
      gl.uniform3fv(uFog, fogC); gl.uniform1f(uFar, far);
      gl.drawArrays(gl.TRIANGLES, 0, T.P.length / 3);
      if (!sky.on) {
        const ax = Math.floor(me.x + Math.sin(me.yaw) * 1.1), az = Math.floor(me.z + Math.cos(me.yaw) * 1.1);
        const there = ax >= 0 && az >= 0 && ax < N && az < N ? T.what[az * N + ax] : '';
        info.textContent = there ? `In front of you: ${there}` : 'Arrow keys or WASD to walk · drag to look around';
      } else info.textContent = 'Drag to turn the town · scroll to zoom';
    }
    let raf = 0, last = 0;
    function loop(t) {
      raf = 0;
      if (!canvas.isConnected) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      if (!sky.on && keys.size) {
        const fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
        const turn = (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0);
        me.yaw += turn * dt * 2.2;
        const sp = fwd * dt * 4.5, nx = me.x + Math.sin(me.yaw) * sp, nz = me.z + Math.cos(me.yaw) * sp;
        if (free(nx, me.z)) me.x = nx;
        if (free(me.x, nz)) me.z = nz;
      }
      frame();
      if (keys.size) { raf = requestAnimationFrame(loop); } else last = 0;
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
    mode.onclick = () => { sky.on = !sky.on; mode.textContent = sky.on ? '🚶 Walk' : '🦅 Bird’s-eye'; sfx.click(); frame(); canvas.focus(); };
    frame();
    return h('div', { class: 'card pad town3d-card' },
      h('div', { class: 'town3d-bar' }, info, h('span', { class: 'spacer' }), mode),
      canvas,
      h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '6px', textAlign: 'center' } }, 'Every tree, flower, rock and building is where your save has it. The ground is shaped from each acre’s type, so rivers and cliffs are close to the game’s but not exact. Drawn by Leaflet; no game art.'));
  }

  VIEWS.push({
    id: 'town3d', group: 'Town', icon: '🚶', title: () => 'Walk Around Town', sub: s => `${s.str(4, 8)} in 3D`,
    tips: ['Click the town, then use the arrow keys or WASD to walk. Drag to look around.', 'Bird’s-eye shows the whole town; drag to turn it and scroll to zoom.'],
    render(s) { return [townView(s)]; },
  });
})();
