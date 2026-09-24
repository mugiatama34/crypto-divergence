const test = require('node:test');
const assert = require('node:assert/strict');
const { CD } = require('./helpers.js');
const { rsi, ema, atr, trueRange } = CD.indicators;

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);

// StockCharts'ın klasik tablosu ara değerleri yuvarlar (70.53, 66.32, ...);
// yuvarlamasız tam Wilder hesabı aşağıdaki değerleri verir.
test('RSI: Wilder referans örneği (StockCharts verisi, tam hesap)', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
  const r = rsi(closes, 14);
  for (let i = 0; i < 14; i++) assert.equal(r[i], null, `index ${i} null olmalı`);
  close(r[14], 70.464, 0.01, 'RSI[14]');
  close(r[15], 66.250, 0.01, 'RSI[15]');
  close(r[16], 66.481, 0.01, 'RSI[16]');
  close(r[17], 69.347, 0.01, 'RSI[17]');
  close(r[18], 66.295, 0.01, 'RSI[18]');
  close(r[19], 57.915, 0.01, 'RSI[19]');
});

test('RSI: sürekli yükselişte 100, sürekli düşüşte 0, düz seride 50', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  const flat = Array.from({ length: 30 }, () => 100);
  assert.equal(rsi(up, 14)[29], 100);
  assert.equal(rsi(down, 14)[29], 0);
  assert.equal(rsi(flat, 14)[29], 50);
});

test('RSI: nedensel — gelecek veri geçmiş değerleri değiştirmez', () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
  const full = rsi(closes, 14);
  const part = rsi(closes.slice(0, 50), 14);
  for (let i = 0; i < 50; i++) assert.equal(part[i], full[i]);
});

test('EMA: SMA ile başlar ve doğru yumuşatır', () => {
  const e = ema([1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(e.slice(0, 2), [null, null]);
  close(e[2], 2, 1e-12, 'EMA[2] = SMA(1,2,3)');
  close(e[3], 3, 1e-12, 'EMA[3]'); // 4*0.5 + 2*0.5
  close(e[4], 4, 1e-12, 'EMA[4]');
  assert.deepEqual(ema([1, 2], 3), [null, null]);
});

test('ATR: sabit aralıklı mumlarda ATR = aralık, gap TR hesabına girer', () => {
  const candles = Array.from({ length: 20 }, (_, i) => ({ open: 10, high: 11, low: 9, close: 10, time: i }));
  const a = atr(candles, 14);
  assert.equal(a[12], null);
  close(a[13], 2, 1e-12, 'ATR[13]');
  close(a[19], 2, 1e-12, 'ATR[19]');
  const tr = trueRange([
    { high: 11, low: 9, close: 10 },
    { high: 15, low: 14, close: 14.5 },
  ]);
  assert.equal(tr[1], 5); // |15 − 10|
});
