// Nintendo Wi-Fi Connection identity: keeps a town's friend codes when its save moves between a real DS or 3DS and
// an emulator.
//
// Each resident's save keeps DWC user data (player +0x1E10, 64 bytes, CRC-32 at +0x3C): a pseudo and an authentic
// login ID (43-bit user ID + player ID) and the GameSpy profile ID the friend code is made from. When the game starts
// Wi-Fi it compares the authentic user ID with the console's own WFC user ID, kept in the firmware's Wi-Fi settings
// (access point slots 0 and 1, bytes 0xF0-0xF5, 43 bits). If they differ the game treats the save as coming from
// another console and makes a new profile, so the friend code and its registrations are lost.
//
// So the save is the source of truth: Leaflet reads the user ID from it and writes that ID into the emulator's Wi-Fi
// settings, changing only those 43 bits and each slot's CRC-16. If any slot's CRC were wrong the game would rebuild
// the whole block with a new ID, so every touched slot is re-checked afterwards. Layouts come from the DWC library
// (NitroDWC dwc_account / dwc_bm, as decompiled in the Sonic Rush Adventure project) and melonDS's SPI_Firmware.
(function (root) {
  'use strict';
  const USERDATA = 0x1E10, SLOT = 0x100, ID_BITS = 43n, ID_MASK = (1n << 43n) - 1n;

  // ---------- checksums ----------
  const CRC32 = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
  function crc32(b, off, n) { let c = 0xFFFFFFFF; for (let i = off; i < off + n; i++) c = CRC32[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  // The DS firmware's CRC-16 (reflected 0xA001, start 0), as the game and melonDS compute it.
  function crc16(b, off, n) {
    let c = 0;
    for (let i = off; i < off + n; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xA001 : c >>> 1; }
    return c;
  }
  // The friend code's check digits: CRC-8 (polynomial 7) over the profile ID and game code, both little-endian.
  function crc8(bytes) { let c = 0; for (const x of bytes) { c ^= x; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 7) & 0xFF : (c << 1) & 0xFF; } return c; }

  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const hex = id => id.toString(16).padStart(11, '0');

  // ---------- the save ----------
  // One resident's identity, from the main block bytes m and the player's base offset.
  function fromUserData(m, base) {
    const o = base + USERDATA;
    const out = { ok: false, registered: false, userId: 0n, profileId: 0, friendCode: '', gamecode: '' };
    if (u32(m, o) !== 0x40) return out;   // never set up for Wi-Fi
    out.ok = crc32(m, o, 0x3C) === u32(m, o + 0x3C);
    if (!out.ok) return out;
    const idData = u32(m, o + 0x10), type = (idData >>> 11) & 3;
    out.userId = (BigInt(idData & 0x7FF) << 32n) | BigInt(u32(m, o + 0x14));
    out.registered = type !== 0 && out.userId !== 0n;
    const gs = u32(m, o + 0x1C) | 0, gc = m.slice(o + 0x24, o + 0x28);
    out.gamecode = String.fromCharCode(...gc).split('').reverse().join('');
    out.profileId = gs;
    if (gs > 0) {
      out.friendCode = fcText((BigInt(crc8([gs & 0xFF, (gs >>> 8) & 0xFF, (gs >>> 16) & 0xFF, gs >>> 24, ...gc]) & 0x7F) << 32n) | BigInt(gs));
    }
    return out;
  }
  const fcText = key => { const d = key.toString().padStart(12, '0'); return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`; };
  // A friend's code from their 12-byte DWC friend data (type 2: the code as typed in; type 3: their profile ID, made
  // into a code with this game's code). Type 1 (exchanged over local wireless, not yet confirmed online) has none yet.
  function friendCode(m, off, gamecodeBytes) {
    const type = (u32(m, off) >>> 11) & 3;
    if (type === 2) return fcText((BigInt(u32(m, off + 8)) << 32n) | BigInt(u32(m, off + 4)));
    if (type === 3 && gamecodeBytes) { const gs = u32(m, off + 4); return fcText((BigInt(crc8([gs & 0xFF, (gs >>> 8) & 0xFF, (gs >>> 16) & 0xFF, gs >>> 24, ...gamecodeBytes]) & 0x7F) << 32n) | BigInt(gs)); }
    return type === 1 ? 'swapped locally' : '';
  }

  // Every resident's identity in a WWSave, and the user ID the emulator should have.
  function town(s) {
    const people = [];
    for (let p = 0; p < 4; p++) if (s.playerExists(p)) people.push({ p, name: s.str(s.playerBase(p) + 0x2282, 8), ...fromUserData(s.m, s.playerBase(p)) });
    const ids = [...new Set(people.filter(x => x.registered).map(x => x.userId))];
    return { people, userId: ids[0] || 0n, mixed: ids.length > 1 };
  }

  // ---------- emulator Wi-Fi settings ----------
  const slotId = (b, s) => { let v = 0n; for (let i = 5; i >= 0; i--) v = (v << 8n) | BigInt(b[s + 0xF0 + i]); return v & ID_MASK; };
  const slotOk = (b, s) => crc16(b, s, 0xFE) === (b[s + 0xFE] | (b[s + 0xFF] << 8));
  function setSlot(b, s, id) {
    // The 6 bytes at 0xF0 hold the 43-bit ID; the top 5 bits of the last byte belong to the next field and are kept.
    let v = 0n; for (let i = 5; i >= 0; i--) v = (v << 8n) | BigInt(b[s + 0xF0 + i]);
    v = (v & ~ID_MASK) | (id & ID_MASK);
    for (let i = 0; i < 6; i++) { b[s + 0xF0 + i] = Number(v & 0xFFn); v >>= 8n; }
    const c = crc16(b, s, 0xFE); b[s + 0xFE] = c & 0xFF; b[s + 0xFF] = c >> 8;
  }

  // melonDS's own default, as its built-in firmware writes wfcsettings.bin for a DS: the DSi-only extended slots
  // left blank (0xFF), slot 0 its "melonAP" access point, slots 1 and 2 unused (status 0xFF).
  function melonDefault() {
    const b = new Uint8Array(0x900).fill(0xFF);
    for (let k = 0; k < 3; k++) {
      const s = 0x600 + k * SLOT;
      b.fill(0, s, s + SLOT);
      if (k === 0) [...'melonAP'].forEach((ch, i) => { b[s + 0x40 + i] = ch.charCodeAt(0); });
      b[s + 0xE7] = k === 0 ? 0x00 : 0xFF;   // status: normal / not configured
      b[s + 0xEF] = 0x01;
      const c = crc16(b, s, 0xFE); b[s + 0xFE] = c & 0xFF; b[s + 0xFF] = c >> 8;
    }
    return b;
  }

  // Where the three access point slots are: in melonDS's wfcsettings.bin (0x900 bytes: extended slots, then these),
  // or in a DS firmware dump (128, 256 or 512 KB: 0x400 bytes before the user settings).
  function slotsOf(b, kind) {
    if (kind === 'wfcsettings') {
      if (b.length < 0x900) throw new Error('This isn’t a melonDS wfcsettings.bin (it’s too small).');
      return 0x600;
    }
    if (![0x20000, 0x40000, 0x80000].includes(b.length)) throw new Error('This isn’t a DS firmware dump (they’re 128, 256 or 512 KB).');
    const user = (b[0x20] | (b[0x21] << 8)) * 8, at = user - 0x400;
    if (at < 0x200 || user + 0x200 > b.length) throw new Error('This firmware’s header doesn’t say where its Wi-Fi settings are.');
    return at;
  }

  // What the game would read now: the ID in slot 0 (slot 1 if 0 is damaged), or why it would make a new one.
  function emulatorId(b, kind) {
    const at = slotsOf(b, kind);
    const ok = [0, 1, 2].map(k => slotOk(b, at + k * SLOT));
    if (ok[0]) return { id: slotId(b, at), ok };
    if (ok[1]) return { id: slotId(b, at + SLOT), ok };
    return { id: 0n, ok };
  }

  // Returns a copy with the user ID set, ready to use, after checking it reads back the way the game will read it.
  function apply(bytes, kind, id) {
    if (!id) throw new Error('This town has no Nintendo WFC registration to keep.');
    const b = new Uint8Array(bytes), at = slotsOf(b, kind);
    const before = emulatorId(b, kind);
    if (!before.ok[0] || !before.ok[1] || !before.ok[2]) throw new Error('This file’s Wi-Fi settings are damaged (a checksum doesn’t match), so the game would replace them anyway. Use a fresh file instead.');
    setSlot(b, at, id); setSlot(b, at + SLOT, id);
    const after = emulatorId(b, kind);
    if (after.id !== id || !after.ok.every(Boolean)) throw new Error('The new settings didn’t check out, so nothing was changed.');
    for (let i = 0; i < b.length; i++) if (b[i] !== bytes[i] && !((i >= at + 0xF0 && i < at + 0x100) || (i >= at + SLOT + 0xF0 && i < at + SLOT + 0x100))) throw new Error('Unexpected change outside the WFC ID, so nothing was changed.');
    return { bytes: b, before: before.id, changed: before.id !== id };
  }

  root.WW_WFC = { fromUserData, friendCode, town, melonDefault, emulatorId, apply, crc16, hex, ID_BITS };
})(typeof window !== 'undefined' ? window : this);
