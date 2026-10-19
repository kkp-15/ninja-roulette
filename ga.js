/* GA4（回数だけ）。確認用: ?preview=1・?kkptest=1（この端末だけ・?kkptest=0で解除）と localhost では送らない。
   送るのはイベント名と page・from・rarity・mode・fx・pack（決まった短い値）だけ。項目の中身（お題・視聴者名）は送らない。 */
(function () {
  var t = false;
  try {
    if (/[?&]kkptest=1\b/.test(location.search)) localStorage.setItem('kkp-test', '1');
    if (/[?&]kkptest=0\b/.test(location.search)) localStorage.removeItem('kkp-test');
    t = localStorage.getItem('kkp-test') === '1';
  } catch (e) {}
  window.__kkpTest = t;
  var p = t || /[?&]preview=1/.test(location.search) || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
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
  ['from', 'rarity', 'mode', 'fx', 'pack'].forEach(function (k) { if (params && params[k] != null) o[k] = String(params[k]).slice(0, 40); });
  gtag('event', name, o);
};
