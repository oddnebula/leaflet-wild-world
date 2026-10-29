// Photo mode for Leaflet's 3D views and the night sky: the picture on a cream postcard with the town's name, the place
// and the game's date and time written underneath, saved as a PNG.
(function () {
  'use strict';
  const { h, sfx, toast } = UI;

  // src: a canvas (WebGL ones must be drawn in the same task, or keep their drawing buffer). where: "Walking in Maple".
  function make(src, where) {
    const s = window.APP && APP.save, now = s ? CAL_NOW(s) : new Date();
    const pad = Math.round(src.width * 0.04), cap = Math.round(src.width * 0.075);
    const cv = document.createElement('canvas');
    cv.width = src.width + pad * 2; cv.height = src.height + pad * 2 + cap;
    const g = cv.getContext('2d');
    g.fillStyle = '#fbf3df'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#e9dcc0'; g.fillRect(pad - 3, pad - 3, src.width + 6, src.height + 6);
    g.drawImage(src, pad, pad);
    const fs = Math.round(cap * 0.36), y = pad * 2 + src.height + cap * 0.38;
    g.fillStyle = '#5a4630'; g.textBaseline = 'middle';
    g.font = `800 ${fs}px "Nunito", "Avenir Next", system-ui, sans-serif`; g.textAlign = 'left';
    g.fillText(where, pad, y);
    g.font = `600 ${Math.round(fs * 0.72)}px "Nunito", "Avenir Next", system-ui, sans-serif`; g.textAlign = 'right'; g.fillStyle = '#8a7356';
    g.fillText(now.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), cv.width - pad, y);
    g.font = `600 ${Math.round(fs * 0.55)}px "Nunito", "Avenir Next", system-ui, sans-serif`; g.fillStyle = '#b3a07f';
    g.fillText('Leaflet', cv.width - pad, y + fs * 0.95);
    return cv;
  }
  const CAL_NOW = s => window.WW_CALENDAR ? WW_CALENDAR.gameNow(s) : new Date();

  function save(src, where, file) {
    let cv;
    try { cv = make(src, where); } catch (e) { sfx.error(); toast('The photo couldn’t be taken', '📷'); return; }
    cv.toBlob(b => {
      if (!b) { sfx.error(); toast('The photo couldn’t be taken', '📷'); return; }
      const a = h('a', { href: URL.createObjectURL(b), download: `${file || where}.png` }); document.body.append(a); a.click(); a.remove();
      sfx.bell(); toast('Postcard saved', '📷');
    });
  }
  // A small "📷 Photo" button. draw() must render the canvas right before it's read and return it.
  const button = (draw, where, file) => h('button', { class: 'btn small', title: 'Save this view as a postcard', onclick: () => save(draw(), typeof where === 'function' ? where() : where, file) }, '📷 Photo');

  window.Postcard = { make, save, button };
})();
