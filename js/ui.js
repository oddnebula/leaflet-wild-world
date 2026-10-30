// Shared UI kit: element builder, item catalogue, bound form rows, picker, sound, guide, toasts.
(function () {
  // Shortcut labels: ⌘ on a Mac, Ctrl+ everywhere else.
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
  'use strict';
  const D = window.WW_DATA;

  // replaceChildren() would render null/false as text; skip them like h() does.
  const nativeReplace = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) { return nativeReplace.apply(this, kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false)); };

  // ---------- element builder ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const hex = (n, w = 4) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');
  const fmt = n => n.toLocaleString('en-US');

  // ---------- items ----------
  const ITEM = new Map();
  const CAT_EMOJI = {
    'Flowers': '🌷', 'Weeds': '🌿', 'Trees': '🌳', 'Special Trees': '🌲', 'Parched Flowers': '🥀', 'Watered Flowers': '💧',
    'Fake Buried Spot #1': '✖️', 'Fake Buried Spot #2': '✖️', 'Patterns': '🎨', 'Palm Trees': '🌴', 'Buried Turnips': '🥬',
    'Rocks': '🪨', 'Unused Rocks': '🪨', 'Special Stumps': '🪵', 'Stationary': '✉️', 'Wallpaper': '🧱', 'Carpets': '🟫',
    'Shirts': '👕', 'Insects': '🦋', 'Fish': '🐟', 'Garbage': '🥫', 'Songs': '🎵', 'Tools': '🛠️', 'Held Items': '🎈',
    'Umbrellas': '☂️', 'Hats': '🎩', 'Custom Hats': '🧢', 'Glasses/Masks': '👓', 'Bells': '💰', 'Flower Bags': '🌱',
    'Fruit': '🍎', 'Saplings': '🌱', 'Note in a Bottle': '🍾', 'Paint': '🖌️', 'Turnips': '🥬', 'Acorns': '🌰', 'Misc.': '📦',
    'Fossil': '🦴', 'Spoiled Turnips': '🥀', 'Sea Shells': '🐚', 'Lost Item': '🎁', 'Items': '🎁', 'Furniture': '🛋️',
    'Buildings': '🏠', 'Snowmen': '☃️', 'Occupied Space': '⬛', 'Empty': '·',
  };
  const CRITTER_EMOJI = [
    [/bee$/i, '🐝'], [/^ant$/i, '🐜'], [/ladybug/i, '🐞'], [/tarantula|spider/i, '🕷️'], [/scorpion/i, '🦂'], [/mosquito/i, '🦟'], [/^fly$/i, '🪰'],
    [/cockroach/i, '🪳'], [/snail/i, '🐌'], [/cricket|locust|grasshopper|mantis|cicada|walkingstick/i, '🦗'], [/firefly/i, '✨'],
    [/beetle|stag|dung/i, '🪲'], [/pill bug|flea|pondskater/i, '🐛'], [/dragonfly|lantern/i, '🪽'], [/butterfl|peacock|monarch|emperor|birdwing|moth/i, '🦋'],
    [/shark/i, '🦈'], [/octopus/i, '🐙'], [/squid/i, '🦑'], [/jellyfish|sea butterfly/i, '🪼'], [/crawfish/i, '🦞'], [/frog/i, '🐸'],
    [/puffer/i, '🐡'], [/seahorse|clown|angel|guppy|zebra|turkeyfish|goldfish|koi/i, '🐠'], [/coelacanth|arapaima|arowana|dorado|gar$/i, '🐉'],
  ];
  const NAME_EMOJI = [
    [/apple/i, '🍎'], [/orange/i, '🍊'], [/pear/i, '🍐'], [/peach/i, '🍑'], [/cherr/i, '🍒'], [/coconut/i, '🥥'],
    [/rod/i, '🎣'], [/net/i, '🥅'], [/axe/i, '🪓'], [/shovel/i, '⛏️'], [/watering/i, '🚿'], [/slingshot/i, '🏹'],
    [/bell bag|bells/i, '💰'], [/oid$/i, '🔔'], [/painting/i, '🖼️'], [/skull|torso|tail|wing|neck|chest|hip|amber|ammonite|trilobite|fossil|egg|track|droppings|tooth|archaeopteryx|peking/i, '🦴'],
    [/bed/i, '🛏️'], [/chair|sofa|couch|bench|stool/i, '🪑'], [/table|desk|counter/i, '🍽️'], [/lamp|light/i, '💡'],
    [/clock/i, '🕰️'], [/tv|television/i, '📺'], [/stereo|radio|phonograph|jukebox|deck/i, '📻'], [/plant|bonsai|cactus|tree|fern|gerbera|azalea/i, '🪴'],
    [/rug/i, '🟫'], [/umbrella|parasol/i, '☂️'], [/cap|hat|helmet|crown/i, '🎩'], [/glasses|goggles|mask/i, '👓'], [/shirt|uniform|tee|knit|dress|coat|suit|robe|kimono/i, '👕'],
    [/pitfall/i, '🕳️'], [/present|gift/i, '🎁'], [/turnip/i, '🥬'], [/sapling/i, '🌱'], [/paper/i, '✉️'], [/fish|bass|carp|koi|eel|shark|tuna|salmon|trout/i, '🐟'],
  ];
  let lastCat = '';
  for (const [id, name, cat] of D.items) { ITEM.set(id, { id, name, cat }); lastCat = cat; }
  const CATEGORIES = [...new Set(D.items.map(i => i[2]))];

  function item(id) {
    let it = ITEM.get(id);
    if (!it && id >= 0x3000 && id < 0x5000) {
      const base = ITEM.get(id & 0xFFFC);
      if (base) it = { ...base, id, rotation: id & 3 };
    }
    // 0xF031 marks the other tiles of a 2-tile or 4-tile piece of furniture (FtrSync_PlaceFurniture).
    if (!it && id === 0xF031) it = { id, name: 'Occupied Space (part of a larger piece)', cat: 'Occupied Space' };
    if (!it) it = { id, name: id === 0xFFF1 ? 'Empty' : 'Unknown item', cat: id === 0xFFF1 ? 'Empty' : '?' };
    return it;
  }
  // The game's own pocket icon when the player has loaded their ROM, otherwise an emoji.
  function itemIcon(id) {
    const url = window.ROM && ROM.iconURL(id);
    return url ? h('img', { class: 'gi', src: url, alt: '', draggable: 'false' }) : itemEmoji(id);
  }
  function itemEmoji(id) {
    const it = item(id);
    if (id === 0xFFF1) return '·';
    if (it.cat === 'Insects' || it.cat === 'Fish') { for (const [re, em] of CRITTER_EMOJI) if (re.test(it.name)) return em; }
    if (['Furniture', 'Items', 'Tools', 'Fruit', 'Misc.', 'Bells', 'Glasses/Masks', 'Hats', 'Shirts'].includes(it.cat)) {
      for (const [re, em] of NAME_EMOJI) if (re.test(it.name)) return em;
    }
    return CAT_EMOJI[it.cat] || '❓';
  }
  const ROT = ['facing down', 'facing right', 'facing up', 'facing left'];
  function itemLabel(id) {
    const it = item(id);
    return it.rotation !== undefined && it.rotation ? `${it.name} (${ROT[it.rotation]})` : it.name;
  }

  // ---------- sound (tiny synth, no assets) ----------
  let audio = null, soundOn = true;
  try { soundOn = localStorage.getItem('leaflet.sound') !== 'off'; } catch (e) { /* storage unavailable */ }
  function ctx() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { soundOn = false; } }
    return audio;
  }
  function tone(freq, dur = 0.08, type = 'sine', vol = 0.06, when = 0, slide = 0) {
    if (!soundOn) return;
    const a = ctx(); if (!a) return;
    const t = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  // The game's own sound effects when the player has loaded their ROM (ids from the decompilation: Snd_PlaySe);
  // otherwise a tiny synth.
  const game = id => soundOn && window.GameSound && GameSound.ready() && GameSound.play(id);
  const sfx = {
    click() { game(0x0B) || tone(880, 0.05, 'triangle', 0.035); },                       // cursor move
    pop() { game(0x0C) || tone(520, 0.09, 'sine', 0.06, 0, 1.8); },                       // touch an item
    toggle(on) { game(on ? 0x41 : 0x42) || tone(on ? 660 : 440, 0.07, 'triangle', 0.05, 0, on ? 1.3 : 0.8); },
    bell() { game(0x3E) || [1318, 1760, 2637].forEach((f, i) => tone(f, 0.35, 'sine', 0.04, i * 0.06)); },   // wallet bells
    save() { game(0x27) || [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.05, i * 0.09)); }, // confirm
    error() { game(0x34) || tone(220, 0.18, 'square', 0.03, 0, 0.7); },
    open() { game(0x13) || tone(700, 0.06, 'triangle', 0.04, 0, 1.4); },                 // popup opens
    close() { game(0x14) || tone(600, 0.06, 'triangle', 0.04, 0, 0.7); },
    tab() { game(0x02) || tone(760, 0.05, 'triangle', 0.035); },                          // tab bar
    pickup() { game(0x0D) || tone(620, 0.06, 'sine', 0.05, 0, 1.3); },
    putdown() { game(0x0E) || tone(480, 0.06, 'sine', 0.05, 0, 0.8); },
    cancel() { game(0x2A) || tone(400, 0.08, 'triangle', 0.04, 0, 0.8); },
    page() { game(0x39) || tone(900, 0.04, 'triangle', 0.03); },
    paint() { game(0x861) || tone(1200, 0.02, 'square', 0.015); },
    wear() { game(0x6B) || tone(660, 0.12, 'sine', 0.05, 0, 1.5); },
    place() { game(0x73) || tone(500, 0.08, 'sine', 0.05, 0, 0.9); },
    // Animalese-style babble: one short blip per letter, pitch from the letter.
    babble(text) {
      const letters = text.replace(/[^a-z]/gi, '').slice(0, 42);
      if (window.GameSound && GameSound.ready() && soundOn && window.GameVoice) return GameVoice.say(letters);
      [...letters].forEach((ch, i) => {
        const k = ch.toLowerCase().charCodeAt(0) - 97;
        tone(420 + (k % 9) * 38 + (i % 3) * 14, 0.045, 'square', 0.018, i * 0.045);
      });
      return letters.length * 45;
    },
  };
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem('leaflet.sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  }

  // ---------- guide ----------
  let guideTimer = null;
  function say(text, opts = {}) {
    const bubble = document.getElementById('guideBubble'), sprout = document.getElementById('guideSprout');
    if (!bubble) return;
    bubble.replaceChildren(h('button', { class: 'x', 'aria-label': 'Dismiss', onclick: () => bubble.classList.remove('show') }, '✕'),
      h('span', { class: 'who' }, 'SPROUT'), text);
    bubble.classList.add('show');
    const ms = opts.quiet ? 0 : sfx.babble(text);
    sprout.classList.add('talk');
    setTimeout(() => sprout.classList.remove('talk'), Math.max(500, ms));
    clearTimeout(guideTimer);
    guideTimer = setTimeout(() => bubble.classList.remove('show'), opts.ms || Math.max(4500, text.length * 55));
  }

  // ---------- toasts & confetti ----------
  function toast(text, emoji = '🍃') {
    const t = h('div', { class: 'toast' }, h('span', null, emoji), text);
    document.getElementById('toasts').append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 2600);
  }
  function confetti(n = 26) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bits = ['🍃', '🍂', '🌸', '⭐', '🔔', '🍀'];
    for (let i = 0; i < n; i++) {
      const c = h('div', { class: 'confetti', style: { left: Math.random() * 100 + 'vw', animationDuration: 1.8 + Math.random() * 1.8 + 's', animationDelay: Math.random() * 0.4 + 's', fontSize: 14 + Math.random() * 16 + 'px' } }, bits[i % bits.length]);
      document.body.append(c);
      setTimeout(() => c.remove(), 4200);
    }
  }

  // ---------- search registry ----------
  const registry = [];
  let currentView = '', currentTab = null, serial = 0;
  function setRegistryView(v) { currentView = v; currentTab = null; }
  function setRegistryTab(t) { currentTab = t; }
  function register(row, label, desc) {
    if (!label) return;
    const id = 'opt-' + (serial++);
    row.id = id;
    registry.push({ id, view: currentView, tab: currentTab, label, desc: desc || '', text: (label + ' ' + (desc || '')).toLowerCase() });
  }
  // Tab state shared by tabbed views, so search results can open the right tab.
  const tabs = {};
  function tabOf(view, fallback) { return tabs[view] || fallback; }
  function setTab(view, t) { tabs[view] = t; }

  // ---------- form rows ----------
  // opts.risk: 'high' (can break the save) or 'med' (can confuse the game); shown as a badge with the reason.
  function row(label, desc, ctl, off, opts = {}) {
    const risk = opts.risk ? h('span', { class: 'badge ' + (opts.risk === 'high' ? 'danger' : 'warn'), title: opts.why || '' },
      opts.risk === 'high' ? '⚠ Can break your save' : '⚠ Use care') : null;
    const r = h('div', { class: 'row' + (opts.risk === 'high' ? ' risky' : '') },
      h('div', { class: 'row-label' },
        h('div', { class: 't' }, label, off !== undefined ? h('span', { class: 'off' }, hex(off, 5)) : null, risk ? ' ' : null, risk),
        desc ? h('div', { class: 'd' }, desc) : null,
        opts.why ? h('div', { class: 'd risk-why' }, opts.why) : null),
      h('div', { class: 'row-ctl' }, ctl));
    register(r, label, desc);
    return r;
  }
  // Wraps a setter so the first change to a risky field asks for confirmation (once per field per session).
  const confirmed = new Set();
  function guard(key, title, message, set) {
    return v => {
      if (confirmed.has(key)) { set(v); return; }
      confirmSheet(`⚠ ${title}`, message, 'I understand, change it').then(ok => {
        if (ok) { confirmed.add(key); set(v); } else if (window.APP) APP.go(APP.view);
      });
    };
  }
  function card(...rows) { return h('div', { class: 'card' }, rows); }
  function section(title, hint) { return h('div', { class: 'section-title' }, title, hint ? h('span', { class: 'hint' }, hint) : null); }

  function numberInput(get, set, { min = 0, max = 0xFFFFFFFF, step = 1, width = 'w-m', suffix } = {}) {
    const inp = h('input', { class: `field num ${width}`, type: 'number', min, max, step, value: get() });
    inp.addEventListener('change', () => {
      let v = Math.round(Number(inp.value));
      if (!Number.isFinite(v)) v = get();
      v = Math.min(max, Math.max(min, v));
      inp.value = v; set(v); sfx.click();
    });
    return suffix ? h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, inp, h('span', { class: 'muted' }, suffix)) : inp;
  }
  function textInput(get, set, max, { width = 'w-m', check } = {}) {
    const inp = h('input', { class: `field ${width}`, type: 'text', value: get(), maxlength: max, spellcheck: 'false' });
    inp.addEventListener('input', () => inp.classList.toggle('bad', check ? !check(inp.value) : false));
    inp.addEventListener('change', () => {
      if (check && !check(inp.value)) { sfx.error(); toast('That character isn’t in the game’s font', '⚠️'); return; }
      set(inp.value); sfx.click();
    });
    return inp;
  }
  function selectInput(options, get, set, { width = 'w-l' } = {}) {
    const sel = h('select', { class: `field ${width}` });
    const cur = get();
    let found = false;
    for (const [v, label] of options) {
      const o = h('option', { value: v }, label);
      if (v === cur) { o.selected = true; found = true; }
      sel.append(o);
    }
    if (!found) sel.prepend(h('option', { value: cur, selected: true }, `Other (${cur})`));
    sel.addEventListener('change', () => { set(Number(sel.value)); sfx.click(); });
    return sel;
  }
  function switchInput(get, set) {
    const inp = h('input', { type: 'checkbox' });
    inp.checked = !!get();
    inp.addEventListener('change', () => { set(inp.checked); sfx.toggle(inp.checked); });
    return h('label', { class: 'switch' }, inp, h('span'));
  }
  function seg(options, get, set) {
    const wrap = h('div', { class: 'seg' });
    const draw = () => wrap.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.v) === get()));
    for (const [v, label] of options) wrap.append(h('button', { 'data-v': v, onclick: () => { set(v); draw(); sfx.click(); } }, label));
    draw();
    return wrap;
  }
  function stepper(get, set, min, max) {
    const val = h('span', { class: 'mono', style: { minWidth: '28px', textAlign: 'center', fontWeight: 700 } }, get());
    const upd = d => { const v = Math.min(max, Math.max(min, get() + d)); set(v); val.textContent = v; sfx.click(); };
    return h('span', { class: 'stepper' }, h('button', { class: 'btn', onclick: () => upd(-1) }, '−'), val, h('button', { class: 'btn', onclick: () => upd(1) }, '+'));
  }

  // ---------- item slot + picker ----------
  function slot(get, set, opts = {}) {
    const el = h('button', { class: 'slot', title: '' });
    const draw = () => {
      const id = get();
      el.classList.toggle('empty', id === 0xFFF1);
      el.title = `${itemLabel(id)} · ${hex(id)}`;
      el.replaceChildren(
        opts.index !== undefined ? h('span', { class: 'ix' }, opts.index + 1) : null,
        h('span', { class: 'em' }, itemIcon(id)),
        h('span', { class: 'nm' }, id === 0xFFF1 ? (opts.emptyLabel || 'Empty') : itemLabel(id)),
        h('span', { class: 'hx' }, hex(id)));
    };
    el.addEventListener('click', async () => {
      sfx.pop();
      const v = await pickItem(get(), opts);
      if (v !== null && v !== undefined) { set(v); draw(); el.classList.remove('bounce'); void el.offsetWidth; el.classList.add('bounce'); sfx.bell(); }
    });
    el.addEventListener('contextmenu', e => { e.preventDefault(); set(0xFFF1); draw(); sfx.toggle(false); });
    draw();
    el.redraw = draw;
    return el;
  }

  let pickerCat = 'All';
  function pickItem(current, opts = {}) {
    return new Promise(resolve => {
      const root = document.getElementById('popover-root');
      let chosen = null;
      const close = v => { root.replaceChildren(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const search = h('input', { class: 'search', type: 'search', placeholder: 'Search 3,200+ items or type a hex ID (e.g. 1374)', autofocus: true });
      const chips = h('div', { class: 'cat-chips' });
      const list = h('div', { class: 'pick-list' });
      const raw = h('input', { class: 'field mono w-s', value: current.toString(16).toUpperCase().padStart(4, '0'), maxlength: 4, title: 'Any raw item ID, including unused ones' });
      const cats = ['All', ...(opts.categories || CATEGORIES)];
      if (!cats.includes(pickerCat)) pickerCat = 'All';
      let kb = 0, shown = [];
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        const hexq = /^(0x)?[0-9a-f]{1,4}$/i.test(q) ? parseInt(q.replace(/^0x/i, ''), 16) : null;
        shown = [];
        for (const it of ITEM.values()) {
          if (opts.filter && !opts.filter(it)) continue;
          if (pickerCat !== 'All' && it.cat !== pickerCat) continue;
          if (q && !(it.name.toLowerCase().includes(q) || (hexq !== null && it.id === hexq) || it.cat.toLowerCase().includes(q))) continue;
          shown.push(it);
          if (shown.length >= 400) break;
        }
        kb = Math.min(kb, Math.max(0, shown.length - 1));
        list.replaceChildren(...shown.map((it, i) => h('button', {
          class: 'pick' + (it.id === current ? ' cur' : '') + (i === kb ? ' kb' : ''),
          onclick: () => close(it.id), title: it.cat,
        }, h('span', { class: 'em' }, itemEmoji(it.id)), h('span', { class: 'nm' }, it.name), h('span', { class: 'hx' }, it.id.toString(16).toUpperCase().padStart(4, '0')))));
        if (!shown.length) list.append(h('div', { class: 'empty-note' }, h('span', { class: 'em' }, '🔍'), 'No items match. You can still enter a raw ID below.'));
        chips.querySelectorAll('.cat-chip').forEach(c => c.classList.toggle('on', c.dataset.c === pickerCat));
      };
      cats.forEach(c => chips.append(h('button', { class: 'cat-chip', 'data-c': c, onclick: () => { pickerCat = c; draw(); sfx.click(); } }, c === 'All' ? 'All' : `${CAT_EMOJI[c] || ''} ${c}`)));
      search.addEventListener('input', () => { kb = 0; draw(); });
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { kb = Math.min(shown.length - 1, kb + 1); draw(); e.preventDefault(); list.querySelector('.kb')?.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { kb = Math.max(0, kb - 1); draw(); e.preventDefault(); list.querySelector('.kb')?.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter' && document.activeElement === search && shown[kb]) { e.preventDefault(); close(shown[kb].id); }
      };
      document.addEventListener('keydown', onKey, true);
      root.replaceChildren(
        h('div', { class: 'scrim', onclick: () => close(null) }),
        h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Choose an item' },
          h('div', { class: 'sheet-head' },
            h('div', { class: 'top' }, h('h3', null, opts.title || 'Choose an item'), h('span', { class: 'muted' }, `Now: ${itemLabel(current)}`)),
            search, chips),
          h('div', { class: 'sheet-body' }, list),
          h('div', { class: 'sheet-foot' },
            h('span', { class: 'muted', style: { marginRight: 'auto', fontSize: '12px' } }, 'Right-click any slot to empty it'),
            h('span', { class: 'muted' }, 'Raw ID'), raw,
            h('button', { class: 'btn', onclick: () => { const v = parseInt(raw.value, 16); if (Number.isFinite(v)) close(v & 0xFFFF); } }, 'Use ID'),
            h('button', { class: 'btn', onclick: () => close(0xFFF1) }, 'Empty'),
            h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'))));
      draw();
      setTimeout(() => search.focus(), 30);
      void chosen;
    });
  }

  // ---------- small confirm sheet ----------
  function confirmSheet(title, body, okLabel = 'Do it') {
    return new Promise(resolve => {
      const root = document.getElementById('popover-root');
      const close = v => { root.replaceChildren(); resolve(v); };
      root.replaceChildren(h('div', { class: 'scrim', onclick: () => close(false) }),
        h('div', { class: 'sheet', style: { width: 'min(440px, calc(100vw - 32px))', top: '22vh' } },
          h('div', { class: 'sheet-head' }, h('div', { class: 'top' }, h('h3', null, title))),
          h('div', { class: 'sheet-body', style: { padding: '14px 16px', lineHeight: 1.5 } }, body),
          h('div', { class: 'sheet-foot' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'), h('button', { class: 'btn leaf', onclick: () => close(true) }, okLabel))));
    });
  }

  // ---------- pattern rendering ----------
  function drawPattern(canvas, save, off, scale = 1) {
    const pal = D.palettes[save.u8(off + 0x226) >> 4] || D.palettes[0];
    canvas.width = 32 * scale; canvas.height = 32 * scale;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 1024; i++) {
      const b = save.u8(off + (i >> 1));
      const c = i & 1 ? b >> 4 : b & 15;
      if (!c) continue;
      g.fillStyle = pal[c - 1];
      g.fillRect((i & 31) * scale, (i >> 5) * scale, scale, scale);
    }
  }

  // Words for how things are done here: tap and long-press on phones, click and right-click with a mouse.
  const PHONE = !!window.LEAFLET_PHONE;
  const WORDS = { click: PHONE ? 'tap' : 'click', Click: PHONE ? 'Tap' : 'Click', rclick: PHONE ? 'long-press' : 'right-click', here: PHONE ? 'this device' : 'this computer' };
  // Phones: a long press acts as a right-click (Android sends one; iPhones don't), so every right-click action works.
  if (PHONE) {
    let timer = null, start = null;
    addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { clearTimeout(timer); return; }
      const t = e.touches[0], target = e.target; start = [t.clientX, t.clientY];
      clearTimeout(timer);
      timer = setTimeout(() => { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start[0], clientY: start[1], button: 2 })); start = null; }, 550);
    }, { passive: true });
    addEventListener('touchmove', e => { const t = e.touches[0]; if (start && Math.hypot(t.clientX - start[0], t.clientY - start[1]) > 10) clearTimeout(timer); }, { passive: true });
    addEventListener('touchend', () => clearTimeout(timer), { passive: true });
    addEventListener('contextmenu', e => { if (!e.isTrusted) return; clearTimeout(timer); }, true);   // Android's own long press: don't send a second
  }
  window.UI = {
    h, hex, fmt, item, itemEmoji, itemIcon, itemLabel, CATEGORIES, CAT_EMOJI, sfx, tone, setSound, get soundOn() { return soundOn; },
    say, toast, confetti, registry, register, setRegistryView, setRegistryTab, tabOf, setTab, row, guard, card, section,
    mod: MOD, ...WORDS, numberInput, textInput, selectInput, switchInput, seg, stepper, slot, pickItem, confirmSheet, drawPattern,
  };
})();
