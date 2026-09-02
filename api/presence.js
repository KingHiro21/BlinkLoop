// /api/presence — who is online, on Supabase. Session cookie required.
// POST = heartbeat (upsert presence row). GET = clients seen in last 2 min.
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
const WINDOW = 120000;
function sbConf(){
  const url = (process.env.SUPABASE_URL||'').replace(/\/+$/,'');
  const key = process.env.SUPABASE_SERVICE_KEY||'';
  return url && key ? { url, key } : null;
}
async function sb(pathAndQuery, { method='GET', body, prefer } = {}){
  const c = sbConf();
  const headers = { 'apikey': c.key, 'Authorization': `Bearer ${c.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers['Prefer'] = prefer;
  const r = await fetch(`${c.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body!==undefined ? JSON.stringify(body) : undefined });
  if (r.status === 204) return [];
  const text = await r.text();
  if (!r.ok) throw new Error(`sb ${r.status}`);
  try { return JSON.parse(text); } catch { return []; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok:false, reason:'server-config' });
  if (!sbConf()) return res.status(500).json({ ok:false, reason:'no-database' });
  const me = sessionClient(req, secret);
  if (!me) return res.status(401).json({ ok:false, reason:'unauthorized' });
  try {
    if (req.method === 'POST'){
      await sb(`presence?on_conflict=client`, { method:'POST', body:{ client: me, ts: Date.now() }, prefer:'resolution=merge-duplicates,return=minimal' });
      return res.status(200).json({ ok:true, me });
    }
    const rows = await sb(`presence?ts=gt.${Date.now()-WINDOW}&select=client,ts&order=client.asc`);
    const online = rows.map(r=>({ client:r.client, ts:Number(r.ts) }));
    if (!online.some(o=>o.client===me)) online.push({ client: me, ts: Date.now() });
    online.sort((a,b)=>a.client.localeCompare(b.client));
    return res.status(200).json({ ok:true, me, online });
  } catch(e){
    return res.status(200).json({ ok:false, reason:'store-failed' });
  }
};
