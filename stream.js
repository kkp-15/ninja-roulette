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
    // 2026-10-21 ハッシュ付き（#…）だと location.replace がハッシュ移動だけで終わり、読み直さなかった。
    // ハッシュと mode を消してから reload する
    var u = new URL(location.href); u.searchParams.delete('mode'); u.hash = '';
    setTimeout(function () {
      try { history.replaceState(null, '', u.pathname + u.search); } catch (e) {}
      location.reload();
    }, 120);
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
      viewRow(bar);
      if (bar) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'stream-off'; b.textContent = '配信モード中（広告なし）・終える';
        b.addEventListener('click', function () { set(false); });
        bar.appendChild(b);
      }
    }
  }
  // 2026-10-21 配信モードでは「OBSに映す」の段（.narrow）を畳むので、開くボタンと背景が消えていた。
  // ページの #openView が見えないときだけ、上の帯（「配信モードを終える」の左）に「表示ページを開く」（別窓 1280x720）と背景を出す。
  // 背景はページが window.kkpStreamBg = { get(), set(v) } を用意したときだけ。
  function openViewWin(href, msg) {
    var w = null;
    try { w = window.open(href, 'kkp_roulette_view', 'popup=yes,width=1280,height=720'); } catch (e) {}
    if (w) { try { w.focus(); } catch (e) {} if (msg) msg.textContent = ''; }
    else if (msg) msg.textContent = 'ポップアップが止められました。許可してもう一度押してください';
    if (window.kkpEvent) kkpEvent('view_open_click', { from: location.pathname, where: 'stream' });
  }
  function viewRow(bar) {
    var ov = document.getElementById('openView');
    var box = bar || document.querySelector('[data-stream-sw]');
    if (!ov || !box || ov.offsetParent !== null) return;
    var href = ov.getAttribute('href') || '/view/';
    var row = document.createElement('div');
    row.className = 'stream-view';
    row.innerHTML = '<button type="button" class="k-btn k-btn-sub stream-view-open">表示ページを開く</button>'
      + (window.kkpStreamBg ? '<label class="stream-view-bg" title="緑はOBSのフィルタ「クロマキー」で抜けます">背景 <select>'
        + '<option value="#fff6ea">クリーム</option><option value="#00b140">緑（抜く用）</option>'
        + '<option value="transparent">透過</option><option value="#ffffff">白</option><option value="#000000">黒</option>'
        + '</select></label>' : '')
      + '<span class="stream-view-msg" aria-live="polite"></span>';
    box.appendChild(row);
    var msg = row.querySelector('.stream-view-msg');
    row.querySelector('.stream-view-open').addEventListener('click', function () { openViewWin(href, msg); });
    var sel = row.querySelector('select');
    if (sel) {
      var cur = window.kkpStreamBg.get();
      if (![].some.call(sel.options, function (o) { return o.value === cur; })) {
        var o = document.createElement('option'); o.value = cur; o.textContent = 'いまの色'; sel.insertBefore(o, sel.firstChild);
      }
      sel.value = cur;
      sel.addEventListener('change', function () { window.kkpStreamBg.set(sel.value); });
    }
    // 「表示ページのURL」（#obs）への文字リンクは、配信モードでは飛び先が畳まれているので別窓を開く
    [].forEach.call(document.querySelectorAll('a[href="#obs"]'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openViewWin(href, msg); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui); else ui();
})();
