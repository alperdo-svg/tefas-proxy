/**
 * Kur (döviz) ucu — EVDS3 (TCMB, tam geçmiş) + otomatik yedekler
 * ==============================================================
 * Döviz fonlarını dolar bazında göstermek için TEFAS'ın TL fiyatını kura böleriz:
 *     USD_fiyat[t] = TL_fiyat[t] / USDTRY[t]
 *
 * KAYNAK ÖNCELİĞİ:
 *  1) EVDS3 (TCMB) — process.env.EVDS_API_KEY varsa. TAM geçmiş + güncel, Döviz Alış & Satış.
 *     Seri: TP.DK.USD.A.YTL (alış), TP.DK.USD.S.YTL (satış), EUR için .EUR. .
 *     Not: Eski evds2 REST'i 2025 sonunda değişti; anahtar HTTP header'ında gider ve TCMB
 *          sunucusu LEGACY SSL ister -> özel https agent ile çözülür.
 *     Taban URL env ile değiştirilebilir: EVDS_BASE (varsayılan: evds2.tcmb.gov.tr/service/evds).
 *  2) EVDS yoksa/başarısızsa -> TCMB günlük bülten (today.xml, anahtarsız) GÜNCEL kur
 *     + Frankfurter (ECB, anahtarsız) GEÇMİŞ eğri. Uygulama anahtarsız da çalışır.
 *
 * ORTAM DEĞİŞKENLERİ (Vercel):
 *   EVDS_API_KEY = evds3.tcmb.gov.tr'den alınan ücretsiz anahtar
 *   EVDS_BASE    = (opsiyonel) TCMB servis taban adresi
 *
 * KULLANIM:
 *   GET /api/kur                 -> { ok, kaynak, guncel:{tarih,usdAlis,usdSatis,eurAlis,eurSatis}, usdtry:{...}, eurtry:{...} }
 *   GET /api/kur?bas=2021-01-01&bit=2026-07-18
 *   GET /api/kur?debug=1         -> hangi kaynak, kaç gün, örnek + hata mesajları
 */

const https = require('https');
const crypto = require('crypto');

const FRANK = 'https://api.frankfurter.app';
const TCMB_TODAY = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const EVDS_BASE = process.env.EVDS_BASE || 'https://evds2.tcmb.gov.tr/service/evds';

function isoDay(d) { return d.toISOString().slice(0, 10); }
function toTR(iso) { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; }   // YYYY-MM-DD -> DD-MM-YYYY
function toISO(tr) { const [d, m, y] = tr.split('-'); return `${y}-${m}-${d}`; }    // DD-MM-YYYY -> YYYY-MM-DD

let KUR_CACHE = {};
const KUR_TTL = 3 * 60 * 60 * 1000; // 3 saat

// --- Legacy-SSL destekli HTTPS GET (TCMB sunucusu için şart) ---
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT });
    const req = https.get(url, { headers: headers || {}, agent, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

// --- 1) EVDS3 (TCMB) tam geçmiş: alış + satış (USD & EUR) ---
async function evds(bas, bit, dbg) {
  const key = process.env.EVDS_API_KEY;
  if (!key) { dbg.evds = 'EVDS_API_KEY yok (yedek kaynaklara düşülüyor)'; return null; }
  const series = ['TP.DK.USD.A.YTL', 'TP.DK.USD.S.YTL', 'TP.DK.EUR.A.YTL', 'TP.DK.EUR.S.YTL'].join('-');
  const url = `${EVDS_BASE}/series=${series}&startDate=${toTR(bas)}&endDate=${toTR(bit)}&type=json&key=${key}`;
  try {
    const { status, body } = await httpsGet(url, { key, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' });
    let j = null; try { j = JSON.parse(body); } catch {}
    const items = j && Array.isArray(j.items) ? j.items : null;
    if (!items) { dbg.evds = `EVDS beklenmedik yanıt (status ${status}): ${String(body).slice(0, 160)}`; return null; }
    const usdAlis = {}, usdSatis = {}, eurAlis = {}, eurSatis = {};
    const g = (row, code) => { const v = row[code]; const n = v == null || v === '' ? null : parseFloat(v); return isNaN(n) ? null : n; };
    for (const row of items) {
      const t = row.Tarih ? toISO(String(row.Tarih)) : null;
      if (!t) continue;
      const a = g(row, 'TP_DK_USD_A_YTL'), s = g(row, 'TP_DK_USD_S_YTL'), ea = g(row, 'TP_DK_EUR_A_YTL'), es = g(row, 'TP_DK_EUR_S_YTL');
      if (a != null) usdAlis[t] = a; if (s != null) usdSatis[t] = s;
      if (ea != null) eurAlis[t] = ea; if (es != null) eurSatis[t] = es;
    }
    const gunler = Object.keys(usdAlis).sort();
    if (!gunler.length) { dbg.evds = `EVDS boş seri döndü (status ${status})`; return null; }
    const son = gunler[gunler.length - 1];
    dbg.evds = `OK: ${gunler.length} gün, son ${son}`;
    return {
      kaynak: 'EVDS3 (TCMB)',
      guncel: { tarih: son, usdAlis: usdAlis[son], usdSatis: usdSatis[son] ?? null, eurAlis: eurAlis[son] ?? null, eurSatis: eurSatis[son] ?? null },
      usdtry: usdAlis, eurtry: eurAlis, usdtrySatis: usdSatis, eurtrySatis: eurSatis,
    };
  } catch (e) { dbg.evds = 'EVDS hata: ' + String(e && e.message || e); return null; }
}

// --- 2a) TCMB güncel bülten (anahtarsız) ---
async function tcmbGuncel(dbg) {
  try {
    const { status, body } = await httpsGet(TCMB_TODAY, { Accept: 'application/xml', 'User-Agent': 'Mozilla/5.0' });
    const tarihM = body.match(/Tarih="([^"]+)"/);
    const pick = (kod) => {
      const m = body.match(new RegExp('<Currency[^>]*Kod="' + kod + '"[\\s\\S]*?</Currency>'));
      if (!m) return {};
      const b = m[0];
      const gg = (tag) => { const mm = b.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>')); return mm && mm[1] ? parseFloat(mm[1]) : null; };
      return { alis: gg('ForexBuying'), satis: gg('ForexSelling') };
    };
    const usd = pick('USD'), eur = pick('EUR');
    dbg.tcmb = `OK (status ${status})`;
    // bülten tarihi DD.MM.YYYY -> ISO
    let tarihISO = null; if (tarihM) { const p = tarihM[1].split('.'); if (p.length === 3) tarihISO = `${p[2]}-${p[1]}-${p[0]}`; }
    return { tarih: tarihISO, usdAlis: usd.alis, usdSatis: usd.satis, eurAlis: eur.alis, eurSatis: eur.satis };
  } catch (e) { dbg.tcmb = 'TCMB bülten hata: ' + String(e && e.message || e); return null; }
}

// --- 2b) ECB (Frankfurter) geçmiş eğri (anahtarsız) ---
async function ecbSeri(from, bas, bit) {
  try {
    const r = await fetch(`${FRANK}/${bas}..${bit}?from=${from}&to=TRY`, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    const out = {};
    if (j && j.rates) for (const [d, o] of Object.entries(j.rates)) { if (o && o.TRY != null) out[d] = o.TRY; }
    return out;
  } catch { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = req.query || {};
  const bugun = new Date();
  const gecmis = new Date(bugun); gecmis.setFullYear(gecmis.getFullYear() - 6);
  const bas = String(q.bas || isoDay(gecmis));
  const bit = String(q.bit || isoDay(bugun));
  const debug = q.debug === '1';
  const key = bas + '|' + bit;

  const hit = KUR_CACHE[key];
  if (hit && (Date.now() - hit.at) < KUR_TTL && !debug) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ ok: true, cached: true, ...hit.data });
    return;
  }

  const dbg = {};
  let data = await evds(bas, bit, dbg);

  // EVDS yoksa/başarısızsa: TCMB güncel + ECB geçmiş
  if (!data) {
    const [tcmb, usdtry, eurtry] = await Promise.all([tcmbGuncel(dbg), ecbSeri('USD', bas, bit), ecbSeri('EUR', bas, bit)]);
    const gunler = Object.keys(usdtry).sort();
    const son = gunler.length ? gunler[gunler.length - 1] : null;
    if ((!tcmb || tcmb.usdAlis == null) && !son) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({ ok: false, error: 'Kur alınamadı (EVDS/TCMB/ECB üçü de boş).', debug: dbg });
      return;
    }
    data = {
      kaynak: (tcmb && tcmb.usdAlis != null) ? 'TCMB bülten (güncel) + ECB (geçmiş)' : 'ECB (gösterge)',
      guncel: tcmb && tcmb.usdAlis != null ? tcmb : { tarih: son, usdAlis: son ? usdtry[son] : null, usdSatis: null, eurAlis: son ? eurtry[son] : null, eurSatis: null },
      usdtry, eurtry,
    };
  }

  KUR_CACHE[key] = { at: Date.now(), data };

  if (debug) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true, kaynak: data.kaynak, guncel: data.guncel,
      usdGun: Object.keys(data.usdtry || {}).length,
      evdsKeyVar: !!process.env.EVDS_API_KEY, evdsBase: EVDS_BASE,
      debug: dbg,
      ornek: Object.keys(data.usdtry || {}).sort().slice(-3).map((d) => ({ d, usdtry: data.usdtry[d] })),
    });
    return;
  }

  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json({ ok: true, ...data });
};
