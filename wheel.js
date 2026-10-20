/* 配信ルーレット 盤面の描画と回転（操作画面・お題ガチャ・OBS表示ページで共通）
   角度は「盤面の 0 = 真上（針の位置）から時計回り」。回転量 r（ラジアン）の分だけ盤面が時計回りに回る。
   針の下にある区画 = 盤面座標で (2π - r mod 2π) の位置にある区画。
   描き方: マスと文字は回転・項目数に合わせて canvas で描き（オフスクリーンに1回だけ描いて回す）、
   外周の金属リム・電球・ピン・針・中心・台座を重ねる。生成画像（art）があればリム・中心・針・台座に使う。
   軽さ: 1フレームは「キャッシュした盤面の drawImage ＋ 小物」だけ。止まっている間は描き直さない。 */
(function () {
  'use strict';
  var TAU = Math.PI * 2;
  // 隣同士でしっかり差が出る配色（ブランドのオレンジ・クリームを軸に、紺・黄・赤・緑を足す）
  var PAL = ['#e2600f', '#fff1d6', '#1f4e79', '#ffc21a', '#c8341e', '#2e7d4f'];
  var DARKC = { '#e2600f': 1, '#1f4e79': 1, '#c8341e': 1, '#2e7d4f': 1, '#6b3fa0': 1 };
  var FONT = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic Medium",Meiryo,sans-serif';
  var BULBS = 24;

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
    var pos = ((TAU - (r % TAU)) + TAU) % TAU;
    for (var i = 0; i < segs.length; i++) if (pos >= segs[i].start && pos < segs[i].end) return i;
    return segs.length - 1;
  }
  function colorOf(i, n) {
    var c = PAL[i % PAL.length];
    if (n > 1 && i === n - 1 && i % PAL.length === 0) c = '#6b3fa0';  // 最後と最初が同じ色にならないように
    return c;
  }

  // 回転の速さの形: 最初の 8% で加速 → 長く減速（最後はゆっくり＝じらし）。表は回す側と表示側で同じになる
  var EASE = (function () {
    var N = 400, a = 0.08, p = 2.6, v = [], acc = [0], i, sum = 0;
    for (i = 0; i <= N; i++) { var t = i / N; v.push(t < a ? t / a : Math.pow(1 - (t - a) / (1 - a), p)); }
    for (i = 1; i <= N; i++) { sum += (v[i - 1] + v[i]) / 2; acc.push(sum); }
    return acc.map(function (x) { return x / sum; });
  })();
  function ease(t) { if (t <= 0) return 0; if (t >= 1) return 1; var f = t * (EASE.length - 1), i = Math.floor(f); return EASE[i] + (EASE[i + 1] - EASE[i]) * (f - i); }

  // 1行で入らなければ縮め、それでも入らなければ2行に、最後は末尾を省く
  function fitLines(ctx, text, max, base, twoOk) {
    var k, set = function (px) { ctx.font = '900 ' + px.toFixed(1) + 'px ' + FONT; };
    for (k = 1; k >= 0.72; k -= 0.07) { set(base * k); if (ctx.measureText(text).width <= max) return { lines: [text], px: base * k }; }
    if (twoOk && text.length >= 4) {
      var mid = Math.ceil(text.length / 2), a = text.slice(0, mid), b = text.slice(mid);
      for (k = 0.9; k >= 0.55; k -= 0.07) { set(base * k); if (Math.max(ctx.measureText(a).width, ctx.measureText(b).width) <= max) return { lines: [a, b], px: base * k }; }
    }
    set(base * 0.72);
    var s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return { lines: [s + '…'], px: base * 0.72 };
  }

  function Wheel(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = []; this.segs = [];
    this.angle = 0; this.spinning = false; this.size = 0;
    this.onTick = null;
    this.fx = 'full';             // full / lite（電球の点滅なし・残像なし）/ off
    this.art = {};                // 生成画像（rim / hub / pointer / stage）
    this.win = -1; this.winT = 0;
    this.vel = 0; this.flap = 0; this.flapV = 0;
    this.face = null; this.raf = 0; this.t0 = 0;
  }

  Wheel.prototype.setArt = function (art) {
    var self = this;
    Object.keys(art || {}).forEach(function (k) {
      var img = new Image();
      img.onload = function () { self.art[k] = img; if (k === 'rim') self.buildFace(); self.draw(); };
      img.src = art[k];
    });
  };

  Wheel.prototype.setItems = function (items) {
    var key = JSON.stringify(items.map(function (it) { return [it.label, it.weight]; }));
    if (key === this.key && this.face) { this.draw(); return; }   // 同じ項目なら当たりの表示を残す
    this.key = key;
    this.items = items.slice();
    this.segs = this.items.length ? layout(this.items) : [];
    this.win = -1;
    this.buildFace();
    this.draw();
  };

  Wheel.prototype.resize = function (px) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = px; this.dpr = dpr;
    this.canvas.width = Math.round(px * dpr);
    this.canvas.height = Math.round(px * dpr);
    this.canvas.style.width = px + 'px';
    this.canvas.style.height = px + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.buildFace();
    this.draw();
  };

  // 寸法（盤の大きさ s に対する比）
  Wheel.prototype.geo = function () {
    var s = this.size;
    // 生成画像のリム（内径/外径 0.70・電球は外径の 0.882 の位置）に合わせた寸法
    if (this.art.rim) { var o = s * 0.41; return { s: s, cx: s / 2, cy: s * 0.44, R: o * 0.71, rimIn: o * 0.699, rimOut: o, bulbR: o * 0.882, bulbSize: o * 0.05, hub: s * 0.07, art: true }; }
    return { s: s, cx: s / 2, cy: s * 0.475, R: s * 0.355, rimIn: s * 0.355, rimOut: s * 0.445, bulbR: s * 0.4, bulbSize: s * 0.016, hub: s * 0.075 };
  };

  // 盤面（マス・陰影・ピン・文字）をオフスクリーンに描く。回転中はこれを回して貼るだけ
  Wheel.prototype.buildFace = function () {
    if (!this.size) return;
    var g = this.geo(), R = g.R, dpr = this.dpr || 1, D = Math.ceil(R * 2 * dpr) + 4;
    var c = this.face || document.createElement('canvas');
    c.width = D; c.height = D;
    var ctx = c.getContext('2d'), n = this.segs.length, i;
    ctx.setTransform(dpr, 0, 0, dpr, D / 2, D / 2);
    ctx.clearRect(-D, -D, D * 2, D * 2);
    ctx.rotate(-Math.PI / 2);
    if (!n) { ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = '#fff6ea'; ctx.fill(); }
    var cols = [];
    for (i = 0; i < n; i++) {
      var sg = this.segs[i], col = colorOf(i, n); cols.push(col);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, sg.start, sg.end); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
    }
    // 立体感: 中心は明るく、外へ行くほど陰る
    var rg = ctx.createRadialGradient(0, 0, R * 0.08, 0, 0, R);
    rg.addColorStop(0, 'rgba(255,255,255,.38)'); rg.addColorStop(0.45, 'rgba(255,255,255,.06)'); rg.addColorStop(0.82, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,.28)');
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = rg; ctx.fill();
    // マスの境: 濃い線＋光の線（ふちの陰影）
    if (n > 1) for (i = 0; i < n; i++) {
      var a = this.segs[i].start;
      ctx.save(); ctx.rotate(a);
      ctx.strokeStyle = 'rgba(40,24,10,.55)'; ctx.lineWidth = Math.max(2, R * 0.016);
      ctx.beginPath(); ctx.moveTo(R * 0.12, 0); ctx.lineTo(R, 0); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, R * 0.005);
      ctx.beginPath(); ctx.moveTo(R * 0.12, R * 0.012); ctx.lineTo(R, R * 0.012); ctx.stroke();
      ctx.restore();
    }
    // 文字（極太・縁取り）。長い項目は縮小→2行
    var base = Math.max(11, Math.min(R * 0.15, R * 2.6 / Math.max(n, 1) * 0.55));
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (i = 0; i < n; i++) {
      var sgm = this.segs[i], mid = (sgm.start + sgm.end) / 2, arc = (sgm.end - sgm.start);
      var chord = arc * R * 0.62;                       // 文字の位置での区画の高さ
      if (chord < 10) continue;
      var px0 = Math.min(base, chord * 0.8);
      var fit = fitLines(ctx, sgm.label, R * 0.66, px0, chord > px0 * 2.2);
      var dark = DARKC[cols[i]];
      ctx.save(); ctx.rotate(mid);
      ctx.lineWidth = Math.max(2, fit.px * 0.24);
      ctx.strokeStyle = dark ? 'rgba(30,18,6,.9)' : '#ffffff';
      ctx.fillStyle = dark ? '#ffffff' : '#2b2b2b';
      ctx.textAlign = 'right';
      var lh = fit.px * 1.08, y0 = -(fit.lines.length - 1) * lh / 2;
      // 盤の左側（逆さまになる側）も読めるよう、文字は常に外側が右になる向き（回るので向きは毎回変わる）
      for (var l = 0; l < fit.lines.length; l++) { ctx.strokeText(fit.lines[l], R * 0.9, y0 + l * lh); ctx.fillText(fit.lines[l], R * 0.9, y0 + l * lh); }
      ctx.restore();
    }
    // 境目のピン（金属）
    if (n > 1) for (i = 0; i < n; i++) {
      var pa = this.segs[i].start, px = Math.cos(pa) * R * 0.955, py = Math.sin(pa) * R * 0.955, pr = Math.max(2.5, R * 0.028);
      var pg = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
      pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.4, '#e8c46a'); pg.addColorStop(1, '#8a5a12');
      ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fillStyle = pg; ctx.fill();
      ctx.lineWidth = Math.max(1, pr * 0.25); ctx.strokeStyle = 'rgba(40,24,10,.7)'; ctx.stroke();
    }
    this.face = c; this.faceD = D; this.cols = cols;
  };

  // 区画の扇形パス（盤面座標）
  function wedge(ctx, s, R) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, s.start, s.end); ctx.closePath(); }

  Wheel.prototype.draw = function (now) {
    var ctx = this.ctx, s = this.size;
    if (!s) return;
    now = now || performance.now();
    var g = this.geo(), cx = g.cx, cy = g.cy, R = g.R, fx = this.fx;
    ctx.clearRect(0, 0, s, s);

    // 背景: 盤の後ろの放射光と台座（ステージに置かれた盤）
    {
      var glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, s * 0.5);
      glow.addColorStop(0, 'rgba(255,214,140,.55)'); glow.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, s, s);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(fx === 'full' && this.spinning ? now / 4000 : 0.1);
      for (var k = 0; k < 12; k++) {
        ctx.rotate(TAU / 12);
        var rgr = ctx.createLinearGradient(0, 0, 0, -s * 0.5);
        rgr.addColorStop(0, 'rgba(255,240,200,.35)'); rgr.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.fillStyle = rgr; ctx.beginPath(); ctx.moveTo(-R * 0.08, 0); ctx.lineTo(R * 0.08, 0); ctx.lineTo(s * 0.06, -s * 0.5); ctx.lineTo(-s * 0.06, -s * 0.5); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // 台座（生成画像があればそれを使う）
      if (this.art.stand) {
        var sw = s * 0.5, sh = sw * this.art.stand.naturalHeight / this.art.stand.naturalWidth;
        ctx.drawImage(this.art.stand, cx - sw / 2, s - sh, sw, sh);
      } else {
      var pt = cy + g.rimOut * 0.82, pb = s * 0.995, pw = s * 0.2, pwb = s * 0.34;
      var pg2 = ctx.createLinearGradient(cx - pwb, 0, cx + pwb, 0);
      pg2.addColorStop(0, '#5a2a08'); pg2.addColorStop(0.35, '#c8641a'); pg2.addColorStop(0.5, '#f0a050'); pg2.addColorStop(0.65, '#c8641a'); pg2.addColorStop(1, '#5a2a08');
      ctx.beginPath(); ctx.moveTo(cx - pw, pt); ctx.lineTo(cx + pw, pt); ctx.lineTo(cx + pwb, pb); ctx.lineTo(cx - pwb, pb); ctx.closePath();
      ctx.fillStyle = pg2; ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.006); ctx.strokeStyle = '#2b1a0c'; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(cx - pwb * 0.97, pb - s * 0.03, pwb * 1.94, s * 0.012);
      }
    }

    // 盤面（高速のときは残像を2枚）
    var D = this.faceD / (this.dpr || 1);
    var drawFace = function (self, ang, alpha) {
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy); ctx.rotate(ang);
      ctx.drawImage(self.face, -D / 2, -D / 2, D, D); ctx.restore();
    };
    if (this.face) {
      if (fx === 'full' && this.vel > 0.1) { drawFace(this, this.angle - this.vel * 0.66, 0.22); drawFace(this, this.angle - this.vel * 0.33, 0.32); }
      drawFace(this, this.angle, 1);
    }
    // 当たり: 他のマスを少し暗く、当たりのマスを光らせて少し拡大
    if (this.win >= 0 && this.segs[this.win] && !this.spinning) {
      var e = Math.min(1, (now - this.winT) / 320), sc = 1 + 0.06 * (e < 1 ? Math.sin(e * Math.PI / 2) * (1 + 0.25 * (1 - e)) : 1);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(this.angle - Math.PI / 2);
      ctx.fillStyle = 'rgba(20,10,0,' + (0.38 * e).toFixed(3) + ')';
      for (var j = 0; j < this.segs.length; j++) if (j !== this.win) { wedge(ctx, this.segs[j], R); ctx.fill(); }
      ctx.save(); wedge(ctx, this.segs[this.win], R * sc); ctx.clip();
      ctx.scale(sc, sc); ctx.rotate(Math.PI / 2); ctx.drawImage(this.face, -D / 2, -D / 2, D, D); ctx.restore();
      wedge(ctx, this.segs[this.win], R * sc);
      ctx.lineWidth = Math.max(3, s * 0.012); ctx.strokeStyle = '#ffd23f'; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = s * 0.03 * e; ctx.stroke();
      ctx.restore();
    }
    // 盤のふちの内側の影
    var ish = ctx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R * 1.01);
    ish.addColorStop(0, 'rgba(0,0,0,0)'); ish.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = ish; ctx.fill();

    // 外周の金属リム
    if (this.art.rim) { var rw = g.rimOut * 2.0; ctx.drawImage(this.art.rim, cx - rw / 2, cy - rw / 2, rw, rw); }
    else {
      var mid = (g.rimIn + g.rimOut) / 2, th = g.rimOut - g.rimIn;
      ctx.lineWidth = th + Math.max(3, s * 0.008); ctx.strokeStyle = '#3a2208';
      ctx.beginPath(); ctx.arc(cx, cy, mid, 0, TAU); ctx.stroke();
      var mg = ctx.createLinearGradient(cx - g.rimOut, cy - g.rimOut, cx + g.rimOut, cy + g.rimOut);
      mg.addColorStop(0, '#fff3c4'); mg.addColorStop(0.2, '#f2b23a'); mg.addColorStop(0.45, '#a8620e'); mg.addColorStop(0.62, '#f6c860'); mg.addColorStop(0.85, '#9a5408'); mg.addColorStop(1, '#f2b23a');
      ctx.lineWidth = th; ctx.strokeStyle = mg;
      ctx.beginPath(); ctx.arc(cx, cy, mid, 0, TAU); ctx.stroke();
      ctx.lineWidth = Math.max(1.5, th * 0.08); ctx.strokeStyle = 'rgba(255,250,225,.7)';
      ctx.beginPath(); ctx.arc(cx, cy, g.rimOut - th * 0.12, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
      ctx.lineWidth = Math.max(1.5, th * 0.06); ctx.strokeStyle = 'rgba(60,30,0,.55)';
      ctx.beginPath(); ctx.arc(cx, cy, g.rimIn + th * 0.08, 0, TAU); ctx.stroke();
    }

    // 電球（回転中は追いかけて光る／止まると当たり側から点灯→2回点滅→全部点灯。控えめ・なしは点灯のまま）
    var br = Math.max(2.5, g.bulbSize), since = now - this.winT, artB = !!this.art.rim;
    for (var b = 0; b < BULBS; b++) {
      var ba = -Math.PI / 2 + b / BULBS * TAU, bx = cx + Math.cos(ba) * g.bulbR, by = cy + Math.sin(ba) * g.bulbR;
      var on = 0.85;
      if (fx === 'full') {
        if (this.spinning) on = ((b + Math.floor(now / 70)) % 3 === 0) ? 1 : 0.18;
        else if (this.win >= 0 && since < 1700) {
          var dist = Math.min(b, BULBS - b) / (BULBS / 2);          // 真上（当たり側）からの近さ
          if (since < 600) on = since / 600 > dist ? 1 : 0.15;
          else if (since < 1400) on = (Math.floor((since - 600) / 200) % 2 === 0) ? 1 : 0.25;  // 2.5回/秒（3回/秒未満）
          else on = 1;
        }
      }
      if (artB) {
        // 生成画像の電球の上に、光（点灯）か影（消灯）を重ねる
        if (on > 0.5) {
          var ag = ctx.createRadialGradient(bx, by, 0, bx, by, br * 2.6);
          ag.addColorStop(0, 'rgba(255,255,240,' + (0.9 * on).toFixed(2) + ')'); ag.addColorStop(0.35, 'rgba(255,230,140,' + (0.55 * on).toFixed(2) + ')'); ag.addColorStop(1, 'rgba(255,200,80,0)');
          ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(bx, by, br * 2.6, 0, TAU); ctx.fill();
        } else { ctx.fillStyle = 'rgba(70,35,5,.55)'; ctx.beginPath(); ctx.arc(bx, by, br * 1.05, 0, TAU); ctx.fill(); }
        continue;
      }
      if (on > 0.5) {
        var gl = ctx.createRadialGradient(bx, by, 0, bx, by, br * 3.2);
        gl.addColorStop(0, 'rgba(255,236,170,' + (0.55 * on).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,236,170,0)');
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(bx, by, br * 3.2, 0, TAU); ctx.fill();
      }
      var bg = ctx.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.1, bx, by, br);
      if (on > 0.5) { bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.5, '#fff4b8'); bg.addColorStop(1, '#ffb300'); }
      else { bg.addColorStop(0, '#d8c8a8'); bg.addColorStop(1, '#7a5a2a'); }
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fillStyle = bg; ctx.fill();
      ctx.lineWidth = Math.max(1, br * 0.22); ctx.strokeStyle = '#4a2c08'; ctx.stroke();
    }

    // 中心のハブ
    if (this.art.hub) { var hw = s * 0.17; ctx.drawImage(this.art.hub, cx - hw / 2, cy - hw / 2, hw, hw); }
    else {
      var hr = g.hub;
      var hg = ctx.createRadialGradient(cx - hr * 0.4, cy - hr * 0.5, hr * 0.1, cx, cy, hr * 1.15);
      hg.addColorStop(0, '#fff8d8'); hg.addColorStop(0.45, '#f0b440'); hg.addColorStop(1, '#8a4e08');
      ctx.beginPath(); ctx.arc(cx, cy, hr * 1.15, 0, TAU); ctx.fillStyle = hg; ctx.fill();
      ctx.lineWidth = Math.max(2, s * 0.007); ctx.strokeStyle = '#3a2208'; ctx.stroke();
      var hi = ctx.createRadialGradient(cx, cy - hr * 0.3, hr * 0.1, cx, cy, hr * 0.8);
      hi.addColorStop(0, '#f47b20'); hi.addColorStop(1, '#b84c0a');
      ctx.beginPath(); ctx.arc(cx, cy, hr * 0.78, 0, TAU); ctx.fillStyle = hi; ctx.fill(); ctx.stroke();
      ctx.font = '900 ' + (hr * 0.9).toFixed(1) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, hr * 0.14); ctx.strokeStyle = '#5a2a08'; ctx.lineJoin = 'round';
      ctx.strokeText('回', cx, cy + hr * 0.04); ctx.fillStyle = '#fff6ea'; ctx.fillText('回', cx, cy + hr * 0.04);
    }

    // 針（フラッパー）: 上の軸を中心にしなる
    var px0 = cx, py0 = g.art ? cy - g.rimOut + s * 0.03 : cy - g.rimOut - s * 0.005, plen = s * 0.115, pw2 = s * 0.036;
    ctx.save(); ctx.translate(px0, py0); ctx.rotate(this.flap);
    if (this.art.pointer) {
      // 生成画像の針: 上の丸い軸（高さの 16.7% の位置）を回転の中心にする
      var ph = s * 0.18, pwi = ph * this.art.pointer.naturalWidth / this.art.pointer.naturalHeight;
      ctx.drawImage(this.art.pointer, -pwi / 2, -ph * 0.167, pwi, ph);
    }
    else {
      ctx.beginPath(); ctx.moveTo(-pw2, 0); ctx.quadraticCurveTo(-pw2 * 1.05, plen * 0.45, 0, plen); ctx.quadraticCurveTo(pw2 * 1.05, plen * 0.45, pw2, 0); ctx.closePath();
      var fg = ctx.createLinearGradient(-pw2, 0, pw2, 0);
      fg.addColorStop(0, '#9e1f12'); fg.addColorStop(0.45, '#ff5a3c'); fg.addColorStop(0.6, '#ff8a6a'); fg.addColorStop(1, '#8a1a0e');
      ctx.fillStyle = fg; ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.007); ctx.strokeStyle = '#2b1208'; ctx.stroke();
      var kg = ctx.createRadialGradient(-pw2 * 0.25, -pw2 * 0.25, 1, 0, 0, pw2 * 0.85);
      kg.addColorStop(0, '#ffffff'); kg.addColorStop(0.4, '#f0c050'); kg.addColorStop(1, '#8a5a12');
      ctx.beginPath(); ctx.arc(0, 0, pw2 * 0.8, 0, TAU); ctx.fillStyle = kg; ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  };

  // 針のしなり: いちばん近いピンが真上を通るときに押されて傾き、ばねで戻る
  Wheel.prototype.updateFlap = function () {
    var n = this.segs.length, best = 9;
    if (n > 1) for (var i = 0; i < n; i++) {
      var d = ((this.segs[i].start + this.angle) % TAU + TAU) % TAU; if (d > Math.PI) d -= TAU;
      if (Math.abs(d) < Math.abs(best)) best = d;
    }
    var zone = 0.09, target = 0;
    if (Math.abs(best) < zone && best < 0) target = -0.55 * (1 - Math.abs(best) / zone);   // ピンに押されて左へ
    this.flapV += (target - this.flap) * 0.35; this.flapV *= 0.55; this.flap += this.flapV;
  };

  Wheel.prototype.loop = function () {
    var self = this;
    if (this.raf) return;
    var step = function (now) {
      self.raf = 0;
      self.updateFlap();
      self.draw(now);
      var busy = self.spinning || (self.win >= 0 && now - self.winT < 1800) || Math.abs(self.flap) > 0.004;
      if (busy) self.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  };

  // 止まる角度を決める。当たりは重みどおりに選び、止まる位置は「境目を越えてすぐ」（最後に1マス進むじらし）
  Wheel.prototype.pickFinal = function (turns) {
    var base = this.angle - (this.angle % TAU);
    if (!this.segs.length) return base + TAU * (turns || 5);
    var total = 0, i, x;
    for (i = 0; i < this.items.length; i++) total += this.items[i].weight;
    x = Math.random() * total;
    for (i = 0; i < this.items.length - 1; i++) { if (x < this.items[i].weight) break; x -= this.items[i].weight; }
    var sg = this.segs[i], w = sg.end - sg.start;
    var pos = sg.end - w * (0.14 + Math.random() * 0.22);
    return base + TAU * (turns || 5) + ((TAU - pos) % TAU);
  };

  // i 番目のマスの真ん中（半径の frac の位置）を canvas の中の CSS px で返す。ang は盤の回転量
  Wheel.prototype.segPoint = function (i, ang, frac) {
    var g = this.geo(), sg = this.segs[i];
    if (!sg) return { x: g.cx, y: g.cy };
    var phi = (sg.start + sg.end) / 2 + ang, r = g.R * (frac || 0.6);
    return { x: g.cx + Math.sin(phi) * r, y: g.cy - Math.cos(phi) * r };
  };

  // 止まる瞬間に、手裏剣が飛んできて止まったマスに刺さる（共通部品 KKit.fx.shuriken）。host は canvas を囲む position のある箱
  // dur は回す長さ。手裏剣の飛ぶ時間を逆算して、盤が止まるときに当たるように投げる。fx が off・動きを減らす設定のときは投げない
  Wheel.prototype.throwStar = function (host, final, dur, speed, sound) {
    var FX = window.KKit && window.KKit.fx, self = this;
    this.clearStar(host);
    if (!FX || FX.reduce || this.fx === 'off' || !host || !this.segs.length) return;
    var idx = this.resultAt(final), fl = FX.ms(420, speed);
    // 投げる合図は回転のフレームの中で出す（タイマーだと、画面が裏にあって描画が遅れたときに盤とずれるため）
    this._star = { at: Math.max(0, dur - fl), fn: function () {
      var p = self.segPoint(idx, final, 0.46), cr = self.canvas.getBoundingClientRect(), hr = host.getBoundingClientRect();
      FX.shuriken(host, { x: cr.left - hr.left + p.x, y: cr.top - hr.top + p.y, size: Math.max(26, self.size * 0.1), speed: speed, sound: sound, from: 'right' });
    } };
  };
  Wheel.prototype.clearStar = function (host) {
    this._star = null;
    if (host && window.KKit && window.KKit.fx) window.KKit.fx.clear(host);
  };

  Wheel.prototype.resultAt = function (r) { return this.segs.length ? segmentAt(this.segs, r) : -1; };

  // from → final に dur ms かけて回す（加速→減速→じらし）。表示側も同じ表で動くので結果は一致する
  Wheel.prototype.spin = function (from, final, dur, done) {
    var self = this, t0 = null, last = from;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.spinning = true; this.win = -1;
    this.angle = from;
    var lastSeg = this.resultAt(from);
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var t = Math.min(1, (ts - t0) / dur);
      if (self._star && ts - t0 >= self._star.at) { var sf = self._star.fn; self._star = null; sf(); }
      self.angle = from + (final - from) * ease(t);
      self.vel = self.angle - last; last = self.angle;
      self.updateFlap();
      self.draw(ts);
      var seg = self.resultAt(self.angle);
      if (seg !== lastSeg) { lastSeg = seg; if (self.onTick) self.onTick(t); }
      if (t < 1) { requestAnimationFrame(frame); }
      else {
        self.spinning = false; self.angle = final; self.vel = 0;
        self.win = self.resultAt(final); self.winT = performance.now();
        self.loop();
        if (done) done(self.win);
      }
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

  // 効果音（Web Audio で合成。外部ファイルなし）。tick は針がピンに当たる「カチッ」
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

  var ART = { rim: '/img/wheel-rim.webp', hub: '/img/wheel-hub.webp', pointer: '/img/wheel-pointer.webp', stand: '/img/wheel-stand.webp' };
  window.KkpWheel = { ART: ART, Wheel: Wheel, spinDur: spinDur, reduce: REDUCE, parseItems: parseItems, sound: sound, TAU: TAU, ease: ease };
})();
