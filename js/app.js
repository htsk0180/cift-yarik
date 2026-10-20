/* ============================================================================
   ÇİFT YARIK — uygulama
   Modlar: Fotonlar (birikim), Dalga Alanı (Fresnel), Hangi Yol?, Madde, Teori
   ========================================================================== */
(function () {
  'use strict';

  const P = window.Physics;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ------------------------------------------------------------------ durum */

  const state = {
    mode: 'buildup',
    lambda: 532e-9,
    d: 0.25e-3,
    a: 0.06e-3,
    L: 1.2,
    N: 2,
    V: 1,
    zScreen: 0.12,
    theta: 22,
    analyzer: false,
    particle: 'electron',
    K: 1000,
    pd: 1e-6,
    pL: 1.0,
    rate: 700,
    auto: false
  };

  const rt = {
    buildup: { acc: null, sampler: null, half: 0, geom: null, pending: 0 },
    particle: { acc: null, sampler: null, half: 0, geom: null, pending: 0, lam: 0 },
    wave: { job: null, off: null, octx: null, prof: null, rect: null, yHalf: 2e-3, zMax: 0.2, zMin: 8e-4 },
    which: { off: null, data: null }
  };

  let viewW = 1, viewH = 1, dpr = 1;
  let lastChartAt = 0, lastHudAt = 0, lastStatsAt = 0;
  let hover = null;
  let draggingScreen = false;

  const base = $('#base-canvas');
  const fx = $('#fx-canvas');
  const wrap = $('#canvas-wrap');
  const bctx = base.getContext('2d');
  const fctx = fx.getContext('2d');

  /* --------------------------------------------------------- yardımcılar */

  function logMap(t, lo, hi) { return Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * t); }
  function logInv(v, lo, hi) { return (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)); }

  function part() { return P.PARTICLES[state.particle]; }

  function beamRgb() { return P.wavelengthRgb(state.lambda * 1e9); }
  function beamCss(a) { return P.rgbCss(beamRgb(), a); }

  function paramsFor(mode) {
    if (mode === 'particle') {
      const db = P.deBroglie(state.particle, state.K);
      rt.particle.lam = db.lambda;
      return { lambda: db.lambda, d: state.pd, a: state.pd / 4, L: state.pL, N: 2, V: 1 };
    }
    if (mode === 'which') {
      const th = state.theta * Math.PI / 180;
      const V = Math.abs(Math.cos(2 * th));
      return { lambda: state.lambda, d: state.d, a: state.a, L: state.L, N: 2,
               V: state.analyzer ? 1 : V };
    }
    if (mode === 'wave') {
      return { lambda: state.lambda, d: state.d, a: state.a, L: 1.2, N: state.N, V: 1 };
    }
    return { lambda: state.lambda, d: state.d, a: state.a, L: state.L, N: state.N, V: state.V };
  }

  function whichValues() {
    const th = state.theta * Math.PI / 180;
    const V = Math.abs(Math.cos(2 * th));
    const D = Math.abs(Math.sin(2 * th));
    const pass = state.analyzer ? Math.cos(th) * Math.cos(th) : 1;
    return { V, D, pass, Veff: state.analyzer ? 1 : V };
  }

  /* ------------------------------------------------------------ yerleşim */

  function screenLayout() {
    const mx = Math.min(viewW * 0.075, 64);
    const top = Math.max(78, viewH * 0.19);
    const bottom = Math.max(50, viewH * 0.1);
    return { x0: mx, x1: viewW - mx, y0: top, y1: viewH - bottom };
  }

  function waveLayout() {
    return {
      x0: Math.min(66, viewW * 0.12),
      x1: viewW - Math.min(92, viewW * 0.14),
      y0: Math.max(72, viewH * 0.10),
      y1: viewH - Math.max(58, viewH * 0.09)
    };
  }

  function waveGeom() {
    const zMax = 0.2;
    const yHalf = Math.max(1.2 * state.d, 4 * state.lambda * zMax / state.d);
    return { zMin: 8e-4, zMax, yHalf };
  }

  /* ------------------------------------------------------- birikim nesnesi */

  function createAccumulator() {
    const cnv = document.createElement('canvas');
    const acc = {
      canvas: cnv, ctx: cnv.getContext('2d'),
      count: 0, half: 1, layout: { x0: 0, x1: 1, y0: 0, y1: 1 },
      nBins: 240, hist: null, histMax: 0, dot: 1, alpha: 0.5,
      color: 'rgba(125,240,192,0.5)'
    };
    acc.hist = new Float64Array(acc.nBins);

    acc.resize = function (w, h) {
      const old = document.createElement('canvas');
      old.width = cnv.width; old.height = cnv.height;
      if (cnv.width > 0 && cnv.height > 0) old.getContext('2d').drawImage(cnv, 0, 0);
      cnv.width = Math.max(1, w); cnv.height = Math.max(1, h);
      const c = cnv.getContext('2d');
      c.clearRect(0, 0, cnv.width, cnv.height);
      if (old.width > 0) {
        c.globalCompositeOperation = 'lighter';
        c.drawImage(old, 0, 0, old.width, old.height, 0, 0, cnv.width, cnv.height);
      }
      acc.ctx = c;
      acc._op = 'source-over';
      acc._color = null;
    };

    acc.reset = function () {
      acc.ctx.setTransform(1, 0, 0, 1, 0, 0);
      acc.ctx.globalCompositeOperation = 'source-over';
      acc.ctx.clearRect(0, 0, cnv.width, cnv.height);
      acc.count = 0;
      acc.histMax = 0;
      acc.hist.fill(0);
      acc._op = 'source-over';
      acc._color = null;
    };

    acc.add = function (y) {
      const t = (y + acc.half) / (2 * acc.half);
      if (t < 0 || t > 1) return;
      const l = acc.layout;
      const px = l.x0 + t * (l.x1 - l.x0);
      const py = l.y0 + Math.random() * (l.y1 - l.y0);
      const s = acc.dot;
      const ctx = acc.ctx;
      if (acc._op !== 'lighter') { ctx.globalCompositeOperation = 'lighter'; acc._op = 'lighter'; }
      if (acc._color !== acc.color) { ctx.fillStyle = acc.color; acc._color = acc.color; }
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
      acc.count++;
      const b = Math.min(acc.nBins - 1, Math.floor(t * acc.nBins));
      acc.hist[b]++;
      if (acc.hist[b] > acc.histMax) acc.histMax = acc.hist[b];
    };

    return acc;
  }

  /* ------------------------------------------------------ tuval boyutlama */

  function resizeCanvases() {
    const rect = wrap.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (base.width === w && base.height === h) return false;
    base.width = w; base.height = h;
    fx.width = w; fx.height = h;
    viewW = rect.width; viewH = rect.height;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function applyAccLayout(acc) {
    const L = screenLayout();
    acc.layout = { x0: L.x0 * dpr, x1: L.x1 * dpr, y0: L.y0 * dpr, y1: L.y1 * dpr };
    acc.dot = Math.max(1, Math.round(dpr * 1.02));
    acc.alpha = 0.5;
  }

  /* -------------------------------------------------------- mod kurulumu */

  function rebuildScreen(mode) {
    resizeCanvases();
    const r = rt[mode];
    const p = paramsFor(mode);
    const geom = P.geometry(p);
    r.geom = geom;
    r.half = geom.halfWidth;
    r.sampler = P.makeSampler(p, geom.halfWidth, 2048);
    if (!r.acc) r.acc = createAccumulator();
    r.acc.resize(base.width, base.height);
    r.acc.half = geom.halfWidth;

    if (mode === 'buildup') {
      r.acc.color = beamCss(0.5);
    } else {
      r.acc.color = P.rgbCss(hexToRgb(part().color), 0.5);
    }
    applyAccLayout(r.acc);
    r.acc.reset();
    renderBase();
    updateStats();
    drawMini();
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }

  /* -------------------------------------------------------------- ateşleme */

  function fire(mode, n) {
    const r = rt[mode];
    if (!r.sampler) return;
    const flash = n <= 24;
    for (let i = 0; i < n; i++) {
      const y = P.sampleSampler(r.sampler);
      const before = r.acc.count;
      r.acc.add(y);
      if (flash && r.acc.count > before) {
        const t = (y + r.half) / (2 * r.half);
        const L = screenLayout();
        flashes.push({
          x: L.x0 + t * (L.x1 - L.x0),
          y: L.y0 + Math.random() * (L.y1 - L.y0),
          t0: performance.now(),
          color: mode === 'buildup' ? beamCss(1) : part().color
        });
      }
    }
    renderBase();
    if (performance.now() - lastChartAt > 160) { drawMini(); lastChartAt = performance.now(); }
    if (performance.now() - lastStatsAt > 120) { updateStats(); lastStatsAt = performance.now(); }
  }

  const flashes = [];

  /* ------------------------------------------------------------- çizimler */

  function clearBase() {
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, viewW, viewH);
  }

  function drawScreenSurface(colorRgb) {
    const g = bctx.createRadialGradient(viewW * 0.5, viewH * 0.5, 20, viewW * 0.5, viewH * 0.5, Math.max(viewW, viewH) * 0.75);
    g.addColorStop(0, 'rgba(13,20,22,1)');
    g.addColorStop(1, 'rgba(5,8,10,1)');
    bctx.fillStyle = g;
    bctx.fillRect(0, 0, viewW, viewH);

    const L = screenLayout();
    bctx.strokeStyle = 'rgba(233,239,236,.07)';
    bctx.lineWidth = 1;
    roundRect(bctx, L.x0 - 0.5, L.y0 - 0.5, L.x1 - L.x0 + 1, L.y1 - L.y0 + 1, 10);
    bctx.stroke();

    // hafif dedektör dokusu
    bctx.fillStyle = P.rgbCss(colorRgb, 0.018);
    for (let i = 0; i < 3; i++) {
      bctx.fillRect(L.x0 + 2, L.y0 + 2 + i * 3, L.x1 - L.x0 - 4, 1);
    }
  }

  function renderBase() {
    const mode = state.mode;
    if (mode === 'buildup' || mode === 'particle') {
      const r = rt[mode];
      if (!r.acc) return;
      clearBase();
      const c = mode === 'buildup' ? beamRgb() : hexToRgb(part().color);
      drawScreenSurface(c);
      bctx.globalCompositeOperation = 'lighter';
      bctx.drawImage(r.acc.canvas, 0, 0, viewW, viewH);
      bctx.globalCompositeOperation = 'source-over';
    } else if (mode === 'wave') {
      drawWaveBase();
    } else if (mode === 'which') {
      drawWhichBase();
    }
  }

  function renderFX(now) {
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.clearRect(0, 0, viewW, viewH);
    const mode = state.mode;

    if (mode === 'buildup' || mode === 'particle') {
      const r = rt[mode];
      const L = screenLayout();
      const color = mode === 'buildup' ? beamRgb() : hexToRgb(part().color);

      // merkez çizgisi
      fctx.strokeStyle = 'rgba(233,239,236,.10)';
      fctx.setLineDash([3, 7]);
      fctx.beginPath();
      fctx.moveTo((L.x0 + L.x1) / 2, L.y0);
      fctx.lineTo((L.x0 + L.x1) / 2, L.y1);
      fctx.stroke();
      fctx.setLineDash([]);

      drawRuler(color);

      // flaşlar
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        const age = (now - f.t0) / 1000;
        if (age > 0.55) { flashes.splice(i, 1); continue; }
        const rad = 2 + age * 46;
        fctx.strokeStyle = f.color;
        fctx.globalAlpha = (1 - age / 0.55) * 0.55;
        fctx.lineWidth = 1.2;
        fctx.beginPath();
        fctx.arc(f.x, f.y, rad, 0, Math.PI * 2);
        fctx.stroke();
        fctx.globalAlpha = 1;
      }

      // boş ekran ipucu
      if (r.acc && r.acc.count === 0) {
        const L2 = screenLayout();
        fctx.textAlign = 'center';
        fctx.textBaseline = 'middle';
        fctx.fillStyle = 'rgba(233,239,236,.30)';
        fctx.font = '13px -apple-system, "SF Pro Text", system-ui, sans-serif';
        fctx.fillText(state.mode === 'particle' ? 'Tek parçacıklar gelmeye başlasın' : 'Tek fotonlar gelmeye başlasın', (L2.x0 + L2.x1) / 2, (L2.y0 + L2.y1) / 2 - 12);
        fctx.fillStyle = 'rgba(233,239,236,.18)';
        fctx.font = '11px "SF Mono", ui-monospace, monospace';
        fctx.fillText('alttaki düğmeler · boşluk tuşu · ekrana tıkla', (L2.x0 + L2.x1) / 2, (L2.y0 + L2.y1) / 2 + 12);
      }

      // imleç
      if (hover && hover.x > L.x0 && hover.x < L.x1 && hover.y > L.y0 && hover.y < L.y1) {
        const t = (hover.x - L.x0) / (L.x1 - L.x0);
        const y = (t * 2 - 1) * r.half;
        const I = P.intensity(y, paramsFor(mode));
        fctx.strokeStyle = 'rgba(233,239,236,.25)';
        fctx.lineWidth = 1;
        fctx.beginPath();
        fctx.moveTo(hover.x, L.y0);
        fctx.lineTo(hover.x, L.y1);
        fctx.stroke();
        const label = `y = ${P.fmtLength(Math.abs(y))}${y < 0 ? ' (−)' : ''}  ·  I = ${P.fmt(I, 3)}`;
        drawTooltip(hover.x + 12, Math.min(hover.y, viewH - 60), label);
      }
    } else if (mode === 'wave') {
      drawWaveFX();
    } else if (mode === 'which') {
      drawWhichFX();
    }
  }

  function drawTooltip(x, y, text) {
    fctx.font = '11px "SF Mono", ui-monospace, monospace';
    const w = fctx.measureText(text).width + 18;
    const h = 26;
    const xx = Math.min(x, viewW - w - 10);
    fctx.fillStyle = 'rgba(6,10,12,.92)';
    roundRect(fctx, xx, y - h / 2, w, h, 7);
    fctx.fill();
    fctx.strokeStyle = 'rgba(233,239,236,.16)';
    fctx.lineWidth = 1;
    fctx.stroke();
    fctx.fillStyle = '#d7e2df';
    fctx.textBaseline = 'middle';
    fctx.fillText(text, xx + 9, y + 0.5);
  }

  function drawRuler(color) {
    const L = screenLayout();
    const half = (state.mode === 'particle' ? rt.particle.half : rt.buildup.half) || 1;
    const nice = niceLength(2 * half / 8);
    const pxPerMeter = (L.x1 - L.x0) / (2 * half);
    const barPx = nice * pxPerMeter;
    const x = L.x0 + 6;
    const y = viewH - 22;
    fctx.strokeStyle = P.rgbCss(color, 0.75);
    fctx.lineWidth = 1.4;
    fctx.beginPath();
    fctx.moveTo(x, y); fctx.lineTo(x + barPx, y);
    fctx.moveTo(x, y - 4); fctx.lineTo(x, y + 4);
    fctx.moveTo(x + barPx, y - 4); fctx.lineTo(x + barPx, y + 4);
    fctx.stroke();
    fctx.fillStyle = 'rgba(233,239,236,.6)';
    fctx.font = '10px "SF Mono", ui-monospace, monospace';
    fctx.textAlign = 'left';
    fctx.textBaseline = 'alphabetic';
    fctx.fillText(P.fmtLength(nice), x, y - 9);
    fctx.fillText('0', (L.x0 + L.x1) / 2 - 3, y - 9);
  }

  function niceLength(x) {
    const e = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / e;
    const n = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
    return n * e;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------------------------------------------- dalga alanı modu */

  const HEAT_STOPS = [0, 0.18, 0.42, 0.68, 0.86, 1];
  function makeHeatLut(beam01) {
    const beam = beam01.map(v => v * 255);
    const bg = [5, 9, 12];
    const stops = [
      bg,
      mix(bg, beam, 0.30),
      mix(bg, beam, 0.72),
      mix(beam, [220, 255, 244], 0.22),
      mix(beam, [240, 255, 250], 0.62),
      [238, 255, 250]
    ];
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < HEAT_STOPS.length - 2 && t > HEAT_STOPS[k + 1]) k++;
      const t0 = HEAT_STOPS[k], t1 = HEAT_STOPS[k + 1];
      const f = (t - t0) / (t1 - t0);
      const a = stops[k], b = stops[k + 1];
      lut[i * 3] = Math.round(a[0] + (b[0] - a[0]) * f);
      lut[i * 3 + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
      lut[i * 3 + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
    }
    return lut;
  }
  function mix(a, b, f) {
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function scheduleWaveJob() {
    const g = waveGeom();
    const W = 620;
    const H = 360;
    const data = new Float32Array(W * H);
    const colMax = new Float32Array(W);
    const blur = new Uint8Array(W);
    const img = new ImageData(W, H);
    for (let i = 0; i < W * H; i++) img.data[i * 4 + 3] = 255;
    let off = rt.wave.off;
    if (!off) { off = document.createElement('canvas'); rt.wave.off = off; }
    off.width = W; off.height = H;
    const octx = off.getContext('2d');
    rt.wave.job = {
      W, H, data, colMax, blur, img, off, octx, i: 0,
      zMin: g.zMin, zMax: g.zMax, yHalf: g.yHalf,
      p: paramsFor('wave'),
      lut: makeHeatLut(beamRgb())
    };
    rt.wave.yHalf = g.yHalf; rt.wave.zMax = g.zMax; rt.wave.zMin = g.zMin;
    computeWaveProfile();
  }

  function stepWaveJob(budgetMs) {
    const job = rt.wave.job;
    if (!job) return false;
    const t0 = performance.now();
    while (job.i < job.W) {
      const xi = job.i;
      const z = job.zMin + (job.zMax - job.zMin) * (xi + 0.5) / job.W;
      let cm = 0;
      for (let yi = 0; yi < job.H; yi++) {
        const y = job.yHalf - 2 * job.yHalf * (yi + 0.5) / job.H;
        const I = P.fresnelIntensity(y, z, job.p);
        job.data[yi * job.W + xi] = I;
        if (I > cm) cm = I;
      }
      const dyPix = 2 * job.yHalf / job.H;
      const fringe = state.lambda * z / state.d;
      job.blur[xi] = Math.max(0, Math.min(12, Math.round(dyPix / fringe)));
      job.colMax[xi] = cm > 0 ? cm : 1e-30;
      colorizeColumn(job, xi);
      job.i++;
      if (performance.now() - t0 > budgetMs) break;
    }
    job.octx.putImageData(job.img, 0, 0);
    renderBase();
    if (job.i >= job.W) {
      rt.wave.job = null;
      return false;
    }
    return true;
  }

  function colorizeColumn(job, xi) {
    const { data, colMax, img, H, W, lut, blur } = job;
    const cm = colMax[xi];
    const r = blur[xi] | 0;
    if (r > 0) {
      if (!job.prefix || job.prefix.length !== H + 1) job.prefix = new Float64Array(H + 1);
      const pre = job.prefix;
      pre[0] = 0;
      for (let yi = 0; yi < H; yi++) pre[yi + 1] = pre[yi] + data[yi * W + xi];
      for (let yi = 0; yi < H; yi++) {
        const a = Math.max(0, yi - r), b = Math.min(H - 1, yi + r);
        putHeat(img, lut, W, xi, yi, (pre[b + 1] - pre[a]) / (b - a + 1), cm);
      }
    } else {
      for (let yi = 0; yi < H; yi++) putHeat(img, lut, W, xi, yi, data[yi * W + xi], cm);
    }
  }

  function putHeat(img, lut, W, xi, yi, I, cm) {
    let t = I / cm;
    t = t > 1 ? 1 : t;
    t = Math.pow(t, 0.48);
    const idx = (t * 255) | 0;
    const o = (yi * W + xi) * 4;
    img.data[o] = lut[idx * 3];
    img.data[o + 1] = lut[idx * 3 + 1];
    img.data[o + 2] = lut[idx * 3 + 2];
  }

  function computeWaveProfile() {
    const g = waveGeom();
    const p = paramsFor('wave');
    rt.wave.prof = P.screenProfile(state.zScreen, p, g.yHalf, 900);
  }

  function drawWaveBase() {
    clearBase();
    const R = waveLayout();
    rt.wave.rect = R;
    const g = rt.wave;

    bctx.fillStyle = '#04070a';
    bctx.fillRect(0, 0, viewW, viewH);
    bctx.fillStyle = 'rgba(233,239,236,.02)';
    bctx.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);

    if (rt.wave.off) {
      bctx.imageSmoothingEnabled = true;
      bctx.drawImage(rt.wave.off, 0, 0, rt.wave.off.width, rt.wave.off.height,
        R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
    }

    bctx.strokeStyle = 'rgba(233,239,236,.12)';
    bctx.lineWidth = 1;
    bctx.strokeRect(R.x0 + 0.5, R.y0 + 0.5, R.x1 - R.x0 - 1, R.y1 - R.y0 - 1);

    // bariyer
    const { zMin, zMax, yHalf } = rt.wave;
    const yToPx = y => R.y0 + (yHalf - y) / (2 * yHalf) * (R.y1 - R.y0);
    const bx = R.x0 - 9;
    const gaps = slitRanges(yHalf);
    bctx.fillStyle = 'rgba(190,205,200,.85)';
    let cursor = yToPx(yHalf);
    for (const g2 of gaps) {
      const top = yToPx(g2[1]);
      const bot = yToPx(g2[0]);
      bctx.fillRect(bx, cursor, 13, Math.max(0, top - cursor));
      cursor = bot;
    }
    bctx.fillRect(bx, cursor, 13, Math.max(0, yToPx(-yHalf) - cursor));
    bctx.fillStyle = 'rgba(103,232,185,.55)';
    for (const g2 of gaps) {
      bctx.fillRect(bx, yToPx(g2[1]), 13, Math.max(1, yToPx(g2[0]) - yToPx(g2[1])));
    }
  }

  function slitRanges(yHalf) {
    const N = state.N;
    const out = [];
    for (let i = 0; i < N; i++) {
      const c = (i - (N - 1) / 2) * state.d;
      out.push([c - state.a / 2, c + state.a / 2]);
    }
    return out;
  }

  function drawWaveFX() {
    const R = rt.wave.rect || waveLayout();
    const { zMin, zMax, yHalf } = rt.wave;
    const zToX = z => R.x0 + (z - zMin) / (zMax - zMin) * (R.x1 - R.x0);
    const yToPx = y => R.y0 + (yHalf - y) / (2 * yHalf) * (R.y1 - R.y0);

    fctx.font = '10px "SF Mono", ui-monospace, monospace';
    fctx.fillStyle = 'rgba(233,239,236,.42)';
    fctx.strokeStyle = 'rgba(233,239,236,.10)';
    fctx.lineWidth = 1;

    // y ekseni
    const yTicks = [-yHalf, -yHalf / 2, 0, yHalf / 2, yHalf];
    fctx.textAlign = 'right'; fctx.textBaseline = 'middle';
    for (const y of yTicks) {
      const py = Math.max(R.y0 + 8, Math.min(R.y1 - 8, yToPx(y)));
      fctx.beginPath(); fctx.moveTo(R.x0 - 4, py); fctx.lineTo(R.x0, py); fctx.stroke();
      fctx.fillText((y === 0 ? '0' : P.fmtLength(Math.abs(y))), R.x0 - 8, py);
    }

    // z ekseni
    fctx.textAlign = 'center'; fctx.textBaseline = 'top';
    const zTicks = [0, 0.05, 0.1, 0.15, 0.2];
    for (const z of zTicks) {
      if (z < zMin) continue;
      const px = zToX(z);
      fctx.beginPath(); fctx.moveTo(px, R.y1); fctx.lineTo(px, R.y1 + 4); fctx.stroke();
      fctx.fillText(z === 0 ? '0' : Math.round(z * 1000) + '', px, R.y1 + 7);
    }
    fctx.fillText('z (mm)', (R.x0 + R.x1) / 2, R.y1 + 22);

    // Fresnel sınırları
    const fz1 = state.a * state.a / state.lambda;
    const fz01 = 10 * fz1;
    fctx.textAlign = 'left'; fctx.textBaseline = 'bottom';
    for (const [z, label] of [[fz1, 'F = 1'], [fz01, 'F = 0,1']]) {
      if (z > zMin && z < zMax) {
        const px = zToX(z);
        fctx.setLineDash([2, 6]);
        fctx.strokeStyle = 'rgba(255,212,121,.35)';
        fctx.beginPath(); fctx.moveTo(px, R.y0); fctx.lineTo(px, R.y1); fctx.stroke();
        fctx.setLineDash([]);
        fctx.fillStyle = 'rgba(255,212,121,.6)';
        fctx.fillText(label, px + 5, R.y0 + 14);
      }
    }

    // ekran çizgisi
    const sx = zToX(state.zScreen);
    fctx.strokeStyle = 'rgba(255,212,121,.9)';
    fctx.lineWidth = 1.4;
    fctx.setLineDash([5, 4]);
    fctx.beginPath(); fctx.moveTo(sx, R.y0); fctx.lineTo(sx, R.y1); fctx.stroke();
    fctx.setLineDash([]);
    fctx.fillStyle = 'rgba(255,212,121,.95)';
    roundRect(fctx, sx - 26, R.y0 - 24, 52, 18, 6);
    fctx.fill();
    fctx.fillStyle = '#0a0d0f';
    fctx.textAlign = 'center'; fctx.textBaseline = 'middle';
    fctx.font = '10px "SF Mono", ui-monospace, monospace';
    fctx.fillText('EKRAN', sx, R.y0 - 15);

    // imleç
    if (hover && hover.x > R.x0 && hover.x < R.x1 && hover.y > R.y0 && hover.y < R.y1) {
      const z = zMin + (hover.x - R.x0) / (R.x1 - R.x0) * (zMax - zMin);
      const y = yHalf - (hover.y - R.y0) / (R.y1 - R.y0) * 2 * yHalf;
      const I = P.fresnelIntensity(y, z, paramsFor('wave'));
      fctx.strokeStyle = 'rgba(233,239,236,.2)';
      fctx.lineWidth = 1;
      fctx.beginPath(); fctx.moveTo(hover.x, R.y0); fctx.lineTo(hover.x, R.y1); fctx.stroke();
      drawTooltip(hover.x + 12, Math.min(hover.y, viewH - 60),
        `z = ${P.fmtLength(z)}  ·  y = ${P.fmtLength(Math.abs(y))}  ·  I = ${P.fmt(I, 3)}`);
    }
  }

  /* ------------------------------------------------------- hangi yol modu */

  function drawWhichBase() {
    clearBase();
    const W = viewW, H = viewH;
    const g = bctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(9,14,16,1)');
    g.addColorStop(1, 'rgba(4,7,9,1)');
    bctx.fillStyle = g;
    bctx.fillRect(0, 0, W, H);

    const diagH = H * 0.46;
    const midY = diagH * 0.56;
    const x0 = 34, x1 = W - 34;
    const srcX = x0 + 42;
    const barX = x0 + (x1 - x0) * 0.33;
    const scrX = x1 - 26;
    const sep = Math.max(30, Math.min(78, diagH * 0.34));
    const gap = 6;
    const colA = [110, 231, 255];
    const colB = [255, 212, 121];

    // kaynak
    bctx.strokeStyle = 'rgba(233,239,236,.5)';
    bctx.lineWidth = 1;
    roundRect(bctx, srcX - 26, midY - 13, 52, 26, 8);
    bctx.stroke();
    bctx.fillStyle = 'rgba(233,239,236,.55)';
    bctx.font = '9px "SF Mono", ui-monospace, monospace';
    bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
    bctx.fillText('KAYNAK', srcX, midY);

    // ışın
    const bg = bctx.createLinearGradient(srcX, 0, barX, 0);
    bg.addColorStop(0, 'rgba(103,232,185,0)');
    bg.addColorStop(1, 'rgba(103,232,185,.5)');
    bctx.strokeStyle = bg;
    bctx.lineWidth = 1.6;
    bctx.beginPath(); bctx.moveTo(srcX + 27, midY); bctx.lineTo(barX, midY); bctx.stroke();

    // bariyer
    const yTop = midY - diagH * 0.62;
    const yBot = midY + diagH * 0.62;
    const s1 = midY + sep / 2;
    const s2 = midY - sep / 2;
    bctx.fillStyle = 'rgba(200,214,210,.82)';
    roundRect(bctx, barX - 6, yTop, 12, (s2 - gap / 2) - yTop, 4); bctx.fill();
    roundRect(bctx, barX - 6, s2 + gap / 2, 12, (s1 - gap / 2) - (s2 + gap / 2), 4); bctx.fill();
    roundRect(bctx, barX - 6, s1 + gap / 2, 12, yBot - (s1 + gap / 2), 4); bctx.fill();

    // yollar
    const pathA = { x: barX, y: s1 };
    const pathB = { x: barX, y: s2 };
    const target = { x: scrX, y: midY };

    bctx.lineWidth = 1.3;
    bctx.strokeStyle = 'rgba(110,231,255,.55)';
    bctx.beginPath(); bctx.moveTo(pathA.x, pathA.y); bctx.lineTo(target.x, target.y); bctx.stroke();
    bctx.strokeStyle = 'rgba(255,212,121,.55)';
    bctx.beginPath(); bctx.moveTo(pathB.x, pathB.y); bctx.lineTo(target.x, target.y); bctx.stroke();

    // işaretçiler
    const th = state.theta * Math.PI / 180;
    drawMarker(pathA, target, +th, colA, 'A');
    drawMarker(pathB, target, -th, colB, 'B');

    // ekran
    bctx.strokeStyle = 'rgba(233,239,236,.75)';
    bctx.lineWidth = 3;
    bctx.beginPath(); bctx.moveTo(scrX, midY - diagH * 0.52); bctx.lineTo(scrX, midY + diagH * 0.52); bctx.stroke();

    if (state.analyzer) {
      bctx.strokeStyle = 'rgba(103,232,185,.9)';
      bctx.lineWidth = 4;
      bctx.beginPath(); bctx.moveTo(scrX, midY - diagH * 0.42); bctx.lineTo(scrX, midY + diagH * 0.42); bctx.stroke();
      bctx.fillStyle = 'rgba(103,232,185,.85)';
      bctx.font = '9.5px "SF Mono", ui-monospace, monospace';
      bctx.textAlign = 'left';
      bctx.fillText('analizör', scrX + 8, midY + diagH * 0.52);
    }

    // d etiketi
    bctx.fillStyle = 'rgba(233,239,236,.45)';
    bctx.font = '10px "SF Mono", ui-monospace, monospace';
    bctx.textAlign = 'left'; bctx.textBaseline = 'middle';
    bctx.fillText('d', barX + 16, midY);

    // ekran deseni
    const rect = { x0: 34, x1: W - 34, y0: diagH + 44, y1: H - 30 };
    const vals = whichValues();
    const half = P.screenHalfWidth(paramsFor('which'));
    const Wp = Math.max(240, Math.min(1024, Math.round(rect.x1 - rect.x0)));
    if (!rt.which.off || rt.which.off.width !== Wp) {
      rt.which.off = document.createElement('canvas');
      rt.which.off.width = Wp; rt.which.off.height = 1;
    }
    const off = rt.which.off;
    const octx = off.getContext('2d');
    const id = octx.createImageData(Wp, 1);
    const color = beamRgb().map(v => v * 255);
    let cmax = 0;
    const Is = new Float32Array(Wp);
    for (let i = 0; i < Wp; i++) {
      const y = -half + 2 * half * (i + 0.5) / Wp;
      const I = P.intensity(y, { lambda: state.lambda, d: state.d, a: state.a, L: state.L, N: 2, V: vals.Veff });
      Is[i] = I; if (I > cmax) cmax = I;
    }
    cmax = cmax || 1;
    for (let i = 0; i < Wp; i++) {
      const t = Math.pow(Is[i] / cmax, 0.62) * vals.pass;
      const c = mix([6, 10, 12], color, Math.min(1, t));
      id.data[i * 4] = c[0];
      id.data[i * 4 + 1] = c[1];
      id.data[i * 4 + 2] = c[2];
      id.data[i * 4 + 3] = 255;
    }
    octx.putImageData(id, 0, 0);
    bctx.imageSmoothingEnabled = true;
    bctx.drawImage(off, 0, 0, Wp, 1, rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);

    // tarama dokusu
    bctx.fillStyle = 'rgba(255,255,255,.02)';
    for (let y = rect.y0; y < rect.y1; y += 3) bctx.fillRect(rect.x0, y, rect.x1 - rect.x0, 1);

    bctx.strokeStyle = 'rgba(233,239,236,.12)';
    bctx.lineWidth = 1;
    bctx.strokeRect(rect.x0 + 0.5, rect.y0 + 0.5, rect.x1 - rect.x0 - 1, rect.y1 - rect.y0 - 1);
    rt.which.half = half;
  }

  function drawMarker(from, to, angle, color, label) {
    const t = 0.58;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const ang = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2 + angle;
    const len = 24;
    bctx.save();
    bctx.translate(x, y);
    bctx.rotate(ang);
    bctx.fillStyle = P.rgbCss(color, 0.16);
    bctx.strokeStyle = P.rgbCss(color, 0.85);
    bctx.lineWidth = 1.2;
    roundRect(bctx, -len / 2, -5, len, 10, 4);
    bctx.fill(); bctx.stroke();
    bctx.beginPath();
    bctx.moveTo(0, -5); bctx.lineTo(0, 5);
    bctx.strokeStyle = P.rgbCss(color, 0.55);
    bctx.stroke();
    bctx.restore();
    bctx.fillStyle = P.rgbCss(color, 0.95);
    bctx.font = '10px "SF Mono", ui-monospace, monospace';
    bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
    bctx.fillText(label, x + 18 * Math.cos(ang), y + 18 * Math.sin(ang));
  }

  function drawWhichFX() {
    const vals = whichValues();
    fctx.font = '10px "SF Mono", ui-monospace, monospace';
    fctx.textAlign = 'left'; fctx.textBaseline = 'middle';
    fctx.fillStyle = 'rgba(233,239,236,.5)';
    const rect = { x0: 34, x1: viewW - 34, y0: viewH * 0.46 + 44, y1: viewH - 30 };
    fctx.fillText('EKRAN DESENİ', rect.x0, rect.y0 - 16);
    fctx.textAlign = 'right';
    fctx.fillStyle = 'rgba(255,212,121,.8)';
    fctx.fillText(`V = ${vals.Veff.toFixed(3)}`, rect.x1, rect.y0 - 16);
  }

  /* ------------------------------------------------------------- istatistik */

  function statRow(label, value, cls) {
    return `<div class="stat-row"><span>${label}</span><b class="${cls || ''}">${value}</b></div>`;
  }

  function updateStats() {
    const mode = state.mode;
    const heroKey = $('#hero-key'), heroVal = $('#hero-value'), heroSub = $('#hero-sub');
    const list = $('#stat-list');
    const note = $('#note');
    const formula = $('#formula');
    const legend = $('#chart-legend');
    const title = $('#chart-title');

    if (mode === 'buildup') {
      const p = paramsFor('buildup');
      const g = P.geometry(p);
      const count = rt.buildup.acc ? rt.buildup.acc.count : 0;
      heroKey.textContent = 'Algılanan foton';
      heroVal.textContent = P.fmtInt(count);
      heroSub.textContent = count === 0 ? 'henüz foton yok' : `${P.fmtInt(count)} olay birikti`;
      list.innerHTML =
        (state.N === 1
          ? statRow('Yarık genişliği a', P.fmtLength(state.a), 'is-mint') +
            statRow('Zarfın ilk sıfırı', '±' + P.fmtLength(g.env)) +
            statRow('Görüş alanı', '±' + P.fmtLength(g.halfWidth)) +
            statRow('Yarık sayısı', 1)
          : statRow('Saçak aralığı Δy', P.fmtLength(g.dy), 'is-mint') +
            statRow('Zarfın ilk sıfırı', '±' + P.fmtLength(g.env)) +
            statRow('Görüş alanı', '±' + P.fmtLength(g.halfWidth)) +
            statRow('Merkezi zarf içi saçak', '≈ ' + P.fmt(2 * g.env / g.dy, 1)) +
            statRow('Görünürlük V', P.fmt(state.V, 2), state.V > 0.7 ? 'is-mint' : 'is-amber') +
            statRow('Yarık sayısı', state.N)) +
        statRow('Fresnel sayısı F', P.fmt(g.fresnelNumber, 4));
      formula.innerHTML = state.N === 1
        ? `I(y) ∝ <span class="hl">sinc²(β)</span>
           <div class="muted" style="font-size:12px;margin-top:6px">β = πa sin θ/λ · tek yarık kırınımı</div>`
        : `I(y) ∝ sinc²(β) · <span class="hl">[ (1−V)/N + V · ( sin Nα / N sin α )² ]</span>
           <div class="muted" style="font-size:12px;margin-top:6px">β = πa sin θ/λ, α = πd sin θ/λ</div>`;
      title.textContent = 'Foton dağılımı';
      legend.innerHTML = '<span style="color:#ffd479">▮ deney</span> &nbsp; <span style="color:#b5f5da">— kuram</span>';
      note.textContent = state.N === 1
        ? (count === 0
            ? 'Tek yarık modundasın: girişim saçakları yok, yalnızca kırınım zarfı var. Ateşleyerek dağılımı izle.'
            : 'Tek yarıkta desen sinc² zarfıdır. İkinci yarığı açtığında girişim saçakları belirir.')
        : count === 0
          ? 'Tek fotonlar tek tek gelir. Ateşle ve noktaların nereye düştüğünü izle; desen ancak binlerce olaydan sonra ortaya çıkar.'
          : count < 400
            ? 'Noktalar şimdilik rastgele görünüyor. Bu normal: Born kuralı ancak istatistik biriktikçe görünür olur.'
            : count < 20000
              ? 'Saçaklar belirmeye başladı. Dağılımın |ψ|²ye yakınsadığını görebilirsin.'
              : 'Dağılım artık kararlı: deney histogramı, kuramsal |ψ|² eğrisini izliyor.';
    } else if (mode === 'wave') {
      const p = paramsFor('wave');
      const z = state.zScreen;
      const dz = state.lambda * z / state.d;
      const F = state.a * state.a / (state.lambda * z);
      const zFF = state.d * state.d / state.lambda;
      const env = state.lambda * z / state.a;
      heroKey.textContent = 'Ekran konumu z';
      heroVal.textContent = P.fmt(z * 1e3, 1) + ' mm';
      heroSub.textContent = `Fresnel sayısı F = ${P.fmt(F, 4)}`;
      list.innerHTML =
        statRow('Saçak aralığı (bu z\'de)', P.fmtLength(dz), 'is-mint') +
        statRow('Zarf ilk sıfırı', '±' + P.fmtLength(env)) +
        statRow('Fraunhofer sınırı d²/λ', P.fmtLength(zFF)) +
        statRow('Görüş alanı', '±' + P.fmtLength(rt.wave.yHalf)) +
        statRow('Yarık sayısı', state.N) +
        statRow('Bölge', F > 1 ? 'yakın alan' : F > 0.1 ? 'geçiş' : 'Fraunhofer', F < 0.1 ? 'is-mint' : 'is-amber');
      title.textContent = 'Ekran profili I(y)';
      legend.innerHTML = '<span style="color:#b5f5da">— |U(x,z)|²</span>';
      formula.innerHTML = `U(x,z) = <span class="hl">e<sup>ikz</sup>/√(iλz)</span> ∫ U(x′,0) · e<sup>ik(x−x′)²/2z</sup> dx′
        <div class="muted" style="font-size:12px;margin-top:6px">C(v)+iS(v) = ∫₀ᵛ e<sup>iπt²/2</sup> dt</div>`;
      note.textContent = F > 1
        ? `z = ${P.fmt(z * 1e3, 1)} mm'de Fresnel sayısı 1'den büyük: yarıkların geometrik gölgesi ve kenar saçakları hâlâ belirgin.`
        : F > 0.1
          ? 'Geçiş bölgesindesin: desen olgunlaşıyor ama henüz kararlı girişim saçaklarına dönüşmedi.'
          : `Fraunhofer bölgesi: saçak aralığı λz/d = ${P.fmtLength(dz)} ile doğrusal büyüyor, desen kararlı.`;
    } else if (mode === 'which') {
      const vals = whichValues();
      const p = paramsFor('which');
      const g = P.geometry(p);
      heroKey.textContent = 'Girişim görünürlüğü V';
      heroVal.textContent = vals.Veff.toFixed(3);
      heroSub.textContent = `V² + D² = ${(vals.Veff * vals.Veff + vals.D * vals.D).toFixed(2)}`;
      list.innerHTML =
        statRow('İşaretçi açısı θ', state.theta + '°') +
        statRow('Görünürlük V', vals.Veff.toFixed(3), 'is-mint') +
        statRow('Yol bilgisi D', vals.D.toFixed(3), 'is-rose') +
        statRow('İşaretçisiz V', vals.V.toFixed(3)) +
        statRow('Analizör', state.analyzer ? 'açık' : 'kapalı', state.analyzer ? 'is-mint' : '') +
        statRow('Geçen foton oranı', state.analyzer ? ('%' + P.fmt(vals.pass * 100, 0)) : '%100') +
        statRow('Saçak aralığı', P.fmtLength(g.dy));
      title.textContent = 'Ekran deseni';
      legend.innerHTML = state.analyzer
        ? '<span style="color:#b5f5da">— analizörlü V=1</span>'
        : '<span style="color:#b5f5da">— işaretçili V=cos2θ</span>';
      formula.innerHTML = `<span class="hl">V = |⟨m<sub>B</sub>|m<sub>A</sub>⟩|</span> &nbsp;·&nbsp; V² + D² ≤ 1
        <div class="muted" style="font-size:12px;margin-top:6px">İşaretçiler ±θ: V = |cos 2θ|, D = |sin 2θ|</div>`;
      note.textContent = state.analyzer
        ? `Analizör, işaretçilerin ortak bileşenini seçiyor: girişim geri geldi (V = 1), ama fotonların yalnızca %${P.fmt(vals.pass * 100, 0)} kadarı geçiyor. Toplam desende girişim yok; silme yalnızca bu alt kümede.`
        : state.theta >= 44
          ? 'İşaretçiler dik: hangi yol tamamen biliniyor, girişim yok. Saçaklar yerine iki yumuşak tepe görünür.'
          : state.theta <= 1
            ? 'İşaretçiler özdeş: hiçbir yol bilgisi yok, tam girişim. Saçaklar en keskin halinde.'
            : 'İşaretçiler kısmen dik: yol bilgisi ile girişim arasında sürekli bir denge var. Tamamlayıcılık ilişkisi V² + D² = 1.';
    } else if (mode === 'particle') {
      const db = P.deBroglie(state.particle, state.K);
      const p = paramsFor('particle');
      const g = P.geometry(p);
      const prt = part();
      const count = rt.particle.acc ? rt.particle.acc.count : 0;
      heroKey.textContent = 'de Broglie dalga boyu';
      heroVal.textContent = P.fmtWavelength(db.lambda);
      heroSub.textContent = `${prt.name} · K = ${P.particleEnergyLabel(state.K)}`;
      list.innerHTML =
        statRow('Momentum p', P.fmtSci(db.pEV / 1e6, 3) + ' MeV/c') +
        statRow('Hız v/c', P.fmt(db.beta, 6)) +
        statRow('Lorentz faktörü γ', P.fmt(db.gamma, 4)) +
        statRow('Saçak aralığı Δy', P.fmtLength(g.dy), 'is-mint') +
        statRow('Yarık genişliği a', P.fmtLength(p.a)) +
        statRow('Görüş alanı', '±' + P.fmtLength(g.halfWidth)) +
        statRow('Relativistik düzeltme', db.relativistic ? 'gerekli' : 'ihmal edilebilir', db.relativistic ? 'is-amber' : '') +
        statRow('Algılanan parçacık', P.fmtInt(count));
      title.textContent = 'Parçacık dağılımı';
      legend.innerHTML = `<span style="color:${prt.color}">▮ deney</span> &nbsp; <span style="color:#b5f5da">— kuram</span>`;
      formula.innerHTML = `λ = h/p = <span class="hl">hc / √[K(K + 2mc²)]</span>
        <div class="muted" style="font-size:12px;margin-top:6px">Burada m, parçacığın durgun kütlesi.</div>`;
      note.textContent = `Ekran görünümü büyütülmüştür: gerçek saçak aralığı ${P.fmtLength(g.dy)}, yarık aralığı ${P.fmtLength(state.pd)}. Aynı girişim yasası, yalnızca dalga boyu h/p'den geliyor.`;
    }

    const half = (mode === 'buildup' || mode === 'particle')
      ? P.geometry(paramsFor(mode)).halfWidth
      : mode === 'wave'
        ? waveGeom().yHalf
        : P.screenHalfWidth(paramsFor('which'));
    const xmin = $('#chart-xmin'), xmax = $('#chart-xmax');
    if (xmin) xmin.textContent = '−' + P.fmtLength(half);
    if (xmax) xmax.textContent = '+' + P.fmtLength(half);
  }

  /* ------------------------------------------------------ bilgi grafiği */

  function prepMini() {
    const cv = $('#mini-canvas');
    const rect = cv.getBoundingClientRect();
    const d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * d));
    const h = Math.max(1, Math.round(rect.height * d));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }

  function drawMini() {
    const mode = state.mode;
    if (mode === 'theory') return;
    const { ctx, w, h } = prepMini();
    const x0 = 4, x1 = w - 4, y0 = 8, y1 = h - 20;
    const pw = x1 - x0, ph = y1 - y0;
    ctx.strokeStyle = 'rgba(233,239,236,.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();

    if (mode === 'buildup' || mode === 'particle') {
      const r = rt[mode];
      if (!r.acc || !r.sampler) return;
      const p = paramsFor(mode);
      const half = r.half;
      const color = mode === 'buildup' ? beamRgb() : hexToRgb(part().color);

      // kuram
      let tmax = 0;
      const N = 420;
      const ys = new Float32Array(N), Is = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const y = -half + 2 * half * (i + 0.5) / N;
        ys[i] = y; Is[i] = P.intensity(y, p);
        if (Is[i] > tmax) tmax = Is[i];
      }
      tmax = tmax || 1;
      ctx.strokeStyle = 'rgba(181,245,218,.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = x0 + (i / (N - 1)) * pw;
        const y = y1 - (Is[i] / tmax) * ph;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // deney histogramı
      const hist = r.acc.hist;
      const hmax = r.acc.histMax || 1;
      const bw = pw / hist.length;
      ctx.fillStyle = P.rgbCss(color, 0.62);
      for (let i = 0; i < hist.length; i++) {
        if (hist[i] <= 0) continue;
        const bh = (hist[i] / hmax) * ph * 0.86;
        ctx.fillRect(x0 + i * bw + 0.5, y1 - bh, Math.max(0.6, bw - 1), bh);
      }
    } else if (mode === 'wave') {
      if (!rt.wave.prof) computeWaveProfile();
      const prof = rt.wave.prof;
      let m = 0;
      for (let i = 0; i < prof.I.length; i++) if (prof.I[i] > m) m = prof.I[i];
      m = m || 1;
      const color = beamRgb();
      const grd = ctx.createLinearGradient(0, y0, 0, y1);
      grd.addColorStop(0, P.rgbCss(color, 0.32));
      grd.addColorStop(1, P.rgbCss(color, 0.02));
      ctx.beginPath();
      ctx.moveTo(x0, y1);
      for (let i = 0; i < prof.I.length; i++) {
        const x = x0 + (i / (prof.I.length - 1)) * pw;
        const y = y1 - (prof.I[i] / m) * ph;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(x1, y1);
      ctx.closePath();
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < prof.I.length; i++) {
        const x = x0 + (i / (prof.I.length - 1)) * pw;
        const y = y1 - (prof.I[i] / m) * ph;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = P.rgbCss(color, 0.95);
      ctx.lineWidth = 1.3;
      ctx.stroke();
    } else if (mode === 'which') {
      const vals = whichValues();
      const p = paramsFor('which');
      const half = P.screenHalfWidth(p);
      const N = 420;
      const drawCurve = (V, color, dash) => {
        let m = 0;
        const arr = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const y = -half + 2 * half * (i + 0.5) / N;
          arr[i] = P.intensity(y, { lambda: p.lambda, d: p.d, a: p.a, L: p.L, N: 2, V });
          if (arr[i] > m) m = arr[i];
        }
        m = m || 1;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const x = x0 + (i / (N - 1)) * pw;
          const y = y1 - (arr[i] / m) * ph * 0.92;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      };
      drawCurve(vals.V, 'rgba(255,143,163,.9)', [4, 3]);
      drawCurve(vals.Veff, 'rgba(181,245,218,.95)', []);
      drawCurve(1, 'rgba(110,231,255,.35)', [1, 3]);
    }
  }

  /* --------------------------------------------------------- mod geçişi */

  function setMode(mode) {
    state.mode = mode;
    state.auto = false;
    updateTopMeta();
    $$('.tab').forEach(t => {
      const on = t.dataset.mode === mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === mode));
    const theory = $('#theory');
    const workspace = $('#workspace');
    const isTheory = mode === 'theory';
    theory.hidden = !isTheory;
    workspace.style.display = isTheory ? 'none' : 'grid';

    if (isTheory) {
      drawTheoryPlots();
      return;
    }

    buildStageBar();
    if (mode === 'buildup') rebuildScreen('buildup');
    else if (mode === 'particle') rebuildScreen('particle');
    else if (mode === 'wave') { scheduleWaveJob(); renderBase(); updateStats(); drawMini(); }
    else if (mode === 'which') { renderBase(); updateStats(); drawMini(); }

    resizeCanvases();
    if (mode === 'buildup' || mode === 'particle') { applyAccLayout(rt[mode].acc); }
    renderBase();
    updateStats();
    drawMini();
    updateStageHead();
    updateHud();
  }

  function updateStageHead() {
    const map = {
      buildup: ['TEK FOTON BİRİKİMİ', 'Fotonlar', 'algılanan foton'],
      wave: ['YAKIN-ALAN DALGA HARİTASI', 'Dalga Alanı', 'ekran konumu'],
      which: ['TAMAMLAYICILIK', 'Hangi Yol?', 'görünürlük V'],
      particle: ['MADDE DALGALARI', 'Madde', 'de Broglie λ']
    };
    const m = map[state.mode];
    if (!m) return;
    $('#stage-kicker').textContent = m[0];
    $('#stage-title').textContent = m[1];
    $('#stage-stat-label').textContent = m[2];
  }

  function updateHud(now) {
    const t = now || performance.now();
    if (t - lastHudAt < 90) return;
    lastHudAt = t;
    const mode = state.mode;
    const el = $('#stage-stat-value');
    const live = $('#live-dot');
    if (mode === 'buildup' || mode === 'particle') {
      const r = rt[mode];
      const count = r.acc ? r.acc.count : 0;
      el.textContent = P.fmtInt(count);
      if (mode === 'buildup') {
        const hero = $('#hero-value');
        if (hero) hero.textContent = P.fmtInt(count);
      }
      live.classList.toggle('is-off', !state.auto);
    } else if (mode === 'wave') {
      el.textContent = P.fmt(state.zScreen * 1e3, 1) + ' mm';
      live.classList.remove('is-off');
    } else if (mode === 'which') {
      el.textContent = whichValues().Veff.toFixed(3);
      live.classList.remove('is-off');
    }
  }

  /* -------------------------------------------------------- sahne alt bar */

  const ICON_PLAY = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.5h2.2v9H5zM8.8 3.5H11v9H8.8z"/></svg>';
  const ICON_RESET = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.4 2.6v3h-3"/></svg>';

  function buildStageBar() {
    const bar = $('#stage-bar');
    const mode = state.mode;
    if (mode === 'buildup' || mode === 'particle') {
      const label = mode === 'buildup' ? 'Foton ekle' : 'Parçacık ekle';
      const prefix = mode === 'buildup' ? '' : 'p-';
      bar.innerHTML = `
        <span class="bar-label">${label}</span>
        <button class="btn" data-shots="1" data-target="${mode}">1</button>
        <button class="btn" data-shots="10" data-target="${mode}">10</button>
        <button class="btn" data-shots="100" data-target="${mode}">100</button>
        <button class="btn" data-shots="1000" data-target="${mode}">1k</button>
        <button class="btn" data-shots="10000" data-target="${mode}">10k</button>
        <span class="bar-sep"></span>
        <button class="btn primary" id="auto-btn" aria-pressed="false">${ICON_PLAY}<span>Otomatik</span></button>
        <div class="rate-wrap"><span class="bar-label">hız</span><input type="range" id="rate" min="50" max="4000" step="50" value="${state.rate}"></div>
        <span class="bar-sep"></span>
        <button class="btn icon" id="reset-btn" title="Sıfırla">${ICON_RESET}</button>
        <span class="bar-hint">ekrana tıkla → 1 olay · boşluk tuşu</span>`;
    } else if (mode === 'wave') {
      bar.innerHTML = `
        <span class="bar-label">şiddet</span>
        <div class="legend"><span>zayıf</span><div class="legend-bar"></div><span>güçlü</span></div>
        <span class="bar-sep"></span>
        <span class="chip"><i>Fresnel sayısı</i><b id="bar-F">—</b></span>
        <span class="chip"><i>saçak aralığı</i><b id="bar-dy">—</b></span>
        <span class="bar-sep"></span>
        <button class="btn" data-z="0.005">yakın alan</button>
        <button class="btn" data-z="0.2">uzak alan</button>
        <span class="bar-hint">haritadaki ekran çizgisini sürükle</span>`;
    } else if (mode === 'which') {
      bar.innerHTML = `
        <span class="chip"><i>θ</i><b id="bar-theta">22°</b></span>
        <span class="chip"><i>V</i><b id="bar-V">—</b></span>
        <span class="chip"><i>D</i><b id="bar-D">—</b></span>
        <span class="bar-sep"></span>
        <button class="btn" data-theta="0">özdeş işaretçi</button>
        <button class="btn" data-theta="45">dik işaretçi</button>
        <button class="btn" id="bar-analyzer" aria-pressed="false">analizörü aç</button>
        <span class="bar-hint">analizör, yol bilgisini siler</span>`;
    }
  }

  function refreshBar() {
    const mode = state.mode;
    if (mode === 'wave') {
      const F = state.a * state.a / (state.lambda * state.zScreen);
      const dy = state.lambda * state.zScreen / state.d;
      const bf = $('#bar-F'), bd = $('#bar-dy');
      if (bf) bf.textContent = P.fmt(F, 4);
      if (bd) bd.textContent = P.fmtLength(dy);
    } else if (mode === 'which') {
      const vals = whichValues();
      const bt = $('#bar-theta'), bv = $('#bar-V'), bd = $('#bar-D');
      if (bt) bt.textContent = state.theta + '°';
      if (bv) bv.textContent = vals.Veff.toFixed(3);
      if (bd) bd.textContent = vals.D.toFixed(3);
      const ba = $('#bar-analyzer');
      if (ba) {
        ba.textContent = state.analyzer ? 'analizörü kapat' : 'analizörü aç';
        ba.classList.toggle('primary', state.analyzer);
      }
    }
  }

  /* --------------------------------------------------------- parametreler */

  function updateTopMeta() {
    const isParticle = state.mode === 'particle';
    const lambda = isParticle ? P.deBroglie(state.particle, state.K).lambda : state.lambda;
    $('#top-lambda').textContent = isParticle ? P.fmtWavelength(lambda) : P.fmt(lambda * 1e9, 0) + ' nm';
    $('#top-d').textContent = isParticle ? P.fmtLength(state.pd) : P.fmt(state.d * 1e3, 2) + ' mm';
  }

  function syncUI() {
    $$('input[type=range][data-kind]').forEach(inp => {
      const kind = inp.dataset.kind;
      const key = inp.dataset.bind;
      let v = 0;
      if (kind === 'lambda') v = state.lambda * 1e9;
      else if (kind === 'd-mm') v = state.d * 1e3;
      else if (kind === 'a-mm') v = state.a * 1e3;
      else if (kind === 'L-m') v = state.L;
      else if (kind === 'V-pct') v = state.V * 100;
      else if (kind === 'z-mm') v = state.zScreen * 1e3;
      else if (kind === 'theta-deg') v = state.theta;
      else if (kind === 'K-log') v = logInv(state.K, part().kMin, part().kMax) * 1000;
      else if (kind === 'd-log') v = logInv(state.pd, 1e-9, 1e-4) * 1000;
      else if (kind === 'L-log') v = logInv(state.pL, 0.05, 20) * 1000;
      inp.value = String(v);
      const min = parseFloat(inp.min), max = parseFloat(inp.max);
      const pct = ((v - min) / (max - min)) * 100;
      if (!inp.classList.contains('spectral')) inp.style.setProperty('--p', pct + '%');

      const ctrl = inp.closest('.ctrl');
      const out = ctrl ? ctrl.querySelector('.val') : null;
      if (out) out.innerHTML = formatKind(kind);
    });

    $$('.seg[data-seg="N"]').forEach(seg => {
      $$('button', seg).forEach(b => b.classList.toggle('is-active', Number(b.dataset.n) === state.N));
    });
    $$('[data-particles] .particle').forEach(b => {
      b.classList.toggle('is-active', b.dataset.particle === state.particle);
    });
    const sw = $('#q-analyzer');
    if (sw) sw.setAttribute('aria-pressed', state.analyzer ? 'true' : 'false');

    updateTopMeta();
    $('#p-K-min').textContent = P.particleEnergyLabel(part().kMin);
    $('#p-K-max').textContent = P.particleEnergyLabel(part().kMax);
    const relNote = $('#p-rel-note span');
    if (relNote) {
      const db = P.deBroglie(state.particle, state.K);
      relNote.textContent = db.relativistic ? 'açık (hesaba katılıyor)' : 'gereksiz';
    }
    const autoBtn = $('#auto-btn');
    if (autoBtn) {
      autoBtn.innerHTML = (state.auto ? ICON_PAUSE : ICON_PLAY) + '<span>' + (state.auto ? 'Duraklat' : 'Otomatik') + '</span>';
      autoBtn.setAttribute('aria-pressed', state.auto ? 'true' : 'false');
    }
    const rate = $('#rate');
    if (rate) rate.value = String(state.rate);
    refreshBar();
    updateStats();
  }

  function formatKind(kind) {
    switch (kind) {
      case 'lambda': return P.fmt(state.lambda * 1e9, 0) + ' <u>nm</u>';
      case 'd-mm': return P.fmt(state.d * 1e3, 3) + ' <u>mm</u>';
      case 'a-mm': return P.fmt(state.a * 1e3, 3) + ' <u>mm</u>';
      case 'L-m': return P.fmt(state.L, 2) + ' <u>m</u>';
      case 'V-pct': return '%' + P.fmt(state.V * 100, 0);
      case 'z-mm': return P.fmt(state.zScreen * 1e3, 1) + ' <u>mm</u>';
      case 'theta-deg': return state.theta + '°';
      case 'K-log': return P.particleEnergyLabel(state.K);
      case 'd-log': return P.fmtLength(state.pd);
      case 'L-log': return P.fmtLength(state.pL);
    }
    return '';
  }

  function applyParam(key, value) {
    switch (key) {
      case 'lambda': state.lambda = P.clamp(value, 380e-9, 700e-9); break;
      case 'd':
        state.d = P.clamp(value, 0.02e-3, 1e-3);
        if (state.a > state.d * 0.9) state.a = state.d * 0.9;
        break;
      case 'a': state.a = P.clamp(value, 0.01e-3, Math.min(0.3e-3, state.d * 0.9)); break;
      case 'L': state.L = P.clamp(value, 0.2, 5); break;
      case 'V': state.V = P.clamp(value, 0, 1); break;
      case 'zScreen': state.zScreen = P.clamp(value, 0.002, 0.2); break;
      case 'theta': state.theta = P.clamp(value, 0, 45); break;
      case 'K': state.K = P.clamp(value, part().kMin, part().kMax); break;
      case 'pd': state.pd = P.clamp(value, 1e-9, 1e-4); break;
      case 'pL': state.pL = P.clamp(value, 0.05, 20); break;
    }
    syncUI();
    if (key === 'zScreen' && state.mode === 'wave') {
      computeWaveProfile();
      renderBase();
      drawMini();
      return;
    }
    invalidate();
  }

  function invalidate() {
    const mode = state.mode;
    if (mode === 'buildup') rebuildScreen('buildup');
    else if (mode === 'particle') rebuildScreen('particle');
    else if (mode === 'wave') { scheduleWaveJob(); renderBase(); updateStats(); drawMini(); }
    else if (mode === 'which') { renderBase(); updateStats(); drawMini(); }
    else if (mode === 'theory') drawTheoryPlots();
  }

  /* --------------------------------------------------------------- olaylar */

  function bindControls() {
    $$('input[type=range][data-kind]').forEach(inp => {
      inp.addEventListener('input', () => {
        const kind = inp.dataset.kind;
        const key = inp.dataset.bind;
        const raw = parseFloat(inp.value);
        let value = raw;
        if (kind === 'lambda') value = raw * 1e-9;
        else if (kind === 'd-mm' || kind === 'a-mm') value = raw * 1e-3;
        else if (kind === 'z-mm') value = raw * 1e-3;
        else if (kind === 'V-pct') value = raw / 100;
        else if (kind === 'theta-deg') value = raw;
        else if (kind === 'K-log') value = logMap(raw / 1000, part().kMin, part().kMax);
        else if (kind === 'd-log') value = logMap(raw / 1000, 1e-9, 1e-4);
        else if (kind === 'L-log') value = logMap(raw / 1000, 0.05, 20);
        applyParam(key, value);
      });
    });

    $$('.seg[data-seg="N"] button').forEach(b => {
      b.addEventListener('click', () => { state.N = Number(b.dataset.n); syncUI(); invalidate(); });
    });

    $$('[data-particles] .particle').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.particle;
        if (id === state.particle) return;
        state.particle = id;
        const prt = part();
        state.K = prt.defaultK;
        state.pd = prt.defaultD;
        state.pL = prt.defaultL;
        syncUI();
        invalidate();
      });
    });

    const an = $('#q-analyzer');
    an.addEventListener('click', () => {
      state.analyzer = !state.analyzer;
      syncUI(); invalidate();
    });

    $$('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));

    const bar = $('#stage-bar');
    bar.addEventListener('click', e => {
      const shot = e.target.closest('[data-shots]');
      if (shot) { fire(shot.dataset.target, Number(shot.dataset.shots)); return; }
      if (e.target.closest('#auto-btn')) {
        state.auto = !state.auto;
        syncUI();
        return;
      }
      if (e.target.closest('#reset-btn')) {
        const mode = state.mode;
        if (rt[mode] && rt[mode].acc) { rt[mode].acc.reset(); }
        renderBase(); updateStats(); drawMini();
        return;
      }
      const zBtn = e.target.closest('[data-z]');
      if (zBtn) { state.zScreen = parseFloat(zBtn.dataset.z); syncUI(); computeWaveProfile(); renderBase(); drawMini(); return; }
      const thBtn = e.target.closest('[data-theta]');
      if (thBtn) { state.theta = parseFloat(thBtn.dataset.theta); syncUI(); invalidate(); return; }
      if (e.target.closest('#bar-analyzer')) {
        state.analyzer = !state.analyzer; syncUI(); invalidate();
      }
    });
    bar.addEventListener('input', e => {
      if (e.target.id === 'rate') { state.rate = parseFloat(e.target.value); }
    });

    // fare
    wrap.addEventListener('pointermove', e => {
      const rect = wrap.getBoundingClientRect();
      hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (state.mode === 'wave' && draggingScreen) {
        const R = rt.wave.rect || waveLayout();
        const t = (hover.x - R.x0) / (R.x1 - R.x0);
        if (t >= 0 && t <= 1) {
          state.zScreen = P.clamp(rt.wave.zMin + t * (rt.wave.zMax - rt.wave.zMin), 0.002, 0.2);
          syncUI();
          computeWaveProfile();
          updateStats();
          drawMini();
        }
      }
      updateHoverCursor();
    });
    wrap.addEventListener('pointerleave', () => { hover = null; });
    wrap.addEventListener('pointerdown', e => {
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (state.mode === 'wave') {
        const R = rt.wave.rect || waveLayout();
        const sx = R.x0 + (state.zScreen - rt.wave.zMin) / (rt.wave.zMax - rt.wave.zMin) * (R.x1 - R.x0);
        if (Math.abs(x - sx) < 22 && y > R.y0 - 30 && y < R.y1) draggingScreen = true;
      } else if (state.mode === 'buildup' || state.mode === 'particle') {
        fire(state.mode, 1);
      }
    });
    window.addEventListener('pointerup', () => { draggingScreen = false; });

    // klavye
    window.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea, select')) return;
      const map = { '1': 'buildup', '2': 'wave', '3': 'which', '4': 'particle', '5': 'theory' };
      if (map[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) { setMode(map[e.key]); return; }
      if (e.code === 'Space' && !e.target.closest('button')) {
        e.preventDefault();
        if (state.mode === 'buildup' || state.mode === 'particle') fire(state.mode, 1);
      }
      if (e.key === 'r' && (state.mode === 'buildup' || state.mode === 'particle')) {
        rt[state.mode].acc.reset(); renderBase(); updateStats(); drawMini();
      }
    });
  }

  function updateHoverCursor() {
    if (state.mode === 'wave') {
      const R = rt.wave.rect || waveLayout();
      if (hover) {
        const sx = R.x0 + (state.zScreen - rt.wave.zMin) / (rt.wave.zMax - rt.wave.zMin) * (R.x1 - R.x0);
        wrap.style.cursor = Math.abs(hover.x - sx) < 22 ? 'ew-resize' : 'crosshair';
      }
    } else if (state.mode === 'buildup' || state.mode === 'particle') {
      wrap.style.cursor = 'crosshair';
    } else {
      wrap.style.cursor = 'default';
    }
  }

  /* ------------------------------------------------------- teori grafikleri */

  function drawTheoryPlots() {
    $$('canvas[data-plot]').forEach(cv => {
      const kind = cv.dataset.plot;
      const rect = cv.getBoundingClientRect();
      if (rect.width < 10) return;
      const d = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(rect.width * d), h = Math.round(rect.height * d);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const ctx = cv.getContext('2d');
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const W = rect.width, H = rect.height;
      const p = { lambda: 532e-9, d: 0.25e-3, a: 0.06e-3, L: 1.2, N: 2, V: 1 };
      const half = 1.8 * P.envelopeZero(p.lambda, p.a, p.L);
      const N = 400;
      const arr = new Float32Array(N);
      let m = 0;
      for (let i = 0; i < N; i++) {
        const y = -half + 2 * half * (i + 0.5) / N;
        let v;
        if (kind === 'interference') {
          v = Math.pow(Math.cos(Math.PI * p.d * y / (p.lambda * p.L)), 2);
        } else if (kind === 'envelope') {
          v = Math.pow(P.sinc(Math.PI * p.a * y / (p.lambda * p.L)), 2);
        } else {
          v = P.intensity(y, p);
        }
        arr[i] = v;
        if (v > m) m = v;
      }
      m = m || 1;
      const color = kind === 'interference' ? [110, 231, 255] : kind === 'envelope' ? [255, 212, 121] : [103, 232, 185];
      const grd = ctx.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, P.rgbCss(color, 0.35));
      grd.addColorStop(1, P.rgbCss(color, 0.02));
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * W;
        const y = H - (arr[i] / m) * (H - 8);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * W;
        const y = H - (arr[i] / m) * (H - 8);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = P.rgbCss(color, 0.95);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(233,239,236,.14)';
      ctx.beginPath(); ctx.moveTo(0, H - 0.5); ctx.lineTo(W, H - 0.5); ctx.stroke();
    });
  }

  function bindToc() {
    const links = $$('.toc a');
    const sections = links.map(a => $(a.getAttribute('href'))).filter(Boolean);
    const obs = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          links.forEach(l => l.classList.toggle('is-active', l.getAttribute('href') === '#' + en.target.id));
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px', root: $('#theory') });
    sections.forEach(s => obs.observe(s));
  }

  /* ------------------------------------------------------------- ana döngü */

  let last = performance.now();

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (state.auto && (state.mode === 'buildup' || state.mode === 'particle')) {
      const r = rt[state.mode];
      r.pending += state.rate * dt;
      const n = Math.min(320, Math.floor(r.pending));
      if (n > 0) { r.pending -= n; fire(state.mode, n); }
    }

    if (state.mode === 'wave' && rt.wave.job) {
      const more = stepWaveJob(11);
      if (!more) { updateStats(); drawMini(); }
    }

    if (state.mode !== 'theory') {
      renderFX(now);
      updateHud(now);
      if (now - lastChartAt > 600 && (state.mode === 'buildup' || state.mode === 'particle')) {
        drawMini(); updateStats(); lastChartAt = now;
      }
    }
    requestAnimationFrame(loop);
  }

  /* --------------------------------------------------------------- açılış */

  function init() {
    resizeCanvases();
    bindControls();
    bindToc();
    syncUI();
    setMode('buildup');
    requestAnimationFrame(loop);

    new ResizeObserver(() => {
      const changed = resizeCanvases();
      if (!changed) return;
      ['buildup', 'particle'].forEach(m => {
        if (rt[m].acc) {
          rt[m].acc.resize(base.width, base.height);
          applyAccLayout(rt[m].acc);
        }
      });
      renderBase();
      drawMini();
      if (state.mode === 'theory') drawTheoryPlots();
    }).observe(wrap);

    window.addEventListener('resize', () => { drawMini(); if (state.mode === 'theory') drawTheoryPlots(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.__ciftYarik = { state, rt, P };
})();
