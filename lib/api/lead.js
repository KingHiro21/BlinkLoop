// POST /api/lead[?site=slug]  { name, email, phone?, business?, service?, message, consent:'yes', consentAt?, page?, website?(honeypot) }
// One inbox for every contact form: the BlinkLoop site and each site published from the builder (those post from
// their own domain, so CORS is open for POST). The lead is stored in Supabase `leads` and forwarded to the Google Apps
// Script that emails info@, so nothing changes for the inbox. Either half may be missing without failing the visitor.
const crypto = require('crypto');
const { sb, configured } = require('../db.js');

const APPS_SCRIPT_DEFAULT = 'https://script.google.com/macros/s/AKfycbwx-J8d-zI2hFkrNYOrO0pjN9OlA0ZlY5uP-fo3LV-K9Ceb0seho_wxYuZFJrDsE65hXg/exec';
const hits = new Map(); // per-instance rate limit: 20 submissions per IP per 10 minutes
function limited(ip){
  const now = Date.now(); const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 600000){ rec.n = 0; rec.t = now; }
  rec.n++; hits.set(ip, rec);
  if (hits.size > 5000) hits.clear();
  return rec.n > 20;
}
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });

  let body = req.body;
  if (typeof body === 'string'){ try { body = JSON.parse(body); } catch { body = {}; } }
  if (Buffer.isBuffer(body)){ try { body = JSON.parse(body.toString('utf8')); } catch { body = {}; } }
  body = body || {};

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return res.status(429).json({ ok: false, reason: 'slow-down' });

  let qsite = req.query && req.query.site; if (!qsite){ try { qsite = new URL(req.url, 'http://x').searchParams.get('site'); } catch {} }
  const site = clean(qsite || body.site || 'blinkloop', 40).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'blinkloop';
  const lead = {
    site,
    name: clean(body.name, 120), email: clean(body.email, 160).toLowerCase(), phone: clean(body.phone, 40),
    business: clean(body.business, 160), service: clean(body.service, 80), message: clean(body.message, 4000),
    page: clean(body.page, 300), consent_at: body.consentAt && !isNaN(Date.parse(body.consentAt)) ? new Date(body.consentAt).toISOString() : (body.consent ? new Date().toISOString() : null),
    ip_hash: ip ? crypto.createHash('sha256').update(ip + (process.env.LOOP_SECRET || '')).digest('hex').slice(0, 16) : null,
    ua: clean(req.headers['user-agent'], 200)
  };
  if (body.website) return res.status(200).json({ ok: true }); // honeypot filled: a bot, say yes and drop it
  if (lead.name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || lead.message.length < 5) return res.status(200).json({ ok: false, reason: 'invalid' });
  if (!body.consent) return res.status(200).json({ ok: false, reason: 'consent' });

  let stored = false, forwarded = false;
  if (configured()){
    try { await sb('leads', { method: 'POST', body: lead, prefer: 'return=minimal' }); stored = true; }
    catch (e) { console.error('lead store failed:', e && e.message); }
  }
  const forward = process.env.APPS_SCRIPT_URL || APPS_SCRIPT_DEFAULT;
  if (forward && /^https:\/\/script\.google\.com\//.test(forward)){
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(forward, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, site, name: lead.name, email: lead.email, message: lead.message, consent: 'yes', consentAt: lead.consent_at, page: lead.page || body.page }), redirect: 'follow', signal: ctl.signal });
      clearTimeout(t);
      const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
      forwarded = r.ok && (j.ok === true || !/<html/i.test(txt));
    } catch (e) { console.error('lead forward failed:', e && e.message); }
  }
  if (!stored && !forwarded) return res.status(200).json({ ok: false, reason: 'unavailable' });
  return res.status(200).json({ ok: true, stored, forwarded });
};
