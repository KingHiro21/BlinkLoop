// GET /api/me -> who is signed in on this browser, from the session cookie.
const crypto = require('crypto');
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(buf, len){ let bits=0,v=0,out=''; for(const x of buf){ v=(v<<8)|x; bits+=8; while(bits>=5){ out+=B32[(v>>>(bits-5))&31]; bits-=5; } } return out.slice(0,len); }
function manilaToday(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()).replace(/-/g,''); }

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok:false, reason:'server-config' });
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(/(?:^|;\s*)bl_session=([^;]+)/);
  const raw = m ? decodeURIComponent(m[1]) : '';
  const cm = raw.match(/^LOOP-([A-Z0-9]{2,12})-(\d{8})-([0-9A-Z]{8})$/);
  if (!cm) return res.status(200).json({ ok:false });
  const [, client, ymd, sig] = cm;
  const mac = crypto.createHmac('sha256', secret).update(`${client}|${ymd}`).digest();
  const a = Buffer.from(sig), b = Buffer.from(b32(mac,8));
  const valid = a.length===b.length && crypto.timingSafeEqual(a,b) && ymd >= manilaToday();
  if (!valid) return res.status(200).json({ ok:false });
  return res.status(200).json({ ok:true, client, expires:`${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}` });
};
