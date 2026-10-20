/* kkp-kit 共通の動き（D4）。<script src="kit/kit.js" defer></script> で読む。
   - 季節: <html data-k-season="..."> を月で付ける（10〜11月=紅葉 / 12月=雪 / 1月=松竹梅 / 3〜4月=桜）。?season=momiji で確認できる
   - 墨のはね: .k-btn と .k-ink-on を押すと墨の粒が6つはねる
   - 霞の奥行き: .k-par を付けた飾りがスクロールでほんの少し遅れて動く
   - 動き: .k-play-on を付けた要素が画面に入ったら .k-play を付ける（巻物・判子のアニメ）
   - 演出の部品: KKit.fx.slash（札を刀で斬る）・KKit.fx.shuriken（手裏剣が飛んできて刺さる）。下の fxParts を見る
   動きを減らす設定（prefers-reduced-motion）では、季節以外は何もしない（演出の部品は動かさずに、すぐ結果の合図だけ出す）。 */
(function () {
  var root = document.documentElement;
  var m = /[?&]season=([a-z]+)/.exec(location.search);
  var month = new Date().getMonth() + 1;
  var season = m ? m[1] : ({ 10: 'momiji', 11: 'momiji', 12: 'yuki', 1: 'shochikubai', 3: 'sakura', 4: 'sakura' }[month] || '');
  if (season) root.setAttribute('data-k-season', season);

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  fxParts();
  if (reduce) return;

  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('.k-btn,.k-ink-on');
    if (!b) return;
    for (var k = 0; k < 6; k++) {
      var d = document.createElement('span');
      d.className = 'k-ink';
      var a = Math.PI * 2 * k / 6 + Math.random() * .6, r = 18 + Math.random() * 16;
      d.style.left = e.pageX + 'px';
      d.style.top = e.pageY + 'px';
      d.style.setProperty('--dx', Math.cos(a) * r + 'px');
      d.style.setProperty('--dy', Math.sin(a) * r + 'px');
      document.body.appendChild(d);
      setTimeout(function (x) { return function () { x.remove(); }; }(d), 600);
    }
  }, { passive: true });

  function start() {
    var pars = document.querySelectorAll('.k-par'), ticking = false;
    if (pars.length) {
      var par = function () {
        ticking = false;
        var k = window.innerWidth < 600 ? .03 : .06;
        pars.forEach(function (el) {
          var box = el.parentNode.getBoundingClientRect();
          el.style.transform = 'translateY(' + (-box.top * k).toFixed(1) + 'px)';
        });
      };
      window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(par); } }, { passive: true });
      par();
    }
    var plays = document.querySelectorAll('.k-play-on');
    if (plays.length && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('k-play'); io.unobserve(e.target); } });
      }, { threshold: .1 });
      plays.forEach(function (el) { io.observe(el); });
    } else {
      plays.forEach(function (el) { el.classList.add('k-play'); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  /* ===== 演出の部品 =====
     どのサイトでも1行で呼べる形。絵は kit.css が img/ から読む（JS は絵の場所を知らない）。
     長さ: speed に 'short'（0.6倍）・'normal'・'long'（1.5倍）か倍率の数。音は鳴らさず opts.sound(種類) で呼び出し側に知らせる。
     動きを減らす設定のときは、何も描かずに onCut / onHit / onDone をすぐ呼ぶ（結果だけ一瞬で出る）。

     KKit.fx.slash(host, opts)   host は position のある箱。札が出る → 刀が一閃 → 札が斜めに斬れて左右へ → 消える
       opts: speed / wait（斬るまでの溜め ms・既定 450）/ size（札の幅 px）/ color（印の色）/ ang（斬る角度・既定 25）
             onCut（斬れた瞬間。ここで結果を出す）/ onDone / sound('fuda'|'slash')
       戻り値: { tint(色, グラデ), cut()（溜めを飛ばしてすぐ斬る）, skip()（演出を消して onCut・onDone）, destroy() }
     KKit.fx.shuriken(host, opts) 手裏剣が画面の外から回りながら飛んできて (x, y) に刺さる。刺さったまま残る
       opts: x, y（host の中の px）/ size / speed / from（'right'|'left'|'top'・既定 'right'）/ onHit / sound('throw'|'hit')
       戻り値: { remove() }
     KKit.fx.clear(host)  host の中の演出を全部消す
     KKit.fx.ms(基準ms, speed)  長さの倍率をかけた ms（呼び出し側で時間を合わせるとき） */
  function fxParts() {
    var K = window.KKit = window.KKit || {};
    var SP = { short: 0.6, normal: 1, long: 1.5 };
    function k(sp) { return typeof sp === 'number' ? sp : (SP[sp] || 1); }
    function ms(base, sp) { return Math.round(base * k(sp)); }
    function mk(cls, parent) { var e = document.createElement('div'); e.className = cls; if (parent) parent.appendChild(e); return e; }
    function anim(el, frames, o) { try { return el.animate(frames, o); } catch (e) { return null; } }
    function call(f, a) { if (typeof f === 'function') try { f(a); } catch (e) { /* 呼び出し側の失敗で演出を止めない */ } }

    function clear(host) {
      if (!host) return;
      [].slice.call(host.querySelectorAll(':scope > .k-fx')).forEach(function (n) { if (n._kfx) n._kfx.destroy(); else n.remove(); });
    }

    function slash(host, o) {
      o = o || {};
      var done = false, cut = false, timers = [], root = null;
      var h = { tint: function () {}, cut: function () {}, skip: function () {}, destroy: function () {} };
      function finishCut() { if (cut) return; cut = true; call(o.onCut); }
      function finish() { if (done) return; done = true; finishCut(); call(o.onDone); }
      if (reduce || !host) { setTimeout(finish, 0); h.skip = finish; return h; }
      var W = host.clientWidth || 600, H = host.clientHeight || 400;
      var fw = o.size || Math.max(80, Math.min(W * 0.26, H * 0.62 / 1.5));
      var ang = o.ang == null ? 25 : o.ang;
      root = mk('k-fx', host);
      root.style.setProperty('--k-fx-w', fw + 'px');
      root.style.setProperty('--k-fx-ang', ang + 'deg');
      root.style.setProperty('--k-fx-len', Math.hypot(W, H) * 1.2 + 'px');
      root.style.setProperty('--k-fx-bw', fw * 2.1 + 'px');
      root.style.setProperty('--k-fx-ll', fw * 1.9 + 'px');
      root.style.setProperty('--k-fx-lh', Math.max(3, fw * 0.025) + 'px');
      if (o.color) root.style.setProperty('--k-fx-c', o.color);
      var fuda = mk('k-fx-fuda', root), halves = [];
      ['a', 'b'].forEach(function (c) { var hf = mk('k-fx-half ' + c, fuda), f = mk('k-fx-face', hf); mk('k-fx-seal', f); halves.push(hf); });
      var track = mk('k-fx-track', root), line = mk('k-fx-line', track), blade = mk('k-fx-blade', track);
      function at(t, fn) { timers.push(setTimeout(fn, t)); }
      // 1) 札が上から下りてくる
      anim(fuda, [{ transform: 'translate(-50%,-80%) rotate(-4deg)', opacity: 0 }, { transform: 'translate(-50%,-48%) rotate(1deg)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%,-50%)', opacity: 1 }], { duration: ms(380, o.speed), easing: 'cubic-bezier(.2,.8,.3,1.2)', fill: 'both' });
      call(o.sound, 'fuda');
      var waitT = ms(380, o.speed) + (o.wait == null ? ms(450, o.speed) : o.wait), cutT = null;
      function doCut() {
        if (cutT !== null || done) return;
        timers.forEach(clearTimeout); timers = [];
        var sw = ms(240, o.speed);
        cutT = sw;
        // 2) 刀が一閃（左上から右下へ）と光の筋
        anim(blade, [{ left: '0%', opacity: 1 }, { left: '100%', opacity: 1, offset: 0.85 }, { left: '112%', opacity: 0 }], { duration: sw, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'both' });
        anim(line, [{ transform: 'translateY(-50%) scaleX(0)', opacity: 1 }, { transform: 'translateY(-50%) scaleX(1)', opacity: 1, offset: 0.55 }, { transform: 'translateY(-50%) scaleX(1)', opacity: 0 }], { duration: sw + ms(260, o.speed), easing: 'ease-out', fill: 'both' });
        call(o.sound, 'slash');
        // 3) 札が斜めにずれて左右へ離れ、消える（ここで結果を出す）
        at(Math.round(sw * 0.6), function () {
          var r = ang * Math.PI / 180, dx = Math.cos(r) * fw * 0.18, dy = Math.sin(r) * fw * 0.18, nx = Math.sin(r) * fw * 0.32, ny = Math.cos(r) * fw * 0.32;
          var d = ms(520, o.speed);
          anim(halves[0], [{ transform: 'none', opacity: 1 }, { transform: 'translate(' + (-dx * 0.4) + 'px,' + (-dy * 0.4) + 'px)', opacity: 1, offset: 0.25 }, { transform: 'translate(' + (-dx + nx) + 'px,' + (-dy - ny) + 'px) rotate(-7deg)', opacity: 0 }], { duration: d, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' });
          anim(halves[1], [{ transform: 'none', opacity: 1 }, { transform: 'translate(' + (dx * 0.4) + 'px,' + (dy * 0.4) + 'px)', opacity: 1, offset: 0.25 }, { transform: 'translate(' + (dx - nx) + 'px,' + (dy + ny + fw * 0.2) + 'px) rotate(6deg)', opacity: 0 }], { duration: d, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' });
          finishCut();
          at(d, function () { if (root && root.parentNode) root.remove(); finish(); });
        });
      }
      at(waitT, doCut);
      h.tint = function (c, g) {
        if (!root) return;
        if (c) root.style.setProperty('--k-fx-c', c);
        if (g) root.style.setProperty('--k-fx-g', g); else root.style.removeProperty('--k-fx-g');
        var ring = mk('k-fx-ring', root);
        var a = anim(ring, [{ transform: 'translate(-50%,-50%) scale(.6)', opacity: .9 }, { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 }], { duration: 520, easing: 'ease-out', fill: 'both' });
        if (a) a.onfinish = function () { ring.remove(); }; else ring.remove();
        anim(fuda, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.06)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 260, easing: 'ease-out' });
      };
      h.cut = doCut;
      h.destroy = function () { timers.forEach(clearTimeout); timers = []; done = true; if (root && root.parentNode) root.remove(); };
      h.skip = function () { h.destroy(); done = false; finish(); };
      root._kfx = h;
      return h;
    }

    function shuriken(host, o) {
      o = o || {};
      var h = { remove: function () {} };
      if (reduce || !host) { setTimeout(function () { call(o.onHit); }, 0); return h; }
      var W = host.clientWidth || 600, H = host.clientHeight || 400, s = o.size || Math.max(40, Math.min(W, H) * 0.12);
      var root = mk('k-fx', host);
      root.style.setProperty('--k-fx-s', s + 'px');
      var x = o.x == null ? W / 2 : o.x, y = o.y == null ? H / 2 : o.y;
      var star = mk('k-fx-star', root), hit = mk('k-fx-hit', root);
      star.style.left = hit.style.left = x + 'px'; star.style.top = hit.style.top = y + 'px';
      var from = o.from || 'right', sx, sy;
      if (from === 'left') { sx = -x - s; sy = -Math.min(y, H * 0.3); }
      else if (from === 'top') { sx = W * 0.1; sy = -y - s; }
      else { sx = W - x + s; sy = -Math.min(y + s, H * 0.35); }
      var fl = ms(420, o.speed), endRot = 16 + Math.random() * 20;
      call(o.sound, 'throw');
      var a = anim(star, [{ transform: 'translate(' + sx + 'px,' + sy + 'px) rotate(-900deg) scale(.8)' }, { transform: 'translate(0,0) rotate(' + endRot + 'deg) scale(1.12)', offset: 0.9 }, { transform: 'translate(0,0) rotate(' + endRot + 'deg) scale(1)' }], { duration: fl, easing: 'cubic-bezier(.25,.6,.35,1)', fill: 'both' });
      var hitDone = false;
      function onHit() {
        if (hitDone) return; hitDone = true;
        call(o.sound, 'hit');
        anim(hit, [{ transform: 'scale(.5)', opacity: .8 }, { transform: 'scale(1.9)', opacity: 0 }], { duration: 420, easing: 'ease-out', fill: 'both' });
        anim(star, [{ transform: 'rotate(' + endRot + 'deg) scale(1)' }, { transform: 'rotate(' + (endRot - 4) + 'deg) scale(.96)' }, { transform: 'rotate(' + endRot + 'deg) scale(1)' }], { duration: 180, fill: 'forwards' });
        call(o.onHit);
      }
      if (a) a.onfinish = onHit; else onHit();
      setTimeout(onHit, fl + 60);   // 背景のタブなどで onfinish が来ないときの保険
      h.remove = function () { if (root.parentNode) root.remove(); };
      h.destroy = h.remove;
      root._kfx = h;
      return h;
    }

    K.fx = { slash: slash, shuriken: shuriken, clear: clear, ms: ms, speed: k, reduce: !!reduce };
  }
})();
