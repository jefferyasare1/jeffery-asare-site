// Cloudflare Pages Function — GET /api/generate-room
// ONE-TIME USE: Generates static room background images for the print room preview feature.
// Uses Gemini Imagen 3 (with Workers AI FLUX fallback).
// After all 3 room images are committed to /images/rooms/, DELETE this file.
//
// Usage: /api/generate-room?room=gallery&key=jA9kx2vP7m
//        /api/generate-room?room=living&key=jA9kx2vP7m
//        /api/generate-room?room=bedroom&key=jA9kx2vP7m

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const room = url.searchParams.get('room') || 'gallery';
  const key = url.searchParams.get('key');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (key !== 'jA9kx2vP7m') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  const validRooms = ['gallery', 'living', 'bedroom'];
  if (!validRooms.includes(room)) {
    return new Response(JSON.stringify({ error: 'Invalid room. Use: gallery, living, bedroom' }), { status: 400, headers });
  }

  const prompts = {
    gallery: 'Interior of a minimalist contemporary art gallery. Pure white walls, polished concrete floor. Straight-on view of a clean empty white wall, centered in frame, ready for artwork. Soft even diffused daylight from skylights. No artwork hanging on wall. No people. Professional architectural photography. Photorealistic, ultra detailed.',

    living: 'Interior of a warm modern Scandinavian living room. Pale sand-beige walls. A low contemporary light gray sofa centered against the back wall. Light natural oak hardwood floor. Warm ambient lighting. Empty wall space clearly visible above the sofa, centered in frame. No artwork hanging. No people. Professional interior design photography. Photorealistic, ultra detailed.',

    bedroom: 'Interior of a serene minimalist bedroom. Soft warm white walls. Neatly made bed with crisp white linen and a simple natural wood headboard, centered against the back wall. Natural morning window light. Empty wall clearly visible above the headboard, centered in frame. No artwork hanging. No people. Professional interior design photography. Photorealistic, ultra detailed.'
  };

  const prompt = prompts[room];
  const geminiKey = env.GEMINI_API_KEY;

  // ── Attempt 1: Gemini Imagen 3 ──────────────────────────────────────────────
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiKey}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(25000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: '16:9'
            }
          })
        }
      );

      if (res.ok) {
        const data = await res.json();
        const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
        const mime = data?.predictions?.[0]?.mimeType || 'image/png';

        if (b64) {
          return new Response(
            JSON.stringify({ image: b64, mimeType: mime, room, source: 'gemini-imagen3' }),
            { headers }
          );
        }

        console.error('Imagen response missing image data:', JSON.stringify(data).slice(0, 300));
      } else {
        const errText = await res.text();
        console.error('Imagen API error:', res.status, errText.slice(0, 300));
      }
    } catch (e) {
      console.error('Gemini/Imagen failed:', e.message, '— falling back to Workers AI FLUX');
    }
  } else {
    console.warn('GEMINI_API_KEY not set — skipping Gemini, using Workers AI FLUX');
  }

  // ── Attempt 2: Cloudflare Workers AI — FLUX 1 Schnell ───────────────────────
  if (!env.AI) {
    return new Response(
      JSON.stringify({ error: 'Neither GEMINI_API_KEY nor AI binding is configured' }),
      { status: 500, headers }
    );
  }

  try {
    const img = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt,
      num_steps: 8,
      width: 1024,
      height: 576
    });

    // Workers AI returns a ReadableStream — read to bytes then encode
    const reader = img.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.length; }

    // Uint8Array → base64
    let bin = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const b64 = btoa(bin);

    return new Response(
      JSON.stringify({ image: b64, mimeType: 'image/png', room, source: 'flux-1-schnell' }),
      { headers }
    );

  } catch (e) {
    console.error('Workers AI FLUX failed:', e.message);
    return new Response(
      JSON.stringify({ error: e.message, room }),
      { status: 500, headers }
    );
  }
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
