/*
 * divergence.js — Pivot (swing) tespiti ve RSI–fiyat uyumsuzlukları.
 *
 * LOOKAHEAD YOK: i. mumdaki bir pivot, sağındaki N mum kapanmadan bilinemez.
 * Bu yüzden her pivot `confirmIndex = index + right` alanını taşır ve bir
 * uyumsuzluk yalnızca ikinci pivotun onaylandığı mumda (confirmIndex) üretilir.
 * O mum kapanana kadar kullanılan tüm veriler (fiyat, RSI, EMA) ≤ confirmIndex'tir.
 */
(function (root) {
  'use strict';

  // Pivot tespiti.
  // type='low'  → soldaki N değer kesin olarak daha büyük, sağdaki N değer ≥ olmalı
  // type='high' → soldaki N değer kesin olarak daha küçük, sağdaki N değer ≤ olmalı
  // (Sol kesin / sağ eşit-olabilir kuralı, düz dip/tepelerde tek pivot üretir.)
  function findPivots(values, left, right, type) {
    const out = [];
    const isLow = type === 'low';
    for (let i = left; i + right < values.length; i++) {
      const v = values[i];
      if (v == null || Number.isNaN(v)) continue;
      let ok = true;
      for (let j = i - left; j < i && ok; j++) {
        if (isLow ? values[j] <= v : values[j] >= v) ok = false;
      }
      for (let j = i + 1; j <= i + right && ok; j++) {
        if (isLow ? values[j] < v : values[j] > v) ok = false;
      }
      if (ok) out.push({ index: i, value: v, confirmIndex: i + right });
    }
    return out;
  }

  // Uyumsuzluk tespiti.
  // candles: [{time, open, high, low, close}], rsiArr: RSI dizisi, emaArr: EMA dizisi (trend filtresi için)
  // Dönen her öğe: {type:'BUY'|'SELL', kind:'regular'|'hidden', p1, p2, confirmIndex}
  function detectDivergences(candles, rsiArr, params, emaArr) {
    const p = params;
    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    const out = [];

    const check = (pivots, side) => {
      for (let k = 1; k < pivots.length; k++) {
        const a = pivots[k - 1]; // bir önceki pivot
        const b = pivots[k]; // yeni (ikinci) pivot
        const dist = b.index - a.index;
        if (dist < p.minBars || dist > p.maxBars) continue;
        const r1 = rsiArr[a.index];
        const r2 = rsiArr[b.index];
        if (r1 == null || r2 == null) continue;

        let kind = null;
        if (side === 'BUY') {
          // Pozitif (klasik): fiyat daha düşük dip, RSI daha yüksek dip, 2. dipte RSI < eşik
          if (b.value < a.value && r2 > r1 && r2 < p.bullRsiMax) kind = 'regular';
          // Gizli pozitif: fiyat daha yüksek dip, RSI daha düşük dip (trend devamı)
          else if (p.useHidden && b.value > a.value && r2 < r1 && r2 < p.hiddenBullRsiMax) kind = 'hidden';
        } else {
          // Negatif (klasik): fiyat daha yüksek tepe, RSI daha düşük tepe, 2. tepede RSI > eşik
          if (b.value > a.value && r2 < r1 && r2 > p.bearRsiMin) kind = 'regular';
          // Gizli negatif: fiyat daha düşük tepe, RSI daha yüksek tepe
          else if (p.useHidden && b.value < a.value && r2 > r1 && r2 > p.hiddenBearRsiMin) kind = 'hidden';
        }
        if (!kind) continue;

        const ci = b.confirmIndex;
        // EMA trend filtresi: onay mumunun kapanışı EMA'nın doğru tarafında olmalı
        if (p.useTrendFilter) {
          const e = emaArr ? emaArr[ci] : null;
          if (e == null) continue;
          const close = candles[ci].close;
          if (side === 'BUY' && !(close > e)) continue;
          if (side === 'SELL' && !(close < e)) continue;
        }

        out.push({
          type: side,
          kind,
          p1: { index: a.index, price: a.value, rsi: r1 },
          p2: { index: b.index, price: b.value, rsi: r2 },
          confirmIndex: ci,
        });
      }
    };

    check(findPivots(lows, p.pivotLeft, p.pivotRight, 'low'), 'BUY');
    check(findPivots(highs, p.pivotLeft, p.pivotRight, 'high'), 'SELL');
    // Kronolojik sıraya diz (onay zamanına göre)
    out.sort((x, y) => x.confirmIndex - y.confirmIndex || (x.type === 'BUY' ? -1 : 1));
    return out;
  }

  const api = { findPivots, detectDivergences };
  root.CD = root.CD || {};
  root.CD.divergence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
