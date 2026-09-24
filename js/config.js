/*
 * config.js — Sitenin tüm ayarları burada.
 * Coin listesini, veri kaynağını ve strateji/backtest varsayılanlarını buradan değiştirin.
 */
(function (root) {
  'use strict';

  const CONFIG = {
    // Veri kaynağı:
    //  'direct' → tarayıcı OKX API'sine doğrudan istek atar
    //  'static' → GitHub Actions'ın /data klasörüne yazdığı JSON dosyalarını okur
    //  'auto'   → önce doğrudan dener, ağ/CORS hatasında otomatik olarak 'static'e geçer
    DATA_SOURCE: 'auto',

    OKX_BASE: 'https://www.okx.com',
    STATIC_DATA_PATH: 'data/', // göreli yol → /REPO_ADI/ alt dizininde sorunsuz çalışır

    QUOTE: 'USDT',
    COINS: ['BTC', 'ETH', 'XRP', 'AVAX', 'SOL', 'BNB', 'DOGE', 'ADA', 'LINK', 'DOT', 'LTC', 'TRX', 'TON', 'NEAR', 'SUI'],

    TIMEFRAMES: ['15m', '4H', '1D'],
    BAR_MS: { '15m': 15 * 60e3, '1H': 60 * 60e3, '4H': 4 * 3600e3, '1D': 24 * 3600e3 },

    CANDLE_LIMIT: 300, // /market/candles için OKX üst sınırı 300

    // Otomatik yenileme aralıkları (ms)
    REFRESH_MS: { '15m': 60e3, '4H': 5 * 60e3, '1D': 15 * 60e3 },

    // Rate limit'e takılmamak için istekler arası bekleme (ms)
    REQUEST_DELAY_MS: 120,
    HISTORY_DELAY_MS: 160,
    MAX_RETRIES: 3,

    // Strateji varsayılanları (sinyal paneli ve backtest aynı değerleri kullanır)
    STRATEGY: {
      rsiPeriod: 14,
      pivotLeft: 5,
      pivotRight: 5,
      minBars: 5, // iki pivot arası en az mum
      maxBars: 60, // iki pivot arası en fazla mum
      bullRsiMax: 40, // pozitif uyumsuzlukta 2. dipte RSI bu değerin altında olmalı
      bearRsiMin: 60, // negatif uyumsuzlukta 2. tepede RSI bu değerin üstünde olmalı
      useHidden: false, // gizli uyumsuzluklar
      hiddenBullRsiMax: 50,
      hiddenBearRsiMin: 50,
      useTrendFilter: false, // EMA 200 trend filtresi
      emaPeriod: 200,
      atrPeriod: 14,
      atrMult: 0.5, // SL tamponu = 0.5 × ATR
      tp1R: 1.5,
      tp2R: 3,
    },

    // Backtest varsayılanları
    BACKTEST: {
      capital: 10000,
      riskPct: 1,
      feePct: 0.1,
      slippagePct: 0.05,
      partialAtTp1: true, // TP1'de pozisyonun yarısını kapat
      moveSlToBe: true, // TP1 sonrası SL'i girişe çek
      exitTarget: 'tp2', // yarım kapatma kapalıysa tam çıkış hedefi: 'tp1' | 'tp2'
      maxLeverage: 1, // pozisyon büyüklüğü sermayenin bu katını aşamaz
      devRatio: 0.6, // ilk %60 geliştirme, son %40 test
      controlRuns: 50, // rastgele yönlü kontrol koşusu sayısı
      seed: 42,
      warmupBars: 300, // göstergelerin ısınması için başlangıçtan önce çekilecek mum
      maxCandles: 20000, // coin başına en fazla mum (tarayıcıyı korumak için)
    },
  };

  root.CD = root.CD || {};
  root.CD.config = CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
