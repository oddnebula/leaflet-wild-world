// Wild World's event numbers (the ids in sEventSchedule), named from the decompilation: the schedule rules
// (EventRule_Resolve: villager / player birthdays, fixed dates, "nth weekday" rules, fishing and bug months), the
// visitor tables in unk_02082d74.cpp (sDateVisitorTable, sEventHostTable, the per-visitor Event_IsActive checks)
// and the order of the bulletin-board notices. Used by the calendar and the weekly visitor slots.
(function () {
  'use strict';
  const E = { 99: 'None' };
  for (let i = 0; i < 8; i++) { E[i] = `Neighbor ${i + 1}’s birthday`; E[0x4B + i] = `Neighbor ${i + 1}’s birthday is coming up`; }
  E[8] = 'Your birthday';
  const festival = (id, name, host, extras) => { E[id] = name; if (host !== null) E[host] = `${name}: host in town`; for (const [k, v] of extras) E[k] = `${name}: ${v}`; };
  festival(0x09, 'Fishing Tourney', 0x14, [[0x25, 'notice a week ahead'], [0x26, 'notice the day before'], [0x46, 'neighbors talk about it']]);
  festival(0x0A, 'Bug-Off', 0x15, [[0x27, 'notice a week ahead'], [0x28, 'notice the day before'], [0x47, 'neighbors talk about it']]);
  festival(0x0B, 'Flea Market', null, [[0x29, 'notice ahead'], [0x2A, 'notice the day before'], [0x48, 'neighbors talk about it']]);
  festival(0x0C, 'La-Di-Day', null, [[0x2B, 'notice ahead'], [0x2C, 'notice the day before'], [0x49, 'neighbors talk about it']]);
  festival(0x0D, 'Yay Day', null, [[0x2D, 'notice ahead'], [0x2E, 'notice the day before'], [0x4A, 'neighbors talk about it']]);
  festival(0x0E, 'Flower Fest', 0x16, [[0x2F, 'first notice'], [0x30, 'notice the day before'], [0x31, 'notice during the week'], [0x54, 'early talk'], [0x55, 'talk'], [0x56, 'talk the day before']]);
  festival(0x0F, 'Fireworks Show', 0x17, [[0x32, 'notice ahead'], [0x33, 'notice the day before'], [0x57, 'early talk'], [0x58, 'talk'], [0x59, 'talk the day before']]);
  festival(0x10, 'Acorn Festival', 0x18, [[0x34, 'first notice'], [0x35, 'notice the day before'], [0x36, 'notice during the week'], [0x5A, 'early talk'], [0x5B, 'talk'], [0x5C, 'talk the day before']]);
  festival(0x11, 'Bright Nights', 0x19, [[0x37, 'first notice'], [0x38, 'notice the day before'], [0x39, 'notice during the week'], [0x5D, 'early talk'], [0x5E, 'talk'], [0x5F, 'talk the day before']]);
  festival(0x12, 'New Year’s Countdown', 0x1A, [[0x53, 'talk in the last days of the year'], [0x62, 'countdown night']]);
  festival(0x13, 'New Year’s Day', 0x1B, [[0x61, 'New Year’s night']]);
  Object.assign(E, {
    0x1C: 'Notice: Happy New Year (Jan 1)', 0x1D: 'Notice: snowy weather (Jan 15)', 0x1E: 'Notice: cherry blossoms (Mar 15)',
    0x1F: 'Notice: sunny days (May 6)', 0x20: 'Notice: end of the rainy season (Jul 1)', 0x21: 'Notice: cool mornings (Nov 12)',
    0x22: 'Notice: heavy snow (Dec 9)', 0x23: 'Notice: the countdown (Dec 28)', 0x24: 'Notice: the countdown (Dec 31)',
    0x3A: 'K.K. Slider at the Roost (Saturday night)', 0x3B: 'Joan (Sunday morning)', 0x3C: 'Lyle (Saturday)',
    0x3D: 'Crazy Redd', 0x3E: 'Saharah', 0x3F: 'Katrina', 0x40: 'Gracie', 0x41: 'Wendell', 0x42: 'Pascal', 0x43: 'Dr. Shrunk',
    0x44: 'Gulliver’s UFO', 0x45: 'Pete', 0x60: 'Gracie (second stop)',
  });
  // The ones the weekly visitor slots hold (EventWeekSlots).
  const WEEKLY = [0x3D, 0x3E, 0x3F, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x60, 99];
  window.WW_EVENTS = { name: id => E[id] || `Event ${id}`, all: E, weekly: WEEKLY };
})();
