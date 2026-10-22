/* 配信ルーレットの「手裏剣が刺さったマスが当たり」演出（第3版 2026-10-23）
   操作画面（/）と OBS表示ページ（/view/）で共通。wheel.js（KkpWheel.make）の盤を使う。

   ■ 第3版の考え方: パチンコの予告の型はやめ、配信で実際に使う場面（使い方）ごとに見せ方を変える
     使い方   いちばん大事なこと                 長さ     見せ方
     お題     すぐ読める・何回回してもだれない     約2.6秒  速く回って手裏剣がすぐ刺さる。結果の字を大きく。ためなし
     罰ゲーム  いやな項目に近づく「やめて」と決定   約3.6秒  最後は少しだけゆっくり這う。★（きつい罰）が狙いに近づくと盤のまわりが赤くなる。
                                                         ★のすぐ手前で止まる「セーフ」、ときどき★へ「まさかの1マス」。「罰ゲーム決定！」をはっきり
     名前の抽選 選ばれた人がうれしい・公平に見える    約4.2秒  あと少しの細工はしない（★なし・全員同じ見せ方）。当選の札に名前を大きく＋くす玉と紙吹雪
     順番決め  テンポ・当たったら外して続ける       約2.0秒  当たりは自動で外す。右に「1番 ○○・2番 ○○…」が増えていく。残り1つは自動で最後に
     ＋「次の1回を盛り上げる」（操作画面のボタン・1回だけ）: 止まりかけで止まり「どこに刺さる？ コメントで予想！」。
       配信者が「進む」かSpaceで進む。押さなければ6秒で自動（この待ちは8秒に数えない）。チャットの取り込みはしない。

   ■ 当たりの決め方（前と同じ）
   1) まず当たりを weight どおりに抽選する（演出はあとから選ぶ＝公平さは今と同じ）。
   2) 盤の回り方を逆算する: 手裏剣が刺さる場所（画面の角度 phi）に、刺さる瞬間（hitT）ちょうど当たりのマスが来るように止まる角度 to を決める。
   3) 段取り（plan）を丸ごと表示ページへ送る。表示ページはなぞるだけなので、結果も見せ方も同じ。乱数は操作画面でしか引かない。
      盛り上げの待ちは {t:'rgo'}、飛ばすは {t:'rskip'}、順番の表は {t:'rorder'} を送る。

   ■ ★（罰ゲームの使い方だけ）: 項目の頭か末尾に「★」＝きつい罰。★のマスは盤のふちが赤くなる。
     「まさかの1マス」: ★に決まったとき 8% で、となりに刺さって「セーフ…？」→はね返って★へ（足す時間は約0.8秒）。
     ほかの使い方では ★ は字として出すだけ（見せ方は変えない）。

   ■ 光: 点滅は名前の抽選の当選と★の罰の1回だけ（0.5秒）。ほかは 0.5秒以上かけて明るく→戻す。動きを減らす設定では、回さずに結果だけ出す。
   kit に移す部品（KKit.yokoku 案）: aim / hold / yama（待ちの札）/ winCard（当選の札）/ batsuCard / orderList / party / shurikenEl / sound。
   ルーレット固有なのは plan の角度の逆算と play の段取りだけ。 */
(function () {
  'use strict';
  var REDUCE = false; try { REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var MODES = { odai: 'お題', batsu: '罰ゲーム', name: '名前の抽選', order: '順番決め' };
  var YAMA_MAX = 3000;   // 盛り上げの待ち: 押さなければ3秒で自動で進む（2026-10-23 ユーザー「タイパ」）
  // 当選の名前に「さん」を付ける。すでに敬称で終わる名前・名前でないもの（数字や記号だけ）には付けない（茶化さない・下げない）
  function honorific(label) {
    var nm = String(label || '').replace(/[★☆]/g, '').replace(/\s*[*＊×]\s*\d+(?:\.\d+)?$/, '').trim();
    if (!nm) return '';
    if (/(さん|様|さま|サマ|くん|君|クン|ちゃん|チャン|氏|殿|どの)$/.test(nm)) return nm;
    if (!/[A-Za-zＡ-Ｚａ-ｚぁ-んァ-ヶー一-龠々]/.test(nm)) return nm;
    return nm + ' さん';
  }
  function isStar(label) { return /^\s*[★☆]|[★☆]\s*$/.test(String(label || '')); }
  function rnd() { return Math.random(); }

  // 使い方ごとの長さ（ms）。speed（短い・ふつう・長い）で 0.75・1・1.2 倍
  var LEN = {
    odai: { D: 2600, stall: 0, creep: 6 },
    order: { D: 2000, stall: 0, creep: 4 },
    name: { D: 4200, stall: 600, creep: 14 },
    batsu: { D: 3600, stall: 650, creep: 16 }   // 2026-10-23「テンポを大事に」: 約4秒以内
  };
  var SPK = { short: 0.75, normal: 1, long: 1.2 };

  function easeOf(p) {
    var D = p.to - p.from, fh = p.hitT / p.dur, fs = (p.hitT - p.stall) / p.dur, Eh = (p.hitA - p.from) / D, Es = Eh - p.creep / D, c = 0.03;
    return function (t) {
      if (t <= 0) return 0; if (t >= 1) return 1;
      if (t < fs) { var u = t / fs; return Es * ((1 - c) * (1 - Math.pow(1 - u, 3)) + c * u); }
      if (t < fh) { var w = (t - fs) / (fh - fs); return Es + (Eh - Es) * (w * w * (3 - 2 * w)); }
      var v = (t - fh) / (1 - fh); return Eh + (1 - Eh) * (1 - Math.pow(1 - v, 2));
    };
  }

  /* ---------- 段取りを作る（操作画面だけ） ----------
     o: { mode, speed, hype（次の1回を盛り上げる）, turns, order（順番決めのここまでの表）, total（名前の抽選の母数） } */
  function plan(W, o) {
    o = o || {};
    var segs = W.segs, n = segs.length; if (n < 1) return null;
    var items = W.items, tot = 0, i, j, x;
    items.forEach(function (it) { tot += it.weight; });
    x = rnd() * tot;
    for (i = 0; i < n - 1; i++) { if (x < items[i].weight) break; x -= items[i].weight; }
    var F = /[?&]kkptest=1\b/.test(location.search) && window.__rfxForce || null;   // 確認用: { win, revive, near }
    if (F && F.win != null && F.win < n) i = F.win;
    var mode = MODES[o.mode] ? o.mode : 'odai', L = LEN[mode], k = SPK[o.speed] || 1;
    var win = i, p = { v: 3, mode: mode, win: win, label: items[win].label, k: k, hype: !!o.hype };
    p.star = mode === 'batsu' && isStar(items[win].label);
    // まさかの1マス（罰ゲームの ★ だけ）
    p.fake = -1;
    if (p.star && (F && F.revive != null ? F.revive : rnd() < 0.08)) {
      var cand = [(win + 1) % n, (win - 1 + n) % n].filter(function (jj) { return jj !== win && !isStar(items[jj].label); });
      if (cand.length) p.fake = cand[0];
    }
    var tgt = p.fake >= 0 ? p.fake : win, sg = segs[tgt], w = sg.a1 - sg.a0, prev = (tgt - 1 + n) % n, next = (tgt + 1) % n, f;
    // 罰ゲームだけ: ★のすぐ手前で止まる「セーフ」（★が次に来るマスで、ふちぎりぎり）。名前の抽選・お題・順番では細工しない
    if (mode === 'batsu' && !isStar(items[tgt].label) && isStar(items[prev].label) && n > 1) f = 0.1 + rnd() * 0.08;
    else if (mode === 'batsu' && !isStar(items[tgt].label) && isStar(items[next].label) && n > 1) f = 0.82 + rnd() * 0.08;
    else f = 0.3 + rnd() * 0.4;
    p.pos = sg.a0 + w * f;
    p.phi = 70 + rnd() * 40;
    p.r = 0.6;
    p.dur = Math.round((L.D + rnd() * 250) * k);
    p.hitT = p.dur - Math.round(220 * k);
    p.stall = Math.round(Math.max(L.stall, p.hype ? 900 : 0) * k);
    p.creep = p.stall > 0 ? Math.min(w * 0.7, Math.max(L.creep, p.hype ? 18 : 0)) : 0;   // ためが無いとき（お題・順番）は這わない
    p.from = W.angle;
    var turns = o.turns || (mode === 'odai' || mode === 'order' ? 3 : 5), base = (((p.phi - p.pos - p.from) % 360) + 360) % 360;
    p.hitA = p.from + base + 360 * turns;
    p.to = p.hitA + 3;
    p.yama = p.hype && !REDUCE;
    p.yamaMax = YAMA_MAX;
    p.n = n;
    p.order = mode === 'order' ? (o.order || []).concat([items[win].label]) : null;
    p.total = p.dur + (p.fake >= 0 ? Math.round(780 * k) : 0);
    p.id = Date.now();
    return p;
  }

  /* ---------- 音（Web Audio で合成・音源ファイルなし。配信で大きすぎないよう 0.14 以下） ---------- */
  var actx = null;
  function sound(kind) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var t = actx.currentTime;
      var tone = function (type, f0, f1, at, len, vol) {
        var o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.connect(g); g.connect(actx.destination);
        o.frequency.setValueAtTime(f0, t + at); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + at + len);
        g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(vol, t + at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
        o.start(t + at); o.stop(t + at + len + 0.02);
      };
      var noise = function (at, len, f0, f1, vol, q) {
        var n = Math.floor(actx.sampleRate * len), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
        var s = actx.createBufferSource(), fl = actx.createBiquadFilter(), g = actx.createGain(); s.buffer = b;
        fl.type = 'bandpass'; fl.Q.value = q || 1.5; fl.frequency.setValueAtTime(f0, t + at); fl.frequency.exponentialRampToValueAtTime(f1, t + at + len);
        g.gain.value = vol; s.connect(fl); fl.connect(g); g.connect(actx.destination); s.start(t + at);
      };
      switch (kind) {
        case 'tick': tone('triangle', 1500, 600, 0, 0.045, 0.07); break;
        case 'beat': tone('sine', 90, 55, 0, 0.16, 0.14); tone('sine', 80, 50, 0.17, 0.2, 0.1); break;
        case 'yama': tone('sine', 220, 0, 0, 1.2, 0.1); tone('sine', 330, 0, 0.02, 1.0, 0.05); break;
        case 'danger': tone('sine', 196, 185, 0, 0.5, 0.06); break;
        case 'throw': noise(0, 0.28, 2600, 5200, 0.14, 2.2); break;
        case 'hit': tone('triangle', 260, 110, 0, 0.14, 0.14); break;
        case 'safe': tone('sine', 523, 0, 0, 0.18, 0.07); tone('sine', 659, 0, 0.1, 0.3, 0.07); break;
        case 'fake': tone('sine', 392, 330, 0, 0.5, 0.06); break;
        case 'revive': noise(0, 0.35, 900, 4200, 0.12, 1.5); tone('sine', 523, 1568, 0.05, 0.45, 0.07); break;
        case 'stamp': tone('triangle', 180, 90, 0, 0.12, 0.13); noise(0, 0.12, 800, 300, 0.1, 1); break;
        case 'done': tone('sine', 660, 0, 0, 0.12, 0.1); tone('sine', 990, 0, 0.12, 0.4, 0.1); break;
        case 'pon': tone('sine', 880, 0, 0, 0.12, 0.08); break;
        case 'win': [523, 659, 784, 1047].forEach(function (f, i) { tone('triangle', f, 0, i * 0.09, 0.3, 0.09); }); tone('sine', 1568, 0, 0.36, 0.9, 0.08); tone('sine', 2093, 0, 0.42, 0.9, 0.05); break;
      }
    } catch (e) { /* 音が出なくても動作は続ける */ }
  }

  function mk(cls, parent, tag) { var e = document.createElement(tag || 'div'); e.className = cls; if (parent) parent.appendChild(e); return e; }
  function anim(el, frames, o) { try { return el.animate(frames, o); } catch (e) { return null; } }
  function shurikenEl(parent, color, size) {
    var s = mk('rfx-sh', parent); s.setAttribute('data-c', color || 'silver'); s.style.setProperty('--s', size + 'px'); return s;
  }
  var SHC = { odai: 'silver', order: 'silver', name: 'gold', batsu: 'red' };

  // 順番の表（表示ページ・操作画面の右側）。list は 1番から順の名前
  function orderList(party, list, nTotal) {
    var box = party.querySelector(':scope > .rfx-order') || mk('rfx-order', party);
    if (party === document.body) box.classList.add('fixed');
    box.innerHTML = '';
    mk('rfx-order-h', box, 'b').textContent = '順番';
    var ol = mk('rfx-order-ol', box, 'ol');
    (list || []).forEach(function (lab, i) {
      var li = mk('rfx-order-li' + (i === list.length - 1 ? ' new' : ''), ol, 'li');
      mk('rfx-order-n', li, 'b').textContent = (i + 1) + '番';
      mk('rfx-order-t', li, 'span').textContent = lab;
    });
    if (nTotal && list && list.length >= nTotal) box.classList.add('full'); else box.classList.remove('full');
    var last = ol.lastElementChild; if (last && last.animate) last.animate([{ transform: 'translateX(12px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'ease-out' });
    return box;
  }
  function clearOrder(party) { var b = party && party.querySelector(':scope > .rfx-order'); if (b) b.remove(); }

  /* ---------- 演出の本体（両方の画面） ----------
     ctx: { wheel, host, party, kusuAt（当選の札・くす玉を出す真上の要素）, yamaAt（待ちの札の置き場所）, sound, isView,
            onFake(番号), onResult(番号, plan), onYama(true|false), onAutoGo() }
     戻り値: { skip(), go(), waiting(), playing(), destroy() } */
  function play(ctx, p) {
    var R = ctx.wheel, W = R.W, host = ctx.host, party = ctx.party || document.body;
    var timers = [], anims = [], nodes = [], bq = [], done = false, decided = false, muted = false, resumed = false, waiting = false, beatT = null;
    var k = p.k || 1, mode = p.mode || 'odai', color = SHC[mode] || 'silver';
    var snd = function (kind) { if (ctx.sound) sound(kind); };
    var tStall = p.hitT - p.stall, tThrow = p.hitT - Math.round((mode === 'odai' || mode === 'order' ? 260 : 340) * k);
    var tAim = Math.max(0, Math.min(tStall - 500 * k, tThrow - 700 * k));
    var resumedAt = 0;
    var at0 = function (ms, fn) { timers.push(setTimeout(function () { if (!done) fn(); }, Math.max(0, ms))); };
    var at = function (t, fn) { if (t < tStall || resumed) at0(resumed ? t - tStall - (Date.now() - resumedAt) : t, fn); else bq.push({ t: t, fn: fn }); };
    var A = function (el, fr, o) { var a = anim(el, fr, o); if (a) anims.push(a); return a; };
    var node = function (n) { nodes.push(n); return n; };
    var wEl = W.el, disc = wEl.querySelector('.k-wheel-disc');
    R.clearStar(host); clearStuck(wEl);
    wEl.classList.add('rfx-on'); host.classList.add('rfx-host');
    wEl.classList.remove('rfx-won', 'rfx-won-star');
    wEl.setAttribute('data-rfx-mode', mode);
    function wheelBox() { var wr = wEl.getBoundingClientRect(), hr = host.getBoundingClientRect(), sc = wr.width / (wEl.offsetWidth || wr.width), dw = disc.clientWidth * sc, off = (wr.width - dw) / 2; return { x: wr.left - hr.left + off, y: wr.top - hr.top + off, w: dw }; }
    function screenPt(phi, frac) { var b = wheelBox(), c = b.w / 2, r = c * 0.94 * (frac || p.r), t = phi * Math.PI / 180; return { x: b.x + c + Math.sin(t) * r, y: b.y + c - Math.cos(t) * r }; }
    function size() { return Math.max(30, wheelBox().w * 0.14); }
    function stuckAt(pos, rot, c2) {
      var c = disc.clientWidth / 2, r = c * 0.94 * p.r, t = pos * Math.PI / 180;
      var s = shurikenEl(disc, c2, size()); s.classList.add('rfx-stuck');
      s.style.left = (c + Math.sin(t) * r) + 'px'; s.style.top = (c - Math.cos(t) * r) + 'px';
      s.style.transform = 'translate(-50%,-50%) rotate(' + rot + 'deg)';
      return s;
    }
    function burst(pt, big) {
      var ring = mk('rfx-ring', host); ring.setAttribute('data-c', color); ring.style.left = pt.x + 'px'; ring.style.top = pt.y + 'px'; ring.style.setProperty('--a', size() * (big ? 2.2 : 1.5) + 'px');
      var ra = A(ring, [{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 }], { duration: 520, easing: 'ease-out', fill: 'both' });
      if (ra) ra.onfinish = function () { ring.remove(); }; else ring.remove(); nodes.push(ring);
    }
    function relTo(el, fx, fy) { var r = el.getBoundingClientRect(), pr = party === document.body ? { left: 0, top: 0 } : party.getBoundingClientRect(); return { x: r.left + r.width * fx - pr.left, y: r.top + r.height * fy - pr.top }; }

    // 狙いの輪と構えた手裏剣（お題・順番は構えずにすぐ飛んでくる）
    var aim = null, hold = null;
    at(tAim, function () {
      var pt = screenPt(p.phi);
      aim = node(mk('rfx-aim', host)); aim.style.left = pt.x + 'px'; aim.style.top = pt.y + 'px'; aim.style.setProperty('--a', size() * 1.15 + 'px');
      A(aim, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(1.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 220, fill: 'both' });
      if (mode === 'batsu' || mode === 'name' || p.hype) {
        var b = wheelBox(), hr = host.getBoundingClientRect(), s = size(), hx = Math.min(window.innerWidth - hr.left - s * 0.8, b.x + b.w + s), hy = b.y + b.w * 0.45;
        hold = node(shurikenEl(host, color, s * 1.3)); hold.classList.add('rfx-hold'); hold.style.left = hx + 'px'; hold.style.top = hy + 'px';
        A(hold, [{ opacity: 0, transform: 'translate(-50%,-50%) translateX(50px)' }, { opacity: 1, transform: 'translate(-50%,-50%) rotate(-30deg)' }], { duration: 240, fill: 'both' });
      }
    });

    // 止まりかけ（罰ゲーム・名前・盛り上げ）: 刻みの音を止める。盛り上げなら、ここで止まって待つ
    function stallStart() {
      if (p.stall > 0) muted = true;
      if (p.yama) { startYama(); return; }
      resume();
    }
    var yamaBox = null;
    function startYama() {
      waiting = true; ctx.onYama && ctx.onYama(true);
      snd('yama');
      yamaBox = node(mk('rfx-nen', party)); if (party === document.body) yamaBox.classList.add('fixed');
      mk('rfx-nen-t', yamaBox, 'b').textContent = mode === 'name' ? '誰に刺さる？' : mode === 'batsu' ? 'どの罰になる？' : 'どこに刺さる？';
      mk('rfx-nen-s', yamaBox).textContent = 'コメントで番号を予想！';
      var bar = mk('rfx-nen-bar', yamaBox), fill = mk('rfx-nen-fill', bar);
      if (ctx.yamaAt && ctx.yamaAt.offsetWidth) {
        var q = relTo(ctx.yamaAt, 0.74, 0.5); yamaBox.style.left = q.x + 'px'; yamaBox.style.top = q.y + 'px'; yamaBox.classList.add('at');
        var bw = yamaBox.offsetWidth, pw = party === document.body ? window.innerWidth : party.clientWidth;
        var lx = q.x;
        if (hold) { var hb = hold.getBoundingClientRect(), pr0 = party === document.body ? { left: 0 } : party.getBoundingClientRect(); lx = Math.max(lx, hb.right - pr0.left + 10 + bw / 2); }   // 構えた手裏剣を隠さない
        if (lx + bw / 2 > pw - 10) lx = pw - 10 - bw / 2;
        yamaBox.style.left = lx + 'px';
      }
      var ty = yamaBox.classList.contains('at') ? '-50%' : '0';
      A(yamaBox, [{ opacity: 0, transform: 'translate(-50%,' + ty + ') scale(.85)' }, { opacity: 1, transform: 'translate(-50%,' + ty + ') scale(1)' }], { duration: 240, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'both' });
      A(fill, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: p.yamaMax, easing: 'linear', fill: 'both' });
      beatT = setInterval(function () { if (!done) { snd('beat'); A(wEl, [{ transform: 'scale(1)' }, { transform: 'scale(1.02)', offset: 0.25 }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' }); } }, 900);
      // 表示ページは操作画面の「進む」を待ち、届かなければ5秒で自分で進む
      at0(p.yamaMax + (ctx.isView ? 2000 : 0), function () { if (waiting) { ctx.onAutoGo && ctx.onAutoGo(); go(); } });
    }
    function go() {
      if (!waiting || done) return;
      waiting = false; clearInterval(beatT); ctx.onYama && ctx.onYama(false);
      if (yamaBox) { var yb = yamaBox; A(yb, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }); at0(200, function () { yb.remove(); }); }
      resume();
    }
    var e = easeOf(p), fsT = tStall / p.dur, eS = e(fsT), A1 = p.from + (p.to - p.from) * eS;
    function resume() {
      if (resumed) return; resumed = true; resumedAt = Date.now();
      bq.forEach(function (q) { at0(q.t - tStall, q.fn); }); bq = [];
      W.spin(A1, p.to, p.dur - tStall, function () { landed(); }, {
        ease: function (v) { var tt = fsT + v * (1 - fsT); return (e(tt) - eS) / (1 - eS); }, onTick: function () {}, onFrame: frame
      });
    }

    // 投げる
    at(tThrow, function () {
      var pt = screenPt(p.phi), from = hold ? { x: parseFloat(hold.style.left), y: parseFloat(hold.style.top) } : { x: pt.x + wheelBox().w * 0.9, y: pt.y - wheelBox().w * 0.45 };
      if (hold) { hold.remove(); hold = null; }
      var fly = node(shurikenEl(host, color, size())); fly.classList.add('rfx-fly');
      fly.style.left = pt.x + 'px'; fly.style.top = pt.y + 'px';
      A(fly, [{ transform: 'translate(-50%,-50%) translate(' + (from.x - pt.x) + 'px,' + (from.y - pt.y) + 'px) rotate(0deg) scale(1.1)' }, { transform: 'translate(-50%,-50%) rotate(-1080deg) scale(1)' }], { duration: p.hitT - tThrow, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'forwards' });
      snd('throw');
    });
    // 刺さる（このとき狙いの下にあるマスが当たり）
    at(p.hitT, function () {
      [].slice.call(host.querySelectorAll('.rfx-fly')).forEach(function (f) { f.remove(); });
      if (aim) { aim.remove(); aim = null; }
      stuckAt(p.pos, -p.hitA + 12, color);
      snd('hit'); burst(screenPt(p.phi), mode !== 'odai' && mode !== 'order');
      host.classList.remove('rfx-danger');
    });

    // 盤（前半: 止まりかけまで）。刻みの音・番号を逆さにしない・罰ゲームは★が狙いに近いと赤く
    var lastSeg = W.at(p.from - p.phi), dangerOn = false;
    function frame() {
      var sgi = W.at(W.angle - p.phi);
      if (sgi !== lastSeg) { lastSeg = sgi; if (!muted) snd('tick'); }
      wEl.style.setProperty('--rfx-a', (-W.angle) + 'deg');
      if (mode === 'batsu' && !decided) {
        var nn = W.segs.length, near = isStar(W.items[sgi].label) || isStar(W.items[(sgi - 1 + nn) % nn].label);
        var slow = resumed || (Date.now() - t0) > tStall - 1400 * k;
        var on = near && slow && W.angle < p.hitA;
        if (on !== dangerOn) { dangerOn = on; host.classList.toggle('rfx-danger', on); if (on) snd('danger'); }
      }
    }
    var t0 = Date.now();
    W.spin(p.from, A1, tStall, function () { if (!done) stallStart(); }, { ease: function (u) { return e(u * fsT) / eS; }, onTick: function () {}, onFrame: frame });

    function landed() {
      if (done) return;
      wEl.style.setProperty('--rfx-a', (-p.to) + 'deg');
      W.mark(-1); host.classList.remove('rfx-danger');
      if (p.fake >= 0) {
        // まさかの1マス: となりに刺さって「セーフ…？」→ はね返って★へ
        W.mark(p.fake); snd('safe');
        ctx.onFake && ctx.onFake(p.fake, p);
        var sf = node(mk('rfx-safe', party, 'b')); sf.textContent = 'セーフ…？'; if (party === document.body) sf.classList.add('fixed');
        if (ctx.kusuAt && ctx.kusuAt.offsetWidth) { var q = relTo(ctx.kusuAt, 0.5, 0.5); sf.style.left = q.x + 'px'; sf.style.top = q.y + 'px'; }
        A(sf, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 200, fill: 'both' });
        at0(160 * k, function () { var st = disc.querySelector('.rfx-stuck'); if (st) A(st, [{ marginLeft: '0px' }, { marginLeft: '-3px' }, { marginLeft: '3px' }, { marginLeft: '0px' }], { duration: 120, iterations: 1 }); });
        at0(360 * k, function () {
          sf.remove();
          var st = disc.querySelector('.rfx-stuck'); if (st) st.remove();
          W.mark(-1); snd('revive');
          var a = screenPt(p.pos + p.to), sgW = W.segs[p.win], posW = (sgW.a0 + sgW.a1) / 2, b = screenPt(posW + p.to);
          var fly = node(shurikenEl(host, color, size())); fly.style.left = b.x + 'px'; fly.style.top = b.y + 'px';
          var up = Math.max(50, wheelBox().w * 0.3), f2 = 420 * k;
          A(fly, [{ transform: 'translate(-50%,-50%) translate(' + (a.x - b.x) + 'px,' + (a.y - b.y) + 'px) rotate(0) scale(1)' },
            { transform: 'translate(-50%,-50%) translate(' + ((a.x - b.x) / 2) + 'px,' + ((a.y - b.y) / 2 - up) + 'px) rotate(-540deg) scale(1.8)', offset: 0.5 },
            { transform: 'translate(-50%,-50%) rotate(-1080deg) scale(1)' }], { duration: f2, easing: 'cubic-bezier(.35,0,.5,1)', fill: 'forwards' });
          at0(f2, function () { fly.remove(); stuckAt(posW, -p.to + 12, color); snd('hit'); burst(b, 1); finish(p.win); });
        });
      } else finish(p.win);
    }
    function finish(idx) {
      if (decided) return; decided = true; waiting = false; clearInterval(beatT);
      W.mark(idx);
      wEl.classList.add('rfx-won'); if (p.star) wEl.classList.add('rfx-won-star');
      host.classList.remove('rfx-danger');
      if (!REDUCE) {
        if (mode === 'name') winCard();
        else if (mode === 'batsu') batsuCard();
        else if (mode === 'order') { if (p.order) orderList(party, p.order, p.n + (p.order.length - 1)); snd('pon'); }
        else snd('done');
      } else if (mode === 'order' && p.order) orderList(party, p.order, 0);
      ctx.onResult && ctx.onResult(idx, p);
      at0(3200, function () { done = true; cleanup(false); });
    }
    // 名前の抽選: 当選の札（名前を大きく）＋くす玉と紙吹雪。札は3秒で消え、結果の帯は残る
    function winCard() {
      snd('win');
      var bg = node(mk('rfx-party-bg', null)); party.insertBefore(bg, party.firstChild);
      var pa = node(mk('rfx-party', party));
      if (party === document.body) { pa.classList.add('fixed'); bg.classList.add('fixed'); }
      var fl0 = mk('rfx-party-flash', pa); mk('rfx-party-glow', bg); mk('rfx-party-rays', bg);
      A(fl0, [{ opacity: 0 }, { opacity: 0.6, offset: 0.25 }, { opacity: 0 }], { duration: 500, easing: 'ease-out', fill: 'both' });
      var card = mk('rfx-wincard', pa); mk('rfx-wc-h', card, 'b').textContent = '当選'; mk('rfx-wc-n', card, 'b').textContent = honorific(p.label);
      mk('rfx-wc-s', card).textContent = 'おめでとう！';
      if (ctx.kusuAt && ctx.kusuAt.offsetWidth) { var q = relTo(ctx.kusuAt, 0.5, 0.5); card.style.left = q.x + 'px'; card.style.top = q.y + 'px'; }
      A(card, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.06)', offset: 0.6 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 380, easing: 'ease-out', fill: 'both' });
      A(card, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 2800, fill: 'forwards' });
      confetti(pa, 40);
      A(bg.querySelector('.rfx-party-glow'), [{ opacity: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0.9, offset: 0.6 }, { opacity: 0 }], { duration: 3000, easing: 'ease-out', fill: 'both' });
      A(bg.querySelector('.rfx-party-rays'), [{ opacity: 0, transform: 'translate(-50%,-50%) rotate(0deg) scale(.6)' }, { opacity: 0.8, transform: 'translate(-50%,-50%) rotate(20deg) scale(1)', offset: 0.25 }, { opacity: 0, transform: 'translate(-50%,-50%) rotate(60deg) scale(1.1)' }], { duration: 3000, easing: 'ease-out', fill: 'both' });
    }
    // 罰ゲーム: 「罰ゲーム決定！」の判子を押す。★（きつい罰）は判子が大きく、盤が少し揺れる
    function batsuCard() {
      var card = node(mk('rfx-batsu' + (p.star ? ' star' : ''), party)); if (party === document.body) card.classList.add('fixed');
      mk('rfx-bt-h', card, 'b').textContent = '罰ゲーム決定！';
      mk('rfx-bt-n', card, 'b').textContent = String(p.label).replace(/[★☆]/g, '').trim();
      if (ctx.kusuAt && ctx.kusuAt.offsetWidth) { var q = relTo(ctx.kusuAt, 0.5, 0.5); card.style.left = q.x + 'px'; card.style.top = q.y + 'px'; }
      A(card, [{ opacity: 0, transform: 'translate(-50%,-50%) rotate(-6deg) scale(2.2)' }, { opacity: 1, transform: 'translate(-50%,-50%) rotate(-6deg) scale(.94)', offset: 0.6 }, { opacity: 1, transform: 'translate(-50%,-50%) rotate(-6deg) scale(1)' }], { duration: 300, easing: 'ease-in', fill: 'both' });
      at0(200, function () { snd('stamp'); });
      if (p.star) {
        var fl0 = node(mk('rfx-party-flash', party)); if (party === document.body) fl0.classList.add('fixed'); fl0.style.position = party === document.body ? 'fixed' : 'absolute'; fl0.style.zIndex = 49;
        A(fl0, [{ opacity: 0 }, { opacity: 0.45, offset: 0.3 }, { opacity: 0 }], { duration: 500, delay: 200, easing: 'ease-out', fill: 'both' });
        A(wEl, [{ transform: 'translate(0,0)' }, { transform: 'translate(-5px,2px)' }, { transform: 'translate(4px,-2px)' }, { transform: 'translate(-2px,1px)' }, { transform: 'translate(0,0)' }], { duration: 420, delay: 220, easing: 'ease-out' });
      }
      A(card, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 2800, fill: 'forwards' });
    }
    function confetti(pa, n) {
      var Wd = pa.clientWidth || window.innerWidth, H = pa.clientHeight || window.innerHeight;
      for (var i = 0; i < n; i++) {
        var c = mk('rfx-conf', pa), x = ((i * 61) % 100) / 100 * Wd, s = Math.max(9, Math.min(Wd, H) * 0.022) * (0.7 + ((i * 17) % 10) / 15);
        c.setAttribute('data-k', ['kin', 'momiji', 'red', 'orange', 'cream', 'kin'][i % 6]);
        c.style.left = x + 'px'; c.style.setProperty('--c', s + 'px');
        A(c, [{ transform: 'translate(0,-' + s * 2 + 'px) rotate(0)' }, { transform: 'translate(' + (((i * 29) % 7) - 3) * s + 'px,' + (H + s * 2) + 'px) rotate(' + (360 + (i * 47) % 360) + 'deg)' }],
          { duration: 2200 + (i * 131) % 1100, delay: (i * 37) % 500, easing: 'cubic-bezier(.3,.2,.7,1)', fill: 'both' });
      }
    }
    function cleanup(all) {
      timers.forEach(clearTimeout); timers = []; bq = []; clearInterval(beatT);
      anims.forEach(function (a) { try { if (all || a.playState !== 'finished') a.cancel(); } catch (e2) {} }); anims = [];
      nodes.forEach(function (n) { if (n.parentNode) n.remove(); }); nodes = [];
      host.classList.remove('rfx-danger'); wEl.style.transform = '';
    }
    var ctl = {
      playing: function () { return !done && !decided; },
      waiting: function () { return waiting; },
      go: go,
      skip: function () {
        if (decided) { done = true; cleanup(true); return; }
        cleanup(true); muted = true; waiting = false; resumed = true; ctx.onYama && ctx.onYama(false);
        W.spin(p.to, p.to, 0); wEl.style.setProperty('--rfx-a', (-p.to) + 'deg');
        clearStuck(wEl);
        var sgW = W.segs[p.win], posIn = p.fake >= 0 ? (sgW.a0 + sgW.a1) / 2 : p.pos;
        stuckAt(posIn, -p.to + 12, color);
        finish(p.win);
      },
      destroy: function () { done = true; cleanup(true); }
    };
    if (REDUCE) ctl.skip();
    return ctl;
  }
  function clearStuck(wEl) { [].slice.call(wEl.querySelectorAll('.rfx-stuck')).forEach(function (s) { s.remove(); }); }
  function still(R, p) {
    var W = R.W, wEl = W.el, disc = wEl.querySelector('.k-wheel-disc');
    clearStuck(wEl); wEl.classList.add('rfx-on');
    W.spin(p.to, p.to, 0); W.mark(p.win); wEl.style.setProperty('--rfx-a', (-p.to) + 'deg');
    var sg = W.segs[p.win]; if (!sg) return;
    var pos = p.fake >= 0 ? (sg.a0 + sg.a1) / 2 : p.pos, c = disc.clientWidth / 2, r = c * 0.94 * (p.r || 0.6), t = pos * Math.PI / 180;
    var s = shurikenEl(disc, SHC[p.mode] || 'silver', Math.max(30, wEl.clientWidth * 0.14)); s.classList.add('rfx-stuck');
    s.style.left = (c + Math.sin(t) * r) + 'px'; s.style.top = (c - Math.cos(t) * r) + 'px'; s.style.transform = 'translate(-50%,-50%) rotate(' + (-p.to + 12) + 'deg)';
  }
  // ★のマス（罰ゲームのきつい罰）のふち・マスの番号（盤を作り直したら呼ぶ）
  function tagStars(R) {
    var W = R.W, el = W.el, disc = el.querySelector('.k-wheel-disc'), paths = el.querySelectorAll('.k-wheel-disc svg > g:first-child > path');
    W.items.forEach(function (it, i) { if (paths[i]) paths[i].classList.toggle('rfx-starcell', isStar(it.label)); });
    [].slice.call(disc.querySelectorAll('.rfx-num')).forEach(function (b) { b.remove(); });
    if (R.noNums) return;
    W.segs.forEach(function (sg, i) {
      var mid = (sg.a0 + sg.a1) / 2, t = mid * Math.PI / 180, r = 0.47 * 0.94;
      var b = mk('rfx-num' + (isStar(W.items[i].label) ? ' star' : ''), disc, 'b'); b.textContent = i + 1;
      b.style.left = (50 + Math.sin(t) * r * 100) + '%'; b.style.top = (50 - Math.cos(t) * r * 100) + '%';
    });
    el.style.setProperty('--rfx-a', (-W.angle) + 'deg');
  }

  window.KkpRfx = { honorific: honorific, plan: plan, play: play, still: still, tagStars: tagStars, isStar: isStar, sound: sound, MODES: MODES, orderList: orderList, clearOrder: clearOrder, reduce: REDUCE, YAMA_MAX: YAMA_MAX };
})();
