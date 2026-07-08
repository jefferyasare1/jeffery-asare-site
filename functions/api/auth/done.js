// Cloudflare Pages Function: GitHub OAuth callback for Decap CMS
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('No code provided', { status: 400 });
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
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
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

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}
