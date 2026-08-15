/**
 * Cloudflare Pages Function — Analytics Proxy
 * Route: /api/analytics
 *
 * Proxies requests to the Cloudflare GraphQL Analytics API server-side,
 * bypassing the browser's CORS restriction.
 *
 * Called only from dashboard.html (protected by dashboard password).
 *
 * Required environment variable (set in Cloudflare Pages → Settings → Variables):
 *   CF_TOKEN — a Cloudflare API token with Analytics:Read permission
 */

const ALLOWED_KEY = 'jA9kx2vP7m'; // matches the dashboard secret URL key

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Key',
};

// Handle browser preflight (OPTIONS)
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Handle the actual POST from dashboard.html
export async function onRequestPost(context) {
  // Read token from environment variable (never hardcoded)
  const CF_TOKEN = context.env.CF_TOKEN;
  if (!CF_TOKEN) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration: CF_TOKEN not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  // Basic auth — require the dashboard key header
  const key = context.request.headers.get('X-Dashboard-Key');
  if (key !== ALLOWED_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  // Forward the GraphQL query body to Cloudflare's API
  let body;
  try { body = await context.request.text(); }
  catch { return new Response(JSON.stringify({ error: 'Failed to read request body' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }); }

  try {
    const cfResponse = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${CF_TOKEN}`,
        'Content-Type':  'application/json',
      },
      body,
    });

    const data = await cfResponse.text();

    return new Response(data, {
      status: cfResponse.status,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Analytics API unreachable: ' + (err.message || 'network error') }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}
