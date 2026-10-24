// Town places: museum, Nook's shop, Able Sisters, town flag & Blanca, lost and found, recycling.
(function () {
  'use strict';
  const { h, hex, row, card, section, numberInput, selectInput, slot, sfx, say, toast } = UI;
  const D = window.WW_DATA;
  const VIEWS = (window.VIEWS = window.VIEWS || []);
  const range = n => [...Array(n).keys()];
  const MUSEUM = 0x15D50;
  // Layout confirmed in the decompilation (museum donation table): nibble per exhibit, low nibble first.
  const WINGS = [
    ['Fossils', '🦴', 0x00, D.fossils], ['Fish', '🐟', 0x1B, D.fish], ['Bugs', '🦋', 0x38, D.insects], ['Paintings', '🖼️', 0x55, D.paintings],
  ];

  function nib(s, base, i) { const b = s.u8(base + (i >> 1)); return i & 1 ? b >> 4 : b & 15; }
  function setNib(s, base, i, v) { const a = base + (i >> 1), b = s.u8(a); s.set8(a, i & 1 ? (b & 0x0F) | (v << 4) : (b & 0xF0) | v); }

  // =====================================================================================
  // Shop records, named in the decompilation (NookShop at 0x15DB4, AbleShop at 0x15F84). Dates are day, month, year.
  const NOOK = 0x15DB4, NOOK_BITS = NOOK + 0x5A, ABLE = 0x15F84;
  const STORES = [['Nook’s Cranny', 0x500D], ['Nook ’n’ Go', 0x500E], ['Nookway', 0x500F], ['Nookington’s', 0x5010]];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateText(s, o) { const [d, m, y] = s.bytes(o, 3); return m ? `${MONTHS[m - 1] || '?'} ${d}, 20${String(y).padStart(2, '0')}` : 'Not set'; }
  function dateEditor(s, o, refresh) {
    const f = (i, max) => numberInput(() => s.u8(o + i), v => { s.set8(o + i, v); refresh && refresh(); }, { max, width: 'w-s' });
    return h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, f(1, 12), '/', f(0, 31), '/', f(2, 99));
  }
  // ItemClassOrders (0x15FBC): one byte per item list (sItemPickLists order) choosing a weight order from
  // sItemClassWeightOrders, i.e. which of the classes A, B and C this town gets most (60), sometimes (30) and least (10).
  // Feng Shui in the east and south shifts the odds between them (ItemClassOrder::pickClass).
  const ORDERS = 0x15FBC;
  const ORDER_LISTS = ['Furniture', 'Stationery', 'Shirts', 'Carpets', 'Wallpaper', 'Accessories', 'Hats', 'Umbrellas', 'Full headwear'];
  const ORDER_NAMES = [[0, 'A most, then B, C rarest'], [1, 'A most, then C, B rarest'], [2, 'B most, then A, C rarest'], [3, 'B most, then C, A rarest'], [4, 'C most, then A, B rarest'], [5, 'C most, then B, A rarest']];
  // Stock slots with a "sold" toggle per slot (one bit each, StockList_*).
  function stock(s, base, count, soldAt) {
    return h('div', { class: 'slots' }, range(count).map(k => {
      const sold = (s.u8(soldAt + (k >> 3)) >> (k & 7)) & 1;
      const tag = h('button', { class: 'chip cat-chip' + (sold ? ' on' : ''), style: { marginTop: '4px', height: '22px', fontSize: '11px' }, title: 'Marked sold: the slot shows as empty in the shop',
        onclick: () => { s.set8(soldAt + (k >> 3), s.u8(soldAt + (k >> 3)) ^ (1 << (k & 7))); sfx.toggle(!sold); tag.classList.toggle('on'); tag.textContent = tag.classList.contains('on') ? 'Sold' : 'In stock'; } }, sold ? 'Sold' : 'In stock');
      return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } }, slot(() => s.u16(base + k * 2), v => s.set16(base + k * 2, v), { index: k }), tag);
    }));
  }
  window.ShopStock = { stock, dateText, dateEditor };

  VIEWS.push({
    id: 'nook', group: 'Places', icon: '🏪', title: () => 'Nook’s Shop', sub: () => 'Stock, sales and renovations',
    tips: ['Stock refreshes every day, so these edits last until tomorrow’s restock.', 'Bigger stores show more slots. Nook only displays as many as the store level allows.', 'Nook upgrades his store by himself once enough bells have been spent there.'],
    render(s, { refresh }) {
      const bits = s.u16(NOOK_BITS), level = (bits >> 9) & 3, saleHour = bits & 31;
      const setBits = (shift, width, v) => { const m = ((1 << width) - 1) << shift; s.set16(NOOK_BITS, (s.u16(NOOK_BITS) & ~m) | ((v << shift) & m)); refresh(); };
      let onMap = null;
      for (let i = 0; i < 4096 && onMap === null; i++) { const id = s.u16(0xC354 + i * 2); const k = STORES.findIndex(x => x[1] === id); if (k >= 0) onMap = k; }
      return [
        section('On the shelves', '37 slots · right-click to empty'),
        h('div', { class: 'card pad' }, stock(s, NOOK + 4, 37, NOOK + 0x5C)),
        section('The store'),
        card(
          row('Store size', `The game reads this from the store building on your map${onMap !== null ? ` (${STORES[onMap][0]})` : ''}. Nook rebuilds it himself, so it can’t be changed safely here.`, h('b', null, STORES[level][0]), NOOK_BITS),
          row('Bells spent at Nook’s', 'Running total that decides when Nook upgrades. Raise it, then buy something in-game to trigger the next upgrade.', numberInput(() => s.u32(NOOK), v => s.set32(NOOK, v), { max: 999999999 }), NOOK),
          row('Sale today', saleHour ? `Everything is on sale from ${saleHour}:00 until 23:00.` : 'No sale today.', numberInput(() => saleHour, v => setBits(0, 5, v), { max: 23, width: 'w-s', suffix: ':00' }), NOOK_BITS),
          row('Next paint color', 'Which roof paint Nook stocks next (cycles through the colors).', numberInput(() => (bits >> 5) & 15, v => setBits(5, 4, v), { max: 15, width: 'w-s' }), NOOK_BITS),
          row('Stock made on', dateText(s, NOOK + 0x4E), dateEditor(s, NOOK + 0x4E, refresh), NOOK + 0x4E),
          row('Restock at next update', 'When on, the shelves are replaced the next time the day changes.', UI.switchInput(() => s.u8(NOOK + 0x51), v => s.set8(NOOK + 0x51, v ? 1 : 0)), NOOK + 0x51),
          row('Point-special day', `${dateText(s, NOOK + 0x52)}. Nook Points count double on this day.`, dateEditor(s, NOOK + 0x52, refresh), NOOK + 0x52),
          row('Renovation', s.u8(NOOK + 0x59) ? `Closed for renovation, reopening ${dateText(s, NOOK + 0x56)}.` : 'No renovation scheduled.', h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, dateEditor(s, NOOK + 0x56, refresh), UI.switchInput(() => s.u8(NOOK + 0x59), v => { s.set8(NOOK + 0x59, v ? 1 : 0); refresh(); })), NOOK + 0x56, { risk: 'med', why: 'Scheduling a renovation without the game’s upgrade check can close the store with no new building.' }),
        ),
        section('Town rarity ranking', 'Which item classes this town sees most'),
        card(ORDER_LISTS.map((name, k) => row(name, k ? '' : 'Each town ranks the classes A, B and C in its own order. Feng Shui nudges the odds.', selectInput(ORDER_NAMES, () => s.u8(ORDERS + k) % 6, v => { s.set8(ORDERS + k, v); refresh(); }), ORDERS + k))),
      ];
    },
  });

  // =====================================================================================
  VIEWS.push({
    id: 'able', group: 'Places', icon: '🧵', title: () => 'Able Sisters', sub: () => 'Designs on display and today’s accessories',
    render(s, { refresh }) {
      const { patternEditor, patternTile } = window.PatternEditor;
      const open = window.__ableOpen || 0;
      return [
        section('Accessories for sale', `6 items · stocked ${dateText(s, ABLE + 0xC)}`),
        h('div', { class: 'card pad' }, stock(s, ABLE, 6, ABLE + 0x10)),
        card(
          row('Stock made on', dateText(s, ABLE + 0xC), dateEditor(s, ABLE + 0xC, refresh), ABLE + 0xC),
          row('Restock at next update', 'When on, the accessories are replaced the next time the day changes.', UI.switchInput(() => s.u8(ABLE + 0xF), v => s.set8(ABLE + 0xF, v ? 1 : 0)), ABLE + 0xF)),
        section('On display', '8 designs'),
        h('div', { class: 'card' }, h('div', { class: 'patterns' }, range(8).map(k => patternTile(s, 0xFAFC + k * 0x228, `Display ${k + 1}`, () => { window.__ableOpen = k; sfx.pop(); refresh(); })))),
        section(`Editing display ${open + 1}`), patternEditor(s, 0xFAFC + open * 0x228, { title: `Able Sisters display ${open + 1}` })];
    },
  });

  // =====================================================================================
  VIEWS.push({
    id: 'flag', group: 'Places', icon: '🚩', title: () => 'Town Flag & Blanca', sub: () => 'The flag over the town hall, and Blanca’s face',
    render(s, { refresh }) {
      const { patternEditor } = window.PatternEditor;
      const which = window.__flagOpen || 'flag';
      const tabs = h('div', { class: 'tabs' }, [['flag', '🚩 Town flag'], ['blanca', '🐱 Blanca’s face']].map(([id, l]) => h('button', { class: 'tab' + (which === id ? ' on' : ''), onclick: () => { window.__flagOpen = id; sfx.click(); refresh(); } }, l)));
      return [tabs, which === 'flag'
        ? patternEditor(s, 0x15930, { title: 'Town flag' })
        : [patternEditor(s, 0x15700, { title: 'Blanca’s face' }), h('div', { class: 'muted', style: { marginTop: '10px', fontSize: '12px' } }, 'Blanca is the faceless cat who visits on April Fools’ Day and asks you to draw her a face.')]];
    },
  });

  // =====================================================================================
  VIEWS.push({
    id: 'hall', group: 'Places', icon: '🏢', title: () => 'Town Hall', sub: () => 'Lost & found and the recycling bin',
    render(s) {
      return [section('Lost & found', '15 items Pelly or Phyllis are holding'),
        h('div', { class: 'card' }, h('div', { class: 'slots' }, range(15).map(k => slot(() => s.u16(0x15EC0 + k * 2), v => s.set16(0x15EC0 + k * 2, v), { index: k })))),
        section('Recycling bin', '15 items anyone can take'),
        h('div', { class: 'card' }, h('div', { class: 'slots' }, range(15).map(k => slot(() => s.u16(0x15EDE + k * 2), v => s.set16(0x15EDE + k * 2, v), { index: k }))))];
    },
  });
})();
