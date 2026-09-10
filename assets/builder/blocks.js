/* Loop Builder, part 1 of 5: block registry (BLOCKS), theme + site CSS, render helpers, decorate(). Loaded by builder.html; classic scripts share one global scope, so the load order in builder.html matters. */
/* =====================================================
   Loop Builder | BlinkLoop
   Single-file block editor. Page = JSON tree of blocks.
   The same render functions power the canvas AND the
   exported site, so what you see is what ships.
   ===================================================== */
"use strict";

/* ---------- helpers ---------- */
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const smallChrome = matchMedia('(max-width:880px)'); // phones and small tablets: one pane at a time
function isSmallChrome(){ return smallChrome.matches; }
const uid = () => 'b' + Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escAttr = esc;
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- fonts & palettes ---------- */
const FONTS = {
  blink:   { name:'Unbounded + Sora', disp:"'Unbounded',sans-serif", body:"'Sora',system-ui,sans-serif", url:'family=Unbounded:wght@400;500;600;700&family=Sora:wght@400;500;600;700' },
  editorial:{ name:'Fraunces + Inter', disp:"'Fraunces',serif", body:"'Inter',system-ui,sans-serif", url:'family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700' },
  grotesk: { name:'Space Grotesk + IBM Plex Sans', disp:"'Space Grotesk',sans-serif", body:"'IBM Plex Sans',system-ui,sans-serif", url:'family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600' },
  classic: { name:'Playfair Display + Source Sans 3', disp:"'Playfair Display',serif", body:"'Source Sans 3',system-ui,sans-serif", url:'family=Playfair+Display:wght@500;600;700&family=Source+Sans+3:wght@400;500;600;700' },
  bold:    { name:'Archivo Black + Archivo', disp:"'Archivo Black',sans-serif", body:"'Archivo',system-ui,sans-serif", url:'family=Archivo+Black&family=Archivo:wght@400;500;600;700' },
  friendly:{ name:'Baloo 2 + Nunito', disp:"'Baloo 2',sans-serif", body:"'Nunito',system-ui,sans-serif", url:'family=Baloo+2:wght@500;600;700&family=Nunito:wght@400;600;700' },
  modern:  { name:'Manrope (clean, single family)', disp:"'Manrope',sans-serif", body:"'Manrope',system-ui,sans-serif", url:'family=Manrope:wght@400;500;600;700;800' },
  elegant: { name:'Cormorant Garamond + Lato', disp:"'Cormorant Garamond',serif", body:"'Lato',system-ui,sans-serif", url:'family=Cormorant+Garamond:wght@500;600;700&family=Lato:wght@400;700' },
  warm:    { name:'Lora + Work Sans', disp:"'Lora',serif", body:"'Work Sans',system-ui,sans-serif", url:'family=Lora:wght@500;600;700&family=Work+Sans:wght@400;500;600' }
};
/* Whole-site imports share one stylesheet: stored once on this device, referenced by cssRef on each page's block.
   Project files (.loop.json) carry it as state.siteCss so a draft can travel to another device. */
const SITE_CSS_PREFIX = 'loopbuilder-sitecss-'; const siteCssMem = {};
function siteCss(ref){ if (!ref) return ''; if (siteCssMem[ref] !== undefined) return siteCssMem[ref]; let v = ''; try{ v = localStorage.getItem(SITE_CSS_PREFIX + ref) || ''; }catch(e){} siteCssMem[ref] = v; return v; }
function storeSiteCss(ref, css, persist){ siteCssMem[ref] = css || ''; if (!persist) return; try{ localStorage.setItem(SITE_CSS_PREFIX + ref, css || ''); }catch(e){ toast(t('Not enough space on this device to keep the site styles. Export soon.')); } }
/* Imported pages live here, in memory only, until the user saves them (storage on a device is small and shared). */
const TEMP = { pages: {} };
const siteRefOf = st => { if (st && st.meta && st.meta.site) return st.meta.site; const b = (st && st.blocks || []).find(x => x.type==='html' && (x.props.cssRef || x.props.scopeId)); return b ? (b.props.cssRef || b.props.scopeId) : ''; };
function isTemp(){ return !!(state && state.meta && state.meta.ephemeral); }
/* which draft (in memory or saved) is page /slug of the same imported site */
function findPageId(slug, site){
  const tmp = Object.values(TEMP.pages).find(st => st.meta.slug === slug && (!site || siteRefOf(st) === site || !siteRefOf(st))); if (tmp) return tmp.meta.draftId;
  const d = draftsIndex().find(x => x.slug === slug && (!site || x.site === site)); return d ? d.id : null;
}
function persistSiteCssFor(st){ const ref = siteRefOf(st); if (ref && siteCssMem[ref] !== undefined) storeSiteCss(ref, siteCssMem[ref], true); }
function saveTempPage(id){
  const st = id === state.meta.draftId ? state : TEMP.pages[id]; if (!st) return false;
  delete st.meta.ephemeral; persistSiteCssFor(st);
  const ok = saveDraftState(st); if (!ok){ st.meta.ephemeral = true; toast(t('Not enough space on this device to save this page.')); return false; }
  delete TEMP.pages[id]; return true;
}
function saveCurrentDraft(){
  if (isTemp()){ if (saveTempPage(state.meta.draftId)){ autosave(); toast(t('Saved on this device')); } }
  else { autosave(); toast(t('Saved')); }
  updateTempUI();
}
function discardTemp(id){
  delete TEMP.pages[id];
  if (state.meta.draftId === id){
    const next = Object.keys(TEMP.pages)[0];
    if (next){ state = TEMP.pages[next]; } else { let saved = null; try{ saved = JSON.parse(localStorage.getItem(LS_KEY)); }catch(e){} state = saved && saved.blocks ? saved : freshState(); }
    selectedId = null; history = []; future = []; afterStateSwap();
  }
}
function updateTempUI(){
  const st = $('#saveState'); const btn = $('#saveDraftBtn');
  if (isTemp()){ st.classList.remove('saved'); st.classList.add('temp'); st.querySelector('.t').textContent = t('Not saved'); if (btn) btn.hidden = false; }
  else { st.classList.remove('temp'); if (btn) btn.hidden = true; }
}
window.addEventListener('beforeunload', e => { if (Object.keys(TEMP.pages).length || isTemp()){ e.preventDefault(); e.returnValue = ''; } });
const PALETTES = {
  ember: { name:'Ember',  bg:'#FFFCF7', ink:'#3A1B1E', accent:'#F45D2A', accent2:'#7F2027' },
  sunset:{ name:'Sunset', bg:'#FFF6F0', ink:'#33202A', accent:'#FF5E5B', accent2:'#FFB627' },
  forest:{ name:'Forest', bg:'#F7FAF5', ink:'#1E2B22', accent:'#2E7D5B', accent2:'#8C6A3F' },
  ocean: { name:'Ocean',  bg:'#F4F9FC', ink:'#122436', accent:'#0E7CD1', accent2:'#12B5A5' },
  mono:  { name:'Mono',   bg:'#FAFAF8', ink:'#141414', accent:'#141414', accent2:'#6E6E6E' },
  noir:  { name:'Noir',   bg:'#15100B', ink:'#F5EFE4', accent:'#EDA33F', accent2:'#E2836B' },
  tide:  { name:'Tide',   bg:'#F2F6F7', ink:'#10232B', accent:'#0E7C86', accent2:'#F4A259' },
  moss:  { name:'Moss',   bg:'#F4F2EA', ink:'#232B1E', accent:'#4A7C59', accent2:'#C97B2D' },
  slate: { name:'Slate',  bg:'#101418', ink:'#EDF1F5', accent:'#5B8DEF', accent2:'#EFB35B' },
  orchid:{ name:'Orchid', bg:'#FBF7FB', ink:'#2A1B2E', accent:'#8E4585', accent2:'#E0A458' }
};

/* ---------- state ---------- */
let state = null;          // {meta:{title,desc}, theme:{palette,accent,accent2,bg,ink,font,radius}, blocks:[{id,type,props}]}
let selectedId = null;
let history = [], future = [];
let device = 'desktop';

const themeFromPalette = key => { const p = PALETTES[key]; return { palette:key, bg:p.bg, ink:p.ink, accent:p.accent, accent2:p.accent2 }; };

/* ---------- site CSS (shared by canvas + export) ---------- */
/* the pairing in use; an imported site can bring its own Google font pair (theme.fontCustom) */
function fontOf(t){ return t.font==='custom' && t.fontCustom && t.fontCustom.disp ? t.fontCustom : (FONTS[t.font] || FONTS.blink); }
function fontLink(t){ const f = fontOf(t); return `https://fonts.googleapis.com/css2?${f.url || FONTS.blink.url}&display=swap`; }

/* text colour that stays readable on the accent, whatever the client picks */
function onAccent(hex){
  const m = String(hex||'').match(/^#([0-9a-f]{6})$/i); if(!m) return '#FFFDF7';
  const [r,g,b] = [0,2,4].map(i => parseInt(m[1].slice(i,i+2),16)/255).map(v => v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4));
  const L = 0.2126*r + 0.7152*g + 0.0722*b;
  return L > 0.42 ? '#1B1410' : '#FFFDF7';
}
const BTN_R = { pill:'999px', soft:'12px', sharp:'3px' };
const WRAP_W = { narrow:'960px', normal:'1140px', wide:'1320px' };
const T_SCALE = { compact:'0.94', normal:'1', large:'1.08' };
function siteCSS(t){
  const f = fontOf(t);
  return `
:root{
  --bg:${t.bg}; --ink:${t.ink}; --accent:${t.accent}; --accent2:${t.accent2}; --r:${t.radius}px;
  --secpad:${({compact:'60px',normal:'84px',roomy:'116px'})[t.density||'normal']};
  --muted:color-mix(in srgb, var(--ink) 58%, var(--bg));
  --line:color-mix(in srgb, var(--ink) 16%, transparent);
  --card:color-mix(in srgb, var(--ink) 5%, var(--bg));
  --card-2:color-mix(in srgb, var(--ink) 9%, var(--bg));
  --on-accent:${onAccent(t.accent)};
  --btn-r:${BTN_R[t.btn||'pill']}; --wrapw:${WRAP_W[t.width||'normal']}; --tscale:${T_SCALE[t.scale||'normal']};
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:${f.body};font-size:calc(16.5px * var(--tscale));line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{max-width:100%;display:block}
a{color:inherit;text-decoration:none}
h1,h2,h3{font-family:${f.disp};line-height:1.14;font-weight:600;letter-spacing:-.01em}
::selection{background:var(--accent);color:var(--on-accent)}
.wrap{max-width:var(--wrapw);margin:0 auto;padding:0 26px}
section{padding:var(--secpad) 0}
.imp-sec{padding:0;margin:0;background:transparent;position:relative;isolation:isolate;z-index:0}
.imp-root{font:16px/normal sans-serif;color:#000;text-align:start;letter-spacing:normal;-webkit-font-smoothing:auto;overflow-x:clip}
.imp-root{position:relative!important;inset:auto!important;overflow-y:visible!important;overflow-x:clip!important} /* a copied body rule like position:fixed must never pin the page to one screen */
.imp-root *{box-sizing:revert;margin:revert;padding:revert}
.imp-root img{max-width:revert;display:revert}
.imp-root a{color:revert;text-decoration:revert}
.imp-root h1,.imp-root h2,.imp-root h3{font:revert;line-height:revert;letter-spacing:revert}
.imp-root section{padding:revert}
.eyebrow{display:inline-block;padding:7px 15px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:.76rem;color:var(--muted);letter-spacing:.09em;text-transform:uppercase;font-weight:600}
.sec-head{max-width:640px;margin-bottom:46px}
.sec-head h2{font-size:clamp(1.7rem,3.4vw,2.5rem);margin:16px 0 12px}
.sec-head p{color:var(--muted);font-size:1.04rem}
.sec-head.center{margin-left:auto;margin-right:auto;text-align:center}
.btn{display:inline-block;padding:13px 28px;border-radius:var(--btn-r);font-weight:600;font-size:.95rem;transition:transform .3s cubic-bezier(.22,.8,.24,1),box-shadow .3s,background .3s;cursor:pointer;border:none;font-family:inherit}
.btn-solid{background:var(--accent);color:var(--on-accent)}
.btn-solid:hover{transform:translateY(-2px);box-shadow:0 10px 28px color-mix(in srgb, var(--accent) 45%, transparent)}
.btn-ghost{border:1.5px solid var(--line);background:transparent;color:var(--ink)}
.btn-ghost:hover{border-color:var(--accent);color:var(--accent);transform:translateY(-2px)}
.ph{background:linear-gradient(135deg, color-mix(in srgb,var(--accent) 78%, var(--ink)), var(--accent2));border-radius:var(--r);display:flex;align-items:center;justify-content:center;color:var(--on-accent);font-family:${f.disp};font-weight:600;overflow:hidden}
.ph img{width:100%;height:100%;object-fit:cover}

/* nav */
.nav{position:sticky;top:0;z-index:50;background:color-mix(in srgb, var(--bg) 84%, transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.nav .wrap{display:flex;align-items:center;justify-content:space-between;height:72px}
.nav .logo{font-family:${f.disp};font-weight:700;font-size:1.08rem;display:inline-flex;align-items:center;gap:10px}
.nav .logo img,.foot .logo img{height:34px;width:auto;display:block}
.nav.lg-sm .logo img{height:26px}.nav.lg-lg .logo img{height:48px}
.nav.lg-sm .logo{font-size:.95rem}.nav.lg-lg .logo{font-size:1.3rem}
.nav.nv-static{position:static}
.nav.nv-solid{background:var(--bg);backdrop-filter:none;-webkit-backdrop-filter:none}
.nav.nv-clear:not(.scrolled){background:transparent;border-bottom-color:transparent;backdrop-filter:none;-webkit-backdrop-filter:none}
.foot .logo{display:inline-flex;align-items:center;gap:10px}
.nav .logo b{color:var(--accent);font-weight:700}
.nav nav{display:flex;align-items:center;gap:30px;font-size:.9rem;color:var(--muted)}
.nav nav a:hover{color:var(--ink)}
.nav .btn{padding:9px 20px;font-size:.85rem}
.nav .mtoggle{display:none;background:none;border:none;color:var(--ink);font-size:1.5rem;cursor:pointer;line-height:1}

/* hero */
.hero{padding:112px 0 96px;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(720px 480px at 85% -10%, color-mix(in srgb,var(--accent) 14%, transparent), transparent 62%),radial-gradient(640px 460px at -8% 45%, color-mix(in srgb,var(--accent2) 13%, transparent), transparent 60%)}
.hero .wrap{position:relative}
.hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:52px;align-items:center}
.hero.center .hero-grid{grid-template-columns:1fr;text-align:center;max-width:780px;margin:0 auto}
.hero.center .hero-cta{justify-content:center}
.hero h1{font-size:clamp(2.3rem,5.2vw,3.9rem);margin:22px 0 20px}
.hero h1 em{font-style:normal;color:var(--accent)}
.hero .lede{font-size:1.13rem;color:var(--muted);max-width:33rem;margin-bottom:34px}
.hero.center .lede{margin-left:auto;margin-right:auto}
.hero-cta{display:flex;gap:14px;flex-wrap:wrap}
.hero .ph{aspect-ratio:4/3.4;font-size:2.6rem}

/* features */
.feat-grid{display:grid;gap:18px}
.feat-grid.c2{grid-template-columns:repeat(2,1fr)}
.feat-grid.c3{grid-template-columns:repeat(3,1fr)}
.feat-grid.c4{grid-template-columns:repeat(4,1fr)}
.feat{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px 24px;transition:transform .3s cubic-bezier(.22,.8,.24,1),box-shadow .3s}
.feat:hover{transform:translateY(-4px);box-shadow:0 14px 34px color-mix(in srgb,var(--ink) 10%, transparent)}
.feat .ic{font-size:1.6rem;margin-bottom:14px}
.feat.has-img{padding-top:0;overflow:hidden}
.feat .feat-img{display:block;width:calc(100% + 48px);max-width:none;margin:0 -24px 18px;aspect-ratio:16/10;object-fit:cover}
.feat.has-img .ic{margin-top:0}
.feat .feat-img.fit-contain{object-fit:contain;padding:18px;background:color-mix(in srgb, var(--accent) 6%, var(--bg))}
.feat-link{text-decoration:none;color:inherit;display:block;cursor:pointer}
.feat-link:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:color-mix(in srgb, var(--accent) 45%, var(--line))}
.feat-link h3{transition:color .2s}
.feat-link:hover h3{color:var(--accent)}
.feat h3{font-size:1.02rem;margin-bottom:8px}
.feat p{font-size:.9rem;color:var(--muted)}

/* split */
.split-grid{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
.split-grid .ph{aspect-ratio:4/3;font-size:2.2rem}
.split-grid h2{font-size:clamp(1.6rem,3vw,2.3rem);margin:14px 0 14px}
.split-grid .tx{color:var(--muted);font-size:1.02rem;white-space:pre-line;margin-bottom:26px}

/* stats */
.stats{padding:56px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:22px;text-align:center}
.stat .v{font-family:${f.disp};font-weight:700;font-size:clamp(1.8rem,3.4vw,2.6rem);color:var(--accent)}
.stat .l{color:var(--muted);font-size:.86rem;margin-top:4px}

/* pricing */
.price-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;align-items:stretch}
.plan{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:30px 26px;display:flex;flex-direction:column;position:relative}
.plan.hot{border-color:var(--accent);box-shadow:0 16px 44px color-mix(in srgb,var(--accent) 22%, transparent)}
.plan .tag{position:absolute;top:-13px;left:26px;background:var(--accent);color:var(--on-accent);font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:5px 13px;border-radius:999px}
.plan h3{font-size:1.05rem}
.plan .amount{font-family:${f.disp};font-weight:700;font-size:2.2rem;margin:14px 0 2px}
.plan .per{color:var(--muted);font-size:.84rem;margin-bottom:18px}
.plan ul{list-style:none;margin:0 0 26px;flex:1}
.plan li{padding:7px 0 7px 26px;position:relative;font-size:.9rem;color:var(--muted);border-bottom:1px dashed var(--line)}
.plan li:last-child{border-bottom:none}
.plan li::before{content:"✓";position:absolute;left:2px;color:var(--accent);font-weight:700}
.plan .btn{width:100%;text-align:center}

/* quotes */
.q-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
.q{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px}
.q .mark{color:var(--accent);font-family:${f.disp};font-size:2rem;line-height:.6;display:block;margin-bottom:14px}
.q p{font-size:.96rem;margin-bottom:18px}
.q .who{font-size:.82rem;color:var(--muted);display:flex;align-items:center;gap:12px}
.q .av{width:42px;height:42px;border-radius:50%;object-fit:cover;flex:none}
.q .stars{color:var(--accent);letter-spacing:2px;font-size:.92rem;margin:-6px 0 10px}
.q .stars span{opacity:.25}
.q .who b{color:var(--ink);display:block;font-size:.88rem}

/* gallery */
.gal-grid{display:grid;gap:16px}
.gal-grid.c2{grid-template-columns:repeat(2,1fr)}
.gal-grid.c3{grid-template-columns:repeat(3,1fr)}
.gal-grid.c4{grid-template-columns:repeat(4,1fr)}
.gal .ph{aspect-ratio:1/0.8;font-size:1.4rem}
.gal figcaption{font-size:.82rem;color:var(--muted);margin-top:9px}
.gal[data-lb]{cursor:zoom-in}
.lb{position:fixed;inset:0;z-index:1000;background:rgba(8,6,4,.92);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out}
.lb img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.lb .lb-cap{position:absolute;left:0;right:0;bottom:18px;text-align:center;color:#fff;font-size:.9rem}
.lb .lb-x{position:absolute;top:14px;right:18px;font-size:2rem;color:#fff;background:none;border:0;cursor:pointer;line-height:1}

/* faq */
.faq-list{max-width:760px;margin:0 auto}
.faq-list details{border:1px solid var(--line);border-radius:calc(var(--r) * .7);background:var(--card);margin-bottom:11px;overflow:hidden}
.faq-list summary{padding:17px 20px;cursor:pointer;font-weight:600;font-size:.96rem;list-style:none;display:flex;justify-content:space-between;gap:14px;align-items:center}
.faq-list summary::-webkit-details-marker{display:none}
.faq-list summary::after{content:"+";font-family:${f.disp};color:var(--accent);font-size:1.2rem;transition:transform .3s}
.faq-list details[open] summary::after{transform:rotate(45deg)}
.faq-list .a{padding:0 20px 18px;color:var(--muted);font-size:.92rem;white-space:pre-line}

/* cta band */
.ctaband{padding:0}
.ctaband .inner{background:linear-gradient(120deg, color-mix(in srgb,var(--accent) 88%, var(--ink)), var(--accent2));border-radius:var(--r);padding:64px 40px;text-align:center;color:var(--on-accent)}
.ctaband h2{font-size:clamp(1.7rem,3.4vw,2.5rem);margin-bottom:12px}
.ctaband p{opacity:.92;max-width:34rem;margin:0 auto 30px}
.ctaband .btn{background:var(--on-accent);color:#241207}

/* contact */
.contact-grid{display:grid;grid-template-columns:1fr 1.1fr;gap:52px}
.contact .meta{color:var(--muted);font-size:.95rem;line-height:2;margin-top:18px}
.contact .meta b{color:var(--ink)}
.cform{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:28px}
.cform label{display:block;font-size:.8rem;font-weight:600;color:var(--muted);margin:0 0 6px}
.cform input,.cform textarea{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:calc(var(--r)*.5);padding:12px 14px;font:inherit;color:inherit;margin-bottom:16px}
.cform input:focus,.cform textarea:focus{outline:2px solid var(--accent);outline-offset:0;border-color:transparent}
.cform textarea{min-height:120px;resize:vertical}
.cform .cf-consent{display:flex;gap:10px;align-items:flex-start;font-size:.82rem;color:var(--muted);margin:-4px 0 16px;font-weight:400}
.cform .cf-consent input{width:auto;margin:3px 0 0}
.cform .cf-msg{margin:12px 0 0;font-size:.9rem;min-height:1.2em}
.cform .cf-msg.ok{color:#2c7a4b;font-weight:600}
.cform .cf-msg.err{color:#c0392b}

/* footer */
.foot{border-top:1px solid var(--line);padding:52px 0 40px}
.foot .top{display:flex;justify-content:space-between;gap:30px;flex-wrap:wrap;margin-bottom:30px}
.foot .logo{font-family:${f.disp};font-weight:700;font-size:1.05rem}
.foot .logo b{color:var(--accent)}
.foot .tag{color:var(--muted);font-size:.88rem;max-width:26rem;margin-top:8px}
.foot nav{display:flex;gap:24px;flex-wrap:wrap;font-size:.88rem;color:var(--muted)}
.foot nav a:hover{color:var(--ink)}
.foot-cols{display:flex;gap:44px;flex-wrap:wrap}
.fcol h4{font-size:.74rem;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);margin:0 0 12px}
.fcol a{display:block;font-size:.88rem;color:var(--muted);margin:0 0 9px}
.fcol a:hover{color:var(--ink)}
.foot .fine{color:var(--muted);font-size:.78rem;border-top:1px solid var(--line);padding-top:22px}

@media (max-width:860px){
  section{padding:calc(var(--secpad)*.74) 0}
  .hero{padding:84px 0 64px}
  .hero-grid,.split-grid,.contact-grid{grid-template-columns:1fr;gap:36px}
  .feat-grid.c3,.feat-grid.c4{grid-template-columns:repeat(2,1fr)}
  .gal-grid.c3,.gal-grid.c4{grid-template-columns:repeat(2,1fr)}
  .menu-grid.c2{grid-template-columns:1fr}
  .pay-grid.has-qr{grid-template-columns:1fr}
  .nav nav{position:fixed;inset:72px 0 auto 0;background:var(--bg);border-bottom:1px solid var(--line);flex-direction:column;align-items:flex-start;padding:22px 26px;gap:18px;display:none}
  .nav nav.open{display:flex}
  .nav .mtoggle{display:block}
}
@media (max-width:560px){
  .feat-grid.c2,.feat-grid.c3,.feat-grid.c4,.gal-grid.c2,.gal-grid.c3,.gal-grid.c4{grid-template-columns:1fr}
  .ctaband .inner{padding:46px 24px}
}
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
  html{scroll-behavior:auto}
}

.vt-tint{background:color-mix(in srgb, var(--accent) 7%, var(--bg))}
.has-bg-c{--bg:var(--sbg);background:var(--sbg)!important}
.has-ink-c{--ink:var(--sink);color:var(--sink)}
.has-ink-c :is(h1,h2,h3,h4,.stat .v,.price,.q .who b,.faq-item summary){color:var(--sink)}
.has-bg-c,.has-ink-c{--muted:color-mix(in srgb, var(--ink) 58%, var(--bg));--line:color-mix(in srgb, var(--ink) 16%, transparent);--card:color-mix(in srgb, var(--ink) 5%, var(--bg));--card-2:color-mix(in srgb, var(--ink) 9%, var(--bg))}
.vt-dark{background:color-mix(in srgb, var(--ink) 96%, black);color:var(--bg)}
.vt-dark :is(h2,h3,.stat .v,.price){color:var(--bg)}
.vt-dark :is(p,.sec-head p,.stat .l,.faq-item p,.quote p,.plan .period,.plan li){color:color-mix(in srgb, var(--bg) 76%, var(--ink))}
.vt-dark .eyebrow{background:color-mix(in srgb, var(--bg) 12%, transparent);color:var(--bg)}
.vt-dark :is(.feat,.plan,.quote,.faq-item,.stat){background:color-mix(in srgb, var(--bg) 7%, transparent);border-color:color-mix(in srgb, var(--bg) 16%, transparent)}
.vt-dark .plan.hot{border-color:var(--accent)}
.vt-dark :is(.gal figcaption,.split-grid p,.split-grid .body){color:color-mix(in srgb, var(--bg) 76%, var(--ink))}
.vt-dark .feat.has-img{background:color-mix(in srgb, var(--bg) 9%, transparent)}
.vidwrap{position:relative;aspect-ratio:16/9;border-radius:var(--r);overflow:hidden;background:var(--card);border:1px solid var(--line);max-width:880px;margin:0 auto}
.vidwrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.vid-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:var(--muted);font-size:.95rem}
.vid-ph .ic{font-size:2.2rem}
.soc-row{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
.soc{display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border:1px solid var(--line);border-radius:999px;font-weight:600;transition:all .25s}
.soc:hover{border-color:var(--accent);color:var(--accent);transform:translateY(-2px)}
.pay-grid{display:grid;grid-template-columns:1fr;gap:22px;align-items:start}
.pay-grid.has-qr{grid-template-columns:1.5fr 1fr}
.pay-list{display:grid;gap:14px}
.pay-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:18px 20px}
.pay-card .pm{color:var(--accent);font-weight:700;font-size:.82rem;letter-spacing:.04em;text-transform:uppercase}
.pay-card .pn{color:var(--muted);font-size:.88rem;margin-top:4px}
.pay-card .pv{font-family:var(--disp);font-weight:600;font-size:1.15rem;margin-top:2px;letter-spacing:.02em}
.pay-qr{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:20px;text-align:center}
.pay-qr img{width:100%;max-width:230px;border-radius:calc(var(--r)*.6)}
.pay-qr .pq{color:var(--muted);font-size:.85rem;margin-top:10px}
.pay-note{color:var(--muted);font-size:.9rem;margin-top:18px;text-align:center}
.vt-dark :is(.pay-card,.pay-qr){background:color-mix(in srgb, var(--bg) 7%, transparent);border-color:color-mix(in srgb, var(--bg) 16%, transparent)}
.vt-dark .pay-card .pv{color:var(--bg)}
.fab-col{position:fixed;right:20px;bottom:20px;z-index:60;display:flex;flex-direction:column;gap:12px}
.chat-fab{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(0,0,0,.22);transition:transform .25s}
.chat-fab:hover{transform:scale(1.08)}
.chat-fab svg{width:30px;height:30px;fill:#fff}
.cf-wa{background:#25D366}.cf-ms{background:#0084FF}.cf-vb{background:#7360F2}

/* per-section options */
section.pad-sm{padding:calc(var(--secpad)*.5) 0}
section.pad-lg{padding:calc(var(--secpad)*1.5) 0}
.align-c .sec-head{margin-left:auto;margin-right:auto;text-align:center}
.align-c .soc-row,.align-c .steps-grid,.align-c .team-grid{justify-content:center}

/* hero textures + background image + tall size */
body.tx-none .hero::before{display:none}
body.tx-grid .hero::before{background:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:44px 44px;-webkit-mask-image:radial-gradient(70% 70% at 60% 30%,#000 30%,transparent 100%);mask-image:radial-gradient(70% 70% at 60% 30%,#000 30%,transparent 100%)}
body.tx-dots .hero::before{background:radial-gradient(color-mix(in srgb,var(--accent) 45%, transparent) 1.4px, transparent 1.8px);background-size:24px 24px;opacity:.7;-webkit-mask-image:radial-gradient(70% 80% at 70% 30%,#000 20%,transparent 100%);mask-image:radial-gradient(70% 80% at 70% 30%,#000 20%,transparent 100%)}
.hero.tall{min-height:min(88svh,900px);display:flex;align-items:center}
.hero.has-bg{--hovc:color-mix(in srgb, var(--hov,#0a0806) calc(var(--hdim,.55)*100%), transparent);background:linear-gradient(var(--hovc),var(--hovc)),var(--hbg,none) center/cover;color:#fff}
.hero.has-video{background:var(--hov,#0a0806)}
.hero.has-video .hero-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.hero.has-video::after{content:"";position:absolute;inset:0;background:var(--hovc);z-index:0;pointer-events:none}
.hero.has-bg .wrap{z-index:1}
.hero.has-bg::before{display:none}
.hero.hero-dark{background:color-mix(in srgb, var(--ink) 96%, black);color:var(--bg)}
.hero.hero-dark::before{opacity:.35}
.hero.hero-dark .lede{color:color-mix(in srgb, var(--bg) 78%, var(--ink))}
.hero.hero-dark .eyebrow{border-color:color-mix(in srgb, var(--bg) 30%, transparent);color:var(--bg);background:color-mix(in srgb, var(--bg) 10%, transparent)}
.hero.hero-dark .btn-ghost{border-color:color-mix(in srgb, var(--bg) 50%, transparent);color:var(--bg)}
.hero.hero-dark .btn-ghost:hover{border-color:var(--bg)}
.hero.has-bg .lede{color:rgba(255,255,255,.86)}
.hero.has-bg .eyebrow{border-color:rgba(255,255,255,.35);color:#fff;background:rgba(255,255,255,.12)}
.hero.has-bg .btn-ghost{border-color:rgba(255,255,255,.55);color:#fff}
.hero.has-bg .btn-ghost:hover{border-color:#fff;color:#fff}
.hero.has-bg h1 em{color:color-mix(in srgb, var(--accent) 70%, #fff)}

/* features: icon styles */
.feat .ic.num{font-family:${f.disp};font-weight:700;color:var(--accent);font-size:1.3rem;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 12%, transparent)}

/* gallery ratios */
.gal-grid.r-square .gal .ph{aspect-ratio:1/1}
.gal-grid.r-land .gal .ph{aspect-ratio:16/10}
.gal-grid.r-port .gal .ph{aspect-ratio:4/5}

/* team */
.team-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px}
.member{text-align:center;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px 20px}
.member .ph{width:96px;height:96px;border-radius:50%;margin:0 auto 14px;font-size:1.6rem}
.member .ph img{border-radius:50%}
.member h3{font-size:1rem}
.member .role{color:var(--accent);font-size:.82rem;font-weight:600;margin:3px 0 10px}
.member p{color:var(--muted);font-size:.88rem}

/* partner logos */
.logos-row{display:flex;flex-wrap:wrap;gap:14px 34px;align-items:center;justify-content:center}
.logos-row .lg{height:44px;display:flex;align-items:center;opacity:.72;transition:opacity .25s}
.logos-row .lg:hover{opacity:1}
.logos-row .lg img{max-height:44px;width:auto;max-width:150px;object-fit:contain}
.logos-row .lg span{font-family:${f.disp};font-weight:700;font-size:1rem;color:var(--muted);padding:8px 16px;border:1px dashed var(--line);border-radius:12px}

/* steps */
.steps-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;counter-reset:step}
.step{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px 24px 24px}
.step .n{font-family:${f.disp};font-weight:700;color:var(--accent);font-size:.8rem;letter-spacing:.14em;margin-bottom:12px}
.step h3{font-size:1.02rem;margin-bottom:8px}
.step p{color:var(--muted);font-size:.9rem}

/* map + hours */
.map-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:28px;align-items:start}
.map-grid.no-hours{grid-template-columns:1fr}
.mapwrap{position:relative;aspect-ratio:16/10;border-radius:var(--r);overflow:hidden;border:1px solid var(--line);background:var(--card)}
.mapwrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.hours{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px}
.hours h3{font-size:1rem;margin-bottom:12px}
.hours .row{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px dashed var(--line);font-size:.92rem}
.hours .row:last-of-type{border-bottom:none}
.hours .row span:first-child{color:var(--muted)}
.hours .addr{color:var(--muted);font-size:.9rem;margin-top:14px;line-height:1.6}

/* rich text */
.rich{max-width:760px}
.rich .body{color:var(--muted);font-size:1.04rem;white-space:pre-line}
.align-c .rich{margin:0 auto;text-align:center}

/* announcement bar */
.announce{background:var(--accent);color:var(--on-accent);text-align:center;padding:10px 20px;font-size:.9rem;font-weight:600}
.announce a{text-decoration:underline;text-underline-offset:3px;margin-left:8px}

/* spacer */
.spacer{height:24px}.spacer.sp-md{height:56px}.spacer.sp-lg{height:112px}
/* menu */
.menu-grid{display:grid;gap:6px 48px}
.menu-grid.c2{grid-template-columns:1fr 1fr}
.mi{padding:16px 0;border-bottom:1px solid var(--line)}
.mi-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.mi-h b{font-size:1.02rem;font-family:${f.disp}}
.mi-dots{flex:1;min-width:24px;border-bottom:2px dotted var(--line);transform:translateY(-5px)}
.mi-p{font-weight:700;color:var(--accent);white-space:nowrap}
.mi-tag{font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;background:color-mix(in srgb, var(--accent) 14%, transparent);color:var(--accent);padding:3px 8px;border-radius:999px}
.mi p{color:var(--muted);font-size:.88rem;margin:6px 0 0}
.menu-note{color:var(--muted);font-size:.84rem;margin-top:24px}
/* embed */
.embed-wrap iframe,.embed-ph{width:100%;border:0;display:block;border-radius:var(--r);background:var(--card)}
.embed-ph{aspect-ratio:auto;font-size:2rem}
/* divider */
.divider{padding:10px 0;color:var(--line)}
.divider hr{border:0;border-top:1px solid var(--line);margin:0}
.divider.dv-accent hr{border-top:3px solid var(--accent);width:72px;margin:0 auto}
.divider.dv-dots{text-align:center;color:var(--muted);letter-spacing:8px;font-size:1.1rem}
.divider svg{display:block;width:100%;height:40px}
.divider.dw-narrow .wrap{max-width:360px}

@media (max-width:860px){ .map-grid{grid-template-columns:1fr} .hero.tall{min-height:0} }
`;
}

/* ---------- block rendering helpers ---------- */
/* In edit mode, simple text props get data-edit markers → inline editable on canvas. */
let EDIT = false;
const ed = key => EDIT ? ` data-edit="${key}"` : '';
const ph = (img, label, cls='ph') => img
  ? `<div class="${cls}"><img src="${escAttr(img)}" alt="${escAttr(label||'')}" loading="lazy" /></div>`
  : `<div class="${cls}" aria-hidden="true"><span>${esc(label||'✦')}</span></div>`;
const lines = s => String(s??'').split('\n').map(x=>x.trim()).filter(Boolean);
const vtc = p => (p.variant && p.variant!=='default') ? `vt-${p.variant}` : '';
function parseVideo(url){
  const u = String(url||'').trim();
  let m = u.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/);
  if (m) return { src:`https://www.youtube-nocookie.com/embed/${m[1]}` };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  if (m) return { src:`https://player.vimeo.com/video/${m[1]}` };
  return null;
}

/* ---------- BLOCK REGISTRY ---------- */
const BLOCKS = {
  navbar: {
    name:'Navbar', icon:'🧭', desc:'Sticky top navigation',
    section:false,
    defaults:{ brand:'Your', brandAccent:'Brand', logo:'', logoOnly:false, links:[{label:'Features',href:'#features'},{label:'Pricing',href:'#pricing'},{label:'Contact',href:'#contact'}], cta:'Get started', ctaHref:'#contact', style:'glass', logoSize:'md', stayTop:true },
    fields:[
      {k:'brand',l:'Brand name',t:'text'},{k:'brandAccent',l:'Brand accent word',t:'text'},
      {k:'logo',l:'Logo image (optional)',t:'text',up:1},{k:'logoOnly',l:'Show the logo image only',t:'toggle'},
      {k:'links',l:'Menu links',t:'items',item:[{k:'label',l:'Label',t:'text'},{k:'href',l:'Link (e.g. #pricing)',t:'text'}],titleKey:'label'},
      {k:'cta',l:'Button label',t:'text'},{k:'ctaHref',l:'Button link',t:'text'},
      {k:'style',l:'Bar style',t:'seg',opts:[['glass','Glass'],['solid','Solid'],['clear','Transparent until scrolled']]},
      {k:'logoSize',l:'Logo size',t:'seg',opts:[['sm','Small'],['md','Normal'],['lg','Large']]},
      {k:'stayTop',l:'Stays on top while scrolling',t:'toggle'}
    ],
    render:p=>`<header class="nav nv-${esc(p.style||'glass')} lg-${esc(p.logoSize||'md')}${p.stayTop===false?' nv-static':''}"><div class="wrap">
      <a href="#" class="logo">${p.logo?`<img src="${escAttr(p.logo)}" alt="${escAttr(p.brand+(p.brandAccent||''))}" />`:''}${p.logo&&p.logoOnly?'':`<span${ed('brand')}>${esc(p.brand)}</span><b${ed('brandAccent')}>${esc(p.brandAccent)}</b>`}</a>
      <button class="mtoggle" aria-label="Menu" onclick="this.nextElementSibling.classList.toggle('open')">☰</button>
      <nav>${p.links.map(l=>`<a href="${escAttr(l.href)}">${esc(l.label)}</a>`).join('')}
      ${p.cta?`<a class="btn btn-solid" href="${escAttr(p.ctaHref)}"${ed('cta')}>${esc(p.cta)}</a>`:''}</nav>
    </div></header>`
  },

  hero: {
    name:'Hero', icon:'✨', desc:'Big opening statement',
    defaults:{ eyebrow:'Welcome', title:'Ideas move faster in a *blink*', sub:'Tell people what you do in one honest sentence. This is the first thing they read. Make it about them, not you.', primary:'Start your project', primaryHref:'#contact', secondary:'See pricing', secondaryHref:'#pricing', img:'', imgLabel:'✦', layout:'split', size:'normal', bgImg:'', bgDim:'55' },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Headline (wrap a word in *stars* to color it)',t:'textarea'},
      {k:'sub',l:'Subheadline',t:'textarea'},
      {k:'primary',l:'Primary button',t:'text'},{k:'primaryHref',l:'Primary link',t:'text'},
      {k:'secondary',l:'Secondary button (blank = hidden)',t:'text'},{k:'secondaryHref',l:'Secondary link',t:'text'},
      {k:'layout',l:'Layout',t:'seg',opts:[['split','Split'],['center','Centered']]},
      {k:'size',l:'Height',t:'seg',opts:[['normal','Normal'],['tall','Full screen']]},
      {k:'tone',l:'Tone',t:'seg',opts:[['auto','Light'],['dark','Dark']]},
      {k:'img',l:'Image URL (blank = brand placeholder)',t:'text',up:1},
      {k:'imgLabel',l:'Image alt text',t:'text'},
      {k:'bgImg',l:'Background photo (optional, sits behind the text)',t:'text',up:1},
      {k:'bgVideo',l:'Background video (.mp4 or .webm link, plays muted behind the text)',t:'text'},
      {k:'overlay',l:'Overlay colour on the background photo or video',t:'color'},
      {k:'bgDim',l:'Overlay strength',t:'seg',opts:[['30','Light'],['55','Medium'],['75','Strong']]}
    ],
    render:p=>{
      const title = esc(p.title).replace(/\*(.+?)\*/g,'<em>$1</em>');
      const media = p.layout==='center'?'':ph(p.img,p.imgLabel);
      const vidSrc = /^https?:\/\/.+\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(String(p.bgVideo||'').trim()) ? String(p.bgVideo).trim() : '';
      const ov = /^#[0-9a-f]{3,8}$/i.test(String(p.overlay||'').trim()) ? String(p.overlay).trim() : '';
      const hasBg = !!(p.bgImg || vidSrc);
      const bg = hasBg ? ` style="${p.bgImg?`--hbg:url('${escAttr(p.bgImg)}');`:''}--hdim:${(+p.bgDim||55)/100}${ov?`;--hov:${ov}`:''}"` : '';
      const vid = vidSrc ? `<video class="hero-vid" autoplay muted loop playsinline preload="metadata"${p.bgImg?` poster="${escAttr(p.bgImg)}"`:''} aria-hidden="true"><source src="${escAttr(vidSrc)}" /></video>` : '';
      return `<section class="hero ${p.layout==='center'?'center':''} ${p.size==='tall'?'tall':''} ${hasBg?'has-bg':''} ${vidSrc?'has-video':''} ${p.tone==='dark'&&!hasBg?'hero-dark':''}"${bg}>${vid}<div class="wrap"><div class="hero-grid"><div>
        ${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}
        <h1${ed('title')}>${title}</h1>
        <p class="lede"${ed('sub')}>${esc(p.sub)}</p>
        <div class="hero-cta">
          ${p.primary?`<a class="btn btn-solid" href="${escAttr(p.primaryHref)}"${ed('primary')}>${esc(p.primary)}</a>`:''}
          ${p.secondary?`<a class="btn btn-ghost" href="${escAttr(p.secondaryHref)}"${ed('secondary')}>${esc(p.secondary)}</a>`:''}
        </div></div>${media}</div></div></section>`;
    }
  },

  features: {
    name:'Features', icon:'🧩', desc:'Grid of what you offer',
    alignable:true,
    defaults:{ eyebrow:'What you get', title:'Built right, kept simple', sub:'Three to six short cards. Lead with the benefit, not the feature.', cols:'3', iconStyle:'emoji',
      items:[{icon:'⚡',title:'Lead with a benefit',text:'One sentence on how this helps your customer, not on how it works.'},{icon:'🧭',title:'Keep it scannable',text:'People skim. Short titles, short text, three to six cards at most.'},{icon:'🤝',title:'End with trust',text:'A guarantee, a credential, or the thing customers praise most.'}] },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},{k:'sub',l:'Subtitle',t:'textarea'},
      {k:'cols',l:'Columns',t:'seg',opts:[['2','2'],['3','3'],['4','4']]},
      {k:'iconStyle',l:'Icons',t:'seg',opts:[['emoji','Emoji'],['number','Numbers'],['none','None']]},
      {k:'imgFit',l:'Pictures',t:'seg',opts:[['cover','Fill the top'],['contain','Show whole']]},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]},
      {k:'items',l:'Cards',t:'items',item:[{k:'img',l:'Picture (optional)',t:'text',up:true},{k:'icon',l:'Icon (emoji)',t:'text'},{k:'title',l:'Title',t:'text'},{k:'text',l:'Text',t:'textarea'},{k:'link',l:'Link (optional, makes the card clickable)',t:'text'}],titleKey:'title'}
    ],
    render:p=>`<section id="features" class="${vtc(p)}"><div class="wrap">
      <div class="sec-head">${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2>${p.sub?`<p${ed('sub')}>${esc(p.sub)}</p>`:''}</div>
      <div class="feat-grid c${esc(p.cols)}">${p.items.map((i,n)=>{ const tag = i.link ? 'a' : 'div'; const inner = `${i.img?`<img class="feat-img${p.imgFit==='contain'?' fit-contain':''}" src="${escAttr(i.img)}" alt="${escAttr(i.title||'')}" loading="lazy" />`:''}${p.iconStyle==='none'?'':p.iconStyle==='number'?`<div class="ic num">${n+1}</div>`:`<div class="ic">${esc(i.icon)}</div>`}<h3>${esc(i.title)}</h3>${(i.text||'').trim()?`<p>${esc(i.text)}</p>`:''}`; return `<${tag} class="feat${i.img?' has-img':''}${i.link?' feat-link':''}"${i.link?` href="${escAttr(i.link)}"`:''}>${inner}</${tag}>`; }).join('')}</div>
    </div></section>`
  },

  split: {
    name:'Image + Text', icon:'🖼️', desc:'Side-by-side story section',
    defaults:{ eyebrow:'The story', title:'Say the thing only you can say', text:'Two or three short paragraphs. What do you believe about your craft? Why does it matter to the person reading?\n\nBlank lines become paragraph breaks.', cta:'Learn more', ctaHref:'#contact', img:'', flip:false },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},{k:'text',l:'Body text',t:'textarea'},
      {k:'cta',l:'Button (blank = hidden)',t:'text'},{k:'ctaHref',l:'Button link',t:'text'},
      {k:'img',l:'Image URL',t:'text',up:1},{k:'alt',l:'Image alt text',t:'text'},{k:'flip',l:'Image on the left',t:'toggle'},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}
    ],
    render:p=>{
      const txt=`<div>${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2><p class="tx"${ed('text')}>${esc(p.text)}</p>${p.cta?`<a class="btn btn-ghost" href="${escAttr(p.ctaHref)}"${ed('cta')}>${esc(p.cta)}</a>`:''}</div>`;
      const img=ph(p.img, p.alt||'✦');
      return `<section class="${vtc(p)}"><div class="wrap"><div class="split-grid">${p.flip?img+txt:txt+img}</div></div></section>`;
    }
  },

  stats: {
    name:'Stats', icon:'📈', desc:'Numbers that prove it',
    defaults:{ items:[{value:'10+',label:'Years in business'},{value:'1,200+',label:'Happy customers'},{value:'4.9★',label:'Average rating'},{value:'24h',label:'Reply time'}] },
    fields:[{k:'items',l:'Stats',t:'items',item:[{k:'value',l:'Value',t:'text'},{k:'label',l:'Label',t:'text'}],titleKey:'label'},{k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}],
    render:p=>`<section class="stats ${vtc(p)}"><div class="wrap"><div class="stats-grid">${p.items.map(i=>`<div class="stat"><div class="v">${esc(i.value)}</div><div class="l">${esc(i.label)}</div></div>`).join('')}</div></div></section>`
  },

  pricing: {
    name:'Pricing', icon:'🏷️', desc:'Plans and packages',
    defaults:{ eyebrow:'Pricing', title:'Simple, honest pricing', sub:'Three tiers at most. Highlight the one most people should pick.', 
      items:[
        {name:'Basic',price:'₱999',period:'per month',features:'First thing included\nSecond thing included\nThird thing included',cta:'Choose Basic',href:'#contact',hot:false},
        {name:'Standard',price:'₱1,999',period:'per month',features:'Everything in Basic\nSomething customers love\nAnother strong reason\nPriority support',cta:'Choose Standard',href:'#contact',hot:true},
        {name:'Premium',price:'₱3,499',period:'per month',features:'Everything in Standard\nYour best offer here\nThe white-glove extra',cta:'Choose Premium',href:'#contact',hot:false}
      ] },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},{k:'sub',l:'Subtitle',t:'textarea'},
      {k:'items',l:'Plans',t:'items',item:[
        {k:'name',l:'Plan name',t:'text'},{k:'price',l:'Price',t:'text'},{k:'period',l:'Period / note',t:'text'},
        {k:'features',l:'Features (one per line)',t:'textarea'},{k:'cta',l:'Button',t:'text'},{k:'href',l:'Button link',t:'text'},{k:'hot',l:'Highlight this plan',t:'toggle'}
      ],titleKey:'name'},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}
    ],
    render:p=>`<section id="pricing" class="${vtc(p)}"><div class="wrap">
      <div class="sec-head center">${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2>${p.sub?`<p${ed('sub')}>${esc(p.sub)}</p>`:''}</div>
      <div class="price-grid">${p.items.map(i=>`<div class="plan ${i.hot?'hot':''}">${i.hot?'<span class="tag">Most picked</span>':''}
        <h3>${esc(i.name)}</h3><div class="amount">${esc(i.price)}</div><div class="per">${esc(i.period)}</div>
        <ul>${lines(i.features).map(f=>`<li>${esc(f)}</li>`).join('')}</ul>
        <a class="btn ${i.hot?'btn-solid':'btn-ghost'}" href="${escAttr(i.href)}">${esc(i.cta)}</a></div>`).join('')}</div>
    </div></section>`
  },

  quotes: {
    name:'Testimonials', icon:'💬', desc:'Words from real clients', alignable:true,
    defaults:{ eyebrow:'Kind words', title:'What customers say',
      items:[{quote:'A real quote from a real customer beats anything you could write yourself. Keep it short.',name:'Customer name',role:'Their business or city'},{quote:'Two or three of these are plenty. Pick the ones that mention results.',name:'Another customer',role:'Their role'}] },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},
      {k:'items',l:'Quotes',t:'items',item:[{k:'quote',l:'Quote',t:'textarea'},{k:'name',l:'Name',t:'text'},{k:'role',l:'Role / company',t:'text'},{k:'img',l:'Photo (optional)',t:'text',up:1},{k:'stars',l:'Stars, 1 to 5 (blank = none)',t:'text'}],titleKey:'name'},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}
    ],
    render:p=>`<section class="${vtc(p)}"><div class="wrap">
      <div class="sec-head">${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2></div>
      <div class="q-grid">${p.items.map(i=>{ const n = Math.min(5, Math.max(0, parseInt(i.stars,10)||0)); return `<div class="q"><span class="mark">\u201C</span>${n?`<div class="stars" aria-label="${n} out of 5">${'★'.repeat(n)}<span>${'★'.repeat(5-n)}</span></div>`:''}<p>${esc(i.quote)}</p><div class="who">${i.img?`<img class="av" src="${escAttr(i.img)}" alt="" loading="lazy" />`:''}<div><b>${esc(i.name)}</b>${esc(i.role)}</div></div></div>`; }).join('')}</div>
    </div></section>`
  },

  gallery: {
    name:'Gallery', icon:'🗂️', desc:'Work, menu, or photos', alignable:true,
    defaults:{ title:'Recent work', cols:'3', ratio:'land', lightbox:true, items:[{img:'',caption:'Project one'},{img:'',caption:'Project two'},{img:'',caption:'Project three'}] },
    fields:[
      {k:'title',l:'Title',t:'text'},{k:'cols',l:'Columns',t:'seg',opts:[['2','2'],['3','3'],['4','4']]},
      {k:'ratio',l:'Image shape',t:'seg',opts:[['square','Square'],['land','Wide'],['port','Tall']]},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]},
      {k:'items',l:'Items',t:'items',item:[{k:'img',l:'Image URL (blank = placeholder)',t:'text',up:1},{k:'caption',l:'Caption',t:'text'}],titleKey:'caption'},
      {k:'lightbox',l:'Open pictures full screen when clicked (on the live site)',t:'toggle'}
    ],
    render:p=>`<section class="${vtc(p)}"><div class="wrap">
      <div class="sec-head"><h2${ed('title')}>${esc(p.title)}</h2></div>
      <div class="gal-grid c${esc(p.cols)} r-${esc(p.ratio||'land')}">${p.items.map(i=>`<figure class="gal"${i.img&&p.lightbox!==false?' data-lb':''}>${ph(i.img,i.caption?esc(i.caption[0]).toUpperCase():'✦')}${i.caption?`<figcaption>${esc(i.caption)}</figcaption>`:''}</figure>`).join('')}</div>
    </div></section>`
  },

  faq: {
    name:'FAQ', icon:'❓', desc:'Answer objections early',
    defaults:{ title:'Questions, answered', items:[{q:'How long does a build take?',a:'Most sites go live in 1–2 weeks depending on scope and how fast we get your content.'},{q:'Do I own the website?',a:'Yes. You pay once for the build and the files are yours. Hosting and care plans are optional.'}] },
    fields:[
      {k:'title',l:'Title',t:'text'},
      {k:'items',l:'Questions',t:'items',item:[{k:'q',l:'Question',t:'text'},{k:'a',l:'Answer',t:'textarea'}],titleKey:'q'},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}
    ],
    render:p=>`<section id="faq" class="${vtc(p)}"><div class="wrap">
      <div class="sec-head center"><h2${ed('title')}>${esc(p.title)}</h2></div>
      <div class="faq-list">${p.items.map(i=>`<details><summary>${esc(i.q)}</summary><div class="a">${esc(i.a)}</div></details>`).join('')}</div>
    </div></section>`
  },

  payments: {
    name:'Payments', icon:'💳', desc:'GCash, Maya, or bank details', alignable:true,
    defaults:{ eyebrow:'Payment', title:'Easy ways to pay', sub:'Pick whichever is easiest for you, then send a screenshot to confirm.',
      qr:'', qrCaption:'Scan to pay via GCash',
      items:[
        {method:'GCash', name:'Your Name', number:'0917 000 0000'},
        {method:'Maya', name:'Your Name', number:'0917 000 0000'},
        {method:'Bank transfer (BPI)', name:'Your Name', number:'1234 5678 90'}
      ],
      note:'', variant:'default' },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},{k:'sub',l:'Subtitle',t:'textarea'},
      {k:'items',l:'Payment methods',t:'items',item:[{k:'method',l:'Method',t:'text'},{k:'name',l:'Account name',t:'text'},{k:'number',l:'Number / details',t:'text'}],titleKey:'method'},
      {k:'qr',l:'QR code image (optional)',t:'text',up:1},
      {k:'qrCaption',l:'QR caption',t:'text'},
      {k:'note',l:'How to pay (optional note)',t:'textarea'},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}
    ],
    render:p=>`<section id="pay" class="${vtc(p)}"><div class="wrap">
      <div class="sec-head">${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2>${p.sub?`<p${ed('sub')}>${esc(p.sub)}</p>`:''}</div>
      <div class="pay-grid ${p.qr?'has-qr':''}">
        <div class="pay-list">${p.items.map(i=>`<div class="pay-card"><div class="pm">${esc(i.method)}</div><div class="pn">${esc(i.name)}</div><div class="pv">${esc(i.number)}</div></div>`).join('')}</div>
        ${p.qr?`<div class="pay-qr"><img src="${escAttr(p.qr)}" alt="${escAttr(p.qrCaption||'Payment QR code')}" loading="lazy" /><div class="pq">${esc(p.qrCaption||'')}</div></div>`:''}
      </div>
      ${p.note?`<p class="pay-note"${ed('note')}>${esc(p.note)}</p>`:''}
    </div></section>`
  },

  video: {
    name:'Video', icon:'🎬', desc:'YouTube or Vimeo embed', alignable:true,
    defaults:{ eyebrow:'Watch', title:'See it in motion', url:'', variant:'default' },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},
      {k:'url',l:'Video URL (YouTube or Vimeo)',t:'text'},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}
    ],
    render:p=>{
      const v = parseVideo(p.url);
      const inner = v
        ? `<iframe src="${escAttr(v.src)}" title="${escAttr(p.title||'Video')}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
        : `<div class="vid-ph"><span class="ic">🎬</span><span>${esc('Add a YouTube or Vimeo link')}</span></div>`;
      return `<section class="${vtc(p)}"><div class="wrap">
      <div class="sec-head">${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2></div>
      <div class="vidwrap">${inner}</div>
    </div></section>`;
    }
  },

  social: {
    name:'Social links', icon:'🔗', desc:'Row of profile links', alignable:true,
    defaults:{ title:'Find us here',
      items:[{label:'Facebook',url:'#'},{label:'Instagram',url:'#'},{label:'TikTok',url:'#'}] },
    fields:[
      {k:'title',l:'Title',t:'text'},
      {k:'items',l:'Links',t:'items',item:[{k:'label',l:'Label',t:'text'},{k:'url',l:'Link URL',t:'text'}],titleKey:'label'}
    ],
    render:p=>`<section><div class="wrap">
      <div class="sec-head"><h2${ed('title')}>${esc(p.title)}</h2></div>
      <div class="soc-row">${p.items.map(i=>`<a class="soc" href="${escAttr(i.url)}"${/^https?:/.test(i.url)?' target="_blank" rel="noopener"':''}>${esc(i.label)}</a>`).join('')}</div>
    </div></section>`
  },

  cta: {
    name:'CTA Band', icon:'📣', desc:'The big ask',
    defaults:{ title:'Ready when you are', sub:'Tell us what you\u2019re building. We\u2019ll reply within a day with a plan and a price.', label:'Start your loop', href:'#contact' },
    fields:[{k:'title',l:'Title',t:'text'},{k:'sub',l:'Subtitle',t:'textarea'},{k:'label',l:'Button',t:'text'},{k:'href',l:'Button link',t:'text'}],
    render:p=>`<section class="ctaband"><div class="wrap"><div class="inner">
      <h2${ed('title')}>${esc(p.title)}</h2><p${ed('sub')}>${esc(p.sub)}</p>
      <a class="btn" href="${escAttr(p.href)}"${ed('label')}>${esc(p.label)}</a>
    </div></div></section>`
  },

  contact: {
    name:'Contact', icon:'✉️', desc:'Form + details',
    defaults:{ title:'Let\u2019s talk', sub:'Tell people the easiest way to reach you and how fast you reply.', email:'hello@yourbrand.com', phone:'+63 900 000 0000', where:'Your city', action:'' },
    fields:[
      {k:'title',l:'Title',t:'text'},{k:'sub',l:'Subtitle',t:'textarea'},
      {k:'email',l:'Email',t:'text'},{k:'phone',l:'Phone (blank = hidden)',t:'text'},{k:'where',l:'Location (blank = hidden)',t:'text'},
      {k:'action',l:'Form endpoint URL (e.g. Formspree). Blank = form emails you via mailto.',t:'text'}
    ],
    render:p=>{
      const action = p.action ? `action="${escAttr(p.action)}" method="POST"` : `action="mailto:${escAttr(p.email)}" method="GET"`;
      const lead = /\/api\/lead/.test(p.action||'');
      return `<section id="contact" class="contact"><div class="wrap"><div class="contact-grid">
      <div><h2${ed('title')}>${esc(p.title)}</h2><p class="tx" style="color:var(--muted);margin-top:12px"${ed('sub')}>${esc(p.sub)}</p>
        <div class="meta">${p.email?`<div>📧 <b>${esc(p.email)}</b></div>`:''}${p.phone?`<div>📞 <b>${esc(p.phone)}</b></div>`:''}${p.where?`<div>📍 <b>${esc(p.where)}</b></div>`:''}</div></div>
      <form class="cform" ${action}${lead?' data-lead':''} novalidate>
        <label for="cf-n">Name</label><input id="cf-n" name="name" required placeholder="Your name" />
        <label for="cf-e">Email</label><input id="cf-e" name="email" type="email" required placeholder="you@email.com" />
        <label for="cf-m">Message</label><textarea id="cf-m" name="message" required placeholder="What are you building?"></textarea>
        ${lead?`<label class="cf-consent"><input type="checkbox" name="consent" value="yes" required /> <span>I agree that my details are used to reply to this message.</span></label><input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true" />`:''}
        <button class="btn btn-solid" type="submit">Send message</button>
        <p class="cf-msg" role="status" aria-live="polite"></p>
      </form></div></div></section>`;
    }
  },

  footer: {
    name:'Footer', icon:'🦶', desc:'Sign-off + links',
    section:false,
    defaults:{ brand:'Your', brandAccent:'Brand', logo:'', tagline:'One honest line about what you do and who you do it for.', links:[{label:'Features',href:'#features'},{label:'Pricing',href:'#pricing'},{label:'Contact',href:'#contact'}], groups:[], fine:'© 2026 Your Brand. All rights reserved.' },
    fields:[
      {k:'brand',l:'Brand',t:'text'},{k:'brandAccent',l:'Brand accent word',t:'text'},{k:'logo',l:'Logo image (optional)',t:'text',up:1},{k:'tagline',l:'Tagline',t:'textarea'},
      {k:'links',l:'Links (one row)',t:'items',item:[{k:'label',l:'Label',t:'text'},{k:'href',l:'Link',t:'text'}],titleKey:'label'},
      {k:'groups',l:'Link columns (replace the row when filled)',t:'items',item:[{k:'title',l:'Column title',t:'text'},{k:'links',l:'Links, one per line: Label | #anchor or https://…',t:'textarea'}],titleKey:'title'},
      {k:'fine',l:'Fine print',t:'text'}
    ],
    render:p=>{
      const groups = (p.groups||[]).filter(g => (g.title||'').trim() || lines(g.links).length);
      const cols = groups.length ? `<div class="foot-cols">${groups.map(g=>`<div class="fcol">${g.title?`<h4>${esc(g.title)}</h4>`:''}${lines(g.links).map(l=>{ const i = l.indexOf('|'); const lab = i>-1 ? l.slice(0,i).trim() : l, href = i>-1 ? l.slice(i+1).trim() : '#'; return `<a href="${escAttr(href||'#')}">${esc(lab)}</a>`; }).join('')}</div>`).join('')}</div>` : '';
      return `<footer class="foot${groups.length?' has-cols':''}"><div class="wrap">
      <div class="top"><div><div class="logo">${p.logo?`<img src="${escAttr(p.logo)}" alt="" />`:''}<span${ed('brand')}>${esc(p.brand)}</span><b${ed('brandAccent')}>${esc(p.brandAccent)}</b></div><p class="tag"${ed('tagline')}>${esc(p.tagline)}</p></div>
      ${cols || `<nav>${p.links.map(l=>`<a href="${escAttr(l.href)}">${esc(l.label)}</a>`).join('')}</nav>`}</div>
      <div class="fine"${ed('fine')}>${esc(p.fine)}</div>
    </div></footer>`; }
  },

  team: {
    name:'Team', icon:'🧑‍🤝‍🧑', desc:'The people behind it', alignable:true,
    defaults:{ eyebrow:'The team', title:'Small team, direct line', sub:'Real names and real faces build trust faster than any slogan.',
      items:[{img:'',name:'Full name',role:'Founder',bio:'One line about what they own and why clients like working with them.'},{img:'',name:'Full name',role:'Designer',bio:'One line. Keep the tone the same across the team.'},{img:'',name:'Full name',role:'Developer',bio:'One line. Skip the buzzwords.'}] },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},{k:'sub',l:'Subtitle',t:'textarea'},
      {k:'items',l:'People',t:'items',item:[{k:'img',l:'Photo URL (blank = initials)',t:'text',up:1},{k:'name',l:'Name',t:'text'},{k:'role',l:'Role',t:'text'},{k:'bio',l:'One line about them',t:'textarea'}],titleKey:'name'},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}
    ],
    render:p=>`<section class="${vtc(p)}"><div class="wrap">
      <div class="sec-head">${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2>${p.sub?`<p${ed('sub')}>${esc(p.sub)}</p>`:''}</div>
      <div class="team-grid">${p.items.map(i=>`<div class="member">${ph(i.img, i.img ? i.name : String(i.name||'?').split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase())}<h3>${esc(i.name)}</h3><div class="role">${esc(i.role)}</div>${i.bio?`<p>${esc(i.bio)}</p>`:''}</div>`).join('')}</div>
    </div></section>`
  },

  logos: {
    name:'Partner logos', icon:'🤝', desc:'Clients or brands you work with', alignable:true,
    defaults:{ title:'Trusted by', items:[{img:'',name:'Client one',url:''},{img:'',name:'Client two',url:''},{img:'',name:'Client three',url:''},{img:'',name:'Client four',url:''}] },
    fields:[
      {k:'title',l:'Small title above the logos (blank = none)',t:'text'},
      {k:'items',l:'Logos',t:'items',item:[{k:'img',l:'Logo image URL (blank = name as text)',t:'text',up:1},{k:'name',l:'Name (used as alt text)',t:'text'},{k:'url',l:'Link (optional)',t:'text'}],titleKey:'name'}
    ],
    render:p=>`<section class="pad-sm"><div class="wrap">
      ${p.title?`<div class="sec-head center" style="margin-bottom:26px"><span class="eyebrow"${ed('title')}>${esc(p.title)}</span></div>`:''}
      <div class="logos-row">${p.items.map(i=>{ const inner = i.img ? `<img src="${escAttr(i.img)}" alt="${escAttr(i.name)}" loading="lazy" />` : `<span>${esc(i.name)}</span>`; return i.url ? `<a class="lg" href="${escAttr(i.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="lg">${inner}</div>`; }).join('')}</div>
    </div></section>`
  },

  steps: {
    name:'Steps', icon:'🪜', desc:'How it works, in order', alignable:true,
    defaults:{ eyebrow:'How it works', title:'Three steps, no surprises', sub:'Walk people through what happens after they say yes.',
      items:[{title:'Tell us what you need',text:'A short call or message. We listen first, then quote.'},{title:'We build it',text:'You see progress early and often. Change your mind while it is cheap.'},{title:'You own it',text:'Launch, then the files are yours. Stay on a care plan or take it anywhere.'}] },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},{k:'sub',l:'Subtitle',t:'textarea'},
      {k:'items',l:'Steps',t:'items',item:[{k:'title',l:'Step title',t:'text'},{k:'text',l:'What happens',t:'textarea'}],titleKey:'title'},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}
    ],
    render:p=>`<section id="how" class="${vtc(p)}"><div class="wrap">
      <div class="sec-head">${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2>${p.sub?`<p${ed('sub')}>${esc(p.sub)}</p>`:''}</div>
      <div class="steps-grid">${p.items.map((i,n)=>`<div class="step"><div class="n">STEP ${String(n+1).padStart(2,'0')}</div><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join('')}</div>
    </div></section>`
  },

  map: {
    name:'Map & hours', icon:'📍', desc:'Google map with opening hours', alignable:true,
    defaults:{ eyebrow:'Visit us', title:'Find us', address:'BLOQ SOHO Lofts, Mandaue City, Cebu', showHours:true, hoursTitle:'Opening hours',
      hours:[{day:'Monday to Friday',time:'9:00 AM to 6:00 PM'},{day:'Saturday',time:'9:00 AM to 1:00 PM'},{day:'Sunday',time:'Closed'}] },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},
      {k:'address',l:'Address (the map centers on this)',t:'text'},
      {k:'showHours',l:'Show opening hours',t:'toggle'},{k:'hoursTitle',l:'Hours title',t:'text'},
      {k:'hours',l:'Hours',t:'items',item:[{k:'day',l:'Day(s)',t:'text'},{k:'time',l:'Time',t:'text'}],titleKey:'day'}
    ],
    render:p=>{
      const q = encodeURIComponent(String(p.address||'').trim());
      const map = q ? `<iframe src="https://www.google.com/maps?q=${q}&output=embed" title="Map: ${escAttr(p.address)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>` : `<div class="vid-ph"><span class="ic">📍</span><span>Add an address</span></div>`;
      const hours = p.showHours ? `<div class="hours"><h3${ed('hoursTitle')}>${esc(p.hoursTitle)}</h3>${(p.hours||[]).map(h=>`<div class="row"><span>${esc(h.day)}</span><span>${esc(h.time)}</span></div>`).join('')}${p.address?`<div class="addr">📍 ${esc(p.address)}</div>`:''}</div>` : '';
      return `<section id="map"><div class="wrap">
      <div class="sec-head">${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2></div>
      <div class="map-grid ${p.showHours?'':'no-hours'}"><div class="mapwrap">${map}</div>${hours}</div>
    </div></section>`;
    }
  },

  text: {
    name:'Text', icon:'📝', desc:'Heading plus paragraphs', alignable:true,
    defaults:{ eyebrow:'', title:'A heading that earns the next paragraph', body:'Write like you talk to a customer across the counter. Short sentences. One idea per paragraph.\n\nBlank lines become paragraph breaks.' },
    fields:[{k:'eyebrow',l:'Eyebrow (blank = none)',t:'text'},{k:'title',l:'Title',t:'text'},{k:'body',l:'Body text',t:'textarea'},{k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}],
    render:p=>`<section class="${vtc(p)}"><div class="wrap"><div class="rich">
      ${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')} style="font-size:clamp(1.5rem,3vw,2.2rem);margin:14px 0 14px">${esc(p.title)}</h2><p class="body"${ed('body')}>${esc(p.body)}</p>
    </div></div></section>`
  },

  banner: {
    name:'Announcement', icon:'📢', desc:'Thin bar for a promo or notice', section:false,
    defaults:{ text:'Grand opening this Saturday. First 50 customers get a free drink.', label:'Details', href:'#contact' },
    fields:[{k:'text',l:'Message',t:'text'},{k:'label',l:'Link label (blank = none)',t:'text'},{k:'href',l:'Link',t:'text'}],
    render:p=>`<div class="announce"><span${ed('text')}>${esc(p.text)}</span>${p.label?`<a href="${escAttr(p.href)}"${ed('label')}>${esc(p.label)}</a>`:''}</div>`
  },

  menu: {
    name:'Menu', icon:'🍽️', desc:'Dishes or services with prices', alignable:true,
    defaults:{ eyebrow:'Menu', title:'What we serve', currency:'₱', cols:'2', note:'Prices include VAT. Ask us about catering and group orders.',
      items:[{name:'Signature dish',desc:'One line on what makes it special.',price:'280',tag:'Best seller'},{name:'House favourite',desc:'Ingredients people ask about.',price:'240',tag:''},{name:'Something light',desc:'For the afternoon crowd.',price:'180',tag:'Vegetarian'},{name:'Sweet finish',desc:'Made fresh every morning.',price:'150',tag:''}] },
    fields:[
      {k:'eyebrow',l:'Eyebrow',t:'text'},{k:'title',l:'Title',t:'text'},
      {k:'currency',l:'Currency symbol',t:'text'},{k:'cols',l:'Columns',t:'seg',opts:[['1','1'],['2','2']]},
      {k:'items',l:'Items',t:'items',item:[{k:'name',l:'Name',t:'text'},{k:'desc',l:'Description',t:'textarea'},{k:'price',l:'Price (number only)',t:'text'},{k:'tag',l:'Tag (Best seller, Vegan, New…)',t:'text'}],titleKey:'name'},
      {k:'note',l:'Note under the menu',t:'text'},
      {k:'variant',l:'Style',t:'seg',opts:[['default','Default'],['tint','Tinted'],['dark','Dark']]}
    ],
    render:p=>`<section class="${vtc(p)}"><div class="wrap">
      <div class="sec-head">${p.eyebrow?`<span class="eyebrow"${ed('eyebrow')}>${esc(p.eyebrow)}</span>`:''}<h2${ed('title')}>${esc(p.title)}</h2></div>
      <div class="menu-grid c${esc(p.cols||'2')}">${p.items.map(i=>`<div class="mi"><div class="mi-h"><b>${esc(i.name)}</b>${i.tag?`<span class="mi-tag">${esc(i.tag)}</span>`:''}<span class="mi-dots"></span>${i.price?`<span class="mi-p">${esc(p.currency||'')}${esc(i.price)}</span>`:''}</div>${i.desc?`<p>${esc(i.desc)}</p>`:''}</div>`).join('')}</div>
      ${p.note?`<p class="menu-note"${ed('note')}>${esc(p.note)}</p>`:''}
    </div></section>`
  },
  embed: {
    name:'Embed', icon:'🧩', desc:'Booking calendar, form, map or any iframe',
    defaults:{ title:'', url:'', code:'', height:'520' },
    fields:[
      {k:'title',l:'Title (optional)',t:'text'},
      {k:'url',l:'Address to embed (Google Form, Calendly, YouTube, Spotify, Maps…)',t:'text'},
      {k:'code',l:'Or paste the embed code (<iframe …>) from the service',t:'textarea'},
      {k:'height',l:'Height',t:'seg',opts:[['360','Short'],['520','Medium'],['760','Tall']]}
    ],
    render:p=>{
      const h = parseInt(p.height,10)||520;
      let inner = '';
      const code = String(p.code||'').trim();
      if (/<iframe\b/i.test(code)){
        const m = code.match(/<iframe\b[^>]*>/i); const srcm = m && m[0].match(/\ssrc=["']([^"']+)["']/i);
        if (srcm && /^https:\/\//i.test(srcm[1])){ const allow = (m[0].match(/\sallow=["']([^"']+)["']/i)||[])[1]||''; inner = `<iframe src="${escAttr(srcm[1])}" style="height:${h}px" loading="lazy" allowfullscreen${allow?` allow="${escAttr(allow)}"`:''} title="${escAttr(p.title||'Embedded content')}"></iframe>`; }
      } else if (/^https:\/\//i.test(String(p.url||'').trim())){
        const v = parseVideo(p.url); const src = v ? v.src : String(p.url).trim();
        inner = `<iframe src="${escAttr(src)}" style="height:${h}px" loading="lazy" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; geolocation" title="${escAttr(p.title||'Embedded content')}"></iframe>`;
      }
      if (!inner) inner = `<div class="ph embed-ph" style="height:${h}px" aria-hidden="true"><span>🧩</span></div>`;
      return `<section class="embed"><div class="wrap">${p.title?`<div class="sec-head"><h2${ed('title')}>${esc(p.title)}</h2></div>`:''}<div class="embed-wrap">${inner}</div></div></section>`;
    }
  },
  divider: {
    name:'Divider', icon:'➖', desc:'A line, dots or a wave between sections', section:false,
    defaults:{ style:'line', width:'wide' },
    fields:[
      {k:'style',l:'Style',t:'seg',opts:[['line','Line'],['accent','Accent'],['dots','Dots'],['wave','Wave']]},
      {k:'width',l:'Width',t:'seg',opts:[['wide','Wide'],['narrow','Narrow']]}
    ],
    render:p=>`<div class="divider dv-${esc(p.style||'line')} dw-${esc(p.width||'wide')}" aria-hidden="true"><div class="wrap">${p.style==='wave'?'<svg viewBox="0 0 1200 40" preserveAspectRatio="none"><path d="M0 20 C 150 40 300 0 450 20 S 750 40 900 20 S 1150 0 1200 20" fill="none" stroke="currentColor" stroke-width="2"/></svg>':p.style==='dots'?'<span>• • •</span>':'<hr />'}</div></div>`
  },
  spacer: {
    name:'Spacer', icon:'↕️', desc:'Breathing room between sections', section:false,
    defaults:{ size:'md' },
    fields:[{k:'size',l:'Height',t:'seg',opts:[['sm','Small'],['md','Medium'],['lg','Large']]}],
    render:p=>`<div class="spacer sp-${esc(p.size||'md')}" aria-hidden="true"></div>`
  },

  /* An exact copy of an imported page (or any hand-written HTML). The CSS is already scoped to #scopeId by the
     importer, so it cannot restyle the rest of the site; a small revert block keeps our own base styles out of it. */
  html: {
    name:'Imported page', icon:'🧱', desc:'Exact copy of a page, or your own HTML', section:false,
    defaults:{ scopeId:'', cssRef:'', rootClass:'', rootStyle:'', rootLang:'', rootDir:'', html:'<div style="padding:60px 24px;text-align:center;font-family:system-ui"><h2>Custom HTML</h2><p>Paste markup in the panel on the right, or use Projects → Import from a website → Exact copy.</p></div>', css:'', fonts:[] },
    fields:[{t:'media',l:'Pictures and videos on this page'},{k:'html',l:'HTML',t:'textarea'},{k:'css',l:'CSS (applies inside this block only)',t:'textarea'},{t:'action',id:'copyAssets',l:'Copy images and fonts to BlinkLoop storage',note:'Images and fonts still load from the original site, and fonts from another domain often refuse to load at all. This copies each file into our storage and updates the page, so the copy looks right and keeps working when the old site goes away.'}],
    render:p=>{
      const id = p.scopeId || 'imp-custom';
      const fonts = (p.fonts||[]).filter(u=>/^https:\/\/fonts\.googleapis\.com\//.test(u)).map(u=>`@import url("${escAttr(u)}");`).join('');
      const css = String(p.css||'').replace(/<\/style/gi,'<\\/style');
      const shared = p.cssRef ? siteCss(p.cssRef) : '';
      return `<section class="imp-sec">${fonts?`<style>${fonts}</style>`:''}${shared?`<style>${shared}</style>`:''}${css?`<style>${css}</style>`:''}<div id="${escAttr(id)}" class="imp-root${p.rootClass?' '+escAttr(p.rootClass):''}"${p.rootStyle?' style="'+escAttr(p.rootStyle)+'"':''}${p.rootLang?' lang="'+escAttr(p.rootLang)+'"':''}${p.rootDir?' dir="'+escAttr(p.rootDir)+'"':''}${EDIT?' data-rawedit="html"':''}>${p.html||''}</div></section>`;
    }
  }
};

const BLOCK_ORDER = ['navbar','banner','hero','logos','features','steps','split','text','stats','pricing','menu','payments','quotes','team','gallery','video','faq','map','embed','cta','contact','social','divider','spacer','html','footer'];
/* default anchor ids, so nav links like #pricing work out of the box; editable per block in the Section group */
const DEFAULT_ANCHOR = { features:'features', pricing:'pricing', faq:'faq', contact:'contact', payments:'pay', gallery:'gallery', quotes:'testimonials', team:'team', map:'map', steps:'how', video:'video', logos:'partners' };

/* apply the generic Section options (anchor id, spacing, alignment) to a rendered block */
function decorate(html, b){
  const p = b.props, def = BLOCKS[b.type];
  if (!def || def.section === false) return html;
  const cls = [];
  if (p.pad === 'sm') cls.push('pad-sm'); else if (p.pad === 'lg') cls.push('pad-lg');
  if (def.alignable && p.align === 'center') cls.push('align-c');
  const id = sectionId(b);
  const okc = v => /^(#[0-9a-f]{3,8}|[a-z]+\(.*\)|[a-z-]+)$/i.test(String(v||'').trim()) ? String(v).trim() : '';
  const bg = okc(p.bg), ink = okc(p.ink); const sty = [];
  if (bg){ cls.push('has-bg-c'); sty.push('--sbg:' + bg); }
  if (ink){ cls.push('has-ink-c'); sty.push('--sink:' + ink); }
  return html.replace(/^\s*<(section|header|footer|div)\b([^>]*)>/, (m, tag, attrs) => {
    let a = attrs;
    if (cls.length) a = /class="/.test(a) ? a.replace(/class="/, 'class="' + cls.join(' ') + ' ') : a + ' class="' + cls.join(' ') + '"';
    if (sty.length) a = /style="/.test(a) ? a.replace(/style="/, 'style="' + sty.join(';') + ';') : a + ' style="' + sty.join(';') + '"';
    a = a.replace(/\sid="[^"]*"/, '');
    if (id) a = ' id="' + escAttr(id) + '"' + a;
    return '<' + tag + a + '>';
  });
}
/* the id a section gets on the page: the anchor the user typed, the default for its type, or a generated one when it needs custom CSS */
function sectionId(b){
  const p = b.props;
  const id = (p.anchor === undefined || p.anchor === null) ? (DEFAULT_ANCHOR[b.type] || '') : String(p.anchor).trim().replace(/^#/, '');
  return id || (p.css && String(p.css).trim() ? 's-' + String(b.id).replace(/[^a-z0-9-]/gi, '') : '');
}
/* every section's custom CSS, nested under its id so it cannot leak into the rest of the page */
function customCSS(){
  return state.blocks.filter(b => b.props && b.props.css && String(b.props.css).trim() && BLOCKS[b.type] && BLOCKS[b.type].section !== false)
    .map(b => '#' + sectionId(b) + '{' + String(b.props.css).replace(/<\/style/gi, '') + '}').join('\n');
}

function renderBlockHTML(b, edit){
  EDIT = !!edit;
  const def = BLOCKS[b.type];
  const html = def ? decorate(def.render(b.props), b) : '';
  EDIT = false;
  return html;
}
function pageBodyHTML(edit){
  return state.blocks.map(b =>
    edit ? `<div class="blk" data-id="${b.id}">${renderBlockHTML(b,true)}
      <div class="blk-tools" contenteditable="false">
        <span class="blk-name">${BLOCKS[b.type].icon} ${t(BLOCKS[b.type].name)}</span>
        <button data-action="edit" data-id="${b.id}" class="m-only" title="${t('Edit')}">✎</button>
        <button data-action="up" data-id="${b.id}" title="${t('Move up')}">↑</button>
        <button data-action="down" data-id="${b.id}" title="${t('Move down')}">↓</button>
        <button data-action="dupe" data-id="${b.id}" title="${t('Duplicate')}">⧉</button>
        <button data-action="del" data-id="${b.id}" title="${t('Delete')}">✕</button>
      </div>
      <button class="blk-add" data-action="addat" data-id="${b.id}" contenteditable="false" title="${t('Insert a block here')}">＋</button></div>`
    : renderBlockHTML(b,false)
  ).join('\n');
}
