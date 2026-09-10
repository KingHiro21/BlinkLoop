// Runs inside the rendered page (puppeteer serialises this function). Reads the page the way a person sees it:
// real sections by geometry and background, repeated cards by alignment, the biggest text as the heading, buttons by
// their look, the actual colours and fonts. Returns a plain outline that api/import.js turns into builder blocks.
module.exports = function analyzePage(){
  const vw = window.innerWidth, vh = window.innerHeight;
  const cs = el => getComputedStyle(el);
  const rect = el => el.getBoundingClientRect();
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const text = el => clean(el.innerText || el.textContent || '');
  const abs = u => { if (!u) return ''; try { return new URL(u, location.href).href; } catch (e) { return ''; } };
  const visible = el => { if (!el || !el.isConnected) return false; const s = cs(el); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false; const r = rect(el); return r.width > 2 && r.height > 2; };
  const toHex = c => { const m = c && c.match(/[\d.]+/g); if (!m || m.length < 3) return ''; if (m[3] !== undefined && parseFloat(m[3]) < 0.5) return ''; return '#' + m.slice(0, 3).map(n => Math.round(+n).toString(16).padStart(2, '0')).join(''); };
  const lum = hex => { if (!hex) return 1; const n = parseInt(hex.slice(1), 16); const c = [16, 8, 0].map(s => ((n >> s) & 255) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const sat = hex => { if (!hex) return 0; const n = parseInt(hex.slice(1), 16); const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
  const bgColor = el => toHex(cs(el).backgroundColor);
  const bgImage = el => { const b = cs(el).backgroundImage; const m = b && b.match(/url\("?([^")]+)"?\)/); return m && !/^data:/.test(m[1]) ? abs(m[1]) : ''; };
  const effBg = el => { let e = el; while (e && e !== document.documentElement){ const c = bgColor(e), i = bgImage(e); if (c || i) return { color: c, image: i }; e = e.parentElement; } return { color: bgColor(document.body) || '#ffffff', image: '' }; };
  const fam = s => clean(String(s || '').split(',')[0].replace(/['"]/g, ''));
  const imgSrc = im => { const s = im.currentSrc || im.getAttribute('src') || im.getAttribute('data-src') || ''; return /^data:/.test(s) ? '' : abs(s); };
  const isBtn = el => {
    if (!/^(A|BUTTON)$/.test(el.tagName)) return false; const s = cs(el); const t = text(el); if (!t || t.length > 40) return false;
    const bg = toHex(s.backgroundColor); const border = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none';
    return !!bg || border || /btn|button|cta/i.test(el.className || '') || el.getAttribute('role') === 'button';
  };
  const PRICE = /(₱|\$|€|£|PHP|USD|Php)\s?\d[\d,]*(\.\d+)?/;
  const fontPx = el => parseFloat(cs(el).fontSize) || 16;

  window.scrollTo(0, 0);
  const header = document.querySelector('header, [role="banner"]') || [...document.body.children].find(e => visible(e) && rect(e).top < 10 && rect(e).height < 200 && e.querySelectorAll('a').length >= 3) || null;
  const footer = document.querySelector('footer, [role="contentinfo"]') || null;
  const main = document.querySelector('main, [role="main"], #main, #content, #root, #__next, #app') || document.body;
  const inside = (el, anc) => !!(anc && anc !== el && anc.contains(el));
  const chrome = el => inside(el, header) || el === header || inside(el, footer) || el === footer;

  /* ---- sections: descend through wrappers until a node has several tall, wide children ---- */
  const big = el => visible(el) && rect(el).height >= 90 && rect(el).width >= vw * 0.45 && !chrome(el) && text(el).length + el.querySelectorAll('img,video,svg,picture').length > 0;
  const SECTIONISH = el => /^(SECTION|ARTICLE|ASIDE)$/.test(el.tagName) || /(^|\s|-|_)(section|hero|banner|block|module|feature|cta|testimonial|pricing|faq|gallery|footer|contact|about|services|team|stats)(\s|-|_|$)/i.test(el.className || '') || (el.id && /section|hero|about|services|contact|pricing|faq/i.test(el.id));
  const hasOwnBg = el => !!(bgColor(el) || bgImage(el));
  function children(el){ return [...el.children].filter(big); }
  function segment(el, depth, out){
    if (out.length > 40 || depth > 16) return;
    const kids = children(el);
    const h = rect(el).height;
    const isRoot = el === main || el === document.body;
    if (!kids.length){ if (h >= 90 && !isRoot) out.push(el); return; }
    if (kids.length === 1){
      /* a wrapper: descend, unless this is a marked section whose single child is just its inner content */
      const k = kids[0];
      if (!isRoot && SECTIONISH(el) && !SECTIONISH(k) && rect(k).height / h < 0.92){ out.push(el); return; }
      /* a wrapper that also holds a small heading row above its one big child is the section (the row is its title) */
      const small = [...el.children].filter(c => c !== k && visible(c) && text(c).length > 0);
      if (!isRoot && small.length && h < 1600 && small.reduce((a, c) => a + rect(c).height, 0) >= 24 && rect(k).height / h < 0.96){ out.push(el); return; }
      return segment(k, depth + 1, out);
    }
    const cover = kids.reduce((a, k) => a + rect(k).height, 0) / Math.max(1, h);
    const stacked = new Set(kids.map(k => Math.round(rect(k).top / 30))).size === kids.length; // one below the other, not side by side
    const splittable = stacked && cover >= 0.5 && kids.filter(k => rect(k).height >= 120).length >= 2;
    if (!splittable){ if (!isRoot && h >= 90) out.push(el); else for (const k of kids) segment(k, depth + 1, out); return; }
    /* several tall stacked children: a marked section keeps them together unless they are sections themselves */
    if (!isRoot && SECTIONISH(el) && !kids.some(k => SECTIONISH(k) || hasOwnBg(k))){ out.push(el); return; }
    for (const k of kids) segment(k, depth + 1, out);
  }
  const sections = []; segment(main, 0, sections);
  /* the body sometimes holds sections outside <main> (heroes before it, CTAs after it) */
  if (main !== document.body){ for (const k of [...document.body.children]){ if (k === main || main.contains(k) || k.contains(main) || chrome(k) || !big(k)) continue; if (!sections.includes(k)) segment(k, 1, sections); } sections.sort((a, b) => rect(a).top - rect(b).top); }

  /* ---- cards: the container whose children are several similar boxes side by side ---- */
  function findCards(S){
    let best = null;
    const cands = [S, ...S.querySelectorAll('div,ul,ol,section,article')].filter(c => visible(c) && c.children.length >= 2 && c.children.length <= 40 && rect(c).width >= vw * 0.4);
    for (const c of cands){
      const kids = [...c.children].filter(visible); if (kids.length < 2) continue;
      const base = kids[0]; const w = rect(base).width, h = rect(base).height; if (w < 90 || h < 50) continue;
      const similar = kids.filter(k => k.tagName === base.tagName && Math.abs(rect(k).width - w) <= w * 0.35 && Math.abs(rect(k).height - h) <= Math.max(80, h * 0.6));
      /* two side-by-side picture panels count as cards too; otherwise three or more */
      const pair = similar.length === 2 && kids.length === 2 && w >= vw * 0.3 && similar.every(k => k.querySelector('img,picture,video') || bgImage(k)) && Math.abs(rect(similar[0]).top - rect(similar[1]).top) < 30;
      if (!pair && (similar.length < 3 || similar.length < kids.length * 0.66)) continue;
      const rows = new Set(similar.map(k => Math.round(rect(k).top / 20))); const cols = new Set(similar.map(k => Math.round(rect(k).left / 20)));
      if (cols.size < 2 && rows.size === similar.length && w > vw * 0.7) continue; // a plain vertical list of full-width blocks is not a card grid
      const withContent = similar.filter(k => text(k).length > 0 || k.querySelector('img,svg,picture,video') || bgImage(k));
      if (withContent.length < (pair ? 2 : 3)) continue;
      const score = similar.length * Math.min(w, 600) * Math.min(h, 600);
      if (!best || score > best.score) best = { c, kids: similar, score };
    }
    return best;
  }
  /* the section's heading: a real heading tag when there is one (decorative giant text loses), else the biggest text leaf */
  const largestTextEl = (S, exclude) => {
    const pick = sel => { let best = null, bestPx = 0;
      for (const el of S.querySelectorAll(sel)){
        if (!visible(el) || exclude.some(x => x.contains(el))) continue;
        if ([...el.children].some(ch => text(ch).length > 0 && !/^(SPAN|EM|STRONG|B|I|BR|SUP|SUB|A|MARK)$/.test(ch.tagName))) continue; // wants a text leaf
        const t = text(el); if (t.length < 2 || t.length > 160) continue;
        const px = fontPx(el); if (px > bestPx){ bestPx = px; best = el; }
      }
      return best ? { el: best, px: bestPx, text: text(best) } : null; };
    return pick('h1,h2,h3') || pick('h4,h5,h6,p,span,div,a,strong,em,li');
  };
  const cardInfo = k => {
    const im = [...k.querySelectorAll('img')].find(i => imgSrc(i) && (rect(i).width >= 40 || (!i.complete && cs(i).display !== 'none')));
    const bgEl = im ? null : [k, ...k.querySelectorAll('div,a,figure,span')].find(e => bgImage(e) && rect(e).height >= 40);
    /* text leaves by size: the biggest is the title, unless it is the price (then the next non-price line names the card) */
    const leaves = [...k.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div,a,strong,em,li,cite,figcaption,summary')].filter(e => visible(e) && text(e).length >= 2 && ![...e.children].some(ch => text(ch).length > 0 && !/^(SPAN|EM|STRONG|B|I|BR|SUP|SUB|A)$/.test(ch.tagName))).map(e => ({ el: e, t: text(e), px: fontPx(e) })).sort((a, b) => b.px - a.px);
    const t = text(k);
    const priceM = t.match(new RegExp(PRICE.source + '\\s*((?:\\/|per|a|each)\\s*[a-z]{2,12})?', 'i'));
    const price = priceM ? priceM[0].replace(priceM[3] || '', '').trim() : '';
    const period = priceM && priceM[3] ? clean(priceM[3].replace(/^\//, '/ ')) : '';
    /* a bare step number ("01", "3.") as the biggest text is a label, not the title; keep it as `num` and title from the next line */
    const numLeaf = leaves.find(l => /^\(?\d{1,2}[.)]?$/.test(l.t));
    const titleLeaf = leaves.find(l => !PRICE.test(l.t) && l.t.length <= 90 && !/^\(?\d{1,2}[.)]?$/.test(l.t)) || leaves[0];
    const title = titleLeaf ? titleLeaf.t : '';
    const num = numLeaf ? parseInt(numLeaf.t.replace(/\D/g, ''), 10) : null;
    const list = [...k.querySelectorAll('li')].filter(visible).map(text).filter(x => x && x !== title).slice(0, 8);
    const paras = leaves.filter(l => l.t.length >= 20 && l.t !== title && !/^(LI|CITE|FIGCAPTION|SUMMARY)$/.test(l.el.tagName) && !(titleLeaf && titleLeaf.el.contains(l.el))).map(l => l.t);
    const citeEl = k.querySelector('cite, footer, figcaption, [class*="author" i], [class*="name" i], [class*="byline" i]');
    const cite = citeEl ? text(citeEl).slice(0, 60) : '';
    const btn = [...k.querySelectorAll('a,button')].find(isBtn);
    const link = k.matches('a[href]') ? k : k.querySelector('a[href]');
    const svgIcon = !im && k.querySelector('svg') && rect(k.querySelector('svg')).width <= 64;
    const emoji = (t.match(/^\p{Extended_Pictographic}/u) || [''])[0];
    const quoteLike = !!k.querySelector('blockquote,q') || /^[“"']/.test(t) || !!cite;
    const imgH = im ? (rect(im).height || im.naturalHeight || parseFloat(im.getAttribute('height')) || 120) : (bgEl ? rect(bgEl).height : 0);
    return { title: title.slice(0, 90), num, text: [...new Set(paras)].filter(p => p !== cite && !/^\(?\d{1,2}[.)]?$/.test(p)).join(' ').slice(0, 260), list, cite, img: im ? imgSrc(im) : (bgEl ? bgImage(bgEl) : ''), imgH, price, period, btn: btn ? text(btn).slice(0, 30) : '', href: link ? abs(link.getAttribute('href')) : '', icon: emoji, hasSvg: !!svgIcon, quoteLike, question: /\?\s*$/.test(title) };
  };

  const secs = [];
  for (const S of sections.slice(0, 40)){
    const r = rect(S); if (r.height < 90) continue;
    const bg = effBg(S); const dark = lum(bg.color) < 0.45;
    const cardsF = findCards(S); const cardEls = cardsF ? cardsF.kids : [];
    const excl = cardsF ? [cardsF.c] : [];
    const heading = largestTextEl(S, excl);
    const hEl = heading ? heading.el : null;
    const textLeaves = [...S.querySelectorAll('p,li,div,span,h1,h2,h3,h4,h5,h6')].filter(e => visible(e) && !excl.some(x => x.contains(e)) && !e.children.length && e !== hEl && text(e).length >= 25).map(text);
    const paras = [...new Set(textLeaves)].filter(t => !heading || t !== heading.text).slice(0, 8);
    const imgs = [...S.querySelectorAll('img')].filter(i => visible(i) && imgSrc(i) && !excl.some(x => x.contains(i)) && rect(i).width >= 80 && rect(i).height >= 60).map(i => ({ src: imgSrc(i), alt: clean(i.getAttribute('alt')), w: Math.round(rect(i).width), h: Math.round(rect(i).height), x: Math.round(rect(i).left), y: Math.round(rect(i).top - r.top) }));
    const bgImgs = [S, ...S.querySelectorAll('div,section,figure')].filter(e => visible(e) && bgImage(e) && rect(e).width >= vw * 0.3 && rect(e).height >= 120 && !excl.some(x => x.contains(e))).map(e => ({ src: bgImage(e), w: Math.round(rect(e).width), h: Math.round(rect(e).height) }));
    const buttons = [...S.querySelectorAll('a,button')].filter(b => visible(b) && isBtn(b) && !excl.some(x => x.contains(b))).slice(0, 3).map(b => ({ text: text(b).slice(0, 30), href: b.getAttribute('href') ? abs(b.getAttribute('href')) : '', bg: toHex(cs(b).backgroundColor), radius: parseFloat(cs(b).borderRadius) || 0 }));
    const quotes = [...S.querySelectorAll('blockquote,q,[class*="testimonial" i],[class*="review" i]')].filter(visible).slice(0, 6).map(q => ({ text: text(q).slice(0, 260) }));
    const faq = [...S.querySelectorAll('details')].filter(visible).slice(0, 10).map(d => { const sum = d.querySelector('summary'); return { q: text(sum || d).slice(0, 120), a: clean([...d.children].filter(c => c !== sum).map(c => c.textContent).join(' ')).slice(0, 300) }; });
    const video = S.querySelector('video, iframe[src*="youtube"], iframe[src*="vimeo"]');
    /* a streaming hero's still: the poster attribute, or the player's poster layer even while hidden */
    let videoStill = '';
    if (video && video.tagName === 'VIDEO'){ videoStill = abs(video.getAttribute('poster') || ''); if (!videoStill){ const pl = (video.closest('.video-js, [data-vjs-player], [class*="video" i]') || S).querySelector('[class*="poster" i]'); if (pl){ const m = (cs(pl).backgroundImage || '').match(/url\("?([^")]+)"?\)/); if (m) videoStill = abs(m[1]); else { const pi = pl.querySelector('img'); if (pi) videoStill = imgSrc(pi); } } } }
    const cards = cardEls.slice(0, 12).map(cardInfo).filter(c => c.title || c.text || c.img);
    const hx = hEl ? rect(hEl) : null;
    const textAlign = hEl ? cs(hEl).textAlign : 'start';
    const centered = hx ? Math.abs((hx.left + hx.width / 2) - vw / 2) < vw * 0.08 && (textAlign === 'center' || hx.width < vw * 0.6) : false;
    /* image beside text? */
    let split = null;
    if (imgs.length >= 1 && hEl){ const im = imgs.sort((a, b) => b.w * b.h - a.w * a.h)[0]; const imgLeft = im.x + im.w / 2 < vw / 2; const headLeft = hx.left + hx.width / 2 < vw / 2; if (im.w >= vw * 0.25 && im.w <= vw * 0.7 && imgLeft !== headLeft) split = { img: im, flip: imgLeft }; }
    secs.push({ top: Math.round(r.top), height: Math.round(r.height), tag: S.tagName, cls: String(S.className || '').slice(0, 80), id: S.id || '',
      bg: bg.color, dark, bgImage: bg.image || (bgImgs[0] ? bgImgs[0].src : ''), eyebrow: '',
      heading: heading ? heading.text.slice(0, 120) : '', headingPx: heading ? Math.round(heading.px) : 0, headingTag: hEl ? hEl.tagName : '', centered,
      paras, imgs: imgs.slice(0, 12), buttons, cards, cardCols: cardsF ? new Set(cardEls.map(k => Math.round(rect(k).left / 20))).size : 0, quotes, faq,
      video: video ? (video.tagName === 'VIDEO' ? (video.currentSrc || video.getAttribute('src') || '') : abs(video.getAttribute('src'))) : '', videoPoster: videoStill,
      split, links: [...S.querySelectorAll('a[href]')].filter(visible).length, textLen: text(S).length });
  }
  /* eyebrow: a short line just above the heading, smaller than it */
  for (const s of secs){ /* computed later server-side from paras if needed */ }

  /* ---- header / nav ---- */
  const nav = { logo: '', logoAlt: '', links: [], cta: '', ctaHref: '', bg: header ? effBg(header).color : '', dark: false };
  if (header){
    nav.dark = lum(nav.bg) < 0.45;
    const logoImg = [...header.querySelectorAll('img, svg')].find(i => visible(i) && rect(i).height <= 90 && rect(i).width <= 320 && rect(i).width >= 24 && (i.tagName === 'IMG' ? imgSrc(i) : i.closest('a')));
    if (logoImg && logoImg.tagName === 'IMG'){ nav.logo = imgSrc(logoImg); nav.logoAlt = clean(logoImg.getAttribute('alt')); }
    else if (logoImg){ /* an inline SVG logo travels as a data URL, with its colour fixed so it stays visible on any background */
      try { const c = logoImg.cloneNode(true); const col = cs(logoImg).color || '#111'; if (!c.getAttribute('fill')) c.setAttribute('fill', col); if (!c.getAttribute('xmlns')) c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); if (!c.getAttribute('width')) { c.setAttribute('width', Math.round(rect(logoImg).width)); c.setAttribute('height', Math.round(rect(logoImg).height)); } c.querySelectorAll('[fill="currentColor"]').forEach(e => e.setAttribute('fill', col)); const svg = c.outerHTML; if (svg.length < 20000) nav.logo = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg); nav.logoAlt = clean(logoImg.getAttribute('aria-label') || (logoImg.querySelector('title') ? logoImg.querySelector('title').textContent : '')); } catch (e) {}
    }
    const seen = new Set();
    for (const a of header.querySelectorAll('a[href]')){
      if (!visible(a)) continue; const t = text(a); const href = a.getAttribute('href') || '';
      if (!t || t.length > 28 || /^(javascript|mailto|tel):/.test(href) || seen.has(t.toLowerCase()) || a.querySelector('img,svg') && t.length < 2) continue;
      if (isBtn(a) && !nav.cta){ nav.cta = t; nav.ctaHref = abs(href); continue; }
      seen.add(t.toLowerCase()); nav.links.push({ label: t, href: href.startsWith('#') ? href : abs(href) });
      if (nav.links.length >= 7) break;
    }
  }
  /* ---- footer ---- */
  const foot = { links: [], text: '', socials: [] };
  if (footer){
    foot.text = text(footer).slice(0, 400);
    const seen = new Set();
    for (const a of footer.querySelectorAll('a[href]')){ if (!visible(a)) continue; const t = text(a); const href = a.getAttribute('href') || ''; if (!t || t.length > 30 || /^(javascript|mailto|tel):/.test(href) || seen.has(t.toLowerCase())) continue; seen.add(t.toLowerCase()); foot.links.push({ label: t, href: href.startsWith('#') ? href : abs(href) }); if (foot.links.length >= 8) break; }
  }
  /* ---- theme ---- */
  const bodyBg = effBg(document.body).color || '#ffffff';
  const ink = toHex(cs(document.body).color) || '#111111';
  const btnEls = [...document.querySelectorAll('a,button')].filter(b => visible(b) && isBtn(b) && !chrome(b));
  /* a button's colour: its background, or the first stop of its gradient */
  const btnColor = b => { const s = cs(b); let c = toHex(s.backgroundColor); if (!c && /gradient/.test(s.backgroundImage)){ const m = s.backgroundImage.match(/rgba?\([^)]+\)/); if (m) c = toHex(m[0]); } return c; };
  const count = {}; for (const b of btnEls){ const c = btnColor(b); if (c && sat(c) > 0.2 && lum(c) > 0.02 && lum(c) < 0.75) count[c] = (count[c] || 0) + 1; }
  let accent = Object.entries(count).sort((a, b) => b[1] - a[1])[0]; accent = accent ? accent[0] : '';
  const btnDark = btnEls.filter(b => { const c = toHex(cs(b).backgroundColor); return c && lum(c) < 0.06; }).length >= Math.max(2, btnEls.length * 0.4); // a monochrome site: black buttons are its accent
  if (!accent){ const links = [...main.querySelectorAll('a')].filter(visible).slice(0, 80); const lc = {}; for (const a of links){ const c = toHex(cs(a).color); if (c && sat(c) > 0.3 && lum(c) < 0.6) lc[c] = (lc[c] || 0) + 1; } const b2 = Object.entries(lc).sort((a, b) => b[1] - a[1])[0]; if (b2) accent = b2[0]; }
  const heads = [...document.querySelectorAll('h1,h2,h3')].filter(visible); const hf = {}; for (const h of heads){ const f = fam(cs(h).fontFamily); if (f) hf[f] = (hf[f] || 0) + (h.tagName === 'H1' ? 6 : h.tagName === 'H2' ? 3 : 1); }
  const headFont = (Object.entries(hf).sort((a, b) => b[1] - a[1])[0] || [''])[0] || fam(cs(document.body).fontFamily);
  const bodyEls = [...document.querySelectorAll('p,li')].filter(visible).slice(0, 60); const bf = {}; for (const e of bodyEls){ const f = fam(cs(e).fontFamily); if (f) bf[f] = (bf[f] || 0) + 1; }
  const bodyFont = (Object.entries(bf).sort((a, b) => b[1] - a[1])[0] || [''])[0] || fam(cs(document.body).fontFamily);
  const radii = btnEls.slice(0, 30).map(b => parseFloat(cs(b).borderRadius) || 0).filter(r => !isNaN(r)); radii.sort((a, b) => a - b);
  const btnRadius = radii.length ? radii[Math.floor(radii.length / 2)] : 0;
  const btnH = btnEls.length ? rect(btnEls[0]).height : 40;
  const cardR = []; for (const s of secs) if (s.cards.length){ /* approximate from the first card container child */ }
  const googleFonts = [...document.querySelectorAll('link[href*="fonts.googleapis.com"]')].map(l => l.href);
  const cssGoogle = [...document.styleSheets].map(sh => sh.href || '').filter(h => /fonts\.googleapis\.com/.test(h));
  const headWeight = heads.length ? cs(heads[0]).fontWeight : '700';
  /* ---- contact ---- */
  const mail = document.querySelector('a[href^="mailto:"]'); const tel = document.querySelector('a[href^="tel:"]'); const addr = document.querySelector('address, [itemprop="address"], [class*="address" i]');
  const SOC = [[/facebook\.com/i, 'Facebook'], [/instagram\.com/i, 'Instagram'], [/tiktok\.com/i, 'TikTok'], [/youtube\.com|youtu\.be/i, 'YouTube'], [/linkedin\.com/i, 'LinkedIn'], [/(^|\/\/)(www\.)?(twitter|x)\.com/i, 'X'], [/wa\.me|whatsapp\.com/i, 'WhatsApp'], [/pinterest\./i, 'Pinterest']];
  const socials = []; for (const a of document.querySelectorAll('a[href]')){ const h = a.getAttribute('href') || ''; if (/\/(sharer|share|intent|embed)\b/i.test(h)) continue; const hit = SOC.find(([re]) => re.test(h)); if (hit && !socials.some(s => s.label === hit[1])) socials.push({ label: hit[1], url: abs(h) }); }
  return {
    vw, vh, title: document.title, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    theme: { bg: bodyBg, ink, accent, btnDark, headFont, bodyFont, headFontFull: heads.length ? cs(heads[0]).fontFamily : cs(document.body).fontFamily, bodyFontFull: cs(document.body).fontFamily, headWeight, btnRadius, btnH, googleFonts: googleFonts.concat(cssGoogle) },
    nav, footer: foot, sections: secs,
    contact: { email: mail ? clean(mail.getAttribute('href').replace(/^mailto:/, '').split('?')[0]) : '', phone: tel ? clean(tel.getAttribute('href').replace(/^tel:/, '')) : '', address: addr ? text(addr).slice(0, 120) : '', socials: socials.slice(0, 6) }
  };
};
