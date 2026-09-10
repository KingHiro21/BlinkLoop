// POST /api/ai { task, text, context? }   (staff session required)
// Rewrites one piece of website copy for the Loop Builder's "✨ AI" buttons with Claude. Tasks: improve, shorten,
// expand, punchy, fix, translate. Answers {ok:true, text} or {ok:false, reason: no-key | invalid | slow-down | upstream}.
// Env: ANTHROPIC_API_KEY (optional AI_MODEL, default claude-sonnet-5). Without the key the builder shows how to switch it on.
const { sessionClient, readBody } = require('../lib/session.js');

const TASKS = {
  improve: 'Rewrite it so it is clearer, more specific and more persuasive. Keep the meaning and roughly the same length.',
  shorten: 'Cut it to about half the length without losing the point.',
  expand: 'Say a little more: add one or two concrete, plausible details a small business would have. At most double the length.',
  punchy: 'Make it punchier: shorter sentences, stronger verbs, a confident voice. Same meaning.',
  fix: 'Fix spelling, grammar and punctuation only. Change nothing else.',
  translate: 'Translate it into the language named by the page language code, keeping the tone.'
};
const LANG_NAMES = { en: 'English', ja: 'Japanese', fr: 'French', zh: 'Chinese', es: 'Spanish', it: 'Italian', ar: 'Arabic', tl: 'Filipino', ko: 'Korean', de: 'German', pt: 'Portuguese' };
const hits = new Map(); // per instance: 60 rewrites per staff member per hour
function limited(key){
  const now = Date.now(); const rec = hits.get(key) || { n: 0, t: now };
  if (now - rec.t > 3600000){ rec.n = 0; rec.t = now; }
  rec.n++; hits.set(key, rec); return rec.n > 60;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok: false, reason: 'server-config' });
  const client = sessionClient(req, secret);
  if (!client) return res.status(401).json({ ok: false, reason: 'unauthorized' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: 'no-key' });

  const body = readBody(req);
  const task = TASKS[String(body.task || '')] ? String(body.task) : 'improve';
  const text = String(body.text || '').trim().slice(0, 4000);
  if (text.length < 2) return res.status(200).json({ ok: false, reason: 'invalid' });
  if (limited(client)) return res.status(429).json({ ok: false, reason: 'slow-down' });
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};
  const lang = LANG_NAMES[String(ctx.lang || 'en').toLowerCase()] || 'the same language as the input';
  const where = [ctx.site && `Website: ${String(ctx.site).slice(0, 120)}`, ctx.desc && `About: ${String(ctx.desc).slice(0, 300)}`, ctx.block && `Block: ${String(ctx.block).slice(0, 30)}`, ctx.field && `Field: ${String(ctx.field).slice(0, 30)}`].filter(Boolean).join('\n');

  const system = `You edit website copy for small businesses in the Philippines and abroad, inside a site builder.
Return ONLY the rewritten text: no quotes, no preamble, no options, no explanations, no markdown.
Never use em dashes. Keep any *asterisk* markup around a word (it colours that word). Keep line breaks if the input has them.
${ctx.multiline ? 'The field allows a few sentences.' : 'The field is a single line: no line breaks, keep it short.'}
Write in ${task === 'translate' ? lang : 'the same language as the input'}. Do not invent prices, client names, awards or statistics.`;

  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-sonnet-5', max_tokens: 600, system, messages: [{ role: 'user', content: `${where ? where + '\n\n' : ''}Task: ${TASKS[task]}\n\nText:\n${text}` }] })
    });
    clearTimeout(t);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(200).json({ ok: false, reason: 'upstream', detail: String((j.error && j.error.message) || r.status).slice(0, 160) });
    const out = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim().replace(/—/g, ',');
    if (!out) return res.status(200).json({ ok: false, reason: 'upstream', detail: 'empty' });
    return res.status(200).json({ ok: true, text: out, task });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: /abort/i.test(String(e && e.message)) ? 'timeout' : 'upstream', detail: String(e && e.message || '').slice(0, 160) });
  }
};
