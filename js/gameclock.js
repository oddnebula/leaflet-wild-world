// The town's clock, kept with the save rather than the system it's played on.
//
// Wild World's time is the system clock plus an offset kept in the save (ClockOffset at 0x15FB4: s32 minutes and s16
// seconds; Clock_ReadAdjusted). When a town moves to a system whose clock reads differently, the game's time jumps,
// and the game treats that like time travel: turnips spoil if the time goes backwards or lands in a new week
// (Town_IsClockBeforeLastUpdate, Town_ApplyElapsedDays, TurnipMarket::checkTurnipExpiry), and weeds, visitors and
// villagers move on. So when Leaflet moves a town, it shifts the offset by the difference between the two systems'
// clocks: the game's time carries on as if the town never left. (Only changing the time in the game's own clock menu
// sets its "clock moved" flags; a different offset in the save doesn't.)
(function (root) {
  'use strict';
  const OFFSET = 0x15FB4;

  const offset = s => (s.u32(OFFSET) | 0) * 60 + ((s.u16(OFFSET + 4) << 16) >> 16);
  function setOffset(s, total) {
    const minutes = Math.trunc(total / 60);
    s.set32(OFFSET, minutes);
    s.set16(OFFSET + 4, (total - minutes * 60) & 0xFFFF);
  }

  // Wall-clock times (what a clock shows, no time zone) as milliseconds, so two systems' clocks can be compared.
  const wallNow = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()); };
  function parseWall(text) {
    const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(text || '');
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }

  // A copy of a 256 KB save whose game clock is moved by `seconds` (checksums refreshed). Under a minute isn't worth a
  // change: the clocks agree.
  function shift(bytes, seconds) {
    seconds = Math.round(seconds);
    if (Math.abs(seconds) < 60) return { bytes, seconds: 0 };
    const s = new WWSave(bytes, 'clock.sav');
    setOffset(s, offset(s) + seconds);
    return { bytes: s.export().slice(0, 0x40000), seconds };
  }

  // "3 h 12 min", "2 days 4 h"
  function span(seconds) {
    const t = Math.abs(Math.round(seconds)), d = Math.floor(t / 86400), hh = Math.floor((t % 86400) / 3600), mm = Math.floor((t % 3600) / 60);
    return [d && `${d} day${d === 1 ? '' : 's'}`, hh && `${hh} h`, mm && `${mm} min`].filter(Boolean).join(' ') || 'under a minute';
  }
  // The game's date and time for a save on a system whose clock is `wall` (wall-clock ms).
  const gameTime = (s, wall) => new Date(wall + offset(s) * 1000);
  const showGameTime = d => d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

  // ---------- matching local time ----------
  // The dates the game measures elapsed time from: the town's last update and the start of next week (TownState),
  // the turnip week and the day the turnips were bought, the weather's day, and each resident's last-played date
  // (in the town state and on the resident). Moving the clock moves these by the same number of days, so the game
  // sees no time pass and none go backwards: turnips keep, weeds don't spread, nobody moves out, and nothing reads as
  // time travel.
  const DAY = 86400000;
  const dmy = o => ({ get: s => { const d = s.u8(o), m = s.u8(o + 1), y = s.u8(o + 2); return m >= 1 && m <= 12 && d >= 1 ? Date.UTC(2000 + y, m - 1, d) : null; },
    set: (s, t) => { const x = new Date(t); s.set8(o, x.getUTCDate()); s.set8(o + 1, x.getUTCMonth() + 1); s.set8(o + 2, x.getUTCFullYear() - 2000); } });
  const packed = o => ({ get: s => { const v = s.u16(o), y = v & 0x7F, m = (v >> 7) & 0xF, d = v >> 11; return m >= 1 && m <= 12 && d >= 1 ? Date.UTC(2000 + y, m - 1, d) : null; },
    set: (s, t) => { const x = new Date(t); s.set16(o, ((x.getUTCFullYear() - 2000) & 0x7F) | ((x.getUTCMonth() + 1) << 7) | (x.getUTCDate() << 11)); } });
  function trackedDates(s) {
    const out = [dmy(0x15E54), dmy(0x15E5C), dmy(0x15F4C), dmy(0x15F50), dmy(0x15F66)];
    for (let p = 0; p < 4; p++) if (s.playerExists(p)) out.push(dmy(0x15EAC + p * 4), packed(s.playerBase(p) + 0x2216));
    return out;
  }
  const dayOf = t => Math.floor(t / DAY);
  // How far the game's clock is from this device's (seconds; positive = ahead), for a system whose clock reads
  // systemAhead seconds ahead of this device (0: a DS set to the same time).
  const fromLocal = (s, systemAhead = 0) => offset(s) + systemAhead;
  // Sets the game clock to this device's time and moves the tracked dates with it. Returns what changed.
  function matchLocal(s, systemAhead = 0) {
    const wall = wallNow(), before = gameTime(s, wall + systemAhead * 1000).getTime(), target = -systemAhead;
    const seconds = target - offset(s);
    if (Math.abs(seconds) < 60) return { seconds: 0, days: 0 };
    const days = dayOf(before + seconds * 1000) - dayOf(before);
    setOffset(s, target);
    // Only real dates near the game's own (placeholders such as 1/1/2000 in unused slots stay as they are).
    if (days) for (const f of trackedDates(s)) { const t = f.get(s); if (t != null && Math.abs(dayOf(t) - dayOf(before)) <= 400) f.set(s, t + days * DAY); }
    return { seconds, days };
  }

  root.WW_GAMECLOCK = { OFFSET, offset, setOffset, wallNow, parseWall, shift, span, gameTime, showGameTime, fromLocal, matchLocal };
})(typeof window !== 'undefined' ? window : this);
