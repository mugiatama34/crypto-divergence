/*
 * ui.js — Arayüz: biçimlendirme, grafikler (Lightweight Charts v4),
 * Sinyal Paneli ve Backtest sayfası kontrolcüleri.
 */
(function (root) {
  'use strict';

  const CD = root.CD;
  const cfg = CD.config;
  const $ = (sel, el = document) => el.querySelector(sel);

  /* ---------------- Biçimlendirme ---------------- */

  function fmtPrice(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    const d = a >= 1000 ? 2 : a >= 100 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : 7;
    return v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const fmtNum = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : v === Infinity ? '∞' : v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pad = (n) => String(n).padStart(2, '0');
  function fmtTime(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fmtAgo(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'az önce';
    if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
    if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
    return `${Math.floor(s / 86400)} gün önce`;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

  /* ---------------- Ortak UI yardımcıları ---------------- */

  // Hata/uyarı kutusu; retry verilirse "Tekrar dene" düğmesi eklenir
  function showAlert(msg, type = 'error', retry, id) {
    const box = $('#alerts');
    if (id) {
      const old = box.querySelector(`[data-id="${id}"]`);
      if (old) old.remove();
    }
    const div = document.createElement('div');
    div.className = `alert ${type}`;
    if (id) div.dataset.id = id;
    div.innerHTML = `<div style="flex:1">${msg}</div>`;
    if (retry) {
      const b = document.createElement('button');
      b.textContent = 'Tekrar dene';
      b.onclick = () => {
        div.remove();
        retry();
      };
      div.appendChild(b);
    }
    const x = document.createElement('button');
    x.className = 'secondary';
    x.textContent = '×';
    x.onclick = () => div.remove();
    div.appendChild(x);
    box.appendChild(div);
    return div;
  }
  const clearAlert = (id) => {
    const el = $(`#alerts [data-id="${id}"]`);
    if (el) el.remove();
  };

  function updateSourceBadge() {
    const b = $('#sourceBadge');
    if (!b) return;
    const s = CD.okx.source;
    b.textContent = s.mode === 'direct' ? 'Veri: OKX (canlı)' : 'Veri: yedek JSON (GitHub Actions)';
    b.classList.toggle('static', s.mode === 'static');
  }

  function watchSource() {
    updateSourceBadge();
    CD.okx.source.onChange((mode, err) => {
      updateSourceBadge();
      showAlert(
        `Tarayıcıdan OKX'e doğrudan erişilemedi (${esc(err.message)}). Yedek veri yöntemine geçildi: GitHub Actions'ın 15 dakikada bir güncellediği /data dosyaları kullanılıyor.`,
        'warn',
        null,
        'fallback'
      );
    });
  }

  // Coin listesindeki çiftlerin OKX'te listelenip listelenmediğini kontrol et; eksikleri uyar
  function checkListedCoins() {
    return CD.okx.source
      .checkListed(cfg.COINS)
      .then(({ missing }) => {
        if (missing.length) showAlert(`OKX'te listelenmeyen çift(ler): <b>${missing.map((c) => c + '-' + cfg.QUOTE).join(', ')}</b>. Bunlar atlanıyor; config.js'deki COINS listesinden çıkarabilirsiniz.`, 'warn', null, 'missing');
        return missing;
      })
      .catch(() => []);
  }

  /* ---------------- Grafik yardımcıları ---------------- */

  const LW = () => root.LightweightCharts;
  // Lightweight Charts saatleri UTC gösterir; yerel saat için kaydırma yapılır
  const toChartTime = (ms) => Math.floor(ms / 1000) - new Date(ms).getTimezoneOffset() * 60;

  function baseChartOptions() {
    return {
      autoSize: true,
      localization: { locale: 'tr-TR' },
      layout: { background: { type: 'solid', color: '#121725' }, textColor: '#8591ad', fontSize: 11 },
      grid: { vertLines: { color: '#1a2031' }, horzLines: { color: '#1a2031' } },
      rightPriceScale: { borderColor: '#232b40', minimumWidth: 90 },
      timeScale: { borderColor: '#232b40', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    };
  }

  const priceFormat = (candles) => {
    const px = candles.length ? candles[candles.length - 1].close : 1;
    const d = px >= 1000 ? 2 : px >= 100 ? 3 : px >= 1 ? 4 : px >= 0.01 ? 5 : 7;
    return { type: 'price', precision: d, minMove: 1 / 10 ** d };
  };

  const lineOpts = (color, width = 2, style = 0) => ({
    color,
    lineWidth: width,
    lineStyle: style,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
  });

  // İki grafiğin zaman eksenini senkronize et
  function syncCharts(a, b) {
    let lock = false;
    const link = (src, dst) =>
      src.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (lock || !r) return;
        lock = true;
        dst.timeScale().setVisibleLogicalRange(r);
        lock = false;
      });
    link(a, b);
    link(b, a);
  }

  function chartsAvailable() {
    if (LW()) return true;
    showAlert('Grafik kütüphanesi (Lightweight Charts) yüklenemedi. İnternet bağlantınızı veya içerik engelleyicinizi kontrol edin.', 'error', null, 'lw');
    return false;
  }

  /* =====================================================================
   * SİNYAL PANELİ
   * ===================================================================== */

  function initSignalsPage() {
    watchSource();
    const rows = new Map();
    const key = (coin, tf) => `${coin}|${tf}`;
    cfg.COINS.forEach((coin) => cfg.TIMEFRAMES.forEach((tf) => rows.set(key(coin, tf), { coin, tf, loading: true })));

    const f = { tf: $('#fTf'), dir: $('#fDir'), sort: $('#fSort'), only: $('#fOnlySig'), hidden: $('#optHidden'), trend: $('#optTrend') };
    // Filtre tercihlerini hatırla (yalnızca bu tarayıcıda)
    try {
      const saved = JSON.parse(localStorage.getItem('cd.signals.filters') || '{}');
      if (saved.tf) f.tf.value = saved.tf;
      if (saved.dir) f.dir.value = saved.dir;
      if (saved.sort) f.sort.value = saved.sort;
      f.only.checked = !!saved.only;
      f.hidden.checked = saved.hidden ?? cfg.STRATEGY.useHidden;
      f.trend.checked = saved.trend ?? cfg.STRATEGY.useTrendFilter;
    } catch (e) {
      f.hidden.checked = cfg.STRATEGY.useHidden;
      f.trend.checked = cfg.STRATEGY.useTrendFilter;
    }
    const saveFilters = () => {
      try {
        localStorage.setItem('cd.signals.filters', JSON.stringify({ tf: f.tf.value, dir: f.dir.value, sort: f.sort.value, only: f.only.checked, hidden: f.hidden.checked, trend: f.trend.checked }));
      } catch (e) {
        /* depolama kapalı olabilir */
      }
    };
    const params = () => ({ ...cfg.STRATEGY, useHidden: f.hidden.checked, useTrendFilter: f.trend.checked });

    let selectedKey = null;
    let chartState = null;
    const lastUpdate = {};
    const busy = {};
    const unlisted = new Set(); // OKX'te listelenmeyen coinler: istek atılmaz

    // Bir satırın sinyalini ORTAK strateji fonksiyonuyla hesapla
    function compute(row) {
      if (!row.candles) return;
      const all = row.candles;
      const last = all[all.length - 1];
      const forming = last && last.confirm === 0 ? last : null;
      const confirmed = forming ? all.slice(0, -1) : all; // kapanmamış mum sinyale katılmaz
      const p = params();
      const res = CD.signals.generateSignals(confirmed, p);
      let sig = res.signals.length ? res.signals[res.signals.length - 1] : null;
      // Bekleyen sinyal: giriş = oluşmakta olan mumun açılışı
      if (sig && sig.pending && forming) sig = CD.signals.applyEntry(sig, forming.open, p);
      row.res = res;
      row.signals = res.signals;
      row.signal = sig && !sig.invalid ? sig : null;
      row.status = row.signal ? CD.signals.trackSignal(all, row.signal) : null;
      row.price = last ? last.close : null;
      row.confirmedCount = confirmed.length;
    }

    async function loadTf(tf) {
      if (busy[tf]) return;
      busy[tf] = true;
      const errors = [];
      for (const coin of cfg.COINS) {
        const row = rows.get(key(coin, tf));
        if (unlisted.has(coin)) {
          row.loading = false;
          row.unlisted = true;
          continue;
        }
        row.loading = true;
        try {
          const r = await CD.okx.source.loadCandles(coin, tf);
          row.candles = r.candles;
          row.updated = r.updated;
          row.error = null;
          compute(row);
        } catch (e) {
          row.error = e.message;
          errors.push(`${coin} ${tf}: ${e.message}`);
        }
        row.loading = false;
        render();
        if (selectedKey === key(coin, tf)) drawChart(row, true);
        await CD.okx.sleep(cfg.REQUEST_DELAY_MS);
      }
      lastUpdate[tf] = Date.now();
      busy[tf] = false;
      if (errors.length) {
        showAlert(
          `${errors.length} veri isteği başarısız oldu (${tf}). İlk hata: ${esc(errors[0])}`,
          'error',
          () => loadTf(tf),
          'err-' + tf
        );
      } else clearAlert('err-' + tf);
      renderMeta();
    }

    function renderMeta() {
      const parts = cfg.TIMEFRAMES.map((tf) => `${tf}: ${lastUpdate[tf] ? fmtTime(lastUpdate[tf]).slice(11) : busy[tf] ? '<span class="spinner"></span>' : '—'}`);
      let extra = '';
      if (CD.okx.source.mode === 'static') {
        const any = [...rows.values()].find((r) => r.updated);
        if (any) extra = ` · Yedek veri zamanı: ${fmtTime(any.updated)} (${fmtAgo(any.updated)})`;
      }
      $('#metaRow').innerHTML = `<span>Son güncelleme — ${parts.join(' · ')}${extra}</span><span>Otomatik yenileme: 15m her dakika, 4H 5 dk, 1D 15 dk</span>`;
    }

    function statusTag(s) {
      if (!s) return '';
      const c = s.startsWith('TP') && !s.includes('SL') ? 'win' : s.includes('SL') ? 'loss' : '';
      return `<span class="status-tag ${c}">${esc(s)}</span>`;
    }

    function render() {
      const tfF = f.tf.value;
      const dirF = f.dir.value;
      let list = [...rows.values()].filter((r) => (tfF === 'all' || r.tf === tfF) && (dirF === 'all' || (r.signal && r.signal.type === dirF)) && (!f.only.checked || r.signal));
      const sort = f.sort.value;
      list.sort((a, b) => {
        if (sort === 'coin') return cfg.COINS.indexOf(a.coin) - cfg.COINS.indexOf(b.coin) || cfg.TIMEFRAMES.indexOf(a.tf) - cfg.TIMEFRAMES.indexOf(b.tf);
        if (sort === 'score') return (b.signal ? b.signal.score : -1) - (a.signal ? a.signal.score : -1);
        return (b.signal ? b.signal.time : 0) - (a.signal ? a.signal.time : 0);
      });

      const tbody = $('#sigTable tbody');
      tbody.innerHTML = list
        .map((r) => {
          const k = key(r.coin, r.tf);
          const sel = k === selectedKey ? ' selected' : '';
          if (!r.signal) {
            const msg = r.unlisted ? `OKX'te listelenmiyor` : r.error ? `<span class="neg" title="${esc(r.error)}">Hata</span>` : r.loading && !r.candles ? '<span class="spinner"></span>' : 'Sinyal yok';
            return `<tr class="nosig${sel}" data-k="${k}"><td><b>${r.coin}</b></td><td class="left">${r.tf}</td><td class="left"><span class="pill muted">${msg}</span></td>
              <td colspan="8"></td><td class="num">${fmtPrice(r.price)}</td></tr>`;
          }
          const s = r.signal;
          const rr1 = (Math.abs(s.tp1 - s.entry) / s.risk).toFixed(1);
          const rr2 = (Math.abs(s.tp2 - s.entry) / s.risk).toFixed(1);
          const chg = r.price != null ? ((r.price - s.entry) / s.entry) * 100 * (s.type === 'BUY' ? 1 : -1) : null;
          return `<tr class="${sel.trim()}" data-k="${k}">
            <td><b>${r.coin}</b></td><td class="left">${r.tf}</td>
            <td class="left"><span class="pill ${s.type === 'BUY' ? 'buy' : 'sell'}">${s.type}</span>${s.kind === 'hidden' ? '<span class="kind">gizli</span>' : ''}</td>
            <td class="num">${fmtPrice(s.entry)}${s.pending ? '*' : ''}</td>
            <td class="num neg">${fmtPrice(s.sl)}</td>
            <td class="num pos">${fmtPrice(s.tp1)}</td>
            <td class="num pos">${fmtPrice(s.tp2)}</td>
            <td class="num">${rr1} / ${rr2}</td>
            <td class="left"><span class="score"><span class="bar"><i style="width:${s.score}%"></i></span>${s.score}</span></td>
            <td class="left">${statusTag(r.status)}</td>
            <td class="num" title="${fmtAgo(s.time)}">${fmtTime(s.time)}</td>
            <td class="num">${fmtPrice(r.price)} ${chg != null ? `<span class="${cls(chg)}">(${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)</span>` : ''}</td>
          </tr>`;
        })
        .join('');
    }

    // Satıra tıklayınca grafik
    $('#sigTable tbody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-k]');
      if (!tr) return;
      selectedKey = tr.dataset.k;
      render();
      const row = rows.get(selectedKey);
      if (row && row.candles) drawChart(row, false);
    });

    function drawChart(row, keepRange) {
      if (!chartsAvailable()) return;
      const panel = $('#chartPanel');
      panel.classList.remove('hidden');
      let range = null;
      if (chartState) {
        if (keepRange) range = chartState.price.timeScale().getVisibleLogicalRange();
        chartState.price.remove();
        chartState.rsi.remove();
      }
      const lw = LW();
      const s = row.signal;
      $('#chartTitle').textContent = `${row.coin}-${cfg.QUOTE} · ${row.tf}` + (s ? ` · ${s.type} (${s.kind === 'hidden' ? 'gizli' : 'klasik'} uyumsuzluk) · skor ${s.score}` : ' · sinyal yok');

      const candles = row.candles;
      const price = lw.createChart($('#chartPrice'), baseChartOptions());
      const rsiC = lw.createChart($('#chartRsi'), { ...baseChartOptions(), timeScale: { ...baseChartOptions().timeScale, visible: true } });

      const cs = price.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444',
        priceFormat: priceFormat(candles),
      });
      cs.setData(candles.map((c) => ({ time: toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));

      // RSI: ilk değerler ve kapanmamış mum için boş (whitespace) nokta → mantıksal indeksler hizalı kalır
      const rsiArr = row.res ? row.res.rsi : [];
      const rs = rsiC.addLineSeries({ color: '#a78bfa', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });
      rs.setData(candles.map((c, i) => (rsiArr[i] != null ? { time: toChartTime(c.time), value: rsiArr[i] } : { time: toChartTime(c.time) })));
      [30, 70].forEach((v) => rs.createPriceLine({ price: v, color: '#3a4460', lineWidth: 1, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: false }));
      rs.createPriceLine({ price: cfg.STRATEGY.bullRsiMax, color: 'rgba(34,197,94,0.35)', lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: false });
      rs.createPriceLine({ price: cfg.STRATEGY.bearRsiMin, color: 'rgba(239,68,68,0.35)', lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: false });

      // Tüm geçmiş sinyaller: işaret (marker); seçili sinyal: çizgiler
      const markers = (row.signals || []).map((g) => {
        const idx = Math.min(g.entryIndex, candles.length - 1);
        return {
          time: toChartTime(candles[idx].time),
          position: g.type === 'BUY' ? 'belowBar' : 'aboveBar',
          color: g.type === 'BUY' ? '#22c55e' : '#ef4444',
          shape: g.type === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: g.type,
        };
      });
      markers.sort((a, b) => a.time - b.time);
      cs.setMarkers(markers);

      if (s) {
        const t1 = toChartTime(s.p1Time);
        const t2 = toChartTime(s.p2Time);
        // Uyumsuzluk çizgileri: fiyatta ve RSI'da
        price.addLineSeries(lineOpts('#f59e0b', 2)).setData([{ time: t1, value: s.p1.price }, { time: t2, value: s.p2.price }]);
        rsiC.addLineSeries(lineOpts('#f59e0b', 2)).setData([{ time: t1, value: s.p1.rsi }, { time: t2, value: s.p2.rsi }]);
        // Giriş / SL / TP yatay çizgileri
        const pl = (p, color, title, style = lw.LineStyle.Dashed) => cs.createPriceLine({ price: p, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
        pl(s.entry, '#5b8cff', 'Giriş', lw.LineStyle.Solid);
        pl(s.sl, '#ef4444', 'SL');
        pl(s.tp1, '#22c55e', 'TP1');
        pl(s.tp2, '#16a34a', 'TP2');
        $('#chartNote').textContent =
          `Pivotlar: ${fmtTime(s.p1Time)} (RSI ${s.p1.rsi.toFixed(1)}) → ${fmtTime(s.p2Time)} (RSI ${s.p2.rsi.toFixed(1)}). ` +
          `Onay: sağdaki ${cfg.STRATEGY.pivotRight} mum kapandıktan sonra. Risk: ${fmtPrice(s.risk)} (${((s.risk / s.entry) * 100).toFixed(2)}%).` +
          (s.pending ? ' * Giriş fiyatı tahmini (sonraki mum henüz açılmadı).' : '');
      } else $('#chartNote').textContent = 'Yüklenen mumlarda kurallara uyan uyumsuzluk bulunamadı.';

      syncCharts(price, rsiC);
      if (range) price.timeScale().setVisibleLogicalRange(range);
      else {
        const n = candles.length;
        price.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 3 });
      }
      chartState = { price, rsi: rsiC };
      if (!keepRange) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Filtre olayları
    [f.tf, f.dir, f.sort, f.only].forEach((el) => el.addEventListener('change', () => (saveFilters(), render())));
    [f.hidden, f.trend].forEach((el) =>
      el.addEventListener('change', () => {
        saveFilters();
        rows.forEach(compute);
        render();
        if (selectedKey) drawChart(rows.get(selectedKey), true);
      })
    );
    $('#btnRefresh').addEventListener('click', () => cfg.TIMEFRAMES.forEach(loadTf));

    render();
    renderMeta();
    // Önce listelenme kontrolü, ardından ilk yükleme: sırayla (rate limit dostu),
    // sonra zaman dilimine göre otomatik yenileme
    (async () => {
      await checkListedCoins().then((missing) => missing.forEach((c) => unlisted.add(c)));
      for (const tf of cfg.TIMEFRAMES) await loadTf(tf);
    })();
    cfg.TIMEFRAMES.forEach((tf) => setInterval(() => loadTf(tf), cfg.REFRESH_MS[tf] || 300e3));
    setInterval(renderMeta, 30e3);
  }

  /* =====================================================================
   * BACKTEST
   * ===================================================================== */

  function initBacktestPage() {
    watchSource();
    const S = cfg.STRATEGY;
    const B = cfg.BACKTEST;
    const numIds = ['capital', 'riskPct', 'feePct', 'slippagePct', 'rsiPeriod', 'pivotLeft', 'pivotRight', 'minBars', 'maxBars', 'bullRsiMax', 'bearRsiMin', 'atrMult', 'tp1R', 'tp2R', 'controlRuns', 'seed'];
    const boolIds = ['useHidden', 'useTrendFilter', 'partialAtTp1', 'moveSlToBe'];
    const defaults = { ...S, ...B };
    const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // Coin seçici
    $('#coinPicker').innerHTML = cfg.COINS.map((c) => `<label><input type="checkbox" value="${c}" ${c === 'BTC' || c === 'ETH' ? 'checked' : ''}/>${c}</label>`).join('');
    // OKX'te listelenmeyen coinleri seçilemez yap
    checkListedCoins().then((missing) =>
      missing.forEach((c) => {
        const i = $(`#coinPicker input[value="${c}"]`);
        if (!i) return;
        i.checked = false;
        i.disabled = true;
        i.parentElement.title = "OKX'te listelenmiyor";
        i.parentElement.style.opacity = 0.4;
      })
    );
    $('#btnAll').onclick = () => document.querySelectorAll('#coinPicker input:not(:disabled)').forEach((i) => (i.checked = true));
    $('#btnNone').onclick = () => document.querySelectorAll('#coinPicker input').forEach((i) => (i.checked = false));

    function fillDefaults() {
      numIds.forEach((id) => ($('#' + id).value = defaults[id]));
      boolIds.forEach((id) => ($('#' + id).checked = !!defaults[id]));
      $('#exitTarget').value = defaults.exitTarget;
      const end = new Date();
      const start = new Date(end.getTime() - 180 * 86400e3);
      $('#start').value = isoDate(start);
      $('#end').value = isoDate(end);
    }
    fillDefaults();
    // Son kullanılan form değerlerini geri yükle (yalnızca bu tarayıcıda)
    try {
      const saved = JSON.parse(localStorage.getItem('cd.backtest.form.v2') || 'null');
      if (saved) {
        numIds.forEach((id) => saved[id] != null && ($('#' + id).value = saved[id]));
        boolIds.forEach((id) => saved[id] != null && ($('#' + id).checked = saved[id]));
        ['tf', 'start', 'end', 'exitTarget'].forEach((id) => saved[id] && ($('#' + id).value = saved[id]));
        if (saved.coins) document.querySelectorAll('#coinPicker input').forEach((i) => (i.checked = saved.coins.includes(i.value)));
      }
    } catch (e) {
      /* yok say */
    }
    $('#btnReset').onclick = fillDefaults;

    function readForm() {
      const v = {};
      numIds.forEach((id) => (v[id] = parseFloat($('#' + id).value)));
      boolIds.forEach((id) => (v[id] = $('#' + id).checked));
      v.tf = $('#tf').value;
      v.start = $('#start').value;
      v.end = $('#end').value;
      v.exitTarget = $('#exitTarget').value;
      v.coins = [...document.querySelectorAll('#coinPicker input:checked')].map((i) => i.value);
      try {
        localStorage.setItem('cd.backtest.form.v2', JSON.stringify(v));
      } catch (e) {
        /* yok say */
      }
      return v;
    }

    function validate(v) {
      if (!v.coins.length) return 'En az bir coin seçin.';
      const bad = numIds.find((id) => !Number.isFinite(v[id]));
      if (bad) return `Geçersiz değer: ${$('label[for="' + bad + '"]').textContent}`;
      const s = Date.parse(v.start);
      const e = Date.parse(v.end);
      if (!(s < e)) return 'Başlangıç tarihi bitişten önce olmalı.';
      if (v.minBars >= v.maxBars) return 'Pivot arası min, max değerinden küçük olmalı.';
      if (v.tp1R >= v.tp2R && v.partialAtTp1) return 'TP1 (R), TP2 (R) değerinden küçük olmalı.';
      const bars = (Math.min(e + 86400e3, Date.now()) - s) / cfg.BAR_MS[v.tf];
      if (bars > B.maxCandles) return `Aralık çok uzun: coin başına ~${Math.round(bars)} mum (sınır ${B.maxCandles}). Daha büyük zaman dilimi ya da daha kısa aralık seçin.`;
      return null;
    }

    let abort = null;
    let last = null; // son backtest sonuçları
    let charts = {};

    const progress = (frac, label) => {
      $('#progressBox').classList.remove('hidden');
      $('#progressBar').style.width = `${Math.round(frac * 100)}%`;
      $('#progressLabel').textContent = label;
    };

    $('#btnCancel').onclick = () => abort && abort.abort();

    $('#btForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      clearAlert('bt');
      const v = readForm();
      const err = validate(v);
      if (err) return showAlert(esc(err), 'error', null, 'bt');

      const barMs = cfg.BAR_MS[v.tf];
      const startMs = Date.parse(v.start + 'T00:00:00Z');
      const endMs = Math.min(Date.parse(v.end + 'T00:00:00Z') + 86400e3, Date.now());
      const fetchFrom = startMs - B.warmupBars * barMs; // göstergelerin ısınması için

      abort = new AbortController();
      $('#btnRun').disabled = true;
      $('#btnCancel').classList.remove('hidden');
      const datasets = [];
      try {
        // 1) Veri çek (ilerleme çubuğu ile)
        for (let k = 0; k < v.coins.length; k++) {
          const coin = v.coins[k];
          progress(k / v.coins.length, `${coin} verisi çekiliyor… (${k + 1}/${v.coins.length})`);
          const r = await CD.okx.source.loadHistory(coin, v.tf, fetchFrom, endMs, {
            signal: abort.signal,
            maxBars: B.maxCandles + B.warmupBars,
            onProgress: (f) => progress((k + f) / v.coins.length, `${coin} verisi çekiliyor… %${Math.round(f * 100)} (${k + 1}/${v.coins.length})`),
          });
          const candles = r.candles.filter((c) => c.confirm !== 0);
          if (r.source === 'static' && r.coveredFrom && r.coveredFrom > startMs) {
            showAlert(`${coin}: yedek veri yalnızca ${fmtTime(r.coveredFrom)} tarihinden itibaren mevcut; aralığın başı eksik.`, 'warn', null, 'cov-' + coin);
          }
          if (candles.length < 50) {
            showAlert(`${coin}: seçilen aralıkta yeterli veri yok (${candles.length} mum), atlandı.`, 'warn', null, 'short-' + coin);
            continue;
          }
          datasets.push({ coin, candles });
          if (k < v.coins.length - 1) await CD.okx.sleep(cfg.REQUEST_DELAY_MS);
        }
        if (!datasets.length) throw new Error('Hiçbir coin için veri alınamadı.');

        // 2) Sinyaller — sinyal paneliyle AYNI fonksiyon
        progress(1, 'Sinyaller hesaplanıyor…');
        await CD.okx.sleep(20);
        const strat = { ...S };
        ['rsiPeriod', 'pivotLeft', 'pivotRight', 'minBars', 'maxBars', 'bullRsiMax', 'bearRsiMin', 'atrMult', 'tp1R', 'tp2R'].forEach((k) => (strat[k] = v[k]));
        strat.useHidden = v.useHidden;
        strat.useTrendFilter = v.useTrendFilter;
        datasets.forEach((d) => (d.signals = CD.signals.generateSignals(d.candles, strat).signals));

        // 3) Geliştirme (%60) / test (%40) blokları + rastgele kontrol
        const split = CD.backtest.splitRange(startMs, endMs, B.devRatio);
        const baseOpts = {
          capital: v.capital, riskPct: v.riskPct, feePct: v.feePct, slippagePct: v.slippagePct,
          partialAtTp1: v.partialAtTp1, moveSlToBe: v.moveSlToBe, exitTarget: v.exitTarget,
          maxLeverage: B.maxLeverage, barMs,
        };
        const runs = Math.max(1, Math.round(v.controlRuns));
        const blocks = {};
        for (const seg of ['dev', 'test']) {
          progress(1, `${seg === 'dev' ? 'Geliştirme' : 'Test'} bloğu simüle ediliyor (strateji + ${runs} kontrol)…`);
          await CD.okx.sleep(20);
          const [s0, s1] = split[seg];
          const o = { ...baseOpts, startMs: s0, endMs: s1 };
          const res = CD.backtest.runBacktest(datasets, o);
          const ctrl = CD.backtest.runControl(datasets, o, runs, Math.round(v.seed) + (seg === 'test' ? 100003 : 0), res.metrics.totalReturn);
          res.trades.forEach((t) => (t.segment = seg === 'dev' ? 'gelistirme' : 'test'));
          blocks[seg] = { res, ctrl, range: [s0, s1] };
        }
        last = { v, datasets, blocks, split, startMs, endMs };
        renderResults();
        $('#progressLabel').textContent = `Tamamlandı · ${datasets.length} coin · ${datasets.reduce((s, d) => s + d.candles.length, 0).toLocaleString('tr-TR')} mum`;
      } catch (e) {
        if (e.name === 'AbortError') showAlert('Backtest iptal edildi.', 'info', null, 'bt');
        else showAlert(`Backtest başarısız: ${esc(e.message)}`, 'error', () => $('#btnRun').click(), 'bt');
      } finally {
        $('#btnRun').disabled = false;
        $('#btnCancel').classList.add('hidden');
        abort = null;
      }
    });

    // ---- Sonuçları çiz ----
    const METRICS = [
      ['totalReturn', 'Toplam getiri', (x) => `<span class="${cls(x)}">${fmtNum(x)}%</span>`],
      ['trades', 'İşlem sayısı', (x) => fmtNum(x, 0)],
      ['winRate', 'Kazanma oranı', (x) => `${fmtNum(x, 1)}%`],
      ['profitFactor', 'Profit factor', (x) => fmtNum(x)],
      ['avgR', 'Ortalama R', (x) => `<span class="${cls(x)}">${fmtNum(x)}</span>`],
      ['maxDrawdown', 'Max drawdown', (x) => `${fmtNum(x)}%`],
      ['sharpe', 'Sharpe (yıllık)', (x) => fmtNum(x)],
      ['maxLossStreak', 'En uzun kayıp serisi', (x) => fmtNum(x, 0)],
    ];

    function renderBlock(el, seg, b) {
      const m = b.res.metrics;
      const c = b.ctrl.median;
      const title = seg === 'dev' ? '<span class="tag dev">GELİŞTİRME · ilk %60</span>' : '<span class="tag test">TEST · son %40</span>';
      const d = (ms) => fmtTime(ms).slice(0, 10);
      el.innerHTML = `
        <div class="block-title"><h2>${title}</h2><span class="range">${d(b.range[0])} → ${d(b.range[1])}</span></div>
        <div class="table-wrap"><table class="metrics"><thead><tr><th>Metrik</th><th>Strateji</th><th>Kontrol (medyan, N=${b.ctrl.runs})</th></tr></thead>
        <tbody>${METRICS.map(([k, label, f]) => `<tr><td>${label}</td><td class="num">${f(m[k])}</td><td class="num">${f(c[k])}</td></tr>`).join('')}</tbody></table></div>
        <p class="verdict">Toplam getiride strateji, ${b.ctrl.runs} rastgele yönlü kontrol koşusundan <b>${Math.round((b.ctrl.percentile / 100) * b.ctrl.runs)} tanesini</b> geçti (%${fmtNum(b.ctrl.percentile, 0)}).
        ${b.ctrl.percentile >= 95 ? 'Kontrolden anlamlı biçimde iyi görünüyor.' : b.ctrl.percentile >= 75 ? 'Kontrolden iyi, ancak kesin değil.' : 'Rastgele yönden belirgin biçimde ayrışmıyor.'}</p>`;
    }

    function renderResults() {
      $('#results').classList.remove('hidden');
      renderBlock($('#blockDev'), 'dev', last.blocks.dev);
      renderBlock($('#blockTest'), 'test', last.blocks.test);

      const trades = [...last.blocks.dev.res.trades, ...last.blocks.test.res.trades];
      $('#tradeTable tbody').innerHTML = trades.length
        ? trades
            .map(
              (t) => `<tr><td class="left">${t.segment === 'test' ? '<span class="tag test">test</span>' : '<span class="tag dev">geliştirme</span>'}</td>
          <td class="left"><b>${t.coin}</b></td><td class="left"><span class="pill ${t.dir === 'BUY' ? 'buy' : 'sell'}">${t.dir}</span></td>
          <td class="num">${fmtTime(t.entryTime)}</td><td class="num">${fmtPrice(t.entryPrice)}</td><td class="num">${fmtPrice(t.sl)}</td>
          <td class="num">${fmtTime(t.exitTime)}</td><td class="num">${fmtPrice(t.exitPrice)}</td><td class="left">${t.reason}</td>
          <td class="num ${cls(t.r)}">${fmtNum(t.r)}</td><td class="num ${cls(t.pnl)}">${fmtNum(t.pnl)}</td><td class="num ${cls(t.pnlPct)}">${fmtNum(t.pnlPct)}%</td></tr>`
            )
            .join('')
        : '<tr><td colspan="12" class="left">Bu aralıkta işlem yok.</td></tr>';

      const sel = $('#chartCoin');
      sel.innerHTML = last.datasets.map((d) => `<option>${d.coin}</option>`).join('');
      sel.onchange = drawTradesChart;
      if (!chartsAvailable()) return;
      drawEquity();
      drawTradesChart();
    }

    function drawEquity() {
      if (charts.eq) charts.eq.remove();
      const ch = LW().createChart($('#chartEquity'), baseChartOptions());
      const toData = (eq) => eq.map((e) => ({ time: toChartTime(e.time), value: e.value }));
      ch.addLineSeries({ color: '#5b8cff', lineWidth: 2, priceLineVisible: false }).setData(toData(last.blocks.dev.res.equity));
      ch.addLineSeries({ color: '#f59e0b', lineWidth: 2, priceLineVisible: false }).setData(toData(last.blocks.test.res.equity));
      ch.timeScale().fitContent();
      charts.eq = ch;
    }

    function drawTradesChart() {
      if (!LW()) return;
      if (charts.tr) charts.tr.remove();
      const coin = $('#chartCoin').value;
      const d = last.datasets.find((x) => x.coin === coin);
      if (!d) return;
      const candles = d.candles.filter((c) => c.time >= last.startMs && c.time < last.endMs);
      const ch = LW().createChart($('#chartTrades'), baseChartOptions());
      const cs = ch.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444', priceFormat: priceFormat(candles) });
      cs.setData(candles.map((c) => ({ time: toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
      const trades = [...last.blocks.dev.res.trades, ...last.blocks.test.res.trades].filter((t) => t.coin === coin);
      const markers = [];
      trades.forEach((t) => {
        markers.push({ time: toChartTime(t.entryTime), position: t.dir === 'BUY' ? 'belowBar' : 'aboveBar', color: t.dir === 'BUY' ? '#22c55e' : '#ef4444', shape: t.dir === 'BUY' ? 'arrowUp' : 'arrowDown', text: t.dir });
        markers.push({ time: toChartTime(t.exitTime), position: t.dir === 'BUY' ? 'aboveBar' : 'belowBar', color: t.pnl > 0 ? '#22c55e' : '#ef4444', shape: 'circle', text: `${t.reason} ${t.r >= 0 ? '+' : ''}${t.r.toFixed(1)}R` });
      });
      // Geliştirme/test sınırı
      const mid = last.split.test[0];
      const firstTest = candles.find((c) => c.time >= mid);
      if (firstTest) markers.push({ time: toChartTime(firstTest.time), position: 'aboveBar', color: '#f59e0b', shape: 'square', text: 'TEST →' });
      markers.sort((a, b) => a.time - b.time);
      cs.setMarkers(markers);
      ch.timeScale().fitContent();
      charts.tr = ch;
    }

    $('#btnCsv').onclick = () => {
      if (!last) return;
      const trades = [...last.blocks.dev.res.trades, ...last.blocks.test.res.trades];
      const csv = CD.backtest.tradesToCsv(trades);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `backtest_${last.v.tf}_${last.v.start}_${last.v.end}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }

  const api = { initSignalsPage, initBacktestPage, fmtPrice, fmtTime, toChartTime };
  CD.ui = api;
})(window);
