// Cloudflare Pages Function: GitHub OAuth initiation for Decap CMS
//
// Generates a random `state` value and round-trips it through GitHub's
// authorize flow, checked against on the callback in auth/done.js. Without
// this, the flow had no CSRF protection at all — RFC 6749 §10.12 says state
// "SHOULD" be used for exactly this reason.
// Source: https://datatracker.ietf.org/doc/html/rfc6749#section-10.12
// (security assessment, Finding 6, 2026-08-24)
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');

  if (provider !== 'github') {
    return new Response('Provider not supported', { status: 400 });
  }

  const state = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');

  const githubUrl = new URL('https://github.com/login/oauth/authorize');
  githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set('scope', 'repo,user');
  githubUrl.searchParams.set('redirect_uri', `${url.origin}/api/auth/done`);
  githubUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': githubUrl.toString(),
      // HttpOnly + Secure + SameSite=Lax + a short expiry — this cookie only
      // needs to survive the round trip to GitHub and back.
      'Set-Cookie': `ja_oauth_state=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
