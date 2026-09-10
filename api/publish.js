// POST /api/publish { slug, pages:[{ file:'index.html', html }], customDomain? }   (staff session required)
// Puts a site built in Loop Builder online on <slug>.blinkloop-ph.com through the Vercel API: one Vercel project per
// site (bl-site-<slug>), a production deployment holding the exported HTML files, and the subdomain attached.
//
// Vercel env: VERCEL_TOKEN (a personal or team token with project+deployment scope), optional VERCEL_TEAM_ID,
// optional PUBLISH_DOMAIN (default blinkloop-ph.com). DNS once: a wildcard CNAME  *.blinkloop-ph.com -> cname.vercel-dns.com
// on the domain's DNS provider (the apex is already on Vercel, so subdomains verify on their own).
const { sessionClient, readBody } = require('../lib/session.js');

const RESERVED = new Set(['www', 'api', 'admin', 'team', 'builder', 'login', 'mail', 'ftp', 'app', 'cdn', 'static', 'assets', 'blog', 'shop', 'store', 'dev', 'staging', 'test', 'demo', 'support', 'help', 'status', 'docs', 'blinkloop']);
const API = 'https://api.vercel.com';

async function vercel(path, { method = 'GET', body, token, teamId } = {}){
  const url = new URL(API + path); if (teamId) url.searchParams.set('teamId', teamId);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
  let r;
  try { r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal }); }
  finally { clearTimeout(t); }
  const text = await r.text(); let json = {}; try { json = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, json };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok: false, reason: 'server-config' });
  const client = sessionClient(req, secret);
  if (!client) return res.status(401).json({ ok: false, reason: 'unauthorized' });
  const token = process.env.VERCEL_TOKEN, teamId = process.env.VERCEL_TEAM_ID || undefined, domain = (process.env.PUBLISH_DOMAIN || 'blinkloop-ph.com').toLowerCase();
  if (!token) return res.status(200).json({ ok: false, reason: 'no-token' });

  const body = readBody(req);
  const slug = String(body.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug) || RESERVED.has(slug)) return res.status(200).json({ ok: false, reason: 'bad-slug' });
  const pages = Array.isArray(body.pages) ? body.pages.filter(p => p && typeof p.html === 'string' && /^[a-z0-9][a-z0-9-]{0,60}\.html$/i.test(String(p.file || ''))) : [];
  if (!pages.length || !pages.some(p => p.file.toLowerCase() === 'index.html')) return res.status(200).json({ ok: false, reason: 'no-index' });
  const total = pages.reduce((a, p) => a + p.html.length, 0);
  if (total > 12 * 1024 * 1024) return res.status(200).json({ ok: false, reason: 'too-large' });

  const projectName = 'bl-site-' + slug;
  try {
    /* 1. the project (one per site) */
    let proj = await vercel(`/v9/projects/${projectName}`, { token, teamId });
    if (proj.status === 404){
      proj = await vercel('/v10/projects', { method: 'POST', token, teamId, body: { name: projectName, framework: null } });
      if (!proj.ok) return res.status(200).json({ ok: false, reason: 'project', detail: proj.json && proj.json.error && proj.json.error.message });
    } else if (!proj.ok) return res.status(200).json({ ok: false, reason: 'project', detail: proj.json && proj.json.error && proj.json.error.message });
    const projectId = proj.json.id;

    /* 2. the deployment: the pages plus a vercel.json for clean URLs (menus.html answers at /menus) */
    const files = pages.map(p => ({ file: p.file.toLowerCase(), data: Buffer.from(p.html, 'utf8').toString('base64'), encoding: 'base64' }));
    files.push({ file: 'vercel.json', data: Buffer.from(JSON.stringify({ cleanUrls: true, trailingSlash: false, headers: [{ source: '/(.*)', headers: [{ key: 'X-Built-With', value: 'Loop Builder by BlinkLoop' }] }] }), 'utf8').toString('base64'), encoding: 'base64' });
    const dep = await vercel('/v13/deployments', { method: 'POST', token, teamId, body: { name: projectName, project: projectId, target: 'production', files, projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null } } });
    if (!dep.ok) return res.status(200).json({ ok: false, reason: 'deploy', detail: dep.json && dep.json.error && dep.json.error.message });

    /* 3. the address */
    const host = `${slug}.${domain}`;
    const dom = await vercel(`/v10/projects/${projectId}/domains`, { method: 'POST', token, teamId, body: { name: host } });
    const domainOk = dom.ok || dom.status === 409 || (dom.json && dom.json.error && /already/i.test(dom.json.error.code || dom.json.error.message || ''));
    let custom = null;
    if (body.customDomain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(body.customDomain))){
      const cd = String(body.customDomain).toLowerCase();
      const r2 = await vercel(`/v10/projects/${projectId}/domains`, { method: 'POST', token, teamId, body: { name: cd } });
      custom = { domain: cd, ok: r2.ok || r2.status === 409, verified: !!(r2.json && r2.json.verified), verification: r2.json && r2.json.verification, dns: cd.split('.').length > 2 ? `CNAME ${cd} -> cname.vercel-dns.com` : `A ${cd} -> 76.76.21.21` };
    }

    /* 4. wait briefly for the deployment to go live so the link works when clicked */
    let state = dep.json.readyState || dep.json.status || 'QUEUED';
    for (let i = 0; i < 12 && !/READY|ERROR|CANCELED/i.test(state); i++){
      await new Promise(r => setTimeout(r, 2000));
      const st = await vercel(`/v13/deployments/${dep.json.id}`, { token, teamId }); state = (st.json && (st.json.readyState || st.json.status)) || state;
    }
    return res.status(200).json({ ok: true, url: `https://${host}`, host, domainOk, deployUrl: dep.json.url ? `https://${dep.json.url}` : '', state, projectId, projectName, pages: pages.map(p => p.file.toLowerCase()), custom, client });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: /abort/i.test(String(e && e.message)) ? 'timeout' : 'failed', detail: String(e && e.message || '').slice(0, 200) });
  }
};
