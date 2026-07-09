// Cloudflare Pages Function — proxies the Apps Script order log
// Runs server-side so there's no CORS issue fetching from Google
export async function onRequest(context) {
  const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyShJsvo8THYIXHqSqOvDxtCI4H2VfkVeoR32BZKF9i1shh2Kcdb4cX8cM1j1D2va51Zw/exec';

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  };

  try {
    const resp = await fetch(SHEET_URL + '?action=getOrders', {
      redirect: 'follow'
    });
    const data = await resp.json();
    return new Response(JSON.stringify(data), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.toString() }), {
      status: 502, headers
    });
  }
}
