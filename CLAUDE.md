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
| `case-hwasung.html`, `case-core-migration.html` | Case-study pages (`/case-hwasung`, `/case-core-migration`) built on `assets/legal.css` plus a few inline rules; content is only what work.html already says (no new claims, numbers or quotes). BreadcrumbList + WebPage/CreativeWork JSON-LD. Linked from the work cards and in the sitemap. A new case study = copy one, change the facts, add to sitemap and work.html. |
| `privacy.html` | Privacy policy (RA 10173 aware) |
| `login.html` | Staff login → sets session cookie; shows a hub (Builder / Team / Admin / Site) |
| `builder.html` + `assets/builder/*.js` | **Loop Builder** — internal drag-and-drop site builder (i18n 7 languages). The HTML holds the markup, CSS and a tiny theme bootstrap; the code is five classic scripts loaded in order and sharing one global scope: `blocks.js` (BLOCKS registry, siteCSS, render helpers, decorate), `editor.js` (canvas, library, layers, inspector, media panel, AI menu), `i18n.js` + `i18n-extra.js` (LANGS, TR, t()), `app.js` (session, drafts/folders, export, publish, import, plugins, SEO). Keep that order; `node --check assets/builder/*.js` after edits. vercel.json serves them `Cache-Control: no-cache` and the middleware answers 401 for them without a session. 25 blocks in `BLOCKS`, 9 font pairings, 10 palettes plus custom colours. Theme keys: palette, accent, accent2, bg, ink, font, radius, density, btn (pill/soft/sharp), width (narrow/normal/wide), scale (type size), texture (hero: glow/grid/dots/none). Every block gets a Section group (anchor id, spacing, alignment) applied by `decorate()` after render; `DEFAULT_ANCHOR` makes nav links like #pricing work out of the box. `onAccent()` picks readable text on the accent colour. Drafts: several sites per device (`loopbuilder-drafts` index + `loopbuilder-draft-<id>`); the current one still autosaves to `loopbuilder-page`. The Projects list shows them as folders: one per imported site (grouped by the index entry's `site` = scopeId, named after the source host or a name kept in `loopbuilder-folders`; header has Save all for unsaved pages, rename, delete folder) plus "My drafts" for hand-made pages. Empty drafts never enter the index. `migrateIndex()` back-fills `site`/`from` on old entries. Exported client sites load Google Fonts by design (the client's site and disclosure). **Import from a website** (Projects modal and the template chooser) posts a URL to `/api/import`. The UI only offers **Rebuild as blocks** (with an "All pages" switch); the founder retired the exact-copy option from the UI on Sep 11, 2026, so the modal has no mode selector or raw-HTML switch (`importMode` is fixed to 'blocks'). The exact-copy machinery stays in the API and the builder (`html` block, media panel, `mode:'exact'`, `mode:'links'`) because the custom HTML block and whole-site plumbing use it: **Exact copy** returns the page as one `html` block ("Imported page": scoped CSS + cleaned markup, whole block inline-editable via `data-rawedit`, a media panel (field type `media`: every img / video / iframe / inline background listed, clicking one on the canvas highlights its row, paste an image URL, upload, or paste a YouTube / Vimeo / .mp4 link to turn that spot into a video via `replaceMedia()`), inspector action "Copy images and fonts to BlinkLoop storage" rehosts every image and web font (fonts from another domain are blocked by CORS on most hosts, so this is what makes a copy render right) through `/api/import {action:'asset'}`), **Whole site** (a switch shown for both modes) is driven by the browser so no single request carries a site: `mode:'links'` lists the same-host pages linked from the start page (menu and footer links first, max 20, with slugs), then the builder calls `mode:'exact', split:true, scopeId, have:[sheet hrefs already received]` once per page (`importWholeSite(url, mode)`, progress bar and a Stop button; a stopped import keeps the pages done so far; in blocks mode each page is posted with `mode:'blocks'`, the home page's theme is applied to every page draft via `applyImportedTheme`, and link-shaped block props (href/link/url/primaryHref/secondaryHref/ctaHref, on blocks and their items) that name an imported page are rewritten to `/slug`) and assembles the shared stylesheet itself (unique linked sheets in first-seen order, plus each page's inline rules deduplicated rule by rule via `splitCssRules` so CSS-in-JS sites do not repeat 700KB per page, plus the server's `overrides`); links between pages are rewritten to `/slug` client-side. One page per draft (`applyImportedSite`, `meta.slug` drives the export file name), stylesheets fetched once and kept once (block prop `cssRef`, read by `siteCss()`; project files carry it as `state.siteCss`), links between copied pages rewritten to `/slug`. **Imports are temporary until saved**: imported states carry `meta.ephemeral` and live in the in-memory `TEMP.pages` map; `autosave()` skips them, the top bar shows an amber "Not saved" dot plus a Save button (also Ctrl+S), Projects lists them under "Imported, not saved yet" with Save / Discard / Save all, and `saveTempPage()` is the only path that writes them (and the shared css, `loopbuilder-sitecss-<scopeId>`) to localStorage. Clicking a `/slug` link inside an imported page on the canvas opens that page's draft (`findPageId` via `TEMP` then the drafts index, which stores `slug` and `site`); Alt+click edits the link text; `#hash` scrolls. **Rebuild as blocks** maps sections to normal blocks (Features cards keep a picture when the card had one, get `link` (clickable card) from the card's anchor, and `imgFit:contain` when the pictures are small product shots or icons; hero `tone:dark` when the source hero was dark without a photo; split and gallery carry the section `variant` (tint/dark) like features/text/pricing). Either becomes a new draft or is appended. The `html` block is also in the library as custom HTML. |
| `team.html` | **Team chat** — daily pages, threads, search, pins, presence |
| `admin.html` | Mints staff access codes (needs `LOOP_ADMIN_KEY`) |
| `middleware.js` | Vercel Edge Middleware: `/builder` and `/team` redirect to `/login` without a valid session |
| `api/` | Serverless functions (CommonJS — do NOT add `"type":"module"` to package.json). **Vercel Hobby deploys at most 12 files here; a 13th makes every deployment fail silently (the site froze on an old build for a day in Sep 2026 because of it).** So `api/` holds exactly 8 functions: `chat.js`, `presence.js`, `push.js`, `realtime.js`, `import.js`, and three dispatchers built with `lib/api/_dispatch.js`: `auth.js` (login, me, logout, verify, generate), `lead.js` (public form endpoint by default, `?fn=admin` = the staff list/status handler) and `site.js` (publish, preview, ai, upload). The real handlers live in `lib/api/<name>.js` and `vercel.json` rewrites keep the public URLs (`/api/login` → `/api/auth?fn=login`, `/api/leads` → `/api/lead?fn=admin`, `/api/publish` → `/api/site?fn=publish`, `/p/:slug/:key` → `/api/site?fn=preview&s=&k=`; Vercel merges the original query string in). A new endpoint = a handler in `lib/api/` plus an entry in a dispatcher and a rewrite, never a new file in `api/`; `tests/run.js` fails when `api/` exceeds 12 files. The harness applies the same rewrites, so tests hit the dispatchers exactly as production does. |
| `loop-projects/` | Builder project files (`blinkloop.loop.json`) + a builder-generated homepage |
| `og.png`, `robots.txt`, `sitemap.xml` | SEO assets. Add every new public page to the sitemap. |
| `assets/` | Brand files cut from the Illustrator lockup "BlinkLoop with eye.ai" (Sep 11, 2026) by `node tests/make-brand.js <file.ai>`: `blinkloop-icon.png` (272x210, the eye mark with its loop tail, maroon pupil, also the favicon) and `blinkloop-icon-dark.png` (same mark for the dark theme: the maroon square and loop tail are brightened to #A62B32 so the mark does not vanish against the dark page, the pupil keeps its maroon; the founder tried a black pupil and rejected it, keep the pupil maroon in both themes. Every header shows the light icon via `.bi-light`/`.bicon.wl` and the dark one via `.bi-dark`/`.bicon.wd`; the generator finds the pupil disc as a connected component and leaves it alone), PWA icons `icon-192/512/180.png` (mark on transparent), `icon-512-maskable.png` (cream #FFF7EF ground, mark in the safe zone), `badge-96.png` (white silhouette), wordmarks `blinkloop-wordmark-transparent.png` (962x305, light theme) and `blinkloop-wordmark-dark.png` (maroon and black recoloured to cream #FAF4EA for dark theme) plus their 240px WebP twins, `blinkloop-logo-full.png` (stacked lockup, source only) and `og.png` (1200x630, composed in canvas with the site fonts). Every page shows icon + wordmark (`.brand-icon`/`.brand-word` with `.bw-light/.bw-dark` pictures on index/hosting/work; `.bicon` + `.bword.wl/.wd` on builder, team, login, admin and the legal.css pages). Rerun the script when the logo changes; it needs Chrome, internet for the pdf.js CDN, and an .ai saved with PDF compatibility. **The hero orbit (`hero-core-328.webp` + PNG, the orbit SVG, chips and pupil tracking) is deliberately left as is: the founder asked for the animation never to be touched.** Hero eye sized 2x its 164px display, partner chips and 1200px portfolio shots (WebP + JPEG) in `assets/work/`. Every raster image is a `<picture>` with a WebP source. Reference by path; never inline images as base64. Assets cache one week, fonts one year (`vercel.json`). |
| `blinkloop-form.gs` | Google Apps Script that receives the contact form and emails info@ (lives in Google, copy here) |

`vercel.json` has `cleanUrls: true` — pages are reachable without `.html`. Never create a folder with the
same name as a page (e.g. `work/` next to `work.html`); it confuses routing. Use `assets/…`.

## Auth model (stateless, no database)

- Access codes: `LOOP-<NAME>-<YYYYMMDD>-<SIG8>`; SIG8 = HMAC-SHA256(`NAME|YYYYMMDD`, `LOOP_SECRET`),
  Crockford base32, first 8 chars. Expire end of that day, Asia/Manila. Code = credential.
- `/api/login` verifies a code and sets cookies `bl_session` (HttpOnly, the credential) and `bl_staff=1`
  (readable UI hint: site nav shows Builder/Team links + green presence pill when present).
- `/api/me`, `/api/logout`, `/api/verify`, `/api/generate` (admin-key gated), `/api/upload` (builder images → Vercel Blob).
- `/api/import` (session-gated, POST `{url, mode}`, `maxDuration` 60s in vercel.json). **Pages are loaded in headless Chromium first** (`loadPage` -> `renderPage`: `puppeteer-core`, on Vercel `@sparticuz/chromium` via dynamic `import()` because the package is ESM-only, locally an installed Chrome/Edge or `CHROME_PATH`; fonts/media requests are blocked, images load so lazy loaders reveal real sources, the page is auto-scrolled, then before the DOM is serialized: script-inserted rules are written back into their `<style>` tags using the authored text recorded by `RECORD_RULES` (an `evaluateOnNewDocument` patch of insertRule/deleteRule/replace; reading them via cssText loses `font: var(--token)` shorthands as empty longhands, which is what made Nike's design-system typography vanish), with `ruleText` rebuilding var() shorthands as the fallback, adoptedStyleSheets appended as a style tag and open shadow roots flattened; body scroll locks (position:fixed, no-scroll classes, aria-hidden-by-dialog) are undone so the copy is not pinned to one screen; `currentSrc` pinned (or the largest `<picture>`/srcset candidate when nothing loaded), script-set background images copied inline, fixed pop-ups/dialogs/backdrops removed, images a script would reveal on load forced visible (`data-force-visible`, and any `data-image-loaded-class` applied), "--padding-top: NaN%" aspect boxes re-sized from the picture inside, and streaming players (video.js / HLS blobs) given their poster image; video file URLs the page requested (`mediaUrls`) are remembered and assigned to blob videos in order, poster-only otherwise. Tracking pixels (0x0 images, ad/analytics hosts) are dropped in `cleanBody`. `rehostFonts` copies every `@font-face` file into Blob (`sites/<CLIENT>/imported/fonts/`) at import time when `BLOB_READ_WRITE_TOKEN` exists, because most hosts refuse cross-origin font requests; without the token the original URLs stay. A comparison harness lives in the scratchpad (`compare.js`: original vs copy in the same Chrome, heights, fonts, headings, words). Every stylesheet response the browser received is captured (`cssMap`) and reused instead of refetched, since CDNs like Akamai refuse non-browser fetches; all server fetches use a browser UA anyway). When rendering fails, exact/links/site requests answer `{ok:false, reason:'no-browser', detail}` (the builder shows the detail) unless the request carries `allowRaw:true` (a switch in the import modal, off by default); blocks mode always falls back to raw HTML. `IMPORT_NO_RENDER=1` forces the raw path everywhere. vercel.json has `includeFiles: node_modules/@sparticuz/chromium/bin/**` so the Chromium brotli archives ship with the function (nft cannot trace their `__dirname` reads). `scopeCSS` drops `@media (prefers-color-scheme: dark)` blocks and makes light-only blocks unconditional, and `iframe.frame{color-scheme:light}` keeps the editor's dark theme from switching a copied site into its dark mode. Each whole-site page is its own request, so a rendered page (10 to 20s) always fits the limit; the response size stays under Vercel's 4.5MB cap because stylesheets already sent are omitted (`have`). `mode:'exact'` returns the page as-is: every
  stylesheet fetched (14 files / 1.6MB cap, Google Fonts kept as @import), `url()`s absolutized, rem converted to px when the site sets
  `html{font-size}`, every selector prefixed with `#imp-xxxxxx` (html/:root/body become the wrapper, which also carries the body classes),
  scripts/iframes (except YouTube/Vimeo/Maps) and on* attributes removed, lazy `data-src` promoted, animation-library "invisible" classes
  forced visible. `action:'asset'` copies one remote image into Blob under `sites/<CLIENT>/imported/`. Default mode ("Rebuild as blocks") first runs `lib/analyze.js` inside the rendered page (`loadPage(..., {analyze:true})`): it finds sections by geometry (descend through wrappers until several tall stacked children; marked sections and own backgrounds stay whole; a heading row above one big child makes the wrapper the section), card grids by alignment (3+ similar siblings, or 2 side-by-side picture panels), the heading as the largest real heading tag, buttons by their look, eyebrow/subtitle, images, backgrounds, quotes, details/FAQ, videos with their poster, the header (logo as URL or inline SVG data URL), footer links, contact and socials, plus the theme (page bg/ink, accent from button backgrounds or gradient stops or link colour, black for monochrome sites, heading/body font families, Google Fonts links, button radius). `buildFromOutline` in api/import.js maps that outline to blocks (product shelves become galleries, numbered cards become steps, two picture panels a 2-col features block, promo strips a banner, footer link columns are skipped) and returns theme {accent, accent2, bg, ink, font, fontCustom, btn, radius}; the builder applies all of it (`theme.font='custom'` + `theme.fontCustom` {name, disp, body, url} when the site's fonts are Google fonts, read through `fontOf(t)`; the Design tab lists it as "Imported: …"). Without an outline (raw path) it falls back to the markup heuristics: it reads the first four stylesheets (`themeFromCSS`: brand colour from --primary/--accent style variables, then button backgrounds, then the most repeated saturated mid-tone; heading font-family mapped onto our pairings via `FONT_MAP`) and maps the page to builder
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

## Contact form and leads

Every contact form posts JSON to `/api/lead` (`FORM_ENDPOINT` in `index.html`, `hosting.html`, `work.html`; published builder
sites post to `https://www.blinkloop-ph.com/api/lead?site=<slug>`, CORS is open for POST). `api/lead.js` validates (name, email,
message, consent; honeypot `website` returns ok and drops), rate-limits per IP, stores the lead in Supabase `leads`
(`supabase/leads.sql`, run once) and forwards the same payload to the Google Apps Script that emails info@ (`APPS_SCRIPT_URL`
env, defaults to the known deployment; the harness sets it to `off`). Either half may fail without failing the visitor.
`api/leads.js` (staff session) lists and updates status (new | contacted | quoted | won | lost); `admin.html` shows the list
under the code generator. Shared helpers: `lib/db.js` (PostgREST fetch), `lib/session.js` (code check, body parsing).
Analytics: `window.BL_ANALYTICS = { ga4, plausible }`; a Plausible domain loads cookieless with no banner (cookies.html has a
paragraph for it), GA4 still asks first.

## Publishing from the builder (Vercel API)

`api/publish.js` (session-gated, POST `{slug, pages:[{file, html}], customDomain?}`) puts a builder site online at
`<slug>.blinkloop-ph.com`: one Vercel project per site named `bl-site-<slug>` (created on first publish), a production
deployment of the exported HTML files plus a generated vercel.json (cleanUrls), and the subdomain attached to the project.
Env: `VERCEL_TOKEN` (token with project + deployment scope), optional `VERCEL_TEAM_ID` when the token belongs to a team,
optional `PUBLISH_DOMAIN` (default blinkloop-ph.com). DNS once: wildcard CNAME `*.blinkloop-ph.com -> cname.vercel-dns.com`.
Without the token the endpoint answers `{ok:false, reason:'no-token'}` and the builder says publishing is not switched on.
Slugs are 2 to 40 chars `[a-z0-9-]`, a reserved list blocks www/api/admin/etc. An optional own domain is attached too and the
response carries the DNS record the client must set. The builder side lives in the export modal (`#pubBox`, `publishSite()`):
slug prefilled from the title, an "all pages in this folder" switch when the draft belongs to an imported site
(`folderPages()` gathers TEMP pages and saved drafts sharing `siteRefOf`, which now also reads `meta.site`; blocks-mode
whole-site imports set it), the result link kept in `meta.publish` {slug,url,at}. Before publishing, every Contact block with an
empty action is pointed at `https://www.blinkloop-ph.com/api/lead?site=<slug>`; a Contact block whose action contains /api/lead
renders with a consent checkbox, a honeypot and `data-lead`, and `exportHTML()` appends a small script (`leadJS`) that submits
the form as JSON via fetch and shows an inline thank-you, so published client sites feed the Leads panel in Admin with no
mail setup. Other actions keep the plain HTML form (mailto GET or a custom POST endpoint).

## Block customisation and AI copy help (builder)

- Every section's **Section** group in the inspector also has a background colour, a text colour (field type `color`:
  native picker + hex text + clear; blank means the theme) and a "Custom CSS for this section only" textarea. `decorate()`
  writes them as `--sbg`/`--sink` variables with classes `has-bg-c`/`has-ink-c`, which also redefine `--muted/--line/--card`
  so cards inside adapt; `customCSS()` nests each block's CSS under its section id (`sectionId()`: the anchor, the default
  anchor for the type, or a generated `s-<blockId>` when the block has CSS but no anchor) using native CSS nesting, in both
  the canvas and the export. It cannot leak into other sections.
- Hero: background video (`bgVideo`, an https .mp4/.webm link, rendered as a muted looping `<video class="hero-vid">` with the
  background photo as poster) and an overlay colour (`overlay`, hex) whose strength is `bgDim`; CSS variables `--hov`/`--hdim`
  drive `--hovc`. Navbar: bar style (glass / solid / transparent until scrolled, the last one gets a `scrolled` class from
  `navJS` in the export), logo size (sm/md/lg), "stays on top" toggle (`stayTop:false` = `nv-static`). Footer: optional link
  columns (`groups`: title + "Label | href" lines) replace the single link row. Testimonials: photo (`img`) and `stars` (1 to 5).
  Gallery: `lightbox` (default on) marks figures with pictures `data-lb`; the export gets `lbJS`, a dependency-free full-screen
  viewer (Escape or click closes). New blocks: **Menu** (dishes/services with dotted price leaders, tags, 1 or 2 columns),
  **Embed** (an https address, YouTube/Vimeo converted with `parseVideo`, or pasted embed code from which only the iframe's
  src and allow attributes are kept, so scripts never get in), **Divider** (line / accent / dots / wave).
- **✨ AI** button on copy fields (`labelHTML()`; skipped for URLs, colours, prices, code and the like via `AI_SKIP`): a menu of
  tasks (improve, shorten, expand, punchy, fix, translate to the page language) posts to `api/ai.js`, which calls the Anthropic
  Messages API (`ANTHROPIC_API_KEY`, model from `AI_MODEL`, default claude-sonnet-5; 60 rewrites per staff member per hour) with a
  system prompt that forbids preambles, invented facts and em dashes. The result replaces the field value (undoable). Without the
  key the toast tells the founder to add `ANTHROPIC_API_KEY` in Vercel.

## Small things worth knowing (public site and builder)

- Pricing page section `#process` ("What happens after you say yes"): four steps and a "How you pay" box naming GCash, Maya and
  bank transfer, exactly as `terms.html` §4 does. It deliberately states no deposit percentage, timeline or revision count:
  those live in the client's quote. Keep it in step with the Terms if payment methods change.
- Importer consent: the import modal has a required checkbox ("I own this website, or the owner has given me permission").
  The builder sends `consent:true` with every /api/import call (single page, links, whole-site pages); the server refuses
  without it (`reason:'consent'`) and logs one JSON line per import (`{event:'import', client, url, mode, ts}`) to the
  Vercel function logs, so a takedown request can be answered with who imported what and when. Asset copies are not logged.
- Private preview links: `api/preview.js` stores an exported page in Blob (`previews/<slug>/<key>.html`, 12 hex chars) and
  serves it at `/p/<slug>/<key>` (vercel.json rewrite to `/api/preview?s=&k=`) with `X-Robots-Tag: noindex`. The export
  modal's "Private preview link" button posts `exportHTML()` under the publish slug, shows the link with a copy button and
  keeps it in `meta.previews`. Each click makes a new snapshot; old ones stay until deleted in the Blob dashboard. Needs
  `BLOB_READ_WRITE_TOKEN` (reason `no-blob-store` otherwise). Staff codes are not for clients: send them a preview link,
  or publish the site.

## Looks and motion (builder output)

The founder wants client sites to carry the same creativity as blinkloop-ph.com, so the exported design language is
switchable in the Design tab (theme keys `look` and `motion`, written as body classes by `bodyClass(t)` in blocks.js on
both the canvas and the export; new drafts default to `look:'studio', motion:'on'`, and old drafts without the keys get the
same defaults).
- **Studio** (the BlinkLoop feel): glass cards (`--glass`, backdrop blur) with a radial accent glow in the top-right corner,
  hover lift via `translate` (never `transform`, which the reveal owns), gradient buttons with a shine sweep on hover, an
  eyebrow pill with a pulsing accent dot, gradient-text accent word in the hero, two blurred drifting orbs behind the hero
  (`.orb`, hidden when the hero has a photo or video), hover underline on nav links, faint big numerals on Steps
  (`counter(step)`), gradient stat values, dashed spinning rings in the CTA band (`.ring`), a fixed film grain
  (`.look-studio::after`, SVG turbulence at 3.5%) and a thin scroll progress bar. **Bold**: 800-weight tighter type, 2px
  ink outlines with hard offset shadows on cards, buttons and pictures, square-ish eyebrow. **Clean**: the previous flat look.
  Dark-variant sections have their own glass/outline rules (`.look-studio .vt-dark …`, `.look-bold .vt-dark …`).
- **Motion** lives in `motionJS` (exportHTML, only when `motion !== 'off'`) so a page without JS shows everything at once:
  it adds `.reveal` to section heads, cards, grid children and so on with a stagger delay per sibling, an
  IntersectionObserver adds `.in` (blur + 34px rise, .95s); `.hero h1`, `.sec-head h2`, `.ctaband h2` and split headings are
  split into masked words (`.split .w > .wi`) that rise in sequence, keeping `<em>` and `<br>`; `[data-count]` stat values
  count up from 0 (commas and decimals preserved); the Studio look gets the `.progress` bar. Imported `html` blocks
  (`.imp-root`) are skipped. Everything is off under `prefers-reduced-motion`. The canvas never runs motionJS (editing
  would fight the word spans), so motion is judged in Preview or on the live site; the Design tab says so.
- Extras that came with it: hero `badges` (comma separated, up to 4 floating pills over the picture, bobbing when motion is
  on), Partner logos `scroll` toggle (a `.marquee` with the row duplicated, masked edges, pauses on hover).

## Conventions (the founder cares about these)

- **No em dashes anywhere in copy.** Use commas, periods, or colons.
- Voice: short, declarative, specific. "Pay once, own it." Avoid AI-sounding filler.
- Mobile first: every layout change must be checked at 320px, 390px, ~880px, 1024px and 1366px. The nav collapses
  into a scrollable pill strip (no hamburger) at 1180px and below, so the desktop row never has to squeeze the
  staff links and presence pill. Footer is a grid: brand and address on row one, policy links on row two,
  stacked on phones. The chat header compacts at 900px and again at 640px. The builder chrome never overflows: the app grid uses minmax(0,1fr) columns, tool buttons drop their labels at 1400px, the save text and export label at 1240px, the device switcher at 1060px, and at 880px and below the editor shows one pane at a time (Blocks / Page / Edit) from a bottom bar, with a ✎ button in the canvas block toolbar that opens the inspector. Above 880px both side panels collapse: slim edge tabs on the canvas (`#toggleLeft`/`#toggleRight`, Ctrl+[ and Ctrl+) toggle `body.hide-left/.hide-right`, which zero the `--lw/--rw` grid variables; the choice persists in `lb-panels`; while the right panel is hidden the canvas body carries `r-hidden` so each block toolbar shows the ✎ button, which reopens the panel for that block. Never let a decorative element be wider than the
  viewport (mobile browsers zoom the whole page out to fit it): `html{overflow-x:hidden}` +
  `body{overflow-x:clip}` are the safety net, but fix the element too.
- Inputs on mobile: `font-size:16px` (prevents iOS zoom). Hover-only controls must also be visible on touch.
- Dark theme exists on every public page (`data-theme="dark"` on `<html>`). Check both. Every page sets `color-scheme` (light on `:root`, dark under `[data-theme="dark"]`) so native controls (select dropdowns, scrollbars, date pickers) follow the theme instead of showing light text on a white popup.
- Keep internal pages `noindex`; keep `/builder`, `/team`, `/admin`, `/login`, `/api/` out of the sitemap.
- Real projects, real logos, real quotes only. Never fabricate clients, testimonials, or numbers.
- Prefer editing in place with small, verifiable changes. Founder wants to review diffs in GitHub Desktop.

## Testing

`npm test` runs `tests/run.js`: an end-to-end suite on plain `puppeteer-core` driving the Chrome or Edge already on the
machine (`tests/chrome.js`, or `CHROME_PATH`), against `tests/harness.js`, a local server that serves the repo, mounts the
real `api/*.js` handlers, emulates the middleware redirect, Supabase PostgREST and Realtime Broadcast in memory, mints staff
codes with the test secret, and hosts a WordPress-like sample site (`tests/fixtures/sample-wp.html`, `/__sample-wp` plus
`/menus/` etc.) for the importer. Nothing reaches the internet: outside requests are aborted in the browser, Apps Script
forwarding is off, and VERCEL_TOKEN / ANTHROPIC_API_KEY / BLOB token are unset so the fallbacks are what gets tested.
About 26 checks in 40s: every public page (SEO tags, one h1, skip link, JSON-LD parses, no em dashes, no script errors, no
sideways scroll at 320/390/880/1366, dark theme), internal pages noindex and out of the sitemap, the homepage form storing a
lead, auth (middleware redirect, bad/expired codes, login, /api/me, logout, admin minting), the builder (library, adding
blocks, inspector, export contents, publish and AI fallbacks, slug validation, chrome overflow at five widths), the importer
(sample site to blocks with theme; links mode; SSRF refusals), chat (post, reply, pin, react, feed, realtime ping, /team on a
phone), leads API and admin panel, presence/realtime config. `node tests/run.js builder` runs only matching tests;
`npm run harness` starts the harness alone on :3457 and prints a code for manual testing (`HARNESS_PORT` changes the port).
The browser keeps cookies between tests, so a test that needs a signed-out state calls /api/logout first. Add a test with
every feature; keep tests hermetic (mock hosts, never real emails or tokens). `tests/` is in `.vercelignore`.

## Known limits / open items

- Partner chips in the hero are cropped from screenshots; replace with real logo files when available.
- Search reads the most recent messages (fine at team scale); add an index/RPC if the chat grows large.
- Free Supabase projects pause after ~7 days of inactivity; daily use prevents it.
- PayMongo auto-payments (client pays → code auto-minted) was designed but not built; waits on a business account.
- Possible next pages: industry landing pages ("Websites for catering businesses in Cebu"), built with Loop Builder.
