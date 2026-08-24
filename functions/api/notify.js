// Cloudflare Pages Function — sends a general-purpose notification email via Brevo
// Used by the dashboard follow-up digest button and any future alerts
//
// Only ever called from the password-protected dashboard (never from the
// public site), so unlike orders.js / send-coa.js this can be a straight
// admin-key gate with no anonymous path.
// (security assessment, Finding 4, 2026-08-24)

const ALLOWED_ORIGINS = ['https://jefferyasare.com', 'https://www.jefferyasare.com'];

export async function onRequest(context) {
  const { env } = context;
  const origin = context.request.headers.get('Origin') || '';
  const referer = context.request.headers.get('Referer') || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin === o || referer.startsWith(o));

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowed ? (origin || 'https://jefferyasare.com') : 'https://jefferyasare.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const suppliedKey = context.request.headers.get('X-Dashboard-Key');
  if (!env.DASHBOARD_KEY || suppliedKey !== env.DASHBOARD_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const BREVO_API_KEY = context.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    return new Response(JSON.stringify({ error: 'BREVO_API_KEY not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  let body;
  try { body = await context.request.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const { to, to_name, subject, html_content } = body;
  if (!to || !subject || !html_content) {
    return new Response(JSON.stringify({ error: 'Missing to, subject, or html_content' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const payload = {
    sender: { name: 'Jeffery Asare', email: 'hello@jefferyasare.com' },
    to: [{ email: to, name: to_name || to }],
    replyTo: { email: 'hello@jefferyasare.com', name: 'Jeffery Asare' },
    subject: subject,
    htmlContent: html_content
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    return new Response(JSON.stringify({ error: data.message || 'Brevo error' }), {
      status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.toString() }), {
      status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
