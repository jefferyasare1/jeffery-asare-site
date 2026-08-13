/**
 * Cloudflare Pages Middleware — SPA fallback
 *
 * Serves index.html for any route that isn't a static asset or API call,
 * so that page reloads on /portfolio, /shop, /about etc. work correctly.
 */

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // Pass API calls straight through to their functions
  if (path.startsWith('/api/')) {
    return context.next();
  }

  // Pass anything with a file extension through (images, JS, CSS, JSON, etc.)
  if (/\.\w+$/.test(path)) {
    return context.next();
  }

  // For all other paths (/portfolio, /shop, /about …) serve index.html
  // while keeping the original URL in the browser
  const indexUrl = new URL('/index.html', url.origin);
  return context.env.ASSETS.fetch(new Request(indexUrl.toString(), context.request));
}
