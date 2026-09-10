// GET  /api/leads?site=&status=&limit=   -> { ok, leads:[...] }      (staff session required)
// POST /api/leads { id, status?, note? }  -> { ok }                    (staff session required)
// The founders' lead list, read by admin.html. Status: new | contacted | quoted | won | lost.
const { sb, configured } = require('../lib/db.js');
const { sessionClient, readBody } = require('../lib/session.js');
const STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok: false, reason: 'server-config' });
  if (!sessionClient(req, secret)) return res.status(401).json({ ok: false, reason: 'unauthorized' });
  if (!configured()) return res.status(200).json({ ok: false, reason: 'no-database' });
  try {
    if (req.method === 'GET'){
      const q = req.query || {};
      const parts = ['select=id,ts,site,name,email,phone,business,service,message,page,status,note', 'order=ts.desc', `limit=${Math.min(500, Math.max(1, parseInt(q.limit, 10) || 200))}`];
      if (q.site) parts.push(`site=eq.${encodeURIComponent(String(q.site).toLowerCase().replace(/[^a-z0-9-]/g, ''))}`);
      if (q.status && STATUSES.includes(q.status)) parts.push(`status=eq.${q.status}`);
      const leads = await sb(`leads?${parts.join('&')}`);
      return res.status(200).json({ ok: true, leads });
    }
    if (req.method === 'POST'){
      const body = readBody(req);
      const id = String(body.id || '').replace(/[^0-9a-f-]/g, '');
      if (!id) return res.status(200).json({ ok: false, reason: 'bad-id' });
      const patch = {};
      if (body.status !== undefined){ if (!STATUSES.includes(body.status)) return res.status(200).json({ ok: false, reason: 'bad-status' }); patch.status = body.status; }
      if (body.note !== undefined) patch.note = String(body.note).slice(0, 2000);
      if (!Object.keys(patch).length) return res.status(200).json({ ok: false, reason: 'nothing' });
      await sb(`leads?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ ok: false, reason: 'method' });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: /relation .* does not exist/i.test(String(e.message)) ? 'no-table' : 'failed' });
  }
};
