// Testler için ortak yardımcılar: modülleri doğru sırayla yükler, sentetik mum üretir.
require('../js/config.js');
require('../js/indicators.js');
require('../js/divergence.js');
require('../js/signals.js');
require('../js/backtest.js');

const CD = globalThis.CD;

// Tekrarlanabilir rastgele yürüyüş mumları
function randomWalk(n, seed = 1, start = 100, barMs = 15 * 60e3) {
  const rng = CD.backtest.mulberry32(seed);
  const out = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const open = px;
    const drift = (rng() - 0.5) * 0.02 * px;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) * (1 + rng() * 0.006);
    const low = Math.min(open, close) * (1 - rng() * 0.006);
    out.push({ time: 1.7e12 + i * barMs, open, high, low, close, volume: 1, confirm: 1 });
    px = close;
  }
  return out;
}

// Verilen kapanış serisinden basit mumlar
function fromCloses(closes, barMs = 60e3) {
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { time: i * barMs, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1, confirm: 1 };
  });
}

module.exports = { CD, randomWalk, fromCloses };
