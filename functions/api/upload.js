// Cloudflare Pages Function — Image Upload
// POST /api/upload?key=...
// Body: { filename: string, content: string (base64), folder?: string, sha?: string }
// Routes files to the correct folder in the repo based on filename.

const DASHBOARD_KEY = 'jA9kx2vP7m';
const REPO          = 'jefferyasare1/jeffery-asare-site';
const BRANCH        = 'main';

// Known filenames (stem only) → correct repo folder
const FOLDER_MAP = {
  'about-portrait':  'images/ui',
  'contact-photo':   'images/ui',
  'hero-1':          'images/ui',
  'hero-2':          'images/ui',
  'hero-3':          'images/ui',
  'hero-4':          'images/ui',
  'hero-5':          'images/ui',
};

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

  const { filename, content, folder: providedFolder, sha: providedSha } = body;
  if (!filename || !content) return json({ error: 'Missing filename or content.' }, 400);

  // Only allow safe filenames — no path separators
  if (!/^[a-zA-Z0-9_\-]+\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
    return json({ error: 'Invalid filename. Use letters, numbers, hyphens, underscores only.' }, 400);
  }

  // Resolve destination folder: explicit > FOLDER_MAP by stem > images/ui
  const stem   = filename.replace(/\.[^.]+$/, '');
  const folder = providedFolder || FOLDER_MAP[stem] || 'images/ui';
  const repoPath = `${folder}/${filename}`;

  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept':        'application/vnd.github.v3+json',
    'User-Agent':    'jeffery-asare-cms',
  };

  // Get existing SHA if file already exists (needed for update)
  let existingSha = providedSha || null;
  if (!existingSha) {
    const checkResp = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${repoPath}?ref=${BRANCH}`,
      { headers: ghHeaders }
    );
    if (checkResp.ok) {
      const checkData = await checkResp.json();
      existingSha = checkData.sha;
    }
  }

  const commitBody = Object.assign({
    message: `Dashboard: upload ${repoPath}`,
    content,
    branch: BRANCH,
  }, existingSha ? { sha: existingSha } : {});

  const ghResp = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${repoPath}`,
    {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(commitBody),
    }
  );

  if (!ghResp.ok) {
    const err = await ghResp.json().catch(() => ({}));
    return json({ error: `GitHub error ${ghResp.status}: ${err.message || 'unknown'}` }, 502);
  }

  return json({ ok: true, path: '/' + repoPath });
}
