/* お題ガチャ: 抽選と演出（操作画面 /odai-gacha/ と OBS表示 /view/ で共通）
   演出は札を刀で斬る（共通部品 KKit.fx.slash・kit/kit.js と kit.css）。音は Web Audio で合成（音源ファイルなし）。
   2026-10-20 カプセルと光の粒の演出から札の一閃へ（清潔に・使い回せる部品に）。「控えめ」は画面の揺れなし。 */
(function () {
  'use strict';
  var RAR = ['N', 'R', 'SR', 'SSR'];
  var RATES = { N: 55, R: 30, SR: 12, SSR: 3 };
  // レア度の色はゲームの定石（銅→銀→金→虹）。金属の質感はグラデーションで出す
  var COLOR = { N: '#b9783f', R: '#8e9cae', SR: '#e3a400', SSR: '#ff3d7f' };
  var METAL = {
    N: 'linear-gradient(135deg,#f1c08f 0%,#c4824a 45%,#8a5228 100%)',
    R: 'linear-gradient(135deg,#ffffff 0%,#c6d0dc 42%,#7f8da0 100%)',
    SR: 'linear-gradient(135deg,#fff6b0 0%,#f5c400 40%,#b97c00 100%)',
    SSR: 'linear-gradient(120deg,#ff4d4d,#ff9f1a,#ffe14d,#3ddc84,#3d9bff,#a45bff)'
  };
  var DISP = '"Dela Gothic One","M PLUS Rounded 1c","Hiragino Maru Gothic ProN",sans-serif';
  var LABEL = { N: 'N', R: 'R', SR: 'SR', SSR: 'SSR' };
  var MARU = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans JP",sans-serif';
  // 太い縁取り（16方向の text-shadow。paint-order は OBS の古い Chromium で効かないので使わない）
  function outline(w, col) {
    var a = [];
    for (var i = 0; i < 16; i++) { var t = i / 16 * Math.PI * 2; a.push((Math.cos(t) * w).toFixed(3) + 'em ' + (Math.sin(t) * w).toFixed(3) + 'em 0 ' + col); }
    return a.join(',');
  }
  var OL = outline(0.075, '#2b2b2b'), OL_S = outline(0.05, '#2b2b2b');

  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  // 自分のお題: 1行に1つ。行末に *N / *R / *SR / *SSR でレア度（なければ R）
  function parseCustom(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var s = line.trim(); if (!s) return;
      var r = 'R', m = s.match(/^(.*?)\s*[*＊]\s*(SSR|SR|R|N)\s*$/i);
      if (m && m[1].trim()) { s = m[1].trim(); r = m[2].toUpperCase(); }
      s = s.slice(0, 80);
      out.push({ id: 'my:' + hash(s), text: s, r: r, pack: 'my' });
    });
    return out;
  }

  function buildPool(packs, selected, customText, off) {
    var pool = [], offSet = {};
    (off || []).forEach(function (id) { offSet[id] = 1; });
    packs.forEach(function (p) {
      if (selected.indexOf(p.id) < 0) return;
      p.items.forEach(function (line) {
        var k = line.indexOf('|'), r = line.slice(0, k), t = line.slice(k + 1), id = p.id + ':' + hash(t);
        if (!offSet[id]) pool.push({ id: id, text: t, r: r, pack: p.id });
      });
    });
    if (selected.indexOf('my') >= 0) parseCustom(customText).forEach(function (it) { if (!offSet[it.id]) pool.push(it); });
    return pool;
  }

  // レア度は常に表の割合（N55・R30・SR12・SSR3）で引く。そのレア度のまだ出ていないお題から1つ。
  // 一周は「レア度ごと」: そのレア度を出し切ったら、そのレア度だけ最初に戻す（resetR）。
  // ※プール全体で一周させると、一周の終わりほど残りが高レアに偏って割合が表とずれるため（2026-10-19 実測で SSR 12%）
  function draw(pool, seen, rnd) {
    rnd = rnd || Math.random;
    if (!pool.length) return null;
    var seenSet = {};
    (seen || []).forEach(function (id) { seenSet[id] = 1; });
    var by = {}; pool.forEach(function (it) { (by[it.r] = by[it.r] || []).push(it); });
    var total = 0; RAR.forEach(function (r) { if (by[r]) total += RATES[r]; });
    var x = rnd() * total, rar = null;
    for (var i = 0; i < RAR.length; i++) { var r = RAR[i]; if (!by[r]) continue; if (x < RATES[r]) { rar = r; break; } x -= RATES[r]; }
    if (!rar) for (var j = RAR.length - 1; j >= 0; j--) if (by[RAR[j]]) { rar = RAR[j]; break; }
    var list = by[rar].filter(function (it) { return !seenSet[it.id]; }), resetR = null;
    if (!list.length) { list = by[rar]; resetR = rar; }
    return { item: list[Math.floor(rnd() * list.length)], resetR: resetR, reset: !!resetR };
  }
  // resetR のとき、seen からそのレア度のお題を外す
  function clearRarity(pool, seen, r) {
    var ids = {}; pool.forEach(function (it) { if (it.r === r) ids[it.id] = 1; });
    return seen.filter(function (id) { return !ids[id]; });
  }

  /* ---------- 効果音（Web Audio で合成・レア度で変える） ---------- */
  var actx = null;
  function ac() { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; } catch (e) { return null; } }
  function tone(freq, start, dur, type, vol) {
    var a = ac(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain(), t = a.currentTime + (start || 0);
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  // 刀の「シュッ」: 白いノイズを高い音域だけ通して、上から下へすばやく流す（0.22秒）
  function slash() {
    var a = ac(); if (!a) return;
    var dur = 0.22, n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
    var s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime;
    f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(1400, t + dur);
    g.gain.value = 0.22; s.buffer = b; s.connect(f); f.connect(g); g.connect(a.destination); s.start(t);
  }
  function sfx(kind, lv) {
    try {
      if (kind === 'fuda') { tone(420, 0, 0.1, 'triangle', 0.07); tone(300, 0.06, 0.12, 'triangle', 0.06); }
      else if (kind === 'slash') slash();
      else if (kind === 'step') { var f = [0, 523, 659, 880][lv] || 523; tone(f, 0, 0.16, 'triangle', 0.1); tone(f * 1.5, 0.08, 0.2, 'triangle', 0.08); }
      else if (kind === 'reveal') {
        if (lv === 'N') tone(660, 0, 0.35, 'sine', 0.1);
        else if (lv === 'R') { tone(660, 0, 0.25, 'sine', 0.1); tone(880, 0.1, 0.4, 'sine', 0.1); }
        else if (lv === 'SR') [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.08, 0.45, 'triangle', 0.09); });
        else { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, i * 0.07, 0.6, 'triangle', 0.09); }); [1568, 2093, 1760, 2349].forEach(function (f, i) { tone(f, 0.45 + i * 0.09, 0.3, 'sine', 0.04); }); }
      }
    } catch (e) { /* 音が出なくても続ける */ }
  }

  /* ---------- 見た目（CSS は一度だけ差し込む） ---------- */
  var CSS = [
    '.kg{position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:' + MARU + ';--u:4px;--c:#8f9aa6;z-index:5}',
    '.kg-in{position:absolute;inset:0}',
    '@keyframes kgRb{to{background-position:300% 0}}',
    '.kg-in.shake{animation:kgShake .4s linear}',
    '@keyframes kgShake{0%,100%{transform:none}20%{transform:translate(.6%,-.4%)}40%{transform:translate(-.5%,.45%)}60%{transform:translate(.4%,.3%)}80%{transform:translate(-.25%,-.2%)}}',
    '.kg-dim{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,rgba(20,12,4,0) 30%,rgba(20,12,4,.55) 100%);opacity:0;transition:opacity .35s}',
    '.kg-dim.on{opacity:1}',
    '.kg-tlw{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 3%}',
    /* 結果テロップ（番組のテロップ・ゲームの結果画面の型）: 斜めの帯・極太・太い縁取り・硬い影 */
    '.tl{font-family:' + MARU + ';font-size:var(--th,48px);width:100%;max-width:100%;filter:drop-shadow(.09em .11em 0 #2b2b2b);text-align:left}',
    '.tl-head{display:flex;align-items:flex-end;gap:.25em;margin:0 0 -.04em .35em;position:relative;z-index:1}',
    '.tl-tag{display:inline-block;font-family:' + DISP + ';font-size:max(.62em,14px);font-weight:400;line-height:1;padding:.16em .6em .14em;background:var(--g,var(--c));color:#fff;border:.08em solid #2b2b2b;transform:skewX(-12deg);text-shadow:' + OL_S + ';letter-spacing:.04em}',
    '.tl-sub{display:inline-block;font-size:max(.34em,14px);font-weight:900;line-height:1;padding:.32em .8em;background:#fff6ea;color:#2b2b2b;border:.12em solid #2b2b2b;transform:skewX(-12deg)}',
    '.tl-band{position:relative;background:linear-gradient(180deg,#f47b20 0%,#e2600f 55%,#c94f07 100%);border:.07em solid #2b2b2b;padding:.2em 1.1em .26em .6em;clip-path:polygon(0 0,100% 0,calc(100% - .7em) 100%,0 100%)}',
    '.tl-band:before{content:"";position:absolute;left:0;right:0;top:0;height:.1em;background:#ffd9a8}',
    '.tl-band:after{content:"";position:absolute;top:0;bottom:0;left:-40%;width:30%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg);opacity:0}',
    '.tl.in .tl-band:after{animation:tlShine .9s .55s ease-in-out forwards}',
    '@keyframes tlShine{0%{left:-40%;opacity:1}100%{left:120%;opacity:1}}',
    '.tl.dark .tl-band{background:linear-gradient(180deg,#3a3a3a,#1f1f1f);border-color:#e2600f}',
    '.tl.dark .tl-band:before{background:#e2600f}',
    '.tl.SSR .tl-band:before{height:.14em;background:linear-gradient(90deg,#ff4d4d,#ff9f1a,#ffe14d,#3ddc84,#3d9bff,#a45bff)}',
    '.tl.SSR .tl-tag{background:linear-gradient(90deg,#ff4d4d,#ff9f1a,#e8c200,#2cc46f,#3d9bff,#a45bff,#ff4d4d);background-size:300% 100%;animation:kgRb 1.6s linear infinite}',
    '.tl-txt{display:block;color:#fff;font-weight:900;line-height:1.26;letter-spacing:.02em;font-feature-settings:"palt";text-shadow:' + OL + ';word-break:break-word;word-break:auto-phrase;text-wrap:balance;overflow-wrap:anywhere}',
    '.tl.m .tl-txt{font-size:.82em}.tl.l .tl-txt{font-size:.68em}',
    '.tl.in .tl-band{animation:tlIn .38s cubic-bezier(.2,.9,.3,1.15) both}',
    '.tl.in .tl-head{animation:tlTag .38s .12s cubic-bezier(.2,.9,.3,1.4) both}',
    '@keyframes tlIn{0%{transform:translateX(-14%) skewX(-8deg);opacity:0}60%{transform:translateX(1.2%) skewX(0);opacity:1}100%{transform:none;opacity:1}}',
    '@keyframes tlTag{0%{transform:scale(.2);opacity:0}100%{transform:none;opacity:1}}',
    '@media (prefers-reduced-motion: reduce){.kg-in.shake,.tl.in .tl-band,.tl.in .tl-head,.tl.in .tl-band:after,.tl.SSR .tl-tag{animation:none}}'
  ].join('\n');
  function injectCss() {
    if (document.getElementById('kg-css')) return;
    var st = document.createElement('style'); st.id = 'kg-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  /* ---------- 演出 ---------- */
  // 結果テロップ。o: rarity（またはタグの文字 tag）, text, packName, band('orange'|'dark')
  function telop(box, o) {
    injectCss();
    var len = String(o.text || '').length;
    var t = el('div', 'tl ' + (o.rarity || '') + (o.band === 'dark' ? ' dark' : '') + (len > 30 ? ' l' : len > 18 ? ' m' : ''), box);
    t.style.setProperty('--c', o.rarity ? COLOR[o.rarity] : '#2b2b2b');
    if (o.rarity) t.style.setProperty('--g', METAL[o.rarity]);
    var head = el('div', 'tl-head', t);
    el('span', 'tl-tag', head).textContent = o.tag || LABEL[o.rarity] || '';
    if (o.packName) el('span', 'tl-sub', head).textContent = o.packName;
    var band = el('div', 'tl-band', t);
    el('span', 'tl-txt', band).textContent = o.text;
    return t;
  }
  function cardHtml(box, o) { var w = el('div', 'kg-tlw', box); return telop(w, o); }
  // テロップの文字の大きさ（置き方ごと）。配信画面を1/4に縮めても読める大きさを下限にする
  function telopSize(w, h, place, scale) {
    var px = place === 'band' ? Math.min(w * 0.042, h * 0.2) : place === 'corner' ? Math.min(w * 0.072, h * 0.13) : Math.min(w * 0.05, h * 0.095);
    return Math.max(16, px * (scale || 1));
  }

  // container は position:relative の箱。opts: rarity, text, packName, fx('full'|'lite'|'off'), speed('short'|'normal'|'long'), sound, scale, onDone
  // 札が出る → 印の色が N→R→SR→SSR と上がる（溜め）→ 刀が一閃して札が斜めに斬れる → 中から結果のテロップ。
  // 札と刀は共通部品 KKit.fx.slash（kit/kit.js）。光の粒は撒かない。動きを減らす設定では一瞬で結果。
  function play(container, opts) {
    injectCss();
    if (container._kg) container._kg.destroy();
    var fx = opts.fx || 'full', lite = fx === 'lite', snd = !!opts.sound, sp = opts.speed || 'normal';
    var FX = window.KKit && window.KKit.fx;
    var rarity = RAR.indexOf(opts.rarity) >= 0 ? opts.rarity : 'N', lv = RAR.indexOf(rarity);
    var root = el('div', 'kg', container), inner = el('div', 'kg-in', root);
    var w = container.clientWidth || 600, h = container.clientHeight || 340;
    root.style.setProperty('--u', (Math.min(w, h * 1.6) / 100) + 'px');
    root.style.setProperty('--s', opts.scale || 1);
    root.style.setProperty('--th', telopSize(w, h, opts.place, opts.scale) + 'px');
    var timers = [], done = false, sl = null, ctl = {};
    function T(base) { return FX ? FX.ms(base, sp) : base; }
    function at(t, fn) { timers.push(setTimeout(fn, t)); }
    function finish() { if (done) return; done = true; if (opts.onDone) opts.onDone(); }
    function showCard(anim) { var c = cardHtml(inner, { rarity: rarity, text: opts.text, packName: opts.packName, band: opts.band }); if (anim) c.classList.add('in'); return c; }
    ctl.destroy = function () { timers.forEach(clearTimeout); timers = []; if (sl) sl.destroy(); if (root.parentNode) root.parentNode.removeChild(root); container._kg = null; };
    ctl.skip = function () {
      if (done) return;
      timers.forEach(clearTimeout); timers = [];
      if (sl) { sl.destroy(); sl = null; }
      inner.innerHTML = ''; inner.className = 'kg-in';
      showCard(false);
      if (snd) sfx('reveal', rarity);
      finish();
    };
    ctl.playing = function () { return !done; };
    container._kg = ctl;

    if (fx === 'off' || !FX || FX.reduce) { showCard(true); if (snd) sfx('reveal', rarity); timers.push(setTimeout(finish, 300)); return ctl; }

    var dim = el('div', 'kg-dim', inner);
    // 溜め: 札が出てから、印の色を1段ずつ上げる（SR・SSR はまわりを少し暗くして一拍おく）
    var first = T(380) + T(320), step = T(420), hold = lv === 3 ? T(700) : lv === 2 ? T(380) : 0;
    var wait = T(320) + lv * step + hold;
    var fw = Math.max(70, Math.min(w * 0.22, h * 0.58 / 1.5));
    sl = FX.slash(inner, {
      speed: sp, wait: wait, size: fw, color: COLOR.N,
      sound: function (k) { if (!snd) return; if (k === 'fuda') sfx('fuda'); else if (k === 'slash') sfx('slash'); },
      onCut: function () {
        dim.classList.remove('on');
        if (!lite) { inner.classList.remove('shake'); void inner.offsetWidth; inner.classList.add('shake'); }
        at(T(260), function () { showCard(true); if (snd) sfx('reveal', rarity); });
      },
      onDone: function () { at(T(lv === 3 ? 700 : 400), finish); }
    });
    for (var i = 1; i <= lv; i++) (function (i) {
      at(first + (i - 1) * step, function () {
        var r = RAR[i];
        if (sl) sl.tint(COLOR[r], r === 'SSR' ? METAL.SSR : null);
        if (snd) sfx('step', i);
      });
    })(i);
    if (hold) at(first + lv * step - T(120), function () { dim.classList.add('on'); });
    return ctl;
  }

  // 最後の結果を静かに出す（読み直したとき・OBSの再読み込み）
  function show(container, opts) { return play(container, Object.assign({}, opts, { fx: 'off', sound: false })); }

  window.KkpGacha = { METAL: METAL, telop: telop, telopSize: telopSize, injectCss: injectCss, RAR: RAR, RATES: RATES, COLOR: COLOR, hash: hash, parseCustom: parseCustom, buildPool: buildPool, draw: draw, clearRarity: clearRarity, play: play, show: show, sfx: sfx };
})();
