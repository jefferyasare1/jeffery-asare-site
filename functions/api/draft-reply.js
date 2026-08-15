// Cloudflare Pages Function — POST /api/draft-reply
// Generates a draft reply to a contact form message using the Anthropic API.
// Requires ANTHROPIC_API_KEY secret set in Cloudflare Pages dashboard.

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const body = await request.json();

    // Auth check
    if (body.key !== 'jA9kx2vP7m') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { name, subject, message } = body;
    if (!name || !message) {
      return new Response(JSON.stringify({ error: 'Missing name or message' }), { status: 400, headers: corsHeaders });
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: corsHeaders });
    }

    const prompt = `You are helping Jeffery Asare, a fine art photographer based in Ghana, reply to a message from a customer or inquirer on his website.

Write a warm, professional reply from Jeff. Keep it concise (2-4 sentences), genuine, and specific to what they wrote. Don't be generic. Sign off as Jeff.

Customer name: ${name}
Subject: ${subject || '(no subject)'}
Their message:
${message}

Write only the reply body. Start directly — no "Dear [name]," opening. End with a natural closing like "Jeff" or "– Jeff". No subject line.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error:', errText);
      return new Response(JSON.stringify({ error: 'AI service error' }), { status: 502, headers: corsHeaders });
    }

    const data = await res.json();
    const draft = data?.content?.[0]?.text?.trim() || '';

    if (!draft) {
      return new Response(JSON.stringify({ error: 'No draft generated' }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ draft }), { headers: corsHeaders });

  } catch (e) {
    console.error('draft-reply error:', e);
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
