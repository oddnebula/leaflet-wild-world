// Town records: turnip market, weather, the game clock, town life (perfect streak, Gulliver, the Roost, Katie), Crazy Redd, Tortimer's contest.
// Layouts come from the decompilation's SaveData (TurnipMarket, WeatherRecord, TownState, GulliverQuest, RoostGuestRoll,
// ReddShop, ReddLastSale, ContestRecord, LostChildRecord, ClockOffset).
(function () {
  'use strict';
  const { h, hex, fmt, row, card, section, numberInput, selectInput, textInput, switchInput, slot, sfx, toast } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const range = n => [...Array(n).keys()];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const byId = new Map(D.villagers.map(v => [v.id, v]));

  // Turnips: 0x15F4C. +0 week start (d,m,y), +4 purchase date, +8 u16 peak price, +0x0A 14 prices (day*2 + PM; Sunday = Joan), +0x18 pattern.
  const TURNIP = 0x15F4C, PRICES = TURNIP + 0x0A, SPIKE = TURNIP + 0x08, PATTERN = TURNIP + 0x18;
  const PATTERNS = [[0, 'Fluctuating (up and down)'], [1, 'Big spike'], [2, 'Decreasing all week'], [3, 'Small spike'], [255, 'Not rolled yet']];
  // Weather: 0x15F66 {day, month, year, -, today pattern, tomorrow pattern, hour base, rained}.
  const WX = 0x15F66;
  const WX_ICON = ['☀️', '🌤️', '☁️', '🌧️', '⛈️'], WX_WORD = ['Clear', 'Some clouds', 'Cloudy', 'Rain or snow', 'Heavy rain or snow'];
  // Town state: 0x15E54 (+0x21 perfect-town streak).
  const STREAK = 0x15E54 + 0x21;
  const GULLIVER = 0xE556, ROOST = 0xE557, DONATIONS = 0x12008, KATIE = 0x15FCA;
  const ROOST_DAY = [[0, 'Nobody'], [1, 'Visitor A'], [2, 'Visitor B'], [3, 'Mr. Resetti'], [4, 'Lyle']];
  const REDD = 0x15F70, REDD_SALE = 0x15F34;
  const CONTEST = 0x15EFC;
  // ClockOffset (0x15FB4): s32 minutes and s16 seconds added to the DS clock (Clock_ReadAdjusted). Setting the time
  // in the game's own clock menu rewrites it.
  const CLOCK = 0x15FB4;
  // SickVillagerRecord (0xC26C): the errand, which villager, up to five resident visitors, dates and days sick.
  const SICK = 0xC26C;
  // EventWeekSlots (0x15E18, 0x3C bytes), TownState's four TownEventRecords (0x15E78), the per-resident last-play dates
  // (0x15EAC), Happy Room Academy (0x15FB0) and the three snowmen (0x15F96, 6 bytes each).
  const WEEK = 0x15E18, TEVENTS = 0x15E78, LASTPLAY = 0x15EAC, HRA = 0x15FB0, SNOW = 0x15F96;
  const EV = window.WW_EVENTS;
  const weeklyOpts = EV.weekly.map(id => [id, `${EV.name(id)} (${id})`]);
  const eventOpts = Object.keys(EV.all).map(Number).sort((a, b) => a - b).map(id => [id, `${EV.name(id)} (${id})`]);
  const WEEKDAYS = [[0, 'Sunday'], [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday']];
  const CONTESTS = [[0, 'None'], [1, 'Fishing Tourney (biggest fish)'], [2, 'Bug-Off (most points)'], [3, 'Flower Fest']];

  function dateEditor(s, o, refresh) {
    const f = (i, max) => numberInput(() => s.u8(o + i), v => { s.set8(o + i, v); if (refresh) refresh(); }, { max, width: 'w-s' });
    return h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, f(1, 12), '/', f(0, 31), '/', f(2, 99));
  }
  function dateText(s, o) {
    const [d, m, y] = s.bytes(o, 3);
    return m ? `${MONTHS[m - 1] || '?'} ${d}, 20${String(y).padStart(2, '0')}` : 'Not set';
  }
  function clockText(s) {
    const total = (s.u32(CLOCK) | 0) * 60 + (s.u16(CLOCK + 4) << 16 >> 16);
    if (!total) return 'Matches the DS clock';
    const t = Math.abs(total), d = Math.floor(t / 86400), hh = Math.floor((t % 86400) / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    const parts = [d && `${fmt(d)} day${d === 1 ? '' : 's'}`, hh && `${hh} h`, mm && `${mm} min`, ss && `${ss} s`].filter(Boolean).join(' ');
    return `${total < 0 ? 'Behind' : 'Ahead of'} the DS clock by ${parts}`;
  }
  function clockEditor(s, refresh) {
    const get = () => s.u32(CLOCK) | 0, sign = () => (get() < 0 ? -1 : 1);
    const part = (div, mod) => () => Math.floor(Math.abs(get()) / div) % mod;
    const put = (div, mod) => v => { const t = Math.abs(get()), cur = Math.floor(t / div) % mod; s.set32(CLOCK, sign() * (t + (v - cur) * div)); refresh(); };
    const dir = selectInput([[1, 'ahead'], [-1, 'behind']], sign, v => { s.set32(CLOCK, v * Math.abs(get())); refresh(); });
    return h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } },
      numberInput(part(1440, 1e7), put(1440, 1e7), { max: 999999, width: 'w-s', suffix: 'd' }), numberInput(part(60, 24), put(60, 24), { max: 23, width: 'w-s', suffix: 'h' }),
      numberInput(part(1, 60), put(1, 60), { max: 59, width: 'w-s', suffix: 'm' }), dir);
  }
  // An event date word (EventDate): byte 1 hour, byte 2 day, byte 3 month; the value 1 means no date.
  function eventDate(s, o, refresh) {
    const f = (i, max, suffix) => numberInput(() => s.u8(o + i), v => { if (s.u32(o) === 1) s.set8(o, 0); s.set8(o + i, v); refresh(); }, { max, width: 'w-s', suffix });
    return h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, f(3, 12), '/', f(2, 31), f(1, 24, 'h'),
      s.u32(o) === 1 ? h('span', { class: 'muted' }, 'none') : h('button', { class: 'btn small', title: 'No date', onclick: () => { s.set32(o, 1); refresh(); } }, '✕'));
  }
  function bitsField(s, o, shift, width, refresh) {
    const mask = ((1 << width) - 1) << shift;
    return [() => (s.u8(o) & mask) >> shift, v => { s.set8(o, (s.u8(o) & ~mask) | ((v << shift) & mask)); if (refresh) refresh(); }];
  }

  function chart(s) {
    const vals = range(14).map(i => s.u8(PRICES + i) || (s.u8(PATTERN) === 1 && i > 1 ? s.u16(SPIKE) : 0));
    const max = Math.max(150, ...vals), base = s.u8(PRICES);
    const W = 560, H = 170, pad = 26, step = (W - pad * 2) / 13;
    const pts = vals.map((v, i) => [pad + i * step, H - pad - v / max * (H - pad * 2)]);
    const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Turnip prices this week">
      <line x1="${pad}" x2="${W - pad}" y1="${H - pad - base / max * (H - pad * 2)}" y2="${H - pad - base / max * (H - pad * 2)}" stroke="#c9a463" stroke-dasharray="5 5" stroke-width="2"/>
      <polyline fill="none" stroke="#3a9a3e" stroke-width="4" stroke-linejoin="round" points="${pts.slice(2).map(p => p.join(',')).join(' ')}"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i < 2 ? 6 : 5}" fill="${i < 2 ? '#e0ae12' : vals[i] > base ? '#5cc35a' : '#e2574c'}" stroke="#fff" stroke-width="2"/>
        <text x="${p[0]}" y="${p[1] - 10}" text-anchor="middle" font-size="11" font-weight="800" fill="#5a3b1c">${vals[i] || ''}</text>`).join('')}
      ${DAYS.map((d, k) => `<text x="${pad + (k * 2 + 0.5) * step}" y="${H - 6}" text-anchor="middle" font-size="11" font-weight="800" fill="#8a6a44">${d.slice(0, 3)}</text>`).join('')}
    </svg>`;
    return h('div', { html: svg });
  }

  // The turnip advisor: the game rolls the whole week's prices in advance, so from the town's own date and time it can
  // say exactly whether to sell now or wait. Prices change at noon; Sunday is Joan's.
  const price = (s, i) => s.u8(PRICES + i) || (s.u8(PATTERN) === 1 && i > 1 ? s.u16(SPIKE) : 0);
  function advice(s) {
    const CAL = window.WW_CALENDAR; if (!CAL || s.u8(PATTERN) === 255) return null;
    const [d, m, y] = s.bytes(TURNIP, 3); if (!m) return null;
    const now = CAL.gameNow(s), start = new Date(2000 + y, m - 1, d), days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 86400000);
    if (days < 0 || days > 6) return ['🗓️', 'These prices are for another week. The game rolls new ones when Joan comes on Sunday.'];
    const joan = s.u8(PRICES), slot = now.getDay() * 2 + (now.getHours() >= 12 ? 1 : 0);
    const when = i => `${DAYS[i >> 1]} ${i & 1 ? 'afternoon' : 'morning'}`;
    let bi = -1; for (let i = Math.max(2, slot + 1); i < 14; i++) if (bi < 0 || price(s, i) > price(s, bi)) bi = i;
    if (slot < 2) return bi < 0 ? null : ['🥬', `Joan sells at ${joan} today. This week's best price comes ${when(bi)}: ${fmt(price(s, bi))} bells, ${price(s, bi) > joan ? `${fmt(price(s, bi) - joan)} more than you pay` : 'less than you pay, so buying this week loses bells'}.`];
    const nowP = price(s, slot);
    if (bi < 0 || nowP >= price(s, bi)) return ['💰', `Sell now: ${fmt(nowP)} bells is the best price left this week${joan ? ` (Joan sold at ${joan})` : ''}. Turnips spoil when next Sunday comes.`];
    return ['⏳', `Wait: Nook's buys at ${fmt(nowP)} now, but ${fmt(price(s, bi))} on ${when(bi)}, ${fmt(price(s, bi) - nowP)} more per turnip. They spoil when next Sunday comes.`];
  }

  // One weather pattern as a 24-hour strip, 6 AM to 6 AM.
  function wxStrip(p) {
    const hours = (D.weather[p] || '').split('').map(Number);
    return h('div', { class: 'wx-strip', role: 'img', 'aria-label': `Weather pattern ${p}` }, hours.map((lv, i) => {
      const hr = (i + 6) % 24;
      return h('span', { class: 'wx-h lv' + lv, title: `${hr}:00 · ${WX_WORD[lv]}` }, h('i', null, WX_ICON[lv]), i % 3 === 0 ? h('small', null, `${hr % 12 || 12}${hr < 12 ? 'a' : 'p'}`) : null);
    }));
  }
  function wxSummary(p) {
    const hours = (D.weather[p] || '').split('').map(Number);
    const wet = hours.filter(v => v >= 3).length;
    return wet ? `${wet} wet hour${wet === 1 ? '' : 's'}` : hours.some(v => v === 2) ? 'Dry, some cloudy hours' : 'Dry and bright';
  }
  const WX_OPTS = range(32).map(p => [p, `Pattern ${p} · ${wxSummary(p)}`]);

  VIEWS.push({
    id: 'records', group: 'Places', icon: '🥬', title: () => 'Town Records', sub: () => 'Turnips, weather, visitors and contests',
    tips: ['Turnip prices change at noon. Sunday’s price is Joan’s buying price.', 'The weather for a day is fixed when the day starts, so set tomorrow’s pattern to choose it.', 'The perfect-town streak counts days in a row; Pelly or Phyllis hands over the golden watering can at 15.'],
    hello: () => 'Psst! Joan’s turnip prices, tomorrow’s weather and who’s visiting the Roost are all written in the save. Here they are!',
    render(s, { refresh }) {
      const best = (() => { let b = -1, bi = -1; for (let i = 2; i < 14; i++) { const v = s.u8(PRICES + i) || (s.u8(PATTERN) === 1 ? s.u16(SPIKE) : 0); if (v > b) { b = v; bi = i; } } return { v: b, i: bi }; })();
      const priceGrid = h('div', { class: 'turnip-grid' }, DAYS.map((d, k) => h('div', { class: 'turnip-day' + (k === 0 ? ' joan' : '') },
        h('b', null, k === 0 ? 'Sunday · Joan' : d),
        h('span', null, 'AM ', numberInput(() => s.u8(PRICES + k * 2), v => { s.set8(PRICES + k * 2, v); if (k === 0) s.set8(PRICES + 1, v); refresh(); }, { max: 255, width: 'w-s' })),
        k === 0 ? null : h('span', null, 'PM ', numberInput(() => s.u8(PRICES + k * 2 + 1), v => { s.set8(PRICES + k * 2 + 1, v); refresh(); }, { max: 255, width: 'w-s' })))));
      const c = CONTEST;
      const [gCount, setGCount] = bitsField(s, GULLIVER, 0, 3, refresh), [gStarted, setGStarted] = bitsField(s, GULLIVER, 3, 1, refresh);
      const [rMorning, setRMorning] = bitsField(s, ROOST, 0, 1, refresh), [rNoon, setRNoon] = bitsField(s, ROOST, 1, 3, refresh);
      const [rAfter, setRAfter] = bitsField(s, ROOST, 4, 3, refresh), [rLate, setRLate] = bitsField(s, ROOST, 7, 1, refresh);
      const [kDays, setKDays] = bitsField(s, KATIE + 0xA, 0, 4, refresh), [kEscort, setKEscort] = bitsField(s, KATIE + 0xA, 5, 1, refresh), [kMom, setKMom] = bitsField(s, KATIE + 0xA, 4, 1, refresh);
      const streak = s.u8(STREAK) << 24 >> 24;
      const villagerName = o => { const id = s.u8(o + 0xB); return id === 0xFF || !s.u16(o) ? null : byId.get(id)?.name || hex(id, 2); };
      return [
        // ---------------- turnips
        section('🥬 Turnip market', best.v > 0 ? `Best sell: ${fmt(best.v)} bells on ${DAYS[best.i >> 1]} ${best.i & 1 ? 'afternoon' : 'morning'}` : 'No prices yet'),
        (() => { const a = advice(s); return a ? h('div', { class: 'callout' }, h('span', { class: 'em' }, a[0]), h('div', null, h('b', null, 'Turnip advisor: '), a[1], a[0] === '🗓️' ? null : h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '2px' } }, 'From the prices the game has already rolled for this week, at your town’s own time.'))) : null; })(),
        h('div', { class: 'card pad' }, chart(s), h('div', { class: 'muted', style: { fontSize: '12px', textAlign: 'center' } }, 'Yellow: Joan’s Sunday price · green above it, red below')),
        h('div', { class: 'card pad' }, priceGrid),
        card(
          row('Price pattern this week', 'How Nook’s prices move. The game picks the next pattern from this one every Sunday.', selectInput(PATTERNS, () => s.u8(PATTERN), v => { s.set8(PATTERN, v); refresh(); }), PATTERN),
          row('Big-spike price', 'Used for the slot that reads 0 in a big-spike week. Can be higher than 255.', numberInput(() => s.u16(SPIKE), v => { s.set16(SPIKE, v); refresh(); }, { max: 9999, width: 'w-s' }), SPIKE, { risk: 'med', why: 'Over about 660 bells is more than the game would ever roll.' }),
          row('Week started', dateText(s, TURNIP), dateEditor(s, TURNIP, refresh), TURNIP, { risk: 'med', why: 'If this date is more than a week old the game re-rolls every price.' }),
          row('Turnips bought on', `${dateText(s, TURNIP + 4)}. Turnips spoil once a new week starts.`, dateEditor(s, TURNIP + 4, refresh), TURNIP + 4),
          row('🤑 Dream week', 'Every afternoon at 600 bells (a realistic big-spike price).', h('button', { class: 'btn small bell', onclick: () => { for (let k = 1; k < 7; k++) { s.set8(PRICES + k * 2, 200); s.set8(PRICES + k * 2 + 1, 0); } s.set16(SPIKE, 600); s.set8(PATTERN, 1); sfx.bell(); toast('Every afternoon now pays 600 bells', '🥬'); refresh(); } }, 'Apply')),
        ),

        // ---------------- weather
        section('⛅ Weather', `Rolled for ${dateText(s, WX)}`),
        h('div', { class: 'card pad wx' },
          h('div', { class: 'wx-day' }, h('b', null, 'Today'), wxStrip(s.u8(WX + 4))),
          h('div', { class: 'wx-day' }, h('b', null, 'Tomorrow'), wxStrip(s.u8(WX + 5))),
          h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } }, 'Rain falls as snow in winter. The in-game day starts at 6 AM.')),
        card(
          row('Today’s pattern', 'Changes the weather for the rest of the stored day.', selectInput(WX_OPTS, () => s.u8(WX + 4), v => { s.set8(WX + 4, v); refresh(); }), WX + 4),
          row('Tomorrow’s pattern', 'Becomes today’s weather when the next day starts. This is the reliable way to pick the weather.', selectInput(WX_OPTS, () => s.u8(WX + 5), v => { s.set8(WX + 5, v); refresh(); }), WX + 5),
          row('Quick picks', 'For tomorrow.', h('span', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
            h('button', { class: 'btn small', onclick: () => { s.set8(WX + 5, 0); sfx.pop(); toast('Clear skies tomorrow', '☀️'); refresh(); } }, '☀️ Sunny'),
            h('button', { class: 'btn small', onclick: () => { s.set8(WX + 5, 14); sfx.pop(); toast('A rainy (or snowy) day tomorrow', '🌧️'); refresh(); } }, '🌧️ Rain all day'),
            h('button', { class: 'btn small', onclick: () => { s.set8(WX + 5, 24); sfx.pop(); toast('A sunny day with one passing shower', '🌦️'); refresh(); } }, '🌦️ One shower'))),
          row('Weather date', dateText(s, WX), dateEditor(s, WX, refresh), WX, { risk: 'med', why: 'If this isn’t yesterday or today, the game re-rolls both days.' }),
          row('It has rained today', 'Set by the game when it rains (used for things like snails and flowers).', switchInput(() => s.u8(WX + 7), v => s.set8(WX + 7, v ? 1 : 0)), WX + 7),
        ),

        // ---------------- clock
        section('🕰️ Game clock', clockText(s)),
        card(
          row('Offset from the DS clock', 'The game’s time is your system clock plus this offset. Changing it is time travel, the same as setting the clock in the game.', clockEditor(s, refresh), CLOCK,
            { risk: 'med', why: 'Jumping ahead lets weeds grow, flowers wilt and villagers move, just like time travel in the game.' }),
          row('Quick changes', 'Shift the game clock from where it is now.', h('span', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
            [[-1440, '−1 day'], [-60, '−1 hour'], [60, '+1 hour'], [1440, '+1 day'], [10080, '+1 week']].map(([d, label]) => h('button', { class: 'btn small', onclick: () => { s.set32(CLOCK, (s.u32(CLOCK) | 0) + d); sfx.click(); refresh(); } }, label)),
            h('button', { class: 'btn small leaf', onclick: () => { s.set32(CLOCK, 0); s.set16(CLOCK + 4, 0); sfx.pop(); toast('The game now follows the DS clock', '🕰️'); refresh(); } }, 'Use DS time'))),
        ),

        // ---------------- town life
        section('🏘️ Town life'),
        card(
          row('Perfect-town streak', `${streak} day${streak === 1 ? '' : 's'} in a row. Keep the town perfect for 15 days and Pelly or Phyllis gives you the golden watering can.`,
            h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, numberInput(() => s.u8(STREAK) << 24 >> 24, v => { s.set8(STREAK, v & 0xFF); refresh(); }, { min: -128, max: 127, width: 'w-s' }), h('button', { class: 'btn small bell', onclick: () => { s.set8(STREAK, 14); sfx.bell(); toast('One more perfect day for the golden can', '🚿'); refresh(); } }, 'Set to 14')), STREAK),
          row('🛸 Gulliver’s UFO parts', `Shoot Gulliver’s UFO with the slingshot and find his parts. ${gStarted() ? `${gCount()} of 5 found.` : 'Not started.'}`,
            h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, switchInput(gStarted, v => setGStarted(v ? 1 : 0)), numberInput(gCount, setGCount, { max: 5, width: 'w-s', suffix: '/ 5' })), GULLIVER),
          row('🤒 Sick neighbor', (() => { const id = s.u8(SICK + 0xC + 0xB), n = s.u16(SICK + 0xC) && id !== 0xFF ? byId.get(id)?.name : null; const vis = [0, 1, 2, 3, 4].map(k => s.str(SICK + 0x18 + k * 0x16 + 0xC, 8)).filter(Boolean);
            return n ? `${n} has been sick for ${s.u8(SICK + 0x8E)} day${s.u8(SICK + 0x8E) === 1 ? '' : 's'}${vis.length ? `. Visited by ${vis.join(', ')}` : ''}. Bring medicine from Nook’s.` : 'Everyone is healthy.'; })(),
            h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, numberInput(() => s.u8(SICK + 0x8E), v => { s.set8(SICK + 0x8E, v); refresh(); }, { max: 255, width: 'w-s', suffix: 'days' })), SICK),
          row('Town hall donations', 'Bells you’ve donated at the town hall, in total (the game caps it at 999,999,999).', numberInput(() => s.u32(DONATIONS), v => s.set32(DONATIONS, v), { max: 999999999, suffix: 'bells' }), DONATIONS),
          row('Katie is visiting', kDays() ? `${kDays()} day${kDays() === 1 ? '' : 's'} left before she gives up.` : 'Katie isn’t looking for her mom right now.',
            h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, numberInput(kDays, setKDays, { max: 15, width: 'w-s', suffix: 'days' }), h('span', { class: 'muted' }, 'escorting'), switchInput(kEscort, v => setKEscort(v ? 1 : 0))), KATIE, { risk: 'med', why: 'Katie also needs her town recorded; starting a visit from here may not spawn her.' }),
          row('Katie’s mom is the one searching', 'LostChildRecord’s Kaitlin bit: on when it’s Kaitlin, Katie’s mom, who is visiting instead of Katie.', switchInput(kMom, v => setKMom(v ? 1 : 0)), KATIE + 0xA),
          row('Her home town', s.u16(KATIE) ? s.str(KATIE + 2, 8) || '(unnamed)' : 'Not set', h('span', { class: 'mono muted' }, hex(s.u16(KATIE))), KATIE),
        ),
        section('📅 Calendar', 'The week’s visitor schedule and the town’s events'),
        card(
          row('Crazy Redd’s day', 'The weekday his tent goes up this week.', selectInput(WEEKDAYS, () => s.u8(WEEK + 0x10), v => { s.set8(WEEK + 0x10, v); refresh(); }, { width: 'w-m' }), WEEK + 0x10),
          row('Today’s visitor event', `${EV.name(s.u8(WEEK + 0x12))} on ${DAYS[s.u8(WEEK + 0x13)] || 'day ' + s.u8(WEEK + 0x13)}.`, h('span', { style: { display: 'flex', gap: '6px' } }, selectInput(weeklyOpts, () => s.u8(WEEK + 0x12), v => { s.set8(WEEK + 0x12, v); refresh(); }, { width: 'w-m' }), selectInput(WEEKDAYS, () => s.u8(WEEK + 0x13), v => { s.set8(WEEK + 0x13, v); refresh(); }, { width: 'w-m' })), WEEK + 0x12),
          row('Event shared online', `${EV.name(s.u8(WEEK + 0x11))}. While you play over Wi-Fi the host’s event is kept here; offline it resets to None.`, selectInput(eventOpts, () => s.u8(WEEK + 0x11), v => { s.set8(WEEK + 0x11, v); refresh(); }, { width: 'w-m' }), WEEK + 0x11),
          row('Schedule made on', dateText(s, WEEK), dateEditor(s, WEEK, refresh), WEEK),
          row('Schedule refreshed on', dateText(s, WEEK + 4), dateEditor(s, WEEK + 4, refresh), WEEK + 4),
          row('Re-roll the week', 'Sets both week markers back so the game plans a new week of visitors when the save loads.', h('button', { class: 'btn small', onclick: () => { for (const o of [8, 12]) { s.set8(WEEK + o, 1); s.set8(WEEK + o + 1, 1); s.set8(WEEK + o + 2, 0); s.set8(WEEK + o + 3, 0); } sfx.pop(); toast('A fresh week of visitors next time you play', '📅'); refresh(); } }, 'Re-roll'), WEEK + 8, { risk: 'med', why: 'Visitors already announced for this week may change.' })),
        h('div', { class: 'card' }, h('table', { class: 'ex-table cal-table' }, h('thead', null, h('tr', null, ['Slot', 'Day (month / day)', 'Visitor', 'State', 'Happened', 'Residents there'].map(t => h('th', null, t)))),
          h('tbody', null, range(5).map(k => { const o = WEEK + 0x14 + k * 6; return h('tr', null, h('td', null, k + 1),
            // EventWeekSlot date: month << 8 | day.
            h('td', null, h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, numberInput(() => s.u8(o + 1), v => s.set8(o + 1, v), { max: 12, width: 'w-s' }), '/', numberInput(() => s.u8(o), v => s.set8(o, v), { max: 31, width: 'w-s' }))),
            h('td', null, selectInput(weeklyOpts, () => s.u8(o + 2), v => { s.set8(o + 2, v); refresh(); }, { width: 'w-m' })),
            h('td', null, numberInput(() => s.u8(o + 3), v => s.set8(o + 3, v), { max: 255, width: 'w-s' })),
            h('td', null, h('input', { type: 'checkbox', checked: !!s.u8(o + 4), onchange: e => { s.set8(o + 4, e.target.checked ? 1 : 0); sfx.toggle(e.target.checked); } })),
            h('td', null, h('span', { style: { display: 'flex', gap: '4px' } }, range(4).map(q => h('label', { title: `Resident ${q + 1}`, class: 'cal-bit' }, h('input', { type: 'checkbox', checked: !!((s.u8(o + 5) >> q) & 1), onchange: e => s.set8(o + 5, (s.u8(o + 5) & ~(1 << q)) | (e.target.checked ? 1 << q : 0)) }), q + 1))))); })))),
        h('div', { class: 'card' }, h('table', { class: 'ex-table cal-table' }, h('thead', null, h('tr', null, ['Town event', 'Event', 'Year', 'Starts (month / day, hour)', 'Ends (month / day, hour)'].map(t => h('th', null, t)))),
          h('tbody', null, range(4).map(k => { const o = TEVENTS + k * 0xC; return h('tr', null, h('td', null, s.u16(o) === 0x63 ? 'Free slot' : EV.name(s.u16(o))),
            h('td', null, selectInput(eventOpts, () => s.u16(o), v => { s.set16(o, v); refresh(); }, { width: 'w-m' })),
            h('td', null, numberInput(() => s.u8(o + 2), v => s.set8(o + 2, v), { max: 255, width: 'w-s' })),
            h('td', null, eventDate(s, o + 4, refresh)), h('td', null, eventDate(s, o + 8, refresh))); })))),
        card(
          row('Events checked on', dateText(s, TEVENTS + 0x30), dateEditor(s, TEVENTS + 0x30, refresh), TEVENTS + 0x30),
          ...range(4).filter(q => s.playerExists(q)).map(q => row(`${s.str(s.playerBase(q) + 0x2282, 8)} last played`, dateText(s, LASTPLAY + q * 4), dateEditor(s, LASTPLAY + q * 4, refresh), LASTPLAY + q * 4)),
          row('Happy Room Academy', `Last house score sent on ${dateText(s, HRA)}.`, dateEditor(s, HRA, refresh), HRA)),

        // ---------------- snowmen
        section('⛄ Snowmen', 'Up to three in town each winter'),
        card(range(3).map(k => { const o = SNOW + k * 6, d = s.u16(o), z = s.u16(o + 2);
          const setD = (sh, w, v) => { const m = ((1 << w) - 1) << sh; s.set16(o, (s.u16(o) & ~m) | ((v << sh) & m)); refresh(); };
          const setZ = (sh, w, v) => { const m = ((1 << w) - 1) << sh; s.set16(o + 2, (s.u16(o + 2) & ~m) | ((v << sh) & m)); refresh(); };
          return row(`Snowman ${k + 1}`, s.u8(o + 5) ? `Built ${MONTHS[((d >> 7) & 15) - 1] || '?'} ${d >> 11}, 20${String(d & 127).padStart(2, '0')}, ${s.u8(o + 4)} days ago` : 'Not in town',
            h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } },
              h('span', { class: 'muted' }, 'head'), numberInput(() => z & 127, v => setZ(0, 7, v), { max: 127, width: 'w-s' }),
              h('span', { class: 'muted' }, 'body'), numberInput(() => (z >> 7) & 127, v => setZ(7, 7, v), { max: 127, width: 'w-s' }),
              h('span', { class: 'muted' }, 'rank'), numberInput(() => z >> 14, v => setZ(14, 2, v), { max: 3, width: 'w-s' }),
              h('span', { class: 'muted' }, 'age'), numberInput(() => s.u8(o + 4), v => { s.set8(o + 4, v); refresh(); }, { max: 255, width: 'w-s' }),
              h('span', { class: 'muted' }, 'in town'), switchInput(() => s.u8(o + 5), v => { s.set8(o + 5, v ? 1 : 0); refresh(); })), o); })),

        section('☕ The Roost today', 'Who drops in for coffee'),
        card(
          row('Early morning guest', 'Pelly stops by before work (6:00–6:55).', switchInput(rMorning, v => setRMorning(v ? 1 : 0)), ROOST),
          row('Lunchtime guest', '12:00–13:30.', selectInput(ROOST_DAY, rNoon, setRNoon), ROOST),
          row('Afternoon guest', '14:30–16:00.', selectInput(ROOST_DAY, rAfter, setRAfter), ROOST),
          row('Late-night guest', 'Someone drops in for coffee late at night. The game always rolls one on weekends; on weekdays there’s a 30% chance, and only once Nook’s has become Nookington’s. (You can’t work at the Roost in Wild World; these are guests.)', switchInput(rLate, v => setRLate(v ? 1 : 0)), ROOST),
          row('Also', 'Phyllis drops in most nights 21:00–21:55, and K.K. Slider plays every Saturday from 20:00.', h('span', { class: 'muted' }, '🎸')),
        ),

        // ---------------- crazy redd
        section('🦊 Crazy Redd'),
        h('div', { class: 'card pad' }, h('div', { class: 'slots' }, range(3).map(k => slot(() => s.u16(REDD + k * 2), v => s.set16(REDD + k * 2, v), { index: k })))),
        card(
          row('Password slot', 'Which of the members-only passwords is current.', numberInput(() => s.u8(REDD + 0xC) << 24 >> 24, v => s.set8(REDD + 0xC, v & 0xFF), { min: -1, max: 127, width: 'w-s' }), REDD + 0xC),
          row('Last sold to', s.u16(REDD_SALE + 0xA) ? `${s.str(REDD_SALE + 0xC, 8)} of ${s.str(REDD_SALE + 2, 8)}` : 'Nobody yet', slot(() => s.u16(REDD_SALE + 0x16), v => s.set16(REDD_SALE + 0x16, v), { title: 'Last item sold' }), REDD_SALE),
        ),
        h('div', { class: 'card' }, window.BitBytes(s, REDD + 8, 0xC, o => hex(o, 5))),

        // ---------------- contest
        section('🏆 Tortimer’s contest'),
        card(
          row('Contest', 'The current or most recent contest.', selectInput(CONTESTS, () => s.u8(c + 0x37), v => s.set8(c + 0x37, v)), c + 0x37),
          row('Contest date', dateText(s, c + 0x34), dateEditor(s, c + 0x34, refresh), c + 0x34),
          row('Record holder (resident)', s.u16(c + 0xA) ? `${s.str(c + 0xC, 8)} of ${s.str(c + 0x2, 8)}` : 'None', h('span', { style: { display: 'flex', gap: '6px' } }, textInput(() => s.str(c + 0xC, 8), v => s.setStr(c + 0xC, 8, v), 8, { width: 'w-s', check: WWSave.canEncode }), textInput(() => s.str(c + 0x2, 8), v => s.setStr(c + 0x2, 8, v), 8, { width: 'w-s', check: WWSave.canEncode })), c),
          row('Record holder (villager)', villagerName(c + 0x16) || 'None. Villagers enter contests too.', h('span', { class: 'muted mono' }, hex(s.u8(c + 0x21), 2)), c + 0x16),
          row('Voted villager', villagerName(c + 0x22) || 'None. Used by the Flower Fest vote.', h('span', { class: 'muted mono' }, hex(s.u8(c + 0x2D), 2)), c + 0x22),
          row('Winning entry', 'The fish, bug or flower entered.', slot(() => s.u16(c + 0x2E), v => s.set16(c + 0x2E, v), { title: 'Winning entry' }), c + 0x2E),
          row('Score', 'Fishing: the fish’s size. Bug-Off and Flower Fest: points, stored × 4096.', numberInput(() => s.u32(c + 0x30), v => s.set32(c + 0x30, v), { max: 0x7FFFFFFF }), c + 0x30),
        ),
      ];
    },
  });
})();
