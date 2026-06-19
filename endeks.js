/**
 * Endeks/Benchmark Geçmiş Veri Proxy'si — Yahoo Finance (Vercel Serverless)
 * ------------------------------------------------------------------------
 * Tarayıcı Yahoo'ya doğrudan erişemez (CORS); bu proxy sunucudan çeker.
 * Günlük geçmiş seriyi fonlarla AYNI formatta döndürür: [{ date, value }]
 * Böylece volatilite/drawdown/Beta/Alpha motoru hiç değişmeden çalışır.
 *
 * KULLANIM:
 *   GET /api/endeks?sembol=XU100.IS            -> BIST 100 (fiyat endeksi), 5 yıl
 *   GET /api/endeks?sembol=XU100_CFNNTLTL.IS   -> BIST 100 GETİRİ (temettü dahil)
 *   GET /api/endeks?sembol=%5ENDX              -> Nasdaq 100 ( ^NDX )
 *   GET /api/endeks?sembol=USDTRY=X            -> USD/TRY
 *   GET /api/endeks?sembol=GC=F                -> Altın (vadeli)
 *   &range=3y|5y|10y|max   &interval=1d        (varsayılan 5y / 1d)
 *   &debug=1                                   -> teşhis
 *
 * DÖNÜŞ: { ok, sembol, count, meta:{...}, series:[{date, value}] }
 */

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function fetchChart(symbol, range, interval) {
  let lastErr = null;
  for (const host of HOSTS) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includeAdjustedClose=true`;
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      const text = await r.text();
      let json; try { json = JSON.parse(text); } catch { lastErr = `JSON değil (HTTP ${r.status}) @${host}: ${text.slice(0, 160)}`; continue; }
      return { status: r.status, json, host };
    } catch (e) { lastErr = String(e) + ' @' + host; }
  }
  return { error: lastErr || 'bilinmeyen hata' };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = req.query || {};
  const sembol = String(q.sembol || 'XU100.IS');
  const range = String(q.range || '5y');
  const interval = String(q.interval || '1d');
  const debug = q.debug === '1';

  const out = await fetchChart(sembol, range, interval);
  if (out.error) { res.status(502).json({ ok: false, error: 'Yahoo isteği başarısız: ' + out.error }); return; }

  const chart = out.json && out.json.chart;
  if (!chart || chart.error) {
    res.status(502).json({ ok: false, error: 'Yahoo veri hatası', detail: chart && chart.error, sembol });
    return;
  }
  const result = chart.result && chart.result[0];
  if (!result || !result.timestamp) {
    res.status(502).json({ ok: false, error: 'Bu sembol için veri yok', sembol });
    return;
  }

  const ts = result.timestamp;
  const gmt = (result.meta && result.meta.gmtoffset) || 0; // saniye
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const adj = (result.indicators && result.indicators.adjclose && result.indicators.adjclose[0] && result.indicators.adjclose[0].adjclose) || null;
  const close = quote.close || [];

  const series = [];
  for (let i = 0; i < ts.length; i++) {
    const v = (adj && adj[i] != null) ? adj[i] : close[i];
    if (v == null) continue; // tatil/eksik gün
    const d = new Date((ts[i] + gmt) * 1000).toISOString().split('T')[0];
    series.push({ date: d, value: +(+v).toFixed(6) });
  }
  // tarihe göre sırala + aynı güne dedupe (son değer)
  const byDate = new Map();
  series.sort((a, b) => a.date.localeCompare(b.date)).forEach((s) => byDate.set(s.date, s.value));
  const finalSeries = Array.from(byDate, ([date, value]) => ({ date, value }));

  const meta = {
    sembol,
    ad: (result.meta && (result.meta.shortName || result.meta.symbol)) || sembol,
    paraBirimi: result.meta && result.meta.currency,
    ilk: finalSeries[0] && finalSeries[0].date,
    son: finalSeries[finalSeries.length - 1] && finalSeries[finalSeries.length - 1].date,
    kaynak: out.host,
  };

  if (debug) { res.status(200).json({ ok: true, meta, count: finalSeries.length, ornek: finalSeries.slice(-5) }); return; }
  res.status(200).json({ ok: true, sembol, meta, count: finalSeries.length, series: finalSeries });
};
