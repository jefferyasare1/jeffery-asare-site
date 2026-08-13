/**
 * Cloudflare Pages Middleware — SPA fallback
 *
 * Lets Cloudflare try to serve the request normally first.
 * If nothing matches (404), serves index.html so that /portfolio,
 * /shop, /about etc. work on reload without a 404.
 */

export async function onRequest(context) {
  // Let Cloudflare attempt to serve the request as-is
  // (static asset, or a matching Pages Function like /api/*)
  const response = await context.next();

  // If the asset exists, return it directly
  if (response.status !== 404) {
    return response;
  }

  // No matching file — serve index.html for SPA routing
  return context.env.ASSETS.fetch(
    new Request(new URL('/index.html', context.request.url).toString(), { method: 'GET' })
  );
}
