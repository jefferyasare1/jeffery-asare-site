// Cloudflare Pages Function — serves stored contact messages to the dashboard
// GET /api/messages?key=...
//
// Required env vars:
//   GH_PAT — GitHub PAT with repo scope
//   DASHBOARD_KEY — shared secret the dashboard sends as ?key=
//   (2026-08-24: moved off a hardcoded literal — see security assessment, Finding 4)

const REPO = 'jefferyasare1/jeffery-asare-site';
const FILE_PATH = 'data/messages.json';
const GH_API = 'https://api.github.com';

function fromB64(str) {
  return decodeURIComponent(Array.from(atob(str), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Auth gate — env.DASHBOARD_KEY must be set (unset = deny, never fall open)
  if (!env.DASHBOARD_KEY || url.searchParams.get('key') !== env.DASHBOARD_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const GH_PAT = env.GH_PAT;
  if (!GH_PAT) return new Response(JSON.stringify({ error: 'GH_PAT not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  const ghHeaders = {
    'Authorization': `Bearer ${GH_PAT}`,
    'User-Agent': 'jefferyasare-dashboard',
    'Accept': 'application/vnd.github+json',
  };

  let getRes;
  try {
    getRes = await fetch(`${GH_API}/repos/${REPO}/contents/${FILE_PATH}`, { headers: ghHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'GitHub unreachable: ' + (err.message || 'network error') }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  if (!getRes.ok) {
    // No messages file yet → return empty list
    if (getRes.status === 404) {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'GitHub fetch error' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const fileData = await getRes.json();
    const content = fromB64(fileData.content.replace(/\n/g, ''));
    return new Response(content, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to decode messages file' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
