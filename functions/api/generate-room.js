// Cloudflare Pages Function — GET /api/generate-room
// Generates room background image options for the dashboard room preview feature.
// Uses Gemini Imagen 3 (with Workers AI FLUX fallback).
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
    gallery: 'Fine art gallery interior, portrait format vertical photograph. Warm white plaster walls, overhead gallery spotlights casting soft even light. Warm herringbone oak parquet floor. One large empty wall centered prominently in frame: smooth, bright, ready for artwork. No art on the wall. No people. Slight upward camera angle. Professional architectural photography, photorealistic, ultra-detailed. Clean, sophisticated gallery aesthetic.',
    living: 'Warm sophisticated living room interior, portrait format vertical photograph. Deep dusty taupe walls. A deep corduroy sectional sofa in warm caramel and tawny brown positioned below a large empty wall. Natural linen curtains filtering soft afternoon light. Amber pendant light bulb. Dried botanical branches in a dark ceramic vase. Round natural oak coffee table. One large empty wall clearly visible above and behind the sofa, no artwork on wall, smooth surface. No people. Warm ambient light. Photorealistic, ultra-detailed interior design photography.',
    bedroom: 'Serene minimalist bedroom interior, portrait format vertical photograph. Warm cream and off-white walls, polished pale hardwood floor. Simple natural oak bed frame with softly rounded headboard, linen bedding in sand and oat tones. Small square oak nightstand with a warm white table lamp glowing softly. Ceramic potted plant beside the bed. One large empty wall clearly visible above the headboard, no artwork on wall, smooth plaster surface. No people. Soft warm evening light. Photorealistic, ultra-detailed interior design photography, minimal Japandi aesthetic.'
  };

  const prompt = prompts[room];
  const geminiKey = env.GEMINI_API_KEY;

  // Attempt 1: Gemini Imagen 3
  if (geminiKey) {
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=' + geminiKey,
        {
          method: 'POST',
          signal: AbortSignal.timeout(25000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: '3:4' }
          })
        }
      );
      if (res.ok) {
        const data = await res.json();
        const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
        const mime = data?.predictions?.[0]?.mimeType || 'image/png';
        if (b64) {
          return new Response(JSON.stringify({ image: b64, mimeType: mime, room, source: 'gemini-imagen3' }), { headers });
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

  // Attempt 2: Cloudflare Workers AI — FLUX 1 Schnell
  if (!env.AI) {
    return new Response(
      JSON.stringify({ error: 'Neither GEMINI_API_KEY nor AI binding is configured' }),
      { status: 500, headers }
    );
  }

  try {
    const img = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt
    });
    let b64 = '';

    if (img && typeof img.image === 'string') {
      b64 = img.image;
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
      for (let i = 0; i < bytes.length; i += chunkSize) bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      b64 = btoa(bin);
    } else if (img instanceof ArrayBuffer || (img && img.byteLength !== undefined)) {
      const bytes = new Uint8Array(img);
      let bin = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      b64 = btoa(bin);
    } else {
      return new Response(
        JSON.stringify({ error: 'Unknown FLUX response type', type: typeof img, keys: img ? Object.keys(img) : [] }),
        { status: 500, headers }
      );
    }

    return new Response(JSON.stringify({ image: b64, mimeType: 'image/png', room, source: 'flux-1-schnell' }), { headers });

  } catch (e) {
    console.error('Workers AI FLUX failed:', e.message);
    return new Response(JSON.stringify({ error: e.message, room }), { status: 500, headers });
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
