// The town calendar: resolves the game's event schedule (sEventSchedule, in WW_DATA.schedule) for any day the way
// EventRule_Resolve / _ResolveMonth / _ResolveDay do, and fills in what the save itself decides: residents' and
// neighbors' birthdays and this week's visitors (EventWeekSlots). Also writes .ics files for real calendars.
// A rule is [id, category, startWord, startDay, startHour, endWord, endDay, endHour]. Date word bits: 13–15 kind
// (0 normal, 1 player birthday, 2 villager birthday, 3 fishing months, 4 bug months, 5 nth weekday of a month,
// 6 week slot), 11–12 month mode, 8–10 week of the month (0 fixed day, 6 last, 7 this week), 4–7 month, 1–3 weekday,
// 0 add the day offset.
(function () {
  'use strict';
  const D = window.WW_DATA, EV = window.WW_EVENTS;
  const byId = new Map(D.villagers.map(v => [v.id, v]));
  const dim = (y, m) => new Date(y, m, 0).getDate();
  const addDays = (y, m, d, n) => { const t = new Date(y, m - 1, d + n); return [t.getMonth() + 1, t.getDate()]; };
  const WEEK = 0x15E18, VB = 0x8A3C;

  // Festivals and other days worth a calendar entry; the notices and talk before them stay out of the calendar.
  const SHOWN = new Set([0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x3A, 0x3B]);
  const EMOJI = { 0x09: '🎣', 0x0A: '🐛', 0x0B: '🏷️', 0x0C: '🎉', 0x0D: '🎉', 0x0E: '🌷', 0x0F: '🎆', 0x10: '🌰', 0x11: '✨', 0x12: '🎊', 0x13: '🎍',
    0x3A: '🎸', 0x3B: '🥬', 0x3D: '🦊', 0x3E: '🐫', 0x3F: '🔮', 0x40: '🦒', 0x41: '🦭', 0x42: '🐢', 0x43: '🙃', 0x44: '🛸', 0x45: '✉️', 0x60: '🦒' };
  const emoji = id => EMOJI[id] || (id <= 7 || (id >= 0x4B && id <= 0x52) ? '🎂' : id === 8 ? '🎂' : '📅');

  function resolveMonth(w, off, y, m, d, id) {
    const a = (w >> 4) & 15, mode = (w >> 11) & 3;
    let r = 0;
    if (mode === 0) r = a;
    else if (mode === 1) {
      r = a === 0 ? m : addDays(y, m, d, Math.abs(id === 0x48 ? -4 : off))[0];
      if ((id === 0x29 || id === 0x2A || id === 0x0B || id === 0x48) && (r === 1 || r === 8)) r = 2;   // no flea market in January or August
    } else if (mode === 2) r = a === 1 ? (m & ~1) + 1 : (m + 1) & ~1;
    return r;
  }
  function resolveDay(w, off, y, m, d, wd, mon, id) {
    let b = (w >> 8) & 7;
    const c = (w >> 1) & 7, n = dim(y, mon), x = dim(y, m);
    if (b === 0) return off;
    if (b === 6) { const lw = new Date(y, mon - 1, n).getDay(); return lw < wd ? n - 7 + (wd - lw) : n - (lw - wd); }
    if (b === 7) { let v = d + (c < wd ? c - wd + 7 : c - wd); if (m !== mon && v > x) v -= x; return v; }
    const first = new Date(y, mon - 1, 1).getDay();
    const r2 = first <= c ? c - first + 1 : c - first + 8;
    if ([0x09, 0x14, 0x25, 0x26, 0x46].includes(id) && [2, 4, 10].includes(mon)) b = 4;   // the Fishing Tourney moves to the 4th week
    return r2 + (b - 1) * 7;
  }
  // One end of a rule for the day (y, m, d). Returns [month, day, hour] or null.
  function resolve(w, off, hour, y, m, d, id, ctx) {
    const type = (w >> 13) & 7, a = (w >> 4) & 15, b = (w >> 8) & 7, c = (w >> 1) & 7, wd = new Date(y, m - 1, d).getDay();
    let mm = 0, dd = 0, hh = hour, addOff = w & 1;
    if (type === 3 || type === 4) {
      const ok = type === 3 ? [1, 2, 3, 4, 5, 10, 11, 12] : [6, 7, 8, 9];
      mm = ok.includes(m) ? m : ok[0]; dd = resolveDay(w, off, y, m, d, wd, mm, id);
    } else if (type === 0) { mm = resolveMonth(w, off, y, m, d, id); dd = resolveDay(w, off, y, m, d, wd, mm, id); }
    else if (type === 5) { mm = a; const first = new Date(y, a - 1, 1).getDay(); dd = (first <= c ? c - first + 1 : c - first + 8) + (b - 1) * 7; }
    else if (type === 1 || type === 2) { const bd = ctx.birthday(id); if (!bd) return null; [mm, dd] = bd; }
    else return null;   // week slots and New Year's night are handled from the save directly
    if (!mm) return null;
    if (dd > dim(y, mm)) [mm, dd] = addDays(y, mm, dim(y, mm), dd - dim(y, mm));
    if (addOff) [mm, dd] = addDays(y, mm, dd, off);
    return [mm, dd, hh];
  }

  // Birthdays the save knows: residents (their own) and the eight neighbors (from the species table).
  function context(s) {
    return {
      birthday(id) {
        if (id === 8) return null;   // per resident, added below
        const n = id <= 7 ? id : id - 0x4B, sp = s.u8(VB + n * 0x700 + 0x6CB), v = byId.get(sp);
        return sp !== 0xFF && v && v.birthday ? v.birthday : null;
      },
    };
  }

  // Every calendar entry for a year: { y, m, d, id, name, emoji, start, end, kind, who }.
  function year(s, y) {
    const out = [], ctx = context(s);
    for (const r of D.schedule) {
      const [id, , w0, o0, h0, w1, o1, h1] = r;
      if (!SHOWN.has(id)) continue;
      const seen = new Set();
      for (let t = new Date(y, 0, 1); t.getFullYear() === y; t.setDate(t.getDate() + 1)) {
        const m = t.getMonth() + 1, d = t.getDate();
        const st = resolve(w0, o0, h0, y, m, d, id, ctx);
        if (!st || st[0] !== m || st[1] !== d) continue;
        const key = m * 100 + d; if (seen.has(key)) continue; seen.add(key);
        const en = resolve(w1, o1, h1, y, m, d, id, ctx) || st;
        out.push({ y, m, d, id, name: EV.name(id), emoji: emoji(id), start: st[2], end: en, kind: id >= 0x3A ? 'weekly' : 'festival' });
      }
    }
    for (let n = 0; n < 8; n++) {
      const bd = ctx.birthday(n); if (!bd) continue;
      const v = byId.get(s.u8(VB + n * 0x700 + 0x6CB));
      out.push({ y, m: bd[0], d: bd[1], id: n, name: `${v.name}’s birthday`, emoji: '🎂', start: 0, end: [bd[0], bd[1], 24], kind: 'birthday', who: v.name });
    }
    for (let p = 0; p < 4; p++) {
      if (!s.playerExists(p)) continue;
      const b = s.playerBase(p), m = s.u8(b + 0x2219), d = s.u8(b + 0x2218);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push({ y, m, d, id: 8, name: `${s.str(b + 0x2282, 8)}’s birthday`, emoji: '🎂', start: 0, end: [m, d, 24], kind: 'birthday', who: s.str(b + 0x2282, 8) });
    }
    // This week's visitors, from the five weekday slots (Monday–Friday) the game rolled.
    for (let k = 0; k < 5 && y === gameNow(s).getFullYear(); k++) {
      const o = WEEK + 0x14 + k * 6, id = s.u8(o + 2), m = s.u8(o + 1), d = s.u8(o);
      if (id === 99 || !m || !d) continue;
      const rule = D.schedule.find(r => r[0] === id), overnight = rule && rule[5] & 1;
      out.push({ y, m, d, id, name: EV.name(id), emoji: emoji(id), start: rule ? rule[4] : 6, end: overnight ? [...addDays(y, m, d, 1), 6] : [m, d, rule ? rule[7] : 24], kind: 'visitor', thisWeek: true });
    }
    const redd = s.u8(WEEK + 0x10);
    return out.sort((a, b) => a.m - b.m || a.d - b.d || a.start - b.start).map(e => Object.assign(e, { reddDay: redd }));
  }
  const on = (list, m, d) => list.filter(e => e.m === m && e.d === d);

  // ---------- .ics ----------
  const pad = n => String(n).padStart(2, '0');
  function ics(list, town) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Leaflet//Wild World calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${town} (Animal Crossing)`];
    const esc = t => t.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
    for (const e of list) {
      const day = `${e.y}${pad(e.m)}${pad(e.d)}`, uid = `${day}-${e.id}-${(e.who || '').replace(/\W/g, '')}@leaflet`;
      lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(`${e.emoji} ${e.name}`)}`);
      if (e.kind === 'birthday' || (e.start === 0 && e.end[2] === 24)) {
        const [nm, nd] = addDays(e.y, e.m, e.d, 1);
        lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${e.y + (nm < e.m ? 1 : 0)}${pad(nm)}${pad(nd)}`);
        if (e.kind === 'birthday') lines.push('RRULE:FREQ=YEARLY');
      } else {
        const [em, ed, eh] = e.end, ey = e.y + (em < e.m ? 1 : 0);
        const end = eh === 24 ? (() => { const [nm, nd] = addDays(ey, em, ed, 1); return `${ey + (nm < em ? 1 : 0)}${pad(nm)}${pad(nd)}T000000`; })() : `${ey}${pad(em)}${pad(ed)}T${pad(eh)}0000`;
        lines.push(`DTSTART:${day}T${pad(e.start)}0000`, `DTEND:${end}`);
      }
      lines.push(`DESCRIPTION:${esc(`In ${town}, from your Wild World save (Leaflet).`)}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  // The game's own date and time: the computer clock plus the save's clock offset (ClockOffset, 0x15FB4).
  function gameNow(s) { const mins = s.u32(0x15FB4) | 0, secs = s.u16(0x15FB8) << 16 >> 16; return new Date(Date.now() + (mins * 60 + secs) * 1000); }

  window.WW_CALENDAR = { year, on, ics, gameNow, emoji };
})();
