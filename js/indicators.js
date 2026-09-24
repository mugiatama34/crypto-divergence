/*
 * indicators.js — Teknik göstergeler (RSI, EMA, ATR).
 * Tüm fonksiyonlar girdi ile aynı uzunlukta dizi döndürür; hesaplanamayan
 * başlangıç değerleri null'dır. Hepsi nedenseldir: i. değer yalnızca 0..i verisini kullanır.
 */
(function (root) {
  'use strict';

  // RSI — Wilder yöntemi.
  // İlk ortalama kazanç/kayıp: ilk `period` değişimin basit ortalaması,
  // sonrası Wilder yumuşatması: avg = (avg * (period - 1) + yeni) / period
  function rsi(closes, period = 14) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    if (n <= period) return out;

    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    out[period] = toRsi(avgGain, avgLoss);

    for (let i = period + 1; i < n; i++) {
      const d = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = toRsi(avgGain, avgLoss);
    }
    return out;
  }

  function toRsi(avgGain, avgLoss) {
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  // EMA — ilk değer ilk `period` elemanın SMA'sı ile başlatılır.
  function ema(values, period) {
    const n = values.length;
    const out = new Array(n).fill(null);
    if (n < period) return out;
    const k = 2 / (period + 1);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    let prev = sum / period;
    out[period - 1] = prev;
    for (let i = period; i < n; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  // Gerçek aralık (True Range)
  function trueRange(candles) {
    return candles.map((c, i) => {
      if (i === 0) return c.high - c.low;
      const pc = candles[i - 1].close;
      return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    });
  }

  // ATR — Wilder yumuşatması; ilk değer ilk `period` TR'nin ortalaması.
  function atr(candles, period = 14) {
    const tr = trueRange(candles);
    const n = tr.length;
    const out = new Array(n).fill(null);
    if (n < period) return out;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    let prev = sum / period;
    out[period - 1] = prev;
    for (let i = period; i < n; i++) {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
    return out;
  }

  const api = { rsi, ema, atr, trueRange };
  root.CD = root.CD || {};
  root.CD.indicators = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
