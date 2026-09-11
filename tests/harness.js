// Local test harness: serves the repo's static pages, mounts the real api/*.js handlers, emulates the Edge middleware
// redirect, Supabase's PostgREST and Realtime Broadcast in memory, and hosts a small WordPress-like sample site for
// the importer. Test tooling only: nothing here talks to the internet (Apps Script forwarding is switched off).
//
//   node tests/harness.js          starts on http://localhost:3457 and prints a staff code for the day
//   require('./harness').start()   used by tests/run.js
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.HARNESS_PORT || 3457);
process.env.LOOP_SECRET = process.env.LOOP_SECRET || 'test-secret';
process.env.LOOP_ADMIN_KEY = process.env.LOOP_ADMIN_KEY || 'test-admin';
process.env.SUPABASE_URL = `http://localhost:${PORT}/sb`;
process.env.SUPABASE_SERVICE_KEY = 'test-key';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
process.env.IMPORT_ALLOW_PRIVATE = '1';   // lets /api/import read the sample site served below (never set this in Vercel)
process.env.APPS_SCRIPT_URL = 'off';      // never email the real inbox from a test
delete process.env.VERCEL_TOKEN; delete process.env.ANTHROPIC_API_KEY;
process.env.BLOB_READ_WRITE_TOKEN = 'test-blob'; // @vercel/blob is replaced below by an in-memory store
const blobMem = new Map();
try {
  const blobId = require.resolve('@vercel/blob');
  require.cache[blobId] = { id: blobId, filename: blobId, loaded: true, exports: {
    put: async (p, data, o) => { blobMem.set(p, { data: Buffer.isBuffer(data) ? data : Buffer.from(String(data)), type: (o && o.contentType) || 'application/octet-stream' }); return { url: `http://localhost:${PORT}/__blob/${p}`, pathname: p }; },
    list: async (o = {}) => ({ blobs: [...blobMem.keys()].filter(k => k.startsWith(o.prefix || '')).map(k => ({ url: `http://localhost:${PORT}/__blob/${k}`, pathname: k, size: blobMem.get(k).data.length })), hasMore: false }),
    del: async (u) => { for (const x of [].concat(u)) blobMem.delete(String(x).replace(/^.*\/__blob\//, '')); },
    head: async (u) => { const k = String(u).replace(/^.*\/__blob\//, ''); return blobMem.has(k) ? { url: u, pathname: k, size: blobMem.get(k).data.length } : null; }
  } };
} catch (e) { console.error('blob stub not installed:', e.message); }
try { const wp = require('web-push'); const k = wp.generateVAPIDKeys(); process.env.VAPID_PUBLIC_KEY = k.publicKey; process.env.VAPID_PRIVATE_KEY = k.privateKey; process.env.VAPID_SUBJECT = 'mailto:test@example.com'; } catch {}

/* the real functions, exactly the files Vercel deploys (Hobby plan: 12 at most, guarded by a test in tests/run.js) */
const apis = {};
for (const f of fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'))){ const n = f.replace(/\.js$/, ''); try { apis[n] = require(path.join(ROOT, 'api', f)); } catch (e) { console.error('api/' + f + ' did not load:', e.message); } }
/* vercel.json rewrites, applied like Vercel does: the source's query is merged into the destination's */
function escRe(s){ return s.replace(/[.*+?^{}()|[\]\\]/g, function (m){ return '\\' + m; }); }
const REWRITES = (JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).rewrites || []).map(r => { const names = []; const re = new RegExp('^' + escRe(r.source).replace(/:(\w+)/g, function (m, n){ names.push(n); return '([^/]+)'; }) + '$'); return { re, names, destination: r.destination }; });
function applyRewrites(u){
  for (const r of REWRITES){ const m = u.pathname.match(r.re); if (!m) continue; let dest = r.destination; r.names.forEach((n, i) => { dest = dest.split(':' + n).join(m[i + 1]); }); const d = new URL(dest, 'http://x'); for (const [k, val] of u.searchParams) if (!d.searchParams.has(k)) d.searchParams.set(k, val); return d; }
  return u;
}
const SAMPLE = path.join(__dirname, 'fixtures', 'sample-wp.html');

/* ---- staff codes: same HMAC as api/login and middleware.js ---- */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(bytes, len){ let bits = 0, value = 0, out = ''; for (const byte of bytes){ value = (value << 8) | byte; bits += 8; while (bits >= 5){ out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } } return out.slice(0, len); }
function manilaToday(){ return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).replace(/-/g, ''); }
function mintCode(name = 'TEST', ymd = manilaToday()){ const mac = crypto.createHmac('sha256', process.env.LOOP_SECRET).update(`${name}|${ymd}`).digest(); return `LOOP-${name}-${ymd}-${b32(mac, 8)}`; }

/* ---- Realtime emulator: minimal WebSocket server speaking Phoenix v1 JSON, plus the REST broadcast endpoint ---- */
const sockets = new Set();
function wsFrame(str){ const p = Buffer.from(str); let h; if (p.length < 126) h = Buffer.from([0x81, p.length]); else if (p.length < 65536){ h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); } else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); } return Buffer.concat([h, p]); }
function wsSend(sock, obj){ try { sock.write(wsFrame(JSON.stringify(obj))); } catch {} }
function handleUpgrade(req, sock){
  const key = req.headers['sec-websocket-key']; const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const client = { sock, topics: new Set() }; sockets.add(client); stats.wsConnections++;
  let buf = Buffer.alloc(0);
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2){
      const op = buf[0] & 0x0f, masked = !!(buf[1] & 0x80); let len = buf[1] & 0x7f, off = 2;
      if (len === 126){ if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127){ if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? buf.subarray(off, off + 4) : null; if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len)); if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buf = buf.subarray(off + len);
      if (op === 8){ sock.end(); return; }
      if (op === 9){ sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op !== 1) continue;
      let m; try { m = JSON.parse(payload.toString()); } catch { continue; }
      if (m.topic === 'phoenix' && m.event === 'heartbeat') wsSend(sock, { topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref });
      else if (m.event === 'phx_join'){ client.topics.add(m.topic); wsSend(sock, { topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: [] } }, ref: m.ref }); }
    }
  });
  sock.on('close', () => sockets.delete(client)); sock.on('error', () => sockets.delete(client));
}
function fanout(topic, event, payload){ let n = 0; for (const c of sockets){ if (c.topics.has('realtime:' + topic)){ wsSend(c.sock, { topic: 'realtime:' + topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: null }); n++; } } return n; }

/* ---- PostgREST emulator ---- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.json': 'application/json', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const db = { messages: [], pins: [], presence: [], push_subs: [], reactions: [], leads: [] };
const stats = { calls: 0, byTable: {}, pushes: [], broadcasts: [], wsConnections: 0 };
function getField(row, f){ if (f.includes('->>')){ const [a, b] = f.split('->>'); return row[a] ? row[a][b] : undefined; } return row[f]; }
function test(row, field, op, val){
  const v = getField(row, field);
  if (op === 'is' && val === 'null') return v === null || v === undefined;
  if (op === 'not.is' && val === 'null') return !(v === null || v === undefined);
  if (op === 'eq') return String(v) === val;
  if (op === 'neq') return String(v) !== val;
  if (op === 'in'){ const list = val.replace(/^\(|\)$/g, '').split(',').map(s => s.trim()); return list.includes(String(v)); }
  if (op === 'ilike'){ const re = new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i'); return re.test(String(v == null ? '' : v)); }
  const n = Number(val), x = Number(v);
  if (op === 'gte') return x >= n; if (op === 'gt') return x > n; if (op === 'lt') return x < n; if (op === 'lte') return x <= n;
  throw new Error('unsupported op ' + op);
}
function parseCond(str){
  let m = str.match(/^([^.]+)\.not\.is\.(.+)$/); if (m) return [m[1], 'not.is', m[2]];
  m = str.match(/^([^.]+)\.(is|eq|neq|in|ilike|gte|gt|lte|lt)\.(.*)$/s); if (!m) throw new Error('bad cond ' + str); return [m[1], m[2], m[3]];
}
function filterRows(rows, params){
  return rows.filter(row => {
    for (const [k, raw] of params){
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
      if (k === 'or'){ const parts = raw.replace(/^\(|\)$/g, '').split(/,(?=[a-z_>-]+\.)/); if (!parts.some(p => { const [f, o, v] = parseCond(p); return test(row, f, o, v); })) return false; continue; }
      const m = raw.match(/^(not\.is|is|eq|neq|in|ilike|gte|gt|lte|lt)\.(.*)$/s); if (!m) throw new Error('bad filter ' + k + '=' + raw);
      if (!test(row, k, m[1], m[2])) return false;
    }
    return true;
  });
}
function handleSb(req, res, body){
  const u = new URL(req.url, 'http://x'); const table = u.pathname.replace('/sb/rest/v1/', '');
  const params = [...u.searchParams.entries()]; const rows = db[table]; if (!rows){ res.statusCode = 404; return res.end('no table'); }
  stats.calls++; stats.byTable[table] = (stats.byTable[table] || 0) + 1;
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET'){
    let out = filterRows(rows, params);
    const order = u.searchParams.get('order'); if (order){ const [f, dir] = order.split('.'); out = out.slice().sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const limit = Number(u.searchParams.get('limit') || 0); if (limit) out = out.slice(0, limit);
    const sel = u.searchParams.get('select'); if (sel && sel !== '*'){ const fields = sel.split(','); out = out.map(r => Object.fromEntries(fields.map(f => [f, r[f]]))); }
    return res.end(JSON.stringify(out));
  }
  if (req.method === 'POST'){
    const row = JSON.parse(body); const oc = u.searchParams.get('on_conflict');
    if (table === 'leads'){ if (row.id === undefined) row.id = crypto.randomUUID(); if (row.ts === undefined) row.ts = new Date().toISOString(); if (row.status === undefined) row.status = 'new'; }
    if (oc){ const i = rows.findIndex(r => r[oc] === row[oc]); if (i > -1) rows[i] = { ...rows[i], ...row }; else rows.push(row); } else rows.push(row);
    res.statusCode = 201; return res.end('');
  }
  if (req.method === 'PATCH'){ const patch = JSON.parse(body); for (const r of filterRows(rows, params)) Object.assign(r, patch); res.statusCode = 204; return res.end(); }
  if (req.method === 'DELETE'){ const gone = new Set(filterRows(rows, params)); db[table] = rows.filter(r => !gone.has(r)); res.statusCode = 204; return res.end(); }
  res.statusCode = 405; res.end();
}

function samplePage(name){
  const html = fs.readFileSync(SAMPLE, 'utf8');
  if (!name) return html;
  const title = name[0].toUpperCase() + name.slice(1);
  return html.replace(/<title>[^<]*<\/title>/, `<title>${title} | Mabuhay Catering</title>`).replace(/<h1>[^<]*<\/h1>/, `<h1>${title}</h1>`).replace('class="home page-template"', `class="page page-${name}"`);
}

let server = null;
function start(port = PORT){
  if (server) return Promise.resolve(server);
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const chunks = []; req.on('data', d => chunks.push(d)); req.on('end', () => {
        const buf = Buffer.concat(chunks); const body = buf.toString('utf8');
        try {
          if (u.pathname === '/sb/realtime/v1/api/broadcast'){
            const msgs = (JSON.parse(body || '{}').messages) || []; let n = 0; for (const m of msgs){ stats.broadcasts.push(m); n += fanout(m.topic, m.event, m.payload); }
            res.statusCode = 202; return res.end(JSON.stringify({ delivered: n }));
          }
          if (u.pathname.startsWith('/sb/')) return handleSb(req, res, body);
          if (u.pathname === '/__stats'){ res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ...stats, rows: Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length])) })); }
          if (u.pathname === '/__reset'){ for (const k in db) db[k] = []; stats.calls = 0; stats.byTable = {}; stats.pushes = []; stats.broadcasts = []; return res.end('ok'); }
          if (u.pathname === '/__code'){ return res.end(mintCode(u.searchParams.get('name') || 'TEST')); }
          if (u.pathname.startsWith('/__blob/')){ const k = decodeURIComponent(u.pathname.slice(8)); const b = blobMem.get(k); if (!b){ res.statusCode = 404; return res.end('no blob'); } res.setHeader('Content-Type', b.type); return res.end(b.data); }
          if (u.pathname === '/__sample-wp'){ res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(samplePage('')); }
          const pm = u.pathname.match(/^\/(menus|packages|gallery|about|contact)\/?$/);
          if (pm){ res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(samplePage(pm[1])); }
          if (u.pathname === '/__sample-wp.css'){ res.setHeader('Content-Type', 'text/css; charset=utf-8'); return res.end(fs.readFileSync(SAMPLE.replace(/\.html$/, '.css'))); }
          const ru = applyRewrites(u);
          const m = ru.pathname.match(/^\/api\/(\w+)$/);
          if (m && apis[m[1]]){
            req.url = ru.pathname + ru.search; req.body = body; req.query = Object.fromEntries(ru.searchParams.entries());
            res.status = c => { res.statusCode = c; return res; }; res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
            return Promise.resolve(apis[m[1]](req, res)).catch(e => { console.error('api/' + m[1] + ' threw:', e); if (!res.headersSent){ res.statusCode = 500; res.end(JSON.stringify({ ok: false, reason: 'threw', detail: String(e && e.message) })); } });
          }
          if (u.pathname === '/team' || u.pathname === '/builder'){ // what middleware.js does on Vercel
            const c = (req.headers.cookie || '').match(/(?:^|;\s*)bl_session=([^;]+)/);
            const ok = c && require(path.join(ROOT, 'lib', 'session.js')).checkCode(decodeURIComponent(c[1]), process.env.LOOP_SECRET);
            if (!ok){ res.statusCode = 307; res.setHeader('Location', '/login?next=' + encodeURIComponent(u.pathname)); return res.end(); }
          }
          let f = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname); if (!path.extname(f)) f += '.html';
          const p = path.join(ROOT, f);
          if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.statusCode = 404; return res.end('404'); }
          res.setHeader('Content-Type', TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream');
          if (p.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
          res.end(fs.readFileSync(p));
        } catch (e) { console.error('harness error', u.pathname, e); if (!res.headersSent){ res.statusCode = 500; res.end('harness error: ' + e.message); } }
      });
    }).on('upgrade', (req, sock) => { if (req.url.startsWith('/sb/realtime/v1/websocket')) handleUpgrade(req, sock); else sock.destroy(); })
      .on('error', reject)
      .listen(port, () => resolve(server));
  });
}
function stop(){ return new Promise(r => { if (!server) return r(); for (const c of sockets) try { c.sock.destroy(); } catch {} server.close(() => { server = null; r(); }); }); }

module.exports = { start, stop, mintCode, db, stats, PORT, base: `http://localhost:${PORT}` };

if (require.main === module) start().then(() => {
  console.log(`harness on http://localhost:${PORT}`);
  console.log(`staff code for today: ${mintCode('TEST')}`);
  console.log('sample site for the importer: /__sample-wp   stats: /__stats   reset: /__reset');
});
