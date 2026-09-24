const test = require('node:test');
const assert = require('node:assert/strict');
const { CD, randomWalk } = require('./helpers.js');
const { runBacktest, randomizeSignals, mulberry32, splitRange, runControl } = CD.backtest;

const opts = (o = {}) => ({ capital: 10000, riskPct: 1, feePct: 0, slippagePct: 0, partialAtTp1: false, moveSlToBe: false, exitTarget: 'tp2', maxLeverage: 10, barMs: 60e3, ...o });
const bar = (t, o, h, l, c) => ({ time: t * 60e3, open: o, high: h, low: l, close: c });
const buySig = (entryIndex, entry = 100) => ({ type: 'BUY', kind: 'regular', entryIndex, entry, sl: 90, tp1: 115, tp2: 130, score: 50 });

test('Aynı mumda hem TP hem SL görülürse SL kabul edilir', () => {
  const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 140, 85, 100)];
  const r = runBacktest([{ coin: 'X', candles, signals: [buySig(1)] }], opts());
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].reason, 'SL');
  assert.ok(Math.abs(r.trades[0].r + 1) < 1e-9, 'kayıp −1R olmalı');
  assert.ok(Math.abs(r.finalEquity - 9900) < 1e-6);
});

test('TP2 vurulunca +3R', () => {
  const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 105, 95, 104), bar(2, 104, 131, 103, 125)];
  const r = runBacktest([{ coin: 'X', candles, signals: [buySig(1)] }], opts());
  assert.equal(r.trades[0].reason, 'TP2');
  assert.ok(Math.abs(r.trades[0].r - 3) < 1e-9);
});

test("TP1'de yarım kapat + SL girişe: kalan girişte kapanırsa +0.75R", () => {
  const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 105, 96, 104), bar(2, 104, 116, 103, 110), bar(3, 110, 111, 99, 100)];
  const r = runBacktest([{ coin: 'X', candles, signals: [buySig(1)] }], opts({ partialAtTp1: true, moveSlToBe: true }));
  assert.equal(r.trades[0].reason, 'TP1+BE');
  assert.ok(Math.abs(r.trades[0].r - 0.75) < 1e-9);
});

test('Coin başına tek pozisyon: açık pozisyon varken yeni sinyal atlanır', () => {
  const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 100), bar(3, 100, 131, 99, 130)];
  const r = runBacktest([{ coin: 'X', candles, signals: [buySig(1), buySig(2)] }], opts());
  assert.equal(r.trades.length, 1);
});

test('Komisyon ve slippage sonucu kötüleştirir', () => {
  const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 105, 95, 104), bar(2, 104, 131, 103, 125)];
  const clean = runBacktest([{ coin: 'X', candles, signals: [buySig(1)] }], opts()).finalEquity;
  const costly = runBacktest([{ coin: 'X', candles, signals: [buySig(1)] }], opts({ feePct: 0.1, slippagePct: 0.05 })).finalEquity;
  assert.ok(costly < clean);
});

test('Rastgele kontrol: seviyeler giriş etrafında aynalanır, risk mesafesi korunur', () => {
  const rng = mulberry32(1);
  const sigs = Array.from({ length: 200 }, (_, i) => buySig(i));
  const ctrl = randomizeSignals(sigs, rng);
  const flipped = ctrl.filter((s) => s.type === 'SELL');
  assert.ok(flipped.length > 60 && flipped.length < 140, 'yaklaşık yarısı yön değiştirmeli');
  for (const s of flipped) {
    assert.equal(s.sl, 110);
    assert.equal(s.tp1, 85);
    assert.equal(s.tp2, 70);
    assert.equal(s.entryIndex, sigs[0].entryIndex + ctrl.indexOf(s));
  }
});

test('splitRange: %60 / %40', () => {
  const s = splitRange(0, 1000, 0.6);
  assert.deepEqual(s, { dev: [0, 600], test: [600, 1000] });
});

test('Uçtan uca: gerçekçi rastgele veriyle backtest + kontrol çalışır', () => {
  const candles = randomWalk(4000, 3);
  const { signals } = CD.signals.generateSignals(candles, CD.config.STRATEGY);
  const ds = [{ coin: 'X', candles, signals }];
  const o = opts({ feePct: 0.1, slippagePct: 0.05, partialAtTp1: true, moveSlToBe: true, maxLeverage: 1, barMs: 15 * 60e3 });
  const r = runBacktest(ds, o);
  assert.ok(r.trades.length > 0);
  assert.ok(Number.isFinite(r.metrics.totalReturn));
  assert.ok(r.metrics.maxDrawdown >= 0 && r.metrics.maxDrawdown <= 100);
  const c = runControl(ds, o, 10, 42, r.metrics.totalReturn);
  assert.equal(c.runs, 10);
  assert.ok(c.percentile >= 0 && c.percentile <= 100);
  // Kontrol aynı giriş mumlarını kullanır → işlem sayısı aynı büyüklükte olmalı
  assert.ok(Math.abs(c.median.trades - r.metrics.trades) <= r.metrics.trades);
});
