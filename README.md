# Crypto Divergence — RSI uyumsuzluk sinyalleri ve backtest

Canlı site: **https://mugiatama34.github.io/crypto-divergence/**

Tamamen statik bir site (HTML + CSS + vanilla JavaScript, build adımı yok). OKX Public API
verisiyle RSI ile fiyat arasındaki **pozitif (bullish)** ve **negatif (bearish)** uyumsuzlukları bulur,
BUY/SELL önerisi ile giriş, SL, TP1 ve TP2 seviyelerini verir. Ayrıca aynı stratejiyi geçmiş veride test eden bir
backtest sayfası vardır.

> ⚠️ **Bu site yatırım tavsiyesi değildir.** Sinyaller otomatik üretilir ve hatalı olabilir.

## Sayfalar

| Sayfa | İçerik |
|---|---|
| `index.html` — Sinyal Paneli | 15 coin × 3 zaman dilimi (15m, 4H, 1D) için son sinyal: yön, giriş, SL, TP1, TP2, R:R, güç skoru, durum, sinyal zamanı ve güncel fiyat. Zaman dilimi/yön filtresi, sıralama, otomatik yenileme (15m her dakika, 4H 5 dk, 1D 15 dk). Bir satıra tıklayınca mum grafiği, altta RSI paneli, fiyatta ve RSI'da uyumsuzluk çizgileri, giriş/SL/TP yatay çizgileri açılır. |
| `backtest.html` — Backtest | Coin(ler), zaman dilimi, tarih aralığı, sermaye, risk %, komisyon, slippage ve strateji parametreleri. Sonuçlar **geliştirme (ilk %60)** ve **test (son %40)** olarak iki ayrı blokta, her blokta **rastgele yönlü kontrol** ile yan yana gösterilir. Equity eğrisi, grafikte işaretlenmiş işlemler, işlem tablosu ve CSV indirme. |

## Strateji

1. **RSI**: Wilder yöntemi, periyot 14.
2. **Pivotlar**: solda 5, sağda 5 mum. Pivot ancak sağdaki 5 mum **kapandıktan sonra** onaylanır; sinyal bu
   onay mumunda üretilir. Böylece geleceği görme (lookahead) yoktur. Testlerde, kesilmiş veride üretilen
   sinyallerin tam veridekilerle birebir aynı olduğu doğrulanır.
3. **Pozitif uyumsuzluk (BUY)**: fiyat daha düşük dip, RSI daha yüksek dip; ikinci dipte RSI < 40; iki pivot arası 5–60 mum.
4. **Negatif uyumsuzluk (SELL)**: fiyat daha yüksek tepe, RSI daha düşük tepe; ikinci tepede RSI > 60.
5. İsteğe bağlı: **gizli uyumsuzluklar** (trend devamı) ve **EMA 200 trend filtresi**.
6. **Giriş**: onay mumundan sonraki mumun açılışı. Canlı panelde bu mum yeni açıldıysa fiyatı onun açılışıdır.
   Henüz açılmadıysa tahmini değer gösterilir ve `*` ile işaretlenir.
7. **SL**: BUY için son swing low − 0.5×ATR(14); SELL için son swing high + 0.5×ATR(14).
8. **TP**: TP1 = 1.5R, TP2 = 3R (R = |giriş − SL|).
9. **Güç skoru (0–100)**: RSI farkı (40 puan), ATR cinsinden fiyat farkı (30 puan), EMA 200 trend uyumu (30 puan).

Sinyal paneli ve backtest **aynı fonksiyonu** (`CD.signals.generateSignals`) kullanır.

### Backtest kuralları

- Coin başına aynı anda tek pozisyon açılır; pozisyon açıkken gelen sinyal atlanır.
- Aynı mumda hem TP hem SL görülürse **SL kabul edilir**. TP1'den sonra aynı mumda yeni SL'e (girişe) de dokunulduysa stop kabul edilir.
- Seçenek: TP1'de yarısını kapatıp SL'i girişe çekme. Kapalıysa tüm pozisyon seçilen hedefte (TP1 veya TP2) kapanır.
- Pozisyon büyüklüğü, sermaye × risk% / birim risk formülüyle hesaplanır. Nominal değer sermayeyi aşamaz (`maxLeverage: 1`).
- Komisyon her iki tarafta alınır, slippage giriş ve çıkışta aleyhe uygulanır. SELL sinyalleri short pozisyon olarak simüle edilir.
- Göstergelerin ısınması için başlangıçtan önce 300 mum ek veri çekilir.
- **Geliştirme / test**: Seçilen aralık zaman olarak ilk %60 ve son %40 diye bölünür. Her blok başlangıç sermayesiyle
  ayrı simüle edilir. **Ayarları yalnızca geliştirme bloğuna bakarak değiştirin.** Test bloğu, sonucun daha önce
  görülmemiş veride tutup tutmadığını gösterir.
- **Rastgele yönlü kontrol**: Kontrol, stratejiyle aynı giriş mumlarını ve aynı SL/TP mesafelerini kullanır, ama
  yönü yazı-tura ile seçer (seviyeler giriş fiyatına göre aynalanır). Varsayılan olarak 50 kez çalışır (seed ile
  tekrarlanabilir). Tabloda bu koşuların medyanı gösterilir, ayrıca stratejinin toplam getiride kaç kontrol
  koşusunu geçtiği yazılır. Strateji kontrolü belirgin şekilde geçmiyorsa, sonucu yön tahmininden değil SL/TP
  geometrisinden ve piyasanın genel hareketinden geliyor olabilir.

## Veri kaynağı

`js/config.js` içindeki `DATA_SOURCE` ayarıyla seçilir:

| Değer | Davranış |
|---|---|
| `'auto'` (varsayılan) | Önce tarayıcıdan OKX'e doğrudan istek atar. Ağ veya CORS hatası olursa otomatik olarak yedek JSON'a geçer ve sayfada uyarı gösterir. |
| `'direct'` | Yalnızca OKX API'sini kullanır (`/market/candles`, `/market/history-candles`). |
| `'static'` | Yalnızca `data/` klasöründeki JSON dosyalarını okur. |

**Yedek yöntem**: `.github/workflows/fetch-data.yml` her 15 dakikada `scripts/fetch-data.js` betiğini çalıştırır.
Betik her coin ve zaman dilimi için en fazla 1500 mumu `data/<COIN>-USDT_<TF>.json` dosyasına yazar ve commit eder.
Ardından `pages.yml`, `workflow_run` tetikleyicisiyle siteyi yeniden yayınlar. Statik modda backtest yalnızca bu
dosyalardaki aralığı kullanabilir (15m için yaklaşık 15 gün, 4H için yaklaşık 250 gün, 1D için yaklaşık 4 yıl).

Tarayıcıdan doğrudan erişim çalışıyorsa repo gereksiz yere büyümesin diye **Actions → Fetch OKX data → Disable workflow**
ile yedek workflow'u kapatabilirsiniz. OKX, bulunduğunuz bölgede `www.okx.com` adresini engelliyorsa farklı bir alan adı
kullanabilirsiniz: tarayıcı için `OKX_BASE` ayarını, workflow için `OKX_BASE` ortam değişkenini değiştirin.

İstekler arasında bekleme süresi vardır (`REQUEST_DELAY_MS`, `HISTORY_DELAY_MS`). Rate limit (`50011`) ve sunucu
hatalarında istek üstel beklemeyle en fazla 3 kez yeniden denenir. Hatalar sayfada "Tekrar dene" düğmesiyle gösterilir.
Kapanmamış son mum (`confirm=0`) sinyal hesabına katılmaz.

## Ayarları değiştirme

Tüm ayarlar **`js/config.js`** dosyasındadır:

- `COINS`: coin listesi (USDT spot çiftleri). Listede olup OKX'te listelenmeyen bir çift varsa panel bunu uyarıyla bildirir (`checkListedPairs`).
- `TIMEFRAMES`, `REFRESH_MS`: zaman dilimleri ve yenileme aralıkları.
- `STRATEGY`: RSI periyodu, pivot uzunlukları, pivot mesafesi, RSI eşikleri, gizli uyumsuzluk / EMA filtresi, ATR çarpanı, TP R değerleri.
- `BACKTEST`: varsayılan sermaye, risk, komisyon, slippage, TP1 davranışı, geliştirme oranı, kontrol koşusu sayısı, seed.

Sinyal panelinde gizli uyumsuzluk ve EMA filtresi sayfadan da açılıp kapatılabilir. Backtest sayfasındaki tüm alanlar
formdan değiştirilebilir, son kullanılan değerler tarayıcıda hatırlanır.

## Dosya yapısı

```
index.html            Sinyal paneli
backtest.html         Backtest sayfası
css/style.css         Koyu tema, mobil uyumlu stil
js/config.js          Ayarlar
js/okx.js             OKX istemcisi + veri kaynağı katmanı (direct/static/auto), listelenme kontrolü
js/indicators.js      RSI (Wilder), EMA, ATR
js/divergence.js      Pivot tespiti ve uyumsuzluklar
js/signals.js         ORTAK strateji fonksiyonu: giriş/SL/TP/skor
js/backtest.js        Backtest motoru, metrikler, rastgele kontrol, CSV
js/ui.js              Arayüz ve grafikler (TradingView Lightweight Charts v4, CDN)
scripts/fetch-data.js Yedek veri betiği (Node)
tests/                indicators, divergence ve backtest testleri
.github/workflows/    pages.yml (yayın), fetch-data.yml (yedek veri)
```

## Yerelde çalıştırma ve testler

```bash
npm test                      # Node 20+ gerekir, bağımlılık yok
python3 -m http.server 8000   # ardından http://localhost:8000
```

`pages.yml` her push'ta önce testleri çalıştırır. Testler başarısız olursa site yayınlanmaz.

## GitHub Pages kurulumu

Repo → **Settings → Pages → Build and deployment → Source: "GitHub Actions"** seçilmelidir. Ardından
**Actions → Deploy GitHub Pages → Run workflow** ile ilk yayını başlatabilirsiniz.
