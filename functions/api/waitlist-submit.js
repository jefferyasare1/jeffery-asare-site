// Cloudflare Pages Function — POST /api/waitlist-submit
// Stores a waitlist entry (email + print) to KV namespace WAITLIST_KV.
// If KV not configured, falls back to logging to console (won't lose data in production).

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const body = await request.json();
    const email = (body.email || '').trim().toLowerCase();
    const printTitle = (body.printTitle || '').trim();
    const printSlug = (body.printSlug || '').trim();

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ ok: false, error: 'Valid email required.' }), { status: 400, headers: corsHeaders });
    }

    const entry = {
      email,
      printTitle,
      printSlug,
      submittedAt: new Date().toISOString(),
      notified: false
    };

    if (env.WAITLIST_KV) {
      // Key: waitlist:{printSlug}:{email} — easy to list by print later
      const key = `waitlist:${printSlug}:${email}`;
      // Get existing entries list
      const listKey = 'waitlist_index';
      let index = [];
      try {
        const raw = await env.WAITLIST_KV.get(listKey);
        if (raw) index = JSON.parse(raw);
      } catch (_) {}

      // Avoid duplicates
      const exists = index.some(function(e) { return e.email === email && e.printSlug === printSlug; });
      if (!exists) {
        index.unshift(entry); // newest first
        await env.WAITLIST_KV.put(listKey, JSON.stringify(index));
        await env.WAITLIST_KV.put(key, JSON.stringify(entry));
      }
    } else {
      // No KV configured — log so it's visible in Cloudflare logs
      console.log('WAITLIST_ENTRY', JSON.stringify(entry));
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

  } catch (e) {
    console.error('waitlist-submit error:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Server error.' }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestGet(context) {
  // Dashboard reads all waitlist entries
  const { request, env } = context;
  const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const url = new URL(request.url);
  if (url.searchParams.get('key') !== 'jA9kx2vP7m') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  if (!env.WAITLIST_KV) {
    return new Response(JSON.stringify([]), { headers: corsHeaders });
  }

  try {
    const raw = await env.WAITLIST_KV.get('waitlist_index');
    const entries = raw ? JSON.parse(raw) : [];
    return new Response(JSON.stringify(entries), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify([]), { headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
