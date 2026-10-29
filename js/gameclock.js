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

  root.WW_GAMECLOCK = { OFFSET, offset, setOffset, wallNow, parseWall, shift, span, gameTime, showGameTime };
})(typeof window !== 'undefined' ? window : this);
