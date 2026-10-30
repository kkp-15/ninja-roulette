/* 配信モード（ルーレット・お題ガチャ・配信カウンター共通）。head で ga.js と kit/kit.js（defer なし）のすぐ後に読む（同期）。
   2026-10-22 中身は kit の部品にまとめた:
   - 配信モード = KKit.stream（PC幅768以上で手動・?mode=stream。切り替えは URL の # と mode= を消して読み直す。前の版の直しは kit に入った）
     覚えるキーは前の版と同じ kkp-roulette-stream（'1' で配信モード）なので移しかえはいらない
   - 表示ページを開く = KKit.openView（別窓 1280x720。ポップアップが止められても操作画面は動かさない）
   - つながりの札 = .k-live（ページが KKit.live を作ったときだけ「つながっています」になる）
   - オン中は AdSense のスクリプト自体を読まない（自動広告・アンカー広告も出ない）。スマホでは ?mode=stream も効かない。?kkptest=1 のときは幅を見ない（確認用）
   - 見た目は html.stream の下に stream.css で書く（説明・広告・フッターを畳み、大事な所を大きく）
   背景: ページの window.kkpStreamBg（ルーレット・お題ガチャは kit の KKit.viewBg。値は cream / green / clear / white / black / #rrggbb）。
   2026-10-22 ルーレットの「表示ページを開く」は kit の .k-view-open になった（#openView がないページは .k-view-open[data-k-view] を使う） */
(function () {
  'use strict';
  var on = KKit.stream.init({ key: 'kkp-roulette-stream' });
  window.__kkpStream = on;
  if (on) document.documentElement.classList.add('stream');

  // 広告のスクリプトは配信モードと確認用（?kkptest=1）では読まない
  var loaded = false;
  window.kkpLoadAds = function () {
    if (loaded || KKit.stream.noAds()) return;
    loaded = true;
    var s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1298304917726270'; s.dataset.overlays = 'bottom';
    document.head.appendChild(s);
  };

  function set(v) {
    if (window.kkpEvent) kkpEvent('stream_toggle', { mode: v ? 'on' : 'off', from: location.pathname });
    setTimeout(function () { KKit.stream.set(v); }, 120);   // 計測を送ってから読み直す
  }
  window.kkpSetStream = set;

  // 表示ページを別窓で開く（ページの #openView の href・data-ch か、.k-view-open の data-k-view・data-k-ch を使う）
  function at(ov, a) { return ov.getAttribute(a) || ov.getAttribute(a.replace('data-', 'data-k-')) || ''; }
  function findOv() { return document.getElementById('openView') || document.querySelector('.k-view-open[data-k-view]'); }
  function openViewWin(ov, msg) {
    var ok = KKit.openView({ url: ov.getAttribute('href') || ov.getAttribute('data-k-view') || '/view/', ch: at(ov, 'data-ch'), name: at(ov, 'data-name') || 'kkp_roulette_view', def: at(ov, 'data-def') || undefined });
    if (msg) msg.textContent = ok ? '' : 'ポップアップが止められました。許可してもう一度押してください';
    return ok;
  }
  window.kkpOpenView = openViewWin;

  // スイッチ: ページの [data-stream-sw] に置く（PC幅だけ見える）。オン中は上の帯にも「配信モードを終える」
  function ui() {
    [].forEach.call(document.querySelectorAll('[data-stream-sw]'), function (box) {
      box.className += ' stream-sw-box';
      box.innerHTML = '<label class="stream-sw"><input type="checkbox"> 配信モード<span>（大きく表示）</span></label>'
        // 2026-10-21 ふつうと配信モードの見比べ（2行だけ。配信モード中＝遊ぶ画面では出さない）
        + '<dl class="stream-cmp"><div><dt>ふつう</dt><dd>この画面をみんなで見る</dd></div>'
        + '<div><dt>配信モード</dt><dd>OBSに映す／説明を畳む</dd></div></dl>';
      var c = box.querySelector('input'); c.checked = on;
      c.addEventListener('change', function () { set(c.checked); });
    });
    // ページの「表示ページを開く」も別窓（開けないときは知らせるだけ。計測はページ側）
    var ov = document.getElementById('openView');
    if (ov) ov.addEventListener('click', function (e) { e.preventDefault(); openViewWin(ov, document.getElementById('openViewMsg')); });
    ov = ov || findOv();
    if (on) {
      var bar = document.querySelector('.site-in');
      viewRow(bar);
      if (bar) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'stream-off'; b.textContent = '配信モード中・終える';
        b.addEventListener('click', function () { set(false); });
        bar.appendChild(b);
      }
    }
  }
  // 配信モードでは「OBSに映す」の段（.narrow）を畳むので、ページの #openView が見えないときだけ、
  // 上の帯（「配信モードを終える」の左）に「表示ページを開く」・つながりの札・背景（ページが window.kkpStreamBg を用意したとき）を出す
  var BGS = [['cream', 'クリーム'], ['green', '緑（抜く用）'], ['clear', '透過'], ['white', '白'], ['black', '黒']];
  function viewRow(bar) {
    var ov = findOv();
    var box = bar || document.querySelector('[data-stream-sw]');
    if (!ov || !box || ov.offsetParent !== null) return;
    var ch = at(ov, 'data-ch');
    var row = document.createElement('div');
    row.className = 'stream-view';
    row.innerHTML = (ch ? '<span class="k-live" data-k-live="' + ch + '">表示ページ：つながっていません</span>' : '')
      + '<button type="button" class="k-btn k-btn-sub stream-view-open">表示ページを開く</button>'
      + (window.kkpStreamBg ? '<label class="stream-view-bg" title="緑はOBSのフィルタ「クロマキー」で抜けます">背景 <select>'
        + BGS.map(function (b) { return '<option value="' + b[0] + '">' + b[1] + '</option>'; }).join('')
        + '</select></label>' : '')
      + '<span class="stream-view-msg" aria-live="polite"></span>';
    box.appendChild(row);
    var msg = row.querySelector('.stream-view-msg');
    row.querySelector('.stream-view-open').addEventListener('click', function () { openViewWin(ov, msg); if (window.kkpEvent) kkpEvent('view_open_click', { from: location.pathname, where: 'stream' }); });
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
      a.addEventListener('click', function (e) { e.preventDefault(); openViewWin(ov, msg); if (window.kkpEvent) kkpEvent('view_open_click', { from: location.pathname, where: 'stream' }); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui); else ui();
})();
