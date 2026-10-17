(function () {
  'use strict';

  var W = 1080, H = 1920;
  var VIDEO_SECONDS = 6;
  var SERIF = '"NC Serif", Georgia, serif';
  var HAND = '"NC Hand", "Comic Sans MS", cursive';
  var DISPLAY = '"NC Display", system-ui, sans-serif';

  var $ = function (s) { return document.querySelector(s); };
  var canvas = $('#card');
  var ctx = canvas.getContext('2d');

  var state = {
    source: 'proverb', proverb: 0, custom: '', customSub: '',
    symbol: 'gye-nyame', theme: 'kente', mode: 'static'
  };
  var proverbs = [];
  var busy = false;        // stamping, recording or playing
  var video = null;        // { blob, ext } once recorded for the current card

  // ---------- small helpers ----------

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeBack(t) { var c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

  function rng(seed) {
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function save(key, val) { try { localStorage.setItem('nsem.' + key, JSON.stringify(val)); } catch (e) {} }
  function load(key) { try { return JSON.parse(localStorage.getItem('nsem.' + key)); } catch (e) { return null; } }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // ---------- symbols ----------

  var symbolById = {};
  SYMBOLS.forEach(function (s) { symbolById[s.id] = s; });
  var pathCache = {};
  function symbolPath(id) {
    if (!pathCache[id]) pathCache[id] = new Path2D(symbolById[id].d);
    return pathCache[id];
  }
  // fill is a colour or a function(ctx) returning a style in the 24x24 symbol space
  function drawSymbol(c, id, cx, cy, size, fill) {
    c.save();
    c.translate(cx - size / 2, cy - size / 2);
    c.scale(size / 24, size / 24);
    c.fillStyle = typeof fill === 'function' ? fill(c) : fill;
    c.fill(symbolPath(id));
    c.restore();
  }
  function goldFill(c) {
    var g = c.createLinearGradient(2, 1, 20, 24);
    g.addColorStop(0, '#FFE58A'); g.addColorStop(.45, '#E9B23A'); g.addColorStop(1, '#A8731C');
    return g;
  }

  // ---------- ink stamp (rough edges, uneven density, cloth texture) ----------

  function noiseField(size, cells, rand) {
    var small = makeCanvas(cells, cells), sc = small.getContext('2d');
    var img = sc.createImageData(cells, cells);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = rand() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    sc.putImageData(img, 0, 0);
    var big = makeCanvas(size, size), bc = big.getContext('2d');
    bc.imageSmoothingEnabled = true;
    bc.drawImage(small, 0, 0, size, size);
    var d = bc.getImageData(0, 0, size, size).data, out = new Float32Array(size * size);
    for (var j = 0; j < out.length; j++) out[j] = d[j * 4] / 255;
    return out;
  }
  function boxBlur(src, w, h, r) {
    var tmp = new Float32Array(src.length), out = new Float32Array(src.length), k = 1 / (2 * r + 1), x, y, s, o;
    for (y = 0; y < h; y++) {
      o = y * w; s = 0;
      for (x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) {
        tmp[o + x] = s * k;
        s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    for (x = 0; x < w; x++) {
      s = 0;
      for (y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (y = 0; y < h; y++) {
        out[y * w + x] = s * k;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  var INK = [30, 26, 23];
  var inkCache = {};
  function inkSymbol(id) {
    if (inkCache[id]) return inkCache[id];
    var S = 600, cv = makeCanvas(S, S), c = cv.getContext('2d');
    drawSymbol(c, id, S / 2, S / 2, S * .94, '#000');
    var img = c.getImageData(0, 0, S, S), d = img.data, n = S * S, a = new Float32Array(n), i;
    for (i = 0; i < n; i++) a[i] = d[i * 4 + 3] / 255;
    a = boxBlur(boxBlur(a, S, S, 2), S, S, 2);
    var rand = rng(hash(id));
    var blot = noiseField(S, 9, rand), mid = noiseField(S, 110, rand), fine = noiseField(S, 300, rand), grain = noiseField(S, S, rand);
    for (i = 0; i < n; i++) {
      var t = .5 + (mid[i] - .5) * .75 + (fine[i] - .5) * .35;
      var v = (a[i] - (t - .06)) / .12;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      if (v > 0) {
        var dens = .6 + .4 * blot[i];                    // uneven ink load
        if (grain[i] > .9 && blot[i] < .6) dens *= .3;    // tiny spots the ink missed
        if (fine[i] < .2 && mid[i] < .45) dens *= .55;    // dry patches
        v *= dens;
      }
      var k = i * 4;
      d[k] = INK[0]; d[k + 1] = INK[1]; d[k + 2] = INK[2]; d[k + 3] = v * 255;
    }
    c.putImageData(img, 0, 0);
    inkCache[id] = cv;
    return cv;
  }

  var fabricTile = null;
  function fabricPattern(c) {
    if (!fabricTile) {
      var S = 192, cv = makeCanvas(S, S), fc = cv.getContext('2d'), img = fc.createImageData(S, S), d = img.data;
      var rand = rng(1957), rows = [], cols = [], x, y;
      for (x = 0; x < S; x++) { rows.push(rand()); cols.push(rand()); }
      for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
        var over = ((x >> 2) + (y >> 2)) & 1;
        var g = .55 + ((over ? rows[y] : cols[x]) - .5) * .5 + (rand() - .5) * .3;
        if ((x & 3) === 3 || (y & 3) === 3) g -= .3;      // gaps between threads
        g = g < 0 ? 0 : g > 1 ? 1 : g;
        var k = (y * S + x) * 4;
        d[k] = 255 - (1 - g) * 70; d[k + 1] = 255 - (1 - g) * 85; d[k + 2] = 255 - (1 - g) * 115; d[k + 3] = 255;
      }
      fc.putImageData(img, 0, 0);
      fabricTile = cv;
    }
    return c.createPattern(fabricTile, 'repeat');
  }

  // a set of parallel wobbly lines, like the comb (dua afe) lines on adinkra cloth
  function combLine(c, x1, y1, x2, y2, rand, count) {
    var len = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    for (var k = 0; k < count; k++) {
      var off = (k - (count - 1) / 2) * 11;
      c.beginPath();
      for (var s = 0; s <= len; s += 36) {
        var j = (rand() - .5) * 3.2, f = s / len;
        var px = x1 + (x2 - x1) * f + nx * (off + j), py = y1 + (y2 - y1) * f + ny * (off + j);
        if (s === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.lineWidth = 3 + rand() * 1.5;
      c.stroke();
    }
  }

  // ---------- themes ----------

  var KENTE = ['#F2B90C', '#12823B', '#C1121F', '#141414', '#F2B90C', '#1D4E9E'];

  function kenteBg(c) {
    var cell = 120, seq = ['#F2B90C', '#12823B', '#F2B90C', '#C1121F', '#141414', '#F2B90C', '#12823B', '#141414'];
    for (var col = 0; col < 9; col++) for (var row = 0; row < 16; row++) {
      var x = col * cell, y = row * cell, k;
      if ((col + row) % 2 === 0) {
        for (k = 0; k < 8; k++) { c.fillStyle = seq[(k + col) % seq.length]; c.fillRect(x, y + k * 15, cell, 15); }
      } else {
        c.fillStyle = KENTE[(col * 3 + row) % 4];
        c.fillRect(x, y, cell, cell);
        c.fillStyle = c.fillStyle === '#141414' ? '#F2B90C' : '#141414';
        for (k = 0; k < 4; k++) c.fillRect(x + 18 + k * 26, y, 8, cell);
      }
    }
    c.fillStyle = '#141414';
    for (col = 0; col <= 9; col++) c.fillRect(col * cell - 3, 0, 6, H);
  }
  function frame(c, color, inset, width) {
    c.strokeStyle = color; c.lineWidth = width;
    c.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  }

  var THEMES = [
    {
      id: 'kente', name: 'Kente', swatch: 'repeating-linear-gradient(90deg,#F2B90C 0 6px,#12823B 6px 12px,#C1121F 12px 18px,#141414 18px 22px)',
      bg: function (c) { kenteBg(c); },
      panel: 'rgba(18,13,8,.9)', panelLine: '#F2B90C',
      symbol: goldFill, text: '#FFF4DC', sub: '#F2C94C', accent: '#F2B90C', mark: '#FFF4DC', markBg: 'rgba(18,13,8,.85)',
      base: '#141414', threads: KENTE, vpanel: 'rgba(18,13,8,.88)'
    },
    {
      id: 'gold', name: 'Dark gold', swatch: 'radial-gradient(circle at 50% 40%,#E9B23A 0 22%,#2A1F0C 23%,#0B0805)',
      bg: function (c) {
        var g = c.createRadialGradient(540, 700, 80, 540, 900, 1300);
        g.addColorStop(0, '#2C2210'); g.addColorStop(1, '#070504');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.save(); c.globalAlpha = .07; c.strokeStyle = '#E9B23A'; c.lineWidth = 2;
        for (var i = -H; i < W + H; i += 90) {
          c.beginPath(); c.moveTo(i, 0); c.lineTo(i + H, H); c.moveTo(i + H, 0); c.lineTo(i, H); c.stroke();
        }
        c.restore();
        frame(c, '#C99A2E', 48, 3); frame(c, 'rgba(201,154,46,.5)', 62, 1.5);
      },
      symbol: goldFill, text: '#F6E3B4', sub: '#C9A35A', accent: '#E9B23A', mark: '#C9A35A',
      base: '#0B0805', threads: ['#E9B23A', '#8A6420', '#F6D27A', '#3A2A10'], vpanel: 'rgba(8,6,4,.82)'
    },
    {
      id: 'sunset', name: 'Sunset', swatch: 'linear-gradient(#FFB347,#FF6B35 40%,#D7263D 70%,#4A1942)',
      bg: function (c) {
        var g = c.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#FFC15E'); g.addColorStop(.3, '#FF7B3A'); g.addColorStop(.62, '#D7263D'); g.addColorStop(1, '#3E1240');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        var s = c.createRadialGradient(540, 620, 60, 540, 620, 420);
        s.addColorStop(0, 'rgba(255,240,180,.95)'); s.addColorStop(.62, 'rgba(255,214,120,.55)'); s.addColorStop(1, 'rgba(255,200,100,0)');
        c.fillStyle = s; c.fillRect(0, 150, W, 940);
      },
      symbol: '#3A0F2E', text: '#FFFFFF', sub: '#FFE2B8', accent: '#FFE2B8', mark: 'rgba(255,255,255,.8)', shadow: 'rgba(60,10,30,.45)',
      base: '#E0503A', threads: ['#FFC15E', '#FF7B3A', '#D7263D', '#7A1E4E', '#3E1240'], vpanel: 'rgba(62,18,64,.72)'
    },
    {
      id: 'white', name: 'Minimal white', swatch: 'linear-gradient(135deg,#FFFFFF 50%,#ECE6DA 50%)',
      bg: function (c) {
        c.fillStyle = '#FAF8F3'; c.fillRect(0, 0, W, H);
        c.fillStyle = '#C9A24A'; c.fillRect(490, 210, 100, 6);
      },
      symbol: '#141414', text: '#141414', sub: '#5E5A52', accent: '#C9A24A', mark: '#8D877B',
      base: '#FAF8F3', threads: ['#141414', '#C9A24A', '#D8D2C4', '#6E6A60'], vpanel: 'rgba(250,248,243,.9)'
    },
    {
      id: 'gbg', name: 'Green, black & gold', swatch: 'linear-gradient(#111 0 25%,#0E6B35 25% 75%,#111 75%),linear-gradient(#FCD116,#FCD116)',
      bg: function (c) {
        var g = c.createRadialGradient(540, 820, 100, 540, 900, 1100);
        g.addColorStop(0, '#13874A'); g.addColorStop(1, '#063A1C');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.fillStyle = '#0D0D0D'; c.fillRect(0, 0, W, 130); c.fillRect(0, H - 80, W, 80);
        c.fillStyle = '#FCD116'; c.fillRect(0, 130, W, 10); c.fillRect(0, H - 90, W, 10);
        for (var x = 30; x < W; x += 80) {
          c.beginPath(); c.moveTo(x, 65); c.lineTo(x + 16, 50); c.lineTo(x + 32, 65); c.lineTo(x + 16, 80); c.fill();
          c.beginPath(); c.moveTo(x, H - 40); c.lineTo(x + 16, H - 55); c.lineTo(x + 32, H - 40); c.lineTo(x + 16, H - 25); c.fill();
        }
      },
      symbol: '#FCD116', text: '#FFFFFF', sub: '#FCD116', accent: '#FCD116', mark: '#FCD116',
      base: '#0B4D27', threads: ['#FCD116', '#0D0D0D', '#13874A', '#FCD116', '#063A1C'], vpanel: 'rgba(6,40,20,.85)'
    },
    {
      id: 'red', name: 'Red & gold', swatch: 'radial-gradient(circle at 50% 45%,#F2C14E 0 20%,#9B1B1B 21%,#5E0B0B)',
      bg: function (c) {
        var g = c.createRadialGradient(540, 800, 100, 540, 900, 1200);
        g.addColorStop(0, '#A81E1E'); g.addColorStop(1, '#4F0909');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.save(); c.globalAlpha = .09;
        for (var y = 0; y < 13; y++) for (var x = 0; x < 7; x++) {
          drawSymbol(c, state.symbol, x * 170 + (y % 2 ? 85 : 0) + 30, y * 160 + 40, 70, '#F2C14E');
        }
        c.restore();
        frame(c, '#F2C14E', 44, 4);
      },
      symbol: goldFill, text: '#FFF3D6', sub: '#F2C14E', accent: '#F2C14E', mark: '#F2C14E',
      base: '#6E0F0F', threads: ['#F2C14E', '#C0392B', '#3D0606', '#E89A2C'], vpanel: 'rgba(60,6,6,.82)'
    },
    {
      id: 'ink', name: 'Ink stamp', swatch: 'radial-gradient(circle,#1E1A17 0 26%,#EFE3C8 28%)', ink: true,
      bg: function (c) {
        c.fillStyle = '#EEE1C4'; c.fillRect(0, 0, W, H);
        var g = c.createRadialGradient(540, 900, 300, 540, 960, 1250);
        g.addColorStop(0, 'rgba(255,250,235,.5)'); g.addColorStop(1, 'rgba(150,120,70,.25)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        var rand = rng(42);
        c.save(); c.strokeStyle = 'rgba(30,26,23,.72)'; c.lineCap = 'round';
        combLine(c, 70, 90, 1010, 90, rand, 4); combLine(c, 70, 1856, 1010, 1856, rand, 4);
        combLine(c, 70, 70, 70, 1876, rand, 4); combLine(c, 1010, 70, 1010, 1876, rand, 4);
        combLine(c, 160, 1000, 920, 1000, rand, 3);
        c.restore();
      },
      text: '#221D19', sub: '#4A4037', accent: 'rgba(30,26,23,.7)', mark: '#5A4E42',
      base: '#EEE1C4', threads: ['#2B2420', '#6B4E2E', '#9C7A4A', '#1E1A17'], vpanel: 'rgba(238,225,196,.9)'
    }
  ];
  var themeById = {};
  THEMES.forEach(function (t) { themeById[t.id] = t; });

  // ---------- text layout ----------

  function message() {
    if (state.source === 'custom') {
      return { main: state.custom.trim() || 'Type your message', sub: state.customSub.trim() };
    }
    var p = proverbs[state.proverb] || { twi: '…', en: '' };
    return { main: p.twi, sub: p.en };
  }
  function wrap(c, text, maxW) {
    var out = [];
    text.split(/\n+/).forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      words.forEach(function (w) {
        var test = line ? line + ' ' + w : w;
        if (!line || c.measureText(test).width <= maxW) line = test;
        else { out.push(line); line = w; }
      });
      if (line) out.push(line);
    });
    return out;
  }
  function fit(c, text, font, maxW, maxH, big, small, lh) {
    for (var size = big; ; size -= 4) {
      c.font = font(size);
      var lines = wrap(c, text, maxW);
      var widest = Math.max.apply(null, lines.map(function (l) { return c.measureText(l).width; }));
      if (size <= small || (lines.length * size * lh <= maxH && widest <= maxW)) {
        return { lines: lines, size: size, font: font(size), lh: size * lh };
      }
    }
  }
  // returns the lines with their final positions, shared by picture and video
  function layoutText(c, hand) {
    var msg = message();
    var main = fit(c, msg.main, function (s) { return (hand ? '600 ' : '800 ') + s + 'px ' + (hand ? HAND : SERIF); },
      860, 470, hand ? 92 : 88, 44, hand ? 1.3 : 1.24);
    var sub = msg.sub ? fit(c, msg.sub, function (s) { return (hand ? '600 ' : 'italic 400 ') + s + 'px ' + (hand ? HAND : SERIF); },
      820, 210, 46, 30, 1.32) : null;
    var gap = 44, total = main.lines.length * main.lh + (sub ? gap + sub.lines.length * sub.lh : 0);
    var y = 1060 + Math.max(0, (600 - total) / 2), out = [];
    main.lines.forEach(function (l) { out.push({ text: l, font: main.font, y: y + main.lh / 2, sub: false }); y += main.lh; });
    if (sub) {
      y += gap;
      sub.lines.forEach(function (l) { out.push({ text: l, font: sub.font, y: y + sub.lh / 2, sub: true }); y += sub.lh; });
    }
    return out;
  }
  function drawLine(c, th, l) {
    c.font = l.font;
    c.fillStyle = l.sub ? th.sub : th.text;
    c.fillText(l.text, W / 2, l.y);
  }

  // ---------- card pieces ----------

  function prepText(c, th) {
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (th.shadow) { c.shadowColor = th.shadow; c.shadowBlur = 14; c.shadowOffsetY = 3; }
  }
  function drawPanel(c, fill, line) {
    roundRect(c, 84, 170, W - 168, 1590, 36);
    c.fillStyle = fill; c.fill();
    if (line) { c.strokeStyle = line; c.lineWidth = 3; roundRect(c, 104, 190, W - 208, 1550, 26); c.stroke(); }
  }
  function drawOrnament(c, th) {
    if (th.ink) return;
    c.fillStyle = th.accent;
    c.fillRect(400, 998, 110, 4); c.fillRect(570, 998, 110, 4);
    c.beginPath(); c.moveTo(540, 984); c.lineTo(556, 1000); c.lineTo(540, 1016); c.lineTo(524, 1000); c.fill();
  }
  // p: 0..1 stamp progress (undefined = fully stamped)
  function drawMainSymbol(c, th, p) {
    var size = 540, cx = 540, cy = 600;
    if (!th.ink) { drawSymbol(c, state.symbol, cx, cy, size, th.symbol); return; }
    var img = inkSymbol(state.symbol);
    if (p === undefined || p >= 1) { c.drawImage(img, cx - size / 2, cy - size / 2, size, size); return; }
    c.save();
    if (p < .6) {
      // the carved stamp hovering, then coming down
      var d = easeOut(p / .6), s = size * (1.35 - .35 * d), lift = (1 - d) * 60;
      c.globalAlpha = .1 + .12 * d;
      c.drawImage(img, cx - s / 2 + lift * .6, cy - s / 2 + lift, s, s);
    } else {
      // impact: ink sets in
      var q = clamp((p - .6) / .4), shake = (1 - q) * 8, sz = size * (1 + .025 * (1 - q));
      c.globalAlpha = .45 + .55 * easeOut(q);
      c.drawImage(img, cx - sz / 2 + (Math.sin(q * 40) * shake), cy - sz / 2, sz, sz);
    }
    c.restore();
  }
  var speckTile = null;
  function wornText(c) {
    if (!speckTile) {
      speckTile = makeCanvas(160, 160);
      var sc = speckTile.getContext('2d'), rand = rng(77);
      for (var i = 0; i < 700; i++) {
        sc.fillStyle = 'rgba(238,225,196,' + (.15 + rand() * .45).toFixed(2) + ')';
        sc.beginPath(); sc.arc(rand() * 160, rand() * 160, .4 + rand() * 1.1, 0, 7); sc.fill();
      }
    }
    c.save();
    c.fillStyle = c.createPattern(speckTile, 'repeat');
    c.fillRect(100, 1030, W - 200, 680);
    c.restore();
  }
  function inkFinish(c) {
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.globalAlpha = .55;
    c.fillStyle = fabricPattern(c);
    c.fillRect(0, 0, W, H);
    c.restore();
  }
  function drawWatermark(c, th) {
    c.save();
    c.font = '800 26px ' + DISPLAY; c.textAlign = 'center'; c.textBaseline = 'middle';
    var label = 'Made with Nsem Cards', y = 1812;
    if (th.markBg) {
      var w = c.measureText(label).width + 48;
      roundRect(c, 540 - w / 2, y - 26, w, 52, 26); c.fillStyle = th.markBg; c.fill();
    }
    c.fillStyle = th.mark; c.globalAlpha = .9;
    c.fillText(label, 540, y);
    c.restore();
  }

  function renderStatic(c, stamp) {
    var th = themeById[state.theme];
    c.save();
    th.bg(c);
    if (th.panel) drawPanel(c, th.panel, th.panelLine);
    drawMainSymbol(c, th, stamp);
    drawOrnament(c, th);
    prepText(c, th);
    layoutText(c, false).forEach(function (l) { drawLine(c, th, l); });
    c.restore();
    if (th.ink) { wornText(c); inkFinish(c); }
    drawWatermark(c, th);
  }

  // ---------- animated card ----------

  // woven threads: verticals draw first, horizontals weave over and under them
  function drawThreads(c, th, t) {
    var cols = th.threads, nV = 8, sp = W / nV, i, j, y, x, p;
    c.save();
    c.lineCap = 'butt';
    function horiz(j, over) {
      var p = clamp((t - .7 - j * .1) / 1.5);
      if (p <= 0) return;
      var spH = H / 14, y0 = spH * (j + .5), ltr = j % 2 === 0, end = W * easeInOut(p);
      c.strokeStyle = cols[(j + 2) % cols.length];
      c.lineWidth = 88;
      c.setLineDash(over ? [sp, sp] : []);
      c.lineDashOffset = over && j % 2 ? sp : 0;
      c.beginPath();
      for (var s = 0; s <= end + 1; s += 30) {
        var xx = ltr ? Math.min(s, end) : W - Math.min(s, end);
        var yy = y0 + Math.sin(xx * .004 + j + t * .9) * 9;
        if (s === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy);
      }
      c.stroke();
    }
    for (j = 0; j < 14; j++) horiz(j, false);
    for (i = 0; i < nV; i++) {
      p = clamp((t - i * .12) / 1.6);
      if (p <= 0) continue;
      var x0 = sp * (i + .5), down = i % 2 === 0, end = (H + 80) * easeInOut(p);
      c.setLineDash([]);
      c.strokeStyle = cols[i % cols.length];
      c.lineWidth = 98;
      c.beginPath();
      for (var s = 0; s <= end + 1; s += 40) {
        y = down ? -40 + Math.min(s, end) : H + 40 - Math.min(s, end);
        x = x0 + Math.sin(y * .0045 + i * 1.3 + t * 1.1) * 16;
        if (s === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 10; c.stroke();
    }
    for (j = 0; j < 14; j++) horiz(j, true);
    c.restore();
  }

  function renderFrame(c, t, lines) {
    var th = themeById[state.theme];
    c.save();
    c.fillStyle = th.base; c.fillRect(0, 0, W, H);
    drawThreads(c, th, t);
    var a = easeOut(clamp((t - 2.1) / .7));
    if (a > 0) {
      c.globalAlpha = a;
      roundRect(c, 70, 150, W - 140, 1712, 40); c.fillStyle = th.vpanel; c.fill();
      c.globalAlpha = 1;
    }
    var sp = clamp((t - 2.5) / .8);
    if (sp > 0) {
      if (th.ink) drawMainSymbol(c, th, sp);
      else {
        c.globalAlpha = clamp(sp * 2);
        drawSymbol(c, state.symbol, 540, 600, 540 * (.8 + .2 * easeBack(sp)), th.symbol);
        c.globalAlpha = 1;
      }
    }
    c.globalAlpha = clamp((t - 3) / .4);
    if (c.globalAlpha > 0) drawOrnament(c, th);
    c.globalAlpha = 1;

    // write each line in, left to right, one after another
    prepText(c, th);
    var start = 3.2, endT = 5.4, total = 0;
    lines.forEach(function (l) { c.font = l.font; l.w = c.measureText(l.text).width; total += l.w + 120; });
    var acc = 0;
    lines.forEach(function (l) {
      var t0 = start + (endT - start) * acc / total, t1 = start + (endT - start) * (acc + l.w + 120) / total;
      acc += l.w + 120;
      var p = clamp((t - t0) / (t1 - t0));
      if (p <= 0) return;
      c.save();
      if (p < 1) {
        c.beginPath();
        c.rect(0, l.y - 120, W / 2 - l.w / 2 - 10 + (l.w + 20) * p, 240);
        c.clip();
      }
      drawLine(c, th, l);
      c.restore();
    });
    c.restore();
    if (th.ink) { wornText(c); inkFinish(c); }
    drawWatermark(c, th);
  }

  // ---------- drawing the preview ----------

  var raf = 0;
  function draw() {
    if (raf || busy) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      if (busy) return;
      if (state.mode === 'video') renderFrame(ctx, VIDEO_SECONDS, layoutText(ctx, true));
      else renderStatic(ctx);
    });
  }
  function changed() {
    video = null;
    save('state', { source: state.source, proverb: state.proverb, symbol: state.symbol, theme: state.theme, mode: state.mode });
    updateButtons();
    draw();
  }

  function animate(seconds, onFrame) {
    return new Promise(function (resolve) {
      var t0 = performance.now();
      (function step(now) {
        var t = Math.min(seconds, (now - t0) / 1000);
        onFrame(t);
        if (t >= seconds) resolve(); else requestAnimationFrame(step);
      })(t0);
    });
  }

  // ---------- picture export ----------

  function fileName(ext) {
    var d = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
    return 'nsem-card-' + state.symbol + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.' + ext;
  }
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function pngBlob() {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/png');
    });
  }
  function stampIfInk() {
    if (state.theme !== 'ink' || state.mode !== 'static') return Promise.resolve();
    busy = true;
    var hit = false;
    return animate(.9, function (t) {
      var p = clamp(t / .75);
      if (p >= .6 && !hit) { hit = true; if (navigator.vibrate) navigator.vibrate(25); }
      renderStatic(ctx, p);
    }).then(function () { busy = false; renderStatic(ctx); });
  }
  function shareText() {
    var m = message();
    return m.main + (m.sub ? '\n' + m.sub : '') + '\n— Made with Nsem Cards';
  }
  function shareFile(file) {
    var data = { files: [file], title: 'Nsem Cards', text: shareText() };
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
      downloadBlob(file, file.name);
      toast('Sharing isn\'t available here, so we downloaded it instead.');
      return Promise.resolve();
    }
    return navigator.share(data).catch(function (e) {
      if (e && e.name !== 'AbortError') toast('Could not share. Try Download instead.');
    });
  }

  // ---------- video ----------

  function videoType() {
    if (!window.MediaRecorder || !canvas.captureStream) return null;
    var types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4',
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    return null;
  }
  var VIDEO_TYPE = videoType();

  function playPreview() {
    if (busy) return;
    busy = true; $('#play').hidden = true;
    var lines = layoutText(ctx, true);
    animate(VIDEO_SECONDS, function (t) { renderFrame(ctx, t, lines); }).then(function () {
      busy = false; $('#play').hidden = false;
    });
  }

  function recordVideo() {
    if (busy || !VIDEO_TYPE) return;
    busy = true;
    updateButtons();
    $('#play').hidden = true; $('#rec').hidden = false;
    var lines = layoutText(ctx, true);
    renderFrame(ctx, 0, lines);
    var stream = canvas.captureStream(30), chunks = [];
    var rec = new MediaRecorder(stream, { mimeType: VIDEO_TYPE, videoBitsPerSecond: 3500000 });
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    var stopped = new Promise(function (resolve) { rec.onstop = resolve; });
    rec.start(500);
    var hold = .25;
    animate(VIDEO_SECONDS + hold, function (t) {
      renderFrame(ctx, Math.min(t, VIDEO_SECONDS), lines);
      $('#rec-fill').style.width = (clamp(t / VIDEO_SECONDS) * 100) + '%';
      $('#rec-text').textContent = 'Recording ' + Math.ceil(Math.max(0, VIDEO_SECONDS - t)) + 's';
    }).then(function () {
      rec.stop();
      return stopped;
    }).then(function () {
      stream.getTracks().forEach(function (tr) { tr.stop(); });
      var mime = VIDEO_TYPE.split(';')[0];
      video = { blob: new Blob(chunks, { type: mime }), ext: mime === 'video/mp4' ? 'mp4' : 'webm' };
      busy = false;
      $('#rec').hidden = true; $('#play').hidden = false;
      updateButtons();
      toast('Video ready (' + (video.blob.size / 1048576).toFixed(1) + ' MB). Download or share it.');
    }).catch(function () {
      busy = false;
      $('#rec').hidden = true; $('#play').hidden = false;
      updateButtons();
      toast('Recording failed. Try again, or use Picture.');
    });
  }

  // ---------- buttons ----------

  var btnMain = $('#btn-main'), btnShare = $('#btn-share');

  // keep the page's bottom padding equal to the fixed bar's real height
  var bar = $('.actionbar');
  function syncBarHeight() {
    if (getComputedStyle(bar).position !== 'fixed') return;
    document.documentElement.style.setProperty('--bar-h', Math.ceil(bar.getBoundingClientRect().height) + 'px');
  }
  syncBarHeight();
  if (window.ResizeObserver) new ResizeObserver(syncBarHeight).observe(bar);
  else window.addEventListener('resize', syncBarHeight);
  function updateButtons() {
    var vid = state.mode === 'video';
    btnMain.disabled = busy || (vid && !VIDEO_TYPE);
    btnShare.disabled = busy || (vid && !video);
    if (!vid) { btnMain.textContent = 'Download'; btnShare.textContent = 'Share'; }
    else if (video) { btnMain.textContent = 'Download video'; btnShare.textContent = 'Share video'; }
    else { btnMain.textContent = busy ? 'Recording…' : 'Make 6s video'; btnShare.textContent = 'Share video'; }
  }
  btnMain.addEventListener('click', function () {
    if (busy) return;
    if (state.mode === 'video') {
      if (video) downloadBlob(video.blob, fileName(video.ext));
      else recordVideo();
      return;
    }
    stampIfInk().then(pngBlob).then(function (b) { downloadBlob(b, fileName('png')); })
      .catch(function () { toast('Could not save the picture.'); });
  });
  btnShare.addEventListener('click', function () {
    if (busy) return;
    if (state.mode === 'video') {
      if (video) shareFile(new File([video.blob], fileName(video.ext), { type: video.blob.type }));
      return;
    }
    // share needs a fresh tap, so skip the stamp animation and share straight away
    pngBlob().then(function (b) { return shareFile(new File([b], fileName('png'), { type: 'image/png' })); })
      .catch(function () { toast('Could not share the picture.'); });
  });
  $('#play').addEventListener('click', playPreview);

  // ---------- controls ----------

  function setChecked(container, id) {
    Array.prototype.forEach.call(container.children, function (b) {
      var on = b.dataset.id === id;
      b.setAttribute('aria-checked', on);
      b.tabIndex = on ? 0 : -1;
    });
  }
  function radioGrid(container, items, render, onPick) {
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.id = it.id;
      b.innerHTML = render(it);
      b.addEventListener('click', function () { onPick(it.id); });
      container.appendChild(b);
    });
    container.addEventListener('keydown', function (e) {
      var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!keys[e.key]) return;
      e.preventDefault();
      var btns = Array.prototype.slice.call(container.children);
      var i = btns.indexOf(document.activeElement), next = btns[(i + keys[e.key] + btns.length) % btns.length];
      next.focus(); next.click();
    });
  }
  function esc(s) { return s.replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }

  function pickSymbol(id) {
    state.symbol = id;
    setChecked($('#symbols'), id);
    $('#sym-meaning').textContent = symbolById[id].name + ': ' + symbolById[id].meaning;
    changed();
  }
  function pickTheme(id) {
    state.theme = id;
    setChecked($('#themes'), id);
    changed();
  }
  function setSource(src) {
    state.source = src;
    $('#src-proverb').hidden = src !== 'proverb';
    $('#src-custom').hidden = src !== 'custom';
    changed();
  }
  function setMode(mode) {
    if (mode === 'video' && !VIDEO_TYPE) {
      $('#video-unsupported').hidden = false;
      document.querySelector('input[name="mode"][value="static"]').checked = true;
      mode = 'static';
    }
    state.mode = mode;
    $('#video-warn').hidden = mode !== 'video';
    $('#play').hidden = mode !== 'video';
    changed();
  }
  function setProverb(i) {
    state.proverb = i;
    $('#proverb').value = String(i);
    var p = proverbs[i];
    $('#meaning').textContent = p ? p.en + ' — ' + p.meaning : '';
    changed();
  }

  function initControls() {
    radioGrid($('#symbols'), SYMBOLS, function (s) {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + s.d + '"/></svg><span>' + esc(s.name) + '</span>';
    }, pickSymbol);
    radioGrid($('#themes'), THEMES, function (t) {
      return '<span class="swatch" style="background:' + t.swatch + '"></span><span>' + esc(t.name) + '</span>';
    }, pickTheme);

    var sel = $('#proverb');
    proverbs.forEach(function (p, i) {
      var o = document.createElement('option');
      o.value = String(i); o.textContent = p.twi;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { setProverb(+sel.value); });
    $('#shuffle').addEventListener('click', function () {
      if (proverbs.length < 2) return;
      var i;
      do { i = Math.floor(Math.random() * proverbs.length); } while (i === state.proverb);
      setProverb(i);
    });
    $('#custom').addEventListener('input', function (e) { state.custom = e.target.value; changed(); });
    $('#custom-sub').addEventListener('input', function (e) { state.customSub = e.target.value; changed(); });
    document.querySelectorAll('input[name="source"]').forEach(function (r) {
      r.addEventListener('change', function () { setSource(r.value); });
    });
    document.querySelectorAll('input[name="mode"]').forEach(function (r) {
      r.addEventListener('change', function () { setMode(r.value); });
    });
    if (!VIDEO_TYPE) $('#video-unsupported').hidden = false;

    var saved = load('state') || {};
    if (symbolById[saved.symbol]) state.symbol = saved.symbol;
    if (themeById[saved.theme]) state.theme = saved.theme;
    var pi = saved.proverb >= 0 && saved.proverb < proverbs.length ? saved.proverb : Math.floor(Math.random() * proverbs.length);
    document.querySelector('input[name="source"][value="' + (saved.source === 'custom' ? 'custom' : 'proverb') + '"]').checked = true;
    document.querySelector('input[name="mode"][value="' + (saved.mode === 'video' && VIDEO_TYPE ? 'video' : 'static') + '"]').checked = true;

    pickSymbol(state.symbol);
    pickTheme(state.theme);
    setProverb(pi);
    setSource(saved.source === 'custom' ? 'custom' : 'proverb');
    setMode(saved.mode === 'video' ? 'video' : 'static');
  }

  // ---------- start: wait for fonts and proverbs ----------

  function loadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var sample = 'Ɛɛ Ɔɔ Aa';
    var all = Promise.all([
      document.fonts.load('800 40px "NC Serif"', sample),
      document.fonts.load('italic 400 40px "NC Serif"', sample),
      document.fonts.load('600 40px "NC Hand"', sample),
      document.fonts.load('800 40px "NC Display"', 'Nsem')
    ]);
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 8000); });
    return Promise.race([all, timeout]).catch(function () {});
  }
  function loadProverbs() {
    return fetch('proverbs.json').then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (data) {
      proverbs = (data.proverbs || []).filter(function (p) { return p && p.twi; });
    });
  }

  Promise.all([loadFonts(), loadProverbs()]).then(function () {
    initControls();
    renderStatic(ctx);   // draw once synchronously so the first paint is a real card
    draw();
    $('#loading').classList.add('done');
    setTimeout(function () { $('#loading').hidden = true; }, 400);
  }).catch(function () {
    $('#loading-text').textContent = 'Could not load the proverbs. Check your connection and refresh.';
  });
})();
