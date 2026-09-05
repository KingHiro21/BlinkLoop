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
