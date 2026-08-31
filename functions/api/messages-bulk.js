// Cloudflare Pages Function — bulk read / unread / delete for the
// dashboard's Messages tab select-all + bulk-action toolbar.
// One GitHub commit per call instead of one per message, so selecting a
// stack of messages and hitting an action doesn't fire off a dozen
// separate saves. Mirrors mark-read.js's auth and commit pattern.
//
// POST /api/messages-bulk
// Body: { key, ids: [...], action: 'read' | 'unread' | 'delete' }
//
// Required env vars:
//   GH_PAT        — GitHub PAT with repo scope
//   DASHBOARD_KEY — shared secret the dashboard sends as `key`

const REPO = 'jefferyasare1/jeffery-asare-site';
const FILE_PATH = 'data/messages.json';
const GH_API = 'https://api.github.com';

function toB64(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode('0x' + p1)));
}
function fromB64(str) {
  return decodeURIComponent(Array.from(atob(str), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
}

const VALID_ACTIONS = ['read', 'unread', 'delete'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const jsonHeaders = { 'Content-Type': 'application/json' };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders });
  }

  const { key, ids, action } = body;
  if (!env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) return new Response('Unauthorized', { status: 401 });
  if (!Array.isArray(ids) || !ids.length) {
    return new Response(JSON.stringify({ error: 'ids (non-empty array) required' }), { status: 400, headers: jsonHeaders });
  }
  if (!VALID_ACTIONS.includes(action)) {
    return new Response(JSON.stringify({ error: 'action must be read, unread, or delete' }), { status: 400, headers: jsonHeaders });
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
  if (!getRes.ok) return new Response(JSON.stringify({ error: 'Messages file not found' }), { status: 404, headers: jsonHeaders });

  const fileData = await getRes.json();
  const sha = fileData.sha;
  let messages = JSON.parse(fromB64(fileData.content.replace(/\n/g, '')));

  const idSet = new Set(ids);
  let changed = 0;

  if (action === 'delete') {
    const before = messages.length;
    messages = messages.filter(m => !idSet.has(m.id));
    changed = before - messages.length;
  } else {
    const wantRead = action === 'read';
    messages.forEach(m => {
      if (idSet.has(m.id) && m.read !== wantRead) {
        m.read = wantRead;
        changed++;
      }
    });
  }

  if (!changed) return new Response(JSON.stringify({ ok: true, changed: 0 }), { status: 200, headers: jsonHeaders });

  const putRes = await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: ghHeaders,
    body: JSON.stringify({
      message: `Bulk ${action} on ${changed} message${changed !== 1 ? 's' : ''} (dashboard)`,
      content: toB64(JSON.stringify(messages, null, 2)),
      sha,
    }),
  });

  if (!putRes.ok) {
    const errData = await putRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: errData.message || 'Failed to save' }), { status: 502, headers: jsonHeaders });
  }

  return new Response(JSON.stringify({ ok: true, changed }), { status: 200, headers: jsonHeaders });
}
