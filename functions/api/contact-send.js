// Cloudflare Pages Function — receives contact form submissions
// POST /api/contact-send
// 1. Stores message in data/messages.json in the GitHub repo
// 2. Sends a Brevo notification email to Jeff
//
// Required env vars (Cloudflare Pages → Settings → Environment variables):
//   BREVO_API_KEY  — Brevo API key
//   GH_PAT         — GitHub PAT with repo scope (fallback hardcoded below)

const CORS = {
  'Access-Control-Allow-Origin': 'https://jefferyasare.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS };
const REPO = 'jefferyasare1/jeffery-asare-site';
const FILE_PATH = 'data/messages.json';
const GH_API = 'https://api.github.com';
const JEFF_EMAIL = 'jeffery.asare1@gmail.com';

function ok(data) { return new Response(JSON.stringify(data), { status: 200, headers: JSON_HEADERS }); }
function fail(msg, status = 400) { return new Response(JSON.stringify({ error: msg }), { status, headers: JSON_HEADERS }); }

// Safe base64 encode that handles Unicode characters
function toB64(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode('0x' + p1)));
}
// Safe base64 decode that handles Unicode characters
function fromB64(str) {
  return decodeURIComponent(Array.from(atob(str), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }

  const { name, email, subject, message } = body;
  if (!name?.trim() || !email?.trim() || !message?.trim()) return fail('Missing required fields');
  if (!email.includes('@')) return fail('Invalid email');

  const GH_PAT = env.GH_PAT;
  if (!GH_PAT) return fail('GH_PAT environment variable not configured. Add it in Cloudflare Pages → Settings → Environment variables.', 500);
  const BREVO_API_KEY = env.BREVO_API_KEY;

  const ghHeaders = {
    'Authorization': `Bearer ${GH_PAT}`,
    'Content-Type': 'application/json',
    'User-Agent': 'jefferyasare-contact-form',
    'Accept': 'application/vnd.github+json',
  };

  const newMsg = {
    id: Date.now().toString(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    subject: (subject?.trim()) || 'General inquiry',
    message: message.trim(),
    timestamp: new Date().toISOString(),
    read: false,
    replied: false,
  };

  // ── 1. Store in GitHub ───────────────────────────────────────
  try {
    // Read current file (may not exist yet)
    const getRes = await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, { headers: ghHeaders });
    let messages = [];
    let sha = null;

    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      messages = JSON.parse(fromB64(fileData.content.replace(/\n/g, '')));
    }
    // Newest first, cap at 500 messages
    messages.unshift(newMsg);
    if (messages.length > 500) messages = messages.slice(0, 500);

    const putBody = {
      message: `Contact form: ${newMsg.name}`,
      content: toB64(JSON.stringify(messages, null, 2)),
      ...(sha ? { sha } : {}),
    };
    await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(putBody),
    });
  } catch (e) {
    console.error('GitHub storage error:', e.message);
    // Don't fail the request — still send the notification
  }

  // ── 2. Send notification email via Brevo ─────────────────────
  // The one-click dashboard link is built here (not hardcoded as a module
  // constant) so the live DASHBOARD_KEY is never baked into this source
  // file, which is public. If DASHBOARD_KEY isn't set, the link falls back
  // to a plain /dashboard URL and Jeff logs in manually.
  // (security assessment, Finding 4, 2026-08-24)
  const DASHBOARD_URL = env.DASHBOARD_KEY
    ? `https://jefferyasare.com/dashboard?key=${encodeURIComponent(env.DASHBOARD_KEY)}`
    : 'https://jefferyasare.com/dashboard';
  if (BREVO_API_KEY) {
    try {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { name: 'jefferyasare.com', email: 'hello@jefferyasare.com' },
          to: [{ email: JEFF_EMAIL, name: 'Jeffery Asare' }],
          replyTo: { email: newMsg.email, name: newMsg.name },
          subject: `New message: ${newMsg.subject} — from ${newMsg.name}`,
          htmlContent: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui,sans-serif;color:#111;padding:20px;max-width:560px;">
<p style="font-size:13px;color:#888;margin:0 0 4px;">New contact form message</p>
<h2 style="font-size:20px;font-weight:700;margin:0 0 20px;letter-spacing:-.02em;">${newMsg.subject}</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
  <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:12px;color:#888;width:70px;">From</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;">${newMsg.name} &lt;${newMsg.email}&gt;</td></tr>
  <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:12px;color:#888;">Topic</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;">${newMsg.subject}</td></tr>
</table>
<div style="background:#f9f7f4;border-radius:6px;padding:16px 20px;font-size:14px;line-height:1.8;margin-bottom:24px;">${newMsg.message.replace(/\n/g, '<br>')}</div>
<a href="${DASHBOARD_URL}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:11px 22px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.04em;">Open in Dashboard →</a>
<p style="margin-top:32px;font-size:11px;color:#bbb;">jefferyasare.com contact form &nbsp;·&nbsp; ${new Date().toUTCString()}</p>
</body></html>`,
        }),
      });
    } catch (e) {
      console.error('Brevo notify error:', e.message);
    }
  }

  return ok({ ok: true });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
