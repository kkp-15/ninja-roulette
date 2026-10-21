/* 配信モード（ルーレット・お題ガチャ・配信カウンター共通）。head で ga.js のすぐ後に読む（同期）。
   はぁ・ito・ワードウルフ・ビンゴと同じ決まり:
   - PC幅（768px以上）で手動オン（ページのスイッチ／?mode=stream）。localStorage で覚える
   - オン中は AdSense のスクリプト自体を読まない（自動広告・アンカー広告も出ない）
   - スマホでは ?mode=stream も効かない（ふだんの使い方で広告を消す抜け道にしないため）。?kkptest=1 のときは幅を見ない（確認用）
   - 見た目は html.stream の下に stream.css で書く（説明・広告・フッターを畳み、大事な所を大きく） */
(function () {
  'use strict';
  var KEY = 'kkp-roulette-stream';
  var on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (e) {}
  if (/[?&]mode=stream\b/.test(location.search)) on = true;
  if (!window.__kkpTest && !(window.matchMedia && window.matchMedia('(min-width:768px)').matches)) on = false;
  window.__kkpStream = on;
  if (on) document.documentElement.classList.add('stream');

  // 広告のスクリプトは配信モードと確認用（?kkptest=1）では読まない
  var loaded = false;
  window.kkpLoadAds = function () {
    if (loaded || on || window.__kkpTest) return;
    loaded = true;
    var s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1298304917726270';
    document.head.appendChild(s);
  };

  function set(v) {
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {}
    if (window.kkpEvent) kkpEvent('stream_toggle', { mode: v ? 'on' : 'off', from: location.pathname });
    var u = new URL(location.href); u.searchParams.delete('mode');
    setTimeout(function () { location.replace(u.pathname + u.search + u.hash); }, 120);
  }
  window.kkpSetStream = set;

  // スイッチ: ページの [data-stream-sw] に置く（PC幅だけ見える）。オン中は上の帯にも「配信モードを終える」
  function ui() {
    [].forEach.call(document.querySelectorAll('[data-stream-sw]'), function (box) {
      box.className += ' stream-sw-box';
      box.innerHTML = '<label class="stream-sw"><input type="checkbox"> 配信モード<span>（広告なし・大きく表示）</span></label>'
        // 2026-10-21 ふつうと配信モードの見比べ（2行だけ。配信モード中＝遊ぶ画面では出さない）
        + '<dl class="stream-cmp"><div><dt>ふつう</dt><dd>この画面をみんなで見る／広告あり</dd></div>'
        + '<div><dt>配信モード</dt><dd>OBSに映す／広告なし／説明を畳む</dd></div></dl>';
      var c = box.querySelector('input'); c.checked = on;
      c.addEventListener('change', function () { set(c.checked); });
    });
    if (on) {
      var bar = document.querySelector('.site-in');
      if (bar) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'stream-off'; b.textContent = '配信モード中（広告なし）・終える';
        b.addEventListener('click', function () { set(false); });
        bar.appendChild(b);
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui); else ui();
})();
