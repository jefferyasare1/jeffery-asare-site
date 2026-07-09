// Cloudflare Pages Function — proxies the Apps Script order log (GET + POST)
// Server-side so there are no CORS issues from the browser
export async function onRequest(context) {
  const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyShJsvo8THYIXHqSqOvDxtCI4H2VfkVeoR32BZKF9i1shh2Kcdb4cX8cM1j1D2va51Zw/exec';

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };

  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonHeaders = Object.assign({ 'Content-Type': 'application/json' }, corsHeaders);

  // ── POST — forward to Apps Script doPost ──────────────────────────
  if (context.request.method === 'POST') {
    try {
      const body = await context.request.text();
      const resp = await fetch(SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'follow'
      });
      const data = await resp.json();
      return new Response(JSON.stringify(data), { headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.toString() }), {
        status: 502, headers: jsonHeaders
      });
    }
  }

  // ── GET — return all orders as JSON ───────────────────────────────
  try {
    const resp = await fetch(SHEET_URL + '?action=getOrders', { redirect: 'follow' });
    const data = await resp.json();
    return new Response(JSON.stringify(data), { headers: jsonHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.toString() }), {
      status: 502, headers: jsonHeaders
    });
  }
}
