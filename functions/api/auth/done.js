// Cloudflare Pages Function: GitHub OAuth callback for Decap CMS
function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? match.slice(name.length + 1) : null;
}

// Clears the one-time state cookie regardless of outcome.
const CLEAR_STATE_COOKIE = 'ja_oauth_state=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  if (!code) {
    return new Response('No code provided', { status: 400 });
  }

  // CSRF check — the state returned by GitHub must match the one this same
  // browser was given when the flow started. (security assessment, Finding 6,
  // 2026-08-24; Source: https://datatracker.ietf.org/doc/html/rfc6749#section-10.12)
  const expectedState = getCookie(request, 'ja_oauth_state');
  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return new Response('State mismatch — possible CSRF, login aborted. Close this window and try again.', {
      status: 400,
      headers: { 'Set-Cookie': CLEAR_STATE_COOKIE },
    });
  }

  // Exchange the code for an access token
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const { access_token, error } = await tokenResponse.json();

  if (error || !access_token) {
    const html = `<!DOCTYPE html><html><body><script>
      window.opener && window.opener.postMessage('authorization:github:error:${error || 'unknown'}', '*');
      window.close();
    </script></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html', 'Set-Cookie': CLEAR_STATE_COOKIE } });
  }

  // Send the token back to Decap CMS via postMessage
  const token = JSON.stringify({ token: access_token, provider: 'github' });
  const html = `<!DOCTYPE html><html><body><script>
    (function() {
      function receiveMessage(e) {
        window.opener.postMessage(
          'authorization:github:success:${token.replace(/'/g, "\\'")}',
          e.origin
        );
        window.removeEventListener('message', receiveMessage);
        window.close();
      }
      window.addEventListener('message', receiveMessage, false);
      window.opener.postMessage('authorizing:github', '*');
    })();
  </script></body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html', 'Set-Cookie': CLEAR_STATE_COOKIE } });
}
