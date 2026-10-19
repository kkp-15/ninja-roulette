/* お題ガチャ: 抽選と演出（操作画面 /odai-gacha/ と OBS表示 /view/ で共通）
   演出は CSS と canvas だけ（動画・画像・音源ファイルなし）。
   光の配慮: 全画面の白いフラッシュは1回の演出で1度だけ（1秒に3回を超えない）。「控えめ」はフラッシュ・画面の揺れなし。 */
(function () {
  'use strict';
  var RAR = ['N', 'R', 'SR', 'SSR'];
  var RATES = { N: 55, R: 30, SR: 12, SSR: 3 };
  var COLOR = { N: '#8f9aa6', R: '#2f7de1', SR: '#f0a400', SSR: '#ff3d7f' };
  var LABEL = { N: 'N', R: 'R', SR: 'SR', SSR: 'SSR' };
  var RAINBOW = ['#ff4d4d', '#ff9f1a', '#ffe14d', '#3ddc84', '#3d9bff', '#a45bff'];
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
  function noise(dur, vol) {
    var a = ac(); if (!a) return;
    var n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    var s = a.createBufferSource(), g = a.createGain(); s.buffer = b; g.gain.value = vol || 0.15; s.connect(g); g.connect(a.destination); s.start();
  }
  function sfx(kind, lv) {
    try {
      if (kind === 'count') tone(620, 0, 0.12, 'square', 0.05);
      else if (kind === 'go') tone(930, 0, 0.18, 'square', 0.06);
      else if (kind === 'drop') { tone(300, 0, 0.12, 'sine', 0.12); tone(170, 0.08, 0.16, 'sine', 0.12); }
      else if (kind === 'step') { var f = [0, 523, 659, 880][lv] || 523; tone(f, 0, 0.16, 'triangle', 0.1); tone(f * 1.5, 0.08, 0.2, 'triangle', 0.08); }
      else if (kind === 'crack') noise(0.28, 0.16);
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
    '.kg canvas{position:absolute;inset:0;width:100%;height:100%}',
    '.kg-count{position:absolute;left:50%;top:50%;font-size:calc(var(--u)*26);font-weight:900;line-height:1;color:#ffd23f;text-shadow:' + OL + ',.06em .08em 0 #2b2b2b;transform:translate(-50%,-50%);animation:kgPop .3s ease-out both}',
    '@keyframes kgPop{0%{transform:translate(-50%,-50%) scale(2.2);opacity:0}45%{opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}',
    '.kg-cap{position:absolute;left:50%;top:50%;width:calc(var(--u)*30);height:calc(var(--u)*30);margin:calc(var(--u)*-15) 0 0 calc(var(--u)*-15)}',
    '.kg-cap.drop{animation:kgDrop .45s cubic-bezier(.3,1.5,.6,1) both}',
    '@keyframes kgDrop{0%{transform:translateY(-140%) scale(.6)}100%{transform:none}}',
    '.kg-cap.wob .kg-body{animation:kgWob .32s ease-in-out infinite}',
    '.kg-cap.hard .kg-body{animation:kgWob2 .12s linear infinite}',
    '@keyframes kgWob{0%,100%{transform:rotate(0)}25%{transform:rotate(-9deg)}75%{transform:rotate(9deg)}}',
    '@keyframes kgWob2{0%,100%{transform:translate(0,0) rotate(0)}25%{transform:translate(-2%,1%) rotate(-5deg)}75%{transform:translate(2%,-1%) rotate(5deg)}}',
    '.kg-body{position:absolute;inset:0}',
    '.kg-aura{position:absolute;inset:-35%;border-radius:50%;background:radial-gradient(circle,var(--c) 0%,transparent 62%);opacity:.0;transition:opacity .3s}',
    '.kg-aura.on{opacity:.75}',
    '.kg-aura.rb{background:conic-gradient(from 0deg,#ff4d4d,#ff9f1a,#ffe14d,#3ddc84,#3d9bff,#a45bff,#ff4d4d);-webkit-mask:radial-gradient(circle,#000 30%,transparent 64%);mask:radial-gradient(circle,#000 30%,transparent 64%);animation:kgSpin 1.2s linear infinite}',
    '@keyframes kgSpin{to{transform:rotate(360deg)}}',
    '.kg-half{position:absolute;left:0;width:100%;height:50%;border:calc(var(--u)*.9) solid #2b2b2b;box-sizing:border-box;transition:transform .5s cubic-bezier(.2,.8,.3,1),opacity .5s}',
    '.kg-top{top:0;border-radius:999px 999px 0 0;border-bottom-width:calc(var(--u)*.45);background:var(--c);box-shadow:inset calc(var(--u)*-2) calc(var(--u)*2) 0 rgba(255,255,255,.35);transition:background .25s,transform .5s cubic-bezier(.2,.8,.3,1),opacity .5s}',
    '.kg-bot{bottom:0;border-radius:0 0 999px 999px;border-top-width:calc(var(--u)*.45);background:#fff}',
    '.kg-cap.rb .kg-top{background:linear-gradient(120deg,#ff4d4d,#ff9f1a,#ffe14d,#3ddc84,#3d9bff,#a45bff);background-size:300% 100%;animation:kgRb .8s linear infinite}',
    '@keyframes kgRb{to{background-position:300% 0}}',
    '.kg-cap.open .kg-top{transform:translate(-30%,-90%) rotate(-32deg);opacity:0}',
    '.kg-cap.open .kg-bot{transform:translate(25%,90%) rotate(24deg);opacity:0}',
    '.kg-ring{position:absolute;left:50%;top:50%;width:calc(var(--u)*30);height:calc(var(--u)*30);margin:calc(var(--u)*-15) 0 0 calc(var(--u)*-15);border-radius:50%;border:calc(var(--u)*1.2) solid var(--c);animation:kgRing .6s ease-out forwards}',
    '@keyframes kgRing{0%{transform:scale(.7);opacity:.95}100%{transform:scale(2.6);opacity:0}}',
    '.kg-band{position:absolute;top:-20%;bottom:-20%;left:-70%;width:55%;transform:skewX(-18deg);background:linear-gradient(90deg,transparent,rgba(255,77,77,.5),rgba(255,159,26,.55),rgba(255,225,77,.6),rgba(61,220,132,.55),rgba(61,155,255,.55),rgba(164,91,255,.5),transparent);animation:kgSweep .9s ease-in-out forwards}',
    '.kg-band.h{top:auto;left:-10%;right:-10%;width:auto;height:18%;transform:none;animation:kgBandH 1s ease-out forwards}',
    '@keyframes kgSweep{to{left:120%}}',
    '@keyframes kgBandH{0%{transform:scaleX(0);opacity:0}30%{transform:scaleX(1);opacity:.9}100%{transform:scaleX(1);opacity:0}}',
    '.kg-flash{position:absolute;inset:0;background:#fff;opacity:0;animation:kgFlash .5s ease-out forwards}',
    '@keyframes kgFlash{0%{opacity:0}25%{opacity:.7}100%{opacity:0}}',
    '.kg-in.shake{animation:kgShake .4s linear}',
    '@keyframes kgShake{0%,100%{transform:none}20%{transform:translate(1.2%,-.8%)}40%{transform:translate(-1%,.9%)}60%{transform:translate(.8%,.6%)}80%{transform:translate(-.5%,-.4%)}}',
    '.kg-big{position:absolute;left:50%;top:50%;font-size:calc(var(--u)*30);font-weight:900;line-height:1;letter-spacing:.04em;background:linear-gradient(90deg,#ff4d4d,#ff9f1a,#ffe14d,#3ddc84,#3d9bff,#a45bff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(.03em .03em 0 #2b2b2b) drop-shadow(-.03em -.03em 0 #2b2b2b) drop-shadow(.03em -.03em 0 #2b2b2b) drop-shadow(-.03em .03em 0 #2b2b2b) drop-shadow(.05em .07em 0 #2b2b2b);transform:translate(-50%,-50%);animation:kgBig .8s cubic-bezier(.2,.9,.3,1.2) forwards}',
    '@keyframes kgBig{0%{transform:translate(-50%,-50%) scale(3);opacity:0}35%{transform:translate(-50%,-50%) scale(1);opacity:1}80%{opacity:1}100%{transform:translate(-50%,-50%) scale(1.15);opacity:0}}',
    '.kg-tlw{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 3%}',
    /* 結果テロップ（番組のテロップ・ゲームの結果画面の型）: 斜めの帯・極太・太い縁取り・硬い影 */
    '.tl{font-family:' + MARU + ';font-size:var(--th,48px);width:100%;max-width:100%;filter:drop-shadow(.09em .11em 0 #2b2b2b);text-align:left}',
    '.tl-head{display:flex;align-items:flex-end;gap:.25em;margin:0 0 -.04em .35em;position:relative;z-index:1}',
    '.tl-tag{display:inline-block;font-size:.6em;font-weight:900;line-height:1;padding:.14em .55em .16em;background:var(--c);color:#fff;border:.08em solid #2b2b2b;transform:skewX(-12deg);text-shadow:' + OL_S + ';letter-spacing:.04em}',
    '.tl-sub{display:inline-block;font-size:.34em;font-weight:900;line-height:1;padding:.32em .8em;background:#fff6ea;color:#2b2b2b;border:.12em solid #2b2b2b;transform:skewX(-12deg)}',
    '.tl-band{position:relative;background:linear-gradient(180deg,#f47b20 0%,#e2600f 55%,#c94f07 100%);border:.07em solid #2b2b2b;padding:.2em 1.1em .26em .6em;clip-path:polygon(0 0,100% 0,calc(100% - .7em) 100%,0 100%)}',
    '.tl-band:before{content:"";position:absolute;left:0;right:0;top:0;height:.1em;background:#ffd9a8}',
    '.tl.dark .tl-band{background:linear-gradient(180deg,#3a3a3a,#1f1f1f);border-color:#e2600f}',
    '.tl.dark .tl-band:before{background:#e2600f}',
    '.tl.SSR .tl-band:before{height:.14em;background:linear-gradient(90deg,#ff4d4d,#ff9f1a,#ffe14d,#3ddc84,#3d9bff,#a45bff)}',
    '.tl.SSR .tl-tag{background:linear-gradient(90deg,#ff4d4d,#ff9f1a,#e8c200,#2cc46f,#3d9bff,#a45bff);background-size:200% 100%;animation:kgRb 1.2s linear infinite}',
    '.tl-txt{display:block;color:#fff;font-weight:900;line-height:1.28;text-shadow:' + OL + ';word-break:break-word;overflow-wrap:anywhere}',
    '.tl.m .tl-txt{font-size:.82em}.tl.l .tl-txt{font-size:.68em}',
    '.tl.in .tl-band{animation:tlIn .38s cubic-bezier(.2,.9,.3,1.15) both}',
    '.tl.in .tl-head{animation:tlTag .38s .12s cubic-bezier(.2,.9,.3,1.4) both}',
    '@keyframes tlIn{0%{transform:translateX(-18%);opacity:0;clip-path:polygon(0 0,0 0,0 100%,0 100%)}100%{transform:none;opacity:1}}',
    '@keyframes tlTag{0%{transform:scale(.2);opacity:0}100%{transform:none;opacity:1}}',
    '@media (prefers-reduced-motion: reduce){.kg-cap.hard .kg-body,.kg-cap.wob .kg-body{animation-duration:.6s}}'
  ].join('\n');
  function injectCss() {
    if (document.getElementById('kg-css')) return;
    var st = document.createElement('style'); st.id = 'kg-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  /* ---------- canvas: 光の筋・光の粒・紙吹雪 ---------- */
  function Fx(canvas, lite) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.ps = []; this.rays = 0; this.raysTarget = 0; this.rayColor = '#fff'; this.rainbow = false; this.rot = 0; this.raf = 0; this.lite = lite; this.dead = false;
    this.fit();
  }
  Fx.prototype.fit = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5), w = this.c.clientWidth || 1, h = this.c.clientHeight || 1;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); this.w = w; this.h = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  Fx.prototype.kick = function () { var self = this; if (!this.raf && !this.dead) this.raf = requestAnimationFrame(function (t) { self.frame(t); }); };
  Fx.prototype.burst = function (n, colors, speed) {
    n = this.lite ? Math.round(n * 0.35) : n;
    var cx = this.w / 2, cy = this.h / 2, sp = (speed || 1) * Math.min(this.w, this.h) / 60;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random());
      this.ps.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.3, g: sp * 0.03, life: 1, dec: 0.008 + Math.random() * 0.01,
        c: colors[i % colors.length], s: (3 + Math.random() * 5) * Math.min(this.w, this.h) / 400, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, k: Math.random() < 0.45 ? 'dot' : 'sq' });
    }
    this.kick();
  };
  Fx.prototype.rain = function (n, colors) {
    n = this.lite ? Math.round(n * 0.35) : n;
    var u = Math.min(this.w, this.h) / 400;
    for (var i = 0; i < n; i++) {
      this.ps.push({ x: Math.random() * this.w, y: -Math.random() * this.h * 0.6, vx: (Math.random() - 0.5) * u * 1.5, vy: u * (1.5 + Math.random() * 2), g: u * 0.02, life: 1, dec: 0.004 + Math.random() * 0.004,
        c: colors[i % colors.length], s: (3 + Math.random() * 4) * u, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, k: Math.random() < 0.5 ? 'dot' : 'sq' });
    }
    this.kick();
  };
  Fx.prototype.frame = function () {
    var self = this, ctx = this.ctx, w = this.w, h = this.h;
    this.raf = 0;
    if (this.dead) return;
    ctx.clearRect(0, 0, w, h);
    this.rays += (this.raysTarget - this.rays) * 0.08;
    if (this.rays > 0.01) {
      this.rot += 0.004 + this.rays * 0.02;
      var n = 14, R = Math.hypot(w, h);
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(this.rot);
      for (var i = 0; i < n; i++) {
        var a0 = i / n * Math.PI * 2, a1 = a0 + Math.PI / n * 0.7;
        var col = this.rainbow ? RAINBOW[i % RAINBOW.length] : this.rayColor;
        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.7);
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = Math.min(0.55, this.rays * 0.55) * (this.lite ? 0.6 : 1);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath(); ctx.fill();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    var alive = [];
    for (var j = 0; j < this.ps.length; j++) {
      var p = this.ps[j];
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.99; p.r += p.vr; p.life -= p.dec;
      if (p.life <= 0 || p.y > h + 20) continue;
      alive.push(p);
      ctx.globalAlpha = Math.min(1, p.life * 1.6);
      ctx.fillStyle = p.c;
      if (p.k === 'dot') { ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 0.6, 0, 6.283); ctx.fill(); }
      else { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillRect(-p.s / 2, -p.s * 0.3, p.s, p.s * 0.6); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
    this.ps = alive;
    if (this.ps.length || this.rays > 0.01 || this.raysTarget > 0) this.raf = requestAnimationFrame(function () { self.frame(); });
    else ctx.clearRect(0, 0, w, h);
  };
  Fx.prototype.stop = function () { this.dead = true; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; };

  /* ---------- 演出 ---------- */
  // 結果テロップ。o: rarity（またはタグの文字 tag）, text, packName, band('orange'|'dark')
  function telop(box, o) {
    injectCss();
    var len = String(o.text || '').length;
    var t = el('div', 'tl ' + (o.rarity || '') + (o.band === 'dark' ? ' dark' : '') + (len > 30 ? ' l' : len > 18 ? ' m' : ''), box);
    t.style.setProperty('--c', o.rarity ? COLOR[o.rarity] : '#2b2b2b');
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

  // container は position:relative の箱。opts: rarity, text, packName, fx('full'|'lite'|'off'), sound, scale, onDone
  function play(container, opts) {
    injectCss();
    if (container._kg) container._kg.destroy();
    var fx = opts.fx || 'full', lite = fx === 'lite', snd = !!opts.sound;
    var rarity = RAR.indexOf(opts.rarity) >= 0 ? opts.rarity : 'N', lv = RAR.indexOf(rarity);
    var root = el('div', 'kg', container), inner = el('div', 'kg-in', root);
    var w = container.clientWidth || 600, h = container.clientHeight || 340;
    root.style.setProperty('--u', (Math.min(w, h * 1.6) / 100) + 'px');
    root.style.setProperty('--s', opts.scale || 1);
    root.style.setProperty('--th', telopSize(w, h, opts.place, opts.scale) + 'px');
    var timers = [], done = false, fxc = null, ctl = {};
    function at(ms, fn) { timers.push(setTimeout(fn, lite ? ms * 0.8 : ms)); }
    function finish() { if (done) return; done = true; if (opts.onDone) opts.onDone(); }
    function showCard(anim) { var c = cardHtml(inner, { rarity: rarity, text: opts.text, packName: opts.packName, band: opts.band }); if (anim) c.classList.add('in'); return c; }
    ctl.destroy = function () { timers.forEach(clearTimeout); timers = []; if (fxc) fxc.stop(); if (root.parentNode) root.parentNode.removeChild(root); container._kg = null; };
    ctl.skip = function () {
      if (done) return;
      timers.forEach(clearTimeout); timers = [];
      inner.innerHTML = ''; inner.className = 'kg-in';
      if (fxc) { fxc.stop(); }
      showCard(false);
      if (snd) sfx('reveal', rarity);
      finish();
    };
    ctl.playing = function () { return !done; };
    container._kg = ctl;

    if (fx === 'off') { showCard(true); if (snd) sfx('reveal', rarity); timers.push(setTimeout(finish, 300)); return ctl; }

    var cv = el('canvas', '', inner);
    fxc = new Fx(cv, lite);
    var cols = rarity === 'SSR' ? RAINBOW.concat(['#fff']) : [COLOR[rarity], '#fff', '#ffd58f', COLOR[RAR[Math.max(0, lv - 1)]]];

    // 3・2・1
    var cd = null;
    ['3', '2', '1'].forEach(function (n, i) {
      at(i * 300, function () { if (cd) cd.remove(); cd = el('div', 'kg-count', inner); cd.textContent = n; if (snd) sfx('count'); });
    });
    // カプセルが落ちてくる
    var cap, aura, ring = function (c) { var r = el('div', 'kg-ring', inner); r.style.setProperty('--c', c); setTimeout(function () { r.remove(); }, 700); };
    at(900, function () {
      if (cd) cd.remove();
      cap = el('div', 'kg-cap drop', inner); cap.style.setProperty('--c', COLOR.N);
      aura = el('div', 'kg-aura', cap);
      var body = el('div', 'kg-body', cap); el('div', 'kg-half kg-top', body); el('div', 'kg-half kg-bot', body);
      if (snd) sfx('drop');
    });
    at(1350, function () { cap.classList.remove('drop'); cap.classList.add('wob'); });
    // 昇格（N → R → SR → SSR）
    var base = 2000, step = 500;
    for (var i = 1; i <= lv; i++) (function (i) {
      at(base + (i - 1) * step, function () {
        var r = RAR[i];
        cap.style.setProperty('--c', COLOR[r]);
        aura.classList.add('on'); aura.style.setProperty('--c', COLOR[r]);
        if (r === 'SSR') { cap.classList.add('rb'); aura.classList.add('rb'); fxc.rainbow = true; }
        ring(COLOR[r]);
        fxc.rayColor = COLOR[r]; fxc.raysTarget = i / 3;
        fxc.burst(10 + i * 8, [COLOR[r], '#fff'], 0.6);
        if (snd) sfx('step', i);
      });
    })(i);
    var hold = lv === 3 ? 1100 : lv === 2 ? 500 : 0;
    var crack = base + lv * step + hold;
    if (hold) at(base + lv * step, function () {
      cap.classList.remove('wob'); cap.classList.add('hard');
      fxc.raysTarget = 1;
      if (lv === 3) { el('div', 'kg-band', inner); var hb = el('div', 'kg-band h', inner); hb.style.top = '41%'; }
    });
    // 割れる
    at(crack, function () {
      cap.classList.remove('wob', 'hard'); cap.classList.add('open');
      if (!lite) { el('div', 'kg-flash', inner); inner.classList.add('shake'); }
      fxc.burst([50, 80, 130, 180][lv], cols, 1 + lv * 0.25);
      if (snd) sfx('crack');
    });
    var cardAt = crack + (lv === 3 ? 850 : 280);
    if (lv === 3) at(crack + 120, function () {
      el('div', 'kg-big', inner).textContent = 'SSR';
      el('div', 'kg-band', inner);
      var b1 = el('div', 'kg-band h', inner); b1.style.top = '18%';
      var b2 = el('div', 'kg-band h', inner); b2.style.top = '64%'; b2.style.animationDelay = '.15s';
    });
    at(cardAt, function () {
      inner.classList.remove('shake');
      if (cap) cap.remove();
      showCard(true);
      fxc.raysTarget = lv >= 2 ? 0.45 : 0;
      if (lv === 3) fxc.rain(150, RAINBOW.concat(['#fff', '#ffe14d']));
      else if (lv === 2) fxc.rain(60, [COLOR.SR, '#fff', '#ffe14d']);
      if (snd) sfx('reveal', rarity);
    });
    at(cardAt + (lv === 3 ? 1600 : 900), function () { fxc.raysTarget = 0; finish(); });
    return ctl;
  }

  // 最後の結果を静かに出す（読み直したとき・OBSの再読み込み）
  function show(container, opts) { return play(container, Object.assign({}, opts, { fx: 'off', sound: false })); }

  window.KkpGacha = { telop: telop, telopSize: telopSize, injectCss: injectCss, RAR: RAR, RATES: RATES, COLOR: COLOR, hash: hash, parseCustom: parseCustom, buildPool: buildPool, draw: draw, clearRarity: clearRarity, play: play, show: show, sfx: sfx };
})();
