/* ============================================================================
   ÇİFT YARIK — fizik çekirdeği
   Saf fonksiyonlar. Tarayıcıda global `Physics`, Node'da `module.exports`.
   ========================================================================== */
(function (global) {
  'use strict';

  const PI = Math.PI;
  const C_LIGHT = 299792458;                 // m/s
  const H_PLANCK = 6.62607015e-34;           // J·s
  const HC_EV_M = 1.2398419843320026e-6;     // eV·m
  const EV_J = 1.602176634e-19;              // J

  /* --------------------------------------------------------------------------
     Fresnel integralleri C(x), S(x)
     C(x) + iS(x) = ∫₀ˣ exp(iπt²/2) dt
     |x| ≤ 3.5 : kuvvet serisi + tablo enterpolasyonu
     |x| > 3.5 : asimptotik açılım
     -------------------------------------------------------------------------- */

  const FRESNEL_STEP = 0.0005;
  const FRESNEL_MAX = 3.5;
  const FRESNEL_N = Math.round(FRESNEL_MAX / FRESNEL_STEP);

  function fresnelSeries(x) {
    const pix2 = PI * 0.5;
    const x2 = x * x;
    const x4 = x2 * x2;

    // C(x) = Σ (-1)^n (π/2)^(2n) x^(4n+1) / ((2n)! (4n+1))
    let term = x;
    let C = term;
    let n = 1;
    while (n < 80) {
      term *= -pix2 * pix2 * x4 * (4 * n - 3) /
              ((2 * n) * (2 * n - 1) * (4 * n + 1));
      C += term;
      if (Math.abs(term) < 1e-17) break;
      n++;
    }

    // S(x) = Σ (-1)^n (π/2)^(2n+1) x^(4n+3) / ((2n+1)! (4n+3))
    term = pix2 * x * x2 / 3;
    let S = term;
    n = 1;
    while (n < 80) {
      term *= -pix2 * pix2 * x4 * (4 * n - 1) /
              ((2 * n) * (2 * n + 1) * (4 * n + 3));
      S += term;
      if (Math.abs(term) < 1e-17) break;
      n++;
    }
    return [C, S];
  }

  const fresnelTableC = new Float64Array(FRESNEL_N + 1);
  const fresnelTableS = new Float64Array(FRESNEL_N + 1);
  (function buildFresnelTable() {
    for (let i = 0; i <= FRESNEL_N; i++) {
      const [c, s] = fresnelSeries(i * FRESNEL_STEP);
      fresnelTableC[i] = c;
      fresnelTableS[i] = s;
    }
  })();

  function fresnelCS(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);

    if (ax <= FRESNEL_MAX) {
      const p = ax / FRESNEL_STEP;
      const i = Math.min(FRESNEL_N - 1, p | 0);
      const t = p - i;
      const c = fresnelTableC[i] + (fresnelTableC[i + 1] - fresnelTableC[i]) * t;
      const s = fresnelTableS[i] + (fresnelTableS[i + 1] - fresnelTableS[i]) * t;
      return [sign * c, sign * s];
    }

    const phi = PI * ax * ax * 0.5;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    const invp = 1 / (PI * ax);
    const invx = 1 / ax;
    const a2 = invp * invp;
    const x2 = invx * invx;

    const f = invp * (1 - 3 * a2 * x2 + 105 * a2 * a2 * x2 * x2 -
                      10395 * a2 * a2 * a2 * x2 * x2 * x2);
    const g = a2 * invx * (1 - 15 * a2 * x2 + 945 * a2 * a2 * x2 * x2 -
                           135135 * a2 * a2 * a2 * x2 * x2 * x2);

    return [
      sign * (0.5 + f * sp - g * cp),
      sign * (0.5 - f * cp - g * sp)
    ];
  }

  /* --------------------------------------------------------------------------
     Yardımcılar
     -------------------------------------------------------------------------- */

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function sinc(x) {
    if (Math.abs(x) < 1e-12) return 1;
    return Math.sin(x) / x;
  }

  function grating(alpha, N) {
    if (N <= 1) return 1;
    const den = N * Math.sin(alpha);
    if (Math.abs(den) < 1e-10) return 1;
    return Math.pow(Math.sin(N * alpha) / den, 2);
  }

  function fringeSpacing(lambda, d, L) { return lambda * L / d; }
  function envelopeZero(lambda, a, L) { return lambda * L / a; }

  /**
   * Ekranın yarı genişliği: her zaman okunabilir sayıda saçak göster,
   * ama sonlu yarık zarfının dışına gereksiz taşma.
   */
  function screenHalfWidth(p) {
    const dy = fringeSpacing(p.lambda, p.d, p.L);
    const env = envelopeZero(p.lambda, p.a, p.L);
    if (p.N === 1) return 1.65 * env;
    let half = Math.min(12 * dy, 2.6 * env);
    half = Math.max(half, 3.2 * dy);
    return half;
  }

  function geometry(p) {
    const dy = fringeSpacing(p.lambda, p.d, p.L);
    const env = envelopeZero(p.lambda, p.a, p.L);
    return {
      dy,
      env,
      halfWidth: screenHalfWidth(p),
      fresnelNumber: (p.a * p.a) / (p.lambda * p.L)
    };
  }

  /* --------------------------------------------------------------------------
     Şiddet modeli (Fraunhofer / ekran)
     p = { lambda, d, a, L, N, V }
     y : ekran üzerindeki konum (m)
     -------------------------------------------------------------------------- */

  function intensity(y, p) {
    const sinTheta = y / Math.hypot(y, p.L);
    const beta = PI * p.a * sinTheta / p.lambda;
    const alpha = PI * p.d * sinTheta / p.lambda;
    const envelope = Math.pow(sinc(beta), 2);
    const N = p.N || 2;
    const V = p.V == null ? 1 : p.V;

    if (N === 1) return envelope;

    const g = grating(alpha, N);
    return envelope * ((1 - V) / N + V * g);
  }

  /**
   * Monte Carlo örnekleyici: |ψ|² dağılımından ters-CDF ile örnek üretir.
   */
  function makeSampler(p, halfWidth, bins) {
    bins = bins || 2048;
    halfWidth = halfWidth || screenHalfWidth(p);
    const y0 = -halfWidth;
    const dy = (2 * halfWidth) / bins;
    const pdf = new Float64Array(bins);
    let total = 0;

    for (let i = 0; i < bins; i++) {
      const y = y0 + (i + 0.5) * dy;
      const I = Math.max(0, intensity(y, p));
      pdf[i] = I;
      total += I;
    }

    if (!(total > 0)) {
      for (let i = 0; i < bins; i++) pdf[i] = 1;
      total = bins;
    }

    const cdf = new Float64Array(bins);
    let acc = 0;
    for (let i = 0; i < bins; i++) {
      acc += pdf[i];
      cdf[i] = acc / total;
    }

    return { pdf, cdf, bins, y0, dy, halfWidth, total };
  }

  function sampleSampler(sampler, rng) {
    const u = (rng || Math.random)();
    const cdf = sampler.cdf;
    const bins = sampler.bins;
    let lo = 0, hi = bins - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    const prev = lo > 0 ? cdf[lo - 1] : 0;
    const span = cdf[lo] - prev;
    const frac = span > 0 ? (u - prev) / span : 0.5;
    return sampler.y0 + (lo + frac) * sampler.dy;
  }

  /* --------------------------------------------------------------------------
     Fresnel (yakın alan) alanı
     U(x,z) ∝ Σ_yarık [ ΔC + iΔS ],  v = √(2/(λz)) (x' − x)
     -------------------------------------------------------------------------- */

  function fresnelField(x, z, p) {
    z = Math.max(z, 1e-6);
    const vf = Math.sqrt(2 / (p.lambda * z));
    const N = p.N || 2;
    let re = 0, im = 0;

    for (let i = 0; i < N; i++) {
      const center = (i - (N - 1) / 2) * p.d;
      const v1 = vf * (center - p.a / 2 - x);
      const v2 = vf * (center + p.a / 2 - x);
      const [c1, s1] = fresnelCS(v1);
      const [c2, s2] = fresnelCS(v2);
      re += c2 - c1;
      im += s2 - s1;
    }

    // 1/√(2i) = (1 − i)/2
    return { re: (re + im) * 0.5, im: (im - re) * 0.5 };
  }

  function fresnelIntensity(x, z, p) {
    const U = fresnelField(x, z, p);
    return U.re * U.re + U.im * U.im;
  }

  /**
   * z düzleminde ekran profili. Dönen dizi { y, I }.
   */
  function screenProfile(z, p, halfWidth, count) {
    count = count || 900;
    halfWidth = halfWidth || screenHalfWidth(p);
    const out = new Float32Array(count);
    const ys = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const y = -halfWidth + (2 * halfWidth) * (i + 0.5) / count;
      ys[i] = y;
      out[i] = fresnelIntensity(y, z, p);
    }
    return { ys, I: out, halfWidth, z };
  }

  /* --------------------------------------------------------------------------
     Madde dalgaları
     -------------------------------------------------------------------------- */

  const PARTICLES = {
    electron: {
      id: 'electron', name: 'Elektron', symbol: 'e⁻',
      massEV: 510998.950, defaultK: 1000,
      kMin: 0.1, kMax: 300000,
      defaultD: 1e-6, defaultL: 1.0,
      color: '#6ee7ff'
    },
    neutron: {
      id: 'neutron', name: 'Nötron', symbol: 'n',
      massEV: 939565420, defaultK: 0.0253,
      kMin: 1e-4, kMax: 1e4,
      defaultD: 5e-7, defaultL: 2.0,
      color: '#b9a8ff'
    },
    proton: {
      id: 'proton', name: 'Proton', symbol: 'p⁺',
      massEV: 938272088, defaultK: 1,
      kMin: 0.01, kMax: 1e6,
      defaultD: 1e-6, defaultL: 1.0,
      color: '#ffb38a'
    },
    c60: {
      id: 'c60', name: 'C₆₀', symbol: 'C₆₀',
      massEV: 720 * 931.49410242e6, defaultK: 100,
      kMin: 1, kMax: 1e5,
      defaultD: 1e-7, defaultL: 1.0,
      color: '#ffd479'
    }
  };

  /** Relativistik de Broglie dalga boyu (m). K: kinetik enerji, eV. */
  function deBroglie(particle, K) {
    const rest = (typeof particle === 'string' ? PARTICLES[particle] : particle).massEV;
    const pEV = Math.sqrt(Math.max(K, 1e-12) * (K + 2 * rest));
    const lambda = HC_EV_M / pEV;
    const gamma = 1 + K / rest;
    const beta = Math.sqrt(Math.max(0, 1 - 1 / (gamma * gamma)));
    return {
      lambda,
      pEV,
      pSI: pEV * EV_J / C_LIGHT,
      v: beta * C_LIGHT,
      beta,
      gamma,
      relativistic: K / rest > 0.01
    };
  }

  function particleEnergyLabel(K) {
    if (K >= 1e6) return (K / 1e6).toFixed(3) + ' MeV';
    if (K >= 1e3) return (K / 1e3).toFixed(3) + ' keV';
    if (K >= 1) return K.toFixed(3) + ' eV';
    return K.toExponential(3) + ' eV';
  }

  /* --------------------------------------------------------------------------
     Renk: dalga boyu → yaklaşık görünür spektrum rengi
     (Algısal/eğitim amaçlı; fotometrik değil.)
     -------------------------------------------------------------------------- */

  function wavelengthColor(nm) {
    let h;
    if (nm <= 440) h = 280 - (nm - 380) / (440 - 380) * 40;      // 380→280, 440→240
    else if (nm <= 490) h = 240 - (nm - 440) / 50 * 60;           // 440→240, 490→180
    else if (nm <= 560) h = 180 - (nm - 490) / 70 * 60;           // 490→180, 560→120
    else if (nm <= 600) h = 120 - (nm - 560) / 40 * 60;           // 560→120, 600→60
    else h = 60 - (nm - 600) / 100 * 60;                          // 600→60, 700→0
    h = clamp(h, 0, 300);
    return { h, s: 0.88, l: 0.62 };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }

  function wavelengthRgb(nm) {
    const c = wavelengthColor(nm);
    return hslToRgb(c.h, c.s, c.l);
  }

  function rgbCss(rgb, a) {
    const r = Math.round(clamp(rgb[0], 0, 1) * 255);
    const g = Math.round(clamp(rgb[1], 0, 1) * 255);
    const b = Math.round(clamp(rgb[2], 0, 1) * 255);
    return a == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
  }

  /* --------------------------------------------------------------------------
     Biçimlendirme
     -------------------------------------------------------------------------- */

  const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
  const nf3 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

  function fmtInt(n) { return nf.format(Math.round(n)); }
  function fmt(n, digits) {
    const d = digits == null ? 2 : digits;
    if (!isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return n.toExponential(2).replace('.', ',');
    return (d === 0 ? nf : d === 1 ? nf1 : d === 2 ? nf2 : nf3).format(n);
  }

  function fmtLength(m) {
    const abs = Math.abs(m);
    if (abs === 0) return '0 m';
    if (abs < 1e-12) return fmt(m * 1e15, 2) + ' fm';
    if (abs < 1e-9) return fmt(m * 1e12, 2) + ' pm';
    if (abs < 1e-6) return fmt(m * 1e9, 2) + ' nm';
    if (abs < 1e-3) return fmt(m * 1e6, 2) + ' µm';
    if (abs < 1) return fmt(m * 1e3, 2) + ' mm';
    return fmt(m, 2) + ' m';
  }

  function fmtWavelength(m) {
    const abs = Math.abs(m);
    if (abs === 0) return '0 m';
    if (abs < 1e-12) return fmt(m * 1e15, 2) + ' fm';
    if (abs < 1e-9) return fmt(m * 1e12, 2) + ' pm';
    if (abs < 1e-6) return fmt(m * 1e9, 2) + ' nm';
    if (abs < 1e-3) return fmt(m * 1e6, 2) + ' µm';
    return fmt(m * 1e3, 2) + ' mm';
  }

  function fmtAngle(rad) {
    const deg = rad * 180 / PI;
    if (Math.abs(deg) < 1e-3) return (deg * 1e6).toFixed(2) + ' µ°';
    if (Math.abs(deg) < 0.1) return deg.toExponential(2).replace('.', ',') + '°';
    return fmt(deg, 3) + '°';
  }

  function fmtSci(n, digits) {
    if (n === 0) return '0';
    const d = digits == null ? 2 : digits;
    const e = Math.floor(Math.log10(Math.abs(n)));
    const mant = n / Math.pow(10, e);
    return mant.toFixed(d).replace('.', ',') + ' × 10' + sup(e);
  }

  const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
                '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function sup(n) {
    return String(n).split('').map(ch => SUP[ch] || ch).join('');
  }

  /* --------------------------------------------------------------------------
     Dışa aktarım
     -------------------------------------------------------------------------- */

  const Physics = {
    PI, C_LIGHT, H_PLANCK, HC_EV_M, EV_J,
    clamp, sinc, grating,
    fresnelCS, fresnelSeries,
    intensity, makeSampler, sampleSampler,
    fringeSpacing, envelopeZero, screenHalfWidth, geometry,
    fresnelField, fresnelIntensity, screenProfile,
    PARTICLES, deBroglie, particleEnergyLabel,
    wavelengthColor, wavelengthRgb, hslToRgb, rgbCss,
    fmtInt, fmt, fmtLength, fmtWavelength, fmtAngle, fmtSci
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
  else global.Physics = Physics;
})(typeof globalThis !== 'undefined' ? globalThis : this);
