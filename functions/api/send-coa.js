// Cloudflare Pages Function — sends COA PDF to buyer via Brevo REST API
// Brevo REST API supports attachments; EmailJS/Brevo SMTP does not.
//
// Required env var (set in Cloudflare Pages → Settings → Environment variables):
//   BREVO_API_KEY  — get from Brevo dashboard → SMTP & API → API Keys
//
// Called from two places: the public checkout flow in index.html (right
// after a real Paystack payment, with that payment's own reference in
// hand) and the password-protected dashboard's resend flows (sometimes
// with no order_ref at all — a manual resend). A blanket key requirement
// would break the public post-checkout send, so this accepts either:
//   - a valid X-Dashboard-Key (admin/dashboard callers), or
//   - an order_ref that verifies as a real, successful Paystack transaction
//     (public post-checkout callers).
// Without this, anyone could make this endpoint send an arbitrary PDF
// attachment to an arbitrary address on Jeff's Brevo account, for free.
// (security assessment, Finding 4, 2026-08-24)
const ALLOWED_ORIGINS = ['https://jefferyasare.com', 'https://www.jefferyasare.com'];

export async function onRequestPost(context) {
  const { request, env } = context;

  // Block requests not originating from the site
  const origin = request.headers.get('Origin') || '';
  const referer = request.headers.get('Referer') || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin === o || referer.startsWith(o));
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin || 'https://jefferyasare.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key',
    'Cache-Control': 'no-store'
  };
  const jsonHeaders = Object.assign({ 'Content-Type': 'application/json' }, corsHeaders);

  // Basic size guard — PDF base64 shouldn't exceed ~8 MB
  const contentLength = parseInt(request.headers.get('Content-Length') || '0');
  if (contentLength > 25 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers: jsonHeaders });
  }

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders });
  }

  const { to_email, to_name, print_title, size, order_ref, pdf_base64 } = body;

  if (!to_email || !pdf_base64) {
    return new Response(JSON.stringify({ error: 'Missing to_email or pdf_base64' }), { status: 400, headers: jsonHeaders });
  }

  const suppliedKey = request.headers.get('X-Dashboard-Key');
  const isAdmin = !!env.DASHBOARD_KEY && suppliedKey === env.DASHBOARD_KEY;

  if (!isAdmin) {
    let verified = false;
    if (order_ref && env.PAYSTACK_SECRET_KEY) {
      try {
        const verify = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(order_ref)}`,
          { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } }
        );
        const vData = await verify.json();
        verified = !!vData.status && vData.data?.status === 'success';
      } catch (e) {
        console.error('send-coa.js Paystack verify error:', e);
        verified = false; // fail closed
      }
    }
    if (!verified) {
      return new Response(JSON.stringify({ error: 'Could not verify this order — refusing to send.' }), { status: 403, headers: jsonHeaders });
    }
  }

  const BREVO_API_KEY = env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    return new Response(JSON.stringify({ error: 'BREVO_API_KEY not configured in Cloudflare Pages environment variables' }), { status: 500, headers: jsonHeaders });
  }

  const safeName = (print_title || 'Certificate').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-');
  const firstName = (to_name || '').split(' ')[0] || 'there';

  const emailPayload = {
    sender: { name: 'Jeffery Asare', email: 'hello@jefferyasare.com' },
    to: [{ email: to_email, name: to_name || to_email }],
    replyTo: { email: 'hello@jefferyasare.com' },
    subject: `Your Certificate of Authenticity: ${print_title || 'Fine Art Print'}`,
    htmlContent: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9f7f4;font-family:'General Sans',system-ui,-apple-system,sans-serif;">
  <table class="email-wrap" width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7f4;padding:40px 20px;">
    <tr><td align="center">
      <table class="email-card" width="600" cellpadding="0" cellspacing="0" style="background:#fff;padding:48px 48px 40px;max-width:600px;">
        <!-- Logo -->
        <tr><td style="padding-bottom:36px;">
          <img src="https://jefferyasare.com/logo-name.png" alt="Jeffery Asare" width="80" height="44" style="display:block;border:0;">
        </td></tr>
        <!-- Heading -->
        <tr><td class="email-head" style="font-family:'General Sans',system-ui,-apple-system,sans-serif;font-size:28px;font-weight:600;color:#111;line-height:1.2;padding-bottom:16px;">
          Thank you, ${firstName}.
        </td></tr>
        <!-- Body -->
        <tr><td class="email-text" style="font-family:'General Sans',system-ui,-apple-system,sans-serif;font-size:15px;color:#444;line-height:1.75;padding-bottom:24px;">
          Your order for <strong style="color:#111;">${print_title || 'your fine art print'}</strong>${size ? ' (' + size + ')' : ''} has been confirmed.
        </td></tr>
        <tr><td class="email-text" style="font-family:'General Sans',system-ui,-apple-system,sans-serif;font-size:15px;color:#444;line-height:1.75;padding-bottom:24px;">
          Attached to this email is your <strong style="color:#111;">Certificate of Authenticity</strong>, a signed document confirming the provenance and authenticity of your limited edition print. Please keep it safe; it is the official record of your ownership.
        </td></tr>
        <!-- Next steps box -->
        <tr><td class="email-box" style="background:#f5f2ee;padding:24px 28px;">
          <p style="font-family:'General Sans',system-ui,-apple-system,sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#aaa;margin:0 0 12px;">What happens next</p>
          <p class="email-text" style="font-family:'General Sans',system-ui,-apple-system,sans-serif;font-size:14px;color:#555;line-height:1.7;margin:0;">
            Your print is now being carefully prepared. It will ship within <strong>7–14 business days</strong>.
            Once it's on its way, you'll receive a second email with your tracking number.
          </p>
        </td></tr>
        <tr><td style="padding:28px 0 0;">
          <p class="email-text" style="font-family:'General Sans',system-ui,-apple-system,sans-serif;font-size:15px;color:#444;line-height:1.6;margin:0;">
            Questions? Just reply to this email.
          </p>
        </td></tr>
        <!-- Signature -->
        <tr><td class="email-sig" style="padding:28px 0 0;border-top:1px solid #e8e4df;margin-top:32px;">
          <p class="email-text" style="font-family:'General Sans',system-ui,-apple-system,sans-serif;font-size:14px;color:#888;font-style:italic;margin:0 0 4px;">With gratitude,</p>
          <p class="email-head" style="font-family:'General Sans',system-ui,-apple-system,sans-serif;font-size:15px;color:#111;font-weight:600;margin:0;">Jeffery Asare</p>
        </td></tr>
        <!-- Footer -->
        <tr><td class="email-foot" style="padding-top:32px;border-top:1px solid #e8e4df;font-family:'General Sans',system-ui,-apple-system,sans-serif;font-size:11px;color:#bbb;line-height:1.6;">
          ${order_ref ? 'Order ref: ' + order_ref + ' &nbsp;&middot;&nbsp; ' : ''}Accra, Ghana &nbsp;&middot;&nbsp; hello@jefferyasare.com &nbsp;&middot;&nbsp; jefferyasare.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    attachment: [
      {
        content: pdf_base64,
        name: `COA-${safeName}.pdf`
      }
    ]
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(emailPayload)
    });

    const result = await res.json();

    if (!res.ok) {
      console.error('Brevo API error:', JSON.stringify(result));
      return new Response(JSON.stringify({ error: 'Brevo rejected the request', details: result }), { status: 502, headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ ok: true, messageId: result.messageId }), { status: 200, headers: jsonHeaders });

  } catch (err) {
    console.error('send-coa function error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), { status: 500, headers: jsonHeaders });
  }
}

// Handle CORS preflight
export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowed ? origin : 'https://jefferyasare.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key'
    }
  });
}
