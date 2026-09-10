/* Loop Builder, part 5 of 5: access codes and session, drafts and folders, export, publish, import from a website, plugins, SEO, topbar wiring. */
"use strict";

/* =============== CLIENT ACCESS (server-verified) =============== */
/* Codes are signed tokens minted at /admin (needs LOOP_ADMIN_KEY) and
   validated by /api/verify against LOOP_SECRET. Each code carries its own
   expiry date, so access opens when you issue a code and closes by itself
   when the client's service period ends. Nothing secret lives in this file. */

let clientMode = false;
let clientInfo = null; // {client, expires}

async function verifyCode(code){
  const r = await fetch('/api/verify', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ code })
  });
  if(!r.ok) throw new Error('server');
  return r.json();
}
function prettyDate(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m-1, d)).toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric', timeZone:'UTC'});
}

async function checkAccess(){
  clientMode = false; clientInfo = null;
  /* 1) site session cookie (set at /login or on this lock screen) */
  try{
    const r = await fetch('/api/me');
    if (r.ok){
      const d = await r.json();
      if (d.ok){ clientMode = true; clientInfo = {client:d.client, expires:d.expires}; updateAccessUI(); return; }
    }
  }catch(e){}
  /* 2) fallback: stored code (offline / local dev) */
  let stored = null;
  try{ stored = localStorage.getItem('lb-access'); }catch(e){}
  if (stored){
    try{
      const d = await verifyCode(stored);
      if (d.ok){ clientMode = true; clientInfo = {client:d.client, expires:d.expires}; }
      else {
        try{ localStorage.removeItem('lb-access'); }catch(e){}
        if (d.reason === 'expired') toast(t('Your client access has ended. Message us to renew.'));
      }
    }catch(e){ /* server unreachable: stay in trial quietly, keep the stored code for next load */ }
  }
  updateAccessUI();
}
function startPresence(){
  if (window.__blBeat || !clientMode) return;
  const beat = ()=>{ try{ fetch('/api/presence',{method:'POST'}).catch(()=>{}); }catch(e){} };
  beat();
  window.__blBeat = setInterval(()=>{ if(!document.hidden && clientMode) beat(); }, 60000);
}
function updateAccessUI(){
  if (clientMode) startPresence();
  const chip = $('#accessChip');
  chip.textContent = clientMode ? t('Team \u2713') : t('Locked');
  chip.className = 'chip ' + (clientMode ? 'client' : 'trial');
  { const l=$('#exportBtn .lbl'); if (l) l.textContent = t('Export site'); }
  const lock = $('#lockScreen');
  if (lock) lock.classList.toggle('show', !clientMode);
}
function renderAccessModal(fromExport){
  $('#accessBody').innerHTML = clientMode
    ? `<h2>${t('Team access active')}</h2>
       <p class="sub">${t('_accActiveS').replace('{c}', esc(clientInfo.client)).replace('{d}', esc(prettyDate(clientInfo.expires)))}</p>
       <div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
         <a class="tb-btn" style="border:1px solid var(--line)" href="/">${t('Site')}</a>
         <a class="tb-btn" style="border:1px solid var(--line)" href="/team">${t('Team chat')}</a>
         <a class="tb-btn" style="border:1px solid var(--line)" href="/admin">${t('Codes')}</a>
       </div>
       <button class="signout" id="accessOut">${t('Sign out on this browser')}</button>`
    : `<h2>${t('Team access')}</h2>
       <p class="sub">${t('_accTeamS')}</p>
       <input class="in access-in" id="accessCode" placeholder="LOOP-NAME-DATE-CODE" autocomplete="off" />
       <div class="access-err" id="accessErr"></div>
       <div class="row">
         <button class="tb-cta" id="accessGo">${t('Unlock')}</button>
       </div>`;
  bindAccessInputs();
  const out = $('#accessOut');
  if (out) out.addEventListener('click', ()=>{
    try{ fetch('/api/logout', { method:'POST' }); }catch(e){}
    try{ localStorage.removeItem('lb-access'); }catch(e){}
    clientMode=false; clientInfo=null; updateAccessUI(); closeModals(); renderLockScreen();
    toast(t('Signed out. Back on trial'));
  });
}
function renderLockScreen(){
  const lock = $('#lockScreen');
  if (!lock) return;
  const tbIcon = document.querySelector('img.bicon');
  const lk = $('#lkIcon');
  if (tbIcon && lk && tbIcon.src){ lk.src = tbIcon.src; lk.style.display='inline-block'; } else if (lk){ lk.style.display='none'; }
  lock.querySelector('.lk-sub').textContent = t('_accTeamS');
  lock.querySelector('#accessGoL').textContent = t('Unlock');
  bindAccessInputs('L');
}
function bindAccessInputs(sfx=''){
  const go = $('#accessGo'+sfx);
  if (go && !go._wired){
    go._wired = true;
    const tryCode = async ()=>{
      const v = ($('#accessCode'+sfx).value||'').trim().toUpperCase();
      if (!v) return;
      go.disabled = true; go.textContent = t('Checking\u2026');
      $('#accessErr'+sfx).textContent = '';
      try{
        let d = null;
        try{
          const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code:v }) });
          if (r.status !== 404 && r.status !== 405) d = await r.json();
        }catch(e){}
        if (!d) d = await verifyCode(v);
        if (d.ok){
          try{ localStorage.setItem('lb-access', v); }catch(e){}
          clientMode = true; clientInfo = {client:d.client, expires:d.expires};
          updateAccessUI(); closeModals();
          if (!state.blocks.length) openTemplates();
          toast(t('Welcome, {n}! Exporting is unlocked').replace('{n}', d.client));
        } else if (d.reason === 'expired'){
          $('#accessErr'+sfx).textContent = t('_errExpired');
        } else {
          $('#accessErr'+sfx).textContent = t('_errInvalid');
        }
      }catch(e){
        $('#accessErr'+sfx).textContent = t('_errNet');
      }finally{
        go.disabled = false; go.textContent = t('Unlock');
      }
    };
    go.addEventListener('click', tryCode);
    $('#accessCode'+sfx).addEventListener('keydown', e=>{ if(e.key==='Enter') tryCode(); });
  }
}
$('#accessChip').addEventListener('click', ()=>{ renderAccessModal(false); openModal('accessModal'); });


/* =============== EXPORT / PREVIEW =============== */
const WA_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.6.8 5 2.3 7L4 29l7.3-2.3c1.5.8 3.1 1.2 4.7 1.2 6.6 0 12-5.3 12-11.9S22.6 3 16 3zm0 21.6c-1.5 0-3-.4-4.3-1.1l-.3-.2-4.3 1.4 1.4-4.2-.2-.3c-1.3-1.6-2-3.5-2-5.4 0-5.3 4.4-9.6 9.7-9.6s9.7 4.3 9.7 9.6-4.4 9.8-9.7 9.8zm5.4-7.2c-.3-.2-1.7-.9-2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1c-.3-.2-1.2-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1s0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5s0-.4 0-.5c0-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4s-1 1-1 2.5 1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.1 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4s.3-1.3.2-1.4c-.1-.1-.3-.2-.6-.3z"/></svg>';
const MS_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3C8.8 3 3 8.4 3 15c0 3.7 1.8 7 4.7 9.2V29l4.4-2.4c1.2.3 2.5.5 3.9.5 7.2 0 13-5.4 13-12S23.2 3 16 3zm1.4 16.1-3.3-3.5-6.5 3.5 7.1-7.6 3.4 3.5 6.4-3.5-7.1 7.6z"/></svg>';
const VB_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
function chatFabsHTML(){
  const P = state.plugins || {};
  const fabs = [];
  if (P.wa && P.wa.on && P.wa.phone){
    const digits = String(P.wa.phone).replace(/[^0-9]/g,'');
    if (digits){
      const msg = P.wa.msg ? '?text='+encodeURIComponent(P.wa.msg) : '';
      fabs.push(`<a class="chat-fab cf-wa" href="https://wa.me/${digits}${msg}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">${WA_SVG}</a>`);
    }
  }
  if (P.ms && P.ms.on && P.ms.page){
    let u = String(P.ms.page).trim().replace(/^https?:\/\/(www\.)?(m\.me|messenger\.com\/t|facebook\.com)\//i,'').replace(/\/+$/,'').split(/[/?#]/)[0];
    if (u) fabs.push(`<a class="chat-fab cf-ms" href="https://m.me/${escAttr(u)}" target="_blank" rel="noopener" aria-label="Chat on Messenger">${MS_SVG}</a>`);
  }
  if (P.vb && P.vb.on && P.vb.number){
    const digits = String(P.vb.number).replace(/[^0-9]/g,'');
    if (digits) fabs.push(`<a class="chat-fab cf-vb" href="viber://chat?number=%2B${digits}" aria-label="Chat on Viber">${VB_SVG}</a>`);
  }
  return fabs.length ? `<div class="fab-col">${fabs.join('')}</div>` : '';
}
const waFabHTML = chatFabsHTML; /* canvas + export both use this */

function privacySectionHTML(){
  const P = state.plugins || {};
  if (!P.priv || !P.priv.on) return '';
  const nav = state.blocks.find(b=>b.type==='navbar');
  const contact = state.blocks.find(b=>b.type==='contact');
  const name = esc((nav && (nav.props.brand+(nav.props.brandAccent||''))) || state.meta.title || 'This website');
  const email = esc(P.priv.email || (contact && contact.props.email) || '');
  const collects = [];
  if (contact) collects.push('<li><b>Contact form details.</b> When you send a message through this site, your name, contact details, and message go directly to us so we can reply. We use them for nothing else.</li>');
  if ((P.ga && P.ga.on) || (P.fbp && P.fbp.on)){
    const tools = [P.ga && P.ga.on ? 'Google Analytics' : null, P.fbp && P.fbp.on ? 'Meta (Facebook) Pixel' : null].filter(Boolean).join(' and ');
    collects.push(`<li><b>Basic visit statistics.</b> This site uses ${tools}, which set cookies to help us understand how visitors use the site (pages viewed, time spent). You can block cookies in your browser settings and the site will still work.</li>`);
  }
  if ((P.wa && P.wa.on) || (P.ms && P.ms.on) || (P.vb && P.vb.on)) collects.push('<li><b>Chat messages.</b> If you contact us through the chat buttons, your conversation happens inside that app (WhatsApp, Messenger, or Viber) under that app\u2019s own privacy policy.</li>');
  if (!collects.length) collects.push('<li>This site does not actively collect personal information. Our hosting provider may keep standard technical logs (such as IP addresses) to keep the site running securely.</li>');
  return `<section id="privacy" style="padding:56px 0;border-top:1px solid var(--line)"><div class="wrap" style="max-width:760px">
    <h2 style="font-size:1.15rem">Privacy</h2>
    <div style="color:var(--muted);font-size:.92rem;line-height:1.7">
    <p style="margin:10px 0">${name} respects your privacy. Here is what happens with your information when you use this site:</p>
    <ul style="margin:0 0 10px 20px">${collects.join('')}</ul>
    <p style="margin:10px 0">We do not sell personal information.${email?` For any privacy question or request (including deletion of your data), email <a href="mailto:${email}" style="color:var(--accent)">${email}</a>.`:''}</p>
    </div>
  </div></section>`;
}
function faviconHref(){
  const nav = state.blocks.find(b=>b.type==='navbar');
  const letter = ((nav && nav.props.brand) || state.meta.title || 'B').trim().charAt(0).toUpperCase() || 'B';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${state.theme.accent}"/><text x="32" y="43" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#ffffff">${letter}</text></svg>`;
  return 'data:image/svg+xml,'+encodeURIComponent(svg);
}
function seoHeadHTML(){
  const m = state.meta;
  const title = esc(m.title||'');
  const desc = esc(m.desc||'');
  const url = /^https?:\/\//.test(m.siteUrl||'') ? m.siteUrl.replace(/\/$/,'') : '';
  const og = m.ogImage || firstImage();
  const nav = state.blocks.find(b=>b.type==='navbar');
  const contact = state.blocks.find(b=>b.type==='contact');
  let out = `
<meta name="robots" content="index,follow">
<meta name="theme-color" content="${escAttr(state.theme.bg)}">
<link rel="icon" href="${faviconHref()}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
${desc?`<meta property="og:description" content="${desc}">`:''}
${url?`<link rel="canonical" href="${escAttr(url)}">\n<meta property="og:url" content="${escAttr(url)}">`:''}
${og?`<meta property="og:image" content="${escAttr(og)}">`:''}
<meta name="twitter:card" content="${og?'summary_large_image':'summary'}">
<meta name="twitter:title" content="${title}">
${desc?`<meta name="twitter:description" content="${desc}">`:''}
${og?`<meta name="twitter:image" content="${escAttr(og)}">`:''}`;
  if (contact && (contact.props.email || contact.props.phone)){
    const ld = { '@context':'https://schema.org', '@type':'LocalBusiness',
      name: (nav && nav.props.brand ? (nav.props.brand + (nav.props.brandAccent||'')) : m.title) };
    if (url) ld.url = url;
    if (contact.props.email) ld.email = contact.props.email;
    if (contact.props.phone) ld.telephone = contact.props.phone;
    if (contact.props.location) ld.address = { '@type':'PostalAddress', addressLocality: contact.props.location };
    out += `\n<script type="application/ld+json">${JSON.stringify(ld)}<\/script>`;
  }
  return out;
}
function pluginsHeadHTML(){
  const P = state.plugins || {};
  let out = '';
  if (P.ga && P.ga.on && /^G-[A-Z0-9]{4,}$/i.test((P.ga.id||'').trim())){
    const id = escAttr(P.ga.id.trim());
    out += `\n<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"><\/script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${id}');<\/script>`;
  }
  if (P.fbp && P.fbp.on && /^\d{5,20}$/.test((P.fbp.id||'').trim())){
    const id = P.fbp.id.trim();
    out += `\n<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');<\/script>`;
  }
  if (P.custom && P.custom.on && P.custom.head) out += '\n' + P.custom.head;
  return out;
}

function exportHTML(){
  const t = state.theme;
  const leadJS = state.blocks.some(b=>b.type==='contact' && /\/api\/lead/.test(b.props.action||''))
    ? `<script>document.querySelectorAll('form.cform[data-lead]').forEach(function(f){f.addEventListener('submit',async function(e){e.preventDefault();var m=f.querySelector('.cf-msg'),b=f.querySelector('button[type=submit]'),d={};Array.prototype.forEach.call(f.elements,function(el){if(el.name)d[el.name]=el.type==='checkbox'?(el.checked?'yes':''):el.value});m.className='cf-msg';m.textContent='';if(!d.name||d.name.trim().length<2||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(d.email||'')||!d.message||d.message.trim().length<5){m.className='cf-msg err';m.textContent='Please fill in your name, a working email and a short message.';return}if(!d.consent){m.className='cf-msg err';m.textContent='Please tick the box so we may reply to you.';return}b.disabled=true;var old=b.textContent;b.textContent='Sending\\u2026';try{d.consentAt=new Date().toISOString();d.page=location.href;var r=await fetch(f.getAttribute('action'),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(d)});var j=await r.json();if(!j.ok)throw new Error(j.reason||'failed');f.reset();m.className='cf-msg ok';m.textContent='Thank you, '+d.name.trim().split(' ')[0]+'. We will get back to you soon.'}catch(err){m.className='cf-msg err';m.textContent='That did not send. Please email us instead.'}b.disabled=false;b.textContent=old})});<\/script>` : '';
  const lbJS = state.blocks.some(b=>b.type==='gallery' && b.props.lightbox!==false && (b.props.items||[]).some(i=>i.img))
    ? `<script>document.querySelectorAll('.gal[data-lb]').forEach(function(f){f.addEventListener('click',function(){var im=f.querySelector('img');if(!im)return;var o=document.createElement('div');o.className='lb';o.innerHTML='<button class="lb-x" aria-label="Close">\\u00d7</button><img alt="">'+(f.querySelector('figcaption')?'<div class="lb-cap"></div>':'');o.querySelector('img').src=im.currentSrc||im.src;o.querySelector('img').alt=im.alt||'';var c=o.querySelector('.lb-cap');if(c)c.textContent=f.querySelector('figcaption').textContent;var close=function(){o.remove();document.removeEventListener('keydown',k)};var k=function(e){if(e.key==='Escape')close()};o.addEventListener('click',close);document.addEventListener('keydown',k);document.body.appendChild(o)})});<\/script>` : '';
  /* motion: reveals, word-by-word headlines, count-ups, progress bar. Classes are added here so a page without JS shows everything at once. */
  const motionJS = (t.motion||'on') !== 'off' ? `<script>(function(){if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;var body=document.body;
var sel='.sec-head, .feat, .plan, .q, .step, .stat, .faq-list details, .gal, .member, .mi, .split-grid > *, .contact-grid > *, .ctaband .inner, .map-grid > *, .rich, .logos-row .lg, .hero-grid > *, .vidwrap, .embed-wrap, .pay-grid > *, .foot .top > *';
var last=null,i=0;document.querySelectorAll(sel).forEach(function(el){if(el.closest('.imp-root'))return;el.classList.add('reveal');var p=el.parentElement;i=(p===last)?i+1:0;last=p;el.style.transitionDelay=(Math.min(i,6)*.08)+'s'});
var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target)}})},{threshold:.12,rootMargin:'0px 0px -6% 0px'});
document.querySelectorAll('.reveal').forEach(function(el){io.observe(el)});
document.querySelectorAll('.hero h1, .sec-head h2, .ctaband h2, .split-grid h2').forEach(function(h){if(h.closest('.imp-root'))return;var nodes=Array.prototype.slice.call(h.childNodes);h.textContent='';h.classList.add('split');var k=0;
function wrap(c){var w=document.createElement('span');w.className='w';var wi=document.createElement('span');wi.className='wi';if(typeof c==='string')wi.textContent=c;else wi.appendChild(c);wi.style.animationDelay=(k++*.07+.1)+'s';w.appendChild(wi);return w}
nodes.forEach(function(n){if(n.nodeType===3){n.textContent.split(/(\\s+)/).forEach(function(pt){if(!pt)return;if(/^\\s+$/.test(pt))h.appendChild(document.createTextNode(' '));else h.appendChild(wrap(pt))})}else if(n.nodeType===1){if(n.nodeName==='BR')h.appendChild(n);else h.appendChild(wrap(n))}});
var tio=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){h.classList.add('play');tio.disconnect();setTimeout(function(){h.classList.add('done')},1600)}})},{threshold:.3});tio.observe(h)});
document.querySelectorAll('[data-count]').forEach(function(el){var m=el.textContent.match(/^([^0-9]*)([0-9][0-9,.]*)(.*)$/);if(!m)return;var target=parseFloat(m[2].replace(/,/g,''));if(!isFinite(target))return;var dec=(m[2].split('.')[1]||'').length,commas=m[2].indexOf(',')>-1;var cio=new IntersectionObserver(function(es){es.forEach(function(en){if(!en.isIntersecting)return;cio.disconnect();var t0=performance.now();(function tick(now){var p=Math.min(1,(now-t0)/1400),e=1-Math.pow(1-p,3),v=(target*e).toFixed(dec);if(commas)v=v.replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');el.textContent=m[1]+v+m[3];if(p<1)requestAnimationFrame(tick)})(t0)})},{threshold:.5});cio.observe(el)});
if(body.classList.contains('look-studio')){var bar=document.createElement('div');bar.className='progress';body.appendChild(bar);var up=function(){var d=document.documentElement,max=d.scrollHeight-innerHeight;bar.style.transform='scaleX('+(max>0?scrollY/max:0)+')'};addEventListener('scroll',up,{passive:true});addEventListener('resize',up);up()}
})();<\/script>` : '';
  const navJS = state.blocks.some(b=>b.type==='navbar')
    ? `<script>document.querySelectorAll('.nav nav a').forEach(function(a){a.addEventListener('click',function(){var n=a.closest('nav');if(n)n.classList.remove('open')})});var nvc=document.querySelector('.nav.nv-clear');if(nvc){var nvf=function(){nvc.classList.toggle('scrolled',window.scrollY>24)};window.addEventListener('scroll',nvf,{passive:true});nvf()}<\/script>` : '';
  const plang = state.meta.lang || 'en';
  const pdir = RTL[plang] ? ' dir="rtl"' : '';
  return `<!DOCTYPE html>
<html lang="${plang}"${pdir}>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(state.meta.title)}</title>
<meta name="description" content="${escAttr(state.meta.desc || state.meta.title)}" />${seoHeadHTML()}${pluginsHeadHTML()}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${fontLink(t)}" rel="stylesheet" />
<style>${siteCSS(t)}${customCSS()}</style>
</head>
<body class="${bodyClass(t)}">
${pageBodyHTML(false)}
${navJS}${leadJS}${lbJS}${motionJS}
<!-- Built with Loop Builder · blinkloop -->
${privacySectionHTML()}${waFabHTML()}</body>
</html>`;
}

function download(name, content, type='text/html'){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type}));
  a.download = name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
const slug = s => (s||'site').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'site';

function openModal(id){ $('#'+id).classList.add('show'); }
function closeModals(){ $$('.modal-bg').forEach(m=>m.classList.remove('show')); }

$('#exportBtn').addEventListener('click', ()=>{ preparePublish(); if (state.meta.slug) $('#exportName').value = state.meta.slug + '.html';
  if(!state.blocks.length) return toast(t('Your page is empty. Add a block first'));
  openModal('exportModal');
});
/* Publishing: the exported HTML of this page (or every page of the folder) goes to /api/publish, which makes a Vercel
   project per site and attaches <slug>.blinkloop-ph.com. Contact blocks are pointed at the BlinkLoop leads endpoint first. */
const LEAD_ENDPOINT = 'https://www.blinkloop-ph.com/api/lead';
function exportHTMLFor(st){ const prev = state; state = st; try { return exportHTML(); } finally { state = prev; } }
function folderPages(){
  const site = siteRefOf(state); if (!site) return [state];
  const list = [];
  Object.values(TEMP.pages).forEach(st => { if (siteRefOf(st) === site) list.push(st); });
  draftsIndex().forEach(d => { if ((d.site||'') === site && !list.some(st => st.meta.draftId === d.id)){ try{ const st = JSON.parse(localStorage.getItem(DRAFT_PREFIX + d.id) || 'null'); if (st && st.blocks) list.push(st); }catch(e){} } });
  if (!list.some(st => st.meta.draftId === state.meta.draftId)) list.unshift(state);
  return list;
}
function pubDefaultSlug(){ return (state.meta.publish && state.meta.publish.slug) || slug(state.meta.title || 'site').slice(0, 40) || 'site'; }
function preparePublish(){
  $('#pubSlug').value = pubDefaultSlug(); $('#pubHost').textContent = $('#pubSlug').value;
  const pages = folderPages(); $('#pubAllWrap').hidden = pages.length < 2; $('#pubAllCount').textContent = pages.length;
  $('#pubResult').hidden = !(state.meta.publish && state.meta.publish.url);
  if (state.meta.publish && state.meta.publish.url) $('#pubResult').innerHTML = t('Live at') + ' <a href="' + escAttr(state.meta.publish.url) + '" target="_blank" rel="noopener"><b>' + esc(state.meta.publish.url) + '</b></a> · ' + t('last published') + ' ' + new Date(state.meta.publish.at).toLocaleString();
  $('#pubErr').textContent = ''; $('#pubStatus').textContent = '';
}
$('#pubSlug').addEventListener('input', ()=>{ $('#pubHost').textContent = ($('#pubSlug').value || 'your-name').toLowerCase().replace(/[^a-z0-9-]/g, '-'); });
$('#pubAll').addEventListener('click', ()=>{ const on = !$('#pubAll').classList.contains('on'); $('#pubAll').classList.toggle('on', on); $('#pubAll').setAttribute('aria-checked', String(on)); });
async function publishSite(){
  if(!clientMode){ closeModals(); renderAccessModal(true); openModal('accessModal'); return; }
  const err = $('#pubErr'), st = $('#pubStatus'), btn = $('#doPublish'); err.textContent = ''; st.textContent = '';
  const sl = ($('#pubSlug').value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(sl)){ err.textContent = t('Pick a name of 2 to 40 letters, numbers or dashes.'); return; }
  const all = !$('#pubAllWrap').hidden && $('#pubAll').classList.contains('on');
  const pages = all ? folderPages() : [state];
  const files = pages.map(pg => {
    const copy = clone(pg);
    copy.blocks.forEach(b => { if (b.type === 'contact' && !(b.props.action||'').trim()) b.props.action = LEAD_ENDPOINT + '?site=' + sl; });
    const file = (copy.meta.slug && copy.meta.slug !== 'index' ? copy.meta.slug : 'index') + '.html';
    return { file, html: exportHTMLFor(copy) };
  });
  btn.disabled = true; st.textContent = t('Publishing') + ' ' + files.length + ' ' + t(files.length === 1 ? 'page' : 'pages') + '…';
  try{
    const r = await fetch('/api/publish', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ slug: sl, pages: files, customDomain: ($('#pubCustom').value||'').trim() }) });
    if (r.status === 401) throw new Error(t('Your session has expired. Sign in again.'));
    const d = await r.json();
    if (!d.ok){
      const msgs = { 'no-token': t('Publishing is not switched on yet: add VERCEL_TOKEN in the Vercel project settings.'), 'bad-slug': t('That name is taken or not allowed. Try another.'), 'no-index': t('The home page is missing.'), 'too-large': t('This site is too large to publish in one go.'), 'project': t('Vercel refused to create the project') + (d.detail ? ': ' + d.detail : ''), 'deploy': t('Vercel refused the deployment') + (d.detail ? ': ' + d.detail : ''), 'timeout': t('Vercel took too long. Try again in a minute.') };
      throw new Error(msgs[d.reason] || (t('Publishing failed') + (d.detail ? ': ' + d.detail : '')));
    }
    snapshot(); state.meta.publish = { slug: sl, url: d.url, at: Date.now(), pages: d.pages }; autosave();
    pages.forEach(pg => { if (pg !== state){ pg.meta.publish = { slug: sl, url: d.url, at: Date.now() }; if (!pg.meta.ephemeral) try{ localStorage.setItem(DRAFT_PREFIX + pg.meta.draftId, JSON.stringify(pg)); }catch(e){} } });
    $('#pubResult').hidden = false;
    $('#pubResult').innerHTML = '<b>' + t('Live at') + '</b> <a href="' + escAttr(d.url) + '" target="_blank" rel="noopener"><b>' + esc(d.url) + '</b></a>' + (d.pages.length > 1 ? ' · ' + d.pages.length + ' ' + t('pages') : '') + (d.state && d.state !== 'READY' ? ' · ' + t('still finishing, give it a minute') : '') + (!d.domainOk ? '<br>' + t('The subdomain could not be attached; the deployment is at') + ' <a href="' + escAttr(d.deployUrl) + '" target="_blank" rel="noopener">' + esc(d.deployUrl) + '</a>' : '') + (d.custom ? '<br>' + t('Own domain') + ' <b>' + esc(d.custom.domain) + '</b>: ' + (d.custom.verified ? t('connected') : t('set this DNS record with the domain provider') + ': <code>' + esc(d.custom.dns) + '</code>') : '');
    st.textContent = ''; toast(t('Published'));
  }catch(e){ err.textContent = e && e.message || t('Publishing failed.'); st.textContent = ''; }
  finally{ btn.disabled = false; }
}
$('#doPublish').addEventListener('click', publishSite);
/* Private preview link: the exported page goes to Blob through /api/preview and comes back as /p/<slug>/<key> (noindex). */
async function previewLink(){
  if(!clientMode){ closeModals(); renderAccessModal(true); openModal('accessModal'); return; }
  const out = $('#prevOut'), btn = $('#doPreview'); out.hidden = false; out.textContent = t('Making the preview link…'); btn.disabled = true;
  const sl = (($('#pubSlug').value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')) || slug(state.meta.title || 'site');
  try{
    const r = await fetch('/api/preview', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ slug: sl, html: exportHTML() }) });
    if (r.status === 401) throw new Error(t('Your session has expired. Sign in again.'));
    const d = await r.json();
    if (!d.ok){ const m = { 'no-blob-store': t('Preview links need the Blob store: add BLOB_READ_WRITE_TOKEN in Vercel.'), 'too-large': t('This page is too large for a preview link.'), 'bad-slug': t('Pick a name of 2 to 40 letters, numbers or dashes.') }; throw new Error(m[d.reason] || (t('Could not make the preview link') + (d.detail ? ': ' + d.detail : '.'))); }
    const full = d.full || (location.origin + d.url);
    out.innerHTML = '<b>' + t('Preview link') + '</b> <a href="' + escAttr(full) + '" target="_blank" rel="noopener">' + esc(full) + '</a> <button type="button" class="mini" id="prevCopy" title="' + t('Copy') + '">⧉</button><br><span style="font-size:.78rem">' + t('Unlisted and not indexed. Anyone with the link can view it; it shows this page as it is right now, so make a new one after changes.') + '</span>';
    $('#prevCopy').addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(full); toast(t('Link copied')); }catch(e){ toast(full); } });
    if (!state.meta.previews) state.meta.previews = []; state.meta.previews.push({ url: full, at: Date.now() }); autosave();
  }catch(e){ out.textContent = e && e.message || t('Could not make the preview link.'); }
  finally{ btn.disabled = false; }
}
$('#doPreview').addEventListener('click', previewLink);
$('#doExport').addEventListener('click', ()=>{
  if(!clientMode){ closeModals(); renderAccessModal(true); openModal('accessModal'); return; }
  let name = $('#exportName').value.trim() || 'index.html';
  if(!/\.html?$/i.test(name)) name += '.html';
  download(name, exportHTML());
  toast(t('Downloaded! That file is your website'));
});
$('#copyExport').addEventListener('click', async ()=>{
  if(!clientMode){ closeModals(); renderAccessModal(true); openModal('accessModal'); return; }
  try{ await navigator.clipboard.writeText(exportHTML()); toast(t('HTML copied to clipboard')); }
  catch(e){ toast(t('Copy blocked by the browser. Use Download instead')); }
});
$('#openExportPreview').addEventListener('click', ()=> previewSite());
$('#previewBtn').addEventListener('click', ()=>{
  if(!state.blocks.length) return toast(t('Your page is empty. Add a block first'));
  previewSite();
});
function previewSite(){
  let html = exportHTML();
  const url = URL.createObjectURL(new Blob([html],{type:'text/html'}));
  const w = window.open(url,'_blank');
  if(!w) toast(t('Pop-up blocked. Allow pop-ups to preview'));
  setTimeout(()=>URL.revokeObjectURL(url), 30000);
}

/* =============== SAVE / LOAD =============== */
const LS_KEY = 'loopbuilder-page';
/* Drafts: the current page autosaves to LS_KEY as before, and an index of every draft on this device lives in
   DRAFTS_KEY (id, title, updated) with each draft body under DRAFT_PREFIX+id, so several sites can be kept and
   switched without exporting project files. */
const DRAFTS_KEY = 'loopbuilder-drafts', DRAFT_PREFIX = 'loopbuilder-draft-';
function draftsIndex(){ try{ return JSON.parse(localStorage.getItem(DRAFTS_KEY)||'[]'); }catch(e){ return []; } }
function saveDraftsIndex(list){ try{ localStorage.setItem(DRAFTS_KEY, JSON.stringify(list.slice(0,30))); }catch(e){} }
function persistDraft(json){
  if (!state.meta.draftId) state.meta.draftId = uid();
  const id = state.meta.draftId;
  if (!state.blocks.length){ saveDraftsIndex(draftsIndex().filter(d=>d.id!==id)); try{ localStorage.removeItem(DRAFT_PREFIX+id); }catch(e){} return; }
  try{ localStorage.setItem(DRAFT_PREFIX+id, json); }catch(e){ return; }
  const list = draftsIndex().filter(d=>d.id!==id);
  list.unshift({ id, title: state.meta.title || 'Untitled', updated: Date.now(), blocks: state.blocks.length, slug: state.meta.slug || '', site: siteRefOf(state), from: state.meta.importedFrom || '' });
  saveDraftsIndex(list);
}
function openDraft(id){
  if (TEMP.pages[id]){ state = TEMP.pages[id]; selectedId = null; history = []; future = []; afterStateSwap(); closeModals(); return; }
  let data=null; try{ data = JSON.parse(localStorage.getItem(DRAFT_PREFIX+id)||'null'); }catch(e){}
  if (!data || !data.blocks){ toast(t('That draft could not be opened')); return; }
  snapshot(); state = data; selectedId = null; afterStateSwap(); closeModals();
  toast(t('Draft opened'));
}
function deleteDraft(id){
  try{ localStorage.removeItem(DRAFT_PREFIX+id); }catch(e){}
  saveDraftsIndex(draftsIndex().filter(d=>d.id!==id));
  renderDrafts();
}
/* ---- Projects list: one folder per imported site, plus "My drafts" for hand-made pages ---- */
const FOLDERS_KEY = 'loopbuilder-folders';
function folderNames(){ try{ return JSON.parse(localStorage.getItem(FOLDERS_KEY)||'{}'); }catch(e){ return {}; } }
function setFolderName(id, name){ const m = folderNames(); m[id] = name; try{ localStorage.setItem(FOLDERS_KEY, JSON.stringify(m)); }catch(e){} }
const hostOf = u => { try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return ''; } };
/* older index entries know nothing about their site: read the draft once and fill it in */
function migrateIndex(){
  const list = draftsIndex(); let changed = false;
  for (const d of list){
    if (d.site !== undefined && d.from !== undefined) continue;
    let st = null; try{ st = JSON.parse(localStorage.getItem(DRAFT_PREFIX + d.id) || 'null'); }catch(e){}
    d.site = st ? siteRefOf(st) : ''; d.from = st && st.meta ? (st.meta.importedFrom || '') : ''; d.slug = d.slug || (st && st.meta ? st.meta.slug || '' : ''); changed = true;
  }
  if (changed) saveDraftsIndex(list);
  return list;
}
function deleteFolder(site){
  const list = draftsIndex().filter(d => (d.site||'') === site);
  let wasCurrent = (siteRefOf(state) || '') === site && !isTemp() && list.some(d => d.id === state.meta.draftId);
  list.forEach(d => { try{ localStorage.removeItem(DRAFT_PREFIX + d.id); }catch(e){} });
  saveDraftsIndex(draftsIndex().filter(d => (d.site||'') !== site));
  Object.values(TEMP.pages).forEach(st => { if ((siteRefOf(st)||'') === site){ if (st.meta.draftId === state.meta.draftId) wasCurrent = true; delete TEMP.pages[st.meta.draftId]; } });
  try{ localStorage.removeItem(SITE_CSS_PREFIX + site); }catch(e){} delete siteCssMem[site];
  if (wasCurrent){ state = freshState(); selectedId = null; history = []; future = []; afterStateSwap(); }
}
function renderDrafts(){
  const box = $('#draftList'); if (!box) return;
  const names = folderNames();
  const when = ts => { const d = Date.now()-ts; return d<60000 ? t('just now') : d<3600000 ? Math.round(d/60000)+' min' : d<86400000 ? Math.round(d/3600000)+' h' : new Date(ts).toLocaleDateString(); };
  const cur = state.meta.draftId;
  /* rows: saved drafts (empty leftovers hidden) and unsaved imported pages, all in one shape */
  const rows = [];
  for (const d of migrateIndex()){ if (!d.blocks && d.id !== cur) continue; rows.push({ id: d.id, title: d.title, blocks: d.blocks||0, updated: d.updated||0, slug: d.slug||'', site: d.site||'', from: d.from||'', temp: false }); }
  for (const st of Object.values(TEMP.pages)){ if (rows.some(r => r.id === st.meta.draftId)) continue; rows.push({ id: st.meta.draftId, title: st.meta.title, blocks: st.blocks.length, updated: Date.now(), slug: st.meta.slug||'', site: siteRefOf(st)||'', from: st.meta.importedFrom||'', temp: true }); }
  if (isTemp() && !rows.some(r => r.id === cur)) rows.push({ id: cur, title: state.meta.title, blocks: state.blocks.length, updated: Date.now(), slug: state.meta.slug||'', site: siteRefOf(state)||'', from: state.meta.importedFrom||'', temp: true });
  /* group by site; the folder holding the open page comes first, then newest first */
  const groups = new Map();
  for (const r of rows){ const k = r.site; if (!groups.has(k)) groups.set(k, { site: k, rows: [], updated: 0, from: '' }); const g = groups.get(k); g.rows.push(r); g.updated = Math.max(g.updated, r.updated); if (!g.from && r.from) g.from = r.from; }
  const ordered = [...groups.values()].sort((a, b) => (b.rows.some(r=>r.id===cur) - a.rows.some(r=>r.id===cur)) || (b.updated - a.updated));
  const rowHTML = r => `<div class="draft ${r.temp?'temp':''} ${r.id===cur?'on':''}">
      <div class="dn"><b>${esc(r.title||'Untitled')}</b><span>${r.slug ? '/' + (r.slug==='index'?'':r.slug) + ' · ' : ''}${r.blocks} ${t('blocks')} · ${r.temp ? t('not saved') : when(r.updated)}${r.id===cur?' · '+t('open now'):''}</span></div>
      ${r.id===cur?'':`<button data-open="${r.id}">${t('Open')}</button>`}
      ${r.temp ? `<button data-tsave="${r.id}">${t('Save')}</button><button class="del" data-tdiscard="${r.id}" title="${t('Discard')}">✕</button>` : `<button class="del" data-delete="${r.id}" title="${t('Delete draft')}">✕</button>`}
    </div>`;
  box.innerHTML = ordered.length ? ordered.map(g => {
    const rowsSorted = g.rows.sort((a,b) => (a.slug==='index'?-1:b.slug==='index'?1:0) || (b.updated - a.updated));
    const unsaved = g.rows.filter(r => r.temp).length;
    const open = g.rows.some(r => r.id===cur) || ordered.length === 1;
    if (!g.site) return `<details class="folder" ${open?'open':''}><summary><span class="fname">📝 ${t('My drafts')}</span><span class="fmeta">${g.rows.length} ${t('pages')}</span></summary><div class="frows">${rowsSorted.map(rowHTML).join('')}</div></details>`;
    const day = new Date(Math.min(...g.rows.map(r => r.updated || Date.now()))).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const name = names[g.site] || ((hostOf(g.from) || t('Imported site')) + ' · ' + day);
    return `<details class="folder ${unsaved?'has-temp':''}" ${open?'open':''} data-folder="${g.site}">
      <summary>
        <span class="fname">📁 ${esc(name)}</span>
        <span class="fmeta">${g.rows.length} ${t('pages')}${unsaved ? ` · <em>${unsaved} ${t('not saved')}</em>` : ''}</span>
        <span class="factions">${unsaved ? `<button data-fsave="${g.site}">${t('Save all')}</button>` : ''}<button data-frename="${g.site}" title="${t('Rename folder')}">✎</button><button class="del" data-fdel="${g.site}" title="${t('Delete folder')}">✕</button></span>
      </summary>
      <div class="frows">${rowsSorted.map(rowHTML).join('')}</div>
    </details>`;
  }).join('') : `<div class="empty-note">${t('No other drafts on this device yet.')}</div>`;
  const stop = fn => e => { e.preventDefault(); e.stopPropagation(); fn(e); };
  $$('[data-open]',box).forEach(b=>b.addEventListener('click',()=>openDraft(b.dataset.open)));
  $$('[data-tsave]',box).forEach(b=>b.addEventListener('click',()=>{ if (saveTempPage(b.dataset.tsave)) toast(t('Saved on this device')); updateTempUI(); renderDrafts(); }));
  $$('[data-tdiscard]',box).forEach(b=>b.addEventListener('click',()=>{ if (confirm(t('Discard this imported page? It is not stored anywhere.'))){ discardTemp(b.dataset.tdiscard); renderDrafts(); } }));
  $$('[data-fsave]',box).forEach(b=>b.addEventListener('click', stop(()=>{ const site=b.dataset.fsave; let n=0; Object.values(TEMP.pages).filter(st=>(siteRefOf(st)||'')===site).forEach(st=>{ if (saveTempPage(st.meta.draftId)) n++; }); if (isTemp() && (siteRefOf(state)||'')===site && saveTempPage(state.meta.draftId)) n++; updateTempUI(); renderDrafts(); toast(n + ' ' + t('pages saved on this device')); })));
  $$('[data-frename]',box).forEach(b=>b.addEventListener('click', stop(()=>{ const site=b.dataset.frename; const curName = b.closest('summary').querySelector('.fname').textContent.replace(/^📁\s*/,''); const v = prompt(t('Folder name'), curName); if (v && v.trim()){ setFolderName(site, v.trim().slice(0,40)); renderDrafts(); } })));
  $$('[data-fdel]',box).forEach(b=>b.addEventListener('click', stop(()=>{ const n = b.closest('details').querySelectorAll('.draft').length; if (confirm(t('Delete this folder and its') + ' ' + n + ' ' + t('pages? This cannot be undone.'))){ deleteFolder(b.dataset.fdel); renderDrafts(); } })));
  $$('[data-delete]',box).forEach(b=>b.addEventListener('click',()=>{ if(confirm(t('Delete this draft? This cannot be undone.'))) { const wasCurrent = b.dataset.delete===state.meta.draftId; deleteDraft(b.dataset.delete); if (wasCurrent){ state = freshState(); selectedId=null; history=[]; future=[]; afterStateSwap(); } renderDrafts(); } }));
}

let saveT;
function autosave(){
  const st = $('#saveState');
  st.classList.remove('saved'); st.querySelector('.t').textContent = t('Saving…');
  clearTimeout(saveT);
  saveT = setTimeout(()=>{
    if (isTemp()){ TEMP.pages[state.meta.draftId] = state; updateTempUI(); return; }
    try{
      const json = JSON.stringify(state);
      if (json.length > 4500000) throw new Error('big');
      localStorage.setItem(LS_KEY, json);
      persistDraft(json);
      st.classList.add('saved'); st.querySelector('.t').textContent=t('Saved');
    }
    catch(e){
      st.querySelector('.t').textContent=t('Not saved');
      if (!autosave._warned){ autosave._warned = true; toast(t('Draft too large to autosave. Download a project file to keep it safe.')); }
    }
  }, 400);
}
$('#jsonBtn').addEventListener('click', ()=>{ renderDrafts(); openModal('jsonModal'); });
$('#newDraft').addEventListener('click', ()=>{ closeModals(); state = freshState(); selectedId=null; history=[]; future=[]; afterStateSwap(); openTemplates(); });
$('#dlJson').addEventListener('click', ()=>{
  const refs = {}; state.blocks.forEach(b=>{ if (b.type==='html' && b.props.cssRef) refs[b.props.cssRef] = siteCss(b.props.cssRef); });
  const out = Object.keys(refs).length ? Object.assign({}, state, { siteCss: refs }) : state;
  download(slug(state.meta.title)+'.loop.json', JSON.stringify(out,null,2), 'application/json');
  toast(t('Project file downloaded'));
});
$('#upJson').addEventListener('click', ()=> $('#jsonFile').click());
$('#jsonFile').addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ()=>{
    try{
      const data = JSON.parse(r.result);
      if(!data.blocks || !data.theme || !data.meta) throw 0;
      snapshot(); state = data; selectedId=null; afterStateSwap();
      closeModals();
      toast(t('Project loaded'));
    }catch(err){ toast(t('That file isn\u2019t a Loop Builder project')); }
  };
  r.readAsText(f); e.target.value='';
});
$('#resetBtn').addEventListener('click', ()=>{
  if(!confirm(t('_resetConfirm'))) return;
  snapshot(); state = freshState(); selectedId=null; afterStateSwap();
  closeModals();
  openTemplates();
});

/* =============== IMPORT FROM A WEBSITE =============== */
/* /api/import fetches the page server-side and maps it to blocks; here we only fill in defaults,
   pick a matching palette/font, and let the user decide: new draft or append. */
let importedPage = null;
let importMode = 'blocks'; let importWhole = false; let importRaw = false; // exact copy retired from the UI: blocks are the product
$('#importSite').addEventListener('click', ()=>{ importWhole = !importWhole; $('#importSite').classList.toggle('on', importWhole); $('#importSite').setAttribute('aria-checked', String(importWhole)); $('#importResult').hidden = true; importedPage = null; });
const IMPORT_MODE_NOTE = { exact: 'The page looks the same as the original: its layout, styles and images, as one editable block. Scripts are left out.', blocks: 'We read the headline, sections, prices, questions, photos and contact details and rebuild them as separate blocks in your chosen design.' };
function normaliseImported(page){
  if (page.exact){
    const x = page.exact;
    return [{ id: uid(), type: 'html', props: Object.assign(clone(BLOCKS.html.defaults), { scopeId: x.scopeId, rootClass: x.rootClass||'', rootStyle: x.rootStyle||'', rootLang: x.rootLang||'', rootDir: x.rootDir||'', html: x.html||'', css: x.css||'', fonts: x.fonts||[] }) }];
  }
  const blocks = (page.blocks||[]).filter(b => BLOCKS[b.type]).map(b => ({ id: uid(), type: b.type, props: Object.assign(clone(BLOCKS[b.type].defaults), b.props||{}) }));
  return blocks;
}
let importAbort = null;
const IMPORT_ERR = d => ({ 'consent': t('Please confirm you own the site or have permission to rebuild it.'), 'no-browser': t('Our server could not open this page in a browser') + (d.detail ? ' (' + d.detail + ')' : '') + '. ' + t('Try again in a minute. If you only need the plain HTML, turn on the raw HTML option above.'), 'bad-url': t('That does not look like a web address.'), 'blocked-host': t('That address cannot be fetched from our server.'), 'not-html': t('That address is not a web page.'), 'not-found': t('The page could not be found (it may block bots or need a login).'), 'unreachable': t('The site did not respond.'), 'timeout': t('The site took too long to respond.') }[d.reason] || t('Could not read that site. Try its homepage address.'));
/* top-level CSS rules (at-rule blocks kept whole) so identical rules from different pages can be stored once */
function splitCssRules(css){
  const out = []; let depth = 0, start = 0, q = null;
  for (let i = 0; i < css.length; i++){
    const ch = css[i];
    if (q){ if (ch === q && css[i-1] !== '\\') q = null; continue; }
    if (ch === '"' || ch === "'"){ q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}'){ depth--; if (depth === 0){ const r = css.slice(start, i + 1).trim(); if (r) out.push(r); start = i + 1; } }
    else if (ch === ';' && depth === 0){ const r = css.slice(start, i + 1).trim(); if (r) out.push(r); start = i + 1; }
  }
  const tail = css.slice(start).trim(); if (tail) out.push(tail);
  return out;
}
const normUrlC = u => { try { const U = new URL(u); U.hash = ''; U.search = ''; return U.origin + U.pathname.replace(/\/index\.(html?|php)$/i, '/').replace(/\/+$/, ''); } catch { return ''; } };
async function importWholeSite(url, mode = 'exact'){
  const err = $('#importErr'); const prog = $('#importProgress'); const txt = $('#importProgressText'); const bar = $('#importProgressBar');
  const post = async body => { const r = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(Object.assign({ allowRaw: importRaw, consent: true }, body)), signal: importAbort.signal }); if (r.status === 401) throw new Error('session'); return r.json(); };
  importAbort = new AbortController(); let stopped = false;
  $('#importCancel').onclick = () => { stopped = true; importAbort.abort(); };
  prog.hidden = false; bar.style.width = '2%'; txt.textContent = t('Finding the pages of this site…');
  const first = await post({ url, mode: 'links' });
  if (!first.ok){ prog.hidden = true; err.textContent = IMPORT_ERR(first); return null; }
  const list = first.pages; const scopeId = 'imp-' + Math.random().toString(16).slice(2, 8).padEnd(6, '0');
  const pages = [], skipped = [], order = [], sheetCss = {}, seenRules = new Set(); let overrides = ''; const fonts = new Set(); let rendered = !!first.rendered;
  const rewriteAll = () => {
    const target = new Map(); pages.forEach(p => target.set(normUrlC(p.url), p.slug === 'index' ? '/' : '/' + p.slug));
    const fix = h => { if (typeof h !== 'string' || !/^https?:/i.test(h)) return h; const tg = target.get(normUrlC(h)); if (!tg) return h; const hash = (h.match(/#.*$/) || [''])[0]; return tg + hash; };
    pages.forEach(p => {
      if (p.exact){ p.exact.html = p.exact.html.replace(/href="([^"]+)"/gi, (m, h) => { const f = fix(h); return f === h ? m : `href="${f}"`; }); return; }
      /* blocks: every link-shaped prop, on the block and on its items, points at the new page when it named an imported one */
      const KEYS = /^(href|link|url|primaryHref|secondaryHref|ctaHref)$/;
      (p.blocks || []).forEach(b => { for (const k in b.props){ if (KEYS.test(k)) b.props[k] = fix(b.props[k]); if (Array.isArray(b.props[k])) b.props[k].forEach(it => { if (it && typeof it === 'object') for (const kk in it) if (KEYS.test(kk)) it[kk] = fix(it[kk]); }); } });
    });
  };
  for (let i = 0; i < list.length; i++){
    if (stopped) break;
    const pg = list[i];
    txt.textContent = t('Copying page') + ' ' + (i+1) + ' ' + t('of') + ' ' + list.length + ': /' + (pg.slug === 'index' ? '' : pg.slug);
    bar.style.width = Math.round(4 + 94 * i / list.length) + '%';
    let d;
    try { d = await post(mode === 'blocks' ? { url: pg.url, mode: 'blocks' } : { url: pg.url, mode: 'exact', split: true, scopeId, have: order }); }
    catch (e){ if (stopped) break; skipped.push({ url: pg.url, reason: 'network' }); continue; }
    if (!d.ok){ skipped.push({ url: pg.url, reason: d.reason }); continue; }
    if (mode === 'blocks'){
      pages.push({ url: d.source || pg.url, slug: pg.slug, meta: Object.assign({}, d.page.meta, { slug: pg.slug }), blocks: d.page.blocks || [], theme: d.page.theme || null, found: (d.found || []).slice(-1) });
      rendered = rendered || !!d.rendered; continue;
    }
    const x = d.page.exact;
    (x.sheets || []).forEach(sh => { if (!(sh.href in sheetCss) && sh.css !== null){ sheetCss[sh.href] = sh.css; order.push(sh.href); } else if (!(sh.href in sheetCss)) { sheetCss[sh.href] = ''; order.push(sh.href); } });
    /* styles a page carries inline (CSS-in-JS apps repeat most of them on every page): each rule is kept once, shared */
    let pageCss = '';
    if (x.css){ const own = []; for (const rule of splitCssRules(x.css)){ if (seenRules.has(rule)) continue; seenRules.add(rule); own.push(rule); } if (own.length){ const key = 'inline:' + pages.length; sheetCss[key] = own.join('\n'); order.push(key); } }
    overrides = overrides || x.overrides || ''; (x.fonts || []).forEach(f => fonts.add(f)); rendered = rendered || !!d.rendered;
    pages.push({ url: d.source || pg.url, slug: pg.slug, meta: Object.assign({}, d.page.meta, { slug: pg.slug }), exact: { scopeId, cssRef: scopeId, rootClass: x.rootClass||'', rootStyle: x.rootStyle||'', rootLang: x.rootLang||'', rootDir: x.rootDir||'', html: x.html||'', css: pageCss, fonts: [] }, found: d.found.slice(-1) });
  }
  prog.hidden = true;
  if (!pages.length){ err.textContent = stopped ? t('Stopped before any page was copied.') : t('None of the pages could be copied.'); return null; }
  rewriteAll();
  const sharedCss = mode === 'blocks' ? '' : order.map(h => sheetCss[h] || '').join('\n') + '\n' + overrides;
  const found = [
    pages.length + ' ' + t(mode === 'blocks' ? 'pages rebuilt as blocks' : 'pages copied') + (skipped.length ? ', ' + skipped.length + ' ' + t('skipped') : '') + (stopped ? ' (' + t('stopped early') + ')' : ''),
    mode === 'blocks' ? (pages.reduce((a, p) => a + (p.blocks || []).length, 0) + ' ' + t('blocks in total') + (pages[0] && pages[0].theme && pages[0].theme.accent ? ', ' + t('brand colour') + ' ' + pages[0].theme.accent : '')) : order.length + ' ' + t('stylesheets shared across the pages') + ' (' + Math.round(sharedCss.length / 1024) + ' KB)' + (fonts.size ? ', ' + fonts.size + ' Google Fonts' : ''),
    ...pages.map(p => (p.slug === 'index' ? '/' : '/' + p.slug) + ': “' + (p.meta.title || '').slice(0, 44) + '”')
  ];
  const warn = [rendered ? t('Pages were opened in a browser first, so content built by scripts is included.') : t('Pages were read as raw HTML; content built by scripts may be missing.')];
  if (skipped.length) warn.push(t('Skipped') + ': ' + skipped.slice(0, 6).map(sk => { try { return new URL(sk.url).pathname; } catch { return sk.url; } }).join(', '));
  warn.push(t('Scripts were removed: menus, sliders and forms that relied on them will not run. Links between the copied pages point at the new pages; other links still go to the original site.'));
  return { site: { scopeId, sharedCss, fonts: [...fonts], pages, skipped, mode }, found, warn };
}
async function runImport(){
  const url = ($('#importUrl').value||'').trim();
  const err = $('#importErr'); err.textContent = '';
  $('#importResult').hidden = true; importedPage = null;
  if (!url){ err.textContent = t('Paste a web address first.'); return; }
  if (!$('#importConsent').checked){ err.textContent = t('Please confirm you own the site or have permission to rebuild it.'); return; }
  const go = $('#importGo'); go.disabled = true; go.textContent = importMode==='exact' && importWhole ? t('Reading the site, this can take a while…') : t('Reading…');
  if (importWhole){
    try{
      const r = await importWholeSite(url, importMode==='exact' ? 'exact' : 'blocks');
      if (r){
        importedPage = { site: r.site };
        $('#importUse').textContent = t('Create') + ' ' + r.site.pages.length + ' ' + t('drafts, one per page');
        $('#importAppend').hidden = true;
        $('#importFound').innerHTML = r.found.map(f => `<li>${esc(f)}</li>`).join('') + r.warn.map(w => `<li style="list-style:none;color:#8a5a12">⚠ ${esc(w)}</li>`).join('');
        $('#importNote').textContent = t('Each page becomes its own draft (see Projects). Open one, edit text and pictures in place, then Export it as slug.html; the menus already link the pages to each other.');
        $('#importResult').hidden = false;
      }
    }catch(e){ $('#importProgress').hidden = true; err.textContent = e && e.message === 'session' ? t('Your session has expired. Sign in again.') : t('Could not reach the server. Check your connection.'); }
    finally{ go.disabled = false; go.textContent = t('Read the site'); }
    return;
  }
  try{
    const r = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url, mode: importMode==='exact' ? 'exact' : 'blocks', allowRaw: importRaw, consent: true }) });
    if (r.status === 401){ err.textContent = t('Your session has expired. Sign in again.'); return; }
    const d = await r.json();
    if (!d.ok){
      err.textContent = IMPORT_ERR(d);
      return;
    }
    importedPage = d.site ? { site: d.site } : d.page;
    $('#importUse').textContent = d.site ? t('Create') + ' ' + d.site.pages.length + ' ' + t('drafts, one per page') : t('Use this as a new draft');
    $('#importAppend').hidden = !!d.site;
    $('#importFound').innerHTML = (d.found||[]).map(f => `<li>${esc(f)}</li>`).join('') + (d.warn||[]).map(w => `<li style="list-style:none;color:#8a5a12">⚠ ${esc(w)}</li>`).join('') || `<li>${t('A page, but no recognisable sections. You will get a headline and a footer to start from.')}</li>`;
    $('#importNote').textContent = d.site ? t('Each page becomes its own draft (see Projects). Open one, edit text and pictures in place, then Export it as slug.html; the menus already link the pages to each other.') : d.page.exact ? t('Images still load from the original site. Select the block and use “Copy images and fonts to BlinkLoop storage” to make the copy independent. Click any text on the page to edit it.') : t('Images still point at the original site. Replace them from the block panel once the page is yours. Colours and fonts are matched where the site declares them; everything else stays editable.');
    $('#importResult').hidden = false;
  }catch(e){ err.textContent = t('Could not reach the server. Check your connection.'); }
  finally{ go.disabled = false; go.textContent = t('Read the site'); }
}
function saveDraftState(st){
  try{ localStorage.setItem(DRAFT_PREFIX + st.meta.draftId, JSON.stringify(st)); }catch(e){ return false; }
  const list = draftsIndex().filter(d=>d.id!==st.meta.draftId);
  list.unshift({ id: st.meta.draftId, title: st.meta.title || 'Untitled', updated: Date.now(), blocks: st.blocks.length, slug: st.meta.slug || '', site: siteRefOf(st), from: st.meta.importedFrom || '' });
  saveDraftsIndex(list); return true;
}
function applyImportedTheme(fresh, th){
  if (!th) return;
  if (th.accent){ fresh.theme.accent = th.accent; fresh.theme.palette = 'custom'; if (th.accent2) fresh.theme.accent2 = th.accent2; }
  if (th.bg){ fresh.theme.bg = th.bg; fresh.theme.palette = 'custom'; }
  if (th.ink){ fresh.theme.ink = th.ink; fresh.theme.palette = 'custom'; }
  if (th.fontCustom && th.fontCustom.disp){ fresh.theme.fontCustom = th.fontCustom; fresh.theme.font = 'custom'; }
  else if (th.font && FONTS[th.font]) fresh.theme.font = th.font;
  if (th.btn) fresh.theme.btn = th.btn;
  if (th.radius !== undefined && th.radius !== null) fresh.theme.radius = th.radius;
}
function applyImportedSite(S){
  if (S.sharedCss) storeSiteCss(S.scopeId, S.sharedCss, false);
  const ids = [];
  const siteTheme = (S.pages.find(p => p.slug === 'index') || S.pages[0] || {}).theme || null;
  S.pages.forEach(pg => {
    const st = freshState(); const x = pg.exact;
    st.meta.title = pg.meta.title || pg.slug; st.meta.desc = pg.meta.desc || ''; st.meta.importedFrom = pg.url; st.meta.slug = pg.slug; st.meta.draftId = uid();
    if (!x){ applyImportedTheme(st, siteTheme || pg.theme); st.blocks = normaliseImported({ blocks: pg.blocks }); st.meta.site = S.scopeId; st.meta.ephemeral = true; TEMP.pages[st.meta.draftId] = st; ids.push(st.meta.draftId); return; }
    st.blocks = [{ id: uid(), type: 'html', props: Object.assign(clone(BLOCKS.html.defaults), { scopeId: S.scopeId, cssRef: S.scopeId, rootClass: x.rootClass||'', rootStyle: x.rootStyle||'', rootLang: x.rootLang||'', rootDir: x.rootDir||'', html: x.html||'', css: x.css||'', fonts: S.fonts||[] }) }];
    st.meta.ephemeral = true; TEMP.pages[st.meta.draftId] = st; ids.push(st.meta.draftId);
  });
  state = TEMP.pages[ids[0]]; history = []; future = []; selectedId = null; afterStateSwap();
  importedPage = null; closeModals(); $('#importUrl').value = ''; $('#importResult').hidden = true;
  toast(ids.length + ' ' + t('pages imported. Nothing is stored yet: click a menu link to move between pages, and Save the ones you want to keep.'));
}
function applyImported(mode){
  if (!importedPage) return;
  if (importedPage.site){ applyImportedSite(importedPage.site); return; }
  const blocks = normaliseImported(importedPage);
  snapshot();
  if (mode === 'append'){
    state.blocks = state.blocks.concat(blocks.filter(b => !(b.type==='navbar' && state.blocks.some(x=>x.type==='navbar')) && !(b.type==='footer' && state.blocks.some(x=>x.type==='footer'))));
  } else {
    const fresh = freshState();
    fresh.meta.title = importedPage.meta.title || fresh.meta.title;
    fresh.meta.desc = importedPage.meta.desc || '';
    fresh.meta.importedFrom = importedPage.meta.importedFrom || '';
    if (importedPage.theme){
      applyImportedTheme(fresh, importedPage.theme);
    }
    fresh.blocks = blocks;
    fresh.meta.draftId = uid(); fresh.meta.ephemeral = true; TEMP.pages[fresh.meta.draftId] = fresh;
    state = fresh; history = []; future = [];
  }
  selectedId = null; importedPage = null;
  afterStateSwap(); closeModals();
  $('#importUrl').value = ''; $('#importResult').hidden = true;
  toast(mode === 'append' ? t('Imported. Every block is editable now.') : t('Imported. Nothing is stored yet: press Save when you want to keep this page.'));
}
$('#importForm').addEventListener('submit', e => { e.preventDefault(); runImport(); });
$('#importUse').addEventListener('click', () => applyImported('new'));
$('#importAppend').addEventListener('click', () => applyImported('append'));
$('#tplImport').addEventListener('click', () => { closeModals(); openModal('importModal'); setTimeout(()=>$('#importUrl').focus(), 50); });
$('#pjImport').addEventListener('click', () => { closeModals(); openModal('importModal'); setTimeout(()=>$('#importUrl').focus(), 50); });

/* =============== INSERT PICKER =============== */
let insertAt = null;
function openPicker(idx){
  insertAt = idx;
  $('#pickGrid').innerHTML = BLOCK_ORDER.map(ty=>{
    const d = BLOCKS[ty];
    return `<button class="tpl" data-pick="${ty}"><span class="em">${d.icon}</span><span class="nm">${t(d.name)}</span><span class="ds">${t(d.desc)}</span></button>`;
  }).join('');
  $$('#pickGrid [data-pick]').forEach(b=>b.addEventListener('click',()=>{
    closeModals();
    addBlock(b.dataset.pick, insertAt);
  }));
  openModal('pickModal');
}

/* =============== TEMPLATES =============== */
function freshState(){
  return { meta:{title:'My website',desc:'',lang:'en',currency:'PHP',siteUrl:'',ogImage:''},
    plugins:{ wa:{on:false,phone:'',msg:''}, ms:{on:false,page:''}, vb:{on:false,number:''}, ga:{on:false,id:''}, fbp:{on:false,id:''}, custom:{on:false,head:''}, priv:{on:false,email:''} }, theme:{ density:'normal', btn:'pill', width:'normal', scale:'normal', texture:'glow', look:'studio', motion:'on', ...themeFromPalette('ember'), font:'blink', radius:22}, blocks:[] };
}
function tplBlocks(types, overrides={}){
  return types.map(t=>{
    const b = { id:uid(), type:t, props:clone(BLOCKS[t].defaults) };
    if (overrides[t]) Object.assign(b.props, clone(overrides[t]));
    return b;
  });
}
const TEMPLATES = [
  { id:'blank', em:'⬜', name:'Blank', desc:'Empty canvas. You know what you\u2019re doing.',
    make(){ return freshState(); } },
  { id:'agency', em:'🎨', name:'Studio / Agency', desc:'Portfolio-forward with pricing and a strong CTA.',
    make(){ const s=freshState();
      s.meta.title='Studio site';
      s.blocks=tplBlocks(['navbar','hero','features','gallery','quotes','pricing','faq','cta','contact','footer']);
      return s; } },
  { id:'local', em:'🏪', name:'Local business', desc:'Menu/services, social proof, easy contact.',
    make(){ const s=freshState();
      s.meta.title='Business site';
      s.theme={...s.theme, ...themeFromPalette('moss'), font:'editorial'};
      s.blocks=tplBlocks(['navbar','hero','split','gallery','stats','quotes','faq','contact','footer'],{
        hero:{eyebrow:'Open daily · Cebu', title:'Good things, made *fresh*', sub:'Introduce the shop in one warm sentence. What do people come back for?', primary:'See the menu', primaryHref:'#gallery', secondary:'Visit us', secondaryHref:'#contact', layout:'split'},
        gallery:{title:'From the counter'}
      });
      return s; } },
  { id:'launch', em:'🚀', name:'Product launch', desc:'Centered hero, stats, FAQ. Built to convert.',
    make(){ const s=freshState();
      s.meta.title='Launch page';
      s.theme={...s.theme, ...themeFromPalette('slate'), font:'grotesk', radius:16};
      s.blocks=tplBlocks(['navbar','hero','stats','features','quotes','pricing','faq','cta','footer'],{
        hero:{layout:'center', eyebrow:'Now in early access', title:'The fastest way to *ship it*', sub:'One clear promise. What changes for the user the day they sign up?', primary:'Get early access', primaryHref:'#pricing', secondary:'How it works', secondaryHref:'#features'}
      });
      return s; } }
];
TEMPLATES.push(
  { id:'cafe', em:'☕', name:'Café / Restaurant', desc:'Menu gallery, story, map with hours, easy contact.',
    make(){ const s=freshState();
      s.meta.title='Café site';
      s.theme={...s.theme, ...themeFromPalette('moss'), font:'warm', radius:18, btn:'soft', texture:'dots'};
      s.blocks=tplBlocks(['navbar','banner','hero','gallery','text','map','quotes','contact','footer'],{
        hero:{eyebrow:'Open daily', title:'Coffee worth the *detour*', sub:'Say what people come back for, in one warm sentence.', primary:'See the menu', primaryHref:'#gallery', secondary:'Find us', secondaryHref:'#map', layout:'center', size:'tall'},
        gallery:{title:'From the counter', ratio:'square', cols:'3'},
        text:{eyebrow:'Our story', title:'Why we opened', body:'Two short paragraphs about the place and the people behind it.\n\nWhat do regulars say when they bring a friend for the first time?'},
        banner:{text:'New: weekend brunch, 8 to 11 AM.', label:'See the menu', href:'#gallery'}
      });
      return s; } },
  { id:'services', em:'🛠️', name:'Services / Contractor', desc:'Partners, process, proof, and a clear next step.',
    make(){ const s=freshState();
      s.meta.title='Services site';
      s.theme={...s.theme, ...themeFromPalette('ocean'), font:'grotesk', radius:14, btn:'soft', texture:'grid'};
      s.blocks=tplBlocks(['navbar','hero','logos','steps','features','stats','faq','cta','contact','footer'],{
        hero:{eyebrow:'Serving Cebu since 1996', title:'Installed right the *first time*', sub:'One sentence on the problem you solve and who you solve it for.', primary:'Book a consultation', primaryHref:'#contact', secondary:'How it works', secondaryHref:'#how'},
        features:{eyebrow:'Services', title:'What we do', iconStyle:'number'}
      });
      return s; } }
);
function openTemplates(){
  $('#tplGrid').innerHTML = TEMPLATES.map(tp=>`<button class="tpl" data-tpl="${tp.id}"><span class="em">${tp.em}</span><span class="nm">${t(tp.name)}</span><span class="ds">${t(tp.desc)}</span></button>`).join('');
  $$('#tplGrid .tpl').forEach(b=>b.addEventListener('click',()=>{
    state = TEMPLATES.find(t=>t.id===b.dataset.tpl).make();
    selectedId=null; history=[]; future=[];
    afterStateSwap();
    closeModals();
    let seen=false; try{ seen = localStorage.getItem('lb-guided')==='1'; }catch(e){}
    if(!seen){ openModal('guideModal'); try{ localStorage.setItem('lb-guided','1'); }catch(e){} }
    else toast(t('Loop started! Click any text on the page to edit it'));
  }));
  openModal('tplModal');
}

/* =============== CHROME WIRING =============== */
/* Small screens show one pane at a time: Blocks, the Page, or Edit (inspector). Above 880px every pane is
   visible and data-view is ignored by the CSS, so these calls are harmless there. */
function setView(v){
  document.body.dataset.view = v;
  $$('.mobile-nav button').forEach(b=>b.classList.toggle('on', b.dataset.view===v));
  if (v==='page' && frame.contentDocument && selectedId){ const el = $('.blk.sel', frame.contentDocument); if (el) el.scrollIntoView({block:'nearest'}); }
}
setView('page');
$$('.mobile-nav button').forEach(b=>b.addEventListener('click', ()=>setView(b.dataset.view)));
/* picking a block or a layer on a phone takes you back to the page to see it */
$('#lib').addEventListener('click', e=>{ if (isSmallChrome() && e.target.closest('.lib-item')) setTimeout(()=>setView('page'), 60); });
$('#layers').addEventListener('click', e=>{ if (isSmallChrome() && e.target.closest('.layer')) setTimeout(()=>setView('page'), 60); });
function syncChrome(){ const d = frame.contentDocument; if (d && d.body){ d.body.classList.toggle('m-chrome', isSmallChrome()); d.body.classList.toggle('r-hidden', document.body.classList.contains('hide-right') && !isSmallChrome()); } if (!isSmallChrome()) setView('page'); }
const PANELS_KEY = 'lb-panels';
function setPanel(side, hidden){
  document.body.classList.toggle('hide-' + side, hidden);
  try{ localStorage.setItem(PANELS_KEY, JSON.stringify({ left: document.body.classList.contains('hide-left'), right: document.body.classList.contains('hide-right') })); }catch(e){}
  syncChrome();
}
try{ const pp = JSON.parse(localStorage.getItem(PANELS_KEY) || '{}'); if (pp.left) document.body.classList.add('hide-left'); if (pp.right) document.body.classList.add('hide-right'); }catch(e){}
$('#toggleLeft').addEventListener('click', ()=>setPanel('left', !document.body.classList.contains('hide-left')));
$('#toggleRight').addEventListener('click', ()=>setPanel('right', !document.body.classList.contains('hide-right')));
smallChrome.addEventListener('change', syncChrome);
window.addEventListener('resize', syncChrome);
document.addEventListener('visibilitychange', syncChrome);
$('#pageTitle').addEventListener('change', e=>{ snapshot(); state.meta.title=e.target.value; autosave(); });
$('#undoBtn').addEventListener('click', undo);
$('#saveDraftBtn').addEventListener('click', saveCurrentDraft);
$('#redoBtn').addEventListener('click', redo);
$('#guideBtn').addEventListener('click', ()=> openModal('guideModal'));
$$('.tb-btn[data-dev]').forEach(b=>b.addEventListener('click',()=>{
  device=b.dataset.dev;
  $$('.tb-btn[data-dev]').forEach(x=>x.classList.toggle('on',x===b));
  $('#frameWrap').className='frame-wrap'+(device==='desktop'?'':' '+device);
  toast(device==='desktop'?t('Desktop view'):device==='tablet'?t('Tablet view, exactly how it responds'):t('Phone view, exactly how it responds'));
}));
$('#themeBtn').addEventListener('click',()=>{
  const cur=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',cur);
  try{ localStorage.setItem('bl-theme',cur); }catch(e){}
});
$$('.ptab[data-tab]').forEach(b=>b.addEventListener('click',()=>{
  $$('.ptab[data-tab]').forEach(x=>x.classList.toggle('on',x===b));
  $('#tab-blocks').hidden = b.dataset.tab!=='blocks';
  $('#tab-layers').hidden = b.dataset.tab!=='layers';
}));
$$('.ptab[data-rtab]').forEach(b=>b.addEventListener('click',()=>{
  $$('.ptab[data-rtab]').forEach(x=>x.classList.toggle('on',x===b));
  ['block','design','plugins','seo'].forEach(k=>{ $('#rtab-'+k).hidden = b.dataset.rtab!==k; });
  if (b.dataset.rtab==='plugins') renderPlugins();
  if (b.dataset.rtab==='seo') renderSEO();
}));
/* click outside or ✕ closes any modal, except the template chooser on an empty page */
$$('.modal-bg').forEach(m=>m.addEventListener('click',e=>{
  const isTpl = m.id==='tplModal';
  if (e.target===m || e.target.closest('[data-close]')){
    if (isTpl && (!state || !state.blocks.length)) return;
    if (m.id==='importModal' && (!state || !state.blocks.length)){ m.classList.remove('show'); openModal('tplModal'); return; }
    m.classList.remove('show');
  }
}));

document.addEventListener('keydown', e=>{
  const mod = e.ctrlKey||e.metaKey;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if(mod && e.key.toLowerCase()==='z' && !e.shiftKey && !typing){ e.preventDefault(); undo(); }
  else if(mod && (e.key.toLowerCase()==='y' || (e.key.toLowerCase()==='z'&&e.shiftKey)) && !typing){ e.preventDefault(); redo(); }
  else if(mod && e.key.toLowerCase()==='s'){ e.preventDefault(); saveCurrentDraft(); }
  else if(mod && e.key==='\\'){ e.preventDefault(); setPanel('right', !document.body.classList.contains('hide-right')); }
  else if(mod && e.key==='['){ e.preventDefault(); setPanel('left', !document.body.classList.contains('hide-left')); }
  else if(mod && e.key.toLowerCase()==='d' && selectedId && !typing){ e.preventDefault(); blockAction('dupe', selectedId); toast(t('Duplicated')); }
  else if(e.altKey && (e.key==='ArrowUp'||e.key==='ArrowDown') && selectedId && !typing){ e.preventDefault(); blockAction(e.key==='ArrowUp'?'up':'down', selectedId); }
  else if((e.key==='Delete'||e.key==='Backspace') && selectedId && !typing){ blockAction('del', selectedId); toast(t('Block removed. Ctrl+Z to undo')); }
  else if(e.key==='Escape'){
    const open = $$('.modal-bg.show').filter(m=>!(m.id==='tplModal' && (!state||!state.blocks.length)));
    if(open.length){ open.forEach(m=>m.classList.remove('show')); if (!state || !state.blocks.length) openModal('tplModal'); }
    else select(null);
  }
});

let toastT;
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2600);
}

/* =============== INIT =============== */
(function init(){
  renderLibrary();
  let saved=null;
  try{ saved = JSON.parse(localStorage.getItem(LS_KEY)); }catch(e){}
  if (saved && saved.blocks && saved.theme && saved.meta){
    state = saved;
    const fresh = freshState();
    state.meta = Object.assign(fresh.meta, state.meta);
    state.theme = Object.assign(fresh.theme, state.theme);
    state.plugins = state.plugins || fresh.plugins;
    $('#pageTitle').value = state.meta.title;
    applyLang();
  } else {
    state = freshState();
    applyLang();
    openTemplates();
  }
  renderLockScreen();
  updateHistoryBtns();
  checkAccess();
  $('#saveState').classList.add('saved'); $('#saveState .t').textContent='Saved';
})();
