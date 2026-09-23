// Cloudflare Pages Function — tells the storefront how many of each print
// have actually sold, so the "N remaining" count on the Shop page, a
// print's own page, and the Certificate of Authenticity update themselves
// instead of relying on someone remembering to type a number into the CMS
// after every sale.
//
// Reuses the same Google Sheet the dashboard already reads (see
// apps-script-order-log.js) rather than adding a second place order data
// has to be kept in sync. Only counts rows logged as "Order Received" —
// the same order gets a later row for "Shipped", "COA Sent", and
// "Follow-up Sent" as it moves through its life, and counting those too
// would make a single sale look like three or four.
//
// Public and read-only: this returns only a title → quantity-sold map, no
// buyer names, emails, or prices, so — unlike /api/orders — it needs no
// admin key and is safe for the storefront to call on every page load.
export async function onRequestGet(context) {
  const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyShJsvo8THYIXHqSqOvDxtCI4H2VfkVeoR32BZKF9i1shh2Kcdb4cX8cM1j1D2va51Zw/exec';

  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://jefferyasare.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    // Short cache: keeps this from hammering Apps Script on every visitor's
    // page load, while still catching up within a couple of minutes of a
    // real sale — nobody's refreshing the shop page waiting on this.
    'Cache-Control': 'public, max-age=120'
  };
  const jsonHeaders = Object.assign({ 'Content-Type': 'application/json' }, corsHeaders);

  try {
    const resp = await fetch(SHEET_URL, { redirect: 'follow' });
    const rows = await resp.json();

    const sold = {};
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const action = String(row['Action'] || '').trim();
        if (action !== 'Order Received') continue;
        const title = String(row['Print Title'] || '').trim();
        if (!title) continue;
        const qty = parseInt(row['Qty'], 10) || 1;
        sold[title] = (sold[title] || 0) + qty;
      }
    }

    return new Response(JSON.stringify({ sold }), { headers: jsonHeaders });
  } catch (e) {
    // Cloudflare's edge swallows a Worker-returned 502/503/504 and replaces
    // it with its own generic error page (see orders.js for the same note)
    // — 500 isn't one of the intercepted codes, so the real error reaches
    // the caller instead of a blank/garbled response.
    console.error('prints-sold.js error:', e);
    return new Response(JSON.stringify({ error: e.toString(), sold: {} }), {
      status: 500, headers: jsonHeaders
    });
  }
}

export async function onRequestOptions(context) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://jefferyasare.com',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
  });
}
