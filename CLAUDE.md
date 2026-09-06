# BlinkLoop — project notes for Claude Code

BlinkLoop is a Cebu web studio (three co-founders: Hiroki/Jose, Moana, Queen). This repo is the whole
product: the public marketing site, an internal staff suite, and the serverless API behind it.
Static HTML + Vercel serverless functions. No build step, no framework, no bundler. Deploy = push to `main`
(Vercel Git integration). Live at https://www.blinkloop-ph.com. Official email: info@blinkloopph.com
(note: site domain has a hyphen, email domain does not).

## Repo map

| Path | What it is |
|---|---|
| `index.html` | Homepage (handcrafted; hero orbit animation with eye-tracking pupil + partner chips) |
| `hosting.html` | Pricing page (`/hosting`) |
| `work.html` | Portfolio (`/work`): Hwasung Refrigeration, CORE Migration. Screenshots in `assets/work/` |
| `privacy.html` | Privacy policy (RA 10173 aware) |
| `login.html` | Staff login → sets session cookie; shows a hub (Builder / Team / Admin / Site) |
| `builder.html` | **Loop Builder** — internal drag-and-drop site builder (single 500KB+ file, i18n 7 languages) |
| `team.html` | **Team chat** — daily pages, threads, search, pins, presence |
| `admin.html` | Mints staff access codes (needs `LOOP_ADMIN_KEY`) |
| `middleware.js` | Vercel Edge Middleware: `/builder` and `/team` redirect to `/login` without a valid session |
| `api/` | Serverless functions (CommonJS — do NOT add `"type":"module"` to package.json) |
| `loop-projects/` | Builder project files (`blinkloop.loop.json`) + a builder-generated homepage |
| `og.png`, `robots.txt`, `sitemap.xml` | SEO assets. Add every new public page to the sitemap. |
| `assets/` | Logo files (`blinkloop-icon.png`, wordmarks), hero eye (`hero-core.png`), partner chips in `assets/work/`. Reference these by path; never inline images as base64 in the pages (it was 60 to 230KB of dead weight per page). Served with a one-week cache via `vercel.json`. |
| `blinkloop-form.gs` | Google Apps Script that receives the contact form and emails info@ (lives in Google, copy here) |

`vercel.json` has `cleanUrls: true` — pages are reachable without `.html`. Never create a folder with the
same name as a page (e.g. `work/` next to `work.html`); it confuses routing. Use `assets/…`.

## Auth model (stateless, no database)

- Access codes: `LOOP-<NAME>-<YYYYMMDD>-<SIG8>`; SIG8 = HMAC-SHA256(`NAME|YYYYMMDD`, `LOOP_SECRET`),
  Crockford base32, first 8 chars. Expire end of that day, Asia/Manila. Code = credential.
- `/api/login` verifies a code and sets cookies `bl_session` (HttpOnly, the credential) and `bl_staff=1`
  (readable UI hint: site nav shows Builder/Team links + green presence pill when present).
- `/api/me`, `/api/logout`, `/api/verify`, `/api/generate` (admin-key gated), `/api/upload` (builder images → Vercel Blob).
- Env vars (Vercel, Production): `LOOP_SECRET`, `LOOP_ADMIN_KEY`, `BLOB_READ_WRITE_TOKEN` (auto from Blob store),
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Never print or commit their values.

## Team chat storage (Supabase, free tier)

`api/chat.js` and `api/presence.js` talk to Supabase's REST API (PostgREST) with plain `fetch` — no SDK.
Tables: `messages(id, parent, ts, author, text, att jsonb)`, `pins(id, ts)`, `presence(client, ts)`, RLS enabled
(service key bypasses). Days are Asia/Manila (UTC+8 fixed). Attachments still go to Vercel Blob
(`chat-files/`) because uploads are rare; it was 4-second polling that threatened the free Blob quota — keep
hot-path storage off Blob.

How `/api/chat` GET stays cheap: a full load (no `since`) returns everything including `days` and pinned
bodies. A poll (`since>0`, plus `pins=<ids the client has>`) runs one parallel batch of five small queries and
omits `days` and pinned bodies unless the pin set changed. Reply counts come from one query (all replies posted
since the day started), so they never reset between polls. `team.html` paints the last feed from
localStorage first, polls at 3s (10s after 90s of quiet, 30s while the tab is hidden), re-renders only when
something changed, and sends optimistically. `supabase/indexes.sql` has the indexes those queries need; run it
once in the Supabase SQL editor.

## Realtime (team chat)

Supabase Realtime Broadcast on channel `team`. `lib/realtime.js` posts a content-free ping
(`{kind: post|reply|pins|del, ts, ...}`) to `/realtime/v1/api/broadcast` with the service key after every
change; `team.html` opens the socket itself (Phoenix v1 JSON frames, no client library) using the anon key from
`/api/realtime` (session-gated; needs env `SUPABASE_ANON_KEY`) and fetches through `/api/chat` on each ping.
Message text never travels over the socket, so the public anon key cannot read the chat. Polling stays as a
30s safety net while live, 3s when the socket is down. No Supabase-side setup: Broadcast works without
publications or RLS policies. Without `SUPABASE_ANON_KEY` the page simply keeps polling.

## Notifications (team chat)

Web Push: `sw.js` (notifications only, no caching) + `manifest.webmanifest` (installable, start_url /team) +
`api/push.js` (subscribe / unsubscribe / test) + `lib/push.js` (shared sender, `web-push` package). Subscriptions
live in Supabase `push_subs` (`supabase/push.sql`). `api/chat.js` pushes to everyone except the author after a
post, capped at 4s. Env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`),
`VAPID_SUBJECT` (mailto:info@blinkloopph.com). Without them the bell falls back to in-page alerts while the tab
is open. iPhone gets push only after Add to Home Screen. Unread: tab title, app badge, and the site nav pill
(`/api/presence?seen=<ts>`, ts from localStorage `bl-team-seen`). PWA icons: `assets/icon-192.png`,
`icon-512.png`, `icon-512-maskable.png`, `icon-180.png`, `badge-96.png`.

## Contact form

Posts JSON (as `text/plain` to avoid a CORS preflight) to a Google Apps Script web app URL — the
`FORM_ENDPOINT` constant near the bottom of `index.html`, `hosting.html`, `work.html`. Honeypot field `website`.
No FormSubmit, no Resend, no serverless mail. The script must be deployed with access "Anyone".

## Conventions (the founder cares about these)

- **No em dashes anywhere in copy.** Use commas, periods, or colons.
- Voice: short, declarative, specific. "Pay once, own it." Avoid AI-sounding filler.
- Mobile first: every layout change must be checked at 390px and ~880px. The nav collapses into a
  scrollable pill strip (no hamburger) below 1040px. Never let a decorative element be wider than the
  viewport (mobile browsers zoom the whole page out to fit it): `html{overflow-x:hidden}` +
  `body{overflow-x:clip}` are the safety net, but fix the element too.
- Inputs on mobile: `font-size:16px` (prevents iOS zoom). Hover-only controls must also be visible on touch.
- Dark theme exists on every public page (`data-theme="dark"` on `<html>`). Check both.
- Keep internal pages `noindex`; keep `/builder`, `/team`, `/admin`, `/login`, `/api/` out of the sitemap.
- Real projects, real logos, real quotes only. Never fabricate clients, testimonials, or numbers.
- Prefer editing in place with small, verifiable changes. Founder wants to review diffs in GitHub Desktop.

## Testing

Historically tested with Puppeteer end-to-end suites (login flow, chat, days/threads/search, presence,
forms, SEO tags, mobile widths). Those suites are not in the repo yet; if you add tests, put them under
`tests/`, use plain `puppeteer`, and mock external hosts (Apps Script URL, Supabase via a small PostgREST
emulator). A pattern that worked: an in-memory `@vercel/blob` stub via `require.cache`, and a tiny local
server that mounts the `api/*.js` handlers and emulates the middleware redirect.

## Known limits / open items

- Partner chips in the hero are cropped from screenshots; replace with real logo files when available.
- Search reads the most recent messages (fine at team scale); add an index/RPC if the chat grows large.
- Free Supabase projects pause after ~7 days of inactivity; daily use prevents it.
- PayMongo auto-payments (client pays → code auto-minted) was designed but not built; waits on a business account.
- Possible next pages: industry landing pages ("Websites for catering businesses in Cebu"), built with Loop Builder.
