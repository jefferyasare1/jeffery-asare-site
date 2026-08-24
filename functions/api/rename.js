// Cloudflare Pages Function — Photo Rename
// POST /api/rename?key=...
// Body: { oldName: "old-file.jpg", newName: "new-file.jpg" }
// 1. Renames the image file via Git Trees API (no 1MB size limit)
// 2. Finds every _data/**/*.json that references the old name and updates it
// 3. All changes land in one single commit

// DASHBOARD_KEY read from env.DASHBOARD_KEY below — see security assessment, Finding 4 (2026-08-24)
const REPO          = 'jefferyasare1/jeffery-asare-site';
const BRANCH        = 'main';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function gh(path, options, token) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...options,
    headers: {
      'Authorization': `token ${token}`,
      'Accept':        'application/vnd.github.v3+json',
      'User-Agent':    'jeffery-asare-cms',
      ...(options?.headers || {}),
    },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.DASHBOARD_KEY || url.searchParams.get('key') !== env.DASHBOARD_KEY)
    return json({ error: 'Unauthorized' }, 401);
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);

  const TOKEN = env.GITHUB_TOKEN;
  if (!TOKEN) return json({ error: 'GITHUB_TOKEN not configured.' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { oldName, newName } = body;
  if (!oldName || !newName) return json({ error: 'Missing oldName or newName.' }, 400);
  if (oldName === newName)   return json({ error: 'Names are identical.' }, 400);

  const safe = /^[a-zA-Z0-9_\-]+\.(jpg|jpeg|png|webp|gif)$/i;
  if (!safe.test(oldName)) return json({ error: 'Invalid old filename. Use letters, numbers, hyphens, underscores + image extension.' }, 400);
  if (!safe.test(newName)) return json({ error: 'Invalid new filename. Use letters, numbers, hyphens, underscores + image extension.' }, 400);

  // ── 1. Get latest commit + tree ──────────────────────────────────
  const refResp = await gh(`/git/ref/heads/${BRANCH}`, {}, TOKEN);
  if (!refResp.ok) return json({ error: 'Could not read repo ref.' }, 500);
  const latestCommitSha = (await refResp.json()).object.sha;

  const commitResp = await gh(`/git/commits/${latestCommitSha}`, {}, TOKEN);
  if (!commitResp.ok) return json({ error: 'Could not read commit.' }, 500);
  const treeSha = (await commitResp.json()).tree.sha;

  // ── 2. Read the full recursive tree ─────────────────────────────
  const treeResp = await gh(`/git/trees/${treeSha}?recursive=1`, {}, TOKEN);
  if (!treeResp.ok) return json({ error: 'Could not read tree.' }, 500);
  const allItems = (await treeResp.json()).tree;

  const oldItem = allItems.find(f => f.path === oldName);
  if (!oldItem) return json({ error: `"${oldName}" not found in the repo.` }, 404);
  if (allItems.find(f => f.path === newName))
    return json({ error: `"${newName}" already exists.` }, 409);

  // ── 3. Build tree update list ────────────────────────────────────
  //   null sha = delete, existing blob sha = keep/add
  const treeUpdate = [
    { path: oldName, mode: '100644', type: 'blob', sha: null },         // delete old
    { path: newName, mode: oldItem.mode, type: 'blob', sha: oldItem.sha }, // add new
  ];

  // ── 4. Find JSON files that reference the old name ───────────────
  const jsonFiles = allItems.filter(f =>
    f.type === 'blob' && f.path.startsWith('_data/') && f.path.endsWith('.json')
  );

  const updatedJsonFiles = [];

  for (const jf of jsonFiles) {
    // Fetch the JSON file content via Contents API (all _data JSON are small)
    const jResp = await gh(`/contents/${jf.path}?ref=${BRANCH}`, {}, TOKEN);
    if (!jResp.ok) continue;
    const jData = await jResp.json();

    let parsed;
    try { parsed = JSON.parse(atob(jData.content.replace(/\n/g, ''))); }
    catch { continue; }

    // Replace "/old-name.jpg" and "old-name.jpg" in the stringified JSON
    const str = JSON.stringify(parsed);
    let updated = str
      .split(JSON.stringify('/' + oldName)).join(JSON.stringify('/' + newName))  // with leading /
      .split(JSON.stringify(oldName)).join(JSON.stringify(newName));              // without /

    if (updated === str) continue; // this file doesn't reference the old name

    // Create a blob for the updated JSON
    const blobResp = await gh('/git/blobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content:  JSON.stringify(JSON.parse(updated), null, 2),
        encoding: 'utf-8',
      }),
    }, TOKEN);
    if (!blobResp.ok) continue;

    const { sha: blobSha } = await blobResp.json();
    treeUpdate.push({ path: jf.path, mode: '100644', type: 'blob', sha: blobSha });
    updatedJsonFiles.push(jf.path);
  }

  // ── 5. Create the new tree ───────────────────────────────────────
  const newTreeResp = await gh('/git/trees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: treeSha, tree: treeUpdate }),
  }, TOKEN);
  if (!newTreeResp.ok) {
    const err = await newTreeResp.json().catch(() => ({}));
    return json({ error: `Tree creation failed: ${err.message || 'unknown'}` }, 500);
  }
  const newTreeSha = (await newTreeResp.json()).sha;

  // ── 6. Create the commit ─────────────────────────────────────────
  const jsonSuffix = updatedJsonFiles.length
    ? ` + update ${updatedJsonFiles.length} JSON ref(s)`
    : '';
  const newCommitResp = await gh('/git/commits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Dashboard: rename ${oldName} → ${newName}${jsonSuffix}`,
      tree:    newTreeSha,
      parents: [latestCommitSha],
    }),
  }, TOKEN);
  if (!newCommitResp.ok) {
    const err = await newCommitResp.json().catch(() => ({}));
    return json({ error: `Commit creation failed: ${err.message || 'unknown'}` }, 500);
  }
  const newCommitSha = (await newCommitResp.json()).sha;

  // ── 7. Advance the branch ref ────────────────────────────────────
  const updateRefResp = await gh(`/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommitSha }),
  }, TOKEN);
  if (!updateRefResp.ok) {
    const err = await updateRefResp.json().catch(() => ({}));
    return json({ error: `Ref update failed: ${err.message || 'unknown'}` }, 500);
  }

  return json({
    ok: true,
    newName,
    updatedJsonFiles,
    message: `Renamed ${oldName} → ${newName}` +
      (updatedJsonFiles.length ? `. Updated ${updatedJsonFiles.length} JSON file(s): ${updatedJsonFiles.join(', ')}` : '.'),
  });
}
