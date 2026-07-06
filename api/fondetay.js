/**
 * Fon Detay (künye + varlık dağılımı) — TEŞHİS proxy'si (Vercel)
 * -------------------------------------------------------------
 * Amaç: Vercel sunucusundan TEFAS'a hangi yolla ulaşabildiğimizi görmek.
 * İki yol denenir ve HAM sonuç döndürülür (debug):
 *   1) Eski JSON ucu:  POST /api/DB/BindHistoryAllocation  (varlık dağılımı)
 *   2) Detay HTML sayfası: GET /tr/fon-detayli-analiz/KOD  (künye + dağılım gömülü)
 *
 * KULLANIM:
 *   /api/fondetay?kod=AAL&debug=1   -> ham teşhis (ne dönüyor görürüz)
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function pad(n) { return String(n).padStart(2, '0'); }
function dmy(d) { return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }

async function tryAllocation(kod) {
  const bit = new Date();
  const bas = new Date(Date.now() - 40 * 86400000);
  const body = `fontip=YAT&sfontur=&fonkod=${encodeURIComponent(kod)}&fongrup=&bastarih=${dmy(bas)}&bittarih=${dmy(bit)}&fonturkod=&fonunvantip=`;
  try {
    const r = await fetch('https://www.tefas.gov.tr/api/DB/BindHistoryAllocation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://www.tefas.gov.tr/FonAnaliz.aspx?FonKod=' + kod,
        Origin: 'https://www.tefas.gov.tr',
        'User-Agent': UA,
        'Accept-Language': 'tr-TR,tr;q=0.9',
      },
      body,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, ok: !!json, keys: json && json.data && json.data[0] ? Object.keys(json.data[0]) : null, sample: json && json.data ? json.data.slice(-1) : text.slice(0, 500) };
  } catch (e) { return { error: String(e) }; }
}

async function tryHtml(kod) {
  try {
    const r = await fetch('https://www.tefas.gov.tr/tr/fon-detayli-analiz/' + encodeURIComponent(kod), {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        Referer: 'https://www.tefas.gov.tr/',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    const html = await r.text();
    const rejected = html.includes('Request Rejected') || html.includes('support ID');
    const hasAlloc = html.includes('kıymetTip') || html.includes('k\\u0131ymetTip') || html.includes('portfoyOrani');
    const hasIsin = html.includes('isinCode') || html.includes('ISIN');
    // dağılım örneği çıkar
    let allocSnippet = null;
    const m = html.match(/.{0,40}portfoyOrani.{0,80}/);
    if (m) allocSnippet = m[0];
    let isinSnippet = null;
    const mi = html.match(/.{0,20}isinCode.{0,40}/);
    if (mi) isinSnippet = mi[0];
    return { status: r.status, len: html.length, rejected, hasAlloc, hasIsin, allocSnippet, isinSnippet, head: html.slice(0, 200) };
  } catch (e) { return { error: String(e) }; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const q = req.query || {};
  const kod = String(q.kod || 'AAL').toUpperCase();

  const [alloc, html] = await Promise.all([tryAllocation(kod), tryHtml(kod)]);
  res.status(200).json({ ok: true, kod, yontem1_BindHistoryAllocation: alloc, yontem2_HTML: html });
};
