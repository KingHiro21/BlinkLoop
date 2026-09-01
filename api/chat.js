// /api/chat — internal team chat for BlinkLoop staff. Session cookie required.
// Storage model (Vercel Blob, no database):
//   chat/m/<ts>-<rand>.json   one immutable blob per message (collision-proof)
//   chat/p/<messageId>.json   marker blob = message is pinned
//   chat-files/<ts>-<name>    attachments
// GET  ?since=<ts>  -> { ok, me, now, pinnedIds, messages:[...] } (new messages only; first load returns latest 80)
// POST {action:'post', text, att?} | {action:'pin'|'unpin', id} | {action:'del', id}
//      {action:'file', name, type, data(base64)} -> { ok, att:{name,url,size,type} }

const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');

const PRESENCE_WINDOW = 120000;
async function presenceBeat(me){
  const now = Date.now();
  await put(`presence/${me}-${now}`, '1', { access:'public', contentType:'text/plain', addRandomSuffix:false });
  try {
    const { blobs } = await list({ prefix:`presence/${me}-`, limit:100 });
    await Promise.all(blobs.filter(b=>!b.pathname.endsWith(`-${now}`)).map(b=>del(b.url).catch(()=>{})));
  } catch(e){}
}
function onlineFrom(blobs){
  const latest = {};
  for (const b of blobs){
    const m = b.pathname.match(/^presence\/([A-Z0-9]{2,12})-(\d{10,16})$/);
    if (!m) continue;
    if (!latest[m[1]] || Number(m[2]) > latest[m[1]]) latest[m[1]] = Number(m[2]);
  }
  const now = Date.now();
  return Object.entries(latest).filter(([,ts])=>now-ts<PRESENCE_WINDOW).map(([client])=>client);
}

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

const MAX_TEXT = 2000;
const MAX_FILE = 3.5 * 1024 * 1024;

async function listAll(prefix){
  let out = [], cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out = out.concat(r.blobs); cursor = r.hasMore ? r.cursor : null;
  } while (cursor);
  return out;
}
const idFromPath = p => p.replace(/^chat\/m\//,'').replace(/\.json$/,'');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok:false, reason:'server-config' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ ok:false, reason:'no-blob-store' });
  const me = sessionClient(req, secret);
  if (!me) return res.status(401).json({ ok:false, reason:'unauthorized' });

  try {
    if (req.method === 'GET'){
      const url = new URL(req.url, 'http://x');
      const since = Number(url.searchParams.get('since') || 0);
      const [msgBlobs, pinBlobs, presBlobs] = await Promise.all([ listAll('chat/m/'), listAll('chat/p/'), listAll('presence/'), presenceBeat(me).catch(()=>{}) ]);
      let candidates = msgBlobs
        .map(b => ({ ...b, ts: Number(idFromPath(b.pathname).split('-')[0] || 0) }))
        .filter(b => b.ts > since)
        .sort((a,b) => a.ts - b.ts);
      if (!since) candidates = candidates.slice(-80);
      else candidates = candidates.slice(-200);
      const messages = (await Promise.all(candidates.map(async b => {
        try {
          const r = await fetch(b.url);
          const d = await r.json();
          return { id: idFromPath(b.pathname), ...d };
        } catch(e){ return null; }
      }))).filter(Boolean);
      const pinnedIds = pinBlobs.map(b => b.pathname.replace(/^chat\/p\//,'').replace(/\.json$/,''));
      return res.status(200).json({ ok:true, me, now: Date.now(), pinnedIds, messages, online: [...new Set([me, ...onlineFrom(presBlobs)])].sort() });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method' });
    let body = req.body;
    if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch{ body = {}; } }
    body = body || {};
    const action = String(body.action || '');

    if (action === 'post'){
      const text = String(body.text || '').slice(0, MAX_TEXT).trim();
      const att = body.att && body.att.url ? {
        name: String(body.att.name||'file').slice(0,80),
        url: String(body.att.url),
        size: Number(body.att.size)||0,
        type: String(body.att.type||'').slice(0,60)
      } : null;
      if (!text && !att) return res.status(200).json({ ok:false, reason:'empty' });
      const ts = Date.now();
      const id = `${ts}-${crypto.randomBytes(3).toString('hex')}`;
      const msg = { ts, author: me, text, att };
      await put(`chat/m/${id}.json`, JSON.stringify(msg), { access:'public', contentType:'application/json', addRandomSuffix:false });
      return res.status(200).json({ ok:true, message: { id, ...msg } });
    }

    if (action === 'pin' || action === 'unpin'){
      const id = String(body.id||'').replace(/[^0-9a-f-]/g,'');
      if (!id) return res.status(200).json({ ok:false, reason:'bad-id' });
      if (action === 'pin'){
        await put(`chat/p/${id}.json`, '1', { access:'public', contentType:'text/plain', addRandomSuffix:false });
      } else {
        const pins = await listAll('chat/p/');
        const hit = pins.find(b => b.pathname === `chat/p/${id}.json`);
        if (hit) await del(hit.url);
      }
      return res.status(200).json({ ok:true, id, pinned: action==='pin' });
    }

    if (action === 'del'){
      const id = String(body.id||'').replace(/[^0-9a-f-]/g,'');
      const msgs = await listAll('chat/m/');
      const hit = msgs.find(b => b.pathname === `chat/m/${id}.json`);
      if (!hit) return res.status(200).json({ ok:false, reason:'not-found' });
      const d = await (await fetch(hit.url)).json();
      if (d.author !== me) return res.status(403).json({ ok:false, reason:'not-yours' });
      await del(hit.url);
      const pins = await listAll('chat/p/');
      const pinHit = pins.find(b => b.pathname === `chat/p/${id}.json`);
      if (pinHit) await del(pinHit.url);
      return res.status(200).json({ ok:true, id });
    }

    if (action === 'file'){
      let buf;
      try { buf = Buffer.from(String(body.data||''), 'base64'); } catch { buf = null; }
      if (!buf || buf.length < 10) return res.status(200).json({ ok:false, reason:'bad-data' });
      if (buf.length > MAX_FILE) return res.status(200).json({ ok:false, reason:'too-large' });
      const rawName = String(body.name || 'file');
      const ext = (rawName.match(/\.([a-zA-Z0-9]{1,8})$/) || [,''])[1].toLowerCase();
      const base = rawName.replace(/\.[^.]*$/,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50) || 'file';
      const safe = ext ? `${base}.${ext}` : base;
      const type = String(body.type || 'application/octet-stream').slice(0,80);
      const blob = await put(`chat-files/${Date.now()}-${safe}`, buf, { access:'public', contentType:type, addRandomSuffix:false });
      return res.status(200).json({ ok:true, att: { name: rawName.slice(0,80), url: blob.url, size: buf.length, type } });
    }

    return res.status(200).json({ ok:false, reason:'bad-action' });
  } catch(e) {
    return res.status(200).json({ ok:false, reason:'store-failed' });
  }
};
