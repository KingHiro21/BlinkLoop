// End-to-end suite: `npm test`. Starts tests/harness.js in-process, drives a local Chrome with puppeteer-core, and
// checks the public site, auth, builder, importer, chat, leads and publish/AI fallbacks. No network, no real emails.
//   node tests/run.js            everything
//   node tests/run.js builder    only tests whose name contains "builder"
const harness = require('./harness');
const findChrome = require('./chrome');

const BASE = harness.base;
const only = (process.argv[2] || '').toLowerCase();
const results = []; let browser;
const PUBLIC = ['/', '/hosting', '/work', '/case-hwasung', '/case-core-migration', '/privacy', '/terms', '/cookies', '/refunds'];
const INTERNAL = ['/login', '/admin', '/builder', '/team'];

function assert(cond, msg){ if (!cond) throw new Error(msg || 'assertion failed'); }
async function test(name, fn){
  if (only && !name.toLowerCase().includes(only)) return;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ok   ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, err: e }); console.log(`  FAIL ${name}\n       ${String(e && e.stack || e).split('\n').slice(0, 3).join('\n       ')}`); }
}
async function newPage(opts = {}){
  const page = await browser.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR|404|Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.setRequestInterception(true); // hermetic: Google Fonts, analytics and any other outside host are refused
  page.on('request', q => { const u = q.url(); if (/^(data|blob|about):/.test(u) || u.startsWith(BASE)) q.continue(); else q.abort(); });
  if (opts.width) await page.setViewport({ width: opts.width, height: opts.height || 800, deviceScaleFactor: 1, isMobile: opts.width < 768, hasTouch: opts.width < 768 });
  else await page.setViewport({ width: 1366, height: 850 });
  return page;
}
async function login(page, name = 'TEST'){
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(async code => (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json(), harness.mintCode(name));
  assert(r.ok, 'login failed: ' + JSON.stringify(r));
  return r;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const exe = findChrome();
  if (!exe){ console.error('No Chrome or Edge found. Install one or set CHROME_PATH.'); process.exit(2); }
  await harness.start();
  const pmod = await import('puppeteer-core'); const puppeteer = pmod.default || pmod;
  browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--lang=en-US'] });
  console.log(`harness ${BASE}, chrome ${exe}\n`);

  /* ---------------- public site ---------------- */
  for (const p of PUBLIC) await test(`public ${p} loads with SEO tags and no script errors`, async () => {
    const page = await newPage();
    const res = await page.goto(BASE + p, { waitUntil: 'load' });
    assert(res.status() === 200, 'status ' + res.status());
    const seo = await page.evaluate(() => ({
      title: document.title, desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '', robots: (document.querySelector('meta[name="robots"]') || {}).content || '',
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { JSON.parse(s.textContent); return true; } catch { return false; } }),
      h1: document.querySelectorAll('h1').length, skip: !!document.querySelector('a[href="#main"], .skip, .skip-link'), lang: document.documentElement.lang,
      emDash: (document.body.innerText.match(/—/g) || []).length,
      brand: !!document.querySelector('header img[src^="/assets/blinkloop-icon.png"], .brand img[src^="/assets/blinkloop-icon.png"]'), favicon: ((document.querySelector('link[rel="icon"]') || {}).href || '').includes('/assets/blinkloop-icon.png')
    }));
    assert(seo.brand && seo.favicon, 'brand icon or favicon missing');
    assert(seo.title.length > 10 && seo.desc.length > 40, 'title/description missing');
    assert(seo.canonical.startsWith('https://www.blinkloop-ph.com/'), 'canonical ' + seo.canonical);
    assert(/index/.test(seo.robots), 'robots ' + seo.robots);
    assert(seo.ld.every(Boolean), 'JSON-LD does not parse');
    assert(seo.h1 === 1, 'h1 count ' + seo.h1);
    assert(seo.skip, 'no skip link'); assert(seo.lang, 'no lang');
    assert(seo.emDash === 0, seo.emDash + ' em dashes in copy');
    assert(!page.errors.length, 'script errors: ' + page.errors.join(' | '));
    await page.close();
  });

  await test('public pages never scroll sideways at 320, 390, 880 and 1366', async () => {
    for (const w of [320, 390, 880, 1366]) for (const p of ['/', '/hosting', '/work']){
      const page = await newPage({ width: w, height: 800 });
      await page.goto(BASE + p, { waitUntil: 'load' }); await sleep(300);
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert(sw[0] <= sw[1] + 1, `${p} at ${w}px: scrollWidth ${sw[0]} > ${sw[1]}`);
      await page.close();
    }
  });

  await test('the header never touches the screen edge on phones and tablets', async () => {
    // the header bar is <div class="wrap nav">, so a padding shorthand on .nav once wiped .wrap's side gutters
    // and the logo sat flush against the left edge from 1180px down. Guard the gutter on every public page.
    for (const p of ['/', '/hosting', '/work']) for (const w of [320, 390, 768, 820, 1024, 1180]){
      const page = await newPage({ width: w, height: 700 });
      await page.goto(BASE + p, { waitUntil: 'load' });
      const m = await page.evaluate(() => {
        const icon = [...document.querySelectorAll('.nav .brand-icon')].find(i => getComputedStyle(i).display !== 'none');
        const box = el => { const b = el.getBoundingClientRect(); return { l: +b.left.toFixed(1), r: +b.right.toFixed(1) }; };
        return { gutter: parseFloat(getComputedStyle(document.querySelector('header .wrap')).paddingLeft),
          icon: icon ? box(icon) : null, links: box(document.querySelector('.nav-links')), acts: box(document.querySelector('.nav-actions')), vw: innerWidth };
      });
      assert(m.icon, `${p} at ${w}px: no visible brand icon`);
      assert(m.gutter >= 12, `${p} at ${w}px: header gutter is ${m.gutter}px`);
      assert(m.icon.l >= m.gutter - 0.6, `${p} at ${w}px: logo at ${m.icon.l} is inside the ${m.gutter}px gutter`);
      assert(m.links.r <= m.vw - m.gutter + 0.6, `${p} at ${w}px: pill strip reaches ${m.links.r} of ${m.vw}`);
      assert(m.acts.r <= m.vw - m.gutter + 0.6, `${p} at ${w}px: header actions reach ${m.acts.r} of ${m.vw}`);
      await page.close();
    }
  });

  await test('dark theme renders on the homepage', async () => {
    const page = await newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const bg = await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); return getComputedStyle(document.body).backgroundColor; });
    const m = bg.match(/\d+/g).map(Number); assert(m[0] + m[1] + m[2] < 200, 'dark body background is ' + bg);
    await page.close();
  });

  await test('internal pages are noindex and out of the sitemap; public pages are in it', async () => {
    const page = await newPage();
    for (const p of ['/login', '/admin']){ await page.goto(BASE + p, { waitUntil: 'domcontentloaded' }); const r = await page.evaluate(() => (document.querySelector('meta[name="robots"]') || {}).content || ''); assert(/noindex/.test(r), p + ' robots=' + r); }
    await page.goto(BASE + '/sitemap.xml'); const xml = await page.evaluate(() => document.documentElement.outerHTML + document.body.textContent);
    for (const p of INTERNAL) assert(!xml.includes('blinkloop-ph.com' + p + '<') && !xml.includes('blinkloop-ph.com' + p + '/<'), p + ' is in the sitemap');
    for (const p of ['/hosting', '/work', '/case-hwasung', '/case-core-migration', '/privacy', '/terms']) assert(xml.includes('blinkloop-ph.com' + p), p + ' missing from sitemap');
    await page.goto(BASE + '/robots.txt'); const rob = await page.evaluate(() => document.body.textContent);
    assert(/Sitemap:/.test(rob), 'robots.txt has no Sitemap line');
    await page.close();
  });

  await test('homepage contact form validates, needs consent, then stores a lead', async () => {
    const page = await newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const r = await page.evaluate(async () => {
      const f = document.getElementById('cform'); if (!f) return { noForm: true };
      const set = (n, v) => { const el = f.querySelector(`[name="${n}"]`); if (el){ if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } return !!el; };
      set('name', 'Test Person'); set('email', 'test@example.com'); set('message', 'Hello from the test suite, this is a message.');
      const hadConsent = set('consent', true);
      const service = f.querySelector('select[name="service"], [name="service"]'); if (service && service.tagName === 'SELECT' && service.options.length > 1) service.selectedIndex = 1;
      f.requestSubmit(); await new Promise(r => setTimeout(r, 1500));
      const st = await (await fetch('/__stats')).json();
      return { hadConsent, leads: st.rows.leads, text: (f.textContent || '').slice(0, 200) };
    });
    assert(!r.noForm, 'no #cform on the homepage'); assert(r.hadConsent, 'consent checkbox missing');
    assert(r.leads >= 1, 'lead was not stored: ' + JSON.stringify(r));
    await page.close();
  });

  await test('deploy: api/ has at most 12 serverless functions (Vercel Hobby limit) and every rewritten route answers', async () => {
    const files = require('fs').readdirSync(require('path').join(__dirname, '..', 'api')).filter(f => f.endsWith('.js'));
    assert(files.length <= 12, files.length + ' functions in api/: ' + files.join(', '));
    const page = await newPage();
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => { const out = {}; for (const p of ['/api/login', '/api/me', '/api/logout', '/api/verify', '/api/generate', '/api/lead', '/api/leads', '/api/publish', '/api/ai', '/api/upload', '/api/chat', '/api/presence', '/api/push', '/api/realtime', '/api/import']) out[p] = (await fetch(p)).status; return out; });
    for (const [p, st] of Object.entries(r)) assert(st !== 404 && st < 500, p + ' answered ' + st);
    await page.close();
  });

  /* ---------------- auth ---------------- */
  await test('auth: middleware redirects /builder and /team to /login without a session', async () => {
    const page = await newPage();
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }); await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
    for (const p of ['/builder', '/team']){ await page.goto(BASE + p, { waitUntil: 'domcontentloaded' }); assert(page.url().includes('/login'), p + ' served without session: ' + page.url()); }
    await page.close();
  });
  await test('auth: a bad code is refused, a minted code signs in, /api/me knows the name, logout clears it', async () => {
    const page = await newPage();
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    const bad = await page.evaluate(async () => (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'LOOP-NOPE-20990101-AAAAAAAA' }) })).json());
    assert(!bad.ok, 'bad code accepted');
    const r = await login(page, 'QA'); assert(r.client === 'QA', 'client ' + r.client);
    const me = await page.evaluate(async () => (await fetch('/api/me')).json()); assert(me.ok && me.client === 'QA', 'me ' + JSON.stringify(me));
    await page.goto(BASE + '/builder', { waitUntil: 'domcontentloaded' }); assert(page.url().endsWith('/builder'), 'builder not served after login');
    await page.evaluate(async () => (await fetch('/api/logout', { method: 'POST' })).text());
    const me2 = await page.evaluate(async () => (await fetch('/api/me')).json()); assert(!me2.ok, 'still signed in after logout');
    await page.close();
  });
  await test('auth: expired codes fail, admin key mints a code that verifies', async () => {
    const page = await newPage();
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    const old = harness.mintCode('OLD', '20200101');
    const r = await page.evaluate(async code => (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json(), old);
    assert(!r.ok, 'expired code accepted');
    if (harness.stats && require('fs').existsSync(require('path').join(__dirname, '..', 'api', 'generate.js'))){
      const g = await page.evaluate(async () => { const r = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify({ adminKey: 'test-admin', client: 'MINT', expires: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }) }); return { status: r.status, body: await r.text() }; });
      if (g.status === 200){ const j = JSON.parse(g.body); const code = j.code || (j.codes && j.codes[0] && j.codes[0].code); if (code){ const v = await page.evaluate(async code => (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json(), code); assert(v.ok, 'minted code did not verify'); } }
    }
    await page.close();
  });

  /* ---------------- builder ---------------- */
  await test('builder: loads signed in, library lists every block, adding a block renders it and the inspector', async () => {
    const page = await newPage();
    await login(page);
    await page.goto(BASE + '/builder', { waitUntil: 'load' }); await sleep(800);
    const r = await page.evaluate(async () => {
      localStorage.clear();
      const lib = [...document.querySelectorAll('#lib .lib-item')].map(b => b.dataset.type);
      state = freshState(); state.meta.draftId = uid(); state.blocks = []; renderCanvas(); renderLayers();
      addBlock('hero'); addBlock('features'); addBlock('menu'); addBlock('contact');
      let doc; for (let i = 0; i < 30; i++){ await new Promise(r => setTimeout(r, 200)); doc = frame.contentDocument; if (doc && doc.querySelectorAll('.blk').length === 4) break; }
      return { lib, blocks: state.blocks.map(b => b.type), canvas: doc.querySelectorAll('.blk').length, hasHero: !!doc.querySelector('.hero h1'), menu: !!doc.querySelector('.menu-grid'), inspector: !!document.querySelector('#rtab-block .field'), colour: document.querySelectorAll('#rtab-block .cpick').length, ai: document.querySelectorAll('#rtab-block .ai-btn').length };
    });
    assert(r.lib.length >= 25 && r.lib.includes('menu') && r.lib.includes('embed') && r.lib.includes('divider'), 'library: ' + r.lib.join(','));
    assert(r.blocks.length === 4 && r.canvas === 4 && r.hasHero && r.menu, 'canvas ' + JSON.stringify(r));
    assert(r.inspector && r.colour === 2 && r.ai > 0, 'inspector ' + JSON.stringify(r));
    assert(!page.errors.length, 'script errors: ' + page.errors.join(' | '));
    await page.close();
  });
  await test('builder: export is a full standalone page; section colours and custom CSS travel with it', async () => {
    const page = await newPage();
    await login(page);
    await page.goto(BASE + '/builder', { waitUntil: 'load' }); await sleep(800);
    const r = await page.evaluate(() => {
      state = freshState(); state.meta.title = 'QA Site'; state.meta.draftId = uid();
      const mk = (type, extra) => ({ id: uid(), type, props: Object.assign(clone(BLOCKS[type].defaults), extra || {}) });
      state.blocks = [mk('navbar'), mk('hero', { bgImg: 'https://example.com/a.jpg', overlay: '#112233' }), mk('features', { bg: '#0b3d2e', ink: '#ffffff', css: 'h2{letter-spacing:.1em}' }), mk('gallery', { items: [{ img: 'https://example.com/1.jpg', caption: 'One' }] }), mk('contact', { action: 'https://www.blinkloop-ph.com/api/lead?site=qa' }), mk('footer')];
      const html = exportHTML();
      return { len: html.length, doctype: html.startsWith('<!DOCTYPE html>'), look: /<body class="[^"]*look-studio[^"]*motion-on/.test(html) && /\.look-studio \.btn-solid\{/.test(html), motion: /IntersectionObserver/.test(html) && /classList\.add\('reveal'\)/.test(html), title: /<title>QA Site<\/title>/.test(html), css: /#features\{h2\{letter-spacing:\.1em\}\}/.test(html), bg: /--sbg:#0b3d2e/.test(html), overlay: /--hov:#112233/.test(html), lb: /data-lb/.test(html) && /\.gal\[data-lb\]/.test(html), lead: /data-lead/.test(html) && /name="consent"/.test(html) && /form\.cform\[data-lead\]/.test(html), noEditAttrs: !/data-edit=|contenteditable/.test(html), noEmDash: !/—/.test(html) };
    });
    for (const k of ['doctype', 'title', 'css', 'bg', 'overlay', 'lb', 'lead', 'noEditAttrs', 'noEmDash', 'look', 'motion']) assert(r[k], k + ' failed: ' + JSON.stringify(r));
    await page.close();
  });
  await test('builder: publish without VERCEL_TOKEN and AI without ANTHROPIC_API_KEY explain themselves', async () => {
    const page = await newPage();
    await login(page);
    await page.goto(BASE + '/builder', { waitUntil: 'load' }); await sleep(600);
    const r = await page.evaluate(async () => {
      const pub = await (await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'qa-site', pages: [{ file: 'index.html', html: '<!DOCTYPE html><title>x</title>' }] }) })).json();
      const ai = await (await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'improve', text: 'Hello there' }) })).json();
      return { pub, ai };
    });
    assert(r.pub.ok === false && r.pub.reason === 'no-token', 'publish ' + JSON.stringify(r.pub));
    assert(r.ai.ok === false && r.ai.reason === 'no-key', 'ai ' + JSON.stringify(r.ai));
    await page.close();
  });
  await test('builder: /api/publish rejects bad slugs and missing index before touching Vercel', async () => {
    process.env.VERCEL_TOKEN = 'fake-token-for-validation-only';
    try {
      const page = await newPage(); await login(page);
      const r = await page.evaluate(async () => {
        const post = b => fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
        return { bad: await post({ slug: 'www', pages: [{ file: 'index.html', html: 'x' }] }), noIndex: await post({ slug: 'okay-site', pages: [{ file: 'about.html', html: 'x' }] }), short: await post({ slug: 'a', pages: [{ file: 'index.html', html: 'x' }] }) };
      });
      assert(r.bad.reason === 'bad-slug' && r.short.reason === 'bad-slug', 'slug validation ' + JSON.stringify(r));
      assert(r.noIndex.reason === 'no-index', 'index validation ' + JSON.stringify(r));
      await page.close();
    } finally { delete process.env.VERCEL_TOKEN; }
  });
  await test('builder: the editor chrome never overflows at 320, 390, 880, 1024 and 1366', async () => {
    for (const w of [320, 390, 880, 1024, 1366]){
      const page = await newPage({ width: w, height: 800 }); await login(page);
      await page.goto(BASE + '/builder', { waitUntil: 'load' }); await sleep(500);
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert(sw[0] <= sw[1] + 1, `builder at ${w}px: scrollWidth ${sw[0]} > ${sw[1]}`);
      await page.close();
    }
  });

  /* ---------------- importer ---------------- */
  await test('import: the sample WordPress site rebuilds as blocks with nav, hero and footer (needs Chrome, ~20s)', async () => {
    const page = await newPage(); await login(page);
    const r = await page.evaluate(async () => (await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: location.origin + '/__sample-wp', mode: 'blocks', consent: true }) })).json());
    assert(r.ok, 'import failed: ' + JSON.stringify(r).slice(0, 300));
    const pg = r.page || {}; const types = (pg.blocks || []).map(b => b.type);
    assert(types.includes('navbar') && types.includes('hero') && types.includes('footer'), 'blocks: ' + types.join(','));
    assert(types.length >= 5, 'too few blocks: ' + types.join(','));
    assert(pg.theme && /^#[0-9a-f]{6}$/i.test(pg.theme.accent || ''), 'no theme accent: ' + JSON.stringify(pg.theme));
    await page.close();
  });
  await test('import: private and non-http targets are refused, links mode lists the sample pages', async () => {
    const page = await newPage(); await login(page);
    const r = await page.evaluate(async () => {
      const post = b => fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
      return { ftp: await post({ url: 'ftp://example.com/', mode: 'blocks', consent: true }), noConsent: await post({ url: location.origin + '/__sample-wp', mode: 'blocks' }), links: await post({ url: location.origin + '/__sample-wp', mode: 'links', consent: true }) };
    });
    assert(!r.ftp.ok, 'ftp accepted');
    assert(r.noConsent.ok === false && r.noConsent.reason === 'consent', 'import without consent was accepted: ' + JSON.stringify(r.noConsent));
    assert(r.links.ok && Array.isArray(r.links.pages) && r.links.pages.some(p => /menus/.test(p.url)), 'links ' + JSON.stringify(r.links).slice(0, 300));
    await page.close();
  });

  /* ---------------- team chat ---------------- */
  await test('chat: post, thread reply, pin, react, search and realtime ping', async () => {
    const page = await newPage(); await login(page, 'MOANA');
    await page.evaluate(() => fetch('/__reset'));
    const r = await page.evaluate(async () => {
      const post = b => fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
      const a = await post({ action: 'post', text: 'Hello team, kickoff at 3pm @QUEEN' }); const aid = a.message && a.message.id;
      const b = await post({ action: 'post', text: 'On it.', parent: aid });
      const pin = await post({ action: 'pin', id: aid });
      const react = await post({ action: 'react', id: aid, emoji: '👍' });
      const feed = await (await fetch('/api/chat')).json();
      const search = await (await fetch('/api/chat?q=kickoff')).json();
      const stats = await (await fetch('/__stats')).json();
      return { a, b, pin, react, feed, search, stats };
    });
    assert(r.a.ok && r.a.message && r.a.message.id, 'post ' + JSON.stringify(r.a));
    assert(r.b.ok, 'reply ' + JSON.stringify(r.b));
    assert(r.pin.ok && r.pin.pinned, 'pin ' + JSON.stringify(r.pin));
    assert(r.react.ok, 'react ' + JSON.stringify(r.react));
    const msgs = r.feed.messages || r.feed.items || [];
    assert(msgs.some(m => /kickoff/.test(m.text)), 'feed lacks the post: ' + JSON.stringify(r.feed).slice(0, 200));
    assert(r.stats.broadcasts.length >= 1, 'no realtime broadcast recorded');
    if (r.search && (r.search.results || r.search.messages)) assert((r.search.results || r.search.messages).length >= 1, 'search found nothing');
    await page.close();
  });
  await test('chat: /team page renders the feed and never overflows on a phone', async () => {
    const page = await newPage({ width: 390, height: 800 }); await login(page, 'MOANA');
    await page.goto(BASE + '/team', { waitUntil: 'load' }); await sleep(1500);
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, hasFeed: !!document.querySelector('#feed, .feed, [data-feed]'), text: document.body.innerText.slice(0, 2000) }));
    assert(r.sw <= r.iw + 1, 'team overflow ' + r.sw + ' > ' + r.iw);
    assert(/kickoff/.test(r.text), 'feed did not show the posted message');
    assert(!page.errors.length, 'script errors: ' + page.errors.join(' | '));
    await page.close();
  });

  /* ---------------- leads ---------------- */
  await test('leads: /api/lead validates, honours consent and the honeypot, stores per site; /api/leads lists and updates', async () => {
    const page = await newPage(); await login(page);
    await page.evaluate(() => fetch('/__reset'));
    const r = await page.evaluate(async () => {
      const post = (q, b) => fetch('/api/lead' + q, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(b) }).then(r => r.json());
      const good = { name: 'Ana Cruz', email: 'ana@example.com', message: 'I need a website for my cafe.', consent: 'yes', consentAt: new Date().toISOString(), page: 'https://qa-site.blinkloop-ph.com/' };
      const invalid = await post('?site=qa-site', { ...good, email: 'nope' });
      const noConsent = await post('?site=qa-site', { ...good, consent: '' });
      const bot = await post('?site=qa-site', { ...good, website: 'http://spam' });
      const ok = await post('?site=qa-site', good);
      const ok2 = await post('', { ...good, name: 'Ben Reyes' });
      const list = await (await fetch('/api/leads?site=qa-site')).json();
      const all = await (await fetch('/api/leads')).json();
      const id = list.leads[0].id;
      const upd = await (await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'contacted' }) })).json();
      const after = await (await fetch('/api/leads?site=qa-site')).json();
      return { invalid, noConsent, bot, ok, ok2, list, all, upd, after };
    });
    assert(r.invalid.reason === 'invalid' && r.noConsent.reason === 'consent', 'validation ' + JSON.stringify([r.invalid, r.noConsent]));
    assert(r.bot.ok === true, 'honeypot should answer ok'); assert(r.ok.ok && r.ok.stored, 'store ' + JSON.stringify(r.ok));
    assert(r.list.ok && r.list.leads.length === 1 && r.list.leads[0].site === 'qa-site', 'site filter ' + JSON.stringify(r.list).slice(0, 200));
    assert(r.all.leads.length === 2 && r.all.leads.some(l => l.site === 'blinkloop'), 'default site ' + JSON.stringify(r.all.leads.map(l => l.site)));
    assert(r.upd.ok && r.after.leads[0].status === 'contacted', 'status update ' + JSON.stringify(r.upd));
    await page.close();
  });
  await test('leads: /api/leads needs a session; admin page shows the leads panel', async () => {
    const page = await newPage();
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }); await page.evaluate(() => fetch('/api/logout', { method: 'POST' }).then(r => r.text()));
    const st = await page.evaluate(async () => (await fetch('/api/leads')).status); assert(st === 401, 'leads without session: ' + st);
    await login(page);
    await page.goto(BASE + '/admin', { waitUntil: 'load' }); await sleep(800);
    const r = await page.evaluate(() => ({ card: !!document.getElementById('leadsCard'), rows: document.querySelectorAll('#leadsCard tbody tr').length, text: document.getElementById('leadsCard') ? document.getElementById('leadsCard').innerText : '' }));
    assert(r.card, 'no #leadsCard on admin'); assert(r.rows >= 1 || /Ana|Ben/.test(r.text), 'leads not listed: ' + r.text.slice(0, 200));
    await page.close();
  });

  /* ---------------- preview links ---------------- */
  await test('preview: a signed-in user stores a page and the /p/ link serves it noindex; bad keys 404', async () => {
    const page = await newPage(); await login(page);
    const r = await page.evaluate(async () => {
      const made = await (await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'qa-cafe', html: '<!DOCTYPE html><html><head><title>QA preview</title></head><body><h1>Hello preview</h1></body></html>' }) })).json();
      const got = await fetch(made.url); const html = await got.text();
      const miss = await fetch('/p/qa-cafe/000000000000');
      const badBody = await (await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'qa-cafe', html: 'nope' }) })).json();
      return { made, status: got.status, robots: got.headers.get('x-robots-tag'), html, miss: miss.status, badBody };
    });
    assert(r.made.ok && /^\/p\/qa-cafe\/[a-f0-9]{12}$/.test(r.made.url), 'make ' + JSON.stringify(r.made));
    assert(r.status === 200 && /Hello preview/.test(r.html) && /noindex/.test(r.robots || ''), 'serve ' + JSON.stringify({ status: r.status, robots: r.robots }));
    assert(r.miss === 404, 'unknown key answered ' + r.miss);
    assert(r.badBody.reason === 'no-html', 'bad body ' + JSON.stringify(r.badBody));
    await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
    const anon = await page.evaluate(async () => (await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'x-y', html: '<html></html>' }) })).status);
    assert(anon === 401, 'anonymous preview creation answered ' + anon);
    await page.close();
  });

  /* ---------------- presence / realtime config ---------------- */
  await test('presence and realtime endpoints answer for a signed-in client', async () => {
    const page = await newPage(); await login(page, 'QUEEN');
    const r = await page.evaluate(async () => ({ p: await (await fetch('/api/presence', { method: 'POST' })).json().catch(() => ({})), rt: await (await fetch('/api/realtime')).json(), me: await (await fetch('/api/me')).json() }));
    assert(r.rt.ok && r.rt.key === 'anon-test-key' && r.rt.topic === 'team', 'realtime ' + JSON.stringify(r.rt));
    assert(r.me.ok, 'me');
    await page.close();
  });

  /* ---------------- done ---------------- */
  await browser.close(); await harness.stop();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length){ console.log(failed.map(f => ' - ' + f.name).join('\n')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
