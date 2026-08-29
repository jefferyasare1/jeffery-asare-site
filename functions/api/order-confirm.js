// Cloudflare Pages Function — sends the branded "order confirmed" email
// to a buyer immediately after a successful Paystack payment, via Brevo.
//
// This replaces the old EmailJS "Blank Template" thank-you email, which
// did not carry the site's logo, font, or colours. Same branded pattern
// used everywhere else on the site (functions/api/send-coa.js,
// functions/api/notify.js and the dashboard's confirmShip/confirmFollowUp).
//
// Called only from the public checkout flow in index.html, right after
// Paystack's callback fires — so, like send-coa.js, it verifies the
// order_ref against Paystack itself rather than requiring a dashboard
// key (there is no admin session on the public checkout page).
// (pattern matches security assessment, Finding 4, 2026-08-24)

const ALLOWED_ORIGINS = ['https://jefferyasare.com', 'https://www.jefferyasare.com'];

export async function onRequestPost(context) {
  const { request, env } = context;

  const origin = request.headers.get('Origin') || '';
  const referer = request.headers.get('Referer') || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin === o || referer.startsWith(o));
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin || 'https://jefferyasare.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };
  const jsonHeaders = Object.assign({ 'Content-Type': 'application/json' }, corsHeaders);

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders });
  }

  const { to_email, to_name, print_title, size, qty, price, country, order_ref } = body;

  if (!to_email || !print_title || !order_ref) {
    return new Response(JSON.stringify({ error: 'Missing to_email, print_title, or order_ref' }), { status: 400, headers: jsonHeaders });
  }

  // Only ever trust this if it's a real, successful Paystack charge —
  // otherwise anyone could trigger free-form emails from Jeff's address.
  if (!env.PAYSTACK_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'PAYSTACK_SECRET_KEY not configured' }), { status: 500, headers: jsonHeaders });
  }
  let verified = false;
  try {
    const verify = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(order_ref)}`,
      { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } }
    );
    const vData = await verify.json();
    verified = !!vData.status && vData.data?.status === 'success';
  } catch (e) {
    console.error('order-confirm.js Paystack verify error:', e);
    verified = false; // fail closed
  }
  if (!verified) {
    return new Response(JSON.stringify({ error: 'Could not verify this order — refusing to send.' }), { status: 403, headers: jsonHeaders });
  }

  const BREVO_API_KEY = env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    return new Response(JSON.stringify({ error: 'BREVO_API_KEY not configured' }), { status: 500, headers: jsonHeaders });
  }

  const firstName = (to_name || '').split(' ')[0] || 'there';
  const sansFont = "'General Sans',system-ui,-apple-system,sans-serif";

  const summaryRow = (label, val) => val ? (
    `<tr>
      <td style="font-family:${sansFont};font-size:13px;color:#888;padding:7px 0;border-bottom:1px solid #ece7e0;">${label}</td>
      <td style="font-family:${sansFont};font-size:13px;color:#111;padding:7px 0;border-bottom:1px solid #ece7e0;text-align:right;">${val}</td>
    </tr>`
  ) : '';

  const emailPayload = {
    sender: { name: 'Jeffery Asare', email: 'hello@jefferyasare.com' },
    to: [{ email: to_email, name: to_name || to_email }],
    replyTo: { email: 'hello@jefferyasare.com' },
    subject: `Your order is confirmed — ${print_title}`,
    htmlContent: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9f7f4;font-family:${sansFont};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;padding:48px 48px 40px;max-width:600px;">
        <tr><td style="padding-bottom:36px;">
          <img src="https://jefferyasare.com/logo-name.png" alt="Jeffery Asare" width="80" height="44" style="display:block;border:0;">
        </td></tr>
        <tr><td style="font-family:${sansFont};font-size:28px;font-weight:600;color:#111;line-height:1.2;padding-bottom:16px;">
          Thank you, ${firstName}.
        </td></tr>
        <tr><td style="font-family:${sansFont};font-size:15px;color:#444;line-height:1.75;padding-bottom:24px;">
          Your order has been received and confirmed. I will ensure it is prepared with the care it deserves.
        </td></tr>
        <tr><td style="background:#f5f2ee;padding:24px 28px;">
          <p style="font-family:${sansFont};font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aaa;margin:0 0 12px;">Order Summary</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${summaryRow('Print', print_title)}
            ${summaryRow('Size', size)}
            ${summaryRow('Quantity', qty)}
            ${summaryRow('Amount paid', price)}
            ${summaryRow('Shipping to', country)}
            ${summaryRow('Order ref', order_ref)}
          </table>
        </td></tr>
        <tr><td style="font-family:${sansFont};font-size:15px;color:#444;line-height:1.75;padding-top:24px;padding-bottom:24px;">
          Your order is now in production and will be ready within <strong style="color:#111;">7&ndash;14 business days</strong>. You will receive tracking details once it is on its way. A Certificate of Authenticity for each print is prepared individually and will follow in a separate email.
        </td></tr>
        <tr><td style="font-family:${sansFont};font-size:15px;color:#444;line-height:1.6;padding-bottom:24px;">
          Questions? Just reply to this email.
        </td></tr>
        <tr><td style="padding:24px 0 0;border-top:1px solid #e8e4df;">
          <p style="font-family:${sansFont};font-size:14px;color:#888;font-style:italic;margin:0 0 4px;">With gratitude,</p>
          <p style="font-family:${sansFont};font-size:15px;color:#111;font-weight:600;margin:0;">Jeffery Asare</p>
        </td></tr>
        <tr><td style="padding-top:28px;border-top:1px solid #e8e4df;font-family:${sansFont};font-size:11px;color:#bbb;line-height:1.6;">
          Order ref: ${order_ref} &nbsp;&middot;&nbsp; Accra, Ghana &nbsp;&middot;&nbsp; hello@jefferyasare.com &nbsp;&middot;&nbsp; jefferyasare.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(emailPayload)
    });
    const result = await res.json();
    if (!res.ok) {
      console.error('order-confirm Brevo error:', JSON.stringify(result));
      return new Response(JSON.stringify({ error: 'Brevo rejected the request', details: result }), { status: 502, headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ ok: true, messageId: result.messageId }), { status: 200, headers: jsonHeaders });
  } catch (err) {
    console.error('order-confirm function error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), { status: 500, headers: jsonHeaders });
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowed ? origin : 'https://jefferyasare.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
