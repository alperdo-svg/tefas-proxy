/**
 * TEFAS Fon Tarayıcı / Getiri Karşılaştırma — Vercel Serverless Proxy
 * ------------------------------------------------------------------
 * TOKEN GEREKTİRMEYEN resmi dışa-aktarma endpoint'ini kullanır:
 *   POST https://www.tefas.gov.tr/api/fund-returns/export
 *   Gövde: application/json
 *
 * Yanıt: doğrudan bir dizi -> [{ fonKodu, fonUnvan, fonTurAciklama, riskDegeri,
 *        getiri1a, getiri3a, getiri6a, getiriyb, getiri1y, getiri3y, getiri5y }, ...]
 *
 * KULLANIM:
 *   GET /api/fonlar                 -> tüm YAT fonları (her tür)
 *   GET /api/fonlar?sfonturkod=107  -> sadece Para Piyasası Şemsiye
 *   GET /api/fonlar?fontip=EMK      -> emeklilik fonları
 *   GET /api/fonlar?debug=1         -> ham TEFAS yanıtı (teşhis)
 *
 * DÖNÜŞ: { ok, count, funds: [{ kod, ad, tur, tefas, risk, g1a, g3a, g6a, gyb, g1y, g3y, g5y }] }
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
  for (const k of ['data', 'resultList', 'list', 'result', 'rows']) {
    if (Array.isArray(j[k])) return j[k];
  }
  for (const k of Object.keys(j)) if (Array.isArray(j[k])) return j[k];
  return [];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = req.query || {};
  const fundType = String(q.fontip || 'YAT');
  const sfonTurKod = q.sfonturkod ? String(q.sfonturkod) : null; // null = tüm türler
  const islem = q.islem != null ? parseInt(q.islem, 10) : 1;
  const debug = q.debug === '1';

  const payload = {
    format: 'json',
    listingType: 'return',
    fundType,
    locale: 'tr',
    columns: ['fonKodu', 'fonUnvan', 'fonTurAciklama', 'riskDegeri', 'getiri1a', 'getiri3a', 'getiri6a', 'getiriyb', 'getiri1y', 'getiri3y', 'getiri5y'],
    filters: {
      kurucuKodu: null, fonTurKod: null, fonGrubu: null, fonTurAciklama: null,
      sfonTurKod, islem, calismaTipi: 2, getiriOrani: '1',
      donemGetiri1a: '1', donemGetiri1y: '1', donemGetiri3a: '1', donemGetiri3y: '1',
      donemGetiri5y: '1', donemGetiri6a: '1', donemGetiriyb: '1',
    },
  };

  let r, text;
  try {
    r = await fetch(TEFAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        Referer: 'https://www.tefas.gov.tr/',
        Origin: 'https://www.tefas.gov.tr',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
      body: JSON.stringify(payload),
    });
    text = await r.text();
  } catch (e) {
    res.status(502).json({ ok: false, error: 'TEFAS isteği başarısız: ' + String(e) });
    return;
  }

  let json;
  try { json = JSON.parse(text); }
  catch { res.status(502).json({ ok: false, error: 'TEFAS yanıtı JSON değil (HTTP ' + r.status + ')', sample: text.slice(0, 400) }); return; }

  if (debug) { res.status(200).json({ ok: true, httpStatus: r.status, sample: pickArray(json).slice(0, 2), raw: Array.isArray(json) ? '[' + json.length + ' kayıt]' : json }); return; }

  const arr = pickArray(json);
  const funds = arr.map((f) => ({
    kod: f.fonKodu || '',
    ad: f.fonUnvan || '',
    tur: f.fonTurAciklama || '',
    tefas: f.tefasDurum === undefined ? true : (f.tefasDurum === true || f.tefasDurum === 1 || f.tefasDurum === '1'),
    risk: f.riskDegeri != null ? String(f.riskDegeri) : '',
    g1a: num(f.getiri1a), g3a: num(f.getiri3a), g6a: num(f.getiri6a),
    gyb: num(f.getiriyb), g1y: num(f.getiri1y), g3y: num(f.getiri3y), g5y: num(f.getiri5y),
  })).filter((f) => f.kod);

  res.status(200).json({ ok: true, count: funds.length, funds });
};
