// Cloudflare Pages Function: GitHub OAuth initiation for Decap CMS
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');

  if (provider !== 'github') {
    return new Response('Provider not supported', { status: 400 });
  }

  const githubUrl = new URL('https://github.com/login/oauth/authorize');
  githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set('scope', 'repo,user');
  githubUrl.searchParams.set('redirect_uri', `${url.origin}/api/auth/done`);

  return Response.redirect(githubUrl.toString(), 302);
}
