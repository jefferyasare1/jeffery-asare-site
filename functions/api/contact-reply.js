// Cloudflare Pages Function — sends a reply to a contact message
// POST /api/contact-reply
// Body: { key, messageId, replyText }
//
// Required env vars:
//   BREVO_API_KEY — Brevo API key
//   GH_PAT        — GitHub PAT with repo scope

// DASHBOARD_KEY read from env.DASHBOARD_KEY below — this used to be a
// hardcoded literal here too, the same leaked value shared across every
// other endpoint. (security assessment, Finding 4, 2026-08-24)
const REPO = 'jefferyasare1/jeffery-asare-site';
const FILE_PATH = 'data/messages.json';
const GH_API = 'https://api.github.com';

const GS = "'General Sans',system-ui,sans-serif";

function toB64(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode('0x' + p1)));
}
function fromB64(str) {
  return decodeURIComponent(Array.from(atob(str), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
}

function buildReplyHtml(name, replyText) {
  const paras = replyText.split('\n\n').filter(p => p.trim())
    .map(p => `<p style="font-family:${GS};font-size:15px;color:#444;line-height:1.85;margin:0 0 16px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
@font-face{font-family:"General Sans";src:url("https://jefferyasare.com/fonts/GeneralSans-Variable.woff2") format("woff2");font-weight:100 900;font-style:normal;}
</style>
</head>
<body style="margin:0;padding:0;background:#f9f7f4;font-family:${GS};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7f4;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;max-width:600px;">
      <tr><td style="padding:24px 48px 20px;border-bottom:1px solid #e8e4df;">
        <img src="https://jefferyasare.com/logo-name.png" alt="Jeffery Asare" width="90" style="display:block;height:auto;max-width:90px;">
      </td></tr>
      <tr><td style="padding:40px 48px 32px;">
        <p style="font-family:${GS};font-size:14px;color:#999;margin:0 0 20px;">Hi ${name},</p>
        ${paras}
        <hr style="border:none;border-top:1px solid #e8e4df;margin:28px 0 24px;">
        <p style="font-family:${GS};font-size:13px;color:#999;margin:0 0 4px;">With gratitude,</p>
        <p style="font-family:${GS};font-size:15px;color:#111;font-weight:600;margin:0;">Jeffery Asare</p>
      </td></tr>
      <tr><td style="background:#f9f7f4;padding:16px 48px;border-top:1px solid #e8e4df;">
        <p style="font-family:${GS};font-size:11px;color:#bbb;margin:0;">
          Accra, Ghana &nbsp;·&nbsp; <a href="https://jefferyasare.com" style="color:#bbb;text-decoration:none;">jefferyasare.com</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { key, messageId, replyText } = body;
  if (!env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) return new Response('Unauthorized', { status: 401 });
  if (!messageId || !replyText?.trim()) {
    return new Response(JSON.stringify({ error: 'messageId and replyText required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const GH_PAT = env.GH_PAT;
  if (!GH_PAT) return new Response(JSON.stringify({ error: 'GH_PAT not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  const BREVO_API_KEY = env.BREVO_API_KEY;

  const ghHeaders = {
    'Authorization': `Bearer ${GH_PAT}`,
    'Content-Type': 'application/json',
    'User-Agent': 'jefferyasare-dashboard',
    'Accept': 'application/vnd.github+json',
  };

  // Load messages
  const getRes = await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, { headers: ghHeaders });
  if (!getRes.ok) return new Response(JSON.stringify({ error: 'Messages file not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const fileData = await getRes.json();
  const sha = fileData.sha;
  const messages = JSON.parse(fromB64(fileData.content.replace(/\n/g, '')));

  const msg = messages.find(m => m.id === messageId);
  if (!msg) return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Send reply via Brevo
  if (!BREVO_API_KEY) {
    return new Response(JSON.stringify({ error: 'BREVO_API_KEY not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Jeffery Asare', email: 'hello@jefferyasare.com' },
      to: [{ email: msg.email, name: msg.name }],
      replyTo: { email: 'hello@jefferyasare.com' },
      subject: `Re: ${msg.subject}`,
      htmlContent: buildReplyHtml(msg.name, replyText.trim()),
    }),
  });

  if (!sendRes.ok) {
    const errData = await sendRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: errData.message || 'Email send failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  // Mark as replied in GitHub
  msg.replied = true;
  msg.repliedAt = new Date().toISOString();
  msg.replyText = replyText.trim();

  await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: ghHeaders,
    body: JSON.stringify({
      message: `Reply sent to ${msg.name}`,
      content: toB64(JSON.stringify(messages, null, 2)),
      sha,
    }),
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
