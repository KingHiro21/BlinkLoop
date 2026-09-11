// Private preview links for sites built in Loop Builder.
//   POST /api/preview { slug, html }        staff session required. Stores the exported page in Vercel Blob under
//                                           previews/<slug>/<key>.html and answers { ok, url:'/p/<slug>/<key>', full }.
//   GET  /api/preview?s=<slug>&k=<key>      public but unguessable (12 hex chars), served with X-Robots-Tag: noindex.
//                                           vercel.json rewrites /p/:slug/:key here, so clients get a short link.
// Needs BLOB_READ_WRITE_TOKEN (the Blob store already used for uploads). Previews stay until deleted in the Blob
// dashboard; they are small HTML files. Nothing here can reach the builder or any other client's drafts.
const crypto = require('crypto');
const { put, list } = require('@vercel/blob');
const { sessionClient, readBody } = require('../session.js');

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/, KEY = /^[a-f0-9]{12}$/;
const page = (title, text) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#FFFCF7;color:#2B140E;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}p{color:#7E5D4C}</style></head><body><div><h1>${title}</h1><p>${text}</p></div></body></html>`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET'){
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    let q = req.query || {}; if (!q.s){ try { q = Object.fromEntries(new URL(req.url, 'http://x').searchParams.entries()); } catch {} }
    const s = String(q.s || '').toLowerCase(), k = String(q.k || '').toLowerCase();
    if (!SLUG.test(s) || !KEY.test(k) || !process.env.BLOB_READ_WRITE_TOKEN){ res.statusCode = 404; return res.end(page('Preview not found', 'This preview link is not valid.')); }
    try {
      const { blobs } = await list({ prefix: `previews/${s}/${k}.html`, limit: 1 });
      const hit = (blobs || []).find(b => b.pathname === `previews/${s}/${k}.html`);
      if (!hit){ res.statusCode = 404; return res.end(page('Preview not found', 'This preview link has expired or was never created.')); }
      const r = await fetch(hit.url); const html = await r.text();
      res.statusCode = 200; return res.end(html);
    } catch (e) { res.statusCode = 500; return res.end(page('Preview unavailable', 'Please try again in a minute.')); }
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok: false, reason: 'server-config' });
  const client = sessionClient(req, secret);
  if (!client) return res.status(401).json({ ok: false, reason: 'unauthorized' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(200).json({ ok: false, reason: 'no-blob-store' });
  const body = readBody(req);
  const slug = String(body.slug || '').trim().toLowerCase();
  const html = typeof body.html === 'string' ? body.html : '';
  if (!SLUG.test(slug)) return res.status(200).json({ ok: false, reason: 'bad-slug' });
  if (html.length < 40 || !/<html/i.test(html)) return res.status(200).json({ ok: false, reason: 'no-html' });
  if (html.length > 3 * 1024 * 1024) return res.status(200).json({ ok: false, reason: 'too-large' });
  const key = crypto.randomBytes(6).toString('hex');
  try {
    await put(`previews/${slug}/${key}.html`, html, { access: 'public', contentType: 'text/html; charset=utf-8', addRandomSuffix: false });
  } catch (e) { return res.status(200).json({ ok: false, reason: 'store-failed', detail: String(e && e.message || '').slice(0, 160) }); }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'www.blinkloop-ph.com');
  const proto = /localhost|127\.0\.0\.1/.test(host) ? 'http' : 'https';
  const url = `/p/${slug}/${key}`;
  return res.status(200).json({ ok: true, url, full: `${proto}://${host}${url}`, key, slug, client });
};
