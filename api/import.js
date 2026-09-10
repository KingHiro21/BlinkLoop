// POST /api/import { url } -> { ok, page:{ meta, theme, blocks }, found:[...] }
// Reads a public web page (a WordPress site, a Wix site, anything) and rebuilds it as Loop Builder
// blocks: brand and nav, headline, sections mapped to features / pricing / FAQ / testimonials /
// gallery / text, contact details, footer. Staff session required. Images keep pointing at the
// original site until they are replaced in the builder.
//
// The server fetches an arbitrary URL, so this is locked down: http(s) only, public addresses only
// (DNS result checked against private ranges), 3 redirects max with the same checks, 2.5MB cap,
// 8s timeout, HTML only.
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { parse } = require('node-html-parser');

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(buf, len){ let bits=0,v=0,out=''; for(const x of buf){ v=(v<<8)|x; bits+=8; while(bits>=5){ out+=B32[(v>>>(bits-5))&31]; bits-=5; } } return out.slice(0,len); }
function manilaToday(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()).replace(/-/g,''); }
function sessionClient(req, secret){
  const m = String(req.headers.cookie||'').match(/(?:^|;\s*)bl_session=([^;]+)/);
  if (!m) return null;
  const cm = decodeURIComponent(m[1]).match(/^LOOP-([A-Z0-9]{2,12})-(\d{8})-([0-9A-Z]{8})$/);
  if (!cm) return null;
  const [, client, ymd, sig] = cm;
  const mac = crypto.createHmac('sha256', secret).update(`${client}|${ymd}`).digest();
  const a = Buffer.from(sig), b = Buffer.from(b32(mac,8));
  if (a.length!==b.length || !crypto.timingSafeEqual(a,b) || ymd < manilaToday()) return null;
  return client;
}

/* ---------- safe fetch ---------- */
function privateIp(ip){
  if (net.isIPv4(ip)){
    const [a,b] = ip.split('.').map(Number);
    return a===10 || a===127 || a===0 || (a===172 && b>=16 && b<=31) || (a===192 && b===168) || (a===169 && b===254) || a>=224;
  }
  const v6 = ip.toLowerCase();
  return v6==='::1' || v6==='::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}
async function assertPublic(hostname){
  if (process.env.IMPORT_ALLOW_PRIVATE === '1') return;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(hostname)) throw new Error('private-host');
  if (net.isIP(hostname)){ if (privateIp(hostname)) throw new Error('private-host'); return; }
  const addrs = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('dns');
  if (addrs.some(a => privateIp(a.address))) throw new Error('private-host');
}
const UA = 'Mozilla/5.0 (compatible; LoopBuilderImport/1.0; +https://www.blinkloop-ph.com)';
/* Fetch one public resource with every guard applied. `accept` is a regex the content-type must match. */
async function fetchResource(startUrl, { accept, maxBytes, timeout = 8000, acceptHeader = '*/*' }){
  let url = new URL(startUrl);
  for (let hop = 0; hop < 4; hop++){
    if (!/^https?:$/.test(url.protocol)) throw new Error('bad-url');
    await assertPublic(url.hostname);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeout);
    let r;
    try {
      r = await fetch(url.href, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept': acceptHeader } });
    } finally { clearTimeout(timer); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')){
      url = new URL(r.headers.get('location'), url); continue;
    }
    if (!r.ok) throw new Error('http-' + r.status);
    const type = (r.headers.get('content-type') || '').toLowerCase();
    if (accept && !accept.test(type)) throw new Error('wrong-type');
    const reader = r.body.getReader(); const chunks = []; let total = 0;
    while (true){ const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maxBytes){ reader.cancel(); throw new Error('too-large'); } chunks.push(Buffer.from(value)); }
    return { buf: Buffer.concat(chunks), type, finalUrl: url.href };
  }
  throw new Error('redirects');
}
async function fetchPage(startUrl){
  try {
    const r = await fetchResource(startUrl, { accept: /text\/html|application\/xhtml/, maxBytes: 2.5*1024*1024, acceptHeader: 'text/html,application/xhtml+xml' });
    return { html: r.buf.toString('utf8'), finalUrl: r.finalUrl };
  } catch (e) { if (String(e.message) === 'wrong-type') throw new Error('not-html'); throw e; }
}

/* ---------- extraction helpers ---------- */
const clean = s => String(s||'').replace(/\s+/g,' ').trim();
const cut = (s, n) => { s = clean(s); return s.length > n ? s.slice(0, n-1).trimEnd() + '…' : s; };
const uid = () => 'b' + Math.random().toString(36).slice(2, 9);
function abs(base, u){ try { if (!u) return ''; u = String(u).trim(); if (u.startsWith('data:')) return ''; return new URL(u, base).href; } catch { return ''; } }
function imgSrc(el, base){
  const raw = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('src') || (el.getAttribute('srcset')||el.getAttribute('data-srcset')||'').split(',')[0].trim().split(' ')[0];
  const u = abs(base, raw);
  if (!u || /\.svg(\?|$)/i.test(u) && /logo|icon/i.test(el.getAttribute('class')||'')) return u; // svg logos are fine
  return u;
}
function isDecorativeImg(el){
  const w = parseInt(el.getAttribute('width')||'0',10), h = parseInt(el.getAttribute('height')||'0',10);
  if ((w && w < 60) || (h && h < 60)) return true;
  return /emoji|icon|avatar|spinner|pixel|tracking|gravatar/i.test((el.getAttribute('class')||'') + ' ' + (el.getAttribute('src')||''));
}
const PRICE_RE = /(₱|\$|€|£|PHP|USD)\s?\d[\d,]*(\.\d+)?/;

function textOf(el){ return clean(el.text || el.textContent || ''); }
function directParas(root){
  return root.querySelectorAll('p, li').map(p => textOf(p)).filter(t => t.length >= 25 && !/cookie|javascript/i.test(t)).slice(0, 8);
}

function buildPage(html, pageUrl){
  const doc = parse(html, { blockTextElements: { script: true, style: true, noscript: true, pre: true } });
  doc.querySelectorAll('script, style, noscript, svg, iframe, form, template, aside, [role="complementary"], .sidebar, #sidebar, .widget-area, #secondary, .comments-area, #comments, .screen-reader-text, .sr-only, .visually-hidden, .cookie-banner, #cookie-notice, .skip-link').forEach(n => n.remove());
  const found = [];
  const meta = name => { const el = doc.querySelector(`meta[name="${name}"]`) || doc.querySelector(`meta[property="${name}"]`); return el ? clean(el.getAttribute('content')) : ''; };
  const rawTitle = clean(doc.querySelector('title')?.text || '');
  const siteName = meta('og:site_name') || rawTitle.split(/\s[|–-]\s/).pop() || new URL(pageUrl).hostname.replace(/^www\./,'');
  const desc = meta('description') || meta('og:description');
  const ogImage = abs(pageUrl, meta('og:image'));

  const header = doc.querySelector('header, [role="banner"], .site-header, #header, #masthead');
  const footer = doc.querySelector('footer, [role="contentinfo"], .site-footer, #footer, #colophon');
  const main = doc.querySelector('main, [role="main"], #main, #content, .site-content, article') || doc.querySelector('body') || doc;

  /* brand + nav */
  const brandWords = clean(siteName).split(' ');
  const brand = brandWords.length > 1 ? brandWords.slice(0,-1).join(' ') + ' ' : brandWords[0] || 'Your';
  const brandAccent = brandWords.length > 1 ? brandWords[brandWords.length-1] : '';
  let logo = '';
  const logoImg = (header || doc).querySelector('img[class*="logo" i], .logo img, a[class*="brand" i] img, [class*="site-logo" i] img, header img');
  if (logoImg) logo = imgSrc(logoImg, pageUrl);
  const navLinks = [];
  const navScope = (header && header.querySelector('nav')) || header || doc.querySelector('nav');
  if (navScope) for (const a of navScope.querySelectorAll('a')){
    const label = cut(a.text, 24); const href = a.getAttribute('href') || '';
    if (!label || label.length < 2 || /^(home|skip|menu)$/i.test(label) || /^(javascript|mailto|tel):/.test(href)) continue;
    if (navLinks.some(l => l.label.toLowerCase() === label.toLowerCase())) continue;
    navLinks.push({ label, href: href.startsWith('#') ? href : abs(pageUrl, href) || '#' });
    if (navLinks.length >= 6) break;
  }
  const ctaEl = (header || doc).querySelector('a[class*="btn" i], a[class*="button" i], .cta a, a.elementor-button');
  const blocks = [];
  blocks.push({ id: uid(), type: 'navbar', props: { brand: clean(brand), brandAccent, logo, logoOnly: !!logo, links: navLinks.length ? navLinks : [{label:'About',href:'#about'},{label:'Contact',href:'#contact'}], cta: ctaEl ? cut(ctaEl.text, 24) : 'Contact us', ctaHref: '#contact' } });
  found.push(`Brand: ${clean(siteName)}` + (logo ? ' (logo found)' : '') + (navLinks.length ? `, ${navLinks.length} menu links` : ''));

  /* hero */
  const h1 = main.querySelector('h1') || doc.querySelector('h1');
  let heroTitle = h1 ? cut(h1.text, 90) : cut(rawTitle.split(/\s[|–-]\s/)[0], 90) || 'Welcome';
  let heroSub = '';
  if (h1){
    let n = h1.parentNode; let hops = 0;
    while (n && hops < 3 && !heroSub){ const p = n.querySelectorAll('p').map(x => textOf(x)).find(t => t.length >= 40 && t.length <= 400); if (p) heroSub = p; n = n.parentNode; hops++; }
  }
  if (!heroSub) heroSub = cut(desc, 220) || 'Tell people what you do in one honest sentence.';
  const heroBtn = main.querySelector('a[class*="btn" i], a[class*="button" i], a.elementor-button, .wp-block-button a');
  let heroImg = ogImage;
  if (!heroImg){ const im = main.querySelectorAll('img').find(i => !isDecorativeImg(i) && imgSrc(i, pageUrl)); if (im) heroImg = imgSrc(im, pageUrl); }
  const eyebrowCand = main.querySelector('.eyebrow, .subtitle, .tagline, .kicker, .elementor-heading-title.elementor-size-small');
  blocks.push({ id: uid(), type: 'hero', props: { eyebrow: eyebrowCand && clean(eyebrowCand.text).length <= 48 ? clean(eyebrowCand.text) : '', title: heroTitle, sub: cut(heroSub, 300), primary: heroBtn ? cut(heroBtn.text, 28) : 'Get in touch', primaryHref: '#contact', secondary: '', secondaryHref: '', img: heroImg, imgLabel: clean(siteName), layout: heroImg ? 'split' : 'center', size: 'normal', bgImg: '', bgDim: '55' } });
  found.push(`Headline: “${cut(heroTitle, 50)}”` + (heroImg ? ', with image' : ''));

  /* sections by h2. A section is the largest ancestor that holds only this h2 (a real <section> or a theme
     wrapper). Flat markup (h2s as siblings, classic WordPress content) falls back to the run of siblings up to
     the next h2. Runs of three or more tiny h2 sections (Elementor-style cards) are grouped into one features block. */
  const body = doc.querySelector('body') || doc;
  const within = (el, anc) => { if (!anc) return false; for (let n = el; n; n = n.parentNode) if (n === anc) return true; return false; };
  const countH2 = el => el.querySelectorAll('h2').length;
  const scopeOf = h2 => {
    let scope = h2.parentNode;
    if (countH2(scope) > 1){
      const parts = []; let n = h2.nextElementSibling;
      while (n && String(n.tagName).toUpperCase() !== 'H2' && !(n.querySelector && n.querySelector('h2'))){ parts.push(n.outerHTML); n = n.nextElementSibling; }
      return parse('<div>' + parts.join('') + '</div>');
    }
    while (scope.parentNode && scope.parentNode !== main && scope.parentNode !== body && countH2(scope.parentNode) === 1) scope = scope.parentNode;
    return scope;
  };
  const seenTitles = new Set();
  const infos = [];
  for (const h2 of main.querySelectorAll('h2')){
    if (within(h2, header) || within(h2, footer)) continue;
    const title = cut(h2.text, 70);
    if (!title || title.length < 3 || seenTitles.has(title.toLowerCase())) continue;
    seenTitles.add(title.toLowerCase());
    const scope = scopeOf(h2);
    const h3s = scope.querySelectorAll('h3, h4').map(h => cut(h.text, 60)).filter(Boolean);
    const paras = directParas(scope);
    const imgs = scope.querySelectorAll('img').filter(i => !isDecorativeImg(i)).map(i => ({ src: imgSrc(i, pageUrl), alt: clean(i.getAttribute('alt')) })).filter(i => i.src);
    const txt = textOf(scope);
    const small = !h3s.length && paras.length <= 1 && !imgs.length && txt.length < 320;
    infos.push({ h2, title, scope, h3s, paras, imgs, txt, small });
  }
  let sectionCount = 0;
  const CARD_SEL = '[class*="plan" i], [class*="package" i], [class*="tier" i], [class*="price-card" i], [class*="pricing-card" i], [class*="pricing-table" i] > *, [class*="pricing" i] .card';
  const cardOf = c => {
    const price = (textOf(c).match(PRICE_RE) || [''])[0];
    const nameEl = c.querySelector('h2, h3, h4, h5, [class*="tier" i], [class*="name" i], [class*="title" i], strong');
    const name = cut(nameEl ? nameEl.text : textOf(c).split(' ').slice(0, 3).join(' '), 30);
    const feats = c.querySelectorAll('li').map(l => cut(l.text, 60)).filter(Boolean).slice(0, 6).join('\n');
    return { name, price, period: '', features: feats || 'What this includes', cta: 'Choose ' + cut(name, 16), href: '#contact', hot: false };
  };
  const headingCards = (scope, n) => scope.querySelectorAll('h3, h4').slice(0, n).map(h => {
    /* the card is the ancestor that holds this heading alone, plus its text */
    let card = h.parentNode;
    while (card.parentNode && card.parentNode !== scope && card.parentNode.querySelectorAll('h3, h4').length === 1) card = card.parentNode;
    return { h, card, title: cut(h.text, 40), text: cut((card.querySelectorAll('p').map(p => textOf(p)).find(t => t && t !== clean(h.text)) || textOf(card).replace(clean(h.text), '')), 160) };
  });

  /* classify one section into a block; `hero` means the h1's own section, where only list-like content counts */
  function classify(info, hero){
    const { title, scope, h3s, paras, imgs, txt } = info;
    const props = { eyebrow: '', title };
    const quotes = scope.querySelectorAll('blockquote, [class*="testimonial" i], [class*="review" i]');
    const details = scope.querySelectorAll('details, [class*="faq" i], [class*="accordion" i]');
    const prices = (txt.match(new RegExp(PRICE_RE.source, 'g')) || []).length;

    if (!hero && (details.length >= 2 || /faq|question/i.test(title)) && h3s.length >= 2){
      const items = headingCards(scope, 8).map(c => ({ q: cut(c.h.text, 90), a: c.text || 'Answer goes here.' }));
      blocks.push({ id: uid(), type: 'faq', props: { title, items } }); found.push(`FAQ: ${items.length} questions`); return true;
    }
    const stepsLike = h3s.length >= 2 && (/how it works|steps|process|how it fits|what happens/i.test(title) || scope.querySelectorAll('[class*="step" i]').length >= 2);
    if (prices >= 2 && !stepsLike){
      const priceCards = scope.querySelectorAll(CARD_SEL).filter(c => PRICE_RE.test(textOf(c)) && !c.querySelectorAll(CARD_SEL).some(n => PRICE_RE.test(textOf(n))));
      /* prefer explicit plan cards; otherwise the card around each h3, which must carry its own price */
      const cards = priceCards.length >= 2 ? priceCards.slice(0, 4).map(cardOf)
        : headingCards(scope, 4).map(c => ({ ...cardOf(c.card), name: cut(c.h.text, 30), cta: 'Choose ' + cut(c.h.text, 16) }));
      if (cards.length >= 2 && cards.filter(c => c.price).length >= Math.ceil(cards.length / 2)){
        cards.forEach(c => { if (!c.price) c.price = 'Ask'; });
        if (cards[1]) cards[1].hot = true;
        blocks.push({ id: uid(), type: 'pricing', props: { ...props, title: title || 'Packages', sub: paras[0] ? cut(paras[0], 160) : '', items: cards } }); found.push(`Pricing: ${cards.length} plans`); return true;
      }
    }
    if (!hero && (quotes.length >= 1 || /testimonial|what (our )?(clients|customers) say|reviews/i.test(title))){
      const qs = (quotes.length ? quotes : scope.querySelectorAll('p')).slice(0, 4).map(q => {
        const who = q.querySelector('cite, footer, [class*="author" i], [class*="name" i]');
        const whoTxt = who ? cut(who.text, 60) : '';
        const body = q.querySelectorAll('p').map(p => textOf(p)).filter(t => t && t !== whoTxt).join(' ') || textOf(q).replace(whoTxt, '');
        const [name, ...rest] = whoTxt.split(/,\s*/);
        return { quote: cut(body, 240), name: name || 'Customer', role: rest.join(', ') };
      }).filter(q => q.quote.length > 20);
      if (qs.length){ blocks.push({ id: uid(), type: 'quotes', props: { ...props, items: qs } }); found.push(`Testimonials: ${qs.length}`); return true; }
    }
    if (imgs.length >= 3 && paras.join(' ').length < 400){
      const items = imgs.slice(0, 9).map(i => ({ img: i.src, caption: cut(i.alt, 40) }));
      blocks.push({ id: uid(), type: 'gallery', props: { title: title || 'Gallery', cols: '3', ratio: 'land', items } }); found.push(`Gallery: ${items.length} images`); return true;
    }
    if (h3s.length >= 2){
      const cards = headingCards(scope, 6);
      const numeric = cards.filter(c => /^\d[\d,.%+]*$|^\d+\s?[a-z+]*$/i.test(c.title)).length >= 2;
      const steps = stepsLike || cards.filter(c => /^(step\s*)?\d+[.)]?\s/i.test(c.title)).length >= 2;
      if (numeric){ blocks.push({ id: uid(), type: 'stats', props: { items: cards.map(c => ({ value: c.title, label: c.text || 'Stat' })) } }); found.push(`Stats: ${cards.length}`); return true; }
      if (steps){ blocks.push({ id: uid(), type: 'steps', props: { eyebrow: '', title: title || 'How it works', sub: paras[0] && !cards.some(c => c.text === paras[0]) ? cut(paras[0], 160) : '', items: cards.slice(0, 5).map(c => ({ title: c.title.replace(/^(step\s*)?\d+[.)]?\s*/i, ''), text: c.text || ' ' })) } }); found.push(`Steps: ${Math.min(cards.length, 5)}`); return true; }
      if (/team|people|who we are|meet/i.test(title) && imgs.length >= 2){
        const items = cards.slice(0, 6).map((c, i) => ({ img: imgs[i] ? imgs[i].src : '', name: c.title, role: '', bio: c.text }));
        blocks.push({ id: uid(), type: 'team', props: { ...props, sub: '', items } }); found.push(`Team: ${items.length} people`); return true;
      }
      blocks.push({ id: uid(), type: 'features', props: { ...props, title: title || 'What we offer', sub: paras[0] && !cards.some(c => c.text === paras[0]) ? cut(paras[0], 160) : '', cols: String(Math.min(4, Math.max(2, cards.length >= 4 ? 4 : cards.length))), iconStyle: 'number', items: cards.map(c => ({ icon: '✦', title: c.title, text: c.text || ' ' })) } });
      found.push(`Features: ${cards.length} cards`); return true;
    }
    if (hero) return false;
    if (paras.length && imgs.length === 1){
      blocks.push({ id: uid(), type: 'split', props: { ...props, text: paras.slice(0, 3).join('\n\n'), cta: '', ctaHref: '#contact', img: imgs[0].src, alt: imgs[0].alt || title, flip: sectionCount % 2 === 1 } }); found.push(`Image + text: “${cut(title, 40)}”`); return true;
    }
    if (paras.length){
      blocks.push({ id: uid(), type: 'text', props: { eyebrow: '', title, body: paras.slice(0, 4).join('\n\n') } }); found.push(`Text: “${cut(title, 40)}”`); return true;
    }
    return false;
  }
  const infoOf = (title, scope) => {
    const h3s = scope.querySelectorAll('h3, h4').map(h => cut(h.text, 60)).filter(Boolean);
    const paras = directParas(scope);
    const imgs = scope.querySelectorAll('img').filter(i => !isDecorativeImg(i)).map(i => ({ src: imgSrc(i, pageUrl), alt: clean(i.getAttribute('alt')) })).filter(i => i.src);
    const txt = textOf(scope);
    return { title, scope, h3s, paras, imgs, txt, small: !h3s.length && paras.length <= 1 && !imgs.length && txt.length < 320 };
  };

  /* the h1's own section often carries the plan grid or a feature row right under the headline */
  if (h1 && within(h1, main)){
    let hs = h1.parentNode;
    while (hs.parentNode && hs.parentNode !== main && hs.parentNode !== body && !countH2(hs.parentNode)) hs = hs.parentNode;
    if (hs !== main && !countH2(hs)) { if (classify(infoOf('', hs), true)) sectionCount++; }
  }
  for (let i = 0; i < infos.length; i++){
    if (blocks.length >= 13) break;
    const info = infos[i];
    if (info.small && infos[i+1] && infos[i+1].small && infos[i+2] && infos[i+2].small){
      const run = []; while (infos[i] && infos[i].small && run.length < 6) run.push(infos[i++]); i--;
      blocks.push({ id: uid(), type: 'features', props: { eyebrow: '', title: 'What we offer', sub: '', cols: String(run.length === 3 || run.length === 6 ? 3 : run.length === 4 ? 4 : 2), iconStyle: 'number', items: run.map(r => ({ icon: '✦', title: cut(r.title, 40), text: cut(r.paras[0] || r.txt.replace(r.title, ''), 160) || ' ' })) } });
      found.push(`Features: ${run.length} cards`); sectionCount++; continue;
    }
    if (classify(info, false)) sectionCount++;
  }

  /* contact */
  const mail = doc.querySelector('a[href^="mailto:"]'); const tel = doc.querySelector('a[href^="tel:"]'); const addr = doc.querySelector('address, [itemprop="address"], [class*="address" i]');
  const email = mail ? clean(mail.getAttribute('href').replace(/^mailto:/,'').split('?')[0]) : '';
  const phone = tel ? clean(tel.getAttribute('href').replace(/^tel:/,'')) : '';
  if (email || phone || addr){
    blocks.push({ id: uid(), type: 'contact', props: { title: 'Let’s talk', sub: 'Tell us what you need and we reply within a day.', email: email || 'hello@yourbrand.com', phone, where: addr ? cut(addr.text, 80) : '', action: '' } });
    found.push('Contact details' + (email ? ': ' + email : ''));
  }

  /* footer */
  const footTxt = footer ? textOf(footer) : '';
  const copy = (footTxt.match(/(©|\(c\)|copyright)[^|\n]{3,90}/i) || [''])[0];
  const footLinks = footer ? footer.querySelectorAll('a').map(a => ({ label: cut(a.text, 24), href: a.getAttribute('href')||'#' })).filter(l => l.label && !/^(javascript|mailto|tel):/.test(l.href)).slice(0, 6) : [];
  blocks.push({ id: uid(), type: 'footer', props: { brand: clean(brand), brandAccent, logo: '', tagline: cut(desc, 140) || 'One honest line about what you do and who you do it for.', links: footLinks.length ? footLinks.map(l => ({ label: l.label, href: l.href.startsWith('#') ? l.href : abs(pageUrl, l.href) || '#' })) : navLinks.slice(0,4), fine: clean(copy) || `© ${new Date().getFullYear()} ${clean(siteName)}. All rights reserved.` } });

  /* menu links that name a section we rebuilt now scroll to it instead of leaving for the old site */
  const ANCHORS = { features:'features', pricing:'pricing', faq:'faq', contact:'contact', gallery:'gallery', quotes:'testimonials', team:'team', map:'map', steps:'how', logos:'partners' };
  const LABEL_TO_TYPE = [[/pric|package|plan|rate/i,'pricing'],[/faq|question/i,'faq'],[/contact|book|quote|enquir|inquir/i,'contact'],[/gallery|portfolio|work|photo|project/i,'gallery'],[/testimonial|review|client/i,'quotes'],[/service|feature|what we/i,'features'],[/team|people/i,'team'],[/about|story/i,'about']];
  const have = new Set(blocks.map(b => b.type));
  const aboutBlock = blocks.find(b => (b.type==='text' || b.type==='split') && /about|story|who we/i.test(b.props.title||''));
  if (aboutBlock) aboutBlock.props.anchor = 'about';
  const retarget = l => { const hit = LABEL_TO_TYPE.find(([re]) => re.test(l.label)); if (!hit) return l; const type = hit[1]; if (type==='about') return aboutBlock ? { ...l, href:'#about' } : l; return (have.has(type) && ANCHORS[type]) ? { ...l, href:'#'+ANCHORS[type] } : l; };
  for (const b of blocks) if ((b.type==='navbar' || b.type==='footer') && Array.isArray(b.props.links)) b.props.links = b.props.links.map(retarget);

  /* theme hints */
  const themeColor = meta('theme-color');
  const lum = hex => { const n = parseInt(hex.slice(1), 16); const c = [16, 8, 0].map(s => ((n >> s) & 255) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  /* theme-color is often the page background (near white or near black); only a mid-tone is a usable accent */
  const accent = /^#[0-9a-f]{6}$/i.test(themeColor) && lum(themeColor) > 0.02 && lum(themeColor) < 0.5 ? themeColor : null;
  const fontsLink = doc.querySelector('link[href*="fonts.googleapis.com"]')?.getAttribute('href') || '';
  const fontMap = [[/Playfair/i,'classic'],[/Fraunces/i,'editorial'],[/Space\+?Grotesk/i,'grotesk'],[/Manrope/i,'modern'],[/Lora/i,'warm'],[/Cormorant/i,'elegant'],[/Nunito|Baloo/i,'friendly'],[/Archivo/i,'bold']];
  const font = (fontMap.find(([re]) => re.test(fontsLink)) || [null, null])[1];

  return {
    meta: { title: cut(rawTitle || siteName, 70), desc: cut(desc, 160), importedFrom: pageUrl },
    theme: { accent, font },
    blocks,
    found
  };
}

/* ================= EXACT COPY =================
   Returns the page as it is: its markup (scripts removed, URLs made absolute) plus every stylesheet it loads,
   rewritten so each selector only applies inside one wrapper element. The builder shows that wrapper as a
   single "Imported page" block, so the copy sits alongside normal blocks and exports the same way. */
const CSS_FILE_MAX = 700*1024, CSS_TOTAL_MAX = 1.6*1024*1024, CSS_FILES_MAX = 14;
const FONT_HOST = /^https:\/\/fonts\.googleapis\.com\//i;

function cssUrls(css, base){
  /* url(...) and @import "..." made absolute against the stylesheet's own address */
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => { if (/^(data:|#|blob:)/i.test(u)) return m; const a = abs(base, u); return a ? `url("${a}")` : m; });
}
function splitTop(s, sep){
  /* split on a separator, ignoring separators inside (), [] and quotes */
  const out = []; let depth = 0, q = null, cur = '';
  for (const ch of s){
    if (q){ cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0){ out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
function scopeSelector(sel, scope){
  sel = sel.trim(); if (!sel) return '';
  if (/^(from|to|\d+%)$/.test(sel)) return sel; // keyframe steps that slipped through
  /* html / :root / body (with their own classes) all become the wrapper; everything else is nested under it */
  const m = sel.match(/^(?:html|:root)([^\s>+~,]*)(?:\s+body([^\s>+~,]*))?(.*)$/i);
  if (m) return scope + (m[2] !== undefined ? m[2] : m[1]) + m[3];
  const b = sel.match(/^body([^\s>+~,]*)(.*)$/i);
  if (b) return scope + b[1] + b[2];
  return scope + ' ' + sel;
}
function scopeCSS(css, scope){
  css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*@charset[^;]*;/i, '');
  let i = 0, out = '';
  const n = css.length;
  const readBlock = () => { // returns raw text up to the matching close brace, consuming it
    let depth = 1, start = i;
    while (i < n && depth){ if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
    return css.slice(start, i - 1);
  };
  const walk = () => {
    let res = '';
    while (i < n){
      const rel = css.slice(i).search(/[{};]/); if (rel < 0) break;
      const ch = css[i + rel]; const head = css.slice(i, i + rel).trim(); i += rel + 1;
      if (ch === '}') return res;               // end of the enclosing conditional block
      if (ch === ';'){ if (head && !/^@import/i.test(head)) res += head + ';'; continue; }
      if (/^@(media|supports|container|layer|document)/i.test(head)){ res += head + '{' + walk() + '}'; continue; }
      if (head.startsWith('@')){ res += head + '{' + readBlock() + '}'; continue; } // @font-face, @keyframes, @page…
      const body = readBlock();
      const sels = splitTop(head, ',').map(s => scopeSelector(s, scope)).filter(Boolean);
      if (sels.length) res += sels.join(',') + '{' + body + '}';
    }
    return res;
  };
  out = walk();
  return out;
}
function rootFontPx(css){
  /* sites that set html{font-size:62.5%} expect 1rem = 10px; the wrapper cannot change the real root, so rem gets converted */
  const m = css.match(/(?:^|[},\s])(?:html|:root)[^{]*\{[^}]*?font-size\s*:\s*([\d.]+)(px|%|rem|em)/i);
  if (!m) return 16;
  const v = parseFloat(m[1]); return m[2] === 'px' ? v : m[2] === '%' ? 16 * v / 100 : 16 * v;
}
async function buildExact(html, pageUrl){
  const doc = parse(html, { comment: false });
  const found = []; const warn = [];
  const meta = name => { const el = doc.querySelector(`meta[name="${name}"]`) || doc.querySelector(`meta[property="${name}"]`); return el ? clean(el.getAttribute('content')) : ''; };
  const title = clean(doc.querySelector('title')?.text || '');
  const desc = meta('description') || meta('og:description');
  const base = doc.querySelector('base[href]') ? abs(pageUrl, doc.querySelector('base[href]').getAttribute('href')) || pageUrl : pageUrl;

  /* stylesheets in document order: <link rel=stylesheet> and <style>, fonts from Google kept as imports */
  const sheets = []; const fonts = [];
  for (const el of doc.querySelectorAll('link[rel], style')){
    if (String(el.tagName).toUpperCase() === 'STYLE'){ sheets.push({ css: el.text || el.innerHTML || '', base }); continue; }
    if (!/stylesheet/i.test(el.getAttribute('rel') || '')) continue;
    const media = el.getAttribute('media'); if (media && /print/i.test(media) && !/all|screen/i.test(media)) continue;
    const href = abs(base, el.getAttribute('href')); if (!href) continue;
    if (FONT_HOST.test(href)){ fonts.push(href); continue; }
    if (sheets.filter(s => s.href).length < CSS_FILES_MAX) sheets.push({ href, media: media && !/^(all|screen)/i.test(media) ? media : '' });
  }
  let total = 0;
  await Promise.all(sheets.filter(s => s.href).map(async s => {
    try { const r = await fetchResource(s.href, { accept: /text\/css|text\/plain|application\/octet-stream/, maxBytes: CSS_FILE_MAX, timeout: 6000, acceptHeader: 'text/css,*/*;q=0.1' }); s.css = r.buf.toString('utf8'); s.base = r.finalUrl; }
    catch (e) { s.css = ''; s.failed = true; }
  }));
  /* one level of @import inside fetched CSS (themes sometimes chain files) */
  for (const s of sheets){
    if (!s.css) continue;
    const imports = [...s.css.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?[^;]*;/gi)];
    for (const im of imports){
      const u = abs(s.base, im[1]); if (!u) continue;
      if (FONT_HOST.test(u)){ fonts.push(u); continue; }
      if (total > CSS_TOTAL_MAX) break;
      try { const r = await fetchResource(u, { accept: /text\/css|text\/plain|application\/octet-stream/, maxBytes: CSS_FILE_MAX, timeout: 5000, acceptHeader: 'text/css,*/*;q=0.1' }); const c = r.buf.toString('utf8'); total += c.length; s.css = cssUrls(c, r.finalUrl) + '\n' + s.css; } catch {}
    }
  }
  const scopeId = 'imp-' + crypto.randomBytes(3).toString('hex');
  const scope = '#' + scopeId;
  let css = '';
  for (const s of sheets){
    if (!s.css) continue;
    total += s.css.length; if (total > CSS_TOTAL_MAX){ warn.push('Some stylesheets were skipped (size limit).'); break; }
    let c = cssUrls(s.css, s.base || base);
    c = s.media ? `@media ${s.media}{${c}}` : c;
    css += c + '\n';
  }
  const rootPx = rootFontPx(css);
  if (rootPx && Math.abs(rootPx - 16) > 0.5){
    css = css.replace(/(-?[\d.]+)rem\b/g, (m, v) => (Math.round(parseFloat(v) * rootPx * 100) / 100) + 'px');
    css = css.replace(/((?:^|[},\s])(?:html|:root)[^{]*\{[^}]*?)font-size\s*:[^;}]*;?/i, '$1');
  }
  css = scopeCSS(css, scope);
  /* things that only appear once the original site's scripts run */
  css += `\n${scope} [data-aos],${scope} .aos-init,${scope} .elementor-invisible,${scope} .wow,${scope} .animate__animated,${scope} .fade-in,${scope} .reveal,${scope} .lazyload,${scope} .lazy,${scope} .b-lazy,${scope} img[data-src],${scope} [data-animate],${scope} .sal-animate,${scope} [data-sal]{opacity:1!important;visibility:visible!important;transform:none!important;animation:none!important}`;
  css += `\n${scope} .preloader,${scope} #preloader,${scope} .page-loader,${scope} .loading-overlay,${scope} .cookie-notice,${scope} #cookie-law-info-bar,${scope} .cky-consent-container,${scope} .cc-window{display:none!important}`;
  css = css.replace(/<\/style/gi, '<\\/style');

  /* body: drop what cannot run or would leak, make every address absolute */
  const body = doc.querySelector('body') || doc;
  const dropSel = 'script, noscript, template, link, meta, style, base, title, object, embed, applet';
  body.querySelectorAll(dropSel).forEach(n => n.remove());
  let iframes = 0;
  for (const f of body.querySelectorAll('iframe')){
    const src = abs(base, f.getAttribute('src') || f.getAttribute('data-src'));
    if (src && /^https:\/\/(www\.)?(youtube(-nocookie)?\.com|player\.vimeo\.com|www\.google\.com\/maps|maps\.google\.com|open\.spotify\.com)/i.test(src)){ f.setAttribute('src', src); f.removeAttribute('data-src'); iframes++; }
    else f.remove();
  }
  let imgs = 0, links = 0;
  for (const el of body.querySelectorAll('*')){
    for (const [k] of Object.entries(el.attributes || {})){
      if (/^on/i.test(k)) el.removeAttribute(k);
    }
    const tag = String(el.tagName).toUpperCase();
    const lazy = el.getAttribute('data-src') || el.getAttribute('data-lazy-src');
    const src = el.getAttribute('src');
    if (lazy && (!src || /^data:/i.test(src))){ el.setAttribute('src', lazy); }
    const lazySet = el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset');
    if (lazySet && !el.getAttribute('srcset')) el.setAttribute('srcset', lazySet);
    for (const a of ['src', 'href', 'poster', 'action', 'data-bg', 'data-background']){
      const v = el.getAttribute(a); if (!v) continue;
      if (a === 'href' && /^(javascript:|#)/i.test(v.trim())){ if (/^javascript:/i.test(v.trim())) el.setAttribute('href', '#'); continue; }
      if (/^(data:|blob:|mailto:|tel:|sms:)/i.test(v.trim())) continue;
      const u = abs(base, v); if (u) el.setAttribute(a, u);
    }
    for (const a of ['srcset', 'data-srcset']){
      const v = el.getAttribute(a); if (!v) continue;
      el.setAttribute(a, v.split(',').map(part => { const [u, d] = part.trim().split(/\s+/); const au = abs(base, u); return (au || u) + (d ? ' ' + d : ''); }).join(', '));
    }
    /* lazy background images: data-bg="x.jpg" or data-bg="url(x.jpg)" become a real inline background */
    const bg = el.getAttribute('data-bg') || el.getAttribute('data-background') || el.getAttribute('data-background-image') || el.getAttribute('data-bg-url');
    if (bg && !/background/i.test(el.getAttribute('style') || '')){
      const u = abs(base, bg.replace(/^url\((['"]?)(.*)\1\)$/i, '$2'));
      if (u) el.setAttribute('style', ((el.getAttribute('style') || '').replace(/;?\s*$/, ';') + `background-image:url("${u}")`).replace(/^;/, ''));
    }
    const st = el.getAttribute('style');
    if (st && /url\(/i.test(st)) el.setAttribute('style', cssUrls(st, base));
    if (tag === 'IMG') imgs++; if (tag === 'A') links++;
    if (tag === 'A' && el.getAttribute('target')) el.setAttribute('rel', 'noopener');
    if (el.getAttribute('contenteditable')) el.removeAttribute('contenteditable');
  }
  const htmlEl = doc.querySelector('html');
  const rootClass = clean(((htmlEl && htmlEl.getAttribute('class')) || '').replace(/\bno-js\b/g, 'js') + ' ' + ((body.getAttribute && body.getAttribute('class')) || ''));
  const rootStyle = cssUrls(clean((body.getAttribute && body.getAttribute('style')) || ''), base).replace(/"/g, "'");
  const rootLang = clean((htmlEl && htmlEl.getAttribute('lang')) || '');
  const rootDir = clean((htmlEl && htmlEl.getAttribute('dir')) || (body.getAttribute && body.getAttribute('dir')) || '');
  let inner = body.innerHTML.replace(/<\/?(html|body|head)\b[^>]*>/gi, '');
  found.push(`Exact copy of ${title ? '“' + cut(title, 50) + '”' : 'the page'}`);
  found.push(`${sheets.filter(s => s.css).length} stylesheet${sheets.filter(s => s.css).length === 1 ? '' : 's'} (${Math.round(css.length / 1024)} KB)` + (fonts.length ? `, ${fonts.length} Google Fonts link${fonts.length > 1 ? 's' : ''}` : ''));
  found.push(`${imgs} image${imgs === 1 ? '' : 's'}, ${links} link${links === 1 ? '' : 's'}` + (iframes ? `, ${iframes} embed${iframes > 1 ? 's' : ''}` : ''));
  if (sheets.some(s => s.failed)) warn.push('One or more stylesheets could not be fetched; parts of the page may look plain.');
  warn.push('Scripts were removed: menus, sliders and forms that relied on them will not run.');
  return { meta: { title: cut(title, 70), desc: cut(desc, 160), importedFrom: pageUrl }, exact: { scopeId, rootClass, rootStyle, rootLang, rootDir, html: inner, css, fonts: [...new Set(fonts)] }, found, warn };
}

/* Copy one remote image into our Blob store so the copied page stops depending on the old site. */
async function copyAsset(url, client){
  const { put } = require('@vercel/blob');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('no-blob-store');
  /* images and web fonts. Fonts matter: a browser only loads a font from another domain when that domain allows it,
     and most WordPress hosts do not, so a copied page's self-hosted fonts fall back until they are rehosted here. */
  const r = await fetchResource(url, { accept: /^(image\/(jpeg|png|webp|gif|svg\+xml|avif|x-icon|vnd\.microsoft\.icon)|font\/|application\/(font-woff2?|x-font-woff|x-font-ttf|x-font-opentype|vnd\.ms-fontobject|octet-stream))/, maxBytes: 4*1024*1024, timeout: 8000, acceptHeader: 'image/*,font/*,*/*;q=0.5' });
  const mime = r.type.split(';')[0].trim();
  const fromUrl = (new URL(r.finalUrl).pathname.match(/\.(woff2|woff|ttf|otf|eot|svg|png|jpe?g|webp|gif|avif|ico)$/i) || [,''])[1].toLowerCase();
  if (mime === 'application/octet-stream' && !/^(woff2?|ttf|otf|eot)$/.test(fromUrl)) throw new Error('wrong-type');
  const ext = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'image/svg+xml':'svg', 'image/avif':'avif', 'image/x-icon':'ico', 'image/vnd.microsoft.icon':'ico', 'font/woff2':'woff2', 'font/woff':'woff', 'font/ttf':'ttf', 'font/otf':'otf', 'application/font-woff2':'woff2', 'application/font-woff':'woff', 'application/x-font-woff':'woff', 'application/x-font-ttf':'ttf', 'application/x-font-opentype':'otf', 'application/vnd.ms-fontobject':'eot' }[mime] || fromUrl || 'bin';
  const storedType = mime === 'application/octet-stream' ? ({ woff2:'font/woff2', woff:'font/woff', ttf:'font/ttf', otf:'font/otf', eot:'application/vnd.ms-fontobject' }[ext] || mime) : mime;
  const name = (new URL(r.finalUrl).pathname.split('/').pop() || 'image').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
  const hash = crypto.createHash('sha1').update(r.finalUrl).digest('hex').slice(0, 8);
  const blob = await put(`sites/${client}/imported/${hash}-${name}.${ext}`, r.buf, { access: 'public', contentType: storedType, addRandomSuffix: false });
  return blob.url;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.LOOP_SECRET;
  if (!secret) return res.status(500).json({ ok:false, reason:'server-config' });
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method' });
  const client = sessionClient(req, secret);
  if (!client) return res.status(401).json({ ok:false, reason:'unauthorized' });
  let body = req.body; if (typeof body === 'string'){ try{ body = JSON.parse(body); }catch{ body = {}; } } body = body || {};
  let url = String(body.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { return res.status(200).json({ ok:false, reason:'bad-url' }); }
  if (body.action === 'asset'){
    try { const stored = await copyAsset(url, client); return res.status(200).json({ ok:true, url: stored }); }
    catch (e) { const msg = String(e && e.message || ''); return res.status(200).json({ ok:false, reason: /no-blob-store/.test(msg) ? 'no-blob-store' : /wrong-type/.test(msg) ? 'not-image' : /too-large/.test(msg) ? 'too-large' : 'failed' }); }
  }
  try {
    const { html, finalUrl } = await fetchPage(url);
    if (body.mode === 'exact'){
      const page = await buildExact(html, finalUrl);
      return res.status(200).json({ ok:true, page, found: page.found, warn: page.warn, source: finalUrl });
    }
    const page = buildPage(html, finalUrl);
    return res.status(200).json({ ok:true, page, found: page.found, source: finalUrl });
  } catch (e) {
    if (process.env.IMPORT_DEBUG) console.error(e);
    const msg = String(e && e.message || '');
    const reason = /private-host/.test(msg) ? 'blocked-host' : /dns/.test(msg) ? 'unreachable' : /not-html/.test(msg) ? 'not-html' : /http-4\d\d/.test(msg) ? 'not-found' : /http-|redirects/.test(msg) ? 'unreachable' : /abort/i.test(msg) ? 'timeout' : 'failed';
    return res.status(200).json({ ok:false, reason });
  }
};
