// Cloudflare Pages Function — Review Submission
// POST /api/review
// Body: { name, rating, message, website? }
// Appends to _data/pending-reviews.json on GitHub (pending approval)
// Requires GITHUB_TOKEN in Cloudflare env variables.

const REPO   = 'jefferyasare1/jeffery-asare-site';
const BRANCH = 'main';
const PATH   = '_data/pending-reviews.json';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function ghGet(token, path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'jeffery-asare-cms' },
  });
  if (!r.ok) return { sha: null, data: { reviews: [] } };
  const f = await r.json();
  const raw = atob(f.content.replace(/\n/g, ''));
  let data;
  try { data = JSON.parse(raw); } catch { data = { reviews: [] }; }
  return { sha: f.sha, data };
}

async function ghPut(token, path, data, sha, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const body = { message, content, branch: BRANCH, ...(sha ? { sha } : {}) };
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'jeffery-asare-cms', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || 'GitHub write failed'); }
  return r.json();
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const TOKEN = env.GITHUB_TOKEN;
  if (!TOKEN) return json({ error: 'Server config error' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  // Honeypot — bots fill hidden "website" field, humans leave it blank
  if (body.website) return json({ ok: true });

  const name    = (body.name    || '').trim().slice(0, 80);
  const message = (body.message || '').trim().slice(0, 800);
  const rating  = Math.min(5, Math.max(1, parseInt(body.rating) || 5));

  if (!name)    return json({ error: 'Name is required' }, 400);
  if (!message) return json({ error: 'Message is required' }, 400);

  // Fetch current pending reviews
  const { sha, data } = await ghGet(TOKEN, PATH);
  if (!Array.isArray(data.reviews)) data.reviews = [];

  data.reviews.push({
    id:      Date.now().toString(),
    name,
    rating,
    message,
    date:    new Date().toISOString().split('T')[0],
  });

  try {
    await ghPut(TOKEN, PATH, data, sha, `New review from ${name}`);
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  return json({ ok: true });
}
