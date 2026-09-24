/*
 * okx.js — OKX Public API istemcisi + veri kaynağı katmanı.
 *
 * OKX mumları [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] biçiminde ve
 * YENİDEN ESKİYE sıralı döndürür. Burada eskiden yeniye sıralanır.
 * confirm = '0' → mum henüz kapanmadı (sinyal hesabına katılmaz).
 */
(function (root) {
  'use strict';

  const cfg = (root.CD && root.CD.config) || (typeof require !== 'undefined' ? require('./config.js') : {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class ApiError extends Error {
    constructor(message, { network = false, status = 0, code = null } = {}) {
      super(message);
      this.name = 'ApiError';
      this.network = network; // true → ağ/CORS hatası (yanıt alınamadı)
      this.status = status;
      this.code = code;
    }
  }

  const instId = (coin) => `${coin}-${cfg.QUOTE || 'USDT'}`;

  // Ham OKX satırlarını nesneye çevir ve eskiden yeniye sırala
  function parseCandles(rows) {
    return rows
      .map((r) => ({
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        confirm: r[8] === undefined ? 1 : Number(r[8]),
      }))
      .sort((a, b) => a.time - b.time);
  }

  // Aynı zamana sahip mumları tekilleştir (sonraki kazanır) ve sırala
  function mergeCandles(...lists) {
    const m = new Map();
    lists.flat().forEach((c) => m.set(c.time, c));
    return [...m.values()].sort((a, b) => a.time - b.time);
  }

  // Yeniden denemeli GET isteği (üstel bekleme). Rate limit (50011) ve 5xx yeniden denenir.
  async function request(path, params = {}, opts = {}) {
    const base = opts.base || cfg.OKX_BASE;
    const retries = opts.retries ?? cfg.MAX_RETRIES ?? 3;
    const qs = new URLSearchParams(params).toString();
    const url = `${base}${path}${qs ? '?' + qs : ''}`;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
      let res;
      try {
        res = await fetch(url, { signal: opts.signal });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        // fetch'in TypeError fırlatması genelde CORS veya ağ bağlantısı sorunudur
        lastErr = new ApiError(`OKX'e bağlanılamadı (ağ/CORS): ${e.message}`, { network: true });
        // CORS hatası kalıcıdır; 'auto' modda yedeğe hızlı geçmek için ağ hatası denemeleri sınırlanabilir
        if (opts.networkRetries != null && attempt >= opts.networkRetries) break;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ApiError(`OKX HTTP ${res.status} (yoğunluk/sunucu hatası)`, { status: res.status });
        continue;
      }
      let json;
      try {
        json = await res.json();
      } catch (e) {
        lastErr = new ApiError(`OKX yanıtı okunamadı (HTTP ${res.status})`, { status: res.status });
        continue;
      }
      if (json.code === '0') return json.data;
      lastErr = new ApiError(`OKX hata ${json.code}: ${json.msg || 'bilinmeyen hata'}`, { status: res.status, code: json.code });
      if (json.code !== '50011' && json.code !== '50013') break; // kalıcı hata → tekrar deneme
    }
    throw lastErr;
  }

  // Güncel mumlar (en fazla 300)
  async function getCandles(inst, bar, limit = cfg.CANDLE_LIMIT || 300, opts) {
    const data = await request('/api/v5/market/candles', { instId: inst, bar, limit: String(limit) }, opts);
    return parseCandles(data);
  }

  // Geçmiş mumlar: `after` ile geriye doğru sayfalama (istek başına 100 mum).
  // onProgress(oran 0..1) ilerleme çubuğu için çağrılır.
  async function getHistoryCandles(inst, bar, startMs, endMs, opts = {}) {
    const barMs = cfg.BAR_MS[bar];
    const totalPages = Math.max(1, Math.ceil((endMs - startMs) / barMs / 100));
    let after = endMs + barMs; // bu zamandan daha eski kayıtlar gelir
    let all = [];
    let page = 0;
    const maxBars = opts.maxBars || Infinity;
    while (true) {
      const data = await request('/api/v5/market/history-candles', { instId: inst, bar, after: String(after), limit: '100' }, opts);
      page++;
      if (!data.length) break;
      const rows = parseCandles(data);
      all = rows.concat(all);
      const oldest = rows[0].time;
      if (opts.onProgress) opts.onProgress(Math.min(page / totalPages, 1));
      if (oldest <= startMs || all.length >= maxBars || oldest >= after) break;
      after = oldest;
      await sleep(cfg.HISTORY_DELAY_MS || 150); // rate limit koruması
    }
    return mergeCandles(all).filter((c) => c.time >= startMs && c.time <= endMs);
  }

  // OKX'te listelenen SPOT çiftleri
  async function getSpotInstruments(opts) {
    const data = await request('/api/v5/public/instruments', { instType: 'SPOT' }, opts);
    return new Set(data.filter((d) => d.state === 'live').map((d) => d.instId));
  }

  // Coin listesindeki her çiftin OKX'te listelenip listelenmediğini kontrol et
  async function checkListedPairs(coins = cfg.COINS, opts) {
    const set = await getSpotInstruments(opts);
    const listed = [];
    const missing = [];
    coins.forEach((c) => (set.has(instId(c)) ? listed : missing).push(c));
    return { listed, missing };
  }

  /* ---------------- Veri kaynağı katmanı (direct / static / auto) ---------------- */

  // Statik JSON biçimi: { instId, bar, updated, candles: [[t,o,h,l,c,v,confirm], ...] } (eskiden yeniye)
  const staticFile = (coin, bar) => `${cfg.STATIC_DATA_PATH}${instId(coin)}_${bar}.json`;

  async function loadStatic(coin, bar) {
    const url = staticFile(coin, bar) + `?t=${Date.now()}`; // tarayıcı önbelleğini atla
    let res;
    try {
      res = await fetch(url, { cache: 'no-store' });
    } catch (e) {
      throw new ApiError(`Yedek veri dosyası okunamadı: ${e.message}`, { network: true });
    }
    if (!res.ok) throw new ApiError(`Yedek veri bulunamadı (${res.status}): ${staticFile(coin, bar)}`, { status: res.status });
    const j = await res.json();
    return {
      updated: j.updated,
      candles: j.candles.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], confirm: r[6] ?? 1 })),
    };
  }

  // 'auto' modda ağ hatasında yalnızca 1 kez yeniden dene, sonra yedeğe geç
  const directOpts = (opts) => (cfg.DATA_SOURCE === 'auto' ? { networkRetries: 1, ...opts } : opts);

  const source = {
    mode: cfg.DATA_SOURCE === 'static' ? 'static' : 'direct',
    requested: cfg.DATA_SOURCE,
    fallbackReason: null,
    listeners: [],
    onChange(fn) {
      this.listeners.push(fn);
    },
    // 'auto' modunda ağ/CORS hatasında yedeğe geç
    // (Eşzamanlı istekler: başka bir istek zaten yedeğe geçirdiyse bu hata da yedekle karşılanır.)
    _fallback(err) {
      if (this.requested !== 'auto' || !err || !err.network) return false;
      if (this.mode === 'direct') {
        this.mode = 'static';
        this.fallbackReason = err.message;
        this.listeners.forEach((f) => f(this.mode, err));
      }
      return true;
    },
    // Tüm mumlar (son mum kapanmamış olabilir; confirm alanına bakın)
    async loadCandles(coin, bar, opts) {
      if (this.mode === 'direct') {
        try {
          const candles = await getCandles(instId(coin), bar, cfg.CANDLE_LIMIT, directOpts(opts));
          return { candles, updated: Date.now(), source: 'direct' };
        } catch (e) {
          if (!this._fallback(e)) throw e;
        }
      }
      const s = await loadStatic(coin, bar);
      return { candles: s.candles, updated: s.updated, source: 'static' };
    },
    // Backtest için tarih aralığı
    async loadHistory(coin, bar, startMs, endMs, opts = {}) {
      if (this.mode === 'direct') {
        try {
          const candles = await getHistoryCandles(instId(coin), bar, startMs, endMs, directOpts(opts));
          return { candles, source: 'direct' };
        } catch (e) {
          if (!this._fallback(e)) throw e;
        }
      }
      const s = await loadStatic(coin, bar);
      if (opts.onProgress) opts.onProgress(1);
      const candles = s.candles.filter((c) => c.time >= startMs && c.time <= endMs && c.confirm !== 0);
      return { candles, source: 'static', coveredFrom: s.candles.length ? s.candles[0].time : null };
    },
    async checkListed(coins) {
      if (this.mode === 'direct') {
        try {
          return await checkListedPairs(coins, directOpts());
        } catch (e) {
          if (!this._fallback(e)) throw e;
        }
      }
      const res = await fetch(`${cfg.STATIC_DATA_PATH}instruments.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new ApiError('instruments.json bulunamadı');
      const j = await res.json();
      const set = new Set(j.listed || []);
      const listed = [];
      const missing = [];
      coins.forEach((c) => (set.has(instId(c)) ? listed : missing).push(c));
      return { listed, missing };
    },
  };

  const api = { ApiError, instId, parseCandles, mergeCandles, request, getCandles, getHistoryCandles, getSpotInstruments, checkListedPairs, source, sleep };
  root.CD = root.CD || {};
  root.CD.okx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
