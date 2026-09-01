// Cloudflare Pages Function — POST /api/verify-password
// Body: { hash }
//
// Required env vars:
//   PASSWORD_HASH — the SHA-256 hash of the dashboard password (same value
//                   as the HASH constant in dashboard.html — a one-way
//                   hash, never the real password itself)
//   DASHBOARD_KEY — shared secret the dashboard sends as `key` to every
//                   other /api/* function (mark-read, messages, orders, etc.)
//
// Why this exists (security assessment, Finding 7, 2026-09-01): dashboard.html
// used to hardcode the real DASHBOARD_KEY value directly in the page's own
// source and set it unconditionally on every load, regardless of whether the
// visitor had actually entered the password — so the page's data and admin
// API were reachable by anyone who loaded the URL, with the password gate
// only ever a cosmetic overlay. This function is the fix: the browser already
// hashes the password locally and checks it against HASH for instant
// feedback (unchanged), but it no longer holds the real DASHBOARD_KEY until
// that same hash is re-checked here, server-side, and this function hands it
// back only on a match. A visitor who never enters the correct password never
// receives a working key, so every other /api/* call correctly 401s for them.
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { hash } = body;
  if (!env.PASSWORD_HASH || !env.DASHBOARD_KEY) {
    // Deny when unset — same convention as every other function here
    // (security assessment, Finding 4/5, 2026-08-24): never fall back to a
    // hardcoded default just because an env var is missing.
    return new Response(JSON.stringify({ error: 'Not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  if (!hash || typeof hash !== 'string' || hash.toLowerCase() !== env.PASSWORD_HASH.toLowerCase()) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true, key: env.DASHBOARD_KEY }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
