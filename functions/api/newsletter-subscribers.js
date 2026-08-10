// Cloudflare Pages Function — returns newsletter subscriber count from Brevo
// GET /api/newsletter-subscribers
// Required env: BREVO_API_KEY

export async function onRequestGet(context) {
  const cors = {
    'Access-Control-Allow-Origin': 'https://jefferyasare.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = h => ({ 'Content-Type': 'application/json', ...cors, ...h });

  const KEY = context.env.BREVO_API_KEY;
  if (!KEY) return new Response(JSON.stringify({ error: 'Misconfigured' }), { status: 500, headers: json() });

  try {
    // Get total contact count
    const res = await fetch('https://api.brevo.com/v3/contacts?limit=1&offset=0', {
      headers: { 'api-key': KEY }
    });
    const data = await res.json();
    const count = data.count ?? 0;

    // Get the Newsletter list count if it exists
    const listsRes = await fetch('https://api.brevo.com/v3/contacts/lists?limit=50', {
      headers: { 'api-key': KEY }
    });
    const listsData = await listsRes.json();
    const newsletterList = listsData.lists?.find(l => l.name === 'Newsletter');
    const listCount = newsletterList?.totalSubscribers ?? null;

    return new Response(JSON.stringify({
      total: count,
      listCount,
      listId: newsletterList?.id ?? null
    }), { status: 200, headers: json() });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: json() });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://jefferyasare.com',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
