/**
 * Kur (döviz) ucu — EVDS3 (tam geçmiş) + TCMB günlük bülten (belirli gün) + ECB yedek
 * =================================================================================
 * Döviz fon TL fiyatını dolara çevirmek için kur sağlar:  USD_fiyat = TL_fiyat / USDTRY
 *
 * MODLAR:
 *  A) ?gun=YYYY-MM-DD  -> O GÜNE ait TCMB resmi bülteninden USD/EUR ALIŞ+SATIŞ (ANAHTARSIZ).
 *     tcmb.gov.tr/kurlar/YYYYMM/DDMMYYYY.xml. Hafta sonu/tatilde en yakın ÖNCEKİ iş gününe iner.
 *     Döviz fon işlem kaydında kullanılır: fon değerlemesi TCMB ALIŞ + bir önceki iş günü (T-1) ile yapılır.
 *  B) (varsayılan) geçmiş seri: EVDS3 anahtarı varsa TAM TCMB alış/satış; yoksa TCMB güncel bülten + ECB geçmiş.
 *
 * KULLANIM:
 *   GET /api/kur?gun=2026-09-02          -> { ok, gun, tarih, usdAlis, usdSatis, eurAlis, eurSatis }
 *   GET /api/kur                         -> güncel + geçmiş seri (grafik/liste)
 *   GET /api/kur?bas=...&bit=...
 *   GET /api/kur?debug=1
 */

const https = require('https');
const crypto = require('crypto');

const FRANK = 'https://api.frankfurter.app';
const TCMB_TODAY = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const EVDS_BASE = process.env.EVDS_BASE || 'https://evds2.tcmb.gov.tr/service/evds';

function isoDay(d) { return d.toISOString().slice(0, 10); }
function toTR(iso) { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; }
function toISO(tr) { const [d, m, y] = tr.split('-'); return `${y}-${m}-${d}`; }

let KUR_CACHE = {};
const KUR_TTL = 3 * 60 * 60 * 1000;
let GUN_CACHE = {}; // gun -> data (geçmiş gün değişmez, uzun tutulur)

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

function pickCurrency(xml, kod) {
  const m = xml.match(new RegExp('<Currency[^>]*Kod="' + kod + '"[\\s\\S]*?</Currency>'));
  if (!m) return {};
  const b = m[0];
  const g = (tag) => { const mm = b.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>')); return mm && mm[1] ? parseFloat(mm[1]) : null; };
  return { alis: g('ForexBuying'), satis: g('ForexSelling') };
}

// --- Belirli güne ait TCMB bülteni (TAM o gün; yoksa null) ---
async function tcmbFile(iso) {
  const [y, m, day] = iso.split('-');
  const url = `https://www.tcmb.gov.tr/kurlar/${y}${m}/${day}${m}${y}.xml`;
  try {
    const { status, body } = await httpsGet(url, { Accept: 'application/xml', 'User-Agent': 'Mozilla/5.0' });
    if (status === 200 && body.indexOf('<Currency') !== -1) {
      const usd = pickCurrency(body, 'USD'), eur = pickCurrency(body, 'EUR');
      const tm = body.match(/Tarih="([^"]+)"/);
      let tarih = iso; if (tm) { const p = tm[1].split('.'); if (p.length === 3) tarih = `${p[2]}-${p[1]}-${p[0]}`; }
      return { tarih, usdAlis: usd.alis, usdSatis: usd.satis, eurAlis: eur.alis, eurSatis: eur.satis };
    }
  } catch {}
  return null;
}
// Hafta sonu/tatilde önceki iş gününe iner (tek gün için)
async function tcmbGun(iso) {
  let d = new Date(iso + 'T00:00:00');
  for (let i = 0; i < 8; i++) {
    const g = await tcmbFile(d.toISOString().slice(0, 10));
    if (g && g.usdAlis != null) return g;
    d.setDate(d.getDate() - 1);
  }
  return null;
}

async function evds(bas, bit, dbg) {
  const key = process.env.EVDS_API_KEY;
  if (!key) { dbg.evds = 'EVDS_API_KEY yok'; return null; }
  const series = ['TP.DK.USD.A.YTL', 'TP.DK.USD.S.YTL', 'TP.DK.EUR.A.YTL', 'TP.DK.EUR.S.YTL'].join('-');
  const url = `${EVDS_BASE}/series=${series}&startDate=${toTR(bas)}&endDate=${toTR(bit)}&type=json&key=${key}`;
  try {
    const { status, body } = await httpsGet(url, { key, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' });
    let j = null; try { j = JSON.parse(body); } catch {}
    const items = j && Array.isArray(j.items) ? j.items : null;
    if (!items) { dbg.evds = `EVDS beklenmedik yanıt (${status}): ${String(body).slice(0, 120)}`; return null; }
    const usdAlis = {}, usdSatis = {}, eurAlis = {}, eurSatis = {};
    const g = (row, c) => { const v = row[c]; const n = v == null || v === '' ? null : parseFloat(v); return isNaN(n) ? null : n; };
    for (const row of items) {
      const t = row.Tarih ? toISO(String(row.Tarih)) : null; if (!t) continue;
      const a = g(row, 'TP_DK_USD_A_YTL'), s = g(row, 'TP_DK_USD_S_YTL'), ea = g(row, 'TP_DK_EUR_A_YTL'), es = g(row, 'TP_DK_EUR_S_YTL');
      if (a != null) usdAlis[t] = a; if (s != null) usdSatis[t] = s; if (ea != null) eurAlis[t] = ea; if (es != null) eurSatis[t] = es;
    }
    const gunler = Object.keys(usdAlis).sort();
    if (!gunler.length) { dbg.evds = 'EVDS boş seri'; return null; }
    const son = gunler[gunler.length - 1];
    dbg.evds = `OK: ${gunler.length} gün`;
    return { kaynak: 'EVDS3 (TCMB)', guncel: { tarih: son, usdAlis: usdAlis[son], usdSatis: usdSatis[son] ?? null, eurAlis: eurAlis[son] ?? null, eurSatis: eurSatis[son] ?? null }, usdtry: usdAlis, eurtry: eurAlis, usdtrySatis: usdSatis, eurtrySatis: eurSatis };
  } catch (e) { dbg.evds = 'EVDS hata: ' + String(e && e.message || e); return null; }
}

async function tcmbGuncel(dbg) {
  try {
    const { status, body } = await httpsGet(TCMB_TODAY, { Accept: 'application/xml', 'User-Agent': 'Mozilla/5.0' });
    const tm = body.match(/Tarih="([^"]+)"/);
    const usd = pickCurrency(body, 'USD'), eur = pickCurrency(body, 'EUR');
    dbg.tcmb = `OK (${status})`;
    let tarih = null; if (tm) { const p = tm[1].split('.'); if (p.length === 3) tarih = `${p[2]}-${p[1]}-${p[0]}`; }
    return { tarih, usdAlis: usd.alis, usdSatis: usd.satis, eurAlis: eur.alis, eurSatis: eur.satis };
  } catch (e) { dbg.tcmb = 'TCMB bülten hata: ' + String(e && e.message || e); return null; }
}

async function ecbSeri(from, bas, bit) {
  try {
    const r = await fetch(`${FRANK}/${bas}..${bit}?from=${from}&to=TRY`, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    const out = {}; if (j && j.rates) for (const [d, o] of Object.entries(j.rates)) { if (o && o.TRY != null) out[d] = o.TRY; }
    return out;
  } catch { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = req.query || {};

  // ---- MOD A: belirli gün (TCMB resmi bülten, alış+satış) ----
  if (q.gun) {
    const gun = String(q.gun);
    if (GUN_CACHE[gun]) { res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800'); res.status(200).json({ ok: true, cached: true, gun, ...GUN_CACHE[gun] }); return; }
    const g = await tcmbGun(gun);
    if (!g || g.usdAlis == null) { res.setHeader('Cache-Control', 'no-store'); res.status(502).json({ ok: false, error: 'TCMB bülten alınamadı: ' + gun }); return; }
    GUN_CACHE[gun] = g;
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ok: true, gun, ...g });
    return;
  }

  // ---- MOD A2: TCMB günlük bülten ARALIĞI (liste için gerçek TCMB alış+satış, anahtarsız) ----
  if (q.tcmbBas && q.tcmbBit) {
    const b1 = String(q.tcmbBas), b2 = String(q.tcmbBit);
    const days = [];
    let d = new Date(b1 + 'T00:00:00'); const end = new Date(b2 + 'T00:00:00');
    while (d <= end && days.length < 70) { const wd = d.getDay(); if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    const gunler = {}; const need = [];
    for (const g of days) { if (GUN_CACHE[g]) gunler[g] = GUN_CACHE[g]; else need.push(g); }
    const one = async (g) => { const r = await tcmbFile(g); if (r && r.usdAlis != null) { GUN_CACHE[g] = r; gunler[g] = r; } };
    for (let i = 0; i < need.length; i += 10) { await Promise.all(need.slice(i, i + 10).map(one)); }
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ok: true, bas: b1, bit: b2, kaynak: 'TCMB günlük bülten', gunler });
    return;
  }

  // ---- MOD B: güncel + geçmiş seri ----
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
  if (!data) {
    const [tcmb, usdtry, eurtry] = await Promise.all([tcmbGuncel(dbg), ecbSeri('USD', bas, bit), ecbSeri('EUR', bas, bit)]);
    const gunler = Object.keys(usdtry).sort();
    const son = gunler.length ? gunler[gunler.length - 1] : null;
    if ((!tcmb || tcmb.usdAlis == null) && !son) { res.setHeader('Cache-Control', 'no-store'); res.status(502).json({ ok: false, error: 'Kur alınamadı.', debug: dbg }); return; }
    data = {
      kaynak: (tcmb && tcmb.usdAlis != null) ? 'TCMB bülten (güncel) + ECB (geçmiş)' : 'ECB (gösterge)',
      guncel: tcmb && tcmb.usdAlis != null ? tcmb : { tarih: son, usdAlis: son ? usdtry[son] : null, usdSatis: null, eurAlis: son ? eurtry[son] : null, eurSatis: null },
      usdtry, eurtry,
    };
  }
  KUR_CACHE[key] = { at: Date.now(), data };

  if (debug) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, kaynak: data.kaynak, guncel: data.guncel, usdGun: Object.keys(data.usdtry || {}).length, evdsKeyVar: !!process.env.EVDS_API_KEY, evdsBase: EVDS_BASE, debug: dbg });
    return;
  }
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json({ ok: true, ...data });
};
