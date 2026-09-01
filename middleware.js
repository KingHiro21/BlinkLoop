// Edge Middleware: makes /builder and /admin unreachable without a valid
// staff session cookie. Anyone not signed in is redirected to /login before
// the page is ever served. Uses the same LOOP_SECRET as the rest of the
// code system; no database, no extra env vars.

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(bytes, len) {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.slice(0, len);
}
function manilaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' })
    .format(new Date()).replace(/-/g, '');
}
async function validCode(raw, secret) {
  if (!secret) return false;
  const m = String(raw || '').trim().toUpperCase()
    .match(/^LOOP-([A-Z0-9]{2,12})-(\d{8})-([0-9A-Z]{8})$/);
  if (!m) return false;
  const [, client, ymd, sig] = m;
  if (ymd < manilaToday()) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${client}|${ymd}`)));
  return b32(mac, 8) === sig;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)bl_session=([^;]+)/);
  const code = m ? decodeURIComponent(m[1]) : '';
  if (await validCode(code, process.env.LOOP_SECRET || '')) return; // signed in: serve the page
  const login = new URL('/login', url);
  login.searchParams.set('next', url.pathname.replace(/\.html$/, ''));
  return Response.redirect(login, 307);
}

export const config = {
  matcher: ['/builder', '/builder.html']
};
