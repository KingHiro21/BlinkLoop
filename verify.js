// POST /api/verify  { code: "LOOP-CLIENT-YYYYMMDD-SIGNATURE" }
// Validates the signature against LOOP_SECRET and checks the expiry date
// (end of the stated day, Asia/Manila time). Stateless: no database needed.
//
// Required Vercel environment variable:
//   LOOP_SECRET  - a long random string. Rotating it invalidates ALL codes.

const crypto = require('crypto');

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, no I L O U
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

function manilaToday() {
  // YYYYMMDD in Asia/Manila
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' })
    .format(new Date()).replace(/-/g, '');
}

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });

  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok: false, reason: 'server-config' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const raw = String((body && body.code) || '').trim().toUpperCase();

  const m = raw.match(/^LOOP-([A-Z0-9]{2,12})-(\d{8})-([0-9A-Z]{8})$/);
  if (!m) return res.status(200).json({ ok: false, reason: 'invalid' });

  const [, client, ymd, sig] = m;
  const expected = sign(client, ymd, secret);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) return res.status(200).json({ ok: false, reason: 'invalid' });

  if (ymd < manilaToday()) return res.status(200).json({ ok: false, reason: 'expired', client });

  return res.status(200).json({
    ok: true,
    client,
    expires: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  });
};
