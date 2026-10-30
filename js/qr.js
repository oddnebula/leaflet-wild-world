// QR codes for short addresses (Leaflet on a phone: "http://192.168.1.23:8226/"). Version 3 (29x29), error
// correction M, byte mode, up to 42 bytes, the mask picked by the standard's penalty rules. The same code as Leaflet
// Link's link/source/qr.c, so the 3DS and Leaflet draw identical codes.
(function () {
  'use strict';
  const N = 29, DATA = 44, ECC = 26;
  const gfMul = (a, b) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >> 7) * 0x11D); z ^= ((b >> i) & 1) * a; } return z & 0xFF; };
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];

  // Rows of 0/1 (1 = dark), or null if text is too long.
  function encode(text) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 42) return null;
    const cw = new Uint8Array(DATA + ECC); let bit = 0;
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--, bit++) if ((v >> i) & 1) cw[bit >> 3] |= 0x80 >> (bit & 7); };
    put(4, 4); put(bytes.length, 8); bytes.forEach(b => put(b, 8));
    bit = Math.min(bit + 4, DATA * 8);
    for (let i = Math.ceil(bit / 8), pad = 0xEC; i < DATA; i++, pad ^= 0xEC ^ 0x11) cw[i] = pad;
    const gen = new Uint8Array(ECC); gen[ECC - 1] = 1; let root = 1;
    for (let i = 0; i < ECC; i++) { for (let j = 0; j < ECC; j++) { gen[j] = gfMul(gen[j], root); if (j + 1 < ECC) gen[j] ^= gen[j + 1]; } root = gfMul(root, 2); }
    const rem = new Uint8Array(ECC);
    for (let i = 0; i < DATA; i++) { const f = cw[i] ^ rem[0]; rem.copyWithin(0, 1); rem[ECC - 1] = 0; for (let j = 0; j < ECC; j++) rem[j] ^= gfMul(gen[j], f); }
    cw.set(rem, DATA);

    const mod = [...Array(N)].map(() => new Uint8Array(N)), fn = [...Array(N)].map(() => new Uint8Array(N));
    const setFn = (x, y, d) => { mod[y][x] = d ? 1 : 0; fn[y][x] = 1; };
    const format = mask => {
      const data = mask; let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
      const b = ((data << 10) | rem) ^ 0x5412, at = i => (b >> i) & 1;
      for (let i = 0; i <= 5; i++) setFn(8, i, at(i));
      setFn(8, 7, at(6)); setFn(8, 8, at(7)); setFn(7, 8, at(8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, at(i));
      for (let i = 0; i < 8; i++) setFn(N - 1 - i, 8, at(i));
      for (let i = 8; i < 15; i++) setFn(8, N - 15 + i, at(i));
      setFn(8, N - 8, 1);
    };
    for (let i = 0; i < N; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [N - 4, 3], [3, N - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < N && y >= 0 && y < N) setFn(x, y, d !== 2 && d !== 4);
    }
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(22 + dx, 22 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    format(0);
    let i = 0;
    for (let right = N - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < N; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? N - 1 - v : v;
        if (!fn[y][x] && i < (DATA + ECC) * 8) { mod[y][x] = (cw[i >> 3] >> (7 - (i & 7))) & 1; i++; }
      }
    }
    const applyMask = m => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] ^= 1; };
    const PAT = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const penalty = () => {
      let p = 0, dark = 0;
      for (let pass = 0; pass < 2; pass++) for (let a = 0; a < N; a++) {
        let run = 0, last = -1;
        for (let b = 0; b < N; b++) { const c = pass ? mod[b][a] : mod[a][b]; if (c === last) { if (++run === 5) p += 3; else if (run > 5) p++; } else { last = c; run = 1; } }
        for (let b = 0; b + 10 < N; b++) {
          let f = 1, r = 1;
          for (let k = 0; k < 11; k++) { const c = pass ? mod[b + k][a] : mod[a][b + k]; if (c !== PAT[k]) f = 0; if (c !== PAT[10 - k]) r = 0; }
          p += 40 * (f + r);
        }
      }
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        dark += mod[y][x];
        if (x + 1 < N && y + 1 < N && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3;
      }
      return p + Math.floor(Math.abs(Math.trunc(dark * 100 / (N * N)) - 50) / 5) * 10;
    };
    let best = 0, bestP = -1;
    for (let m = 0; m < 8; m++) { applyMask(m); format(m); const p = penalty(); if (bestP < 0 || p < bestP) { bestP = p; best = m; } applyMask(m); }
    applyMask(best); format(best);
    return mod.map(r => [...r]);
  }
  // An SVG of the code with a quiet zone, scaled by CSS.
  function svg(text, label) {
    const m = encode(text); if (!m) return null;
    const q = 3, w = N + q * 2, ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, 'svg');
    el.setAttribute('viewBox', `0 0 ${w} ${w}`); el.setAttribute('role', 'img'); el.setAttribute('aria-label', label || text); el.setAttribute('shape-rendering', 'crispEdges');
    let d = '';
    m.forEach((row, y) => { for (let x = 0; x < N; x++) if (row[x]) { let e = x; while (e + 1 < N && row[e + 1]) e++; d += `M${x + q} ${y + q}h${e - x + 1}v1h-${e - x + 1}z`; x = e; } });
    el.innerHTML = `<rect width="${w}" height="${w}" fill="#fff"/><path d="${d}" fill="#000"/>`;
    return el;
  }
  window.QR = { encode, svg };
})();
