/* GA4（回数だけ）。確認用: ?preview=1 と localhost では送らない。
   送るのはイベント名と page・from だけ。項目の中身（お題・視聴者名）は送らない。 */
(function () {
  var p = /[?&]preview=1/.test(location.search) || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  if (p) { window.__kkpPreview = true; window['ga-disable-G-2LM85GJN0L'] = true; return; }
  gtag('js', new Date());
  gtag('config', 'G-2LM85GJN0L');
  var s = document.createElement('script');
  s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=G-2LM85GJN0L';
  document.head.appendChild(s);
})();
window.kkpEvent = function (name, params) {
  if (window.__kkpPreview || typeof gtag !== 'function') return;
  var o = { page: location.pathname };
  if (params && params.from) o.from = String(params.from).slice(0, 40);
  gtag('event', name, o);
};
