/*
 * backtest.js — Olay sıralı (event-driven) backtest motoru.
 *
 * Kurallar:
 *  - Coin başına aynı anda tek pozisyon; pozisyon açıkken gelen sinyal atlanır.
 *  - Giriş: sinyalin entryIndex mumunun açılışı (+ slippage).
 *  - Aynı mumda hem TP hem SL görülürse SL kabul edilir (muhafazakâr varsayım).
 *  - İsteğe bağlı: TP1'de yarım kapat, SL'i girişe çek; kalan TP2'de kapanır.
 *  - SELL sinyalleri kısa (short) pozisyon olarak simüle edilir.
 *  - Aralık sonunda açık pozisyon son kapanıştan kapatılır ('END').
 *  - Pozisyon büyüklüğü: gerçekleşmiş sermaye × risk% / birim risk
 *    (nominal değer sermaye × maxLeverage ile sınırlı).
 */
(function (root) {
  'use strict';

  // Tekrarlanabilir rastgelelik için küçük PRNG (mulberry32)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // RASTGELE YÖNLÜ KONTROL: aynı mumlarda, aynı SL/TP geometrisiyle yazı-tura yönü.
  // Yön değişirse tüm seviyeler giriş fiyatı etrafında aynalanır (risk mesafesi ve R katları korunur).
  function randomizeSignals(signals, rng) {
    return signals.map((s) => {
      const flip = rng() < 0.5;
      if (!flip) return { ...s, control: true };
      const m = (x) => 2 * s.entry - x;
      return {
        ...s,
        control: true,
        type: s.type === 'BUY' ? 'SELL' : 'BUY',
        sl: m(s.sl),
        tp1: m(s.tp1),
        tp2: m(s.tp2),
      };
    });
  }

  /*
   * runBacktest(datasets, opts)
   *  datasets: [{ coin, candles, signals }]
   *  opts: { capital, riskPct, feePct, slippagePct, partialAtTp1, moveSlToBe,
   *          exitTarget, maxLeverage, startMs, endMs, barMs }
   */
  function runBacktest(datasets, opts) {
    const o = opts;
    const fee = o.feePct / 100;
    const slip = o.slippagePct / 100;
    const startMs = o.startMs ?? -Infinity;
    const endMs = o.endMs ?? Infinity;

    // Her coin için: zaman → indeks eşlemesi ve entryIndex → sinyal eşlemesi
    const states = datasets.map((d) => {
      const byEntry = new Map();
      for (const s of d.signals) {
        if (s.pending || s.invalid) continue;
        const c = d.candles[s.entryIndex];
        if (!c || c.time < startMs || c.time >= endMs) continue;
        if (!byEntry.has(s.entryIndex)) byEntry.set(s.entryIndex, s);
      }
      const idxByTime = new Map();
      d.candles.forEach((c, i) => {
        if (c.time >= startMs && c.time < endMs) idxByTime.set(c.time, i);
      });
      return { coin: d.coin, candles: d.candles, byEntry, idxByTime, pos: null, lastIdx: -1 };
    });

    // Tüm coinlerin mum zamanlarını birleştir (ortak zaman ekseni)
    const timeSet = new Set();
    states.forEach((st) => st.idxByTime.forEach((_, t) => timeSet.add(t)));
    const times = [...timeSet].sort((a, b) => a - b);

    let cash = o.capital;
    const trades = [];
    const equity = [];

    const entryFill = (dir, px) => (dir === 'BUY' ? px * (1 + slip) : px * (1 - slip));
    const exitFill = (dir, px) => (dir === 'BUY' ? px * (1 - slip) : px * (1 + slip));

    // Pozisyonun bir kısmını kapat
    function closePart(st, qty, rawPx, time) {
      const pos = st.pos;
      const px = exitFill(pos.dir, rawPx);
      const pnl = pos.dir === 'BUY' ? (px - pos.entryPx) * qty : (pos.entryPx - px) * qty;
      const f = px * qty * fee;
      cash += pnl - f;
      pos.realized += pnl;
      pos.fees += f;
      pos.qty -= qty;
      pos.exitValue += px * qty;
      pos.exitQty += qty;
      pos.lastExitTime = time;
    }

    function finish(st, reason) {
      const pos = st.pos;
      const net = pos.realized - pos.fees;
      trades.push({
        coin: st.coin,
        dir: pos.dir,
        kind: pos.sig.kind,
        score: pos.sig.score,
        entryTime: pos.entryTime,
        entryPrice: pos.entryPx,
        sl: pos.initSl,
        tp1: pos.sig.tp1,
        tp2: pos.sig.tp2,
        exitTime: pos.lastExitTime,
        exitPrice: pos.exitValue / pos.exitQty,
        qty: pos.qty0,
        fees: pos.fees,
        pnl: net,
        pnlPct: (net / pos.equityAtEntry) * 100,
        r: net / pos.riskAmount,
        reason: pos.tp1Done && reason !== 'TP2' && reason !== 'END' ? 'TP1+' + reason : reason,
      });
      st.pos = null;
    }

    function openPos(st, sig, c, time) {
      const px = entryFill(sig.type, c.open);
      const riskPerUnit = sig.type === 'BUY' ? px - sig.sl : sig.sl - px;
      if (!(riskPerUnit > 0) || cash <= 0) return;
      let qty = (cash * (o.riskPct / 100)) / riskPerUnit;
      const maxQty = (cash * (o.maxLeverage || 1)) / px;
      if (qty > maxQty) qty = maxQty;
      if (!(qty > 0)) return;
      const f = px * qty * fee;
      cash -= f;
      st.pos = {
        sig,
        dir: sig.type,
        entryPx: px,
        entryTime: time,
        sl: sig.sl,
        initSl: sig.sl,
        qty,
        qty0: qty,
        riskAmount: riskPerUnit * qty,
        equityAtEntry: cash + f,
        tp1Done: false,
        realized: 0,
        fees: f,
        exitValue: 0,
        exitQty: 0,
        lastExitTime: time,
      };
    }

    // Açık pozisyonu bir mumla yönet
    function manage(st, c, time) {
      const pos = st.pos;
      const isBuy = pos.dir === 'BUY';
      const touches = (lvl, favorable) =>
        favorable ? (isBuy ? c.high >= lvl : c.low <= lvl) : isBuy ? c.low <= lvl : c.high >= lvl;
      // Boşluklu açılışta (gap) SL açılış fiyatından gerçekleşir
      const slPx = () => (isBuy ? Math.min(pos.sl, c.open) : Math.max(pos.sl, c.open));

      // 1) SL önce kontrol edilir: aynı mumda TP de görülse SL kabul edilir
      if (touches(pos.sl, false)) {
        const reason = pos.tp1Done && pos.sl === pos.entryPx ? 'BE' : 'SL';
        closePart(st, pos.qty, slPx(), time);
        return finish(st, reason);
      }

      if (o.partialAtTp1) {
        if (!pos.tp1Done && touches(pos.sig.tp1, true)) {
          closePart(st, pos.qty / 2, pos.sig.tp1, time);
          pos.tp1Done = true;
          if (o.moveSlToBe) pos.sl = pos.entryPx;
          // Aynı mumda yeni SL'e (girişe) de dokunulduysa muhafazakâr olarak stop kabul et
          if (touches(pos.sl, false)) {
            closePart(st, pos.qty, pos.sl, time);
            return finish(st, o.moveSlToBe ? 'BE' : 'SL');
          }
        }
        if (pos.tp1Done && touches(pos.sig.tp2, true)) {
          closePart(st, pos.qty, pos.sig.tp2, time);
          return finish(st, 'TP2');
        }
      } else {
        const target = o.exitTarget === 'tp1' ? pos.sig.tp1 : pos.sig.tp2;
        if (touches(target, true)) {
          closePart(st, pos.qty, target, time);
          return finish(st, o.exitTarget === 'tp1' ? 'TP1' : 'TP2');
        }
      }
    }

    for (const t of times) {
      for (const st of states) {
        const i = st.idxByTime.get(t);
        if (i === undefined) continue;
        const c = st.candles[i];
        st.lastIdx = i;
        if (!st.pos) {
          const sig = st.byEntry.get(i);
          if (sig) openPos(st, sig, c, t);
        }
        if (st.pos) manage(st, c, t);
      }
      // Piyasa değerine göre (mark-to-market) sermaye
      let eq = cash;
      for (const st of states) {
        if (st.pos && st.lastIdx >= 0) {
          const px = st.candles[st.lastIdx].close;
          const p = st.pos;
          eq += p.dir === 'BUY' ? (px - p.entryPx) * p.qty : (p.entryPx - px) * p.qty;
        }
      }
      equity.push({ time: t, value: eq });
    }

    // Aralık sonunda açık kalan pozisyonları kapat
    for (const st of states) {
      if (st.pos) {
        const c = st.candles[st.lastIdx];
        closePart(st, st.pos.qty, c.close, c.time);
        finish(st, 'END');
      }
    }
    if (equity.length) equity[equity.length - 1] = { time: equity[equity.length - 1].time, value: cash };

    trades.sort((a, b) => a.exitTime - b.exitTime);
    return { trades, equity, finalEquity: cash, metrics: computeMetrics(trades, equity, o.capital, o.barMs) };
  }

  // Performans metrikleri
  function computeMetrics(trades, equity, capital, barMs) {
    const n = trades.length;
    const final = equity.length ? equity[equity.length - 1].value : capital;
    const wins = trades.filter((t) => t.pnl > 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = trades.filter((t) => t.pnl <= 0).reduce((s, t) => s - t.pnl, 0);

    // Max drawdown (%)
    let peak = capital;
    let maxDd = 0;
    for (const e of equity) {
      if (e.value > peak) peak = e.value;
      const dd = peak > 0 ? (peak - e.value) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }

    // Sharpe: mum başı getirilerden, yıllıklandırılmış (risksiz faiz = 0)
    let sharpe = 0;
    if (equity.length > 2 && barMs > 0) {
      const rets = [];
      let prev = capital;
      for (const e of equity) {
        rets.push(prev > 0 ? e.value / prev - 1 : 0);
        prev = e.value;
      }
      const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1));
      const perYear = (365 * 24 * 3600e3) / barMs;
      sharpe = sd > 0 ? (mean / sd) * Math.sqrt(perYear) : 0;
    }

    // En uzun kayıp serisi
    let streak = 0;
    let maxStreak = 0;
    for (const t of trades) {
      streak = t.pnl <= 0 ? streak + 1 : 0;
      if (streak > maxStreak) maxStreak = streak;
    }

    return {
      totalReturn: ((final - capital) / capital) * 100,
      trades: n,
      winRate: n ? (wins.length / n) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      avgR: n ? trades.reduce((s, t) => s + t.r, 0) / n : 0,
      maxDrawdown: maxDd * 100,
      sharpe,
      maxLossStreak: maxStreak,
    };
  }

  function median(arr) {
    const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    if (!a.length) return NaN;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // Rastgele yönlü kontrolü N kez koştur; metriklerin medyanını ve stratejinin
  // toplam getiride kontrollerin yüzde kaçını geçtiğini döndür.
  function runControl(datasets, opts, runs, seed, strategyReturn) {
    const all = [];
    for (let k = 0; k < runs; k++) {
      const rng = mulberry32(seed + k * 7919);
      const ds = datasets.map((d) => ({ ...d, signals: randomizeSignals(d.signals, rng) }));
      all.push(runBacktest(ds, opts).metrics);
    }
    const keys = Object.keys(all[0] || {});
    const med = {};
    keys.forEach((k) => (med[k] = median(all.map((m) => m[k]))));
    const beaten = all.filter((m) => strategyReturn > m.totalReturn).length;
    return { median: med, runs, percentile: runs ? (beaten / runs) * 100 : NaN, all };
  }

  // Zaman aralığını geliştirme (ilk %60) ve test (son %40) olarak böl
  function splitRange(startMs, endMs, ratio) {
    const mid = Math.round(startMs + (endMs - startMs) * ratio);
    return { dev: [startMs, mid], test: [mid, endMs] };
  }

  function tradesToCsv(trades) {
    const cols = ['segment', 'coin', 'dir', 'kind', 'score', 'entryTime', 'entryPrice', 'sl', 'tp1', 'tp2', 'exitTime', 'exitPrice', 'qty', 'fees', 'pnl', 'pnlPct', 'r', 'reason'];
    const iso = (ms) => new Date(ms).toISOString();
    const lines = [cols.join(',')];
    for (const t of trades) {
      lines.push(
        cols
          .map((c) => {
            const v = t[c];
            if (c === 'entryTime' || c === 'exitTime') return iso(v);
            if (typeof v === 'number') return Number.isFinite(v) ? +v.toPrecision(10) : '';
            return v == null ? '' : String(v);
          })
          .join(',')
      );
    }
    return lines.join('\n');
  }

  const api = { runBacktest, computeMetrics, randomizeSignals, runControl, splitRange, tradesToCsv, mulberry32, median };
  root.CD = root.CD || {};
  root.CD.backtest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
