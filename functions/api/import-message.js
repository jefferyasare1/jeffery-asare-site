// Cloudflare Pages Function — receives a client's email reply (pulled in
// hourly from Gmail by apps-script-order-log.js's importMessagesFromGmail)
// and folds it into the matching conversation in data/messages.json, so it
// shows up in the dashboard's Messages tab instead of only sitting in the
// inbox. Mirrors mark-read.js's read → update → commit pattern.
//
// POST /api/import-message
// Body: { key, from_name, from_email, subject, body, at }
//
// Required env vars:
//   GH_PAT        — GitHub PAT with repo scope
//   DASHBOARD_KEY — shared secret (same one the dashboard itself sends)

const REPO = 'jefferyasare1/jeffery-asare-site';
const FILE_PATH = 'data/messages.json';
const GH_API = 'https://api.github.com';

function toB64(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode('0x' + p1)));
}
function fromB64(str) {
  return decodeURIComponent(Array.from(atob(str), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const jsonHeaders = { 'Content-Type': 'application/json' };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders });
  }

  const { key, from_name, from_email, subject, body: text, at } = body;
  if (!env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) return new Response('Unauthorized', { status: 401 });
  if (!from_email || !text) {
    return new Response(JSON.stringify({ error: 'from_email and body are required' }), { status: 400, headers: jsonHeaders });
  }

  const GH_PAT = env.GH_PAT;
  if (!GH_PAT) return new Response(JSON.stringify({ error: 'GH_PAT not configured' }), { status: 500, headers: jsonHeaders });

  const ghHeaders = {
    'Authorization': `Bearer ${GH_PAT}`,
    'Content-Type': 'application/json',
    'User-Agent': 'jefferyasare-dashboard',
    'Accept': 'application/vnd.github+json',
  };

  const getRes = await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, { headers: ghHeaders });
  let messages = [];
  let sha = null;
  if (getRes.ok) {
    const fileData = await getRes.json();
    sha = fileData.sha;
    messages = JSON.parse(fromB64(fileData.content.replace(/\n/g, '')));
  }

  const emailNorm = from_email.trim().toLowerCase();
  const atIso = at || new Date().toISOString();

  // Find the most recent existing conversation with this sender, so a
  // reply lands on the right thread instead of starting a new one.
  const existing = messages.find(m => (m.email || '').trim().toLowerCase() === emailNorm);

  let imported;
  if (existing) {
    existing.replies = existing.replies || [];
    existing.replies.push({ from: 'client', text, at: atIso });
    existing.read = false; // a new reply landed — surface it as needing attention again
    imported = existing;
  } else {
    // First time hearing from this address through this path — start a
    // new conversation entry so it still shows up, even though it didn't
    // arrive through the contact form.
    const fresh = {
      id: Date.now().toString(),
      name: from_name || from_email,
      email: from_email.trim(),
      subject: subject || 'Email',
      message: text,
      timestamp: atIso,
      read: false,
      replied: false,
    };
    messages.unshift(fresh);
    imported = fresh;
  }

  if (messages.length > 500) messages = messages.slice(0, 500);

  const putRes = await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: ghHeaders,
    body: JSON.stringify({
      message: `Imported email reply from ${from_name || from_email}`,
      content: toB64(JSON.stringify(messages, null, 2)),
      sha,
    }),
  });

  if (!putRes.ok) {
    const errData = await putRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: errData.message || 'Failed to save' }), { status: 502, headers: jsonHeaders });
  }

  return new Response(JSON.stringify({ ok: true, id: imported.id }), { status: 200, headers: jsonHeaders });
}
