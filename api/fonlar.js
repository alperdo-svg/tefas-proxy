/**
 * TEFAS Fon Tarayıcı / Getiri Karşılaştırma — Vercel Serverless Proxy
 * ------------------------------------------------------------------
 * TOKEN GEREKTİRMEYEN resmi dışa-aktarma endpoint'ini kullanır:
 *   POST https://www.tefas.gov.tr/api/fund-returns/export  (gövde JSON)
 *
 * TEFAS fonları iki kovada tutar:
 *   islem=1 -> TEFAS'ta İŞLEM GÖREN fonlar
 *   islem=2 -> TEFAS'ta İŞLEM GÖRMEYEN (serbest vб.) fonlar  (örn. GJH)
 * Tüm evreni almak için İKİSİNİ de çekip birleştiriyoruz; her fonu
 * geldiği kovaya göre tefas=true/false olarak işaretliyoruz.
 *
 * KULLANIM:
 *   GET /api/fonlar                 -> tüm YAT fonları (gören + görmeyen)
 *   GET /api/fonlar?sfonturkod=107  -> sadece Para Piyasası Şemsiye
 *   GET /api/fonlar?islem=1         -> sadece işlem görenler
 *   GET /api/fonlar?fontip=EMK      -> emeklilik fonları
 *   GET /api/fonlar?debug=1         -> ham özet (teşhis)
 *
 * DÖNÜŞ: { ok, count, funds: [{ kod, ad, tur, tefas, risk, g1a..g5y }] }
 */

const TEFAS_URL = 'https://www.tefas.gov.tr/api/fund-returns/export';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function pickArray(j) {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== 'object') return [];
  for (const k of ['data', 'resultList', 'list', 'result', 'rows']) if (Array.isArray(j[k])) return j[k];
  for (const k of Object.keys(j)) if (Array.isArray(j[k])) return j[k];
  return [];
}

async function fetchBucket(fundType, sfonTurKod, islem) {
  const payload = {
    format: 'json', listingType: 'return', fundType, locale: 'tr',
    columns: ['fonKodu', 'fonUnvan', 'fonTurAciklama', 'riskDegeri', 'getiri1a', 'getiri3a', 'getiri6a', 'getiriyb', 'getiri1y', 'getiri3y', 'getiri5y'],
    filters: {
      kurucuKodu: null, fonTurKod: null, fonGrubu: null, fonTurAciklama: null,
      sfonTurKod, islem, calismaTipi: 2, getiriOrani: '1',
      donemGetiri1a: '1', donemGetiri1y: '1', donemGetiri3a: '1', donemGetiri3y: '1',
      donemGetiri5y: '1', donemGetiri6a: '1', donemGetiriyb: '1',
    },
  };
  const r = await fetch(TEFAS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: '*/*',
      Referer: 'https://www.tefas.gov.tr/', Origin: 'https://www.tefas.gov.tr',
      'Accept-Language': 'tr-TR,tr;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { return { ok: false, status: r.status, sample: text.slice(0, 300), arr: [] }; }
  return { ok: true, status: r.status, arr: pickArray(json) };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = req.query || {};
  const fundType = String(q.fontip || 'YAT');
  const sfonTurKod = q.sfonturkod ? String(q.sfonturkod) : null;
  const debug = q.debug === '1';
  // islem belirtilmezse İKİ kovayı da çek (gören + görmeyen). Belirtilirse sadece onu.
  const buckets = q.islem != null ? [parseInt(q.islem, 10)] : [1, 2];

  const byCode = new Map();
  const meta = [];
  try {
    for (const islem of buckets) {
      let resp;
      try { resp = await fetchBucket(fundType, sfonTurKod, islem); }
      catch (e) { meta.push({ islem, error: String(e) }); continue; }
      meta.push({ islem, status: resp.status, count: resp.arr.length, sample: resp.ok ? undefined : resp.sample });
      for (const f of resp.arr) {
        const kod = f.fonKodu || '';
        if (!kod) continue;
        // Önce gören (islem=1) işlenir; varsa tefas=true kalır, çakışırsa görene öncelik
        if (!byCode.has(kod)) {
          byCode.set(kod, {
            kod, ad: f.fonUnvan || '', tur: f.fonTurAciklama || '',
            tefas: islem === 1,
            risk: f.riskDegeri != null ? String(f.riskDegeri) : '',
            g1a: num(f.getiri1a), g3a: num(f.getiri3a), g6a: num(f.getiri6a),
            gyb: num(f.getiriyb), g1y: num(f.getiri1y), g3y: num(f.getiri3y), g5y: num(f.getiri5y),
          });
        }
      }
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: 'TEFAS isteği başarısız: ' + String(e) });
    return;
  }

  const funds = Array.from(byCode.values());
  if (debug) { res.status(200).json({ ok: true, buckets: meta, total: funds.length, sample: funds.slice(0, 3) }); return; }
  if (funds.length === 0) { res.status(502).json({ ok: false, error: 'TEFAS boş döndü', buckets: meta }); return; }
  res.status(200).json({ ok: true, count: funds.length, funds });
};
