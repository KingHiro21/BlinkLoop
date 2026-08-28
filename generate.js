// POST /api/generate  { adminKey, client, expires: "YYYY-MM-DD" }
// Mints a signed access code for a client, valid through the given date
// (end of day, Asia/Manila time). Only callable with the admin key.
//
// Required Vercel environment variables:
//   LOOP_SECRET     - same secret used by /api/verify
//   LOOP_ADMIN_KEY  - the password you type into the admin page

const crypto = require('crypto');

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(buf, len) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.slice(0, len);
}
function sign(client, ymd, secret) {
  const mac = crypto.createHmac('sha256', secret).update(`${client}|${ymd}`).digest();
  return b32(mac, 8);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });

  const secret = process.env.LOOP_SECRET;
  const adminKey = process.env.LOOP_ADMIN_KEY;
  if (!secret || !adminKey) return res.status(500).json({ ok: false, reason: 'server-config' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (!safeEqual(body.adminKey || '', adminKey)) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }

  const client = String(body.client || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (client.length < 2) return res.status(200).json({ ok: false, reason: 'bad-client' });

  const em = String(body.expires || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!em) return res.status(200).json({ ok: false, reason: 'bad-date' });
  const ymd = em[1] + em[2] + em[3];

  const code = `LOOP-${client}-${ymd}-${sign(client, ymd, secret)}`;
  return res.status(200).json({ ok: true, code, client, expires: body.expires });
};
