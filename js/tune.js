// Town tune composer. The tune is 16 nibbles packed into a u64 at 0x15FA8 (func_0206db34 in the decompilation).
// Stored values: 0-12 = low G up to high E, 13 = random note, 14 = hold the previous note, 15 = rest.
(function () {
  'use strict';
  const { h, sfx, toast } = UI;
  const TUNE = 0x15FA8;
  const NAMES = ['G', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'E'];
  const SEMI = [0, 2, 4, 5, 7, 9, 10, 12, 14, 16, 17, 19, 21];
  const COLORS = ['#e2574c', '#f08a3e', '#f2c230', '#9bcf3c', '#4fbf6a', '#3cb9b0', '#43a3e6', '#5a7be0', '#8f6ee0', '#c463d6', '#e65fa8', '#e2574c', '#f08a3e'];
  const RANDOM = 13, HOLD = 14, REST = 15;
  // Rows top to bottom, as in the game's editor: random, high E down to low G, hold, rest.
  const ROWS = [RANDOM, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, HOLD, REST];
  const freq = n => 392 * Math.pow(2, SEMI[n] / 12);

  function read(s) {
    const out = [];
    for (let i = 0; i < 8; i++) { const b = s.u8(TUNE + i); out.push(b & 0xF, b >> 4); }
    return out;
  }
  function write(s, notes) {
    for (let i = 0; i < 8; i++) s.set8(TUNE + i, (notes[i * 2] & 0xF) | ((notes[i * 2 + 1] & 0xF) << 4));
  }

  let playing = null;
  function play(notes, onStep) {
    if (playing) { clearTimeout(playing); playing = null; onStep(-1); return; }
    const STEP = 190;
    let prev = null, i = 0;
    const tick = () => {
      if (i >= notes.length) { playing = null; onStep(-1); return; }
      let n = notes[i];
      if (n === RANDOM) n = Math.floor(Math.random() * 13);
      if (n === HOLD) { /* the previous note keeps ringing */ } else if (n === REST) prev = null;
      else { prev = n; UI.tone(freq(n), 0.32, 'triangle', 0.07); UI.tone(freq(n) * 2, 0.18, 'sine', 0.02); }
      onStep(i++);
      playing = setTimeout(tick, STEP);
    };
    tick();
  }

  const PRESETS = [
    ['Clear', () => Array(16).fill(REST)],
    ['Scale up', () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, HOLD, HOLD, REST]],
    ['Twinkle', () => [3, 3, 7, 7, 8, 8, 7, HOLD, 6, 6, 5, 5, 4, 4, 3, HOLD]],
    ['Doorbell', () => [9, HOLD, 5, HOLD, 7, HOLD, 0, HOLD, HOLD, REST, 0, HOLD, 7, HOLD, 9, HOLD]],
    ['Surprise me', () => { const scale = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12]; return [...Array(16).keys()].map(i => i % 4 === 3 && Math.random() < 0.5 ? HOLD : scale[Math.floor(Math.random() * scale.length)]); }],
  ];

  function editor(s, refresh) {
    let notes = read(s);
    const cols = [];
    const grid = h('div', { class: 'tune-grid', role: 'grid', 'aria-label': 'Town tune, 16 notes' });
    const label = n => n === RANDOM ? 'Random note' : n === HOLD ? 'Hold' : n === REST ? 'Rest' : `${n < 7 ? 'Low' : 'High'} ${NAMES[n]}`;
    function draw() {
      grid.replaceChildren();
      cols.length = 0;
      for (let i = 0; i < 16; i++) {
        const col = h('div', { class: 'tune-col' + (i % 4 === 0 ? ' bar' : '') });
        for (const r of ROWS) {
          const on = notes[i] === r;
          const cell = h('button', {
            class: 'tune-cell' + (on ? ' on' : '') + (r === HOLD || r === REST || r === RANDOM ? ' special' : ''),
            title: `Note ${i + 1}: ${label(r)}`, 'aria-pressed': on ? 'true' : 'false',
            style: on && r < 13 ? { '--note': COLORS[r] } : null,
            onclick: () => { notes[i] = r; write(s, notes); if (r < 13) UI.tone(freq(r), 0.25, 'triangle', 0.07); else sfx.click(); draw(); },
          }, on ? (r === RANDOM ? '?' : r === HOLD ? '–' : r === REST ? 'z' : NAMES[r]) : '');
          col.append(cell);
        }
        cols.push(col);
        grid.append(col);
      }
    }
    draw();
    const playBtn = h('button', { class: 'btn small leaf', onclick: () => play(notes, i => {
      cols.forEach((c, k) => c.classList.toggle('now', k === i));
      playBtn.textContent = i < 0 ? '▶ Play' : '■ Stop';
    }) }, '▶ Play');
    const presets = h('div', { class: 'tune-presets' }, PRESETS.map(([name, fn]) =>
      h('button', { class: 'btn small', onclick: () => { notes = fn(); write(s, notes); draw(); sfx.pop(); toast(`Tune set: ${name}`, '🎵'); } }, name)));
    const legend = h('div', { class: 'tune-legend' }, h('span', null, h('b', null, '?'), ' random note'), h('span', null, h('b', null, '–'), ' hold'), h('span', null, h('b', null, 'z'), ' rest'));
    return h('div', { class: 'card pad tune' },
      h('div', { class: 'tune-top' }, playBtn, presets),
      h('div', { class: 'tune-scroll' }, h('div', { class: 'tune-keys' }, ROWS.map(r => h('span', null, r === RANDOM ? '?' : r === HOLD ? '–' : r === REST ? 'z' : NAMES[r]))), grid),
      legend);
  }

  window.TuneEditor = { editor, read, write, TUNE };
})();
