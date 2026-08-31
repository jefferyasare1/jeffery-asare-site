// Cloudflare Pages Function — marks a contact message as read
// POST /api/mark-read
// Body: { key, messageId }
//
// Required env vars:
//   GH_PAT — GitHub PAT with repo scope
//   DASHBOARD_KEY — shared secret the dashboard sends as `key`
//
// Same read → update → commit pattern as contact-reply.js's "mark as
// replied" step. Needed because opening a message in the dashboard was
// only flipping `read` in the browser's own memory (dashboard.html's
// msgOpen()) — nothing told the messages file itself, so the very next
// reload pulled the same message back down still marked unread, and the
// unread count in the Messages tab never actually went down for good.

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

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { key, messageId } = body;
  if (!env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) return new Response('Unauthorized', { status: 401 });
  if (!messageId) {
    return new Response(JSON.stringify({ error: 'messageId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const GH_PAT = env.GH_PAT;
  if (!GH_PAT) return new Response(JSON.stringify({ error: 'GH_PAT not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const ghHeaders = {
    'Authorization': `Bearer ${GH_PAT}`,
    'Content-Type': 'application/json',
    'User-Agent': 'jefferyasare-dashboard',
    'Accept': 'application/vnd.github+json',
  };

  const getRes = await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, { headers: ghHeaders });
  if (!getRes.ok) return new Response(JSON.stringify({ error: 'Messages file not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const fileData = await getRes.json();
  const sha = fileData.sha;
  const messages = JSON.parse(fromB64(fileData.content.replace(/\n/g, '')));

  const msg = messages.find(m => m.id === messageId);
  if (!msg) return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Nothing to do — avoid a pointless commit (and a pointless conflict
  // with any other write happening around the same time) if it's already read.
  if (msg.read) {
    return new Response(JSON.stringify({ ok: true, alreadyRead: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  msg.read = true;

  const putRes = await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: ghHeaders,
    body: JSON.stringify({
      message: `Marked message from ${msg.name} as read`,
      content: toB64(JSON.stringify(messages, null, 2)),
      sha,
    }),
  });

  if (!putRes.ok) {
    const errData = await putRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: errData.message || 'Failed to save' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
