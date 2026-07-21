// Cloudflare Pages Function — Image Upload
// POST /api/upload?key=...
// Body: { filename: string, content: string (base64), sha?: string }
// Commits image file to the GitHub repo root

const DASHBOARD_KEY = 'jA9kx2vP7m';
const REPO          = 'jefferyasare1/jeffery-asare-site';
const BRANCH        = 'main';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (key !== DASHBOARD_KEY) return json({ error: 'Unauthorized' }, 401);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured.' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { filename, content, sha: providedSha } = body;
  if (!filename || !content) return json({ error: 'Missing filename or content.' }, 400);

  // Only allow safe filenames with image extensions
  if (!/^[a-zA-Z0-9_\-]+\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
    return json({ error: 'Invalid filename. Use letters, numbers, hyphens, underscores only.' }, 400);
  }

  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept':        'application/vnd.github.v3+json',
    'User-Agent':    'jeffery-asare-cms',
  };

  // If no SHA provided, check if file already exists
  let existingSha = providedSha || null;
  if (!existingSha) {
    const checkResp = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${filename}?ref=${BRANCH}`,
      { headers: ghHeaders }
    );
    if (checkResp.ok) {
      const checkData = await checkResp.json();
      existingSha = checkData.sha;
    }
  }

  const commitBody = Object.assign({
    message: `Dashboard: upload ${filename}`,
    content,   // already base64 (no data URI prefix)
    branch: BRANCH,
  }, existingSha ? { sha: existingSha } : {});

  const ghResp = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${filename}`,
    {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(commitBody),
    }
  );

  if (!ghResp.ok) {
    const err = await ghResp.json().catch(() => ({}));
    return json({ error: `GitHub error ${ghResp.status}: ${err.message || 'unknown'}` }, 500);
  }

  return json({ ok: true, path: '/' + filename });
}
