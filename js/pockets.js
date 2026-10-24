// In-game style pocket screen: the resident in their outfit, 15 pockets, 10 letters, wallet, bed and pocket background.
// Player offsets: pockets 0x1B22, letters 0x1148 (0xF4 each), wallet 0x1B40, held 0x220A, shirt 0x220C, hat 0x220E,
// face item 0x2210, bed 0x2212, pocket background (a shirt) 0x2214, face/hair 0x223C, hair colour/tan 0x223D.
(function () {
  'use strict';
  const { h, fmt, sfx, toast, item, itemIcon, itemLabel, pickItem, selectInput, numberInput } = UI;
  const D = window.WW_DATA;
  const range = n => [...Array(n).keys()];
  const EMPTY = 0xFFF1;
  const HAIR = ['#5b3a1e', '#a8743f', '#e9822e', '#4f7fd9', '#f1cf3c', '#5cbf5a', '#f08bb8', '#f4f1ea'];
  const SKIN = ['#ffe3c7', '#f7d2ab', '#efc194', '#e2ad7c', '#d49a68', '#c38557', '#ae7046', '#975c39'];
  const TANS = ['No tan', 'Tan level 1', 'Tan level 2', 'Tan level 3', 'Tan level 4', 'Tan level 5', 'Tan level 6', 'Tan level 7'];

  // A CSS background that looks like the shirt: its colour from the name, its print from words like "dot" or "stripe".
  function shirtLook(id) {
    if (id === EMPTY) return { background: '#f4efe2' };
    const name = item(id).name || '';
    const c = window.RoomView.colorFor(id) || '#7cc6ea';
    const light = 'rgba(255,255,255,.75)', dark = 'rgba(0,0,0,.14)';
    if (/dot|polka|spot|bubble/i.test(name)) return { background: `radial-gradient(circle, ${light} 22%, transparent 24%) 0 0 / 14px 14px, ${c}` };
    if (/star|flower|heart|snow|leaf|petal/i.test(name)) return { background: `radial-gradient(circle, ${light} 14%, transparent 16%) 0 0 / 12px 12px, radial-gradient(circle, ${light} 14%, transparent 16%) 6px 6px / 12px 12px, ${c}` };
    if (/stripe|striped|border|bar|sailor|rugby|zebra/i.test(name)) return { background: `repeating-linear-gradient(0deg, ${c} 0 7px, ${light} 7px 11px)` };
    if (/check|plaid|gingham|tartan|grid|argyle|diamond/i.test(name)) return { background: `linear-gradient(90deg, ${dark} 50%, transparent 50%) 0 0 / 14px 14px, linear-gradient(${dark} 50%, transparent 50%) 0 0 / 14px 14px, ${c}` };
    return { background: c };
  }

  function avatar(s, b, refresh) {
    const hat = s.u16(b + 0x220E), face = s.u16(b + 0x2210), shirt = s.u16(b + 0x220C), held = s.u16(b + 0x220A);
    const hair = HAIR[s.bits(b + 0x223D, 0, 3)] || HAIR[0], skin = SKIN[s.bits(b + 0x223D, 3, 3)] || SKIN[0];
    const girl = s.u8(b + 0x228A) === 1;
    const pick = (o, title, categories) => async e => {
      e.stopPropagation(); sfx.pop();
      const v = await pickItem(s.u16(b + o), { title, categories });
      if (v !== null && v !== undefined) { s.set16(b + o, v); sfx.bell(); refresh(); }
    };
    const clear = o => e => { e.preventDefault(); s.set16(b + o, EMPTY); sfx.toggle(false); refresh(); };
    const zone = (cls, o, title, cats, label, content) => {
      const el = h('button', { class: 'av-zone ' + cls, title: `${label}: ${itemLabel(s.u16(b + o))} · click to change, right-click to remove`, 'aria-label': `${label}: ${itemLabel(s.u16(b + o))}`, onclick: pick(o, title, cats) }, content);
      el.addEventListener('contextmenu', clear(o));
      return el;
    };
    return h('div', { class: 'av', style: { '--hair': hair, '--skin': skin } },
      h('div', { class: 'av-shadow' }),
      h('div', { class: 'av-legs' }, h('i'), h('i')),
      zone('av-shirt', 0x220C, 'Choose a shirt', ['Shirts'], 'Shirt', h('div', { class: 'av-shirt-fill', style: shirtLook(shirt) })),
      h('div', { class: 'av-arm l', style: shirtLook(shirt) }), h('div', { class: 'av-arm r', style: shirtLook(shirt) }),
      h('div', { class: 'av-head' }, h('div', { class: 'av-hair' + (girl ? ' girl' : '') }), h('div', { class: 'av-eyes' }, h('i'), h('i')), h('div', { class: 'av-cheeks' }, h('i'), h('i'))),
      zone('av-hat', 0x220E, 'Choose a hat', ['Hats', 'Custom Hats'], 'Hat', hat === EMPTY ? h('span', { class: 'av-ghost' }, '+ hat') : h('span', null, itemIcon(hat))),
      zone('av-face', 0x2210, 'Choose glasses or a mask', ['Glasses/Masks'], 'Face accessory', face === EMPTY ? h('span', { class: 'av-ghost' }, '+') : h('span', null, itemIcon(face))),
      zone('av-held', 0x220A, 'Choose something to hold', ['Tools', 'Umbrellas', 'Held Items'], 'Holding', held === EMPTY ? h('span', { class: 'av-ghost' }, '+') : h('span', null, itemIcon(held))));
  }

  // The resident's look as the game builds it (see Model3D.playerMesh). Custom-design shirts and hats use the
  // resident's own patterns (items 0x13A0–0x13A7 and 0x1429–0x1430 point at design slots).
  function lookOf(s, b) {
    const shirt = s.u16(b + 0x220C), hat = s.u16(b + 0x220E);
    const design = id => (id >= 0x1429 && id <= 0x1430 ? id - 0x1429 : id >= 0x13A0 && id <= 0x13A7 ? id - 0x13A0 : -1);
    const look = { girl: s.u8(b + 0x228A) === 1, face: s.bits(b + 0x223C, 0, 4), hairstyle: s.bits(b + 0x223C, 4, 4), hairColor: s.bits(b + 0x223D, 0, 3), tan: s.bits(b + 0x223D, 3, 3), shirt, hat, glasses: s.u16(b + 0x2210), held: s.u16(b + 0x220A) };
    if (design(shirt) >= 0) look.shirtTex = Model3D.patternTex(s, b + design(shirt) * 0x228);
    if (design(hat) >= 0) look.hatTex = Model3D.patternTex(s, b + design(hat) * 0x228);
    if (design(look.held) >= 0) look.heldTex = Model3D.patternTex(s, b + design(look.held) * 0x228);
    return look;
  }
  function player3D(s, b, size) {
    if (!window.ROM || !ROM.ready || !window.Model3D) return null;
    const groups = Model3D.playerMesh(lookOf(s, b));
    return groups && groups.length ? Model3D.viewer(groups, { size, yaw: 0.25 }) : null;
  }
  function outfitRow(s, b, refresh) {
    const slotOf = (label, o, cats) => h('div', { class: 'pk-extra' }, h('span', null, label), UI.slot(() => s.u16(b + o), v => { s.set16(b + o, v); sfx.wear(); refresh(); }, { title: label, categories: cats, emptyLabel: 'Nothing' }));
    return h('div', { class: 'pk-extras' }, slotOf('🎩 Hat', 0x220E, ['Hats', 'Custom Hats']), slotOf('👓 Glasses', 0x2210, ['Glasses/Masks']), slotOf('👕 Shirt', 0x220C, ['Shirts']), slotOf('🪓 Holding', 0x220A, ['Tools', 'Umbrellas', 'Held Items']));
  }

  function letterPresent(s, o) { for (let i = 0; i < 0x16; i++) if (s.u8(o + i)) return true; return false; }

  function screen(s, p, b, refresh) {
    const name = s.str(b + 0x2282, 8) || 'Resident';
    const bg = s.u16(b + 0x2214);
    const pockets = h('div', { class: 'pk-grid' }, range(15).map(k => {
      const el = UI.slot(() => s.u16(b + 0x1B22 + k * 2), v => { s.set16(b + 0x1B22 + k * 2, v); refresh(); }, { index: k });
      el.classList.add('pk-slot');
      return el;
    }));
    const letters = h('div', { class: 'pk-letters' }, range(10).map(k => {
      const o = b + 0x1148 + k * 0xF4, has = letterPresent(s, o), from = s.str(o + 0x28, 8);
      return h('button', { class: 'pk-letter' + (has ? ' has' : ''), title: has ? `Letter ${k + 1}${from ? ' from ' + from : ''} · click to read or edit` : `Letter slot ${k + 1} is empty`,
        onclick: () => { (window.__openMail ||= {})[p] = 'pocket' + k; UI.setTab('player' + p, 'mail'); sfx.pop(); refresh(); } }, has ? '✉️' : '');
    }));
    const wallet = s.u32(b + 0x1B40);
    const walletInput = numberInput(() => s.u32(b + 0x1B40), v => { s.set32(b + 0x1B40, v); refresh(); }, { max: 99999, width: 'w-m' });
    const bed = UI.slot(() => s.u16(b + 0x2212), v => { s.set16(b + 0x2212, v); refresh(); }, { title: 'Choose a bed', emptyLabel: 'No bed' });
    const bgSlot = UI.slot(() => s.u16(b + 0x2214), v => { s.set16(b + 0x2214, v); refresh(); }, { title: 'Pocket background (a shirt)', categories: ['Shirts'], emptyLabel: 'Default' });
    const extras = h('div', { class: 'pk-extras' },
        h('label', { class: 'pk-extra' }, h('span', null, '🔔 Wallet'), walletInput, h('button', { class: 'btn small bell', onclick: () => { s.set32(b + 0x1B40, 99999); sfx.bell(); toast('Wallet: 99,999 bells', '🔔'); refresh(); } }, 'Max')),
        h('div', { class: 'pk-extra' }, h('span', null, '🛏️ Bed'), bed),
        h('div', { class: 'pk-extra' }, h('span', null, '🖼️ Pocket background'), bgSlot));
    const art = window.ROM && ROM.ready && ROM.screenURL('menu/inventory/b_itm_bg_a.bsc', 'menu/inventory/b_itm0.bch', 'menu/inventory/b_itm.bpl');
    if (art) return romScreen(s, p, b, refresh, art, name, wallet, extras);
    return h('div', { class: 'pk-ds' },
      h('div', { class: 'pk-screen', style: bg === EMPTY ? null : { '--pk-bg': shirtLook(bg).background } },
        h('div', { class: 'pk-top' }, h('span', { class: 'pk-name' }, `${name}’s pockets`), h('span', { class: 'pk-bells', title: 'Wallet' }, '🔔 ', fmt(wallet))),
        h('div', { class: 'pk-body' },
          h('div', { class: 'pk-left' }, avatar(s, b, refresh), h('div', { class: 'pk-hint' }, 'Tap the hat, glasses, shirt or hand')),
          h('div', { class: 'pk-right' }, pockets, h('div', { class: 'pk-label' }, 'Letters'), letters))),
      extras);
  }

  // The game's own pocket screen (menu/inventory from the player's ROM), with live slots placed exactly where the game
  // draws them (positions read from the screen's tile map, in 256×192 DS pixels).
  const POCKET_XY = [[20, 116], [52, 116], [84, 116], [116, 116], [148, 116], [36, 140], [68, 140], [100, 140], [132, 140], [164, 140], [52, 164], [84, 164], [116, 164], [148, 164], [180, 164]];
  const LETTER_XY = [68, 92, 116, 140, 164].flatMap(y => [[212, y], [236, y]]);
  function romScreen(s, p, b, refresh, art, name, wallet, extras) {
    const back = ROM.screenURL('menu/inventory/b_itm_back.bsc', 'menu/inventory/b_itm0.bch', 'menu/inventory/b_itm.bpl');
    const at = (x, y, cls, ...kids) => h('div', { class: 'pkr-at ' + cls, style: { '--x': x, '--y': y } }, ...kids);
    const pockets = POCKET_XY.map(([x, y], k) => {
      const el = UI.slot(() => s.u16(b + 0x1B22 + k * 2), v => { s.set16(b + 0x1B22 + k * 2, v); refresh(); }, { index: k });
      el.classList.add('pkr-slot');
      return at(x, y, 'pkr-pocket', el);
    });
    const letters = LETTER_XY.map(([x, y], k) => {
      const o = b + 0x1148 + k * 0xF4, has = letterPresent(s, o), from = s.str(o + 0x28, 8);
      return at(x, y, 'pkr-letter', h('button', { class: 'pkr-env' + (has ? ' has' : ''), title: has ? `Letter ${k + 1}${from ? ' from ' + from : ''} · click to read or edit` : `Letter slot ${k + 1} is empty`,
        onclick: () => { (window.__openMail ||= {})[p] = 'pocket' + k; UI.setTab('player' + p, 'mail'); sfx.page(); refresh(); } }, has ? (UI.itemIcon(0x1000) || '✉️') : ''));
    });
    const screenEl = h('div', { class: 'pkr', style: { backgroundImage: `url(${art}), url(${back})` } },
        at(60, 46, 'pkr-name', h('span', null, name), h('small', null, s.str(b + 0x2278, 8))),
        at(78, 88, 'pkr-bells', fmt(wallet)),
        at(152, 64, 'pkr-portrait', player3D(s, b, 210) || avatar(s, b, refresh)),
        ...pockets, ...letters);
    // The avatar is drawn in CSS pixels, so give it the screen's scale as a plain number.
    if (window.ResizeObserver) new ResizeObserver(([e]) => screenEl.style.setProperty('--k', (e.contentRect.width / 256).toFixed(3))).observe(screenEl);
    return h('div', null,
      h('div', { class: 'pkr-wrap' }, screenEl),
      h('div', { class: 'pk-hint', style: { marginTop: '6px' } }, 'The pocket screen and your resident, drawn from your ROM · drag to turn them'),
      outfitRow(s, b, refresh),
      extras);
  }

  function looks(s, b, refresh) {
    const opts = list => list.map((n, i) => [i, n]);
    const field = (label, ctl) => h('label', { class: 'pk-look' }, h('span', null, label), ctl);
    return h('div', { class: 'card pad pk-looks' },
      field('Hairstyle', selectInput(opts(D.hairstyles), () => s.bits(b + 0x223C, 4, 4), v => { s.setBits(b + 0x223C, 4, 4, v); refresh(); }, { width: 'w-m' })),
      field('Hair color', h('div', { class: 'pk-swatches' }, D.hairColors.map((n, i) => h('button', { class: 'pk-swatch' + (s.bits(b + 0x223D, 0, 3) === i ? ' on' : ''), style: { background: HAIR[i] }, title: n, 'aria-label': n, onclick: () => { s.setBits(b + 0x223D, 0, 3, i); sfx.pop(); refresh(); } })))),
      field('Face', selectInput(opts(D.faces), () => s.bits(b + 0x223C, 0, 4), v => { s.setBits(b + 0x223C, 0, 4, v); refresh(); }, { width: 'w-m' })),
      field('Suntan', h('div', { class: 'pk-swatches' }, TANS.map((n, i) => h('button', { class: 'pk-swatch' + (s.bits(b + 0x223D, 3, 3) === i ? ' on' : ''), style: { background: SKIN[i] }, title: n, 'aria-label': n, onclick: () => { s.setBits(b + 0x223D, 3, 3, i); sfx.pop(); refresh(); } })))),
      field('Gender', UI.seg([[0, '👦 Boy'], [1, '👧 Girl']], () => s.u8(b + 0x228A), v => { s.set8(b + 0x228A, v); refresh(); })));
  }

  window.PocketScreen = { screen, looks, shirtLook, player3D, lookOf };
})();
