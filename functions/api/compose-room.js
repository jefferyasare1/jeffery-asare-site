// Cloudflare Pages Function — GET /api/compose-room
//
// Content-aware "see it in a room" preview. Takes a specific print + room + size
// and asks Gemini to composite a realistically framed version of the print onto
// the empty wall in the room photo — matching perspective, lighting, scale, and
// casting a real shadow. Replaces the old fixed-CSS-percentage overlay, which
// couldn't tell a wall from a lamp.
//
// No CMS key required — this endpoint is called from the public site (every
// visitor who opens "See it in a room") as well as the dashboard's own preview,
// so nothing secret can live in the query string. Instead it's locked down by:
//   - print path allowlist (must be a real /images/... file, no arbitrary URLs)
//   - a KV cache keyed by (room, size, print) so the same print/size only ever
//     hits Gemini once — everyone after that gets the cached composite instantly
//     and for free. Bind a KV namespace called ROOM_CACHE_KV in the Cloudflare
//     dashboard (same pattern as WAITLIST_KV) to turn this on; it works without
//     one, it's just uncached (and uncapped) until you do.
//
// Usage:   /api/compose-room?room=living&print=/images/portfolio/x/y.jpg&size=a3
// Returns: { image: b64, mimeType, room, size, source, cached }
//
// NOTE: the exact Gemini image-editing endpoint/model naming has moved fast
// (Imagen -> gemini-2.0-flash-exp-image-generation -> gemini-2.5-flash-image ->
// gemini-3.1-flash-image, plus a newer "Interactions API" alongside the classic
// generateContent one). This tries a short list of known-good combinations in
// order and logs every miss, so if Google's shuffled things again by the time
// this runs, check the Cloudflare function logs for compose-room — the error
// text will say exactly which call failed and why, and the list below is the
// only place that needs updating.

const ROOM_BACKGROUNDS = {
  living: '/images/rooms/living.jpg'
};

// Longest outer edge of each ISO size, in cm — anchors real-world scale so the
// framed print doesn't come back the size of a postage stamp or a barn door.
const SIZE_CM = { a4: 29.7, a3: 42, a2: 59.4, a1: 84.1 };

const SAFE_PRINT_PATH = /^\/images\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp)$/i;

// Tried in order until one works.
const GEMINI_ATTEMPTS = [
  { apiVersion: 'v1', model: 'gemini-3.1-flash-image' },
  { apiVersion: 'v1beta', model: 'gemini-3.1-flash-image' },
  { apiVersion: 'v1', model: 'gemini-2.5-flash-image' },
  { apiVersion: 'v1beta', model: 'gemini-2.5-flash-image' }
];

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
  });
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

// Loads a same-zone static asset (print photos, room backgrounds) as base64.
// IMPORTANT: this must go through env.ASSETS.fetch(), not a raw fetch(url) —
// a Pages Function calling fetch() back to its own zone's public hostname
// hits Cloudflare's same-zone subrequest restriction and the whole invocation
// 502s at the edge with no JSON body at all (nothing here to catch it — the
// _middleware.js SPA fallback already works around this the same way).
async function fetchAsBase64(env, request, path) {
  const assetUrl = new URL(path, request.url).toString();
  const res = await env.ASSETS.fetch(new Request(assetUrl));
  if (!res.ok) throw new Error('Failed to fetch ' + path + ' (' + res.status + ')');
  const buf = await res.arrayBuffer();
  const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  return { base64: bytesToBase64(new Uint8Array(buf)), mimeType: contentType };
}

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Tolerant of inlineData/inline_data casing — the docs aren't consistent about it.
function extractImage(data) {
  const candidates = data && data.candidates;
  if (!Array.isArray(candidates)) return null;
  for (const c of candidates) {
    const parts = c && c.content && c.content.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      const inline = p.inlineData || p.inline_data;
      if (inline && inline.data) {
        return { data: inline.data, mimeType: inline.mimeType || inline.mime_type || 'image/png' };
      }
    }
  }
  return null;
}

async function callGemini(apiVersion, model, geminiKey, promptText, images) {
  const parts = [{ text: promptText }];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(55000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${apiVersion}/${model} error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const img = extractImage(data);
  if (!img) {
    throw new Error(`${apiVersion}/${model} returned no image: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return img;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const room = url.searchParams.get('room') || 'living';
  const printPath = url.searchParams.get('print') || '';
  const size = (url.searchParams.get('size') || 'a3').toLowerCase();

  if (!ROOM_BACKGROUNDS[room]) {
    return json({ error: 'Invalid room. Use: ' + Object.keys(ROOM_BACKGROUNDS).join(', ') }, 400);
  }
  if (!SAFE_PRINT_PATH.test(printPath)) {
    return json({ error: 'Invalid or missing print path.' }, 400);
  }
  if (!SIZE_CM[size]) {
    return json({ error: 'Invalid size. Use: a4, a3, a2, a1' }, 400);
  }

  const cacheKey = 'room-compose:' + await sha256Hex(`${room}:${size}:${printPath}`);

  if (env.ROOM_CACHE_KV) {
    try {
      const cached = await env.ROOM_CACHE_KV.get(cacheKey, 'json');
      if (cached && cached.image) {
        return json(Object.assign({}, cached, { cached: true }), 200);
      }
    } catch (e) {
      console.error('ROOM_CACHE_KV read failed:', e.message);
    }
  }

  const geminiKey = env.GEMINI_API_KEY;
  if (!geminiKey) {
    return json({ error: 'GEMINI_API_KEY not configured.' }, 500);
  }

  let printImg, roomImg;
  try {
    [printImg, roomImg] = await Promise.all([
      fetchAsBase64(env, request, printPath),
      fetchAsBase64(env, request, ROOM_BACKGROUNDS[room])
    ]);
  } catch (e) {
    return json({ error: 'Could not load source images: ' + e.message }, 502);
  }

  const longEdgeCm = SIZE_CM[size];
  const promptText =
    'You are given two images: the SECOND image is a photograph of a room with one empty wall. ' +
    'The FIRST image is a fine art print. ' +
    'Composite the first image onto the empty wall in the second image as a realistically framed, matted print: ' +
    'a thin dark walnut-brown wooden frame (about 2cm wide) around a cream/off-white mat border (about 6-8cm wide), ' +
    'the photograph itself centered inside, uncropped, at its original aspect ratio. ' +
    `Scale the whole framed piece so its longest outer edge reads as roughly ${longEdgeCm}cm in real life, judged against ` +
    'the furniture and architecture already in the room (door heights, sofa depth, ceiling height). ' +
    "Match the room's existing camera angle, perspective, lighting direction, and color temperature exactly, and cast a soft, " +
    'realistic shadow from the frame onto the wall. Do not change anything else in the room. ' +
    'Output only the final composited photograph — photorealistic, no borders, no added text, no watermark.';

  let result = null;
  let lastErr = null;
  let sourceLabel = null;
  for (const attempt of GEMINI_ATTEMPTS) {
    try {
      result = await callGemini(attempt.apiVersion, attempt.model, geminiKey, promptText, [printImg, roomImg]);
      sourceLabel = attempt.model;
      break;
    } catch (e) {
      lastErr = e;
      console.error('compose-room attempt failed:', e.message);
    }
  }

  if (!result) {
    return json({ error: 'Image compositing failed: ' + (lastErr ? lastErr.message : 'unknown error') }, 502);
  }

  const payload = { image: result.data, mimeType: result.mimeType, room, size, source: sourceLabel };

  if (env.ROOM_CACHE_KV) {
    try {
      await env.ROOM_CACHE_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 60 });
    } catch (e) {
      console.error('ROOM_CACHE_KV write failed:', e.message);
    }
  }

  return json(Object.assign({ cached: false }, payload), 200);
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
