/**
 * Fon Detay (künye + varlık dağılımı) — TEŞHİS proxy'si v2 (Vercel)
 * -----------------------------------------------------------------
 * DÜZELTME: Eski teşhis iki YANLIŞ kapıyı test ediyordu:
 *   1) /api/DB/BindHistoryAllocation  -> EMEKLİ metod (gateway 404: "disabled")
 *   2) /tr/fon-detayli-analiz/KOD     -> HTML sayfası (WAF "Request Rejected")
 *
 * Oysa varlık dağılımı + künye, tıpkı fiyat gibi CANLI /api/funds/* JSON
 * uçlarında. Kanıt: tefas.js zaten /api/funds/fonFiyatBilgiGetir'i Vercel'den
 * TOKENSIZ çekiyor -> bu namespace WAF'ı geçiyor. Aynı desen:
 *   POST /api/funds/dagilimSiraliGetirT   -> varlık dağılımı (50+ yüzde)
 *   POST /api/funds/fonProfilDtyGetir     -> künye/profil
 *   POST /api/funds/fonGnlBlgSiraliGetir  -> genel bilgi (fiyat/büyüklük/yatırımcı/ISIN?)
 *
 * KULLANIM:  /api/fondetay?kod=AAL   (ham teşhis JSON döner)
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// tefas.js'te ÇALIŞTIĞI kanıtlanan header seti — WAF'ı geçen tam kombinasyon.
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Referer: 'https://www.tefas.gov.tr/',
  Origin: 'https://www.tefas.gov.tr',
  'Accept-Language': 'tr-TR,tr;q=0.9',
  'User-Agent': UA,
};

function ymd(d) {
  return (
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

async function post(url, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, sample: json ? undefined : text.slice(0, 400) };
  } catch (e) {
    return { error: String(e) };
  }
}

// "SiraliGetir" metodları için ortak gövde iskeleti (fon koduna filtre + tarih aralığı)
function siraliBody(kod, bas, bit) {
  return {
    fonTipi: 'YAT',
    fonKodu: kod,
    basTarih: bas,
    bitTarih: bit,
    basSira: 1,
    bitSira: 100000,
    dil: 'TR',
    aramaMetni: null,
    fonTurKod: null,
    fonGrubu: null,
    sfonTurKod: null,
    fonTurAciklama: null,
    kurucuKod: null,
    sFonTurKod: '',
    fonKod: '',
    fonGrup: '',
    fonUnvanTip: '',
  };
}

// Varlık dağılımı: son ~12 günü çekip EN GÜNCEL satırı al (hafta sonu/tatil güvenli)
async function tryDagilim(kod) {
  const bit = ymd(new Date());
  const bas = ymd(new Date(Date.now() - 12 * 86400000));
  const res = await post(
    'https://www.tefas.gov.tr/api/funds/dagilimSiraliGetirT',
    siraliBody(kod, bas, bit)
  );
  if (res.json && Array.isArray(res.json.resultList)) {
    const rows = res.json.resultList;
    const latest = rows[rows.length - 1] || null;
    return { status: res.status, kayit: rows.length, keys: latest ? Object.keys(latest) : null, sonSatir: latest };
  }
  return res;
}

// Künye/profil: TAM response'u ham dök (roadmap adım 1). Body deseni fiyat ucuyla aynı.
async function tryProfil(kod) {
  const res = await post('https://www.tefas.gov.tr/api/funds/fonProfilDtyGetir', {
    fonKodu: kod,
    dil: 'TR',
  });
  if (res.json) return { status: res.status, keys: Object.keys(res.json), tam: res.json };
  return res;
}

// Genel bilgi: ISIN / fon büyüklüğü / yatırımcı sayısı burada olabilir
async function tryGenel(kod) {
  const g = ymd(new Date());
  const res = await post(
    'https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir',
    siraliBody(kod, g, g)
  );
  if (res.json && Array.isArray(res.json.resultList)) {
    const row = res.json.resultList[res.json.resultList.length - 1] || null;
    return { status: res.status, keys: row ? Object.keys(row) : null, sonSatir: row };
  }
  return res;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  const kod = String((req.query && req.query.kod) || 'AAL').toUpperCase();

  const [dagilim, profil, genel] = await Promise.all([
    tryDagilim(kod),
    tryProfil(kod),
    tryGenel(kod),
  ]);
  res.status(200).json({ ok: true, kod, dagilim, profil, genel });
};
