// Cloudflare Pages Function — POST /api/draft-reply
// Generates a draft reply using Google Gemini API (free tier).
// Requires GEMINI_API_KEY secret set in Cloudflare Pages dashboard.
// Get a free key at aistudio.google.com

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const body = await request.json();

    if (body.key !== 'jA9kx2vP7m') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { name, subject, message, tone } = body;
    if (!name || !message) {
      return new Response(JSON.stringify({ error: 'Missing name or message' }), { status: 400, headers: corsHeaders });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: corsHeaders });
    }

    const toneGuides = {
      warm: 'Sound like a real person talking, not a brand. Warm, genuine, specific to what they said. Short sentences. A bit of personality. 2-3 sentences.',
      professional: 'Clear and direct. Friendly but not chatty. Gets to the point without any filler. 2 sentences.',
      brief: 'One or two sentences. Straight up. No fluff at all.'
    };
    const toneInstruction = toneGuides[tone] || toneGuides.warm;

    const prompt = `You are writing a reply for Jeffery Asare, a fine art photographer based in Ghana who runs a studio and sells prints.

His voice: conversational, like texting a friend. Short sentences. No corporate speak. No "I hope this message finds you well." Just real, direct, warm.

${toneInstruction}

Respond specifically to what they wrote. Sign off as "- Jeff". No subject line, no greeting, just start the reply.

Their name: ${name}
Subject: ${subject || '(no subject)'}
Their message:
${message}

Write only the reply text. Nothing else.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.8 }
        })
      });
    } catch (fetchErr) {
      console.error('Gemini fetch error:', fetchErr.name, fetchErr.message);
      const isTimeout = fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError';
      return new Response(JSON.stringify({ error: isTimeout ? 'AI service timed out' : 'AI service unreachable' }), { status: 502, headers: corsHeaders });
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error('Gemini API error:', res.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error', detail: res.status }), { status: 502, headers: corsHeaders });
    }

    const data = await res.json();
    const draft = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!draft) {
      return new Response(JSON.stringify({ error: 'No draft generated' }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ draft }), { headers: corsHeaders });

  } catch (e) {
    console.error('draft-reply error:', e.name, e.message);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
