/**
 * TEFAS Proxy — Vercel Serverless Function (YENİ 2026 API)
 * --------------------------------------------------------
 * TEFAS 2026'da API'sini yeniledi; eski api/DB/BindHistoryInfo kaldırıldı.
 * Bu sürüm yeni endpoint'i kullanır:
 *   POST https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir
 *   Gövde (JSON): { fonKodu, dil:"TR", periyod }
 *   Cevap: { errorCode, errorMessage, resultList: [{ fiyat, tarih, fonKodu, fonUnvan }, ...] }
 *
 * KULLANIM:
 *   GET /api/tefas?fon=GAL              -> son 1 yıl (periyod=12)
 *   GET /api/tefas?fon=GAL&periyod=3    -> son 3 ay (1,3,6,12,36,60 geçerli)
 *   GET /api/tefas?fon=GAL&debug=1      -> teşhis
 *
 * DÖNÜŞ: { code, name, date, price, history: [{date, price}, ...] }
 *   date/price = en güncel gün; history = tüm günler (tarih artan sırada).
 */

const TEFAS_URL = 'https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir';
const VALID_PERIYOD = [1, 3, 6, 12, 36, 60];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const fon = String((req.query && req.query.fon) || '').toUpperCase().trim();
  let periyod = parseInt((req.query && req.query.periyod) || '12', 10);
  if (!VALID_PERIYOD.includes(periyod)) periyod = 12;
  const debug = (req.query && req.query.debug) === '1';

  if (!fon) {
    res.status(400).json({ error: 'fon parametresi gerekli. Örn: ?fon=GAL' });
    return;
  }

  let r, text;
  try {
    r = await fetch(TEFAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: 'https://www.tefas.gov.tr/',
        Origin: 'https://www.tefas.gov.tr',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
      body: JSON.stringify({ fonKodu: fon, dil: 'TR', periyod }),
    });
    text = await r.text();
  } catch (e) {
    res.status(502).json({ code: fon, error: 'TEFAS isteği başarısız: ' + String(e) });
    return;
  }

  let data = null;
  try { data = JSON.parse(text); } catch (e) {}

  if (debug) {
    res.status(200).json({
      fon,
      periyod,
      httpStatus: r.status,
      jsonParse: data ? 'OK' : 'BAŞARISIZ',
      errorCode: data ? data.errorCode : undefined,
      errorMessage: data ? data.errorMessage : undefined,
      kayitSayisi: data && Array.isArray(data.resultList) ? data.resultList.length : 0,
      ilkKayit: data && Array.isArray(data.resultList) ? data.resultList[0] : undefined,
      ilk300Karakter: text.slice(0, 300),
    });
    return;
  }

  const list = (data && Array.isArray(data.resultList)) ? data.resultList : [];
  if (!list.length) {
    res.status(404).json({
      code: fon,
      error: (data && data.errorMessage) || "Bu kod için veri bulunamadı.",
    });
    return;
  }

  // Tarihe göre artan sırala (TEFAS en güncel günü başa koyuyor)
  const history = list
    .map((x) => ({ date: String(x.tarih).slice(0, 10), price: Number(x.fiyat) }))
    .filter((h) => h.date && h.price > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!history.length) {
    res.status(404).json({ code: fon, error: 'Geçerli fiyat verisi yok.' });
    return;
  }

  const latest = history[history.length - 1];
  const name = list[0] && list[0].fonUnvan ? list[0].fonUnvan : null;

  res.status(200).json({
    code: fon,
    name,
    date: latest.date,
    price: latest.price,
    history,
  });
};
