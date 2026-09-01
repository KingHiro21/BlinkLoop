// POST /api/login { code } -> verifies a staff code and sets the session
// cookies: bl_session (HttpOnly, the credential middleware checks) and
// bl_staff=1 (readable UI hint so the site can show the Builder link).

const crypto = require('crypto');
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(buf, len){ let bits=0,v=0,out=''; for(const x of buf){ v=(v<<8)|x; bits+=8; while(bits>=5){ out+=B32[(v>>>(bits-5))&31]; bits-=5; } } return out.slice(0,len); }
function manilaToday(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()).replace(/-/g,''); }
function checkCode(raw, secret){
  const m = String(raw||'').trim().toUpperCase().match(/^LOOP-([A-Z0-9]{2,12})-(\d{8})-([0-9A-Z]{8})$/);
  if (!m) return null;
  const [, client, ymd, sig] = m;
  const mac = crypto.createHmac('sha256', secret).update(`${client}|${ymd}`).digest();
  const a = Buffer.from(sig), b = Buffer.from(b32(mac,8));
  if (a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
  if (ymd < manilaToday()) return { expired:true, client };
  return { client, ymd };
}
function secondsUntilEnd(ymd){
  // end of the expiry day, Asia/Manila (UTC+8, no DST)
  const end = Date.UTC(+ymd.slice(0,4), +ymd.slice(4,6)-1, +ymd.slice(6,8), 15, 59, 59); // 23:59:59 PH = 15:59:59 UTC
  return Math.max(60, Math.min(31536000, Math.floor((end - Date.now())/1000)));
}

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method' });
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok:false, reason:'server-config' });

  let body = req.body;
  if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch{ body = {}; } }
  const code = String((body && body.code) || '').trim().toUpperCase();

  const r = checkCode(code, secret);
  if (!r) return res.status(200).json({ ok:false, reason:'invalid' });
  if (r.expired) return res.status(200).json({ ok:false, reason:'expired', client:r.client });

  const maxAge = secondsUntilEnd(r.ymd);
  res.setHeader('Set-Cookie', [
    `bl_session=${encodeURIComponent(code)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
    `bl_staff=1; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax`
  ]);
  return res.status(200).json({ ok:true, client:r.client, expires:`${r.ymd.slice(0,4)}-${r.ymd.slice(4,6)}-${r.ymd.slice(6,8)}` });
};
