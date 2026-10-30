// Leaflet's version. The updater compares it with the newest release on GitHub; mac/build.sh puts it in the app too.
window.LEAFLET_VERSION = '2.0.0';
// Phones and tablets (or Leaflet opened from Leaflet Link on the 3DS): the parts that need a computer (melonDS, SD
// card readers, installing Leaflet Link) are hidden. html.phone is there for the stylesheet.
window.LEAFLET_PHONE = !!window.LEAFLET_FROM_LINK || (!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.leaflet)
  && !/[?&]helper=/.test(location.search) && !!window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches);
document.documentElement.classList.toggle('phone', window.LEAFLET_PHONE);
