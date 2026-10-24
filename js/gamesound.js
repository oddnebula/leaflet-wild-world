// The game's own sound effects, played from sound_dataENG.sdat in the player's ROM.
// A small NITRO sound player: SDAT (INFO/FAT), SSAR sequence archives, SBNK instrument banks, SWAR wave archives
// (PCM8, PCM16, IMA-ADPCM), SSEQ music, and the sequence commands they use, rendered with WebAudio.
// Effect ids are the game's (Snd_PlaySe): archive = id / 1000, sequence = id % 1000. Music ids are SDAT sequence
// numbers (SndMgr_PlayBgm): K.K. song i is 176 + i on a stereo and 99 + i live at the Roost.
(function () {
  'use strict';
  const u8 = (b, o) => b[o], u16 = (b, o) => b[o] | (b[o + 1] << 8), s16 = (b, o) => (u16(b, o) << 16) >> 16;
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  let sdat = null, info = null, ctx = null, master = null;
  const bankCache = new Map(), swarCache = new Map(), bufCache = new Map();

  function parse(d) {
    const infoOff = u32(d, 0x18), fatOff = u32(d, 0x20);
    const rec = k => { const ro = infoOff + u32(d, infoOff + 8 + k * 4), n = u32(d, ro); return [...Array(n).keys()].map(i => { const e = u32(d, ro + 4 + i * 4); return e ? infoOff + e : 0; }); };
    const file = id => { const e = fatOff + 0xC + id * 16; return d.subarray(u32(d, e), u32(d, e) + u32(d, e + 4)); };
    return { seq: rec(0), ssar: rec(1), bank: rec(2), swar: rec(3), file };
  }
  function ready() { return !!info; }
  function load(bytes) { sdat = bytes; info = parse(bytes); }
  function unload() { stopMusic(); sdat = null; info = null; bankCache.clear(); swarCache.clear(); bufCache.clear(); }

  // ---------- wave archives ----------
  const IMA_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
  const IMA_IDX = [-1, -1, -1, -1, 2, 4, 6, 8];
  function swav(swarNo, waveNo) {
    const key = swarNo + ':' + waveNo;
    if (bufCache.has(key)) return bufCache.get(key);
    const e = info.swar[swarNo]; if (!e) return null;
    let w = swarCache.get(swarNo);
    if (!w) { w = info.file(u16(sdat, e)); swarCache.set(swarNo, w); }
    const n = u32(w, 0x38); if (waveNo >= n) return null;
    const o = u32(w, 0x3C + waveNo * 4);
    const type = w[o], loop = w[o + 1], rate = u16(w, o + 2), loopStart = u16(w, o + 6), loopLen = u32(w, o + 8), data = o + 0xC;
    const bytes = (loopStart + loopLen) * 4;
    let pcm, loopStartS;
    if (type === 0) { pcm = new Float32Array(bytes); for (let i = 0; i < bytes; i++) pcm[i] = ((w[data + i] << 24) >> 24) / 128; loopStartS = loopStart * 4; }
    else if (type === 1) { pcm = new Float32Array(bytes / 2); for (let i = 0; i < pcm.length; i++) pcm[i] = s16(w, data + i * 2) / 32768; loopStartS = loopStart * 2; }
    else {
      let pred = s16(w, data), idx = Math.min(88, w[data + 2]); const out = [];
      for (let i = 4; i < bytes; i++) for (const nib of [w[data + i] & 15, w[data + i] >> 4]) {
        const step = IMA_STEP[idx]; let diff = step >> 3;
        if (nib & 1) diff += step >> 2; if (nib & 2) diff += step >> 1; if (nib & 4) diff += step;
        pred = Math.max(-32768, Math.min(32767, pred + (nib & 8 ? -diff : diff)));
        idx = Math.max(0, Math.min(88, idx + IMA_IDX[nib & 7])); out.push(pred / 32768);
      }
      pcm = Float32Array.from(out); loopStartS = Math.max(0, (loopStart - 1) * 8);
    }
    const buf = ctx.createBuffer(1, Math.max(1, pcm.length), rate || 22050);
    buf.copyToChannel(pcm, 0);
    const r = { buf, loop: !!loop, loopStart: loopStartS / (rate || 22050) };
    bufCache.set(key, r);
    return r;
  }

  // ---------- instrument banks ----------
  function bank(no) {
    if (bankCache.has(no)) return bankCache.get(no);
    const e = info.bank[no]; if (!e) return null;
    const f = info.file(u16(sdat, e)), swars = [0, 1, 2, 3].map(i => u16(sdat, e + 4 + i * 2));
    const n = u32(f, 0x38), inst = [];
    const def = o => ({ wave: u16(f, o), swar: u16(f, o + 2), note: f[o + 4], a: f[o + 5], d: f[o + 6], s: f[o + 7], r: f[o + 8], pan: f[o + 9] });
    for (let i = 0; i < n; i++) {
      const type = f[0x3C + i * 4], off = u16(f, 0x3C + i * 4 + 1);
      if (type >= 1 && type <= 4) inst.push({ type, def: def(off) });
      else if (type === 16) { const lo = f[off], hi = f[off + 1], keys = []; for (let k = lo; k <= hi; k++) { const p = off + 2 + (k - lo) * 12; keys[k] = { type: u16(f, p), def: def(p + 2) }; } inst.push({ type, keys }); }
      else if (type === 17) { const regions = []; let p = off + 8; for (let r = 0; r < 8 && f[off + r]; r++) { regions.push({ top: f[off + r], type: u16(f, p), def: def(p + 2) }); p += 12; } inst.push({ type, regions }); }
      else inst.push(null);
    }
    const b = { inst, swars };
    bankCache.set(no, b);
    return b;
  }
  function voiceFor(b, prog, key) {
    const ins = b.inst[prog]; if (!ins) return null;
    if (ins.type === 16) { const k = ins.keys[key]; return k ? { type: k.type, def: k.def } : null; }
    if (ins.type === 17) { const r = ins.regions.find(x => key <= x.top) || ins.regions[ins.regions.length - 1]; return r ? { type: r.type, def: r.def } : null; }
    return ins;
  }

  // ---------- envelopes (approximations of the DS envelope rates) ----------
  const attackTime = a => a >= 127 ? 0.001 : Math.min(2, 0.0005 * Math.pow(1.065, 127 - a));
  const fallTime = v => v >= 127 ? 0.002 : Math.min(6, 0.004 * Math.pow(1.055, 127 - v));
  const level = v => Math.pow(v / 127, 2);

  let noiseBuf = null;
  function playNote(t, dur, key, vel, vol, pan, b, prog, tr) {
    const v = voiceFor(b, prog, key); if (!v) return;
    const d = v.def, att = tr.a ?? d.a, dec = tr.d ?? d.d, sus = tr.s ?? d.s, rel = tr.r ?? d.r;
    let src;
    if (v.type === 1) {
      const w = swav(b.swars[d.swar], d.wave); if (!w) return;
      src = ctx.createBufferSource(); src.buffer = w.buf;
      if (w.loop) { src.loop = true; src.loopStart = w.loopStart; src.loopEnd = w.buf.duration; }
      src.playbackRate.value = Math.pow(2, (key - d.note + tr.transpose + tr.bend) / 12);
    } else if (v.type === 2) {
      src = ctx.createOscillator(); src.type = 'square'; src.frequency.value = 440 * Math.pow(2, (key - 69 + tr.transpose + tr.bend) / 12);
    } else if (v.type === 3) {
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, 22050, 22050); const c = noiseBuf.getChannelData(0); for (let i = 0; i < c.length; i++) c[i] = Math.random() * 2 - 1; }
      src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    } else return;
    const g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const peak = level(vel) * level(vol) * level(tr.vol) * level(tr.expr) * (v.type === 2 ? 0.25 : 0.9);
    const ta = attackTime(att), td = fallTime(dec), tr_ = fallTime(rel), sl = peak * level(sus);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + ta);
    g.gain.setTargetAtTime(sl, t + ta, td / 3);
    // Duration 0 plays the whole sample (one-shot voices and effects).
    if (!dur) dur = src.buffer && !src.loop ? src.buffer.duration / src.playbackRate.value : 0.25;
    const off = t + Math.max(dur, ta);
    g.gain.cancelScheduledValues(off); g.gain.setTargetAtTime(0, off, tr_ / 4);
    const out = tr.out || master;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, ((tr.pan + (d.pan - 64)) - 64) / 64)); src.connect(g).connect(p).connect(out); } else src.connect(g).connect(out);
    src.start(t); src.stop(off + tr_ + 0.05);
  }

  // ---------- sequencer ----------
  function varlen(b, p) { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7F); } while (c & 0x80); return [v, p]; }
  // Schedules a whole sequence ahead of time. Tempo changes build a tick -> seconds map; with once set, a track ends
  // at its first backward jump (the loop point), so a song plays through once.
  function runSeq(data, start, bk, vol, t0, opt = {}) {
    const maxTicks = opt.maxTicks || 48 * 16, out = opt.out || master;
    const tempos = [[0, 120]];
    const secAt = tick => {
      let sec = 0, last = 0, bpm = 120;
      for (const [tk, b] of tempos) { if (tk > tick) break; sec += (tk - last) * 60 / (bpm * 48); last = tk; bpm = b; }
      return sec + (tick - last) * 60 / (bpm * 48);
    };
    const tracks = [{ p: start, t: 0 }], done = [];
    while (tracks.length) {
      const tr = tracks.shift();
      Object.assign(tr, { prog: 0, vol: 127, expr: 127, pan: 64, transpose: 0, bend: 0, range: 2, wait: true, stack: [], loops: [], a: null, d: null, s: null, r: null, out });
      let p = tr.p, t = tr.t, guard = 0;
      while (p < data.length && guard++ < (opt.maxOps || 4000) && t < maxTicks) {
        const c = data[p++];
        if (c < 0x80) {
          const vel = data[p++]; let dur; [dur, p] = varlen(data, p);
          const at = secAt(t);
          playNote(t0 + at, dur ? secAt(t + dur) - at : 0, c, vel, vol, tr.pan, bk, tr.prog, tr);
          if (tr.wait) t += dur;
          continue;
        }
        switch (c) {
          case 0x80: { let r; [r, p] = varlen(data, p); t += r; break; }
          case 0x81: { let r; [r, p] = varlen(data, p); tr.prog = r; break; }
          case 0x93: { const off = data[p + 1] | (data[p + 2] << 8) | (data[p + 3] << 16); p += 4; tracks.push({ p: off, t }); break; }
          case 0x94: { const to = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16); p = opt.once && to < p ? data.length : to; break; }
          case 0x95: tr.stack.push(p + 3); p = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16); break;
          case 0xA0: { const cmd = data[p]; p += 1 + (cmd < 0x80 ? 1 : cmd >= 0xB0 && cmd <= 0xBD ? 1 : 0) + 4; break; }
          case 0xA1: { const cmd = data[p]; p += 1 + (cmd < 0x80 ? 1 : cmd >= 0xB0 && cmd <= 0xBD ? 1 : 0) + 1; break; }
          case 0xA2: break;
          case 0xC0: tr.pan = data[p++]; break;
          case 0xC1: tr.vol = data[p++]; break;
          case 0xC2: p++; break;
          case 0xC3: tr.transpose = (data[p++] << 24) >> 24; break;
          case 0xC4: tr.bend = ((data[p++] << 24) >> 24) / 127 * tr.range; break;
          case 0xC5: tr.range = data[p++]; break;
          case 0xC7: tr.wait = data[p++] === 1; break;
          case 0xD0: tr.a = data[p++]; break;
          case 0xD1: tr.d = data[p++]; break;
          case 0xD2: tr.s = data[p++]; break;
          case 0xD3: tr.r = data[p++]; break;
          case 0xD4: tr.loops.push({ p: p + 1, n: data[p] }); p++; break;
          case 0xD5: tr.expr = data[p++]; break;
          case 0xE1: { const bpm = Math.max(1, u16(data, p)); p += 2; tempos.push([t, bpm]); tempos.sort((x, y) => x[0] - y[0]); break; }
          case 0xFC: { const l = tr.loops[tr.loops.length - 1]; if (l && (l.n === 0 ? !opt.once : --l.n > 0)) p = l.p; else tr.loops.pop(); break; }
          case 0xFD: p = tr.stack.pop() ?? data.length; break;
          case 0xFE: p += 2; break;
          case 0xFF: p = data.length; break;
          default:
            if (c >= 0xB0 && c <= 0xBD) p += 3;
            else if (c >= 0xC0 && c <= 0xDF) p += 1;
            else if (c >= 0xE0 && c <= 0xE3) p += 2;
            else p = data.length;
        }
      }
      done.push(t);
    }
    return secAt(Math.max(0, ...done));
  }

  function audio() {
    if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
  }
  function play(id, opts = {}) {
    if (!info) return false;
    try {
      audio();
      const arc = Math.floor(id / 1000), seq = id % 1000, e = info.ssar[arc]; if (!e) return false;
      const f = info.file(u16(sdat, e)), dataOff = u32(f, 0x18), n = u32(f, 0x1C); if (seq >= n) return false;
      const r = 0x20 + seq * 12, start = u32(f, r); if (start === 0xFFFFFFFF) return false;
      const bk = bank(u16(f, r + 4)); if (!bk) return false;
      runSeq(f.subarray(dataOff), start, bk, Math.min(127, (f[r + 6] || 100) * (opts.volume ?? 1)), ctx.currentTime + 0.01 + (opts.delay || 0));
      return true;
    } catch (err) { return false; }
  }

  // Renders an effect offline and reports its peak and audible length (used by tests; no sound is played).
  // With { music: true } it renders the first few seconds of a song instead and also reports the song's length.
  async function analyze(id, opt = {}) {
    const saveCtx = ctx, saveMaster = master, saveBufs = new Map(bufCache), saveMusic = music, secs = opt.seconds || 3;
    ctx = new OfflineAudioContext(1, 22050 * secs, 22050); master = ctx.createGain(); master.connect(ctx.destination); bufCache.clear(); music = null;
    let length = null;
    const ok = opt.music ? (() => { const r = playMusic(id); if (r) { length = +r.seconds.toFixed(1); clearTimeout(music.timer); music = null; } return !!r; })() : play(id);
    const out = await ctx.startRendering();
    ctx = saveCtx; master = saveMaster; music = saveMusic; bufCache.clear(); saveBufs.forEach((v, k) => bufCache.set(k, v));
    const d = out.getChannelData(0); let peak = 0, last = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a > 0.01) last = i; }
    return { ok, peak: +peak.toFixed(3), seconds: +(last / 22050).toFixed(2), length };
  }
  // ---------- music (SSEQ) ----------
  // INFO SEQ record: file id, bank, volume. The SSEQ's DATA block gives where the commands start.
  let music = null;
  function stopMusic() {
    if (!music) return;
    const m = music; music = null;
    try { m.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.08); setTimeout(() => m.bus.disconnect(), 600); } catch (e) { /* already gone */ }
    if (m.onEnd) m.onEnd();
  }
  function playMusic(seqNo, opts = {}) {
    if (!info) return null;
    stopMusic();
    try {
      audio();
      const e = info.seq[seqNo]; if (!e) return null;
      const f = info.file(u16(sdat, e)), bk = bank(u16(sdat, e + 4)); if (!bk || String.fromCharCode(...f.subarray(0, 4)) !== 'SSEQ') return null;
      const dataOff = u32(f, 0x18), bus = ctx.createGain(); bus.gain.value = opts.volume ?? 0.9; bus.connect(master);
      const seconds = runSeq(f.subarray(dataOff), 0, bk, sdat[e + 6] || 100, ctx.currentTime + 0.05, { once: true, maxTicks: 48 * 4 * 200, maxOps: 200000, out: bus });
      const m = { bus, seconds, onEnd: opts.onEnd };
      m.timer = setTimeout(() => { if (music === m) stopMusic(); }, (seconds + 1.5) * 1000);
      music = m;
      return { seconds, stop: () => { if (music === m) { clearTimeout(m.timer); stopMusic(); } } };
    } catch (err) { return null; }
  }

  window.GameSound = { load, unload, ready, play, playMusic, stopMusic, analyze, get playingMusic() { return !!music; }, get context() { return ctx; } };

  // Animalese from the game's voice syllables (SndMgr_GetVoiceSeqIndex: archive 0, sequence = syllable + 207 for the
  // default voice). Syllables follow the kana order, so each consonant + vowel pair picks the matching kana.
  const KANA_ROWS = { '': 1, k: 6, s: 11, t: 16, n: 21, h: 26, m: 31, y: 36, r: 39, w: 44, g: 6, z: 11, d: 16, b: 26, p: 26, c: 6, f: 26, j: 11, l: 39, v: 26, x: 11, q: 6 };
  const VOWEL = { a: 0, i: 1, u: 2, e: 3, o: 4 };
  function syllables(text) {
    const s = text.toLowerCase().replace(/[^a-z]/g, ''), out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c in VOWEL) { out.push(1 + VOWEL[c]); continue; }
      const v = s[i + 1];
      if (v in VOWEL) { const row = KANA_ROWS[c] ?? 1; out.push(row === 36 ? 36 + Math.min(2, VOWEL[v] >> 1) : row === 44 ? 44 : row + VOWEL[v]); i++; }
      else out.push(c === 'n' ? 46 : (KANA_ROWS[c] ?? 1) + (KANA_ROWS[c] === 36 ? 1 : KANA_ROWS[c] === 44 ? 0 : 2)); // a lone consonant takes "u", like loanwords
    }
    return out;
  }
  window.GameVoice = {
    say(text) {
      if (!info) return 0;
      const syl = syllables(text).slice(0, 30);
      syl.forEach((n, i) => play(207 + n, { delay: i * 0.075, volume: 0.9 }));
      return syl.length * 75;
    },
    syllables,
  };
})();
