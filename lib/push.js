// Web Push helpers shared by api/chat.js (notify on post) and api/push.js (subscriptions).
// Subscriptions live in Supabase: push_subs(id, client, endpoint, sub jsonb, ts). See supabase/push.sql.
//
// Vercel env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (from `npx web-push generate-vapid-keys`),
// VAPID_SUBJECT (mailto:info@blinkloopph.com). Without them push is simply off; the chat keeps working.

const crypto = require('crypto');

function vapid(){
  const pub = process.env.VAPID_PUBLIC_KEY || '', priv = process.env.VAPID_PRIVATE_KEY || '';
  return pub && priv ? { pub, priv, subject: process.env.VAPID_SUBJECT || 'mailto:info@blinkloopph.com' } : null;
}
const subId = endpoint => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);

function validSub(s){
  return s && typeof s.endpoint === 'string' && /^https:\/\/[^\s]+$/.test(s.endpoint) && s.endpoint.length < 1000
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

// Send `payload` to every subscription in `subs` ({endpoint, sub}). Dead subscriptions
// (410/404) are removed through `sb`. Never throws; never takes longer than `budgetMs`.
async function sendAll(sb, subs, payload, budgetMs = 4000){
  const v = vapid();
  if (!v || !subs.length) return { sent: 0, gone: 0 };
  let webpush; try { webpush = require('web-push'); } catch { return { sent: 0, gone: 0, reason: 'no-lib' }; }
  webpush.setVapidDetails(v.subject, v.pub, v.priv);
  const body = JSON.stringify(payload);
  let sent = 0, gone = 0, lastError = null;
  const work = Promise.allSettled(subs.map(async s => {
    try { await webpush.sendNotification(s.sub, body, { TTL: 3600, urgency: 'high' }); sent++; }
    catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { gone++; await sb(`push_subs?id=eq.${subId(s.endpoint)}`, { method: 'DELETE' }).catch(() => {}); }
      else lastError = (e && (e.statusCode ? 'HTTP ' + e.statusCode : e.code || e.message)) || 'send-failed';
    }
  }));
  await Promise.race([work, new Promise(r => setTimeout(r, budgetMs))]);
  const out = { sent, gone };
  if (lastError) out.lastError = String(lastError).slice(0, 120);
  return out;
}

module.exports = { vapid, subId, validSub, sendAll };
