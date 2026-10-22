/* 配信ルーレット 盤（操作画面・お題ガチャ・OBS表示ページで共通）
   2026-10-22 盤は共通部品 KKit.wheel（kit/kit.js の k-wheel・SVG）にした。ここは盤の外の役目だけ:
   項目の読み取り（parseItems「名前*3」）・効果音（Web Audio で合成）・回す長さ（spinDur）・
   KKit.wheel を包む make()（同じ項目なら当たりの表示を残す・演出の強さ fx・止まる前に手裏剣を刺す）。
   角度の単位は「度」（盤の回転・時計回り。0＝針の真上）。前の版はラジアンだったので、
   表示ページに残っている古い知らせは deg() で度に直してから使う（u:'deg' が付いていれば度）。 */
(function () {
  'use strict';

  // 「1行1項目」「名前*3」を読む
  function parseItems(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var s = line.trim();
      if (!s) return;
      var w = 1, m = s.match(/^(.*?)\s*[*＊×]\s*(\d+(?:\.\d+)?)$/);
      if (m && m[1].trim()) { s = m[1].trim(); w = Math.max(0.1, parseFloat(m[2])); }
      out.push({ label: s.slice(0, 60), weight: w });
    });
    return out;
  }

  // 効果音（Web Audio で合成。外部ファイルなし）。tick は針がマスの境目を越える「カチッ」
  var actx = null;
  function sound(kind) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.connect(g); g.connect(actx.destination);
      if (kind === 'throw') {
        // 手裏剣の「ヒュッ」: 高い音から下がる短いノイズ
        var n = Math.floor(actx.sampleRate * 0.32), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
        var src = actx.createBufferSource(), f = actx.createBiquadFilter(); src.buffer = b;
        f.type = 'bandpass'; f.Q.value = 2.2; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(5200, t + 0.3);
        g.gain.setValueAtTime(0.16, t); src.connect(f); f.connect(g); src.start(t);
        return;
      }
      if (kind === 'hit') {
        // 刺さった「トン」: 低く短い音
        o.type = 'triangle'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.09);
        g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        o.start(t); o.stop(t + 0.15);
        return;
      }
      if (kind === 'tick') {
        o.type = 'triangle'; o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.03);
        g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
        o.start(t); o.stop(t + 0.05);
      } else {
        o.type = 'sine'; o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(990, t + 0.12);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.start(t); o.stop(t + 0.65);
      }
    } catch (e) { /* 音が出なくても動作は続ける */ }
  }

  // 回す長さ（演出の長さ: short 短い・normal ふつう・long 長い）。動きを減らす設定では一瞬で止める
  var REDUCE = false; try { REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  function spinDur(speed) {
    if (REDUCE) return 1;
    if (speed === 'short') return 2800 + Math.random() * 400;
    if (speed === 'long') return 7000 + Math.random() * 800;
    return 4600 + Math.random() * 600;
  }

  // 前の版（ラジアン）の知らせを度に直す
  function deg(msg, v) { return msg && msg.u === 'deg' ? v : v * 180 / Math.PI; }

  // 演出の強さ: full＝当たりのマスが光る・針が揺れる・手裏剣／lite＝光らせず揺らさない（手裏剣は刺す）／off＝手裏剣もなし
  var CSS = '.k-wheel.rw-lite .k-wheel-win,.k-wheel.rw-off .k-wheel-win,.k-wheel.rw-lite .k-wheel-pin>svg,.k-wheel.rw-off .k-wheel-pin>svg{animation:none!important}';
  function injectCss() {
    if (document.getElementById('rw-css')) return;
    var st = document.createElement('style'); st.id = 'rw-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  // el に KKit.wheel を作って包む。o: minPx（盤の字の下限・画面の px）・empty（項目がないときの字）
  function make(el, o) {
    o = o || {}; injectCss();
    var W = KKit.wheel(el, { items: [], minPx: o.minPx || 14, empty: o.empty || '' });
    if (window.KkpRfx) W.el.classList.add('rfx-on');   // 2026-10-23 針は使わない（手裏剣が刺さったマスが当たり）
    var key = '', fx = 'full', star = null;
    var R = {
      W: W, el: W.el, onTick: null,
      get angle() { return W.angle; },
      get spinning() { return W.spinning; },
      get items() { return W.items; },
      get fx() { return fx; },
      set fx(v) { fx = v === 'lite' || v === 'off' ? v : 'full'; W.el.classList.toggle('rw-lite', fx === 'lite'); W.el.classList.toggle('rw-off', fx === 'off'); }
    };
    // 同じ項目なら作り直さない（当たりの表示を残す）
    R.setItems = function (items) {
      var k = JSON.stringify((items || []).map(function (it) { return [it.label, it.weight]; }));
      if (k === key) return;
      key = k; W.set(items || []);
      if (window.KkpRfx) KkpRfx.tagStars(R);   // ★のマスのふちを金に（rfx.js）
    };
    R.resize = function (px) { px = Math.max(80, Math.floor(px)); W.el.style.width = W.el.style.height = px + 'px'; W.relayout(); };
    R.minPx = function (px) { if (W.opts.minPx !== px) { W.opts.minPx = px; W.relayout(); } };
    R.relayout = function () { W.relayout(); };
    R.pick = function (turns) { return W.pick(turns); };
    R.resultAt = function (a) { return W.at(a); };
    R.clearStar = function (host) { star = null; if (host && window.KKit && KKit.fx) KKit.fx.clear(host); };
    // from → to（度）を dur ms で回す。so: host（手裏剣を刺す箱・position のある要素）・speed・sound（音を鳴らす関数か null）
    // 手裏剣は止まる 420ms（演出の長さの倍率をかけた分）前に投げる＝止まる瞬間に刺さる。回転のフレームの中で投げる（裏の画面で描画が遅れてもずれない）
    R.spin = function (from, to, dur, done, so) {
      so = so || {};
      var FX = window.KKit && KKit.fx, host = so.host, idx = W.at(to);
      R.clearStar(host);
      if (FX && !FX.reduce && fx !== 'off' && host && W.segs.length && dur > 1) {
        var fl = FX.ms(420, so.speed);
        star = { at: Math.max(0, dur - fl), fn: function () {
          var p = W.point(idx, to, 0.46), wr = W.el.getBoundingClientRect(), hr = host.getBoundingClientRect();
          FX.shuriken(host, { x: wr.left - hr.left + p.x, y: wr.top - hr.top + p.y, size: Math.max(26, wr.width * 0.1), speed: so.speed, sound: so.sound || null, from: 'right' });
        } };
      }
      W.spin(from, to, dur <= 1 ? 0 : dur, function (i) { if (done) done(i); }, {
        onTick: function () { if (R.onTick) R.onTick(); },
        onFrame: function (t, ms) { if (star && ms >= star.at) { var f = star.fn; star = null; f(); } }
      });
    };
    return R;
  }

  window.KkpWheel = { make: make, spinDur: spinDur, reduce: REDUCE, parseItems: parseItems, sound: sound, deg: deg };
})();
