/*
 * signals.js — ORTAK STRATEJİ FONKSİYONU.
 * Sinyal paneli ve backtest motoru aynı `generateSignals` fonksiyonunu kullanır.
 *
 * Akış: RSI/ATR/EMA hesapla → uyumsuzlukları bul → her uyumsuzluk için
 * giriş (onaydan sonraki mumun açılışı), SL, TP1, TP2 ve güç skoru üret.
 * Girdi mumları yalnızca KAPANMIŞ mumlar olmalıdır (confirm=1).
 */
(function (root) {
  'use strict';

  const R = root.CD || {};
  const ind = R.indicators || (typeof require !== 'undefined' ? require('./indicators.js') : null);
  const div = R.divergence || (typeof require !== 'undefined' ? require('./divergence.js') : null);

  // SL/TP seviyelerini giriş fiyatına göre hesaplar.
  // Risk = |giriş − SL|; TP = giriş ± R × risk
  function computeLevels(type, entry, sl, params) {
    const risk = type === 'BUY' ? entry - sl : sl - entry;
    if (!(risk > 0)) return null; // giriş SL'in ötesinde açıldıysa geçersiz
    const dir = type === 'BUY' ? 1 : -1;
    return {
      entry,
      sl,
      risk,
      tp1: entry + dir * params.tp1R * risk,
      tp2: entry + dir * params.tp2R * risk,
    };
  }

  // Güç skoru (0–100):
  //  RSI farkı (40 puan): |RSI2 − RSI1| 10 puan ve üzeriyse tam puan
  //  Fiyat farkı (30 puan): |fiyat2 − fiyat1| / ATR, 2 ATR ve üzeriyse tam puan
  //  Trend uyumu (30 puan): BUY için kapanış > EMA200, SELL için kapanış < EMA200
  function scoreSignal(d, atrVal, emaVal, close) {
    const rsiPart = Math.min(Math.abs(d.p2.rsi - d.p1.rsi) / 10, 1) * 40;
    const pricePart = atrVal > 0 ? Math.min(Math.abs(d.p2.price - d.p1.price) / atrVal / 2, 1) * 30 : 0;
    let trendPart = 15; // EMA henüz hesaplanamadıysa nötr
    if (emaVal != null) {
      const aligned = d.type === 'BUY' ? close > emaVal : close < emaVal;
      trendPart = aligned ? 30 : 0;
    }
    return Math.round(rsiPart + pricePart + trendPart);
  }

  function generateSignals(candles, params) {
    const p = params;
    const closes = candles.map((c) => c.close);
    const rsiArr = ind.rsi(closes, p.rsiPeriod);
    const atrArr = ind.atr(candles, p.atrPeriod);
    const emaArr = ind.ema(closes, p.emaPeriod);
    const divs = div.detectDivergences(candles, rsiArr, p, emaArr);
    const barMs = candles.length > 1 ? candles[1].time - candles[0].time : 0;

    const signals = [];
    for (const d of divs) {
      const ci = d.confirmIndex;
      const a = atrArr[ci];
      if (a == null) continue;
      // SL: BUY → son swing low − k×ATR ; SELL → son swing high + k×ATR
      const sl = d.type === 'BUY' ? d.p2.price - p.atrMult * a : d.p2.price + p.atrMult * a;
      const ei = ci + 1;
      // Giriş: onay mumundan sonraki mumun açılışı. Henüz yoksa (canlı) tahmini
      // olarak onay mumunun kapanışı kullanılır ve sinyal "pending" işaretlenir.
      const pending = ei >= candles.length;
      const entry = pending ? candles[ci].close : candles[ei].open;
      const lv = computeLevels(d.type, entry, sl, p);
      if (!lv) continue;
      signals.push({
        type: d.type,
        kind: d.kind,
        p1: d.p1,
        p2: d.p2,
        p1Time: candles[d.p1.index].time,
        p2Time: candles[d.p2.index].time,
        confirmIndex: ci,
        entryIndex: ei,
        pending,
        time: candles[ci].time + barMs, // sinyal zamanı = onay mumunun kapanışı
        atr: a,
        ...lv,
        score: scoreSignal(d, a, emaArr[ci], candles[ci].close),
      });
    }
    return { signals, rsi: rsiArr, atr: atrArr, ema: emaArr };
  }

  // Canlı panelde: bekleyen sinyale oluşmakta olan mumun açılışını giriş olarak uygula.
  function applyEntry(sig, entry, params) {
    const lv = computeLevels(sig.type, entry, sig.sl, params);
    if (!lv) return { ...sig, invalid: true };
    return { ...sig, ...lv, pending: false };
  }

  // Sinyalin girişten sonraki durumunu izle (panel için).
  // Aynı mumda hem SL hem TP görülürse SL kabul edilir (muhafazakâr).
  function trackSignal(candles, sig) {
    if (sig.pending) return 'Bekliyor';
    let tp1 = false;
    for (let i = sig.entryIndex; i < candles.length; i++) {
      const c = candles[i];
      const isBuy = sig.type === 'BUY';
      const hitSl = isBuy ? c.low <= sig.sl : c.high >= sig.sl;
      if (hitSl) return tp1 ? 'TP1 → SL' : 'SL';
      if (isBuy ? c.high >= sig.tp2 : c.low <= sig.tp2) return 'TP2';
      if (isBuy ? c.high >= sig.tp1 : c.low <= sig.tp1) tp1 = true;
    }
    return tp1 ? 'TP1' : 'Açık';
  }

  const api = { generateSignals, computeLevels, applyEntry, trackSignal, scoreSignal };
  root.CD = root.CD || {};
  root.CD.signals = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
