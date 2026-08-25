// Cloudflare Pages Function — Image & Ambient-Sound Upload
// POST /api/upload?key=...
// Body: { filename: string, content: string (base64), folder?: string, sha?: string }
// Routes files to the correct folder in the repo based on filename.

// DASHBOARD_KEY read from env.DASHBOARD_KEY below — see security assessment, Finding 4 (2026-08-24)
const REPO          = 'jefferyasare1/jeffery-asare-site';
const BRANCH        = 'main';

// Magic-byte check — the filename extension was trusted before; now the actual
// bytes have to match a real image signature for that extension too.
// (security assessment, Finding 12, 2026-08-24)
const MAGIC_BYTES = {
  jpg:  [[0xFF, 0xD8, 0xFF]],
  jpeg: [[0xFF, 0xD8, 0xFF]],
  png:  [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  gif:  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  webp: [[0x52, 0x49, 0x46, 0x46]], // RIFF — WEBP marker itself sits at byte 8, checked separately below
};

function bytesMatchExtension(bytes, ext) {
  const sigs = MAGIC_BYTES[ext.toLowerCase()];
  if (!sigs) return false;
  const matches = sigs.some(sig => sig.every((b, i) => bytes[i] === b));
  if (!matches) return false;
  if (ext.toLowerCase() === 'webp') {
    // RIFF????WEBP — confirm the WEBP marker at offset 8
    const webpMarker = [0x57, 0x45, 0x42, 0x50];
    return webpMarker.every((b, i) => bytes[8 + i] === b);
  }
  return true;
}

// MP3 has no single fixed signature — either an ID3v2 tag up front, or a bare
// MPEG frame sync (11 set bits: 0xFF followed by a byte whose top 3 bits are
// all set). Either is accepted as "genuinely looks like audio".
function bytesLookLikeMp3(bytes) {
  const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33; // "ID3"
  const isFrameSync = bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0;
  return isId3 || isFrameSync;
}

// Known filenames (stem only) → correct repo folder
const FOLDER_MAP = {
  'about-portrait':  'images/ui',
  'contact-photo':   'images/ui',
  'hero-1':          'images/ui',
  'hero-2':          'images/ui',
  'hero-3':          'images/ui',
  'hero-4':          'images/ui',
  'hero-5':          'images/ui',
  'ambient':         'audio',
};

// The one MP3 this endpoint is allowed to write — the site's background
// ambient track. Kept narrow on purpose: unlike images (any reasonable
// filename), an arbitrary audio upload has no natural home in the repo, so
// this only ever replaces the single known file the dashboard's "Ambient
// Background Sound" control offers.
const ALLOWED_MP3_FILENAME = 'ambient.mp3';

// Keep the background track light — it's quiet, looping music, not a
// download. 8MB comfortably covers a good MP3 encode while staying well
// inside GitHub's Contents API limits.
const MAX_MP3_BYTES = 8 * 1024 * 1024;

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

  if (!env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) return json({ error: 'Unauthorized' }, 401);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured.' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { filename, content, folder: providedFolder, sha: providedSha } = body;
  if (!filename || !content) return json({ error: 'Missing filename or content.' }, 400);

  // Only allow safe filenames — no path separators
  const extMatch = /^[a-zA-Z0-9_\-]+\.(jpg|jpeg|png|webp|gif|mp3)$/i.exec(filename);
  if (!extMatch) {
    return json({ error: 'Invalid filename. Use letters, numbers, hyphens, underscores only.' }, 400);
  }
  const ext = extMatch[1].toLowerCase();
  const isAudio = ext === 'mp3';

  // MP3 uploads only ever replace the one ambient-sound file — there's no
  // repo location for an arbitrary audio filename the way there is for images.
  if (isAudio && filename.toLowerCase() !== ALLOWED_MP3_FILENAME) {
    return json({ error: `Audio uploads must be named "${ALLOWED_MP3_FILENAME}".` }, 400);
  }

  // Confirm the actual bytes match the claimed extension — a renamed non-image
  // file with the right extension used to sail through here (Finding 12).
  // Same idea applied to mp3: a renamed non-audio file gets caught here too.
  let headerBytes;
  try {
    const headerB64 = content.slice(0, 32).replace(/[^A-Za-z0-9+/]/g, '');
    const bin = atob(headerB64);
    headerBytes = Array.from(bin, c => c.charCodeAt(0));
  } catch {
    return json({ error: 'Could not decode file content.' }, 400);
  }
  const bytesOk = isAudio ? bytesLookLikeMp3(headerBytes) : bytesMatchExtension(headerBytes, ext);
  if (!bytesOk) {
    return json({ error: 'File content doesn\'t match its extension — refusing to upload.' }, 400);
  }

  // Keep the ambient track light — same 8MB ceiling the dashboard warns
  // about before it even sends the file.
  if (isAudio) {
    const approxBytes = Math.floor(content.length * 3 / 4);
    if (approxBytes > MAX_MP3_BYTES) {
      return json({ error: `That file is too large (max ${(MAX_MP3_BYTES / 1024 / 1024).toFixed(0)}MB for the ambient track).` }, 400);
    }
  }

  // Resolve destination folder: mp3 always → audio; otherwise explicit > FOLDER_MAP by stem > images/ui
  const stem   = filename.replace(/\.[^.]+$/, '');
  const folder = isAudio ? 'audio' : (providedFolder || FOLDER_MAP[stem] || 'images/ui');
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
