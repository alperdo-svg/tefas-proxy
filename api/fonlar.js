/**
 * TEFAS Fon Tarayıcı / Getiri Karşılaştırma — Vercel Serverless Proxy
 * ------------------------------------------------------------------
 * TEFAS "Fon Getirileri" listesini çeker (tüm fonlar + dönemsel getiriler).
 *   POST https://www.tefas.gov.tr/api/funds/fonGetiriBilgiGetir
 *
 * KULLANIM:
 *   GET /api/fonlar                      -> tüm YAT fonları (her tür, işlem gören+görmeyen)
 *   GET /api/fonlar?sfonturkod=107       -> sadece Para Piyasası Şemsiye
 *   GET /api/fonlar?fontipi=EMK          -> emeklilik fonları
 *
 * DÖNÜŞ: { ok, count, funds: [{ kod, ad, tur, tefas, risk, g1a, g3a, g6a, gyb, g1y, g3y, g5y }] }
 */

const TEFAS_URL = 'https://www.tefas.gov.tr/api/funds/fonGetiriBilgiGetir';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

// Yanıttaki fon dizisini bul (sarmalayıcı anahtar adı değişebilir)
function pickArray(j) {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== 'object') return [];
  for (const k of ['resultList', 'data', 'fundReturnList', 'list', 'fonGetiriList', 'result']) {
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
  const fonTipi = String(q.fontipi || 'YAT');
  const sfonTurKod = q.sfonturkod ? String(q.sfonturkod) : null; // null = tüm türler
  const islem = q.islem != null ? parseInt(q.islem, 10) : 1;
  const debug = q.debug === '1';

  const payload = {
    dil: 'TR', fonTipi, kurucuKodu: null, sfonTurKod,
    fonTurAciklama: null, fonTurKod: null, fonGrubu: null,
    calismaTipi: 2, islem, getiriOrani: '1', basTarih: null, bitTarih: null,
    donemGetiri1a: '1', donemGetiri3a: '1', donemGetiri6a: '1',
    donemGetiriyb: '1', donemGetiri1y: '1', donemGetiri3y: '1', donemGetiri5y: '1',
  };

  let r, text;
  try {
    r = await fetch(TEFAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
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
  catch { res.status(502).json({ ok: false, error: 'TEFAS yanıtı JSON değil', sample: text.slice(0, 300) }); return; }

  if (debug) { res.status(200).json({ ok: true, raw: json }); return; }

  const arr = pickArray(json);
  const funds = arr.map((f) => ({
    kod: f.fonKodu || f.FONKODU || f.kod || '',
    ad: f.fonUnvan || f.FONUNVAN || f.ad || '',
    tur: f.fonTurAciklama || f.FONTURACIKLAMA || f.tur || '',
    tefas: (f.tefasDurum === true || f.tefasDurum === 1 || f.tefasDurum === '1'),
    risk: f.riskDegeri != null ? String(f.riskDegeri) : '',
    g1a: num(f.getiri1a), g3a: num(f.getiri3a), g6a: num(f.getiri6a),
    gyb: num(f.getiriyb), g1y: num(f.getiri1y), g3y: num(f.getiri3y), g5y: num(f.getiri5y),
  })).filter((f) => f.kod);

  res.status(200).json({ ok: true, count: funds.length, funds });
};
