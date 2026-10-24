// Time of day, season and falling particles, like the game's world clock.
(function () {
  'use strict';
  const root = document.documentElement;
  const SEASONS = { spring: ['🌸', '🌸', '🌸', '🍃'], summer: ['🍃', '🌿', '🍃'], fall: ['🍂', '🍁', '🍂'], winter: ['❄️', '❄️', '✦'] };
  const layer = document.createElement('div');
  layer.className = 'ww-particles'; layer.setAttribute('aria-hidden', 'true');
  document.body.prepend(layer);
  let season = '';
  function tick() {
    const d = new Date(), hr = d.getHours(), m = d.getMonth();
    const tod = hr >= 5 && hr < 10 ? 'morning' : hr < 16 && hr >= 10 ? 'day' : hr >= 16 && hr < 19 ? 'evening' : 'night';
    root.classList.remove('tod-morning', 'tod-day', 'tod-evening', 'tod-night');
    root.classList.add('tod-' + tod);
    const s = m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'fall' : 'winter';
    if (s !== season) {
      season = s; layer.replaceChildren();
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (let i = 0; i < 14; i++) {
          const p = document.createElement('i');
          p.textContent = SEASONS[s][i % SEASONS[s].length];
          p.style.left = Math.random() * 100 + 'vw';
          p.style.fontSize = 12 + Math.random() * 12 + 'px';
          p.style.animationDuration = 14 + Math.random() * 16 + 's';
          p.style.animationDelay = -Math.random() * 30 + 's';
          layer.append(p);
        }
      }
    }
    const clock = document.getElementById('wwClock');
    if (clock) {
      const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      clock.innerHTML = `<b>${t}</b><span>${day}</span>`;
    }
  }
  tick();
  setInterval(tick, 20000);
})();
