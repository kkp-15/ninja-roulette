/* 配信ルーレット 盤面の描画と回転（操作画面と OBS 表示ページで共通）
   角度は「盤面の 0 = 真上（針の位置）から時計回り」。回転量 r（ラジアン）の分だけ盤面が時計回りに回る。
   針の下にある区画 = 盤面座標で (2π - r mod 2π) の位置にある区画。 */
(function () {
  'use strict';
  var TAU = Math.PI * 2;
  // 配信で映える強めの配色（濃い色には白文字、淡い色には黒文字）
  var COLORS = ['#e2600f', '#fff1d6', '#ffb21e', '#ffffff', '#f47b20', '#ffe08a'];
  var DARK = { '#e2600f': 1, '#f47b20': 1 };
  var FONT = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic Medium",Meiryo,sans-serif';

  // 「名前*3」の重み付きで、各区画の開始・終了角を出す
  function layout(items) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += items[i].weight;
    var a = 0, segs = [];
    for (i = 0; i < items.length; i++) {
      var w = items[i].weight / total * TAU;
      segs.push({ label: items[i].label, start: a, end: a + w });
      a += w;
    }
    return segs;
  }

  function segmentAt(segs, r) {
    // 針（真上）の下に来ている区画
    var pos = ((TAU - (r % TAU)) + TAU) % TAU;
    for (var i = 0; i < segs.length; i++) {
      if (pos >= segs[i].start && pos < segs[i].end) return i;
    }
    return segs.length - 1;
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function fitText(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    // まず文字を小さくして全部入れる（7割まで）。それでも入らなければ末尾を省く
    var m = ctx.font.match(/(\d+(?:\.\d+)?)px/), base = m ? parseFloat(m[1]) : 16;
    for (var k = 0.92; k >= 0.7; k -= 0.06) {
      ctx.font = ctx.font.replace(/\d+(?:\.\d+)?px/, (base * k).toFixed(1) + 'px');
      if (ctx.measureText(text).width <= max) return text;
    }
    var s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }

  function Wheel(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.segs = [];
    this.angle = 0;
    this.spinning = false;
    this.size = 0;
    this.onTick = null;
  }

  Wheel.prototype.setItems = function (items) {
    this.items = items.slice();
    this.segs = this.items.length ? layout(this.items) : [];
    this.draw();
  };

  Wheel.prototype.resize = function (px) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = px;
    this.canvas.width = Math.round(px * dpr);
    this.canvas.height = Math.round(px * dpr);
    this.canvas.style.width = px + 'px';
    this.canvas.style.height = px + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };

  Wheel.prototype.draw = function () {
    var ctx = this.ctx, s = this.size;
    if (!s) return;
    var c = s / 2, R = s / 2 - s * 0.075, n = this.segs.length, i;
    ctx.clearRect(0, 0, s, s);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(this.angle - Math.PI / 2);  // 盤面の 0 を真上に
    if (n === 0) {
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU);
      ctx.fillStyle = '#fff5e8'; ctx.fill();
    }
    var cols = [];
    for (i = 0; i < n; i++) {
      var sg = this.segs[i];
      var color = COLORS[i % COLORS.length];
      if (n > 1 && i === n - 1 && i % COLORS.length === 0) color = COLORS[3];  // 最後と最初が同じ色にならないように
      cols.push(color);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, sg.start, sg.end);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      if (n > 1) { ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(1.5, s * 0.006); ctx.stroke(); }
    }
    // 文字（極太・縁取り）
    var fs = Math.max(11, Math.min(s * 0.062, s * 0.95 / Math.max(n, 1) * 0.55));
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (i = 0; i < n; i++) {
      var g = this.segs[i], mid = (g.start + g.end) / 2;
      ctx.font = '900 ' + fs + 'px ' + FONT;
      if ((g.end - g.start) * R < fs * 1.05) continue;  // 細すぎる区画は文字を省く
      ctx.save();
      ctx.rotate(mid);
      var abs = ((mid + this.angle - Math.PI / 2) % TAU + TAU) % TAU;
      var txt = fitText(ctx, g.label, R * 0.68);
      var dark = DARK[cols[i]];
      ctx.lineWidth = Math.max(2, fs * 0.22);
      ctx.strokeStyle = dark ? '#2b2b2b' : '#ffffff';
      ctx.fillStyle = dark ? '#ffffff' : '#2b2b2b';
      // 画面の左半分に来た文字は裏返して、どの区画も読める向きにする
      if (abs > Math.PI / 2 && abs < Math.PI * 1.5) { ctx.rotate(Math.PI); ctx.textAlign = 'left'; ctx.strokeText(txt, -R * 0.9, 0); ctx.fillText(txt, -R * 0.9, 0); }
      else { ctx.textAlign = 'right'; ctx.strokeText(txt, R * 0.9, 0); ctx.fillText(txt, R * 0.9, 0); }
      ctx.restore();
    }
    ctx.restore();
    // 外枠（濃い縁＋オレンジの輪＋ピン）・中心
    ctx.save();
    ctx.translate(c, c);
    var rim = Math.max(6, s * 0.035);
    ctx.beginPath(); ctx.arc(0, 0, R + rim * 0.5, 0, TAU);
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = rim + Math.max(3, s * 0.012); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R + rim * 0.5, 0, TAU);
    ctx.strokeStyle = '#e2600f'; ctx.lineWidth = rim; ctx.stroke();
    var pins = Math.max(12, Math.min(36, n * 2));
    for (i = 0; i < pins; i++) {
      var pa = this.angle + i / pins * TAU;
      ctx.beginPath(); ctx.arc(Math.cos(pa) * (R + rim * 0.5), Math.sin(pa) * (R + rim * 0.5), rim * 0.26, 0, TAU);
      ctx.fillStyle = '#fff1d6'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, Math.max(10, s * 0.075), 0, TAU);
    ctx.fillStyle = '#e2600f'; ctx.fill(); ctx.lineWidth = Math.max(3, s * 0.012); ctx.strokeStyle = '#2b2b2b'; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, Math.max(4, s * 0.03), 0, TAU);
    ctx.fillStyle = '#fff1d6'; ctx.fill(); ctx.stroke();
    // 針（真上・太い縁）
    var pw = Math.max(10, s * 0.055), ph = Math.max(16, s * 0.1), top = -R - rim * 1.6;
    ctx.beginPath();
    ctx.moveTo(-pw, top);
    ctx.lineTo(pw, top);
    ctx.lineTo(0, top + ph);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#ffd23f'; ctx.fill();
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(3, s * 0.012); ctx.stroke();
    ctx.restore();
  };

  // 止まる角度を決める（結果は針の下の区画で決まる）
  Wheel.prototype.pickFinal = function (turns) {
    var extra = Math.random() * TAU;
    var base = this.angle - (this.angle % TAU);
    return base + TAU * (turns || 5) + extra;
  };

  Wheel.prototype.resultAt = function (r) {
    return this.segs.length ? segmentAt(this.segs, r) : -1;
  };

  // from → final に dur ms かけて減速しながら回す
  Wheel.prototype.spin = function (from, final, dur, done) {
    var self = this, t0 = null;
    this.spinning = true;
    this.angle = from;
    var lastSeg = this.resultAt(from);
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var t = Math.min(1, (ts - t0) / dur);
      self.angle = from + (final - from) * easeOut(t);
      self.draw();
      var seg = self.resultAt(self.angle);
      if (seg !== lastSeg) { lastSeg = seg; if (self.onTick) self.onTick(t); }
      if (t < 1) { requestAnimationFrame(frame); }
      else { self.spinning = false; self.angle = final; self.draw(); if (done) done(self.resultAt(final)); }
    }
    requestAnimationFrame(frame);
  };

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

  // 紙吹雪（少量・1.6秒）
  function confetti(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width = canvas.offsetWidth, H = canvas.height = canvas.offsetHeight;
    var ps = [], i, cols = ['#e2600f', '#ffb36b', '#ffd58f', '#2b2b2b', '#fff'];
    for (i = 0; i < 70; i++) {
      ps.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.45, vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 3,
        c: cols[i % cols.length], s: 5 + Math.random() * 5, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.3 });
    }
    var t0 = null;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var el = ts - t0;
      ctx.clearRect(0, 0, W, H);
      ps.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, 1 - el / 1600);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      });
      if (el < 1600) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  // 効果音（Web Audio で合成。外部ファイルなし）
  var actx = null;
  function sound(kind) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.connect(g); g.connect(actx.destination);
      if (kind === 'tick') {
        o.type = 'square'; o.frequency.setValueAtTime(900, t);
        g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        o.start(t); o.stop(t + 0.05);
      } else {
        o.type = 'sine'; o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(990, t + 0.12);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.start(t); o.stop(t + 0.65);
      }
    } catch (e) { /* 音が出なくても動作は続ける */ }
  }

  window.KkpWheel = { Wheel: Wheel, parseItems: parseItems, confetti: confetti, sound: sound, TAU: TAU };
})();
