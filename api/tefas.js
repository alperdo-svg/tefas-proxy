/**
 * TEFAS Proxy — Vercel Serverless Function (sıfır ayar, CommonJS)
 * ---------------------------------------------------------------
 * Cloudflare TEFAS'ı çekemiyor (520). Vercel AWS üzerinde çalıştığı için sorun yok.
 *
 * KURULUM (tarayıcıdan, terminal gerekmez):
 *  1) github.com -> giriş/kayıt -> New repository (örn. "tefas-proxy", Public,
 *     "Add a README" işaretli) -> Create.
 *  2) Repo'da: Add file -> Create new file -> dosya adına  api/tefas.js  yaz
 *     (api/ yazınca klasör otomatik oluşur) -> bu dosyanın içeriğini yapıştır
 *     -> Commit changes.
 *  3) vercel.com -> "Continue with GitHub" -> Add New Project -> tefas-proxy
 *     repo'sunu Import -> Deploy (hiçbir ayar değiştirme).
 *  4) Adresin:  https://<proje>.vercel.app/api/tefas
 *     React panelinde:  const CUSTOM_PROXY = 'https://<proje>.vercel.app/api/tefas';
 *
 * TEST:  https://<proje>.vercel.app/api/tefas?fon=AFT
 * DÖNÜŞ: { code, name, date, price, history: [{date, price}, ...] }
 */

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const tarihToISO = (t) =>
  new Date(Number(t) + 12 * 3600 * 1000).toISOString().split('T')[0];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const fon = String((req.query && req.query.fon) || '').toUpperCase().trim();
  const gunRaw = parseInt((req.query && req.query.gun) || '8', 10);
  const gun = Math.min(isNaN(gunRaw) ? 8 : gunRaw, 1800);
  const debug = (req.query && req.query.debug) === '1';

  if (!fon) {
    res.status(400).json({ error: 'fon parametresi gerekli. Örn: ?fon=AFT' });
    return;
  }

  const bit = new Date();
  const bas = new Date(Date.now() - gun * 86400000);
  const diag = [];

  for (const fontip of ['YAT', 'EMK', 'BYF']) {
    const body = new URLSearchParams({
      fontip, sfontur: '', fonkod: fon, fongrup: '',
      bastarih: fmtDate(bas), bittarih: fmtDate(bit), fonturkod: '', fonunvantip: '',
    });

    let r, text;
    try {
      r = await fetch('https://www.tefas.gov.tr/api/DB/BindHistoryInfo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: 'https://www.tefas.gov.tr/FonAnaliz.aspx',
          Origin: 'https://www.tefas.gov.tr',
          'Accept-Language': 'tr-TR,tr;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        },
        body: body.toString(),
      });
      text = await r.text();
    } catch (e) {
      diag.push({ fontip, hata: String(e) });
      continue;
    }

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    const rows = (parsed && parsed.data) || [];

    if (debug) {
      diag.push({
        fontip,
        httpStatus: r.status,
        jsonParse: parsed ? 'OK' : 'BAŞARISIZ',
        satirSayisi: rows.length,
        ilk300Karakter: text.slice(0, 300),
      });
      continue;
    }

    if (rows.length) {
      rows.sort((a, b) => Number(b.TARIH) - Number(a.TARIH));
      const history = rows
        .map((x) => ({ date: tarihToISO(x.TARIH), price: Number(x.FIYAT) }))
        .filter((h) => h.price > 0);
      const latest = rows[0];
      res.status(200).json({
        code: fon,
        name: latest.FONUNVAN || null,
        date: tarihToISO(latest.TARIH),
        price: Number(latest.FIYAT),
        fontip,
        history,
      });
      return;
    }
  }

  if (debug) {
    res.status(200).json({ fon, tarihAraligi: `${fmtDate(bas)} - ${fmtDate(bit)}`, sonuc: diag });
    return;
  }
  res.status(404).json({ code: fon, error: "Bu kod TEFAS'ta bulunamadı (YAT/EMK/BYF)." });
};
