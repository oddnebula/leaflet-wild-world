// Neighbor (villager) editor.
(function () {
  'use strict';
  const { h, hex, row, card, section, numberInput, textInput, selectInput, switchInput, slot, sfx, say, toast, item, confirmSheet } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const range = n => [...Array(n).keys()];
  const byId = new Map(D.villagers.map(v => [v.id, v]));
  const umbrellas = D.items.filter(i => i[2] === 'Umbrellas');

  function stamp(s, o) {
    const [sec, min, hr, day, mon, yr] = s.bytes(o, 6);
    if (!mon) return 'Never';
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mon - 1] || '?'} ${day}, 20${String(yr).padStart(2, '0')} at ${hr}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  function stampEditor(s, o) {
    const [sec, min, hr, day, mon, yr] = s.bytes(o, 6);
    const f = (i, max, w = 'w-s') => numberInput(() => s.u8(o + i), v => s.set8(o + i, v), { max, width: w });
    void sec; void min; void hr; void day; void mon; void yr;
    return h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, f(4, 12), '/', f(3, 31), '/', f(5, 99), h('span', { class: 'muted' }, ' at '), f(2, 23), ':', f(1, 59), ':', f(0, 59));
  }

  // VillagerPlanBlock (+0x65C): the villager's plan (VillagerPlan: two timestamps, a state, eight hobby scores and
  // eight pending ones; state 0–7 is the hobby they're into, the "st_boom" topics) and a planned errand for a player.
  const HOBBIES = ['Bug catching', 'Fishing', 'Fossil digging', 'Clothes shopping', 'Furniture collecting', 'Gardening', 'Shell collecting', 'Walking'];
  const PLAN_STATES = [...HOBBIES.map((n, i) => [i, `Into ${n.toLowerCase()}`]), [8, 'Picking a new hobby'], [9, 'Plan state 9'], [10, 'Just moved in'], [11, 'Plan state 11']];
  function planEditor(s, pb, refresh) {
    const scores = h('div', { class: 'hobby-grid' }, HOBBIES.map((n, i) => h('label', null, h('span', null, n), numberInput(() => s.u8(pb + 0x11 + i), q => { s.set8(pb + 0x11 + i, q); refresh(); }, { max: 255, width: 'w-s' }))));
    const e = pb + 0x24;
    return [
      card(
        row('What they’re into', 'Villagers chat about their current hobby. After a while the highest score wins and becomes the next hobby.', selectInput(PLAN_STATES, () => s.u8(pb + 0x10), q => { s.set8(pb + 0x10, q); refresh(); }), pb + 0x10),
        row('Hobby set on', stamp(s, pb), stampEditor(s, pb), pb),
        row('State changed on', stamp(s, pb + 8), stampEditor(s, pb + 8), pb + 8)),
      section('Hobby scores', 'How much each hobby appeals right now · the top one wins at the next change'),
      h('div', { class: 'card pad' }, scores),
      section('Pending scores', 'Added to the scores at the next daily update'),
      h('div', { class: 'card pad' }, h('div', { class: 'hobby-grid' }, HOBBIES.map((n, i) => h('label', null, h('span', null, n), numberInput(() => s.u8(pb + 0x19 + i), q => s.set8(pb + 0x19 + i, q), { max: 255, width: 'w-s' }))))),
      section('Planned errand', 'A favor they mean to ask a resident'),
      card(
        row('For resident', s.str(e + 0xC + 0xC, 8) || 'Nobody', textInput(() => s.str(e + 0xC + 0xC, 8), q => s.setStr(e + 0xC + 0xC, 8, q), 8, { width: 'w-s', check: WWSave.canEncode }), e + 0xC),
        row('Item involved', 'What they want, or are offering.', slot(() => s.u16(e + 8), q => s.set16(e + 8, q), { emptyLabel: 'None' }), e + 8),
        row('Errand kind and step', 'ErrandRecord kind (22 = none) and step bits.', h('span', { style: { display: 'flex', gap: '6px' } }, numberInput(() => s.u8(e + 0xA), q => s.set8(e + 0xA, q), { max: 255, width: 'w-s' }), numberInput(() => s.u8(e + 0xB), q => s.set8(e + 0xB, q), { max: 255, width: 'w-s' })), e + 0xA),
        row('Given on', stamp(s, e), stampEditor(s, e), e)),
    ];
  }
  window.VillagerPlanEditor = planEditor;

  for (let v = 0; v < 8; v++) {
    VIEWS.push({
      id: 'villager' + v, group: 'Neighbors',
      icon: s => { const id = s.u8(s.villagerBase(v) + 0x6CB); return id === 0xFF ? '🌱' : window.WW_SPECIES_EMOJI(byId.get(id)?.species); },
      title: s => { if (!s) return `Neighbor ${v + 1}`; const id = s.u8(s.villagerBase(v) + 0x6CB); return id === 0xFF ? `Empty lot ${v + 1}` : (byId.get(id)?.name || `Villager ${hex(id, 2)}`); },
      sub: s => { const id = s.u8(s.villagerBase(v) + 0x6CB); const i = byId.get(id); return id === 0xFF ? 'No one lives here' : `${i?.species || 'Villager'} · ${D.personalities[s.u8(s.villagerBase(v) + 0x6CA)] || 'Unknown personality'}`; },
      tips: ['Swapping a villager’s species keeps their house, furniture and memories, just with a new face!', 'Friendship is stored per resident in the Memories tab.', 'Villager wallpaper and carpet are indexes into the game’s wallpaper and flooring lists.'],
      render(s, ctx) {
        const { refresh } = ctx;
        const vid = 'villager' + v, tab = UI.tabOf(vid, 'about');
        const b = s.villagerBase(v), id = s.u8(b + 0x6CB);
        const tabs = [['about', '🐾 About'], ['home', '🛋️ Home'], ['memories', '💌 Memories'], ['pattern', '🎨 Pattern'], ['letter', '✉️ Letter'], ['raw', '🧪 Hidden data']];
        const nav = h('div', { class: 'tabs' }, tabs.map(([t, label]) => h('button', { class: 'tab' + (tab === t ? ' on' : ''), onclick: () => { UI.setTab(vid, t); sfx.click(); refresh(); } }, label)));
        const villagerOpts = [[0xFF, '— Empty lot —'], ...D.villagers.map(x => [x.id, `${x.name} (${x.species || '?'})`])];
        const bodies = { about, home, memories, pattern, letter, raw };
        if (ctx.indexing) { for (const [t] of tabs) { UI.setRegistryTab(t); bodies[t](); } return []; }
        UI.setRegistryTab(tab);
        return [nav, bodies[tab]()];

        function about() {
          let model = null;
          if (id !== 0xFF && window.ROM && ROM.ready && window.Model3D) {
            const shirt = s.u16(b + 0x6EC);
            const groups = Model3D.villagerMesh(id, shirt, shirt >= 0x1429 && shirt <= 0x1430 ? { shirtTex: Model3D.patternTex(s, 0xFAFC + (shirt - 0x1429) * 0x228) } : {});
            const cv = groups && Model3D.viewer(groups, { size: 230 });
            if (cv) model = h('div', { class: 'card pad villager-hero' }, cv, h('div', null,
              h('div', { class: 'vh-name' }, byId.get(id)?.name || 'Neighbor'),
              h('div', { class: 'muted' }, `${byId.get(id)?.species || ''} · ${D.personalities[s.u8(b + 0x6CA)] || ''}`),
              h('div', { class: 'vh-quote' }, `“…${s.str(b + 0x6DE, 10)}!”`),
              h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '8px' } }, 'Drag to turn · drawn from your ROM, wearing their shirt from the save')));
          }
          return [
            model,
            section('Who lives here'),
            card(
              row('Villager', 'Picks the species and character model. Swapping keeps their house, furniture and memories.', selectInput(villagerOpts, () => s.u8(b + 0x6CB), x => { s.set8(b + 0x6CB, x); const n = byId.get(x); if (n) say(`${n.name} is moving in! Their house and things stay the same until they redecorate.`); refresh(); }), b + 0x6CB, { risk: 'med', why: 'Choosing “Empty lot” leaves their house standing with nobody inside. Use Hidden data → Clear this lot instead.' }),
              row('Personality', 'Changes how they talk, their hobbies and who they get along with.', selectInput(D.personalities.map((p, i) => [i, p]), () => s.u8(b + 0x6CA), x => s.set8(b + 0x6CA, x), { width: 'w-m' }), b + 0x6CA),
              row('Catchphrase', 'What they say at the end of sentences. Up to 10 characters.', textInput(() => s.str(b + 0x6DE, 10), x => s.setStr(b + 0x6DE, 10, x), 10, { check: WWSave.canEncode }), b + 0x6DE),
              row('Home town', 'The town this villager considers home (useful when they arrive from a friend’s town).', h('span', { style: { display: 'flex', gap: '6px' } }, textInput(() => s.str(b + 0x6C2, 8), x => s.setStr(b + 0x6C2, 8, x), 8, { width: 'w-s', check: WWSave.canEncode }), numberInput(() => s.u16(b + 0x6C0), x => s.set16(b + 0x6C0, x), { max: 0xFFFF, width: 'w-s' })), b + 0x6C0),
            ),
            section('Outfit'),
            h('div', { class: 'card' }, h('div', { class: 'slots', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' } },
              h('div', null, slot(() => s.u16(b + 0x6EC), x => s.set16(b + 0x6EC, x), { title: 'Choose a shirt', categories: ['Shirts'] }), h('div', { class: 'muted', style: { textAlign: 'center', fontSize: '11.5px', marginTop: '4px', fontWeight: 650 } }, 'Shirt')))),
            card(row('Umbrella', 'What they carry when it rains.', selectInput(umbrellas.map((u, i) => [i, u[1]]), () => s.u8(b + 0x6F4), x => s.set8(b + 0x6F4, x)), b + 0x6F4)),
            id === 0xFF ? null : card(row('Current hobby', 'What they’ll talk about. More in Hidden data › Plans.', selectInput(PLAN_STATES, () => s.u8(b + 0x65C + 0x10), x => { s.set8(b + 0x65C + 0x10, x); refresh(); }), b + 0x66C)),
          ];
        }
        function home() {
          const walls = D.items.filter(i => i[2] === 'Wallpaper'), floors = D.items.filter(i => i[2] === 'Carpets');
          const wallId = (walls[s.u8(b + 0x6EE)] || [0xFFF1])[0], floorId = (floors[s.u8(b + 0x6EF)] || [0xFFF1])[0];
          // With the ROM: the game's own arrangement (room layout s.u8(+0x6F2), only the pieces on display).
          // Without it: a friendly approximation on the same 6×6 floor.
          const layout = window.ROM && ROM.ready ? ROM.roomLayout(s.u8(b + 0x6F2), false) : null;
          const shown = s.u16(b + 0x6EA), at = {}, facing = {};
          if (layout) for (const e of layout) {
            if (e.code < 0xF000 || e.code > 0xF02F) continue;
            // getSlotFromLayoutCode: (code − 0xF000) >> 2, minus 2 from 3 up.
            let k = (e.code - 0xF000) >> 2; if (k >= 3) k -= 2; if (k > 9 || !((shown >> k) & 1)) continue;
            at[(e.y - 8) * 6 + (e.x - 5)] = k; facing[k] = e.code & 3;
          }
          else [[0, 0], [2, 0], [4, 0], [5, 0], [0, 2], [5, 2], [0, 4], [2, 3], [5, 4], [3, 5]].forEach(([x, y], k) => { at[y * 6 + x] = k; });
          const view = window.RoomView.room({
            cols: 6, rows: 6, area: { x: 0, y: 0, w: 6, h: 6 }, wall: wallId, floor: floorId, title: `${byId.get(id)?.name || 'Neighbor'}’s house`,
            cell: (x, y) => { const k = at[y * 6 + x]; if (k === undefined) return {}; const v = s.u16(b + 0x6AC + k * 2); return { main: v === 0xFFF1 || facing[k] === undefined ? v : (v & ~3) | facing[k] }; },
            onCell: async (x, y, e, ctx) => {
              const k = at[y * 6 + x]; if (k === undefined) return;
              if (ctx) { s.set16(b + 0x6AC + k * 2, 0xFFF1); sfx.toggle(false); refresh(); return; }
              const q = await UI.pickItem(s.u16(b + 0x6AC + k * 2), { title: `Furniture piece ${k + 1}` });
              if (q !== null) { s.set16(b + 0x6AC + k * 2, q); sfx.bell(); refresh(); }
            },
          });
          const x = s.u8(b + 0x6E8), y = s.u8(b + 0x6E9);
          return [
            section('Inside', 'Click a piece to swap it · right-click to remove'),
            h('div', { class: 'card pad' }, view, h('div', { class: 'muted', style: { fontSize: '12px', textAlign: 'center', marginTop: '6px' } }, layout ? `Room layout ${s.u8(b + 0x6F2)} from your ROM, with the pieces they have on display.` : 'The game arranges these 10 pieces itself. Open your ROM to see its real arrangement.')),
            card(
              row('Wallpaper', null, selectInput(walls.map((w, i) => [i, w[1]]), () => s.u8(b + 0x6EE), q => { s.set8(b + 0x6EE, q); refresh(); }), b + 0x6EE),
              row('Flooring', null, selectInput(floors.map((w, i) => [i, w[1]]), () => s.u8(b + 0x6EF), q => { s.set8(b + 0x6EF, q); refresh(); }), b + 0x6EF),
              row('Room layout', 'Which of the game’s 40 furniture arrangements they use (0–39; 0–9 while packing to move). The game picks a new one when they redecorate.', numberInput(() => s.u8(b + 0x6F2), q => { s.set8(b + 0x6F2, q); refresh(); }, { max: 39, width: 'w-s' }), b + 0x6F2),
              row('Furniture on display', 'Which of the 10 pieces are set out in the room (the game shows 3–5 at a time).', h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'flex-end' } }, range(10).map(k => {
                const on = (s.u16(b + 0x6EA) >> k) & 1;
                return h('button', { class: 'chip cat-chip' + (on ? ' on' : ''), title: UI.itemLabel(s.u16(b + 0x6AC + k * 2)), 'aria-pressed': on ? 'true' : 'false', onclick: () => { s.set16(b + 0x6EA, s.u16(b + 0x6EA) ^ (1 << k)); sfx.toggle(!on); refresh(); } }, String(k + 1));
              })), b + 0x6EA),
              row('Furniture taste', 'Index of the furniture theme they like when picking new pieces.', numberInput(() => s.u8(b + 0x6F1), q => s.set8(b + 0x6F1, q), { max: 255, width: 'w-s' }), b + 0x6F1),
            ),
            section('Furniture list', 'The same 10 pieces as slots'),
            h('div', { class: 'card' }, h('div', { class: 'slots' }, range(10).map(k => slot(() => s.u16(b + 0x6AC + k * 2), q => s.set16(b + 0x6AC + k * 2, q), { index: k })))),
            section('Where they live', id === 0xFF ? 'Empty lot' : `Map spot ${x - 16}, ${y - 16}`),
            id === 0xFF ? null : window.HouseMover.panel(s, v, refresh),
            card(
              row('House position (raw)', 'Their house’s spot on the map plus 16 (the outer ring of acres counts too). Use the map above to move the house instead. It moves the building too.', h('span', { style: { display: 'flex', gap: '6px' } },
                numberInput(() => s.u8(b + 0x6E8), UI.guard('vpos', 'Edit raw house coordinates?', 'If these numbers don’t match where the house actually is on the map, the villager walks to the wrong spot and can get stuck. The map above keeps both in sync.', q => s.set8(b + 0x6E8, q)), { max: 255, width: 'w-s' }),
                numberInput(() => s.u8(b + 0x6E9), UI.guard('vpos', 'Edit raw house coordinates?', 'If these numbers don’t match where the house actually is on the map, the villager walks to the wrong spot and can get stuck.', q => s.set8(b + 0x6E9, q)), { max: 255, width: 'w-s' })), b + 0x6E8, { risk: 'high' }),
              row('How they moved in', 'Set by the game when the villager arrived (new town, from a friend’s town and so on).', numberInput(() => s.u8(b + 0x6F0), q => s.set8(b + 0x6F0, q), { max: 255, width: 'w-s' }), b + 0x6F0, { risk: 'med' }),
            ),
            section('Held items', '4 more item slots stored with this villager'),
            h('div', { class: 'card' }, h('div', { class: 'slots' }, range(4).map(k => slot(() => s.u16(b + 0x6CC + k * 2), q => s.set16(b + 0x6CC + k * 2, q), { index: k })))),
          ];
        }
        function memories() {
          // VillagerMemory (0x68 bytes): who you are, nickname, compliment, greeting, last talk, gifts, friendship, your town tune.
          const MEM_FLAGS = [[0, 'Got a letter from you'], [4, 'Gave you a gift'], [5, 'Fortune greeting ready'], [6, 'Talked today'], [7, 'Got a party gift'], [11, 'Greeted you at a party'], [12, 'Sent a birthday letter'], [13, 'Sent a New Year letter'], [14, 'Visited the flea market']];
          const cards = range(8).map(k => {
            const m = b + k * 0x68, used = s.u16(m + 0xA) !== 0;
            if (!used) return null;
            const fr = s.u8(m + 0x54) << 24 >> 24;
            const flags = s.u16(m + 0x64);
            return h('div', { class: 'card' },
              h('div', { style: { padding: '12px 16px 4px', fontWeight: 800 } }, `💭 ${s.str(m + 0xC, 8) || '?'} from ${s.str(m + 0x2, 8) || '?'}`, h('span', { class: 'off mono muted', style: { fontSize: '10.5px', marginLeft: '8px' } }, hex(m, 5))),
              row('Friendship', `${fr >= 80 ? 'Best friends' : fr >= 40 ? 'Good friends' : fr >= 0 ? 'Getting to know you' : 'Not fond of you'}. Goes up when you talk, write and give gifts; −128 to 127.`,
                h('span', null, numberInput(() => s.u8(m + 0x54) << 24 >> 24, q => { s.set8(m + 0x54, q & 0xFF); refresh(); }, { min: -128, max: 127, width: 'w-s' }), ' ', h('button', { class: 'btn small bell', onclick: () => { s.set8(m + 0x54, 127); sfx.bell(); refresh(); } }, 'Besties')), m + 0x54),
              row('Nickname', 'What this villager calls you.', textInput(() => s.str(m + 0x16, 8), q => s.setStr(m + 0x16, 8, q), 8, { check: WWSave.canEncode }), m + 0x16),
              row('Compliment', 'A phrase they remember about you (up to 16 characters).', textInput(() => s.str(m + 0x1E, 16), q => s.setStr(m + 0x1E, 16, q), 16, { check: WWSave.canEncode }), m + 0x1E),
              row('Greeting', 'The greeting you taught them (up to 16 characters).', textInput(() => s.str(m + 0x2E, 16), q => s.setStr(m + 0x2E, 16, q), 16, { check: WWSave.canEncode }), m + 0x2E),
              row('Last chat', stamp(s, m + 0x40), stampEditor(s, m + 0x40), m + 0x40),
              row('Last gift from you', 'The item you most recently gave them.', slot(() => s.u16(m + 0x52), q => s.set16(m + 0x52, q), { title: 'Gift' }), m + 0x52),
              row('Impression', 'A second mood value the game keeps next to friendship.', numberInput(() => s.u8(m + 0x55), q => s.set8(m + 0x55, q), { max: 255, width: 'w-s' }), m + 0x55),
              row('Town tune they know', 'Villagers remember your town tune and hum it.', h('button', { class: 'btn small', onclick: () => { for (let i = 0; i < 8; i++) s.set8(m + 0x5C + i, s.u8(0x15FA8 + i)); sfx.pop(); toast('They’ll hum the current tune', '🎵'); } }, 'Teach current tune'), m + 0x5C),
              row('Talk streak', 'Days in a row you’ve chatted (0–7).', numberInput(() => (s.u16(m + 0x64) >> 8) & 7, q => s.set16(m + 0x64, (s.u16(m + 0x64) & ~0x700) | ((q & 7) << 8)), { max: 7, width: 'w-s' }), m + 0x64),
              h('div', { class: 'flag-chips', style: { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 16px 14px' } }, MEM_FLAGS.map(([bit, label]) => {
                const on = (flags >> bit) & 1;
                return h('button', { class: 'chip cat-chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: () => { s.set16(m + 0x64, s.u16(m + 0x64) ^ (1 << bit)); sfx.toggle(!on); refresh(); } }, (on ? '✓ ' : '') + label);
              })),
              row('Remembered player', 'Player ID / town ID this memory belongs to.', h('span', { style: { display: 'flex', gap: '6px' } }, numberInput(() => s.u16(m + 0xA), q => s.set16(m + 0xA, q), { max: 0xFFFF, width: 'w-s' }), numberInput(() => s.u16(m), q => s.set16(m, q), { max: 0xFFFF, width: 'w-s' })), m, { risk: 'med', why: 'If this stops matching a resident, the villager forgets them.' }),
            );
          }).filter(Boolean);
          return [section('Memories', 'Who this villager knows'), cards.length ? cards : h('div', { class: 'card' }, h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🫧'), 'This villager hasn’t met anyone yet.'))];
        }
        function pattern() {
          return [section('Their custom design', 'Villagers wear or display this pattern'), window.PatternEditor.patternEditor(s, b + 0x340, { title: 'Villager pattern' })];
        }
        function letter() {
          const { letterEditor, mainAcc } = window.LetterEditor;
          return [section('Last letter', 'A letter this villager is keeping'), letterEditor(mainAcc(s), b + 0x568, s, 'Villager letter')];
        }
        function raw() {
          return [section('Plans', 'Their hobby and any favor they’re planning (VillagerPlanBlock)'),
            ...planEditor(s, b + 0x65C, refresh),
            section('Plan bytes', 'The same 0x50 bytes, bit by bit'),
            h('div', { class: 'card' }, window.BitBytes(s, b + 0x65C, 0x50, o => hex(o - b, 3))),
            section('Other records'), card(
              row('Moved here from', 'Town ID and name of the town they lived in before.', h('span', { style: { display: 'flex', gap: '6px' } }, textInput(() => s.str(b + 0x6D6, 8), q => s.setStr(b + 0x6D6, 8, q), 8, { width: 'w-s', check: WWSave.canEncode }), numberInput(() => s.u16(b + 0x6D4), q => s.set16(b + 0x6D4, q), { max: 0xFFFF, width: 'w-s' })), b + 0x6D4),
              row('Letter’s town', 'The town their kept letter belongs to.', h('span', { style: { display: 'flex', gap: '6px' } }, textInput(() => s.str(b + 0x6F8, 8), q => s.setStr(b + 0x6F8, 8, q), 8, { width: 'w-s', check: WWSave.canEncode }), numberInput(() => s.u16(b + 0x6F6), q => s.set16(b + 0x6F6, q), { max: 0xFFFF, width: 'w-s' })), b + 0x6F6)),
            section('Reset'), card(row('Clear this lot entirely', 'Empties the slot so nobody lives here. A new villager may move in later.', h('button', { class: 'btn small danger', onclick: async () => {
              if (!await confirmSheet('Clear this neighbor?', 'This sets the villager ID to empty. Their house stays on the map until you remove it there.', 'Clear')) return;
              s.set8(b + 0x6CB, 0xFF); toast('Lot cleared', '🧹'); refresh();
            } }, 'Clear')))];
        }
      },
    });
  }

  // The rest of SaveVillagers: who goes outdoors (OutdoorSchedule), move-in / move-out times, the nickname cooldown,
  // the villagers who have ever lived here (speciesHistory, one bit per villager; newcomers are picked from the rest),
  // the last moved-out / moved-in / sick neighbor and the day furniture was last left behind.
  const VB = 0x8A3C, OUT_ORDER = VB + 0x381C, OUT_NOW = VB + 0x3824, OUT_ROLL = VB + 0x3828, NICK = VB + 0x38C0, MOVE_IN = VB + 0x38C4, MOVE_OUT = VB + 0x38CC,
    HISTORY = VB + 0x38D4, LAST_OUT = VB + 0x38E8, LAST_IN = VB + 0x38E9, LAST_SICK = VB + 0x38EA, DROP = VB + 0x38EE, HOUSE_STYLES = 0x1592C;
  function neighborhood(s, names, refresh) {
    const slotSel = o => selectInput([[-1, '— Nobody —'], ...range(8).map(v => [v, names[v] || `Slot ${v + 1} (empty)`])], () => s.u8(o) << 24 >> 24, q => { s.set8(o, q & 0xFF); refresh(); }, { width: 'w-m' });
    const dmy = o => h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, ...[[1, 12], [0, 31], [2, 99]].flatMap(([i, max], k) => [k ? '/' : null, numberInput(() => s.u8(o + i), q => s.set8(o + i, q), { max, width: 'w-s' })]));
    const lived = D.villagers.filter(x => x.id < 150).map(x => {
      const cb = h('input', { type: 'checkbox' }); cb.checked = !!s.bit(HISTORY, x.id);
      const el = h('label', { class: 'dex-item' + (cb.checked ? ' on' : '') }, cb, window.WW_SPECIES_EMOJI(x.species), x.name);
      cb.onchange = () => { s.setBit(HISTORY, x.id, cb.checked); el.classList.toggle('on', cb.checked); sfx.toggle(cb.checked); };
      return el;
    });
    const livedCount = D.villagers.filter(x => x.id < 150 && s.bit(HISTORY, x.id)).length;
    return [
      section('🌳 Who’s outside', 'The order neighbors head out, and who is out now'),
      card(
        row('Outside now', range(4).map(i => names[s.u8(OUT_NOW + i) << 24 >> 24]).filter(Boolean).join(', ') || 'Everyone is indoors', h('span', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } }, range(4).map(i => slotSel(OUT_NOW + i))), OUT_NOW),
        row('Going-out order', 'The next neighbors to step outside, in order.', h('span', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } }, range(8).map(i => slotSel(OUT_ORDER + i))), OUT_ORDER),
        row('Last shuffled', stamp(s, OUT_ROLL), stampEditor(s, OUT_ROLL), OUT_ROLL)),
      section('🚚 Moving in and out'),
      card(
        row('Last move-in', stamp(s, MOVE_IN), stampEditor(s, MOVE_IN), MOVE_IN),
        row('Last move-out', stamp(s, MOVE_OUT), stampEditor(s, MOVE_OUT), MOVE_OUT),
        row('Last to move away', (() => { const v = s.u8(LAST_OUT); return v === 0xFF ? 'Nobody yet' : byId.get(v)?.name || `Villager ${v}`; })(), selectInput([[0xFF, '— Nobody —'], ...D.villagers.map(x => [x.id, x.name])], () => s.u8(LAST_OUT), q => { s.set8(LAST_OUT, q); refresh(); }, { width: 'w-m' }), LAST_OUT),
        row('Newest neighbor’s slot', null, slotSel(LAST_IN), LAST_IN),
        row('Last sick neighbor’s slot', null, slotSel(LAST_SICK), LAST_SICK),
        row('Nickname cooldown from', 'After a neighbor gives you a nickname, others wait a while before doing it again.', dmy(NICK), NICK),
        row('Furniture last left behind', 'The day a neighbor last dropped furniture when moving.', dmy(DROP), DROP)),
      section('🏡 House exteriors', 'The four exterior styles the neighbors’ houses use (0–24)'),
      card(range(4).map(i => row(`Style ${i + 1}`, `Texture set ${'ABCDE'[Math.floor((s.u8(HOUSE_STYLES + i) % 25) / 5)]}${(s.u8(HOUSE_STYLES + i) % 25) % 5}`, numberInput(() => s.u8(HOUSE_STYLES + i), q => { s.set8(HOUSE_STYLES + i, q); refresh(); }, { max: 24, width: 'w-s' }), HOUSE_STYLES + i))),
      section('📜 Has lived here', `${livedCount} villagers · the game won’t pick these for new move-ins`),
      card(row('Forget the history', 'Every villager can move in again.', h('button', { class: 'btn small', onclick: () => { for (let i = 0; i < 0x14; i++) s.set8(HISTORY + i, 0); sfx.pop(); refresh(); } }, 'Clear'), HISTORY)),
      h('div', { class: 'card' }, h('div', { class: 'dex' }, lived)),
    ];
  }

  // How the neighbors feel about each other: 28 signed scores, one per pair (VillagerRelations_PairIndex), at 0xC23C.
  const REL = 0x8A3C + 0x3800, TUNE_REQ = 0x8A3C + 0x38EC;
  const pairIndex = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); let r = 0; for (let i = 0; i < lo; i++) r += 7 - i; return r + hi - lo - 1; };
  VIEWS.push({
    id: 'friendships', group: 'Neighbors', icon: '🤝', title: () => 'Friendships', sub: () => 'How your neighbors get along',
    tips: ['Neighbors who like each other visit and chat more. Ones who don’t may grumble about each other to you.', 'Scores go from −128 to 127.'],
    render(s, { refresh }) {
      const names = range(8).map(v => { const id = s.u8(s.villagerBase(v) + 0x6CB); return id === 0xFF ? null : byId.get(id)?.name || hex(id, 2); });
      const who = range(8).filter(v => names[v]);
      const tone = v => v >= 60 ? 'great' : v >= 20 ? 'good' : v > -20 ? 'meh' : 'bad';
      const grid = h('table', { class: 'rel-grid' },
        h('thead', null, h('tr', null, h('th'), who.map(v => h('th', { scope: 'col' }, names[v])))),
        h('tbody', null, who.map(a => h('tr', null, h('th', { scope: 'row' }, names[a]), who.map(b => {
          if (a === b) return h('td', { class: 'self' }, '·');
          const o = REL + pairIndex(a, b), v = s.u8(o) << 24 >> 24;
          const inp = h('input', { class: 'rel-cell ' + tone(v), type: 'number', min: -128, max: 127, value: v, title: `${names[a]} & ${names[b]}`, 'aria-label': `${names[a]} and ${names[b]}` });
          inp.addEventListener('change', () => { const q = Math.max(-128, Math.min(127, Math.round(Number(inp.value)) || 0)); s.set8(o, q & 0xFF); sfx.click(); refresh(); });
          return h('td', null, inp);
        })))));
      const req = s.u16(TUNE_REQ), requested = (req >> 1) & 1, requester = (req >> 2) & 7;
      return [
        section('Friendship chart', `${who.length} neighbors · ${who.length * (who.length - 1) / 2} pairs`),
        h('div', { class: 'card pad', style: { overflowX: 'auto' } }, who.length > 1 ? grid : h('div', { class: 'empty-note' }, 'You need at least two neighbors.')),
        card(
          row('💞 Everyone’s friends', 'Sets every pair to 100.', h('button', { class: 'btn small leaf', onclick: () => { for (let i = 0; i < 28; i++) s.set8(REL + i, 100); sfx.bell(); toast('One big happy town', '💞'); refresh(); } }, 'Apply')),
          row('Reset feelings', 'Sets every pair back to 0, like neighbors who just met.', h('button', { class: 'btn small', onclick: () => { for (let i = 0; i < 28; i++) s.set8(REL + i, 0); sfx.pop(); refresh(); } }, 'Reset')),
        ),
        section('🎵 Town tune request'),
        card(row('A neighbor wants a new town tune', requested ? `${names[requester] || 'A neighbor'} asked you to change it.` : 'Nobody has asked.', switchInput(() => requested, q => { s.set16(TUNE_REQ, (s.u16(TUNE_REQ) & ~2) | (q ? 2 : 0)); refresh(); }), TUNE_REQ)),
        ...neighborhood(s, names, refresh),
      ];
    },
  });

  // Villager arriving from another town.
  VIEWS.push({
    id: 'movein', group: 'Neighbors', icon: '🚚', title: () => 'Moving In', sub: () => 'A villager traveling from another town',
    render(s, { refresh }) {
      const o = 0x11438, active = s.u8(o) || s.u8(o + 1);
      const id = s.u8(o + 0xB);
      return [section('Incoming villager'),
        card(
          row('Someone is moving in', active ? 'Yes, a villager is on the way.' : 'Nobody is on the way right now.', h('span', { class: 'badge ' + (active ? 'ok' : 'lab') }, active ? 'Active' : 'Idle')),
          row('Villager', null, selectInput([[0xFF, '— None —'], ...D.villagers.map(x => [x.id, x.name])], () => id, q => s.set8(o + 0xB, q)), o + 0xB),
          row('Coming from', null, textInput(() => s.str(o + 2, 8), q => s.setStr(o + 2, 8, q), 8, { check: WWSave.canEncode }), o + 2),
          row('Originally from', null, textInput(() => s.str(o + 0x16, 8), q => s.setStr(o + 0x16, 8, q), 8, { check: WWSave.canEncode }), o + 0x16)),
        id === 0xFF ? null : [section('Their plans', 'Hobby and planned favors travel with them'), ...planEditor(s, 0x10D78 + 0x65C, refresh)],
        section('Raw data'), h('div', { class: 'card' }, window.BitBytes(s, o, 0x50, q => hex(q, 5)))];
    },
  });
})();
