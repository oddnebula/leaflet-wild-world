// In-game style room renderer shared by the house and neighbor home views.
(function () {
  'use strict';
  const { h, item, itemIcon, itemEmoji, itemLabel } = UI;
  // In the game every piece of furniture has the same pocket icon (a leaf), so rooms show each piece's own symbol.
  const roomIcon = id => (item(id).cat === 'Furniture' ? itemEmoji(id) : itemIcon(id));

  // Wallpaper and flooring colors guessed from their names, so rooms look roughly like the game.
  const WORDS = [
    [/tatami|straw|bamboo|ramen/i, '#c9b37a'], [/log|cabin|ranch|wood|lodge|parquet|plank|board|bamboo|bark|cork|deck/i, '#b9844f'],
    [/stone|rock|concrete|cement|marble|slate|tile|cobble|brick|castle|ruin/i, '#a7aeb3'], [/ocean|sea|sky|aqua|water|wave|blue|azure|ice|snow|frozen/i, '#7cc6ea'],
    [/forest|jungle|garden|lawn|grass|green|leaf|meadow|ivy|moss|mint|lime/i, '#79c27d'], [/desert|sand|sahara|beach|tan|beige|cream|ivory/i, '#e6cf98'],
    [/night|space|lunar|moon|star|cosmic|galaxy|black|dark|shadow|spooky/i, '#363d6e'], [/red|cherry|rose|crimson|ruby|fire/i, '#e06b6b'],
    [/pink|blossom|sakura|heart|lovely|princess/i, '#f2a6c6'], [/purple|violet|lavender|plum|grape|regal/i, '#a888d8'],
    [/orange|pumpkin|autumn|maple|sunset/i, '#f0a25a'], [/yellow|lemon|gold|sunny|banana/i, '#f2d35b'], [/white|chic|clean|lab|hospital|plaster|paper/i, '#f1efe8'],
    [/gray|grey|silver|steel|metal|industrial|robo/i, '#9aa0a6'], [/brown|chocolate|coffee|mocha|rustic/i, '#9c6b45'], [/checker|kitchen|diner/i, '#e9e2d0'],
  ];
  function colorFor(id, fallbackHue) {
    if (id === 0xFFF1 || id === undefined) return null;
    const name = item(id).name;
    for (const [re, c] of WORDS) if (re.test(name)) return c;
    let hsh = fallbackHue || 0; for (const ch of name) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${hsh % 360} 45% 72%)`;
  }
  window.WW_ROOM_COLOR = colorFor;

  const ARROW = ['↓', '→', '↑', '←'];

  // opts: { cols, rows, area:{x,y,w,h}, wall, floor, cell(x,y) -> {main, top}, onCell(x,y,e), onMove(from,to,copy), showOutside, title, locked }
  function room(opts) {
    const { area } = opts;
    const wallC = colorFor(opts.wall) || '#e9dcc0', floorC = colorFor(opts.floor, 90) || '#d9c39a';
    const x0 = opts.showOutside ? 0 : area.x, y0 = opts.showOutside ? 0 : area.y;
    const w = opts.showOutside ? opts.cols : area.w, hgt = opts.showOutside ? opts.rows : area.h;
    const grid = h('div', { class: 'rm-floor', style: { gridTemplateColumns: `repeat(${w}, 1fr)`, '--floor': floorC } });
    let dragFrom = null;
    for (let y = y0; y < y0 + hgt; y++) for (let x = x0; x < x0 + w; x++) {
      const inside = x >= area.x && x < area.x + area.w && y >= area.y && y < area.y + area.h;
      const c = opts.cell(x, y) || {};
      const main = c.main, top = c.top;
      const it = main !== undefined && main !== 0xFFF1 ? item(main) : null;
      const occupied = it && it.cat === 'Occupied Space';
      const el = h('button', {
        class: 'rm-cell' + (inside ? '' : ' outside') + (((x + y) & 1) ? ' alt' : '') + (it && !occupied ? ' has' : '') + (occupied ? ' occ' : ''),
        title: [it ? itemLabel(main) : 'Empty floor', top !== undefined && top !== 0xFFF1 ? `On top: ${itemLabel(top)}` : null, `(${x}, ${y})`].filter(Boolean).join(' · '),
        draggable: it && !occupied ? 'true' : null,
      },
        it && !occupied ? h('span', { class: 'rm-item' }, roomIcon(main)) : null,
        it && it.rotation !== undefined ? h('span', { class: 'rm-rot' }, ARROW[it.rotation]) : null,
        top !== undefined && top !== 0xFFF1 ? h('span', { class: 'rm-top' }, roomIcon(top)) : null);
      el.addEventListener('click', e => opts.onCell(x, y, e));
      el.addEventListener('contextmenu', e => { e.preventDefault(); opts.onCell(x, y, e, true); });
      el.addEventListener('dragstart', e => { dragFrom = [x, y]; e.dataTransfer.effectAllowed = 'copyMove'; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', e => { if (dragFrom && opts.onMove) { e.preventDefault(); el.classList.add('drop'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('drop'); if (dragFrom && opts.onMove) opts.onMove(dragFrom, [x, y], e.altKey); dragFrom = null; });
      grid.append(el);
    }
    return h('div', { class: 'rm' + (opts.locked ? ' locked' : ''), style: { maxWidth: Math.min(620, w * 58 + 36) + 'px' } },
      h('div', { class: 'rm-back', style: { '--wall': wallC } }, h('div', { class: 'rm-window' }), opts.title ? h('div', { class: 'rm-title' }, opts.title) : null),
      h('div', { class: 'rm-body', style: { '--wall': wallC } }, h('div', { class: 'rm-side l' }), grid, h('div', { class: 'rm-side r' })),
      h('div', { class: 'rm-front' }, h('div', { class: 'rm-door' })),
      opts.locked ? h('div', { class: 'rm-lock' }, '🔒 ', opts.locked) : null);
  }
  window.RoomView = { room, colorFor };
})();
