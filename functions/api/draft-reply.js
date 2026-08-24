// Cloudflare Pages Function — POST /api/draft-reply
// Generates a draft reply using Cloudflare Workers AI (no external API needed).
// Requires the AI binding set in Cloudflare Pages Settings → Bindings → Workers AI → name: AI

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://jefferyasare.com',
    'Content-Type': 'application/json'
  };

  try {
    const body = await request.json();

    // Auth check — env.DASHBOARD_KEY must be set (unset = deny); see security assessment, Finding 4 (2026-08-24)
    if (!env.DASHBOARD_KEY || body.key !== env.DASHBOARD_KEY) {
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

    const prompt = `You are writing a reply for Jeffery Asare — a fine art phone photographer based in Accra, Ghana.

FACTS about Jeffery (use these accurately — never invent details):
- He shoots on iPhone. That is his medium for his personal and fine art work. He also shoots professionally with a full kit for commercial jobs.
- He does NOT own a studio. He sometimes shoots in studios, but they belong to others. His personal work is done in the streets, markets, coastlines, and ordinary places of Accra and Ghana.
- He sells limited edition archival prints — signed and numbered — that ship worldwide from Accra.
- Payment for prints goes through Paystack (not PayPal or any other platform).
- He edits entirely on his phone in Lightroom Mobile. The whole process never leaves his hands.
- Inquiries are typically about: prints, commissions, exhibitions, collaborations, or just to say hello.
- Email: hello@jefferyasare.com. Instagram: @jeffasare. He responds typically within 24 hours.
- He does not travel to exotic locations looking for images. He works in Ghana — Accra, the coast, the north, the markets and side streets.

HIS VOICE (write in this exact tone — study these lines from his own writing):
"I shoot because something stops me. A face. A shadow. The way a wall holds colour at the end of the day."
"I am not interested in what the camera cannot do, only in what I have not yet figured out how to see."
"I read every message personally."
Short sentences. No corporate speak. No "I hope this message finds you well." Conversational, like texting a friend.

${toneInstruction}

Respond specifically to what they wrote — do not be generic. If they ask about a studio or PayPal, correct it naturally. Sign off as Jeff (just "Jeff" or "– Jeff"). No subject line, no "Dear [name]," just start the reply directly.

Their name: ${name}
Subject: ${subject || '(no subject)'}
What they wrote:
${message}

Write only the reply text. Nothing else.`;

    const response = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
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
      'Access-Control-Allow-Origin': 'https://jefferyasare.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
