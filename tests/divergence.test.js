const test = require('node:test');
const assert = require('node:assert/strict');
const { CD, randomWalk } = require('./helpers.js');
const { findPivots, detectDivergences } = CD.divergence;
const { generateSignals } = CD.signals;

const baseParams = () => ({ ...CD.config.STRATEGY });

test('findPivots: dip/tepe bulur ve onay indeksini sağ uzunluk kadar kaydırır', () => {
  const v = [5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7];
  const lows = findPivots(v, 3, 3, 'low');
  assert.equal(lows.length, 1);
  assert.deepEqual(lows[0], { index: 4, value: 1, confirmIndex: 7 });
  const highs = findPivots(v.map((x) => -x), 3, 3, 'high');
  assert.equal(highs[0].index, 4);
});

test('findPivots: sağda yeterli mum yoksa pivot yok (lookahead yok)', () => {
  const v = [5, 4, 3, 2, 1, 2, 3];
  assert.equal(findPivots(v, 3, 3, 'low').length, 0);
  assert.equal(findPivots(v.concat([4]), 3, 3, 'low').length, 1);
});

test('findPivots: düz dipte tek pivot üretir', () => {
  const v = [5, 4, 3, 1, 1, 3, 4, 5];
  const p = findPivots(v, 2, 2, 'low');
  assert.equal(p.length, 1);
  assert.equal(p[0].index, 3);
});

// Elle kurulmuş iki dip: fiyat daha düşük dip, RSI daha yüksek dip
function makeBullCase({ dist = 20, r2 = 35, lowerLow = true } = {}) {
  const n = 60;
  const candles = [];
  const rsiArr = [];
  const p1 = 10;
  const p2 = p1 + dist;
  for (let i = 0; i < n; i++) {
    let low = 100;
    let rv = 50;
    if (i === p1) {
      low = 90;
      rv = 25;
    }
    if (i === p2) {
      low = lowerLow ? 85 : 95;
      rv = r2;
    }
    candles.push({ time: i, open: low + 2, high: low + 5, low, close: low + 3 });
    rsiArr.push(rv);
  }
  return { candles, rsiArr, p1, p2 };
}

test('Pozitif uyumsuzluk: fiyat LL + RSI HL + RSI<40 → BUY, onay p2+5', () => {
  const { candles, rsiArr, p1, p2 } = makeBullCase();
  const d = detectDivergences(candles, rsiArr, baseParams(), null);
  assert.equal(d.length, 1);
  assert.equal(d[0].type, 'BUY');
  assert.equal(d[0].kind, 'regular');
  assert.equal(d[0].p1.index, p1);
  assert.equal(d[0].p2.index, p2);
  assert.equal(d[0].confirmIndex, p2 + 5);
});

test('Pozitif uyumsuzluk: 2. dipte RSI ≥ 40 ise sinyal yok', () => {
  const { candles, rsiArr } = makeBullCase({ r2: 45 });
  assert.equal(detectDivergences(candles, rsiArr, baseParams(), null).length, 0);
});

test('Pozitif uyumsuzluk: pivot mesafesi 5–60 dışında ise sinyal yok', () => {
  const far = makeBullCase({ dist: 45 });
  const p = { ...baseParams(), maxBars: 40 };
  assert.equal(detectDivergences(far.candles, far.rsiArr, p, null).length, 0);
});

test('Gizli pozitif uyumsuzluk yalnızca açıkken üretilir', () => {
  // fiyat HL, RSI LL
  const { candles, rsiArr, p2 } = makeBullCase({ lowerLow: false, r2: 20 });
  assert.equal(detectDivergences(candles, rsiArr, baseParams(), null).length, 0);
  const d = detectDivergences(candles, rsiArr, { ...baseParams(), useHidden: true }, null);
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'hidden');
  assert.equal(d[0].p2.index, p2);
});

test('Negatif uyumsuzluk: fiyat HH + RSI LH + RSI>60 → SELL', () => {
  const { candles, rsiArr } = makeBullCase();
  // Aynalama: fiyat ve RSI ters çevrilir
  const mc = candles.map((c) => ({ time: c.time, open: 300 - c.open, high: 300 - c.low, low: 300 - c.high, close: 300 - c.close }));
  const mr = rsiArr.map((r) => 100 - r);
  const d = detectDivergences(mc, mr, baseParams(), null);
  assert.equal(d.length, 1);
  assert.equal(d[0].type, 'SELL');
});

test('EMA trend filtresi: BUY için kapanış EMA üstünde olmalı', () => {
  const { candles, rsiArr, p2 } = makeBullCase();
  const p = { ...baseParams(), useTrendFilter: true };
  const emaBelow = candles.map(() => 50);
  const emaAbove = candles.map(() => 500);
  assert.equal(detectDivergences(candles, rsiArr, p, emaBelow).length, 1);
  assert.equal(detectDivergences(candles, rsiArr, p, emaAbove).length, 0);
  assert.ok(p2 > 0);
});

test('generateSignals: SL/TP geometrisi ve giriş = sonraki mumun açılışı', () => {
  const candles = randomWalk(3000, 7);
  const p = baseParams();
  const { signals } = generateSignals(candles, p);
  assert.ok(signals.length > 0, 'rastgele yürüyüşte en az bir sinyal beklenir');
  for (const s of signals) {
    if (!s.pending) assert.equal(s.entry, candles[s.entryIndex].open);
    assert.equal(s.entryIndex, s.confirmIndex + 1);
    assert.equal(s.confirmIndex, s.p2.index + p.pivotRight);
    const risk = s.type === 'BUY' ? s.entry - s.sl : s.sl - s.entry;
    assert.ok(risk > 0);
    assert.ok(Math.abs(Math.abs(s.tp1 - s.entry) - p.tp1R * risk) < 1e-9);
    assert.ok(Math.abs(Math.abs(s.tp2 - s.entry) - p.tp2R * risk) < 1e-9);
    if (s.type === 'BUY') assert.ok(Math.abs(s.sl - (s.p2.price - 0.5 * s.atr)) < 1e-9);
    else assert.ok(Math.abs(s.sl - (s.p2.price + 0.5 * s.atr)) < 1e-9);
    assert.ok(s.score >= 0 && s.score <= 100);
  }
});

test('LOOKAHEAD YOK: kesilmiş veride üretilen sinyaller tam verideki sinyallerle birebir aynı', () => {
  const candles = randomWalk(2500, 11);
  for (const params of [baseParams(), { ...baseParams(), useHidden: true, useTrendFilter: true }]) {
    const full = generateSignals(candles, params).signals;
    for (const k of [400, 900, 1500, 2100]) {
      const part = generateSignals(candles.slice(0, k), params).signals.filter((s) => !s.pending);
      const expected = full.filter((s) => s.entryIndex < k);
      assert.equal(part.length, expected.length, `k=${k} sinyal sayısı`);
      part.forEach((s, i) => {
        const e = expected[i];
        assert.equal(s.type, e.type);
        assert.equal(s.confirmIndex, e.confirmIndex);
        assert.equal(s.entry, e.entry);
        assert.equal(s.sl, e.sl);
        assert.equal(s.score, e.score);
      });
    }
  }
});
