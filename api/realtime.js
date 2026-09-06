// GET /api/realtime -> where the browser should open its Supabase Realtime socket.
// Session cookie required. Returns the project URL and the public anon key (SUPABASE_ANON_KEY),
// which can only subscribe to the "team" broadcast channel; chat content still comes from /api/chat.
// Without SUPABASE_ANON_KEY the page keeps polling and nothing breaks.
const crypto = require('crypto');

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(buf, len){ let bits=0,v=0,out=''; for(const x of buf){ v=(v<<8)|x; bits+=8; while(bits>=5){ out+=B32[(v>>>(bits-5))&31]; bits-=5; } } return out.slice(0,len); }
function manilaToday(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()).replace(/-/g,''); }
function sessionClient(req, secret){
  const m = String(req.headers.cookie||'').match(/(?:^|;\s*)bl_session=([^;]+)/);
  if (!m) return null;
  const cm = decodeURIComponent(m[1]).match(/^LOOP-([A-Z0-9]{2,12})-(\d{8})-([0-9A-Z]{8})$/);
  if (!cm) return null;
  const [, client, ymd, sig] = cm;
  const mac = crypto.createHmac('sha256', secret).update(`${client}|${ymd}`).digest();
  const a = Buffer.from(sig), b = Buffer.from(b32(mac,8));
  if (a.length!==b.length || !crypto.timingSafeEqual(a,b) || ymd < manilaToday()) return null;
  return client;
}

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok:false, reason:'server-config' });
  if (!sessionClient(req, secret)) return res.status(401).json({ ok:false, reason:'unauthorized' });
  const url = (process.env.SUPABASE_URL||'').replace(/\/+$/,''), key = process.env.SUPABASE_ANON_KEY||'';
  if (!url || !key) return res.status(200).json({ ok:false, reason:'not-configured' });
  return res.status(200).json({ ok:true, url, key, topic:'team' });
};
