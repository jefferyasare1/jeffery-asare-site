// Cloudflare Pages Function — AI Photo Title + Description Suggestion
// POST /api/ai-suggest?key=...
// Body: { image: string (base64 JPEG), mimeType?: string }
// Flow: Claude + Grok run simultaneously → Claude synthesises the best of both → one result
// Returns: { ok: true, title: string, description: string }
// Requires ANTHROPIC_API_KEY (required) and XAI_API_KEY (optional) in Cloudflare env variables.

const DASHBOARD_KEY = 'jA9kx2vP7m';

const STYLE_PROMPT = `You are helping Jeffery Asare — a Ghanaian fine art phone photographer based in Accra — write titles and descriptions for his photographs.

TITLE RULES:
Poetic, minimal, quietly observational. 2–6 words. First word capitalised, rest lowercase. No punctuation at the end.
Examples: "The Language of Stillness", "Before He Looked Up", "What She Bears", "Somewhere to Land",
"The Load Won't Wait", "Blood and Shadow", "Half-Hidden", "Chaos of Desires",
"Blinded by the Spotlight", "Carrying It All", "Heaven Dey", "Resting the Load",
"Something Caught His Attention", "The Sun Found Her".

DESCRIPTION RULES:
1–2 sentences, gallery-caption style. Quiet, observational, present tense. Max 35 words.
Focus on what is seen and felt, not what is told. Avoid starting with "A man" or "A woman".

Return ONLY valid JSON, no markdown: {"title": "...", "description": "..."}`;

const SYNTHESIS_PROMPT = `You are helping Jeffery Asare — a Ghanaian fine art phone photographer — finalise the best title and description for one of his photos.

Two AI models each suggested a title and description after looking at the same photo.
Your job: pick the strongest title and the most evocative description from the two suggestions, or blend elements from both if the result is better than either alone.

TITLE RULES: 2–6 words, poetic, minimal, first word capitalised, rest lowercase, no punctuation.
DESCRIPTION RULES: 1–2 sentences, gallery-caption style, quiet, present tense, max 35 words.

Return ONLY valid JSON, no markdown: {"title": "...", "description": "..."}`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function parseResult(text) {
  const match  = text.match(/\{[\s\S]*?\}/);
  const result = JSON.parse(match?.[0] || text);
  if (!result.title) throw new Error('no title in response');
  return result;
}

// ── Claude vision call ──────────────────────────────────────────────
async function callClaude(image, mimeType, apiKey) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: STYLE_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
          { type: 'text', text: 'Suggest a title and description for this photo. Return only JSON.' },
        ],
      }],
    }),
  });
  if (!resp.ok) { const e = await resp.json().catch(()=>({})); throw new Error(`Claude ${resp.status}: ${e.error?.message||'unknown'}`); }
  const d = await resp.json();
  return parseResult(d.content?.[0]?.text || '');
}

// ── Grok vision call ────────────────────────────────────────────────
async function callGrok(image, mimeType, apiKey) {
  const resp = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'grok-2-vision-latest', max_tokens: 300,
      messages: [
        { role: 'system', content: STYLE_PROMPT },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}` } },
          { type: 'text', text: 'Suggest a title and description for this photo. Return only JSON.' },
        ]},
      ],
    }),
  });
  if (!resp.ok) { const e = await resp.json().catch(()=>({})); throw new Error(`Grok ${resp.status}: ${e.error?.message||'unknown'}`); }
  const d = await resp.json();
  return parseResult(d.choices?.[0]?.message?.content || '');
}

// ── Claude synthesis call (text only, fast) ─────────────────────────
async function synthesise(claudeResult, grokResult, apiKey) {
  const userMsg = [
    `Claude suggested: ${JSON.stringify(claudeResult)}`,
    `Grok suggested: ${JSON.stringify(grokResult)}`,
    'Give me the single best title and description. Return only JSON.',
  ].join('\n\n');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 200, system: SYNTHESIS_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!resp.ok) { const e = await resp.json().catch(()=>({})); throw new Error(`Synthesis ${resp.status}: ${e.error?.message||'unknown'}`); }
  const d = await resp.json();
  return parseResult(d.content?.[0]?.text || '');
}

// ── Handler ────────────────────────────────────────────────────────
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

  // Run Claude and Grok simultaneously
  const XAI_KEY = env.XAI_API_KEY;
  const [claudeResult, grokResult] = await Promise.allSettled([
    callClaude(image, mimeType, ANTHROPIC_KEY),
    XAI_KEY ? callGrok(image, mimeType, XAI_KEY) : Promise.reject(new Error('XAI_API_KEY not set')),
  ]);

  const claudeOk = claudeResult.status === 'fulfilled';
  const grokOk   = grokResult.status   === 'fulfilled';

  // Both succeeded → synthesise
  if (claudeOk && grokOk) {
    try {
      const final = await synthesise(claudeResult.value, grokResult.value, ANTHROPIC_KEY);
      return json({ ok: true, title: final.title, description: final.description || '' });
    } catch (e) {
      // Synthesis failed — fall back to Claude result
      return json({ ok: true, title: claudeResult.value.title, description: claudeResult.value.description || '' });
    }
  }

  // Only one succeeded → use it directly
  if (claudeOk) return json({ ok: true, title: claudeResult.value.title, description: claudeResult.value.description || '' });
  if (grokOk)   return json({ ok: true, title: grokResult.value.title,   description: grokResult.value.description || '' });

  // Both failed
  return json({ error: `Both models failed. Claude: ${claudeResult.reason?.message}. Grok: ${grokResult.reason?.message}` }, 500);
}
