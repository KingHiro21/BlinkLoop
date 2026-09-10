// Supabase over plain PostgREST fetch (no SDK), shared by the newer API routes.
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY. `configured()` lets a route degrade gracefully without them.
function conf(){
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  return { url, key };
}
function configured(){ const c = conf(); return !!(c.url && c.key); }
async function sb(pathAndQuery, { method = 'GET', body, prefer } = {}){
  const c = conf();
  if (!c.url || !c.key) throw new Error('supabase-not-configured');
  const headers = { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${c.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (r.status === 204) return [];
  const text = await r.text();
  if (!r.ok) throw new Error(`sb ${r.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return []; }
}
module.exports = { sb, configured };
