// POST /api/upload  { code, name, type, data }   (data = base64, no data: prefix)
// Only valid, unexpired client codes may upload. Images land in Vercel Blob
// under sites/<CLIENT>/ and the public URL is returned.
//
// Setup (one time): Vercel dashboard -> Storage -> Create -> Blob -> connect
// to this project. That auto-adds BLOB_READ_WRITE_TOKEN. Redeploy after.
// Also requires LOOP_SECRET (same one /api/verify uses).

const crypto = require('crypto');
const { put } = require('@vercel/blob');

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(buf, len) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.slice(0, len);
}
function manilaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' })
    .format(new Date()).replace(/-/g, '');
}
function checkCode(raw, secret) {
  const m = String(raw || '').trim().toUpperCase()
    .match(/^LOOP-([A-Z0-9]{2,12})-(\d{8})-([0-9A-Z]{8})$/);
  if (!m) return null;
  const [, client, ymd, sig] = m;
  const mac = crypto.createHmac('sha256', secret).update(`${client}|${ymd}`).digest();
  const expected = b32(mac, 8);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (ymd < manilaToday()) return null;
  return client;
}

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 3.5 * 1024 * 1024; // decoded; well under Vercel's body limit

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });

  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok: false, reason: 'server-config' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ ok: false, reason: 'no-blob-store' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  let raw = body.code;
  if (!raw){
    const m = String(req.headers.cookie || '').match(/(?:^|;\s*)bl_session=([^;]+)/);
    if (m) raw = decodeURIComponent(m[1]);
  }
  const client = checkCode(raw, secret);
  if (!client) return res.status(401).json({ ok: false, reason: 'unauthorized' });

  const ext = TYPES[body.type];
  if (!ext) return res.status(200).json({ ok: false, reason: 'bad-type' });

  let buf;
  try { buf = Buffer.from(String(body.data || ''), 'base64'); } catch { buf = null; }
  if (!buf || buf.length < 100) return res.status(200).json({ ok: false, reason: 'bad-data' });
  if (buf.length > MAX_BYTES) return res.status(200).json({ ok: false, reason: 'too-large' });

  const safe = String(body.name || 'image').toLowerCase()
    .replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image';

  try {
    const blob = await put(`sites/${client}/${Date.now()}-${safe}.${ext}`, buf, {
      access: 'public',
      contentType: body.type,
      addRandomSuffix: false
    });
    return res.status(200).json({ ok: true, url: blob.url, client });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'store-failed' });
  }
};
