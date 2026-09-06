// /api/push — Web Push subscriptions for the team chat. Session cookie required.
// GET  -> { ok, configured, publicKey }        (VAPID public key for PushManager.subscribe)
// POST { action:'subscribe', sub }            (store this browser's subscription under my client name)
// POST { action:'unsubscribe', endpoint }     (forget it)
// POST { action:'test' }                       (send a test notification to my own devices)
const crypto = require('crypto');
const { vapid, subId, validSub, sendAll } = require('../lib/push.js');

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
  const me = sessionClient(req, secret);
  if (!me) return res.status(401).json({ ok:false, reason:'unauthorized' });
  const v = vapid();

  if (req.method === 'GET') return res.status(200).json({ ok:true, configured: !!v, publicKey: v ? v.pub : null });
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method' });
  if (!v) return res.status(200).json({ ok:false, reason:'not-configured' });
  if (!sbConf()) return res.status(500).json({ ok:false, reason:'no-database' });

  let body = req.body;
  if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch{ body = {}; } }
  body = body || {};
  const action = String(body.action||'');

  try {
    if (action === 'subscribe'){
      const sub = body.sub;
      if (!validSub(sub)) return res.status(200).json({ ok:false, reason:'bad-subscription' });
      const clean = { endpoint: sub.endpoint, expirationTime: sub.expirationTime || null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
      await sb(`push_subs?on_conflict=id`, { method:'POST', body:{ id: subId(sub.endpoint), client: me, endpoint: sub.endpoint, sub: clean, ts: Date.now() }, prefer:'resolution=merge-duplicates,return=minimal' });
      return res.status(200).json({ ok:true });
    }
    if (action === 'unsubscribe'){
      const endpoint = String(body.endpoint||'');
      if (!endpoint) return res.status(200).json({ ok:false, reason:'bad-endpoint' });
      await sb(`push_subs?id=eq.${subId(endpoint)}`, { method:'DELETE' });
      return res.status(200).json({ ok:true });
    }
    if (action === 'test'){
      const subs = await sb(`push_subs?client=eq.${me}&select=endpoint,sub`);
      const r = await sendAll(sb, subs, { title: 'BlinkLoop Team', body: 'Notifications are on for ' + me + '.', url: '/team', tag: 'bl-test' });
      return res.status(200).json({ ok:true, devices: subs.length, ...r });
    }
    return res.status(200).json({ ok:false, reason:'bad-action' });
  } catch(e){
    return res.status(200).json({ ok:false, reason:'store-failed' });
  }
};
