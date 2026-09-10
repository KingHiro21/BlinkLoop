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
| `builder.html` | **Loop Builder** — internal drag-and-drop site builder (single ~280KB file, i18n 7 languages). 22 blocks in `BLOCKS`, 9 font pairings, 10 palettes plus custom colours. Theme keys: palette, accent, accent2, bg, ink, font, radius, density, btn (pill/soft/sharp), width (narrow/normal/wide), scale (type size), texture (hero: glow/grid/dots/none). Every block gets a Section group (anchor id, spacing, alignment) applied by `decorate()` after render; `DEFAULT_ANCHOR` makes nav links like #pricing work out of the box. `onAccent()` picks readable text on the accent colour. Drafts: several sites per device (`loopbuilder-drafts` index + `loopbuilder-draft-<id>`); the current one still autosaves to `loopbuilder-page`. The Projects list shows them as folders: one per imported site (grouped by the index entry's `site` = scopeId, named after the source host or a name kept in `loopbuilder-folders`; header has Save all for unsaved pages, rename, delete folder) plus "My drafts" for hand-made pages. Empty drafts never enter the index. `migrateIndex()` back-fills `site`/`from` on old entries. Exported client sites load Google Fonts by design (the client's site and disclosure). **Import from a website** (Projects modal and the template chooser) posts a URL to `/api/import` in one of two modes: **Exact copy** (default) returns the page as one `html` block ("Imported page": scoped CSS + cleaned markup, whole block inline-editable via `data-rawedit`, a media panel (field type `media`: every img / video / iframe / inline background listed, clicking one on the canvas highlights its row, paste an image URL, upload, or paste a YouTube / Vimeo / .mp4 link to turn that spot into a video via `replaceMedia()`), inspector action "Copy images and fonts to BlinkLoop storage" rehosts every image and web font (fonts from another domain are blocked by CORS on most hosts, so this is what makes a copy render right) through `/api/import {action:'asset'}`), **Whole site** (a switch under Exact copy) is driven by the browser so no single request carries a site: `mode:'links'` lists the same-host pages linked from the start page (menu and footer links first, max 20, with slugs), then the builder calls `mode:'exact', split:true, scopeId, have:[sheet hrefs already received]` once per page (`importWholeSite`, progress bar and a Stop button; a stopped import keeps the pages done so far) and assembles the shared stylesheet itself (unique linked sheets in first-seen order, plus each page's inline rules deduplicated rule by rule via `splitCssRules` so CSS-in-JS sites do not repeat 700KB per page, plus the server's `overrides`); links between pages are rewritten to `/slug` client-side. One page per draft (`applyImportedSite`, `meta.slug` drives the export file name), stylesheets fetched once and kept once (block prop `cssRef`, read by `siteCss()`; project files carry it as `state.siteCss`), links between copied pages rewritten to `/slug`. **Imports are temporary until saved**: imported states carry `meta.ephemeral` and live in the in-memory `TEMP.pages` map; `autosave()` skips them, the top bar shows an amber "Not saved" dot plus a Save button (also Ctrl+S), Projects lists them under "Imported, not saved yet" with Save / Discard / Save all, and `saveTempPage()` is the only path that writes them (and the shared css, `loopbuilder-sitecss-<scopeId>`) to localStorage. Clicking a `/slug` link inside an imported page on the canvas opens that page's draft (`findPageId` via `TEMP` then the drafts index, which stores `slug` and `site`); Alt+click edits the link text; `#hash` scrolls. **Rebuild as blocks** maps sections to normal blocks (Features cards keep a picture when the card had one). Either becomes a new draft or is appended. The `html` block is also in the library as custom HTML. |
| `team.html` | **Team chat** — daily pages, threads, search, pins, presence |
| `admin.html` | Mints staff access codes (needs `LOOP_ADMIN_KEY`) |
| `middleware.js` | Vercel Edge Middleware: `/builder` and `/team` redirect to `/login` without a valid session |
| `api/` | Serverless functions (CommonJS — do NOT add `"type":"module"` to package.json) |
| `loop-projects/` | Builder project files (`blinkloop.loop.json`) + a builder-generated homepage |
| `og.png`, `robots.txt`, `sitemap.xml` | SEO assets. Add every new public page to the sitemap. |
| `assets/` | Logo files (`blinkloop-icon.png`, wordmarks as PNG plus 240px WebP), hero eye (`hero-core-328.webp` + PNG fallback, sized 2x its 164px display), partner chips and 1200px portfolio shots (WebP + JPEG) in `assets/work/`. Every raster image is a `<picture>` with a WebP source. Reference by path; never inline images as base64. Assets cache one week, fonts one year (`vercel.json`). |
| `blinkloop-form.gs` | Google Apps Script that receives the contact form and emails info@ (lives in Google, copy here) |

`vercel.json` has `cleanUrls: true` — pages are reachable without `.html`. Never create a folder with the
same name as a page (e.g. `work/` next to `work.html`); it confuses routing. Use `assets/…`.

## Auth model (stateless, no database)

- Access codes: `LOOP-<NAME>-<YYYYMMDD>-<SIG8>`; SIG8 = HMAC-SHA256(`NAME|YYYYMMDD`, `LOOP_SECRET`),
  Crockford base32, first 8 chars. Expire end of that day, Asia/Manila. Code = credential.
- `/api/login` verifies a code and sets cookies `bl_session` (HttpOnly, the credential) and `bl_staff=1`
  (readable UI hint: site nav shows Builder/Team links + green presence pill when present).
- `/api/me`, `/api/logout`, `/api/verify`, `/api/generate` (admin-key gated), `/api/upload` (builder images → Vercel Blob).
- `/api/import` (session-gated, POST `{url, mode}`, `maxDuration` 60s in vercel.json). **Pages are loaded in headless Chromium first** (`loadPage` -> `renderPage`: `puppeteer-core`, on Vercel `@sparticuz/chromium` via dynamic `import()` because the package is ESM-only, locally an installed Chrome/Edge or `CHROME_PATH`; fonts/media requests are blocked, images load so lazy loaders reveal real sources, the page is auto-scrolled, then before the DOM is serialized: CSSOM-inserted rules are folded back into `<style>` text, `currentSrc` pinned (or the largest `<picture>`/srcset candidate when nothing loaded), script-set background images copied inline, fixed pop-ups/dialogs/backdrops removed, images a script would reveal on load forced visible (`data-force-visible`, and any `data-image-loaded-class` applied), "--padding-top: NaN%" aspect boxes re-sized from the picture inside, and streaming players (video.js / HLS blobs) given their poster image; video file URLs the page requested (`mediaUrls`) are remembered and assigned to blob videos in order, poster-only otherwise. Tracking pixels (0x0 images, ad/analytics hosts) are dropped in `cleanBody`. Every stylesheet response the browser received is captured (`cssMap`) and reused instead of refetched, since CDNs like Akamai refuse non-browser fetches; all server fetches use a browser UA anyway). When rendering fails, exact/links/site requests answer `{ok:false, reason:'no-browser', detail}` (the builder shows the detail) unless the request carries `allowRaw:true` (a switch in the import modal, off by default); blocks mode always falls back to raw HTML. `IMPORT_NO_RENDER=1` forces the raw path everywhere. vercel.json has `includeFiles: node_modules/@sparticuz/chromium/bin/**` so the Chromium brotli archives ship with the function (nft cannot trace their `__dirname` reads). `scopeCSS` drops `@media (prefers-color-scheme: dark)` blocks and makes light-only blocks unconditional, and `iframe.frame{color-scheme:light}` keeps the editor's dark theme from switching a copied site into its dark mode. Each whole-site page is its own request, so a rendered page (10 to 20s) always fits the limit; the response size stays under Vercel's 4.5MB cap because stylesheets already sent are omitted (`have`). `mode:'exact'` returns the page as-is: every
  stylesheet fetched (14 files / 1.6MB cap, Google Fonts kept as @import), `url()`s absolutized, rem converted to px when the site sets
  `html{font-size}`, every selector prefixed with `#imp-xxxxxx` (html/:root/body become the wrapper, which also carries the body classes),
  scripts/iframes (except YouTube/Vimeo/Maps) and on* attributes removed, lazy `data-src` promoted, animation-library "invisible" classes
  forced visible. `action:'asset'` copies one remote image into Blob under `sites/<CLIENT>/imported/`. Default mode ("Rebuild as blocks") reads the first four stylesheets too (`themeFromCSS`: brand colour from --primary/--accent style variables, then button backgrounds, then the most repeated saturated mid-tone; heading font-family mapped onto our pairings via `FONT_MAP`) and maps the page to builder
  blocks (brand/nav from the header, h1 + first paragraph as the hero, each h2 section classified as pricing / FAQ / testimonials /
  gallery / features / image+text / text by what it contains, runs of tiny h2 cards grouped into one features block, video / logos / steps / stats / cta / map / social / banner where the
  markup says so, prices with their period, hero with both buttons, contact from mailto/tel/address, footer). Menu links that name a rebuilt section are retargeted to its anchor. SSRF guard: http(s) only,
  DNS result checked against private ranges, 3 redirects, 2.5MB, 8s, HTML only. `IMPORT_ALLOW_PRIVATE=1` is for the local
  harness only, never set it in Vercel. Imported images hotlink the source site until replaced; `meta.importedFrom` records the URL.
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

## Mentions, reactions, install (team chat)

- `@NAME` in a message: highlighted for everyone, left-bar highlight for the named person, autocomplete in both
  composers (names from presence, the day's authors, and a remembered roster in localStorage `bl-team-roster`).
  The named person's push says "X mentioned you" with its own tag; `mentionsIn()` in `api/chat.js` parses.
- Reactions: fixed set 👍 ❤️ ✅ 😂 🎉 👀, table `reactions` (`supabase/reactions.sql`, run once). POST
  `{action:'react', id, emoji}` toggles; the day feed and thread responses carry `reactions[msgId][emoji] = [names]`.
  Queries are wrapped so a missing table never breaks the chat. Realtime ping kind `react`.
- Install banner under the day bar: holds `beforeinstallprompt`, iPhone Safari gets the Add to Home Screen hint,
  "Later" is remembered in `bl-install-dismissed`.

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

## Policies, consent, accessibility

- Policy pages: `privacy.html`, `terms.html`, `cookies.html`, `refunds.html` share `assets/legal.css`. Written for RA 10173
  (Data Privacy Act), RA 7394 (Consumer Act: refunds must never say "no refund" for defective service), RA 8293
  (IP Code: copyright in commissioned work must be assigned in writing, Terms §8 does this), RA 8792 (E-Commerce Act).
  Specifics (deposit, revision rounds, VAT) live in the client's quote on purpose, so the pages never state numbers we
  do not control. Keep the four footers and the legal nav in sync.
- Contact form has a required consent checkbox; the payload carries `consent`, `consentAt`, `page` and the Apps
  Script writes them into the email. Do not remove the checkbox: it is the legal basis for handling an inquiry.
- Cookie consent: `assets/consent.js`. Nothing is asked or loaded until `window.BL_ANALYTICS.ga4` (set inline at the
  bottom of index/hosting/work) has a GA4 Measurement ID; then a banner asks once, the choice lives 12 months in
  localStorage `bl-consent`, Global Privacy Control means "Essential only", and the footer "Cookie settings" link
  appears. Adding any other third-party script means updating `cookies.html` first.
- Fonts are self-hosted (`@font-face` inlined in every page head, files in `assets/fonts/`, SIL OFL). Do not reintroduce the
  Google Fonts `<link>`; the Cookie Policy says fonts come from our own domain. There is deliberately no Unbounded
  latin-ext face: the peso sign alone pulled a 118KB file, and Sora latin-ext (12KB) renders it instead.
- Contrast (WCAG AA 4.5:1, light theme on #FFFCF7): `--rust-ink #BD4218` 5.2, `--muted #7E5D4C` 5.8, ink on rust
  buttons (`--on-rust #2B140E`) 5.3. Brand rust `#F45D2A` is decorative only; never use it for body text or for
  light text on rust. Every public page has a skip link; decorative links inside `aria-hidden` get `tabindex="-1"`.

## Contact form

Posts JSON (as `text/plain` to avoid a CORS preflight) to a Google Apps Script web app URL — the
`FORM_ENDPOINT` constant near the bottom of `index.html`, `hosting.html`, `work.html`. Honeypot field `website`.
No FormSubmit, no Resend, no serverless mail. The script must be deployed with access "Anyone".

## Conventions (the founder cares about these)

- **No em dashes anywhere in copy.** Use commas, periods, or colons.
- Voice: short, declarative, specific. "Pay once, own it." Avoid AI-sounding filler.
- Mobile first: every layout change must be checked at 320px, 390px, ~880px, 1024px and 1366px. The nav collapses
  into a scrollable pill strip (no hamburger) at 1180px and below, so the desktop row never has to squeeze the
  staff links and presence pill. Footer is a grid: brand and address on row one, policy links on row two,
  stacked on phones. The chat header compacts at 900px and again at 640px. The builder chrome never overflows: the app grid uses minmax(0,1fr) columns, tool buttons drop their labels at 1400px, the save text and export label at 1240px, the device switcher at 1060px, and at 880px and below the editor shows one pane at a time (Blocks / Page / Edit) from a bottom bar, with a ✎ button in the canvas block toolbar that opens the inspector. Never let a decorative element be wider than the
  viewport (mobile browsers zoom the whole page out to fit it): `html{overflow-x:hidden}` +
  `body{overflow-x:clip}` are the safety net, but fix the element too.
- Inputs on mobile: `font-size:16px` (prevents iOS zoom). Hover-only controls must also be visible on touch.
- Dark theme exists on every public page (`data-theme="dark"` on `<html>`). Check both. Every page sets `color-scheme` (light on `:root`, dark under `[data-theme="dark"]`) so native controls (select dropdowns, scrollbars, date pickers) follow the theme instead of showing light text on a white popup.
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
