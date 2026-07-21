// Cloudflare Pages Function — Content CMS
// Reads and writes any _data/**/*.json file via the GitHub API
// Used exclusively by the password-protected dashboard
//
// GET  /api/content?key=...&file=<path>  → returns file content + SHA
//      file examples: journal, prints, settings/general, portfolio/abstract
// PUT  /api/content?key=...              → writes updated content back to GitHub

const DASHBOARD_KEY = 'jA9kx2vP7m';
const REPO          = 'jefferyasare1/jeffery-asare-site';
const BRANCH        = 'main';

// Resolve a file key to a repo path under _data/
// Accepts: "journal", "prints", "settings/general", "portfolio/abstract", etc.
// Rejects anything with ".." or characters outside safe set
function resolveFilePath(fileKey) {
  if (!fileKey) return null;
  if (!/^[a-z0-9][a-z0-9\-_/]*$/.test(fileKey)) return null;
  if (fileKey.includes('..') || fileKey.includes('//')) return null;
  return `_data/${fileKey}.json`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url  = new URL(request.url);
  const key  = url.searchParams.get('key');

  // ── Auth ────────────────────────────────────────────────────────
  if (key !== DASHBOARD_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return json({ error: 'GITHUB_TOKEN not configured — add it in Cloudflare Pages environment variables.' }, 500);
  }

  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept':        'application/vnd.github.v3+json',
    'User-Agent':    'jeffery-asare-cms',
  };

  // ── GET — read a file ───────────────────────────────────────────
  if (request.method === 'GET') {
    const fileKey = url.searchParams.get('file');
    const filePath = resolveFilePath(fileKey);
    if (!filePath) return json({ error: 'Invalid file key. Use e.g. file=journal, file=settings/general, file=portfolio/abstract' }, 400);

    const ghResp = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${filePath}?ref=${BRANCH}`,
      { headers: ghHeaders }
    );

    if (!ghResp.ok) {
      const err = await ghResp.json().catch(() => ({}));
      return json({ error: `GitHub error ${ghResp.status}: ${err.message || 'unknown'}` }, 500);
    }

    const data = await ghResp.json();
    // GitHub returns base64-encoded content (with newlines)
    const raw  = data.content.replace(/\n/g, '');
    const text = decodeURIComponent(escape(atob(raw)));
    const content = JSON.parse(text);

    return json({ ok: true, content, sha: data.sha });
  }

  // ── PUT — write a file ──────────────────────────────────────────
  if (request.method === 'PUT') {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON body' }, 400); }

    const { file: fileKey, content, sha, message } = body;
    const filePath = resolveFilePath(fileKey);
    if (!filePath) return json({ error: 'Invalid file key.' }, 400);
    // sha is required for updates; new files omit it (GitHub will create them)

    const jsonText = JSON.stringify(content, null, 2) + '\n';
    const encoded  = btoa(unescape(encodeURIComponent(jsonText)));

    const ghResp = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({
          message: message || `Dashboard: update ${filePath}`,
          content: encoded,
          branch: BRANCH,
        }, sha ? { sha } : {})),
      }
    );

    if (!ghResp.ok) {
      const err = await ghResp.json().catch(() => ({}));
      return json({ error: `GitHub error ${ghResp.status}: ${err.message || 'unknown'}` }, 500);
    }

    const result = await ghResp.json();
    return json({ ok: true, sha: result.content?.sha });
  }

  return json({ error: 'Method not allowed' }, 405);
}
