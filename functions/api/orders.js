// Cloudflare Pages Function — proxies the Apps Script order log (GET + POST)
// Server-side so there are no CORS issues from the browser
//
// This endpoint is deliberately reachable by anonymous buyers, not just the
// admin dashboard — it's called from the public checkout flow in index.html
// (to log a real order right after payment, and to show "In N collections"
// social-proof counts on a print's detail page) as well as from the
// password-protected dashboard (to read/manage full order data).
// A blanket key requirement would have broken checkout, so instead:
//   - GET with a valid X-Dashboard-Key / ?key= → full order records (admin).
//   - GET without a key → the same data with buyer PII stripped out, since
//     that's all the public social-proof feature actually needs.
//   - POST "Order Received" without a key → only forwarded once the supplied
//     order_ref is confirmed as a real, successful Paystack transaction.
//   - POST "Update Buyer" without a key → requires buyer_email to accompany
//     order_ref; apps-script-order-log.js checks both match before writing
//     (that Apps Script file must be re-pasted into Apps Script by hand —
//     see CLAUDE.md).
// (security assessment, Finding 3, 2026-08-24)
export async function onRequest(context) {
  const { request, env } = context;
  const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyShJsvo8THYIXHqSqOvDxtCI4H2VfkVeoR32BZKF9i1shh2Kcdb4cX8cM1j1D2va51Zw/exec';

  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://jefferyasare.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key',
    'Cache-Control': 'no-store'
  };

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonHeaders = Object.assign({ 'Content-Type': 'application/json' }, corsHeaders);

  const suppliedKey = request.headers.get('X-Dashboard-Key') || new URL(request.url).searchParams.get('key');
  const isAdmin = !!env.DASHBOARD_KEY && suppliedKey === env.DASHBOARD_KEY;

  async function verifiedPaystackReference(reference) {
    if (!reference || !env.PAYSTACK_SECRET_KEY) return false;
    try {
      const verify = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } }
      );
      const vData = await verify.json();
      return !!vData.status && vData.data?.status === 'success';
    } catch (e) {
      console.error('orders.js Paystack verify error:', e);
      return false; // fail closed — unlike the webhook's old behavior
    }
  }

  // ── POST — forward to Apps Script doPost ──────────────────────────
  if (request.method === 'POST') {
    let payload;
    try { payload = JSON.parse(await request.text()); }
    catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders }); }

    if (!isAdmin) {
      // Anonymous callers may only log or amend an order tied to a real,
      // successfully-verified Paystack transaction.
      if (payload.action === 'Order Received') {
        const ok = await verifiedPaystackReference(payload.order_ref);
        if (!ok) return new Response(JSON.stringify({ error: 'Could not verify this order with Paystack.' }), { status: 403, headers: jsonHeaders });
      } else if (payload.action === 'Update Buyer') {
        if (!payload.order_ref || !payload.buyer_email) {
          return new Response(JSON.stringify({ error: 'order_ref and buyer_email are both required.' }), { status: 400, headers: jsonHeaders });
        }
        // apps-script-order-log.js cross-checks buyer_email against the
        // existing row before applying this — see note above.
      } else {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
      }
    }

    try {
      const resp = await fetch(SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  // ── GET — return orders as JSON (full for admin, PII-stripped otherwise) ──
  try {
    const resp = await fetch(SHEET_URL + '?action=getOrders', { redirect: 'follow' });
    const data = await resp.json();

    if (isAdmin || !Array.isArray(data)) {
      return new Response(JSON.stringify(data), { headers: jsonHeaders });
    }

    // Public callers only get what the "In N collections" social-proof
    // feature actually needs — no names, emails, prices, or references.
    const stripped = data.map(row => ({
      'Print Title': row['Print Title'] || row.print_title || '',
      'Country': row['Country'] || row.country || ''
    }));
    return new Response(JSON.stringify(stripped), { headers: jsonHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.toString() }), {
      status: 502, headers: jsonHeaders
    });
  }
}
