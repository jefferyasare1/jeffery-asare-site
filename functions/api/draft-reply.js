// Cloudflare Pages Function — POST /api/draft-reply
// Generates a draft reply using Cloudflare Workers AI (no external API needed).
// Requires the AI binding set in Cloudflare Pages Settings → Bindings → Workers AI → name: AI

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

    const { name, subject, message, tone } = body;
    if (!name || !message) {
      return new Response(JSON.stringify({ error: 'Missing name or message' }), { status: 400, headers: corsHeaders });
    }

    if (!env.AI) {
      return new Response(JSON.stringify({ error: 'AI binding not configured' }), { status: 500, headers: corsHeaders });
    }

    const toneGuides = {
      warm: 'Sound like a real person talking, not a brand. Warm, genuine, specific to what they said. Short sentences. A bit of personality. 2-3 sentences.',
      professional: 'Clear and direct. Friendly but not chatty. Gets to the point without any filler. 2 sentences.',
      brief: 'One or two sentences. Straight up. No fluff at all.'
    };
    const toneInstruction = toneGuides[tone] || toneGuides.warm;

    const prompt = `You are writing a reply for Jeffery Asare — a fine art photographer based in Ghana. He runs a photography studio and sells prints.

His voice is: conversational, like texting a friend. Short sentences. No corporate speak. No "I hope this message finds you well." Just real, direct, warm.

${toneInstruction}

Respond specifically to what they wrote — don't be generic. Sign off as Jeff (just "Jeff" or "– Jeff"). No subject line, no "Dear [name]," just start the reply.

Their name: ${name}
Subject: ${subject || '(no subject)'}
What they wrote:
${message}

Write only the reply text. Nothing else.`;

    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300
    });

    const draft = response?.response?.trim() || '';

    if (!draft) {
      return new Response(JSON.stringify({ error: 'No draft generated' }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ draft }), { headers: corsHeaders });

  } catch (e) {
    console.error('draft-reply error:', e.name, e.message);
    return new Response(JSON.stringify({ error: 'Server error', detail: e.message }), { status: 500, headers: corsHeaders });
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
