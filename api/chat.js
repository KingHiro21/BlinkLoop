// /api/chat — BlinkLoop team chat on Supabase (Postgres via PostgREST).
// Tables: messages(id, parent, ts, author, text, att jsonb), pins(id, ts).
// Attachments still upload to Vercel Blob (rare, cheap ops).
// GET  ?day=YYYYMMDD&since=ts | ?thread=<rootId> | ?q=<query>
// POST post{text,att,parent?} | pin/unpin{id} | del{id,parent?} | file{...}

const crypto = require('crypto');

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(buf, len){ let bits=0,v=0,out=''; for(const x of buf){ v=(v<<8)|x; bits+=8; while(bits>=5){ out+=B32[(v>>>(bits-5))&31]; bits-=5; } } return out.slice(0,len); }
function manilaToday(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()).replace(/-/g,''); }
function dayOf(ts){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date(Number(ts))).replace(/-/g,''); }
function dayRangeUTC(ymd){ // PH is fixed UTC+8
  const y=+ymd.slice(0,4), m=+ymd.slice(4,6)-1, d=+ymd.slice(6,8);
  const start = Date.UTC(y,m,d) - 8*3600*1000;
  return { start, end: start + 24*3600*1000 };
}
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

const MAX_TEXT = 2000, MAX_FILE = 3.5*1024*1024, PRESENCE_WINDOW = 120000, SEARCH_HITS = 50;

/* ---------- Supabase REST helpers ---------- */
function sbConf(){
  const url = (process.env.SUPABASE_URL||'').replace(/\/+$/,'');
  const key = process.env.SUPABASE_SERVICE_KEY||'';
  return url && key ? { url, key } : null;
}
async function sb(pathAndQuery, { method='GET', body, prefer } = {}){
  const c = sbConf();
  const headers = {
    'apikey': c.key,
    'Authorization': `Bearer ${c.key}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers['Prefer'] = prefer;
  const r = await fetch(`${c.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body!==undefined ? JSON.stringify(body) : undefined });
  if (r.status === 204) return [];
  const text = await r.text();
  if (!r.ok) throw new Error(`sb ${r.status}: ${text.slice(0,200)}`);
  try { return JSON.parse(text); } catch { return []; }
}
const qsafe = s => String(s||'').toLowerCase().replace(/[^a-z0-9 @._\-\u00c0-\u024f\u4e00-\u9fff\u3040-\u30ff\u0600-\u06ff]/g,'').trim().slice(0,60);
const idsafe = s => String(s||'').replace(/[^0-9a-f-]/g,'');

async function presenceBeat(me){
  await sb(`presence?on_conflict=client`, { method:'POST', body:{ client: me, ts: Date.now() }, prefer:'resolution=merge-duplicates,return=minimal' });
}
async function onlineList(me){
  const rows = await sb(`presence?ts=gt.${Date.now()-PRESENCE_WINDOW}&select=client,ts`);
  const names = rows.map(r=>r.client);
  if (!names.includes(me)) names.push(me);
  return names.sort();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok:false, reason:'server-config' });
  if (!sbConf()) return res.status(500).json({ ok:false, reason:'no-database' });
  const me = sessionClient(req, secret);
  if (!me) return res.status(401).json({ ok:false, reason:'unauthorized' });

  try {
    if (req.method === 'GET'){
      const url = new URL(req.url, 'http://x');
      const q = qsafe(url.searchParams.get('q'));
      const thread = idsafe(url.searchParams.get('thread'));

      /* ---- thread view ---- */
      if (thread){
        const roots = await sb(`messages?id=eq.${thread}&limit=1`);
        if (!roots.length) return res.status(200).json({ ok:false, reason:'not-found' });
        const replies = await sb(`messages?parent=eq.${thread}&order=ts.asc&limit=500`);
        return res.status(200).json({ ok:true, me, root: roots[0], replies });
      }

      /* ---- search (text, author, attachment name; roots + replies) ---- */
      if (q){
        const pat = `*${q}*`;
        const hits = await sb(`messages?or=(text.ilike.${encodeURIComponent(pat)},author.ilike.${encodeURIComponent(pat)},att->>name.ilike.${encodeURIComponent(pat)})&order=ts.desc&limit=${SEARCH_HITS}`);
        hits.forEach(h => h.day = dayOf(h.ts));
        return res.status(200).json({ ok:true, me, q, hits });
      }

      /* ---- day feed ---- */
      const today = manilaToday();
      const day = (url.searchParams.get('day')||today).replace(/[^0-9]/g,'').slice(0,8) || today;
      const since = Number(url.searchParams.get('since')||0);
      const { start, end } = dayRangeUTC(day);
      const lo = Math.max(start, since+1);

      const [messages, tsRows, pinRows] = await Promise.all([
        sb(`messages?parent=is.null&ts=gte.${lo}&ts=lt.${end}&order=ts.asc&limit=300`),
        sb(`messages?select=ts&parent=is.null&order=ts.asc&limit=20000`),
        sb(`pins?select=id&order=ts.desc&limit=100`),
        presenceBeat(me).catch(()=>{})
      ]);
      const days = [...new Set([today, ...tsRows.map(r=>dayOf(r.ts))])].sort().reverse();
      const pinnedIds = pinRows.map(r=>r.id);

      /* reply counts for this page's roots */
      let counts = {};
      if (messages.length){
        const idList = messages.map(m=>m.id).join(',');
        const reps = await sb(`messages?select=parent&parent=in.(${idList})&limit=5000`);
        for (const r of reps) counts[r.parent] = (counts[r.parent]||0)+1;
      }
      /* pinned message bodies (any day) */
      let pinned = [];
      if (pinnedIds.length){
        pinned = await sb(`messages?id=in.(${pinnedIds.join(',')})&order=ts.desc&limit=100`);
        pinned.forEach(p => p.day = dayOf(p.ts));
      }
      const online = await onlineList(me);
      return res.status(200).json({ ok:true, me, now:Date.now(), today, day, days, counts, pinnedIds, pinned, messages, online });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method' });
    let body = req.body;
    if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch{ body = {}; } }
    body = body || {};
    const action = String(body.action||'');

    if (action === 'post'){
      const text = String(body.text||'').slice(0,MAX_TEXT).trim();
      const att = body.att && body.att.url ? { name:String(body.att.name||'file').slice(0,80), url:String(body.att.url), size:Number(body.att.size)||0, type:String(body.att.type||'').slice(0,60) } : null;
      if (!text && !att) return res.status(200).json({ ok:false, reason:'empty' });
      const parent = idsafe(body.parent) || null;
      if (parent){
        const p = await sb(`messages?id=eq.${parent}&select=id,parent&limit=1`);
        if (!p.length || p[0].parent) return res.status(200).json({ ok:false, reason:'bad-parent' });
      }
      const ts = Date.now();
      const id = `${ts}-${crypto.randomBytes(3).toString('hex')}`;
      const msg = { id, parent, ts, author: me, text, att };
      await sb('messages', { method:'POST', body: msg, prefer:'return=minimal' });
      return res.status(200).json({ ok:true, message: msg });
    }

    if (action === 'pin' || action === 'unpin'){
      const id = idsafe(body.id);
      if (!id) return res.status(200).json({ ok:false, reason:'bad-id' });
      if (action === 'pin') await sb(`pins?on_conflict=id`, { method:'POST', body:{ id, ts: Date.now() }, prefer:'resolution=merge-duplicates,return=minimal' });
      else await sb(`pins?id=eq.${id}`, { method:'DELETE' });
      return res.status(200).json({ ok:true, id, pinned: action==='pin' });
    }

    if (action === 'del'){
      const id = idsafe(body.id);
      if (!id) return res.status(200).json({ ok:false, reason:'bad-id' });
      const rows = await sb(`messages?id=eq.${id}&select=id,author,parent&limit=1`);
      if (!rows.length) return res.status(200).json({ ok:false, reason:'not-found' });
      if (rows[0].author !== me) return res.status(403).json({ ok:false, reason:'not-yours' });
      await sb(`messages?id=eq.${id}`, { method:'DELETE' });
      if (!rows[0].parent){
        await Promise.all([
          sb(`messages?parent=eq.${id}`, { method:'DELETE' }).catch(()=>{}),
          sb(`pins?id=eq.${id}`, { method:'DELETE' }).catch(()=>{})
        ]);
      }
      return res.status(200).json({ ok:true, id });
    }

    if (action === 'file'){
      if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(200).json({ ok:false, reason:'no-blob-store' });
      const { put } = require('@vercel/blob');
      let buf; try{ buf = Buffer.from(String(body.data||''),'base64'); }catch{ buf = null; }
      if (!buf || buf.length < 10) return res.status(200).json({ ok:false, reason:'bad-data' });
      if (buf.length > MAX_FILE) return res.status(200).json({ ok:false, reason:'too-large' });
      const rawName = String(body.name||'file');
      const ext = (rawName.match(/\.([a-zA-Z0-9]{1,8})$/)||[,''])[1].toLowerCase();
      const base = rawName.replace(/\.[^.]*$/,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'file';
      const type = String(body.type||'application/octet-stream').slice(0,80);
      const blob = await put(`chat-files/${Date.now()}-${ext?base+'.'+ext:base}`, buf, { access:'public', contentType:type, addRandomSuffix:false });
      return res.status(200).json({ ok:true, att:{ name:rawName.slice(0,80), url:blob.url, size:buf.length, type } });
    }

    return res.status(200).json({ ok:false, reason:'bad-action' });
  } catch(e){
    return res.status(200).json({ ok:false, reason:'store-failed' });
  }
};
