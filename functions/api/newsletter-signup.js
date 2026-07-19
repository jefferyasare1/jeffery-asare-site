// Cloudflare Pages Function — handles newsletter signups
// Sends a welcome email to the subscriber via Brevo REST API
//
// Required env var (Cloudflare Pages → Settings → Environment variables):
//   BREVO_API_KEY — your Brevo API key

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://jefferyasare.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const jsonHeaders = { 'Content-Type': 'application/json', ...corsHeaders };

  let body;
  try { body = await context.request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders });
  }

  const { email } = body;
  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Valid email required' }), { status: 400, headers: jsonHeaders });
  }

  const BREVO_API_KEY = context.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), { status: 500, headers: jsonHeaders });
  }

  const firstName = email.split('@')[0];

  const emailPayload = {
    sender: { name: 'Jeffery Asare', email: 'hello@jefferyasare.com' },
    to: [{ email: email }],
    replyTo: { email: 'hello@jefferyasare.com' },
    subject: 'You\'re on the list.',
    htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9f7f4;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;padding:48px 48px 40px;max-width:600px;">
        <tr><td style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#aaa;padding-bottom:36px;">Jeffery Asare</td></tr>
        <tr><td style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#111;line-height:1.2;padding-bottom:20px;">
          You're on the list.
        </td></tr>
        <tr><td style="font-family:Georgia,serif;font-size:15px;color:#444;line-height:1.8;padding-bottom:20px;">
          Thank you for signing up. You'll be among the first to hear about new work, print drops, and moments from behind the lens.
        </td></tr>
        <tr><td style="font-family:Georgia,serif;font-size:15px;color:#444;line-height:1.8;padding-bottom:28px;">
          No noise — just what matters.
        </td></tr>
        <tr><td style="padding:28px 0 0;border-top:1px solid #e8e4df;">
          <p style="font-family:Georgia,serif;font-size:14px;color:#888;font-style:italic;margin:0 0 4px;">With gratitude,</p>
          <p style="font-family:Georgia,serif;font-size:15px;color:#111;font-weight:600;margin:0;">Jeffery Asare</p>
        </td></tr>
        <tr><td style="padding-top:28px;border-top:1px solid #e8e4df;font-family:Arial,sans-serif;font-size:11px;color:#bbb;line-height:1.6;">
          Accra, Ghana &nbsp;&middot;&nbsp; hello@jefferyasare.com &nbsp;&middot;&nbsp; <a href="https://jefferyasare.com" style="color:#bbb;">jefferyasare.com</a>
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
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload)
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Brevo newsletter error:', JSON.stringify(data));
      return new Response(JSON.stringify({ error: 'Email send failed' }), { status: 502, headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://jefferyasare.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
