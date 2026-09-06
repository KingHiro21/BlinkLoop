// Supabase Realtime Broadcast, server side. After a chat change the API sends a small ping
// on the "team" channel; browsers subscribed to it fetch the change through /api/chat.
// The payload never carries message text, so the public anon key can subscribe safely.
// Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (already set for the chat). Never throws.

async function broadcast(payload, budgetMs = 1500){
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = process.env.SUPABASE_SERVICE_KEY || '';
  if (!url || !key) return false;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), budgetMs);
  try {
    const r = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: 'team', event: 'change', payload, private: false }] }),
      signal: ctl.signal
    });
    return r.ok;
  } catch (e) { return false; }
  finally { clearTimeout(t); }
}

module.exports = { broadcast };
