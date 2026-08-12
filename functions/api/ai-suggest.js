// Cloudflare Pages Function — AI Photo Title Suggestion
// POST /api/ai-suggest?key=...
// Body: { image: string (base64 JPEG), mimeType?: string }
// Returns: { ok: true, title: string, description: string }
// Requires ANTHROPIC_API_KEY set in Cloudflare Pages environment variables.

const DASHBOARD_KEY  = 'jA9kx2vP7m';
const CLAUDE_API     = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are helping Jeffery Asare — a Ghanaian fine art phone photographer based in Accra — title his photographs.

His titles are poetic, minimal, and quietly observational. They feel like something overheard, not explained.
They are 2–6 words. First word capitalised, rest lowercase. No punctuation at the end.

Examples of his titles:
"The Language of Stillness", "Before He Looked Up", "What She Bears", "Somewhere to Land",
"The Load Won't Wait", "Blood and Shadow", "Half-Hidden", "Chaos of Desires",
"Blinded by the Spotlight", "Carrying It All", "Heaven Dey", "Resting the Load",
"Passage of Time", "Shoreline Silence", "Still Going, Just Not Yet", "Mid-Thought",
"Something Caught His Attention", "The Sun Found Her", "You Were in the Way".

Also write one short description sentence — observational, gallery-caption tone, no more than 20 words.

Return ONLY valid JSON with no markdown: {"title": "...", "description": "..."}`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.searchParams.get('key') !== DASHBOARD_KEY) return json({ error: 'Unauthorized' }, 401);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured in Cloudflare environment.' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { image, mimeType = 'image/jpeg' } = body;
  if (!image) return json({ error: 'Missing image' }, 400);

  const resp = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 256,
      system:     SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: image },
          },
          {
            type: 'text',
            text: 'Suggest a title and description for this photo. Return only JSON.',
          },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return json({ error: `Claude API error ${resp.status}: ${err.error?.message || 'unknown'}` }, 502);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || '';

  try {
    const match  = text.match(/\{[\s\S]*?\}/);
    const result = JSON.parse(match?.[0] || text);
    if (!result.title) throw new Error('no title');
    return json({ ok: true, title: result.title, description: result.description || '' });
  } catch {
    return json({ error: 'Could not parse AI response', raw: text }, 500);
  }
}
