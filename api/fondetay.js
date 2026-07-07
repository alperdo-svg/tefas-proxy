/**
 * Fon Detay (künye + varlık dağılımı) — ÜRETİM ucu (Vercel)
 * ---------------------------------------------------------
 * İki CANLI /api/funds/* JSON ucunu token'sız birleştirir:
 *
 *   POST /api/funds/dagilimSiraliGetirT   -> varlık dağılımı (donut)
 *   POST /api/funds/fonGnlBlgSiraliGetir  -> fiyat / büyüklük / yatırımcı / pay
 *
 * NOTLAR (teşhisle kanıtlandı):
 *   - dagilimSiraliGetirT `fonKodu` filtresini YOK SAYIYOR (tüm fonları döner)
 *     -> resultList'i client-side `fonKodu === kod` ile süzüyoruz.
 *   - Dağılım verisi ~12 gün GECİKMELİ -> geniş pencere (25 gün) sorgulayıp
 *     fonun EN GÜNCEL tarihli satırını alıyoruz.
 *   - fonGnlBlgSiraliGetir `fonKodu` filtresine SAYGI duyuyor -> hafif sorgu.
 *   - ISIN + tam künye için fonProfilDtyGetir ayrı (gövdesi henüz netleşmedi).
 *
 * KULLANIM:
 *   GET /api/fondetay?kod=AAL          -> temiz detay JSON
 *   GET /api/fondetay?kod=AAL&tip=EMK  -> emeklilik fonu
 *   GET /api/fondetay?kod=AAL&debug=1  -> ham teşhis
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Referer: 'https://www.tefas.gov.tr/',
  Origin: 'https://www.tefas.gov.tr',
  'Accept-Language': 'tr-TR,tr;q=0.9',
  'User-Agent': UA,
};

// Dağılım kısa kodları -> okunabilir TR etiketler (yüzde alanları)
const ETIKET = {
  hs: 'Hisse Senedi',
  dt: 'Devlet Tahvili',
  hb: 'Hazine Bonosu',
  fb: 'Finansman Bonosu',
  ost: 'Özel Sektör Borçlanma',
  bb: 'Banka Bonosu',
  vdm: 'Varlığa Dayalı Menkul Kıymet',
  eut: 'Eurobond',
  kibd: 'Kamu Dış Borçlanma',
  osdb: 'Özel Sektör Dış Borçlanma',
  kba: 'Kamu Döviz İç Borçlanma',
  dot: 'Döviz Ödemeli Bono',
  db: 'Döviz Ödemeli Tahvil',
  tpp: 'Takasbank Para Piyasası',
  bpp: 'BİST Para Piyasası',
  btaa: 'BİST Taahhütlü Alım',
  btas: 'BİST Taahhütlü Satım',
  r: 'Repo',
  tr: 'Ters Repo',
  vm: 'Vadeli Mevduat',
  vmtl: 'Vadeli Mevduat (TL)',
  vmd: 'Vadeli Mevduat (Döviz)',
  vmau: 'Vadeli Mevduat (Altın)',
  kh: 'Katılma Hesabı',
  khtl: 'Katılma Hesabı (TL)',
  khd: 'Katılma Hesabı (Döviz)',
  khau: 'Katılma Hesabı (Altın)',
  kks: 'Kamu Kira Sertifikası',
  kkstl: 'Kamu Kira Sertifikası (TL)',
  kksd: 'Kamu Kira Sertifikası (Döviz)',
  kksyd: 'Kamu Yabancı Kira Sertifikası',
  osks: 'Özel Sektör Kira Sertifikası',
  oksyd: 'Özel Sektör Yabancı Kira Sertifikası',
  km: 'Kıymetli Maden',
  kmbyf: 'Kıymetli Maden BYF',
  kmkba: 'Kıymetli Maden Kamu Borçlanma',
  kmkks: 'Kıymetli Maden Kira Sertifikası',
  ymk: 'Yabancı Menkul Kıymet',
  yba: 'Yabancı Borçlanma Aracı',
  ybkb: 'Yabancı Kamu Borçlanma',
  ybosb: 'Yabancı Özel Sektör Borçlanma',
  yhs: 'Yabancı Hisse Senedi',
  ybyf: 'Yabancı BYF',
  fkb: 'Fon Katılma Payı',
  yyf: 'Yatırım Fonu Katılma Payı',
  byf: 'Borsa Yatırım Fonu',
  gykb: 'Gayrimenkul Yatırım Fonu',
  gyy: 'Gayrimenkul Yatırımı',
  gsykb: 'Girişim Sermayesi Yatırım Fonu',
  gsyy: 'Girişim Sermayesi Yatırımı',
  t: 'Türev Araç',
  vint: 'Vadeli İşlem Nakit Teminatı',
  gas: 'Gayrimenkul Sertifikası',
  d: 'Diğer',
};

function ymd(d) {
  return (
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

async function postFunds(method, body) {
  const r = await fetch('https://www.tefas.gov.tr/api/funds/' + method, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return {
    status: r.status,
    list: json && Array.isArray(json.resultList) ? json.resultList : [],
    raw: json,
    sample: json ? undefined : text.slice(0, 300),
  };
}

function siraliBody(kod, tip, bas, bit) {
  return {
    fonTipi: tip, fonKodu: kod, basTarih: bas, bitTarih: bit,
    basSira: 1, bitSira: 100000, dil: 'TR',
    aramaMetni: null, fonTurKod: null, fonGrubu: null, sfonTurKod: null,
    fonTurAciklama: null, kurucuKod: null,
    sFonTurKod: '', fonKod: '', fonGrup: '', fonUnvanTip: '',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = req.query || {};
  const kod = String(q.kod || '').toUpperCase().trim();
  const tip = String(q.fontip || q.tip || 'YAT');
  const debug = q.debug === '1';
  if (!kod) { res.status(400).json({ ok: false, error: 'kod parametresi gerekli. Örn: ?kod=AAL' }); return; }

  const bugun = new Date();
  const genelBas = ymd(new Date(bugun - 6 * 86400000));   // fiyat/künye: 6 gün (hafta sonu güvenli)
  const dagBas = ymd(new Date(bugun - 25 * 86400000));    // dağılım: ~12 gün gecikme -> 25 gün pencere
  const bit = ymd(bugun);

  let genel, dagilim;
  try {
    [genel, dagilim] = await Promise.all([
      postFunds('fonGnlBlgSiraliGetir', siraliBody(kod, tip, genelBas, bit)),
      postFunds('dagilimSiraliGetirT', siraliBody(kod, tip, dagBas, bit)),
    ]);
  } catch (e) {
    res.status(502).json({ ok: false, kod, error: 'TEFAS isteği başarısız: ' + String(e) });
    return;
  }

  // --- Genel bilgi: fonKodu filtreli gelir; en güncel satırı al ---
  const gRows = genel.list; // zaten sadece bu fon
  const gLatest = gRows.length ? gRows.reduce((a, b) => (String(b.tarih) > String(a.tarih) ? b : a)) : null;

  // --- Dağılım: TÜM fonlar gelir -> bu fonu süz -> en güncel tarih ---
  const dRows = dagilim.list.filter((x) => String(x.fonKodu).toUpperCase() === kod);
  const dLatest = dRows.length ? dRows.reduce((a, b) => (String(b.tarih) > String(a.tarih) ? b : a)) : null;

  let dagilimList = [];
  let dagilimToplam = 0;
  if (dLatest) {
    for (const key of Object.keys(ETIKET)) {
      const v = num(dLatest[key]);
      if (v != null && v > 0) {
        dagilimList.push({ kod: key, ad: ETIKET[key], oran: +v.toFixed(2) });
        dagilimToplam += v;
      }
    }
    dagilimList.sort((a, b) => b.oran - a.oran);
  }

  if (debug) {
    res.status(200).json({
      ok: true, kod,
      genel: { status: genel.status, satir: gRows.length, latest: gLatest },
      dagilim: {
        status: dagilim.status,
        tumSatir: dagilim.list.length,
        fonSatir: dRows.length,
        latestTarih: dLatest && dLatest.tarih,
        list: dagilimList,
      },
    });
    return;
  }

  res.status(200).json({
    ok: true,
    kod,
    ad: gLatest ? gLatest.fonUnvan : null,
    tarih: gLatest ? String(gLatest.tarih).slice(0, 10) : null,
    fiyat: gLatest ? num(gLatest.fiyat) : null,
    buyukluk: gLatest ? num(gLatest.portfoyBuyukluk) : null,       // TL
    yatirimciSayisi: gLatest ? num(gLatest.kisiSayisi) : null,
    paySayisi: gLatest ? num(gLatest.tedPaySayisi) : null,
    isin: null,                                                     // TODO: fonProfilDtyGetir gövdesi netleşince
    dagilimTarihi: dLatest ? String(dLatest.tarih).slice(0, 10) : null,
    dagilimToplam: +dagilimToplam.toFixed(2),
    dagilim: dagilimList,                                           // [{ kod, ad, oran }] donut için hazır, azalan sırada
  });
};
