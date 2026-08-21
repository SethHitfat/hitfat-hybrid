/* ============================================================
   QR — version 1, error correction H, alphanumeric only.

   Scoped deliberately: the only thing this ever encodes is a six-character
   check-in code. Six alphanumeric characters need 46 bits and version 1 at the
   highest error correction holds 72, so there is one version, one block, no
   alignment patterns and no interleaving — the parts of the QR spec that carry
   the bugs. Bundled rather than fetched from a CDN, because the code has to
   appear on a screen in a gym whose wifi is not guaranteed.
   ============================================================ */
(function(global){
  'use strict';
  var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  var SIZE = 21;          // version 1
  var DATA_CW = 9;        // version 1-H: 9 data codewords
  var ECC_CW  = 17;       //              17 error correction codewords
  var ECC_FMT = 2;        // format bits for level H

  /* ---- GF(256), primitive polynomial 0x11D ---- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function(){
    var x = 1;
    for (var i = 0; i < 255; i++){ EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b){ return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /* generator polynomial, highest degree first */
  function generator(n){
    var g = [1];
    for (var i = 0; i < n; i++){
      var out = new Array(g.length + 1);
      for (var k = 0; k < out.length; k++) out[k] = 0;
      for (var j = 0; j < g.length; j++){
        out[j]     ^= g[j];                 // g(x) * x
        out[j + 1] ^= mul(g[j], EXP[i]);    // g(x) * a^i
      }
      g = out;
    }
    return g;
  }
  function ecc(data, n){
    var g = generator(n), res = data.slice(), i, j;
    for (i = 0; i < n; i++) res.push(0);
    for (i = 0; i < data.length; i++){
      var c = res[i];
      if (!c) continue;
      for (j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], c);
    }
    return res.slice(data.length);
  }

  /* ---- bit stream ---- */
  function encodeData(text){
    var bits = [], i;
    function push(v, len){ for (var k = len - 1; k >= 0; k--) bits.push((v >> k) & 1); }
    push(0x2, 4);                 // alphanumeric mode
    push(text.length, 9);         // character count, versions 1–9
    for (i = 0; i + 1 < text.length; i += 2)
      push(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
    if (text.length % 2) push(ALNUM.indexOf(text[text.length - 1]), 6);

    var cap = DATA_CW * 8;
    for (i = 0; i < 4 && bits.length < cap; i++) bits.push(0);   // terminator
    while (bits.length % 8) bits.push(0);
    var pad = [0xEC, 0x11], p = 0;
    while (bits.length < cap) push(pad[p++ % 2], 8);

    var bytes = [];
    for (i = 0; i < bits.length; i += 8){
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      bytes.push(b);
    }
    return bytes;
  }

  /* ---- matrix ---- */
  function blank(){
    var m = [], f = [], r, c;
    for (r = 0; r < SIZE; r++){
      m.push(new Array(SIZE).fill(0));
      f.push(new Array(SIZE).fill(false));   // true = function module, never masked
    }
    function set(x, y, dark){ m[y][x] = dark ? 1 : 0; f[y][x] = true; }

    function finder(x0, y0){
      for (var dy = -1; dy <= 7; dy++) for (var dx = -1; dx <= 7; dx++){
        var x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        var d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));   // Chebyshev ring index
        set(x, y, d !== 2 && d <= 3);
      }
    }
    finder(0, 0); finder(SIZE - 7, 0); finder(0, SIZE - 7);

    for (var i = 8; i < SIZE - 8; i++){                          // timing
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    set(8, SIZE - 8, true);                                      // the always-dark module

    // format areas are written later; reserve them so data skips over
    for (var k = 0; k <= 5; k++) f[k][8] = true;
    f[7][8] = f[8][8] = f[8][7] = true;
    for (var q = 0; q <= 5; q++) f[8][q] = true;
    for (var a = 0; a < 8; a++) f[SIZE - 1 - a][8] = true;
    for (var b = 8; b < 15; b++) f[8][SIZE - 15 + b] = true;

    return { m: m, f: f, set: set };
  }

  function drawFormat(g, mask){
    var data = (ECC_FMT << 3) | mask, rem = data, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    function bit(n){ return (bits >>> n) & 1; }

    for (i = 0; i <= 5; i++) g.set(8, i, bit(i));
    g.set(8, 7, bit(6)); g.set(8, 8, bit(7)); g.set(7, 8, bit(8));
    for (i = 9; i < 15; i++) g.set(14 - i, 8, bit(i));

    for (i = 0; i < 8; i++) g.set(SIZE - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) g.set(8, SIZE - 15 + i, bit(i));
    g.set(8, SIZE - 8, 1);
  }

  function maskAt(mask, x, y){
    switch (mask){
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
  }

  function drawData(g, all, mask){
    var i = 0, right, vert, j, x, y, upward, dark;
    for (right = SIZE - 1; right >= 1; right -= 2){
      if (right === 6) right = 5;                       // the timing column is skipped whole
      for (vert = 0; vert < SIZE; vert++){
        for (j = 0; j < 2; j++){
          x = right - j;
          upward = ((right + 1) & 2) === 0;
          y = upward ? SIZE - 1 - vert : vert;
          if (g.f[y][x]) continue;
          dark = (i < all.length * 8) ? ((all[i >>> 3] >>> (7 - (i & 7))) & 1) : 0;
          if (i < all.length * 8) i++;
          g.m[y][x] = maskAt(mask, x, y) ? (dark ^ 1) : dark;
        }
      }
    }
  }

  /* the four penalty rules, so the chosen mask is the one the spec would choose */
  function penalty(m){
    var n = SIZE, score = 0, x, y, run, dark = 0;
    function runScore(len){ return len >= 5 ? 3 + (len - 5) : 0; }
    for (y = 0; y < n; y++){
      run = 1;
      for (x = 1; x < n; x++){
        if (m[y][x] === m[y][x - 1]) run++;
        else { score += runScore(run); run = 1; }
      }
      score += runScore(run);
    }
    for (x = 0; x < n; x++){
      run = 1;
      for (y = 1; y < n; y++){
        if (m[y][x] === m[y - 1][x]) run++;
        else { score += runScore(run); run = 1; }
      }
      score += runScore(run);
    }
    for (y = 0; y < n - 1; y++) for (x = 0; x < n - 1; x++){
      var v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
    var pat1 = [1,0,1,1,1,0,1,0,0,0,0], pat2 = [0,0,0,0,1,0,1,1,1,0,1];
    function matches(get, i){
      var a = true, b = true;
      for (var k = 0; k < 11; k++){
        if (get(i + k) !== pat1[k]) a = false;
        if (get(i + k) !== pat2[k]) b = false;
      }
      return a || b;
    }
    for (y = 0; y < n; y++) for (x = 0; x + 11 <= n; x++)
      if (matches(function(i){ return m[y][i]; }, x)) score += 40;
    for (x = 0; x < n; x++) for (y = 0; y + 11 <= n; y++)
      if (matches(function(i){ return m[i][x]; }, y)) score += 40;

    for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (m[y][x]) dark++;
    var pct = dark * 100 / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* ---- public ---- */
  function matrix(text){
    text = String(text || '').toUpperCase();
    for (var i = 0; i < text.length; i++)
      if (ALNUM.indexOf(text[i]) < 0) throw new Error('character not in alphanumeric mode: ' + text[i]);
    if (text.length > 10) throw new Error('too long for version 1-H');

    var all = encodeData(text).concat(ecc(encodeData(text), ECC_CW));
    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++){
      var g = blank();
      drawFormat(g, mask);
      drawData(g, all, mask);
      var s = penalty(g.m);
      if (s < bestScore){ bestScore = s; best = g.m; }
    }
    return best;
  }

  /* draws into a canvas, with the four-module quiet zone a scanner needs */
  function toCanvas(text, px, canvas){
    var m = matrix(text), quiet = 4, n = SIZE + quiet * 2;
    var scale = Math.max(1, Math.floor((px || 240) / n));
    var c = canvas || document.createElement('canvas');
    c.width = c.height = n * scale;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    for (var y = 0; y < SIZE; y++) for (var x = 0; x < SIZE; x++)
      if (m[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    return c;
  }

  global.HFQR = { matrix: matrix, toCanvas: toCanvas };
})(window);
