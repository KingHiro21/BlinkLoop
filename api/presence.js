// /api/presence — who is online. Session cookie required.
// POST = heartbeat (marks you online). GET = list of team members seen in
// the last 2 minutes. Storage: presence/<CLIENT>-<ts> marker blobs (unique
// names, no overwrites); old markers for the caller are cleaned on each beat.

const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');

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

async function onlineList(){
  const { blobs } = await list({ prefix: 'presence/', limit: 1000 });
  const latest = {};
  for (const b of blobs){
    const m = b.pathname.match(/^presence\/([A-Z0-9]{2,12})-(\d{10,16})$/);
    if (!m) continue;
    const [, client, ts] = m;
    if (!latest[client] || Number(ts) > latest[client]) latest[client] = Number(ts);
  }
  const now = Date.now();
  return Object.entries(latest)
    .filter(([, ts]) => now - ts < WINDOW)
    .map(([client, ts]) => ({ client, ts }))
    .sort((a,b) => a.client.localeCompare(b.client));
}

async function beat(me){
  const now = Date.now();
  await put(`presence/${me}-${now}`, '1', { access:'public', contentType:'text/plain', addRandomSuffix:false });
  // clean this user's older markers (best effort)
  try {
    const { blobs } = await list({ prefix: `presence/${me}-`, limit: 100 });
    const old = blobs.filter(b => !b.pathname.endsWith(`-${now}`));
    await Promise.all(old.map(b => del(b.url).catch(()=>{})));
  } catch(e){}
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok:false, reason:'server-config' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ ok:false, reason:'no-blob-store' });
  const me = sessionClient(req, secret);
  if (!me) return res.status(401).json({ ok:false, reason:'unauthorized' });
  try {
    if (req.method === 'POST'){
      await beat(me);
      return res.status(200).json({ ok:true, me });
    }
    const online = await onlineList();
    if (!online.some(o => o.client === me)) online.push({ client: me, ts: Date.now() });
    online.sort((a,b)=>a.client.localeCompare(b.client));
    return res.status(200).json({ ok:true, me, online });
  } catch(e){
    return res.status(200).json({ ok:false, reason:'store-failed' });
  }
};
