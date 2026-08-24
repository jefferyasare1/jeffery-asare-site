// Cloudflare Pages Function — receives Paystack payment events
// and auto-logs orders to Google Sheets so the dashboard stays in sync.
//
// Required env var (Cloudflare Pages → Settings → Environment variables):
//   PAYSTACK_SECRET_KEY — your test or live secret key (sk_test_... or sk_live_...)
//
// Webhook URL to paste in Paystack (Test mode):
//   https://jefferyasare.com/api/paystack-webhook

const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyShJsvo8THYIXHqSqOvDxtCI4H2VfkVeoR32BZKF9i1shh2Kcdb4cX8cM1j1D2va51Zw/exec';

// Paystack signs every webhook body with HMAC-SHA512 using your secret key,
// sent as the x-paystack-signature header — this was never checked before,
// meaning any POST claiming to be a successful charge got the same treatment
// as a real one, modulo the secondary verify-API call below.
// (security assessment, Finding 7, 2026-08-24)
// Source: https://paystack.com/docs/payments/webhooks/
async function verifyPaystackSignature(rawBody, signatureHeader, secretKey) {
  if (!signatureHeader || !secretKey) return false;
  const keyData = new TextEncoder().encode(secretKey);
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  // Constant-time-ish comparison — length check first, then char-by-char
  if (computedHex.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Read the raw body once — needed for signature verification, then parsed
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');
  const signatureOk = await verifyPaystackSignature(rawBody, signature, env.PAYSTACK_SECRET_KEY);
  if (!signatureOk) {
    console.error('paystack-webhook: signature verification failed or missing');
    return new Response('Invalid signature', { status: 401 });
  }

  // Parse incoming Paystack event
  let event;
  try {
    event = JSON.parse(rawBody);
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
        // Previously this fell through and logged the order anyway on a
        // network error — a transient blip on Paystack's verify endpoint
        // would have silently turned into a free, unverified order. Now it
        // fails closed: the signature check above already confirmed this
        // request came from Paystack, but skip logging until verify
        // actually succeeds, and record it for manual follow-up instead of
        // trusting it. (security assessment, Finding 7, 2026-08-24)
        console.error('Paystack verify error — order NOT logged, needs manual check:', reference, e);
        return;
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
