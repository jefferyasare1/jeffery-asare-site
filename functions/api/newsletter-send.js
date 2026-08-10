// Cloudflare Pages Function — sends a newsletter campaign via Brevo
// POST /api/newsletter-send
// Required env: BREVO_API_KEY

const CORS = {
  'Access-Control-Allow-Origin': 'https://jefferyasare.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const jsonHeaders = { 'Content-Type': 'application/json', ...CORS };

function ok(data) { return new Response(JSON.stringify(data), { status: 200, headers: jsonHeaders }); }
function err(msg, status = 500) { return new Response(JSON.stringify({ error: msg }), { status, headers: jsonHeaders }); }

function buildHtml(subject, message, ctaText, ctaUrl) {
  const messageHtml = message
    .split('\n\n')
    .filter(p => p.trim())
    .map(p => `<p style="font-family:Georgia,serif;font-size:15px;color:#444;line-height:1.85;margin:0 0 18px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  const ctaBlock = (ctaText && ctaUrl) ? `
    <table cellpadding="0" cellspacing="0" style="margin:32px 0;">
      <tr><td style="background:#111;border-radius:3px;">
        <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;font-family:Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#fff;text-decoration:none;">${ctaText}</a>
      </td></tr>
    </table>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f7f4;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7f4;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;max-width:600px;border-radius:4px;overflow:hidden;">

      <!-- Logo header -->
      <tr><td style="background:#ffffff;padding:24px 48px;border-bottom:1px solid #e8e4df;">
        <img src="https://jefferyasare.com/logo-name.png" alt="Jeffery Asare" width="140" style="display:block;height:auto;max-width:140px;">
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:48px 48px 36px;">
        <p style="font-family:Arial,sans-serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#c5b9ab;margin:0 0 20px;">New Work</p>
        <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:#111;line-height:1.2;margin:0 0 28px;letter-spacing:-.02em;">${subject}</h1>
        ${messageHtml}
        ${ctaBlock}
        <hr style="border:none;border-top:1px solid #e8e4df;margin:32px 0 28px;">
        <p style="font-family:Georgia,serif;font-size:13px;color:#999;font-style:italic;margin:0 0 4px;">With gratitude,</p>
        <p style="font-family:Georgia,serif;font-size:15px;color:#111;font-weight:600;margin:0;">Jeffery Asare</p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f9f7f4;padding:20px 48px;border-top:1px solid #e8e4df;">
        <p style="font-family:Arial,sans-serif;font-size:11px;color:#bbb;line-height:1.8;margin:0;">
          Accra, Ghana &nbsp;·&nbsp; <a href="https://jefferyasare.com" style="color:#bbb;text-decoration:none;">jefferyasare.com</a><br>
          You're receiving this because you signed up at jefferyasare.com.<br>
          <a href="{{unsubscribe}}" style="color:#bbb;">Unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function getOrCreateList(KEY) {
  const headers = { 'api-key': KEY, 'Content-Type': 'application/json' };
  const res = await fetch('https://api.brevo.com/v3/contacts/lists?limit=50', { headers });
  const data = await res.json();
  const existing = data.lists?.find(l => l.name === 'Newsletter');
  if (existing) return existing.id;

  // Create the list
  const createRes = await fetch('https://api.brevo.com/v3/contacts/lists', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Newsletter', folderId: 1 })
  });
  const created = await createRes.json();
  return created.id;
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return err('Invalid JSON', 400); }

  const { subject, message, ctaText, ctaUrl } = body;
  if (!subject?.trim() || !message?.trim()) return err('Subject and message are required', 400);

  const KEY = context.env.BREVO_API_KEY;
  if (!KEY) return err('Server misconfiguration');

  const brevoHeaders = { 'api-key': KEY, 'Content-Type': 'application/json' };

  try {
    const listId = await getOrCreateList(KEY);
    const html = buildHtml(subject.trim(), message.trim(), ctaText?.trim(), ctaUrl?.trim());
    const campaignName = `New Work — ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}`;

    // Create campaign
    const createRes = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      method: 'POST',
      headers: brevoHeaders,
      body: JSON.stringify({
        name: campaignName,
        subject: subject.trim(),
        sender: { name: 'Jeffery Asare', email: 'hello@jefferyasare.com' },
        replyTo: 'hello@jefferyasare.com',
        type: 'classic',
        htmlContent: html,
        recipients: { listIds: [listId] }
      })
    });
    const campaign = await createRes.json();
    if (!createRes.ok) {
      console.error('Campaign create error:', JSON.stringify(campaign));
      return err(campaign.message || 'Campaign creation failed', 502);
    }

    // Send immediately
    const sendRes = await fetch(`https://api.brevo.com/v3/emailCampaigns/${campaign.id}/sendNow`, {
      method: 'POST',
      headers: brevoHeaders
    });
    if (!sendRes.ok) {
      const sendData = await sendRes.json().catch(() => ({}));
      console.error('Campaign send error:', JSON.stringify(sendData));
      return err(sendData.message || 'Send failed', 502);
    }

    return ok({ sent: true, campaignId: campaign.id, name: campaignName });
  } catch (e) {
    return err(e.message);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
