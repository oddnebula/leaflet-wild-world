// Today in your town and the town calendar. Both read the game's own clock (the computer's clock plus the save's
// ClockOffset), the weather the game rolled (WeatherRecord), this week's visitor slots (EventWeekSlots), the turnip
// market and the spawn tables, and resolve festivals and birthdays with js/calendar.js.
(function () {
  'use strict';
  const { h, fmt, row, card, section, sfx, toast, itemIcon } = UI;
  const D = window.WW_DATA, CAL = window.WW_CALENDAR;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const range = n => [...Array(n).keys()];
  const WX = 0x15F66, TURNIP = 0x15F4C, MUSEUM = 0x15D50, WEEK = 0x15E18, ROOST = 0xE557, SICK = 0xC26C, VB = 0x8A3C;
  const WX_ICON = ['☀️', '🌤️', '☁️', '🌧️', '⛈️'], WX_WORD = ['Clear', 'Some clouds', 'Cloudy', 'Rain', 'Heavy rain'];
  const byId = new Map(D.villagers.map(v => [v.id, v]));
  const hr12 = x => `${x % 12 || 12} ${x < 12 || x === 24 ? 'AM' : 'PM'}`;
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const players = s => [0, 1, 2, 3].filter(p => s.playerExists(p));
  const pname = (s, p) => s.str(s.playerBase(p) + 0x2282, 8);
  const when = e => e.kind === 'birthday' ? 'All day' : e.end[2] <= 6 && (e.end[0] !== e.m || e.end[1] !== e.d) ? `${hr12(e.start)} – ${hr12(e.end[2])} next day` : `${hr12(e.start)} – ${hr12(e.end[2])}`;
  const yearOf = (s, y) => CAL.year(s, y);

  // Weather for one 24-hour pattern, 6 AM to 6 AM (sWeatherHourTable).
  function strip(p, nowHour) {
    const hours = (D.weather[p] || '').split('').map(Number);
    return h('div', { class: 'wx-strip', role: 'img', 'aria-label': `Weather pattern ${p}` }, hours.map((lv, i) => {
      const x = (i + 6) % 24;
      return h('span', { class: 'wx-h lv' + lv + (x === nowHour ? ' now' : ''), title: `${x}:00 · ${WX_WORD[lv]}` }, h('i', null, WX_ICON[lv]), i % 3 === 0 ? h('small', null, `${x % 12 || 12}${x < 12 ? 'a' : 'p'}`) : null);
    }));
  }
  const wxAt = (p, x) => +((D.weather[p] || '')[(x + 18) % 24] || 0);

  // Critters out right now that the museum is still missing.
  function needed(s, now) {
    const hm = now.getMonth() * 2 + (now.getDate() > 15 ? 1 : 0), x = now.getHours(), out = [];
    for (const [kind, off] of [['bugs', 0x38], ['fish', 0x1B]]) D.critters[kind].forEach((c, i) => {
      const b = s.u8(MUSEUM + off + (i >> 1)), have = i & 1 ? b >> 4 : b & 15;
      const p = c.special ? 0 : Math.max(0, ...c.runs.filter(r => r[0] === hm && x >= r[1] && x < r[2]).map(r => r[3]));
      if (!have && p > 0) out.push({ c, p, kind });
    });
    return out.sort((a, b) => a.p - b.p);
  }

  // ---------- hourly music ----------
  // HourlyBgm plays sHourlyBgmIds[hour] = SDAT sequence 0x16 + hour (one theme per hour of the game clock). Leaflet loops
  // it and, when following the clock, moves on to the next theme as the hour turns.
  const bgm = { on: false, follow: true, hour: 12, token: 0, playing: -1, tick: null };
  const HOUR_NAMES = range(24).map(x => `${hr12(x)} theme`);
  function bgmHour() { return bgm.follow && APP.save ? CAL.gameNow(APP.save).getHours() : bgm.hour; }
  function bgmPlay() {
    const hr = bgmHour(), tok = ++bgm.token;
    bgm.playing = hr;
    const r = GameSound.playMusic(0x16 + hr, { onEnd: () => { if (bgm.on && tok === bgm.token) setTimeout(() => { if (bgm.on && tok === bgm.token) bgmPlay(); }, 400); } });
    if (!r) { bgm.on = false; toast('That theme couldn’t be played', '🎵'); }
    clearInterval(bgm.tick);
    bgm.tick = setInterval(() => { if (!bgm.on) { clearInterval(bgm.tick); return; } if (bgm.follow && bgmHour() !== bgm.playing) bgmPlay(); }, 20000);
  }
  function bgmStop() { bgm.on = false; bgm.token++; clearInterval(bgm.tick); GameSound.stopMusic(); }
  function musicCard(refresh) {
    if (!window.GameSound || !GameSound.ready()) return h('div', { class: 'card pad muted' }, '🎵 Open your Wild World ROM on the Welcome screen to play your town’s hourly music here.');
    return card(row(bgm.on ? `Now playing: the ${hr12(bgm.playing)} theme` : 'Town music', bgm.on ? (bgm.follow ? 'Follows the game clock and changes on the hour, like walking around town.' : 'Looping the hour you picked.') : 'The game’s hourly background music, from your ROM, looping.',
      h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        UI.selectInput([[-1, 'Follow the game clock'], ...HOUR_NAMES.map((n, i) => [i, n])], () => bgm.follow ? -1 : bgm.hour, v => { bgm.follow = v < 0; if (v >= 0) bgm.hour = v; if (bgm.on) bgmPlay(); refresh(); }, { width: 'w-m' }),
        h('button', { class: 'btn small ' + (bgm.on ? '' : 'leaf'), onclick: () => { if (bgm.on) bgmStop(); else { bgm.on = true; bgmPlay(); } refresh(); } }, bgm.on ? '■ Stop' : '▶ Play'))));
  }

  // =====================================================================================
  VIEWS.push({
    id: 'today', group: 'Town', icon: '🌞', title: () => 'Today in Town', sub: s => `${DAYS[CAL.gameNow(s).getDay()]}, ${MONTHS[CAL.gameNow(s).getMonth()]} ${CAL.gameNow(s).getDate()} in ${s.str(4, 8)}`,
    tips: ['“Now” is the game’s clock: your computer’s time plus the offset the save keeps (set in Town Records).', 'The weather is rolled when a day starts. If the save hasn’t reached today yet, the game rolls a fresh one when you play.'],
    hello: s => `Good ${CAL.gameNow(s).getHours() < 12 ? 'morning' : CAL.gameNow(s).getHours() < 18 ? 'afternoon' : 'evening'}! Here’s everything going on in ${s.str(4, 8)} right now.`,
    render(s, { go, refresh }) {
      const now = CAL.gameNow(s), y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate(), x = now.getHours();
      const list = yearOf(s, y).concat(m === 12 ? yearOf(s, y + 1) : []);
      const today = CAL.on(list, m, d).filter(e => e.y === y);
      // Weather: only meaningful when the save's weather day is today.
      const [wd, wm, wy] = s.bytes(WX, 3), wxDate = wm ? new Date(2000 + wy, wm - 1, wd) : null;
      const wxToday = wxDate && sameDay(wxDate, now), wxYesterday = wxDate && sameDay(new Date(wxDate.getTime() + 86400e3), now);
      const pat = wxToday ? s.u8(WX + 4) : wxYesterday ? s.u8(WX + 5) : null;
      // Turnips: the prices belong to the week that started on the stored Sunday.
      const [td, tm, ty] = s.bytes(TURNIP, 3), week = tm ? new Date(2000 + ty, tm - 1, td) : null;
      const inWeek = week && now >= week && now - week < 7 * 86400e3;
      const slot = now.getDay() * 2 + (x >= 12 ? 1 : 0), price = inWeek ? s.u8(TURNIP + 0x0A + (now.getDay() === 0 ? 0 : slot)) : 0;
      const outNow = needed(s, now);
      const soon = [];
      for (let k = 1; k <= 14; k++) { const t = new Date(y, m - 1, d + k); for (const e of CAL.on(t.getFullYear() === y ? list : yearOf(s, t.getFullYear()), t.getMonth() + 1, t.getDate())) if (e.kind !== 'weekly') soon.push({ e, t, k }); }
      const sick = (() => { const id = s.u8(SICK + 0xC + 0xB); return s.u16(SICK + 0xC) && id !== 0xFF ? byId.get(id)?.name : null; })();
      const roost = s.u8(ROOST);
      const chip = e => h('div', { class: 'today-ev' + (e.kind === 'birthday' ? ' bday' : '') }, h('span', { class: 'em' }, e.emoji), h('div', null, h('b', null, e.name), h('div', { class: 'muted' }, when(e))));
      const nightOwl = x < 6;
      return [
        h('div', { class: 'today-hero' },
          h('div', { class: 'today-clock' }, h('b', null, now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), h('span', null, `${DAYS[now.getDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`)),
          h('div', { class: 'today-wx' }, pat === null ? h('span', null, '🌈') : h('span', null, WX_ICON[wxAt(pat, x)]), h('span', null, pat === null ? 'Weather rolls when you play' : WX_WORD[wxAt(pat, x)])),
          h('div', { class: 'today-meta' }, (s.u32(0x15FB4) | 0) ? h('button', { class: 'btn small', onclick: () => go('records') }, '🕰️ Game clock is set off from real time') : h('span', { class: 'muted' }, 'Game clock follows real time'))),
        musicCard(refresh),
        section('📅 Happening today', today.length ? `${today.length} thing${today.length === 1 ? '' : 's'}` : 'A quiet day'),
        h('div', { class: 'card pad' }, today.length ? h('div', { class: 'today-evs' }, today.map(chip)) : h('div', { class: 'muted' }, 'No festivals, birthdays or visitors today. A perfect day for fishing.'),
          nightOwl ? h('div', { class: 'muted', style: { marginTop: '8px', fontSize: '12px' } }, 'Before 6 AM the game still counts it as the night of the day before for shops and visitors.') : null),
        section('⛅ Weather', pat === null ? 'Not rolled for today yet' : `Pattern ${pat}${wxToday ? '' : ' (rolled yesterday as tomorrow’s)'}`),
        h('div', { class: 'card pad' }, pat === null ? h('div', { class: 'muted' }, `The save last rolled weather for ${wxDate ? wxDate.toLocaleDateString() : 'no date'}. The game rolls a new day when you next play. Set tomorrow’s pattern in Town Records to choose it.`) : strip(pat, x),
          h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => go('records') }, 'Change the weather'))),
        section('🥬 Turnips', inWeek ? (now.getDay() === 0 ? 'Joan’s buying price today' : `Nook’s price this ${x >= 12 ? 'afternoon' : 'morning'}`) : 'This week’s prices aren’t rolled yet'),
        card(row(now.getDay() === 0 ? 'Joan sells at' : 'Nook buys at', inWeek ? (now.getDay() === 0 ? 'Joan is in town Sunday mornings, 6 AM to noon.' : `Prices change at noon. Joan’s price this week: ${s.u8(TURNIP + 0x0A)} bells.`) : 'The game rolls new prices when the week starts.',
          h('span', { class: 'big-num' }, inWeek && price ? `${fmt(price)} 🔔` : '—'))),
        section('🦋 Out right now', `${outNow.length} the museum still needs`),
        h('div', { class: 'card pad' }, outNow.length ? h('div', { class: 'today-crit' }, outNow.slice(0, 12).map(o => h('span', { class: 'chip', title: `${o.p}% of spawns` }, itemIcon(o.c.item), o.c.name))) : h('div', { class: 'muted' }, 'Nothing new for Blathers at this hour.'),
          h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => go('catchable') }, 'See everything that’s out'))),
        section('🏘️ Around town'),
        card(
          row('Crazy Redd', `His tent goes up on ${DAYS[s.u8(WEEK + 0x10)] || '—'} this week.`, null),
          row('The Roost', [roost & 1 ? 'Pelly drops in before work.' : null, now.getDay() === 6 ? 'K.K. Slider plays tonight from 8 PM.' : 'K.K. Slider plays Saturday nights.'].filter(Boolean).join(' '), null),
          row('Sick neighbor', sick ? `${sick} is feeling unwell. Bring medicine from Nook’s.` : 'Everyone is healthy.', null),
          ...players(s).map(p => { const b = s.playerBase(p), bm = s.u8(b + 0x2219), bd = s.u8(b + 0x2218); return row(`${pname(s, p)}’s birthday`, bm ? `${MONTHS[bm - 1]} ${bd}${bm === m && bd === d ? '. Happy birthday! 🎂' : ''}` : 'Not set', null); })),
        section('🗓️ Next two weeks', soon.length ? `${soon.length} coming up` : 'Nothing scheduled'),
        h('div', { class: 'card pad' }, soon.length ? h('div', { class: 'today-soon' }, soon.map(({ e, t, k }) => h('div', { class: 'soon-row' }, h('span', { class: 'em' }, e.emoji), h('b', null, e.name), h('span', { class: 'muted' }, `${DAYS[t.getDay()].slice(0, 3)} ${MONTHS[t.getMonth()].slice(0, 3)} ${t.getDate()} · ${k === 1 ? 'tomorrow' : `in ${k} days`}`)))) : h('div', { class: 'muted' }, 'No festivals or birthdays in the next 14 days.'),
          h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn small leaf', onclick: () => go('calendar') }, 'Open the calendar'))),
      ];
    },
  });

  // =====================================================================================
  // Tomorrow and the week ahead: everything the game has already decided. The weather for tomorrow is rolled with today's
  // (WeatherRecord's second pattern), the whole week's turnip prices are rolled on Sunday, this week's visitors are set
  // in EventWeekSlots and festivals and birthdays come from the calendar.
  VIEWS.push({
    id: 'tomorrow', group: 'Town', icon: '🔮', title: () => 'Tomorrow & Next Week', sub: s => `What ${s.str(4, 8)} has already decided`,
    tips: ['The game rolls tomorrow’s weather together with today’s, and the whole week’s turnip prices on Sunday morning, so these are set already.', 'If the save hasn’t reached today yet, the game rolls fresh ones the next time you play.'],
    render(s, { go }) {
      const now = CAL.gameNow(s), x = now.getHours(), tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const [wd, wm, wy] = s.bytes(WX, 3), wxDate = wm ? new Date(2000 + wy, wm - 1, wd) : null;
      const tomorrowPat = wxDate && sameDay(wxDate, now) ? s.u8(WX + 5) : wxDate && sameDay(wxDate, tmr) ? s.u8(WX + 4) : null;
      // Turnips: the week that started on the stored Sunday.
      const [td, tm, ty] = s.bytes(TURNIP, 3), week = tm ? new Date(2000 + ty, tm - 1, td) : null, inWeek = week && now >= week && now - week < 7 * 86400e3;
      const slotNow = now.getDay() * 2 + (x >= 12 ? 1 : 0), prices = range(14).map(i => s.u8(TURNIP + 0x0A + i));
      const ahead = inWeek ? range(14).filter(i => i >= 2 && i > slotNow).map(i => ({ i, p: prices[i] })) : [];
      const best = ahead.reduce((b, c) => (!b || c.p > b.p ? c : b), null);
      const slotName = i => `${DAYS[i >> 1].slice(0, 3)} ${i & 1 ? 'PM' : 'AM'}`;
      // The next seven days from the calendar (festivals, birthdays, this week's visitors).
      const y = now.getFullYear(), days = [];
      for (let k = 1; k <= 7; k++) { const t = new Date(y, now.getMonth(), now.getDate() + k), evs = CAL.on(CAL.year(s, t.getFullYear()), t.getMonth() + 1, t.getDate()).filter(e => e.y === t.getFullYear() && e.kind !== 'weekly'); days.push({ t, evs, kk: t.getDay() === 6, joan: t.getDay() === 0 }); }
      const redd = s.u8(WEEK + 0x10);
      return [
        section('⛅ Tomorrow’s weather', tomorrowPat === null ? 'Not rolled yet' : `${DAYS[tmr.getDay()]}, ${MONTHS[tmr.getMonth()]} ${tmr.getDate()} · pattern ${tomorrowPat}`),
        h('div', { class: 'card pad' }, tomorrowPat === null ? h('div', { class: 'muted' }, 'The game rolls tomorrow’s weather when today begins in the game. Play today, then look again.') : strip(tomorrowPat, -1),
          h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => go('records') }, 'Change it in Town Records'))),
        section('🥬 Turnips for the rest of the week', inWeek ? (best ? `Best ahead: ${fmt(best.p)} bells on ${slotName(best.i)}` : 'The week’s selling is over') : 'This week’s prices aren’t rolled yet'),
        h('div', { class: 'card pad' }, inWeek ? h('div', { class: 'tmr-turnips' }, range(12).map(k => { const i = k + 2, p = prices[i], past = i <= slotNow; return h('div', { class: 'tt' + (past ? ' past' : '') + (best && best.i === i ? ' best' : '') },
          h('span', { class: 'muted' }, slotName(i)), h('b', null, p ? fmt(p) : '—')); })) : h('div', { class: 'muted' }, 'Joan rolls the week’s prices on Sunday morning.'),
          inWeek ? h('div', { class: 'muted', style: { marginTop: '8px', fontSize: '12px' } }, `Joan’s price this week: ${fmt(prices[0])} bells. Prices are fixed for the week; the game doesn’t change them later.`) : null),
        section('🗓️ The next seven days'),
        h('div', { class: 'card pad tmr-days' }, days.map(({ t, evs, kk, joan }) => h('div', { class: 'tmr-day' + (evs.length ? ' has' : '') },
          h('div', { class: 'd' }, h('b', null, DAYS[t.getDay()].slice(0, 3)), h('span', null, `${MONTHS[t.getMonth()].slice(0, 3)} ${t.getDate()}`)),
          h('div', { class: 'e' }, evs.map(e => h('span', { class: 'chip' }, e.emoji, ' ', e.name)), t.getDay() === redd ? h('span', { class: 'chip' }, '🦊 Crazy Redd') : null,
            joan ? h('span', { class: 'chip' }, '🐗 Joan, 6 AM–noon') : null, kk ? h('span', { class: 'chip' }, '🎸 K.K. at the Roost, 8 PM') : null,
            !evs.length && !joan && !kk && t.getDay() !== redd ? h('span', { class: 'muted' }, 'A quiet day') : null)))),
      ];
    },
  });

  // =====================================================================================
  let calY = null, calM = null, show = { festival: true, birthday: true, visitor: true, weekly: false };
  const KIND = { festival: ['🎉', 'Festivals'], birthday: ['🎂', 'Birthdays'], visitor: ['🐫', 'This week’s visitors'], weekly: ['🎸', 'Joan and K.K. every week'] };
  function download(name, text) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/calendar' })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  VIEWS.push({
    id: 'calendar', group: 'Town', icon: '📅', title: () => 'Calendar', sub: s => `Festivals, birthdays and visitors in ${s.str(4, 8)}`,
    tips: ['Dates come from the game’s own event schedule, so they match what your town hall bulletin board will say.', 'Export to .ics to put your town’s events in Apple Calendar, Google Calendar or Outlook.'],
    render(s, { refresh }) {
      const now = CAL.gameNow(s);
      if (calY === null) { calY = now.getFullYear(); calM = now.getMonth() + 1; }
      const list = yearOf(s, calY).filter(e => show[e.kind]);
      const first = new Date(calY, calM - 1, 1).getDay(), days = new Date(calY, calM, 0).getDate();
      const move = n => { calM += n; if (calM < 1) { calM = 12; calY--; } if (calM > 12) { calM = 1; calY++; } sfx.click(); refresh(); };
      const grid = h('div', { class: 'cal-grid' }, DAYS.map(dn => h('div', { class: 'cal-dow' }, dn.slice(0, 3))),
        range(first).map(() => h('div', { class: 'cal-day empty' })),
        range(days).map(k => {
          const evs = CAL.on(list, calM, k + 1), isToday = calY === now.getFullYear() && calM === now.getMonth() + 1 && k + 1 === now.getDate();
          return h('div', { class: 'cal-day' + (isToday ? ' today' : '') + (evs.length ? ' busy' : '') }, h('span', { class: 'cal-n' }, k + 1),
            evs.map(e => h('span', { class: 'cal-ev ' + e.kind, title: `${e.name} · ${when(e)}` }, e.emoji, h('span', { class: 'cal-ev-t' }, e.name))));
        }));
      const monthList = list.filter(e => e.m === calM);
      return [
        h('div', { class: 'card pad cal-bar' },
          h('button', { class: 'btn small', onclick: () => move(-1) }, '◀'),
          h('b', { class: 'cal-title' }, `${MONTHS[calM - 1]} ${calY}`),
          h('button', { class: 'btn small', onclick: () => move(1) }, '▶'),
          h('button', { class: 'btn small', onclick: () => { calY = now.getFullYear(); calM = now.getMonth() + 1; refresh(); } }, 'Today'),
          h('span', { class: 'spacer' }),
          Object.entries(KIND).map(([k, [em, label]]) => h('label', { class: 'cal-filter' }, UI.switchInput(() => show[k], v => { show[k] = v; refresh(); }), `${em} ${label}`))),
        h('div', { class: 'card pad' }, grid),
        section(`${MONTHS[calM - 1]} in detail`, `${monthList.length} entr${monthList.length === 1 ? 'y' : 'ies'}`),
        h('div', { class: 'card pad' }, monthList.length ? h('div', { class: 'today-soon' }, monthList.map(e => h('div', { class: 'soon-row' }, h('span', { class: 'em' }, e.emoji), h('b', null, e.name), h('span', { class: 'muted' }, `${DAYS[new Date(e.y, e.m - 1, e.d).getDay()].slice(0, 3)} ${e.d} · ${when(e)}`)))) : h('div', { class: 'muted' }, 'Nothing this month with these filters.')),
        section('📤 Export', 'Add your town’s days to a real calendar'),
        card(
          row(`${calY} in ${s.str(4, 8)}`, 'Festivals and birthdays with the filters above (birthdays repeat every year).', h('button', { class: 'btn small leaf', onclick: () => { download(`${s.str(4, 8)} ${calY}.ics`, CAL.ics(list, s.str(4, 8))); sfx.bell(); toast('Calendar file ready', '📅'); } }, '⬇︎ .ics')),
          row('Birthdays only', 'Every resident and neighbor, repeating yearly.', h('button', { class: 'btn small', onclick: () => { download(`${s.str(4, 8)} birthdays.ics`, CAL.ics(yearOf(s, calY).filter(e => e.kind === 'birthday'), s.str(4, 8))); sfx.bell(); } }, '⬇︎ .ics'))),
        h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '6px' } }, 'Lyle’s and some visitors’ days depend on rolls the game makes each week, so only this week’s visitors are shown.'),
      ];
    },
  });
})();
