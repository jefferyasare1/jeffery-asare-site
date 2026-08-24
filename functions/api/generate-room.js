// Cloudflare Pages Function — GET /api/generate-room
// Generates 3 room background image options for the print room preview feature.
// Uses Gemini Imagen 3 (with Workers AI FLUX fallback).
//
// Admin-only (dashboard). Usage: /api/generate-room?room=living&key=<DASHBOARD_KEY>
// Returns: { images: [b64_1, b64_2, b64_3], mimeType, room, source }

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const room = url.searchParams.get('room') || 'living';
  const key = url.searchParams.get('key');

  const headers = {
    'Access-Control-Allow-Origin': 'https://jefferyasare.com',
    'Content-Type': 'application/json'
  };

  // env.DASHBOARD_KEY must be set (unset = deny); see security assessment, Finding 4 (2026-08-24)
  if (!env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  const validRooms = ['living'];
  if (!validRooms.includes(room)) {
    return new Response(JSON.stringify({ error: 'Invalid room. Use: living' }), { status: 400, headers });
  }

  const prompts = {
    living: 'Warm sophisticated living room interior, portrait format vertical photograph. Deep dusty taupe walls. A deep corduroy sectional sofa in warm caramel and tawny brown positioned below a large empty wall. Natural linen curtains filtering soft afternoon light. Amber pendant light bulb. Dried botanical branches in a dark ceramic vase. Round natural oak coffee table. One large empty wall clearly visible above and behind the sofa — no artwork, smooth wall surface. No people. Warm ambient light. Photorealistic, ultra-detailed interior design photography.'
  };

  const prompt = prompts[room];
  const geminiKey = env.GEMINI_API_KEY;

  // ── Attempt 1: Gemini Imagen 3 (3 images at once) ────────────────────────────
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiKey}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(45000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
              sampleCount: 3,
              aspectRatio: '3:4'
            }
          })
        }
      );

      if (res.ok) {
        const data = await res.json();
        const predictions = data?.predictions || [];
        const images = predictions
          .map(p => p?.bytesBase64Encoded)
          .filter(Boolean);
        const mime = predictions[0]?.mimeType || 'image/png';

        if (images.length > 0) {
          return new Response(
            JSON.stringify({ images, mimeType: mime, room, source: 'gemini-imagen3' }),
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

  // ── Attempt 2: Cloudflare Workers AI — FLUX 1 Schnell (3 parallel calls) ────
  if (!env.AI) {
    return new Response(
      JSON.stringify({ error: 'Neither GEMINI_API_KEY nor AI binding is configured' }),
      { status: 500, headers }
    );
  }

  async function runFlux() {
    const img = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt });

    if (img && typeof img.image === 'string') {
      return img.image;
    } else if (img && typeof img.getReader === 'function') {
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
      let bin = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      return btoa(bin);
    } else if (img instanceof ArrayBuffer || (img && img.byteLength !== undefined)) {
      const bytes = new Uint8Array(img);
      let bin = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      return btoa(bin);
    }
    throw new Error('Unknown FLUX response type');
  }

  // Run sequentially to avoid overwhelming Workers AI capacity
  try {
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await runFlux());
    }
    return new Response(
      JSON.stringify({ images: results, mimeType: 'image/png', room, source: 'flux-1-schnell' }),
      { headers }
    );
  } catch (e) {
    console.error('Workers AI FLUX failed:', e.message);
    return new Response(
      JSON.stringify({ error: 'AI capacity is temporarily exceeded. Wait a moment and try again.' }),
      { status: 503, headers }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://jefferyasare.com',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
