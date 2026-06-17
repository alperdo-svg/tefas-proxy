/**
 * TEFAS Fon Tarayıcı / Getiri Karşılaştırma — Vercel Serverless Proxy
 * ------------------------------------------------------------------
 * Token gerektirmeyen KLASİK karşılaştırma servisini kullanır:
 *   POST https://www.tefas.gov.tr/api/DB/BindComparisonFundReturns
 *   Gövde: application/x-www-form-urlencoded
 *
 * (Yeni api/funds/fonGetiriBilgiGetir endpoint'i Apinizer + CAS Bearer token
 *  istediği için sunucudan kullanılamıyor; bu klasik servis token istemez.)
 *
 * KULLANIM:
 *   GET /api/fonlar                 -> tüm YAT fonları (her tür, işlem gören+görmeyen)
 *   GET /api/fonlar?sfontur=107     -> sadece Para Piyasası Şemsiye
 *   GET /api/fonlar?debug=1         -> ham TEFAS yanıtı (teşhis)
 *
 * DÖNÜŞ: { ok, count, funds: [{ kod, ad, tur, tefas, risk, g1a, g3a, g6a, gyb, g1y, g3y, g5y }] }
 */

const TEFAS_URL = 'https://www.tefas.gov.tr/api/DB/BindComparisonFundReturns';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
  // Not: TEFAS bu serviste genelde nokta ondalık döndürür; yukarıdaki dönüşüm TR formatına da dayanıklı.
  const n2 = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  const out = isNaN(n2) ? (isNaN(n) ? null : n) : n2;
  return out;
}

function pickArray(j) {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== 'object') return [];
  for (const k of ['data', 'resultList', 'fundReturnList', 'list', 'result', 'Data']) {
    if (Array.isArray(j[k])) return j[k];
  }
  for (const k of Object.keys(j)) if (Array.isArray(j[k])) return j[k];
  return [];
}

// Bir fon nesnesinden, ismi büyük/küçük harf ve stil farkına dayanıklı şekilde alan çek
function pick(o, names) {
  for (const n of names) {
    if (o[n] !== undefined && o[n] !== null) return o[n];
    // büyük/küçük harf duyarsız ara
    const k = Object.keys(o).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = req.query || {};
  const fontip = String(q.fontip || 'YAT');
  const sfontur = q.sfontur ? String(q.sfontur) : '';        // boş = tüm türler
  const islemdurum = q.islemdurum != null ? String(q.islemdurum) : ''; // boş = tümü
  const debug = q.debug === '1';

  const form = new URLSearchParams({
    calismatipi: '2',
    fontip,
    sfontur,
    kurucukod: '',
    fongrup: '',
    bastarih: 'Başlangıç',
    bittarih: 'Bitiş',
    fonturkod: '',
    fonunvantip: '',
    strperiod: '1,1,1,1,1,1,1',
    islemdurum,
  });

  let r, text;
  try {
    r = await fetch(TEFAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://www.tefas.gov.tr/FonKarsilastirma.aspx',
        Origin: 'https://www.tefas.gov.tr',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
      body: form.toString(),
    });
    text = await r.text();
  } catch (e) {
    res.status(502).json({ ok: false, error: 'TEFAS isteği başarısız: ' + String(e) });
    return;
  }

  let json;
  try { json = JSON.parse(text); }
  catch { res.status(502).json({ ok: false, error: 'TEFAS yanıtı JSON değil (HTTP ' + r.status + ')', sample: text.slice(0, 400) }); return; }

  if (debug) { res.status(200).json({ ok: true, httpStatus: r.status, raw: json }); return; }

  const arr = pickArray(json);
  const funds = arr.map((f) => {
    const tefasVal = pick(f, ['TEFASDURUM', 'tefasDurum', 'BORSADAISLEMDURUMU', 'ISLEMDURUM']);
    return {
      kod: pick(f, ['FONKODU', 'fonKodu', 'kod']) || '',
      ad: pick(f, ['FONUNVAN', 'fonUnvan', 'ad']) || '',
      tur: pick(f, ['FONUNVANTIP', 'fonTurAciklama', 'SFONTURACIKLAMA', 'FONTURACIKLAMA', 'tur']) || '',
      tefas: tefasVal === undefined ? true : (tefasVal === true || tefasVal === 1 || tefasVal === '1' || String(tefasVal).toLowerCase() === 'true'),
      risk: (() => { const x = pick(f, ['RISKDEGERI', 'riskDegeri', 'risk']); return x != null ? String(x) : ''; })(),
      g1a: num(pick(f, ['GETIRI1A', 'getiri1a', 'GETIRIORANI1A'])),
      g3a: num(pick(f, ['GETIRI3A', 'getiri3a'])),
      g6a: num(pick(f, ['GETIRI6A', 'getiri6a'])),
      gyb: num(pick(f, ['GETIRIYB', 'getiriyb', 'GETIRIYILBASI'])),
      g1y: num(pick(f, ['GETIRI1Y', 'getiri1y'])),
      g3y: num(pick(f, ['GETIRI3Y', 'getiri3y'])),
      g5y: num(pick(f, ['GETIRI5Y', 'getiri5y'])),
    };
  }).filter((f) => f.kod);

  res.status(200).json({ ok: true, count: funds.length, funds });
};
