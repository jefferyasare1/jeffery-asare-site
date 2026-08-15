// Cloudflare Pages Function — GET /api/geo
// Returns visitor's country + shipping estimate using CF-IPCountry header.
// Shipping times come from /_data/settings/smart-features.json so Jeff can edit them.

export async function onRequestGet(context) {
  const { request, env } = context;

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    // Cloudflare sets this automatically on all requests
    const countryCode = (request.headers.get('CF-IPCountry') || '').toLowerCase();

    // Fetch shipping config from the CMS data file
    let shippingMap = null;
    try {
      const cfgRes = await fetch(new URL('/_data/settings/smart-features.json', request.url));
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        shippingMap = cfg.shipping || null;
      }
    } catch (_) {}

    // Fallback shipping times if config can't be fetched
    const fallback = {
      gh: { name: 'Ghana', time: '3–5 business days' },
      us: { name: 'United States', time: '10–14 business days' },
      gb: { name: 'United Kingdom', time: '7–10 business days' },
      ng: { name: 'Nigeria', time: '5–8 business days' },
      default: { name: 'International', time: '10–20 business days' }
    };

    const map = shippingMap || fallback;
    const entry = map[countryCode] || map['default'];

    return new Response(JSON.stringify({
      country: countryCode.toUpperCase(),
      name: entry.name,
      time: entry.time
    }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ country: '', name: 'International', time: '10–20 business days' }), { headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    }
  });
}
