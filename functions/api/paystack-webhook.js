// Cloudflare Pages Function — receives Paystack payment events
// and auto-logs orders to Google Sheets so the dashboard stays in sync.
//
// Required env var (Cloudflare Pages → Settings → Environment variables):
//   PAYSTACK_SECRET_KEY — your test or live secret key (sk_test_... or sk_live_...)
//
// Webhook URL to paste in Paystack (Test mode):
//   https://jefferyasare.com/api/paystack-webhook

const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyShJsvo8THYIXHqSqOvDxtCI4H2VfkVeoR32BZKF9i1shh2Kcdb4cX8cM1j1D2va51Zw/exec';

export async function onRequestPost(context) {
  const { request, env } = context;

  // Parse incoming Paystack event
  let event;
  try {
    event = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // Always return 200 quickly — Paystack retries if it doesn't get one
  // (we process async below but the response is sent first via a trick:
  //  we use context.waitUntil so Cloudflare keeps the worker alive)
  const processEvent = async () => {
    // Only act on successful charges
    if (event.event !== 'charge.success') return;

    const data          = event.data || {};
    const reference     = data.reference || '';
    const customer      = data.customer || {};
    const customFields  = (data.metadata?.custom_fields) || [];

    const getField = (name) => {
      const f = customFields.find(f => f.variable_name === name);
      return f ? String(f.value) : '';
    };

    const printTitle = getField('print');
    const size       = getField('size');
    const qty        = getField('qty') || '1';
    const buyerEmail = customer.email || '';
    const firstName  = customer.first_name || '';
    const lastName   = customer.last_name || '';
    const buyerName  = [firstName, lastName].filter(Boolean).join(' ')
                       || buyerEmail.split('@')[0];

    const amountGHS = (data.amount || 0) / 100;
    const currency  = data.currency || 'GHS';
    const paidStr   = currency === 'GHS'
      ? 'GH₵ ' + amountGHS.toLocaleString()
      : currency + ' ' + amountGHS;

    // Verify the transaction with Paystack before trusting it
    const PAYSTACK_SECRET_KEY = env.PAYSTACK_SECRET_KEY;
    if (PAYSTACK_SECRET_KEY && reference) {
      try {
        const verify = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
          { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
        );
        const vData = await verify.json();
        if (!vData.status || vData.data?.status !== 'success') {
          console.error('Paystack verify failed:', JSON.stringify(vData));
          return; // Don't log unverified transactions
        }
      } catch (e) {
        console.error('Paystack verify error:', e);
        // Allow through if verify endpoint is unreachable — rare edge case
      }
    }

    // Log to Google Sheets (same action the frontend uses)
    // Note: the frontend also logs on payment, so this acts as a safety net
    // in case the buyer's browser closed before the callback fired.
    try {
      await fetch(SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:       'Order Received',
          buyer_name:   buyerName,
          buyer_email:  buyerEmail,
          print_title:  printTitle,
          size:         size,
          country:      '',
          price:        paidStr,
          qty:          qty,
          notes:        `[webhook] ${printTitle} | ${size} x${qty}`,
          order_ref:    reference
        }),
        redirect: 'follow'
      });
    } catch (e) {
      console.error('Webhook sheet log error:', e);
    }
  };

  // Fire the processing without blocking the 200 response
  context.waitUntil(processEvent());

  return new Response('OK', { status: 200 });
}

// Paystack sends POST only, but handle OPTIONS just in case
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
