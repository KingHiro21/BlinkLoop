// Staff session = the signed access code in the bl_session cookie. Stateless: HMAC over NAME|YYYYMMDD with LOOP_SECRET.
const crypto = require('crypto');
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(buf, len){ let bits = 0, v = 0, out = ''; for (const x of buf){ v = (v << 8) | x; bits += 8; while (bits >= 5){ out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } return out.slice(0, len); }
function manilaToday(){ return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).replace(/-/g, ''); }
function checkCode(raw, secret){
  const m = String(raw || '').trim().toUpperCase().match(/^LOOP-([A-Z0-9]{2,12})-(\d{8})-([0-9A-Z]{8})$/);
  if (!m) return null;
  const [, client, ymd, sig] = m;
  const mac = crypto.createHmac('sha256', secret).update(`${client}|${ymd}`).digest();
  const a = Buffer.from(sig), b = Buffer.from(b32(mac, 8));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || ymd < manilaToday()) return null;
  return client;
}
function sessionClient(req, secret){
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)bl_session=([^;]+)/);
  if (!m) return null;
  return checkCode(decodeURIComponent(m[1]), secret);
}
function readBody(req){
  let body = req.body;
  if (typeof body === 'string'){ try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}
module.exports = { sessionClient, checkCode, readBody, manilaToday };
