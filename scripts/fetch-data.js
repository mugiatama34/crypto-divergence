/*
 * fetch-data.js — YEDEK VERİ YÖNTEMİ.
 * GitHub Actions (fetch-data.yml) bu betiği 15 dakikada bir çalıştırır:
 * OKX'ten mumları çeker, /data klasörüne JSON olarak yazar. Site, config.js'de
 * DATA_SOURCE 'static' (veya 'auto' + CORS hatası) olduğunda bu dosyaları okur.
 *
 * Çalıştırma: node scripts/fetch-data.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const cfg = require('../js/config.js');
const okx = require('../js/okx.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
// Dosya başına saklanacak en fazla mum (repo şişmesin diye sınırlı)
const MAX_BARS = { '15m': 1500, '4H': 1500, '1D': 1500 };
// Bir çalıştırmada geçmişi doldurmak için en fazla sayfa (100 mum/sayfa)
const MAX_BACKFILL_PAGES = 15;

const toRow = (c) => [c.time, c.open, c.high, c.low, c.close, c.volume, c.confirm];
const fromRow = (r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], confirm: r[6] ?? 1 });

function readExisting(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j.candles.map(fromRow);
  } catch {
    return [];
  }
}

async function backfill(inst, bar, oldestTime, needed) {
  // `after` ile geriye doğru sayfalama
  let after = oldestTime;
  let out = [];
  for (let page = 0; page < MAX_BACKFILL_PAGES && out.length < needed; page++) {
    const data = await okx.request('/api/v5/market/history-candles', { instId: inst, bar, after: String(after), limit: '100' });
    if (!data.length) break;
    const rows = okx.parseCandles(data);
    out = rows.concat(out);
    after = rows[0].time;
    await okx.sleep(cfg.HISTORY_DELAY_MS);
  }
  return out;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const errors = [];

  // 1) Listelenen çiftleri kontrol et
  try {
    const set = await okx.getSpotInstruments();
    const listed = cfg.COINS.map(okx.instId).filter((i) => set.has(i));
    const missing = cfg.COINS.map(okx.instId).filter((i) => !set.has(i));
    fs.writeFileSync(path.join(DATA_DIR, 'instruments.json'), JSON.stringify({ listed, missing }) + '\n');
    if (missing.length) console.warn('OKX\'te listelenmeyen çiftler:', missing.join(', '));
  } catch (e) {
    errors.push(`instruments: ${e.message}`);
  }

  // 2) Her coin × zaman dilimi için mumları çek ve birleştir
  for (const coin of cfg.COINS) {
    const inst = okx.instId(coin);
    for (const bar of cfg.TIMEFRAMES) {
      const file = path.join(DATA_DIR, `${inst}_${bar}.json`);
      try {
        const existing = readExisting(file);
        const latest = await okx.getCandles(inst, bar, 300);
        let merged = okx.mergeCandles(existing, latest);
        const cap = MAX_BARS[bar] || 1500;
        if (merged.length < cap && merged.length) {
          const older = await backfill(inst, bar, merged[0].time, cap - merged.length);
          merged = okx.mergeCandles(older, merged);
        }
        merged = merged.slice(-cap);
        const body = JSON.stringify({ instId: inst, bar, updated: Date.now(), candles: merged.map(toRow) });
        fs.writeFileSync(file, body + '\n');
        console.log(`${inst} ${bar}: ${merged.length} mum`);
      } catch (e) {
        errors.push(`${inst} ${bar}: ${e.message}`);
        console.error(`${inst} ${bar}: ${e.message}`);
      }
      await okx.sleep(cfg.REQUEST_DELAY_MS);
    }
  }

  fs.writeFileSync(path.join(DATA_DIR, 'meta.json'), JSON.stringify({ updated: Date.now(), errors }, null, 1) + '\n');
  const total = cfg.COINS.length * cfg.TIMEFRAMES.length;
  if (errors.length >= total) {
    console.error('Hiç veri alınamadı.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
