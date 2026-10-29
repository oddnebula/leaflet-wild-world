// Animal Crossing: Wild World (USA / EUR) save engine.
// Layout and checksum rules are cross-checked against the ADME decompilation:
//  - the main block (0x15FE0 bytes) is stored twice; each copy sums to 0 as u16 words,
//    with the checksum word at 0x15FDC and a generation byte at 0x15FDF;
//  - the game loads copy 2 when both copies are valid and their generations match, else copy 1;
//  - before the main checksum it refreshes several inner checksums (see SUB_BLOCKS);
//  - town-hall letter storage (0x2E20C, 0x11DF4 bytes) has its own checksum at 0x3FFFE.
(function () {
  'use strict';

  const SAVE_SIZE = 0x40000;
  const BLOCK = 0x15FE0;
  const COPY2 = 0x15FE0;
  const MAIN_CK = 0x15FDC;
  const GENERATION = 0x15FDF;
  const LETTERS = 0x2E20C;
  const LETTERS_SIZE = 0x11DF4;
  const LETTERS_CK = 0x3FFFE;
  const PLAYER = 0xC;
  const PLAYER_SIZE = 0x228C;
  const VILLAGER = 0x8A3C;
  const VILLAGER_SIZE = 0x700;
  const EMPTY = 0xFFF1;

  // [offset in block, size, checksum offset inside, checksum width]
  const SUB_BLOCKS = [[0x10C3C, 0x84C, 0x84A, 2], [0x15C58, 0xF8, 0xF4, 1]];
  for (let p = 0; p < 4; p++) {
    const b = PLAYER + p * PLAYER_SIZE;
    SUB_BLOCKS.push([b + 0x1E10, 0x50, 0x4C, 2], [b + 0x1E60, 0x384, 0x380, 2]);
  }

  const D = window.WW_DATA;
  const CHARS = D.chars;
  const ENCODE = new Map();
  CHARS.forEach((c, i) => { if (c && !ENCODE.has(c)) ENCODE.set(c, i); });
  // Typing-friendly aliases for characters the game draws with its own glyphs.
  [['’', "'"], ['‘', "'"], ['"', '“'], ['…', '…'], ['ß', 'ß']].forEach(([alias, real]) => {
    if (!ENCODE.has(alias) && ENCODE.has(real)) ENCODE.set(alias, ENCODE.get(real));
  });

  function sum16(u8, off, len) {
    let s = 0;
    for (let i = 0; i < len; i += 2) s = (s + (u8[off + i] | (u8[off + i + 1] << 8))) & 0xFFFF;
    return s;
  }

  class WWSave {
    constructor(bytes, fileName) {
      if (bytes.length < SAVE_SIZE) throw new Error('This file is too small to be a Wild World save (needs 256 KB).');
      this.raw = new Uint8Array(bytes.slice(0, SAVE_SIZE));
      this.trailer = bytes.length > SAVE_SIZE ? new Uint8Array(bytes.slice(SAVE_SIZE)) : null; // e.g. DeSmuME footer
      this.fileName = fileName || 'Animal Crossing - Wild World.sav';
      const ok = [0, COPY2].map(c => this.raw[c] === 0x8A || this.raw[c] === 0xC5).map((id, i) =>
        id && sum16(this.raw, i ? COPY2 : 0, BLOCK) === 0);
      if (!ok[0] && !ok[1]) {
        const id = this.raw[0];
        if (id === 0x32) throw new Error('This looks like a Japanese or Korean save. Only USA and European saves are supported.');
        throw new Error('No valid Wild World town was found in this file. Both copies failed their checksum.');
      }
      let use = 1;
      if (ok[0] && ok[1]) use = this.raw[GENERATION] === this.raw[COPY2 + GENERATION] ? 1 : 0;
      else use = ok[1] ? 1 : 0;
      this.copyUsed = use;
      this.copyStatus = ok;
      this.region = this.raw[use ? COPY2 : 0] === 0xC5 ? 'Europe' : 'USA';
      this.m = this.raw.slice(use ? COPY2 : 0, (use ? COPY2 : 0) + BLOCK); // working main block
      this.letters = this.raw.slice(LETTERS, LETTERS + LETTERS_SIZE);
      this.lettersValid = sum16(this.raw, LETTERS, LETTERS_SIZE) === 0;
      this.dirty = false;
      this.listeners = [];
    }

    // ---- primitive access on the main block -------------------------------------------
    u8(o) { return this.m[o]; }
    u16(o) { return this.m[o] | (this.m[o + 1] << 8); }
    u32(o) { return (this.m[o] | (this.m[o + 1] << 8) | (this.m[o + 2] << 16) | (this.m[o + 3] << 24)) >>> 0; }
    set8(o, v) { this.touch(o, 1); this.m[o] = v & 0xFF; }
    set16(o, v) { this.touch(o, 2); this.m[o] = v & 0xFF; this.m[o + 1] = (v >> 8) & 0xFF; }
    set32(o, v) { this.touch(o, 4); for (let i = 0; i < 4; i++) this.m[o + i] = (v >>> (8 * i)) & 0xFF; }
    bits(o, shift, width) { return (this.m[o] >> shift) & ((1 << width) - 1); }
    setBits(o, shift, width, v) {
      const mask = ((1 << width) - 1) << shift;
      this.set8(o, (this.m[o] & ~mask) | ((v << shift) & mask));
    }
    bit(o, i) { return (this.m[o + (i >> 3)] >> (i & 7)) & 1; }
    setBit(o, i, on) {
      const a = o + (i >> 3);
      this.set8(a, on ? this.m[a] | (1 << (i & 7)) : this.m[a] & ~(1 << (i & 7)));
    }
    bytes(o, n) { return this.m.slice(o, o + n); }
    setBytes(o, arr) { this.touch(o, arr.length); this.m.set(arr, o); }

    str(o, n, buf) {
      const b = buf || this.m;
      let s = '';
      for (let i = 0; i < n; i++) { const c = b[o + i]; if (c === 0) break; s += CHARS[c] || '?'; }
      return s.replace(/ +$/, '');
    }
    setStr(o, n, s, buf) {
      const out = new Uint8Array(n);
      let i = 0;
      for (const ch of s) {
        if (i >= n) break;
        const code = ENCODE.get(ch);
        out[i++] = code === undefined ? ENCODE.get('?') : code;
      }
      // The game pads names with spaces (0x85) only inside player/town fields; zero-fill is also valid.
      if (buf) { this.remember(buf, o, n); buf.set(out, o); this.markDirty(); } else this.setBytes(o, out);
    }
    static canEncode(s) { for (const ch of s) if (!ENCODE.has(ch)) return false; return true; }
    // Text in the game's character set, n bytes, zero-padded (for building records outside a save).
    static encode(s, n) { const out = new Uint8Array(n); let i = 0; for (const ch of s) { if (i >= n) break; const c = ENCODE.get(ch); out[i++] = c === undefined ? ENCODE.get('?') : c; } return out; }

    // ---- undo and redo ---------------------------------------------------------------
    // Every write records the bytes it replaces. Writes less than 0.7 s apart on the same page make one step, so one
    // click (which may set several fields) undoes in one go. Steps last for the session, up to 300.
    remember(buf, o, n) {
      if (this.replaying) return;
      const H = this.history || (this.history = { undo: [], redo: [], last: 0, sealed: false }), now = Date.now();
      if (!H.undo.length || H.sealed || now - H.last > 700) {
        H.undo.push({ when: now, label: WWSave.label ? WWSave.label() : '', edits: [] }); H.sealed = false;
        if (H.undo.length > 300) H.undo.shift();
      }
      H.last = now; H.redo.length = 0;
      H.undo[H.undo.length - 1].edits.push([buf, o, buf.slice(o, o + n)]);
    }
    sealStep() { if (this.history) this.history.sealed = true; }
    // Puts back the bytes a step recorded and returns the step that would reverse it.
    replay(step) {
      const back = [];
      this.replaying = true;
      for (let i = step.edits.length - 1; i >= 0; i--) { const [buf, o, old] = step.edits[i]; back.push([buf, o, buf.slice(o, o + old.length)]); buf.set(old, o); }
      this.replaying = false;
      return { ...step, edits: back };
    }
    undo() { const H = this.history; if (!H || !H.undo.length) return null; const st = H.undo.pop(); H.redo.push(this.replay(st)); H.sealed = true; this.markDirty(); return st; }
    redo() { const H = this.history; if (!H || !H.redo.length) return null; const st = H.redo.pop(); H.undo.push(this.replay(st)); H.sealed = true; this.markDirty(); return st; }
    get canUndo() { return !!(this.history && this.history.undo.length); }
    get canRedo() { return !!(this.history && this.history.redo.length); }

    touch(o, n) { if (o !== undefined) this.remember(this.m, o, n); this.markDirty(); }
    markDirty() { if (!this.dirty) { this.dirty = true; } this.listeners.forEach(f => f()); }
    onChange(f) { this.listeners.push(f); }

    // ---- letter storage (separate region) ---------------------------------------------
    lu16(o) { return this.letters[o] | (this.letters[o + 1] << 8); }
    lset16(o, v) { this.remember(this.letters, o, 2); this.letters[o] = v & 0xFF; this.letters[o + 1] = v >> 8; this.markDirty(); }

    // ---- helpers ----------------------------------------------------------------------
    playerBase(p) { return PLAYER + p * PLAYER_SIZE; }
    villagerBase(v) { return VILLAGER + v * VILLAGER_SIZE; }
    playerExists(p) { return this.u16(this.playerBase(p) + 0x2280) !== 0 && this.u16(this.playerBase(p) + 0x2280) !== 0xFFFF; }

    // ---- checksums & export -----------------------------------------------------------
    fixChecksums() {
      const m = this.m;
      for (const [off, size, ck, width] of SUB_BLOCKS) {
        if (width === 2) {
          m[off + ck] = 0; m[off + ck + 1] = 0;
          const c = (-sum16(m, off, size)) & 0xFFFF;
          m[off + ck] = c & 0xFF; m[off + ck + 1] = c >> 8;
        } else {
          // The game stores this one as a byte: (−(sum − old)) truncated to 8 bits.
          const old = m[off + ck];
          const c = (-((sum16(m, off, size) - old) & 0xFFFF)) & 0xFFFF;
          m[off + ck] = c & 0xFF;
        }
      }
      m[MAIN_CK] = 0; m[MAIN_CK + 1] = 0;
      const c = (-sum16(m, 0, BLOCK)) & 0xFFFF;
      m[MAIN_CK] = c & 0xFF; m[MAIN_CK + 1] = c >> 8;
      const L = this.letters, lck = LETTERS_CK - LETTERS;
      L[lck] = 0; L[lck + 1] = 0;
      const lc = (-sum16(L, 0, LETTERS_SIZE)) & 0xFFFF;
      L[lck] = lc & 0xFF; L[lck + 1] = lc >> 8;
    }

    export() {
      this.fixChecksums();
      const out = new Uint8Array(this.raw);
      out.set(this.m, 0);
      out.set(this.m, COPY2); // identical copies with equal generations: the game loads copy 2
      out.set(this.letters, LETTERS);
      if (!this.trailer) return out;
      const full = new Uint8Array(out.length + this.trailer.length);
      full.set(out); full.set(this.trailer, out.length);
      return full;
    }

    verify(bytes) {
      return sum16(bytes, 0, BLOCK) === 0 && sum16(bytes, COPY2, BLOCK) === 0 && sum16(bytes, LETTERS, LETTERS_SIZE) === 0;
    }
  }

  WWSave.C = { BLOCK, PLAYER, PLAYER_SIZE, VILLAGER, VILLAGER_SIZE, EMPTY, LETTERS, SUB_BLOCKS };
  WWSave.sum16 = sum16;
  window.WWSave = WWSave;
})();
