/* Loop Builder, part 2 of 5: canvas iframe, block library, layers, inspector fields, media panel, AI copy help, drag and drop. */
"use strict";
/* =============== CANVAS (iframe) =============== */
const frame = $('#frame');

const OVERLAY_CSS = `
.blk{position:relative}
.blk:hover{outline:2px dashed color-mix(in srgb, var(--accent) 55%, transparent);outline-offset:-2px}
.blk.sel{outline:2px solid var(--accent);outline-offset:-2px}
.blk.drop-top{box-shadow:inset 0 4px 0 var(--accent)}
.blk.drop-bot{box-shadow:inset 0 -4px 0 var(--accent)}
.blk-tools{
  position:absolute;top:10px;right:10px;z-index:60;display:none;align-items:center;gap:2px;
  background:color-mix(in srgb, var(--ink) 92%, var(--bg));color:var(--bg);border-radius:999px;padding:4px 6px 4px 12px;
  font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.3);font-family:system-ui,sans-serif;
}
.blk:hover .blk-tools,.blk.sel .blk-tools{display:flex}
.blk-tools .blk-name{font-weight:600;margin-right:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
.blk-tools{max-width:calc(100% - 20px)}
.blk-tools .m-only{display:none}
body.m-chrome .blk-tools .m-only,body.r-hidden .blk-tools .m-only{display:inline-block}
body.m-chrome .blk-tools .blk-name{max-width:90px}
.blk-tools button{background:none;border:none;color:inherit;cursor:pointer;width:24px;height:24px;border-radius:50%;font-size:13px;line-height:1}
.blk-tools button:hover{background:color-mix(in srgb, var(--bg) 25%, transparent)}
[data-edit]{transition:box-shadow .2s}
[data-edit]:hover{box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);border-radius:4px;cursor:text}
[data-edit]:focus{outline:none;box-shadow:0 0 0 2px var(--accent);border-radius:4px}
body.dropping::after{content:"Drop to add block";position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--accent);color:var(--on-accent);padding:8px 18px;border-radius:999px;font-size:13px;font-weight:600;font-family:system-ui;z-index:99}
.blk-add{
  position:absolute;left:50%;bottom:-14px;transform:translateX(-50%);z-index:70;
  width:28px;height:28px;border-radius:50%;border:none;cursor:pointer;
  background:var(--accent);color:var(--on-accent);font-size:16px;line-height:1;font-family:system-ui;
  box-shadow:0 4px 14px color-mix(in srgb, var(--accent) 50%, transparent);
  opacity:0;transition:opacity .2s, transform .2s;
}
.blk:hover .blk-add,.blk.sel .blk-add{opacity:1}
.blk-add:hover{transform:translateX(-50%) scale(1.15)}
.blk-add-end{
  display:block;margin:26px auto 40px;padding:12px 26px;border-radius:999px;border:1.5px dashed var(--accent);
  background:transparent;color:var(--accent);font-weight:600;font-size:14px;font-family:system-ui;cursor:pointer;transition:all .25s;
}
.blk-add-end:hover{background:var(--accent);color:var(--on-accent)}
.empty-canvas{min-height:70vh;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);padding:40px;font-size:1rem;line-height:1.7}
`;

function canvasDoc(){
  const plang = state.meta.lang || 'en';
  const pdir = RTL[plang] ? ' dir="rtl"' : '';
  return `<!DOCTYPE html><html lang="${plang}"${pdir}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${fontLink(state.theme)}">
<style>${siteCSS(state.theme)}${customCSS()}</style><style>${OVERLAY_CSS}</style></head>
<body class="tx-${state.theme.texture||'glow'}${isSmallChrome()?' m-chrome':''}">${state.blocks.length ? pageBodyHTML(true) : `<div class="empty-canvas">${t('_empty')}</div>`}<button class="blk-add-end" data-action="addend">${t('＋ Add block')}</button>${typeof privacySectionHTML==='function'?privacySectionHTML():''}${typeof waFabHTML==='function'?waFabHTML():''}</body></html>`;
}

let savedScroll = 0;
/* Chrome drops a srcdoc navigation that starts while the previous one is still loading, so two renders in one tick
   would leave the canvas stale. While a load is pending the newest document waits and is applied on load. */
let canvasPending = false, canvasQueued = null, canvasTimer = 0;
function renderCanvas(keepScroll=true){
  const win = frame.contentWindow;
  if (keepScroll && win) savedScroll = win.scrollY || 0;
  const doc = canvasDoc();
  if (canvasPending){ canvasQueued = doc; return; }
  applyCanvas(doc);
}
function applyCanvas(doc){
  canvasPending = true; clearTimeout(canvasTimer);
  const done = () => {
    clearTimeout(canvasTimer); canvasPending = false;
    if (canvasQueued){ const q = canvasQueued; canvasQueued = null; applyCanvas(q); return; }
    wireCanvas(); frame.contentWindow.scrollTo(0, savedScroll); markSelected();
  };
  frame.onload = done;
  canvasTimer = setTimeout(done, 4000); // safety net: never stay "pending" if load does not fire
  frame.srcdoc = doc;
}

function markSelected(){
  const doc = frame.contentDocument; if(!doc) return;
  $$('.blk', doc).forEach(el => el.classList.toggle('sel', el.dataset.id === selectedId));
}

function wireCanvas(){
  const doc = frame.contentDocument;
  if (doc.body){ doc.body.classList.toggle('m-chrome', isSmallChrome()); doc.body.classList.toggle('r-hidden', document.body.classList.contains('hide-right') && !isSmallChrome()); }

  /* click: toolbar actions or select */
  doc.addEventListener('click', e => {
    const act = e.target.closest('[data-action]');
    if (act){ e.preventDefault(); blockAction(act.dataset.action, act.dataset.id); return; }
    const blk = e.target.closest('.blk');
    if (e.target.closest('a') && !e.target.closest('[data-edit]')) e.preventDefault(); // don't navigate in editor
    const root = e.target.closest('.imp-root');
    const link = e.target.closest('a[href]'); // menu links between imported pages work in copies and in rebuilt blocks alike
    if (link && !e.altKey && (root || /^\/[a-z0-9-]*(#.*)?$/i.test(link.getAttribute('href') || ''))){
      const href = link.getAttribute('href') || '';
      const [pathPart, hash] = href.split('#');
      if (/^\/[a-z0-9-]*$/i.test(pathPart)){
        const slug = pathPart === '/' ? 'index' : pathPart.slice(1);
        const cur = state.meta.slug || (state.blocks.length && !state.meta.slug ? '' : 'index');
        if (slug === cur || (slug === 'index' && !state.meta.slug)){ if (hash){ const tEl = doc.getElementById(hash); if (tEl) tEl.scrollIntoView({behavior:'smooth'}); } return; }
        const id = findPageId(slug, siteRefOf(state));
        if (id){ openDraft(id); if (hash) setTimeout(()=>{ const d2 = frame.contentDocument; const tEl = d2 && d2.getElementById(hash); if (tEl) tEl.scrollIntoView(); }, 700); toast(t('Opened') + ' /' + (slug==='index'?'':slug) + '. ' + t('Hold Alt while clicking to edit a link instead.')); return; }
        toast(t('That page was not imported.')); return;
      }
      if (!pathPart && hash){ const tEl = doc.getElementById(hash); if (tEl) tEl.scrollIntoView({behavior:'smooth'}); return; }
      if (/^https?:/i.test(href) && (e.ctrlKey || e.metaKey)){ window.open(href, '_blank', 'noopener'); return; }
    }
    if (root){
      const media = e.target.closest(MEDIA_SEL);
      const all = [...root.querySelectorAll(MEDIA_SEL)];
      activeMedia = media && root.contains(media) ? all.indexOf(media) : -1;
    } else activeMedia = -1;
    select(blk ? blk.dataset.id : null);
  });

  /* inline text editing */
  $$('[data-edit]', doc).forEach(el => {
    el.setAttribute('contenteditable','true');
    el.setAttribute('spellcheck','false');
    el.addEventListener('focus', () => snapshot(), {once:false});
    el.addEventListener('input', () => {
      const blk = el.closest('.blk'); if(!blk) return;
      const b = state.blocks.find(x => x.id === blk.dataset.id); if(!b) return;
      // For the hero headline, preserve the *accent* convention on the way back in
      let v = el.innerText;
      if (b.type==='hero' && el.dataset.edit==='title'){
        // innerText loses <em>; read from DOM: rebuild with stars around em content
        v = htmlToStars(el);
      }
      b.props[el.dataset.edit] = v;
      autosave(); syncInspectorField(el.dataset.edit, v);
    });
    el.addEventListener('keydown', e => { if(e.key==='Enter' && el.tagName!=='P' && !el.classList.contains('tx')){ e.preventDefault(); el.blur(); } });
  });

  /* whole imported pages: the wrapper is editable, its markup is the block's html */
  $$('[data-rawedit]', doc).forEach(el => {
    el.setAttribute('contenteditable','true'); el.setAttribute('spellcheck','false');
    el.addEventListener('focus', () => snapshot());
    el.addEventListener('input', () => {
      const blk = el.closest('.blk'); if(!blk) return;
      const b = state.blocks.find(x => x.id === blk.dataset.id); if(!b) return;
      b.props.html = el.innerHTML; autosave(); syncInspectorField('html', b.props.html);
    });
  });

  /* drag-drop from library + reorder inside canvas */
  doc.addEventListener('dragover', e => {
    e.preventDefault();
    doc.body.classList.add('dropping');
    clearDropMarks(doc);
    const t = blockUnderY(doc, e.clientY);
    if (t.el) t.el.classList.add(t.before ? 'drop-top' : 'drop-bot');
  });
  doc.addEventListener('dragleave', e => { if(!e.relatedTarget) { doc.body.classList.remove('dropping'); clearDropMarks(doc);} });
  doc.addEventListener('drop', e => {
    e.preventDefault();
    doc.body.classList.remove('dropping'); clearDropMarks(doc);
    const type = e.dataTransfer.getData('lb/new');
    const moveId = e.dataTransfer.getData('lb/move');
    const t = blockUnderY(doc, e.clientY);
    let idx = state.blocks.length;
    if (t.el){ idx = state.blocks.findIndex(b=>b.id===t.el.dataset.id); if(!t.before) idx++; }
    if (type && BLOCKS[type]) addBlock(type, idx);
    else if (moveId) moveBlockTo(moveId, idx);
  });
}
function htmlToStars(el){
  let out='';
  el.childNodes.forEach(n=>{
    if(n.nodeType===3) out+=n.textContent;
    else if(n.tagName==='EM') out+='*'+n.textContent+'*';
    else out+=n.textContent;
  });
  return out;
}
function clearDropMarks(doc){ $$('.blk',doc).forEach(el=>el.classList.remove('drop-top','drop-bot')); }
function blockUnderY(doc, y){
  const blks = $$('.blk', doc);
  for (const el of blks){
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height/2) return {el, before:true};
    if (y < r.bottom) return {el, before:false};
  }
  return {el: blks[blks.length-1] || null, before:false};
}

/* =============== STATE OPS =============== */
function snapshot(){
  history.push(JSON.stringify(state));
  if (history.length > 60) history.shift();
  future = [];
  updateHistoryBtns();
}
function undo(){ if(!history.length) return; future.push(JSON.stringify(state)); state = JSON.parse(history.pop()); afterStateSwap(); }
function redo(){ if(!future.length) return; history.push(JSON.stringify(state)); state = JSON.parse(future.pop()); afterStateSwap(); }
function afterStateSwap(){
  if (state.siteCss){ for (const [k,v] of Object.entries(state.siteCss)) storeSiteCss(k, v, !state.meta.ephemeral); delete state.siteCss; }
  if (selectedId && !state.blocks.find(b=>b.id===selectedId)) selectedId = null;
  renderCanvas(); renderLayers(); renderInspector(); renderDesign(); autosave(); updateHistoryBtns(); updateTempUI();
  $('#pageTitle').value = state.meta.title;
}
function updateHistoryBtns(){ $('#undoBtn').disabled = !history.length; $('#redoBtn').disabled = !future.length; }

function addBlock(type, idx){
  snapshot();
  const b = { id: uid(), type, props: clone(BLOCKS[type].defaults) };
  state.blocks.splice(idx ?? state.blocks.length, 0, b);
  if (type === 'pricing') swapCurrencySymbols();
  selectedId = b.id;
  renderCanvas(); renderLayers(); renderInspector(); autosave();
  toast(t('{b} added').replace('{b}', t(BLOCKS[type].name)));
}
function moveBlockTo(id, idx){
  const from = state.blocks.findIndex(b=>b.id===id); if(from<0) return;
  snapshot();
  const [b] = state.blocks.splice(from,1);
  if (idx > from) idx--;
  state.blocks.splice(idx,0,b);
  renderCanvas(); renderLayers(); autosave();
}
function blockAction(action, id){
  if (action==='addend'){ openPicker(state.blocks.length); return; }
  if (action==='edit'){ setPanel('right', false); select(id); setView('style'); return; }
  const i = state.blocks.findIndex(b=>b.id===id); if(i<0) return;
  if (action==='addat'){ openPicker(i+1); return; }
  if (action==='del'){ snapshot(); state.blocks.splice(i,1); if(selectedId===id) selectedId=null; }
  if (action==='dupe'){ snapshot(); const c=clone(state.blocks[i]); c.id=uid(); state.blocks.splice(i+1,0,c); selectedId=c.id; }
  if (action==='up' && i>0){ snapshot(); [state.blocks[i-1],state.blocks[i]]=[state.blocks[i],state.blocks[i-1]]; }
  if (action==='down' && i<state.blocks.length-1){ snapshot(); [state.blocks[i+1],state.blocks[i]]=[state.blocks[i],state.blocks[i+1]]; }
  renderCanvas(); renderLayers(); renderInspector(); autosave();
}
function select(id){
  selectedId = id;
  markSelected(); renderLayers(); renderInspector();
  if (id){ $$('.ptab[data-rtab]').forEach(b=>b.classList.toggle('on', b.dataset.rtab==='block')); ['design','plugins','seo'].forEach(k=>$('#rtab-'+k).hidden=true); $('#rtab-block').hidden=false; }
}

/* =============== LEFT PANEL =============== */
function renderLibrary(){
  $('#lib').innerHTML = BLOCK_ORDER.map(ty=>{
    const d = BLOCKS[ty];
    return `<button class="lib-item" draggable="true" data-type="${ty}"><span class="ic">${d.icon}</span><span class="nm">${t(d.name)}</span><span class="ds">${t(d.desc)}</span></button>`;
  }).join('');
  $$('.lib-item').forEach(el=>{
    el.addEventListener('dragstart', e=>{ e.dataTransfer.setData('lb/new', el.dataset.type); e.dataTransfer.effectAllowed='copy'; });
    el.addEventListener('click', ()=> addBlock(el.dataset.type));
  });
}
function renderLayers(){
  const wrap = $('#layers');
  if (!state.blocks.length){ wrap.innerHTML = `<div class="empty-note">${t('No blocks yet. Add some from the Blocks tab.')}</div>`; return; }
  const snippet = b => { const p=b.props; const v = p.title || p.eyebrow || p.text || p.brand || (p.items && p.items[0] && (p.items[0].title||p.items[0].name||p.items[0].label||p.items[0].q)) || ''; return String(v).replace(/\*/g,'').replace(/\s+/g,' ').trim().slice(0,34); };
  wrap.innerHTML = state.blocks.map(b=>`<div class="layer ${b.id===selectedId?'on':''}" draggable="true" data-id="${b.id}">
    <span class="ic">${BLOCKS[b.type].icon}</span><span class="nm">${t(BLOCKS[b.type].name)}${snippet(b)?`<span class="sub">${esc(snippet(b))}</span>`:''}</span><span class="grip">⋮⋮</span></div>`).join('');
  $$('.layer', wrap).forEach(el=>{
    el.addEventListener('click', ()=>{ select(el.dataset.id);
      const doc=frame.contentDocument, t=doc && doc.querySelector(`.blk[data-id="${el.dataset.id}"]`);
      if(t) t.scrollIntoView({behavior:'smooth', block:'start'});
    });
    el.addEventListener('dragstart', e=> e.dataTransfer.setData('lb/move', el.dataset.id));
    el.addEventListener('dragover', e=>{
      e.preventDefault();
      const r=el.getBoundingClientRect(), before = e.clientY < r.top + r.height/2;
      el.classList.toggle('drag-over-top', before); el.classList.toggle('drag-over-bot', !before);
    });
    el.addEventListener('dragleave', ()=> el.classList.remove('drag-over-top','drag-over-bot'));
    el.addEventListener('drop', e=>{
      e.preventDefault(); el.classList.remove('drag-over-top','drag-over-bot');
      const id = e.dataTransfer.getData('lb/move'); if(!id||id===el.dataset.id) return;
      const r=el.getBoundingClientRect(), before = e.clientY < r.top + r.height/2;
      let idx = state.blocks.findIndex(b=>b.id===el.dataset.id); if(!before) idx++;
      moveBlockTo(id, idx);
    });
  });
}

/* =============== INSPECTOR =============== */
function renderInspector(){
  const wrap = $('#rtab-block');
  const b = state.blocks.find(x=>x.id===selectedId);
  if (!b){ wrap.innerHTML = `<div class="no-sel">${t('_noSel')}</div>`; return; }
  const def = BLOCKS[b.type];
  let html = `<div class="insp-blockname"><span class="ic">${def.icon}</span><span class="nm">${t(def.name)}</span>
    <button class="mini" title="${t('Duplicate')}" data-ia="dupe">⧉</button><button class="mini danger" title="${t('Delete')}" data-ia="del">✕</button></div>`;
  html += def.fields.map(f=>fieldHTML(f, f.k ? b.props[f.k] : undefined, `p.${f.k||f.id}`)).join('');
  if (def.section !== false){
    const anchor = (b.props.anchor === undefined || b.props.anchor === null) ? (DEFAULT_ANCHOR[b.type] || '') : b.props.anchor;
    html += `<h4 class="grp">${t('Section')}</h4>`
      + fieldHTML({k:'anchor',l:'Anchor id (link to it with #id)',t:'text'}, anchor, 'p.anchor')
      + fieldHTML({k:'pad',l:'Vertical spacing',t:'seg',opts:[['sm','Tight'],['md','Normal'],['lg','Roomy']]}, b.props.pad||'md', 'p.pad')
      + (def.alignable ? fieldHTML({k:'align',l:'Heading alignment',t:'seg',opts:[['left','Left'],['center','Center']]}, b.props.align||'left', 'p.align') : '')
      + fieldHTML({k:'bg',l:'Background colour',t:'color'}, b.props.bg||'', 'p.bg')
      + fieldHTML({k:'ink',l:'Text colour',t:'color'}, b.props.ink||'', 'p.ink')
      + fieldHTML({k:'css',l:'Custom CSS for this section only (e.g. h2{font-size:3rem} or .btn{border-radius:0})',t:'textarea'}, b.props.css||'', 'p.css');
  }
  wrap.innerHTML = html;
  wireFields(wrap, b);
  if (b.type==='html') wireMedia(wrap, b);
  $$('[data-ia]',wrap).forEach(btn=>btn.addEventListener('click',()=>blockAction(btn.dataset.ia, b.id)));
  $$('[data-act-id]',wrap).forEach(btn=>btn.addEventListener('click',()=>{ const fn=BLOCK_ACTIONS[btn.dataset.actId]; if(fn) fn(b, btn); }));
}

/* ---- media inside an imported page: list, replace, upload ---- */
let activeMedia = -1;
const MEDIA_SEL = 'img, video, iframe, [style*="background-image"]';
function mediaDoc(html){ return new DOMParser().parseFromString('<!doctype html><body><div id="__m">' + (html||'') + '</div>', 'text/html').getElementById('__m'); }
function mediaKind(el){ const tg = el.tagName; return tg==='IMG' ? 'img' : tg==='VIDEO' ? 'video' : tg==='IFRAME' ? 'iframe' : 'bg'; }
function mediaUrl(el){
  const k = mediaKind(el);
  if (k==='bg'){ const m = (el.getAttribute('style')||'').match(/background(?:-image)?\s*:[^;]*url\((['"]?)([^'")]+)\1\)/i); return m ? m[2] : ''; }
  if (k==='video'){ const so = el.querySelector('source[src]'); return el.getAttribute('src') || (so ? so.getAttribute('src') : '') || ''; }
  return el.getAttribute('src') || '';
}
function mediaList(html){
  const root = mediaDoc(html);
  return [...root.querySelectorAll(MEDIA_SEL)].map((el, i) => ({ i, kind: mediaKind(el), url: mediaUrl(el), alt: el.getAttribute && (el.getAttribute('alt') || el.getAttribute('title') || '') }));
}
function replaceMedia(b, i, url){
  url = String(url||'').trim(); if (!url) return;
  const root = mediaDoc(b.props.html);
  const el = root.querySelectorAll(MEDIA_SEL)[i]; if (!el) return;
  const kind = mediaKind(el);
  const vid = parseVideo(url);
  const isFile = /\.(mp4|webm|mov|ogv|m4v)(\?|#|$)/i.test(url);
  const carry = n => { for (const a of ['class','id','width','height']){ const v = el.getAttribute(a); if (v) n.setAttribute(a, v); } const st = el.getAttribute('style'); if (st && kind!=='bg') n.setAttribute('style', st); return n; };
  if (kind==='bg'){
    el.setAttribute('style', (el.getAttribute('style')||'').replace(/(background(?:-image)?\s*:[^;]*url\()(['"]?)[^'")]+\2(\))/i, `$1"${url}"$3`));
  } else if (vid){
    const f = carry(document.createElement('iframe'));
    f.setAttribute('src', vid.src); f.setAttribute('loading','lazy'); f.setAttribute('allowfullscreen',''); f.setAttribute('allow','accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'); f.setAttribute('title','Video');
    f.setAttribute('style', ((f.getAttribute('style')||'') + ';border:0;display:block;max-width:100%;aspect-ratio:16/9' + (el.getAttribute('width')?'':';width:100%')).replace(/^;/,''));
    f.removeAttribute('height');
    el.replaceWith(f);
  } else if (isFile){
    const v = kind==='video' ? el : carry(document.createElement('video'));
    v.querySelectorAll('source').forEach(x=>x.remove());
    v.setAttribute('src', url); v.setAttribute('controls',''); v.setAttribute('playsinline',''); v.setAttribute('preload','metadata');
    if (kind!=='video'){ v.setAttribute('style', ((v.getAttribute('style')||'') + ';display:block;max-width:100%').replace(/^;/,'')); el.replaceWith(v); }
  } else {
    const im = kind==='img' ? el : carry(document.createElement('img'));
    im.setAttribute('src', url); ['srcset','sizes','data-src','data-srcset','data-lazy-src','data-lazy-srcset'].forEach(a=>im.removeAttribute(a));
    if (kind!=='img'){ im.setAttribute('alt',''); im.setAttribute('style', ((im.getAttribute('style')||'') + ';display:block;max-width:100%').replace(/^;/,'')); el.replaceWith(im); }
  }
  b.props.html = root.innerHTML;
}
async function uploadToUrl(file){
  const { blob, type } = await optimizeImage(file);
  const b64 = await blobToBase64(blob);
  if (clientMode){
    let code = null; try{ code = localStorage.getItem('lb-access'); }catch(e){}
    try{ const r = await fetch('/api/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code, name:file.name, type, data:b64 }) }); const d = await r.json(); if (d.ok) return d.url; }catch(e){}
  }
  return `data:${type};base64,${b64}`;
}
function wireMedia(wrap, b){
  $$('.media-url', wrap).forEach(inp => {
    inp.addEventListener('focus', ()=>snapshot());
    inp.addEventListener('change', ()=>{ replaceMedia(b, +inp.dataset.media, inp.value); renderCanvas(); renderInspector(); autosave(); toast(t('Updated')); });
  });
  $$('[data-mup]', wrap).forEach(btn => btn.addEventListener('click', ()=>{ const f = wrap.querySelector(`.mup-file[data-media="${btn.dataset.mup}"]`); if (f) f.click(); }));
  $$('.mup-file', wrap).forEach(inp => inp.addEventListener('change', async ()=>{
    const file = inp.files && inp.files[0]; if (!file) return; const i = +inp.dataset.media; inp.value = '';
    const btn = wrap.querySelector(`[data-mup="${i}"]`); const orig = btn ? btn.textContent : '';
    if (btn){ btn.disabled = true; btn.textContent = t('Uploading…'); }
    try{ const url = await uploadToUrl(file); snapshot(); replaceMedia(b, i, url); renderCanvas(); renderInspector(); autosave(); toast(t('Image added')); }
    catch(e){ toast(e && e.message==='too-large' ? t('That image is too large (max 10 MB)') : t('Upload failed. Try again, or paste a URL instead.')); if (btn){ btn.disabled=false; btn.textContent=orig; } }
  }));
  const on = wrap.querySelector('.media-row.on'); if (on) setTimeout(()=>on.scrollIntoView({block:'center'}), 30);
}

/* Block-level actions triggered from the inspector */
const BLOCK_ACTIONS = {
  /* every remote image in an imported page -> our Blob store, then the markup and CSS point at the copies */
  async copyAssets(b, btn){
    const urls = new Set();
    const doc = new DOMParser().parseFromString('<div>'+(b.props.html||'')+'</div>', 'text/html');
    doc.querySelectorAll('img[src], source[src], [poster]').forEach(el=>{ const u=el.getAttribute('src')||el.getAttribute('poster'); if(/^https?:/i.test(u)) urls.add(u); });
    doc.querySelectorAll('[srcset]').forEach(el=>el.getAttribute('srcset').split(',').forEach(p=>{ const u=p.trim().split(/\s+/)[0]; if(/^https?:/i.test(u)) urls.add(u); }));
    for (const m of String(b.props.css||'').matchAll(/url\("?(https?:[^")]+\.(?:png|jpe?g|webp|gif|svg|avif|ico|woff2?|ttf|otf|eot)(?:[?#][^")]*)?)"?\)/gi)) urls.add(m[1]);
    for (const m of String(b.props.html||'').matchAll(/url\((['"]?)(https?:[^'")]+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^'")]*)?)\1\)/gi)) urls.add(m[2]);
    const list = [...urls].filter(u => !/vercel-storage\.com/i.test(u)).slice(0, 80);
    if (!list.length){ toast(t('No remote images or fonts left to copy.')); return; }
    btn.disabled = true; const label = btn.textContent;
    snapshot();
    let done = 0, failed = 0; const map = {};
    for (const u of list){
      btn.textContent = t('Copying') + ' ' + (done+failed+1) + '/' + list.length + '…';
      try{
        const r = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'asset', url:u }) });
        const d = await r.json();
        if (d.ok && d.url){ map[u] = d.url; done++; }
        else { failed++; if (d.reason==='no-blob-store'){ toast(t('Image storage is not set up on the server.')); break; } }
      }catch(e){ failed++; }
    }
    const swap = str => { for (const [from,to] of Object.entries(map)) str = str.split(from).join(to); return str; };
    b.props.html = swap(b.props.html||''); b.props.css = swap(b.props.css||'');
    btn.disabled = false; btn.textContent = label;
    renderCanvas(); renderInspector(); autosave();
    toast(done + ' ' + t('files copied') + (failed ? ', ' + failed + ' ' + t('skipped') : ''));
  }
};

const AI_SKIP = /href|url|img|logo|anchor|email|phone|action|price|currency|cols|stars|height|video|link|where|fine|html|css|code|links|src|number|page|id$/i;
function labelHTML(f, id, val){
  const ai = f.ai !== false && !AI_SKIP.test(f.k || '') && (f.t === 'textarea' || f.t === 'text');
  return ai ? `<div class="lab-row"><label for="${id}">${t(f.l)}</label><button type="button" class="ai-btn" data-ai="${id}" title="${t('Improve this text with AI')}">✨ ${t('AI')}</button></div>` : `<label for="${id}">${t(f.l)}</label>`;
}
function fieldHTML(f, val, path){
  const id = 'f_'+String(path||f.id||f.t).replace(/[^\w]/g,'_');
  if (f.t==='text'){
    const upBtn = f.up ? `<div class="up-row"><button class="up-btn" type="button" data-up="${path}">\u2b06 ${t('Upload image')}</button><input type="file" class="up-file" accept="image/jpeg,image/png,image/webp" data-path="${path}" hidden /></div>` : '';
    return `<div class="field">${labelHTML(f, id, val)}<input class="in" id="${id}" data-path="${path}" value="${escAttr(val??'')}" />${upBtn}</div>`;
  }
  if (f.t==='color'){
    const hex = /^#[0-9a-f]{6}$/i.test(String(val||'').trim()) ? String(val).trim() : '#ffffff';
    return `<div class="field"><label for="${id}">${t(f.l)}</label><div class="color-row"><input type="color" class="cpick" data-for="${id}" value="${hex}" aria-label="${t('Pick a colour')}" /><input class="in" id="${id}" data-path="${path}" value="${escAttr(val??'')}" placeholder="${t('blank = theme')}" /><button type="button" class="mini" data-clear="${id}" title="${t('Clear')}">✕</button></div></div>`;
  }
  if (f.t==='textarea') return `<div class="field">${labelHTML(f, id, val)}<textarea id="${id}" data-path="${path}"${f.k==='html'||f.k==='css'||f.k==='code'?' style="font-family:ui-monospace,Consolas,monospace;font-size:.72rem;min-height:120px"':''}>${esc(val??'')}</textarea></div>`;
  if (f.t==='media'){
    const b = state.blocks.find(x=>x.id===selectedId); const list = b ? mediaList(b.props.html) : [];
    if (!list.length) return `<div class="field"><label>${t(f.l)}</label><div class="empty-note" style="padding:4px 0">${t('No pictures or videos found in this page yet.')}</div></div>`;
    const shown = list.slice(0, 80);
    return `<div class="field"><label>${t(f.l)} (${list.length})</label>
      <div class="empty-note" style="padding:0 0 8px">${t('Click a picture on the page to jump to it here. Paste a new image address, upload your own, or paste a YouTube, Vimeo or .mp4 link to turn that spot into a video.')}</div>
      <div class="media-list">${shown.map(m => `<div class="media-row${m.i===activeMedia?' on':''}" data-mrow="${m.i}">
        <div class="media-th">${m.kind==='img'||m.kind==='bg' ? `<img src="${escAttr(m.url)}" alt="" loading="lazy" />` : `<span class="ic">${m.kind==='iframe'?'▶':'🎬'}</span>`}</div>
        <div class="media-body">
          <div class="media-kind">${m.i+1}. ${t(m.kind==='img'?'Image':m.kind==='bg'?'Background image':m.kind==='video'?'Video':'Embed')}${m.alt?` · ${esc(String(m.alt).slice(0,30))}`:''}</div>
          <input class="in media-url" data-media="${m.i}" value="${escAttr(m.url)}" placeholder="https://… or a YouTube link" />
          <div class="up-row"><button class="up-btn" type="button" data-mup="${m.i}">⬆ ${t('Upload image')}</button><input type="file" class="mup-file" accept="image/jpeg,image/png,image/webp" data-media="${m.i}" hidden /></div>
        </div></div>`).join('')}${list.length>shown.length?`<div class="empty-note">${t('Showing the first 80. Edit the rest in the HTML below.')}</div>`:''}</div></div>`;
  }
  if (f.t==='action') return `<div class="field"><button class="up-btn" type="button" data-act-id="${f.id}">${t(f.l)}</button>${f.note?`<div class="empty-note" style="padding:6px 0 0">${t(f.note)}</div>`:''}</div>`;
  if (f.t==='seg') return `<div class="field"><label>${t(f.l)}</label><div class="seg" data-path="${path}">${f.opts.map(([v,l])=>`<button data-v="${v}" class="${String(val)===v?'on':''}">${t(l)}</button>`).join('')}</div></div>`;
  if (f.t==='toggle') return `<div class="field"><div class="toggle"><label style="margin:0">${t(f.l)}</label><button class="tg ${val?'on':''}" data-path="${path}" role="switch" aria-checked="${!!val}"></button></div></div>`;
  if (f.t==='items'){
    const items = val||[];
    return `<div class="field"><label>${t(f.l)}</label>
      ${items.map((it,i)=>`<details class="item-card" ${(items.length<=3 || i===items.length-1)?'open':''}>
        <summary class="item-head"><span class="t">${esc(it[f.titleKey]||('Item '+(i+1)))}</span>
          <button class="mini" data-im="up" data-p="${path}" data-i="${i}" title="${t('Move up')}">↑</button>
          <button class="mini" data-im="down" data-p="${path}" data-i="${i}" title="${t('Move down')}">↓</button>
          <button class="mini danger" data-im="del" data-p="${path}" data-i="${i}" title="${t('Remove')}">✕</button></summary>
        <div class="item-body">${f.item.map(sf=>fieldHTML(sf, it[sf.k], `${path}.${i}.${sf.k}`)).join('')}</div>
      </details>`).join('')}
      <button class="add-item" data-add="${path}" data-f="${f.k}">${t('+ Add item')}</button></div>`;
  }
  return '';
}

/* =============== PLUGINS TAB =============== */
function ensurePlugins(){
  const d = { wa:{on:false,phone:'',msg:''}, ms:{on:false,page:''}, vb:{on:false,number:''}, ga:{on:false,id:''}, fbp:{on:false,id:''}, custom:{on:false,head:''}, priv:{on:false,email:''} };
  state.plugins = state.plugins || {};
  for (const k in d) state.plugins[k] = Object.assign({}, d[k], state.plugins[k]||{});
  return state.plugins;
}
function plugRow(key, title, sub, fieldsHTML){
  const p = state.plugins[key];
  return `<div class="plug ${p.on?'on':''}" data-plug="${key}">
    <div class="toggle" style="margin-bottom:${p.on?'10px':'0'}">
      <label style="margin:0;font-size:.82rem;color:var(--ink);font-weight:700">${title}</label>
      <button class="tg ${p.on?'on':''}" data-pltg="${key}" role="switch" aria-checked="${p.on}"></button>
    </div>
    ${p.on ? `<div class="plug-body">${sub?`<div class="empty-note" style="padding:0 0 8px">${sub}</div>`:''}${fieldsHTML}</div>` : ''}
  </div>`;
}
function renderPlugins(){
  ensurePlugins();
  const P = state.plugins;
  const inp = (k,f,ph,val,ta) => ta
    ? `<textarea class="in" data-pl="${k}.${f}" placeholder="${escAttr(ph)}" style="min-height:90px;font-family:monospace;font-size:.78rem">${esc(val||'')}</textarea>`
    : `<input class="in" data-pl="${k}.${f}" placeholder="${escAttr(ph)}" value="${escAttr(val||'')}" />`;
  $('#rtab-plugins').innerHTML = `
    ${plugRow('wa', t('WhatsApp chat button'), '', `
      <div class="field"><label>${t('Phone number (with country code)')}</label>${inp('wa','phone','639171234567',P.wa.phone)}</div>
      <div class="field"><label>${t('Preset message (optional)')}</label>${inp('wa','msg','Hi! I saw your website…',P.wa.msg)}</div>`)}
    ${plugRow('ms', t('Messenger chat button'), '', `
      <div class="field"><label>${t('Facebook page username or m.me link')}</label>${inp('ms','page','yourpage',P.ms.page)}</div>`)}
    ${plugRow('vb', t('Viber chat button'), '', `
      <div class="field"><label>${t('Viber number (with country code)')}</label>${inp('vb','number','639171234567',P.vb.number)}</div>`)}
    ${plugRow('ga', t('Google Analytics'), t('Applied on the exported site.'), `
      <div class="field"><label>${t('Measurement ID')}</label>${inp('ga','id','G-XXXXXXXXXX',P.ga.id)}</div>`)}
    ${plugRow('fbp', t('Facebook Pixel'), t('Applied on the exported site.'), `
      <div class="field"><label>${t('Pixel ID')}</label>${inp('fbp','id','1234567890',P.fbp.id)}</div>`)}
    ${plugRow('priv', t('Privacy policy section'), t('Adds a plain-language privacy section at the bottom of the page. It adapts to the features you enable. A starter, not legal advice.'), `
      <div class="field"><label>${t('Contact email for privacy requests')}</label>${inp('priv','email','hello@yourbrand.com',P.priv.email)}</div>`)}
    ${plugRow('custom', t('Custom head code'), t('Paste analytics or verification tags. Applied on export.'), `
      <div class="field">${inp('custom','head','<meta name=…>',P.custom.head,true)}</div>`)}
  `;
  $('#rtab-plugins').querySelectorAll('[data-pltg]').forEach(b=>b.addEventListener('click',()=>{
    const k = b.dataset.pltg; snapshot();
    state.plugins[k].on = !state.plugins[k].on;
    renderPlugins(); renderCanvas(); autosave();
  }));
  $('#rtab-plugins').querySelectorAll('[data-pl]').forEach(el=>el.addEventListener('change',()=>{
    const [k,f] = el.dataset.pl.split('.');
    state.plugins[k][f] = el.value;
    renderCanvas(); autosave();
  }));
}

/* =============== SEO TAB =============== */
function firstImage(){
  for (const b of state.blocks){
    if (b.props.img) return b.props.img;
    if (b.type==='gallery') for (const it of b.props.items) if (it.img) return it.img;
  }
  return '';
}
function seoChecks(){
  const title = state.meta.title||'', desc = state.meta.desc||'';
  const has = ty => state.blocks.some(b=>b.type===ty);
  const imgsOk = state.blocks.every(b=>{
    if (b.type==='hero') return !b.props.img || !!b.props.imgLabel;
    if (b.type==='split') return !b.props.img || !!b.props.alt;
    if (b.type==='gallery') return b.props.items.every(i=>!i.img || !!i.caption);
    return true;
  });
  const contact = state.blocks.find(b=>b.type==='contact');
  return [
    { ok: title.length>=10 && title.length<=60, l:'Page title 10–60 characters' },
    { ok: desc.length>=50 && desc.length<=160, l:'SEO description 50–160 characters' },
    { ok: has('hero'), l:'Has a main headline (Hero)' },
    { ok: imgsOk, l:'All images have alt text' },
    { ok: !!contact && !!(contact.props.email||contact.props.phone), l:'Contact details on the page' },
    { ok: has('footer'), l:'Footer present' },
    { ok: /^https?:\/\//.test(state.meta.siteUrl||''), l:'Site URL set' },
    { ok: !!(state.meta.ogImage || firstImage()), l:'Social share image set' },
    { ok: state.blocks.length>=4, l:'At least 4 sections' },
    { ok: has('cta')||has('pricing'), l:'Has a call to action (CTA or Pricing)' }
  ];
}
function renderSEO(){
  const checks = seoChecks();
  const n = checks.filter(c=>c.ok).length;
  const pct = Math.round(n/checks.length*100);
  const col = pct>=80 ? '#2c7a4b' : pct>=50 ? '#EDA33F' : '#c0392b';
  $('#rtab-seo').innerHTML = `
    <div class="seo-score"><div class="num" style="color:${col}">${n}<span>/${checks.length}</span></div>
      <div class="bar"><i style="width:${pct}%;background:${col}"></i></div>
      <div class="empty-note" style="padding:6px 0 0">${t('SEO score')}. ${t('Fix the unchecked items to strengthen this page.')}</div>
    </div>
    <div class="seo-list">${checks.map(c=>`<div class="seo-item ${c.ok?'ok':''}"><span class="m">${c.ok?'✓':'•'}</span>${t(c.l)}</div>`).join('')}</div>
    <h4>${t('Page meta')}</h4>
    <div class="field"><label>${t('Site URL (canonical)')}</label><input class="in" data-seo="siteUrl" placeholder="https://yourbrand.com" value="${escAttr(state.meta.siteUrl||'')}" /></div>
    <div class="field"><label>${t('Social share image URL')}</label><input class="in" data-seo="ogImage" placeholder="${escAttr(t('Uses your first image when blank'))}" value="${escAttr(state.meta.ogImage||'')}" /></div>
  `;
  $('#rtab-seo').querySelectorAll('[data-seo]').forEach(el=>el.addEventListener('change',()=>{
    state.meta[el.dataset.seo] = el.value.trim();
    renderSEO(); autosave();
  }));
}

/* image upload buttons (delegated once) */
$('#rtab-block').addEventListener('click', e=>{
  const btn = e.target.closest('.up-btn'); if(!btn) return;
  const file = $('#rtab-block').querySelector(`.up-file[data-path="${btn.dataset.up}"]`);
  if (file) file.click();
});
$('#rtab-block').addEventListener('change', async e=>{
  const inp = e.target.closest('.up-file'); if(!inp || !inp.files || !inp.files[0]) return;
  const file = inp.files[0]; const path = inp.dataset.path;
  inp.value = '';
  await handleImageUpload(file, path);
});

function setByPath(b, path, value){
  // path like p.items.0.title
  const parts = path.split('.').slice(1);
  let o = b.props;
  for (let i=0;i<parts.length-1;i++) o = o[parts[i]];
  o[parts[parts.length-1]] = value;
}

let typingSnap = false;
function wireFields(wrap, b){
  $$('input.in, textarea', wrap).forEach(el=>{
    el.addEventListener('focus', ()=>{ snapshot(); typingSnap=true; });
    el.addEventListener('input', ()=>{
      setByPath(b, el.dataset.path, el.value);
      liveUpdate(b, el.dataset.path, el.value);
      autosave();
    });
    el.addEventListener('change', ()=>{ renderCanvas(); renderLayers(); });
  });
  $$('.seg', wrap).forEach(seg=>{
    $$('button',seg).forEach(btn=>btn.addEventListener('click',()=>{
      snapshot(); setByPath(b, seg.dataset.path, btn.dataset.v);
      $$('button',seg).forEach(x=>x.classList.toggle('on',x===btn));
      renderCanvas(); autosave();
    }));
  });
  $$('.tg', wrap).forEach(tg=>tg.addEventListener('click',()=>{
    snapshot();
    const parts = tg.dataset.path.split('.').slice(1);
    let o=b.props; for(let i=0;i<parts.length-1;i++) o=o[parts[i]];
    const k=parts[parts.length-1]; o[k]=!o[k];
    tg.classList.toggle('on',o[k]); tg.setAttribute('aria-checked',o[k]);
    renderCanvas(); autosave();
  }));
  $$('[data-im]', wrap).forEach(btn=>btn.addEventListener('click',(ev)=>{
    ev.preventDefault(); ev.stopPropagation();
    const arrPath=btn.dataset.p, i=+btn.dataset.i;
    const parts=arrPath.split('.').slice(1); let o=b.props;
    for(const pt of parts) o=o[pt];
    snapshot();
    if(btn.dataset.im==='del') o.splice(i,1);
    if(btn.dataset.im==='up'&&i>0) [o[i-1],o[i]]=[o[i],o[i-1]];
    if(btn.dataset.im==='down'&&i<o.length-1) [o[i+1],o[i]]=[o[i],o[i+1]];
    renderCanvas(); renderInspector(); autosave();
  }));
  $$('.cpick', wrap).forEach(cp=>cp.addEventListener('input',()=>{ const el = wrap.querySelector('#'+cp.dataset.for); if(!el) return; if(!typingSnap){ snapshot(); typingSnap=true; } el.value = cp.value; el.dispatchEvent(new Event('input')); clearTimeout(cp._t); cp._t = setTimeout(()=>el.dispatchEvent(new Event('change')), 250); }));
  $$('[data-clear]', wrap).forEach(x=>x.addEventListener('click',()=>{ const el = wrap.querySelector('#'+x.dataset.clear); if(!el) return; snapshot(); el.value=''; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }));
  $$('.ai-btn', wrap).forEach(btn=>btn.addEventListener('click', ev=>{ ev.preventDefault(); openAiMenu(btn, wrap.querySelector('#'+btn.dataset.ai), b); }));
  $$('[data-add]', wrap).forEach(btn=>btn.addEventListener('click',()=>{
    const f = BLOCKS[b.type].fields.find(x=>x.k===btn.dataset.f);
    snapshot();
    const blank={}; f.item.forEach(sf=>blank[sf.k]= sf.t==='toggle'?false:'');
    b.props[f.k].push(blank);
    renderCanvas(); renderInspector(); autosave();
  }));
}

/* ---- AI copy help: a small menu on every copy field; /api/ai rewrites the text with Claude ---- */
const AI_TASKS = [['improve','Improve'],['shorten','Make it shorter'],['expand','Say a bit more'],['punchy','Punchier'],['fix','Fix spelling and grammar'],['translate','Translate to the page language']];
let aiMenuEl = null;
function closeAiMenu(){ if (aiMenuEl){ aiMenuEl.remove(); aiMenuEl = null; } }
document.addEventListener('click', e => { if (aiMenuEl && !e.target.closest('.ai-menu') && !e.target.closest('.ai-btn')) closeAiMenu(); });
function openAiMenu(btn, el, b){
  if (aiMenuEl && aiMenuEl._for === btn){ closeAiMenu(); return; }
  closeAiMenu();
  if (!el) return;
  const m = document.createElement('div'); m.className = 'ai-menu'; m._for = btn;
  m.innerHTML = `<div class="hd">${t('Rewrite with AI')}</div>` + AI_TASKS.map(([k,l]) => `<button type="button" data-task="${k}">${t(l)}</button>`).join('');
  document.body.appendChild(m); aiMenuEl = m;
  const r = btn.getBoundingClientRect(); const w = m.offsetWidth || 180;
  m.style.top = Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 6) + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  $$('button', m).forEach(x => x.addEventListener('click', () => { closeAiMenu(); aiRewrite(btn, el, b, x.dataset.task); }));
}
async function aiRewrite(btn, el, b, task){
  const text = String(el.value || '').trim();
  if (!text){ toast(t('Type something first, then ask AI to improve it.')); return; }
  if (!clientMode){ renderAccessModal(true); openModal('accessModal'); return; }
  btn.classList.add('busy'); const old = btn.textContent; btn.textContent = '…';
  try{
    const r = await fetch('/api/ai', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ task, text, context: { site: state.meta.title || '', desc: state.meta.desc || '', block: b ? b.type : '', field: (el.dataset.path || '').split('.').pop(), lang: state.meta.lang || 'en', multiline: el.tagName === 'TEXTAREA' } }) });
    if (r.status === 401) throw new Error(t('Your session has expired. Sign in again.'));
    const d = await r.json();
    if (!d.ok){
      if (d.reason === 'no-key') throw new Error(t('AI help is not switched on yet: add ANTHROPIC_API_KEY in the Vercel project settings.'));
      if (d.reason === 'slow-down') throw new Error(t('Too many requests. Give it a minute.'));
      throw new Error(t('AI could not rewrite this') + (d.detail ? ': ' + d.detail : '.'));
    }
    const out = String(d.text || '').trim(); if (!out) throw new Error(t('AI returned nothing.'));
    snapshot(); el.value = out; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); el.focus();
    toast(t('Rewritten. Ctrl+Z brings the old text back.'));
  }catch(e){ toast(e && e.message || t('AI could not rewrite this.')); }
  finally{ btn.classList.remove('busy'); btn.textContent = old; }
}

/* live-update simple top-level text on canvas without full re-render (keeps focus) */
function liveUpdate(b, path, value){
  const parts = path.split('.');
  if (parts.length===2){ // top-level prop → try inline node
    const doc = frame.contentDocument;
    const node = doc && doc.querySelector(`.blk[data-id="${b.id}"] [data-edit="${parts[1]}"]`);
    if (node){
      if (b.type==='hero'&&parts[1]==='title') node.innerHTML = esc(value).replace(/\*(.+?)\*/g,'<em>$1</em>');
      else node.innerText = value;
      return;
    }
  }
  clearTimeout(liveUpdate._t);
  liveUpdate._t = setTimeout(()=>renderCanvas(), 350);
}
function syncInspectorField(key, value){
  const b = state.blocks.find(x=>x.id===selectedId); if(!b) return;
  const el = $(`#rtab-block [data-path="p.${key}"]`);
  if (el && el.value!==undefined && document.activeElement!==el) el.value = value;
}

/* =============== DESIGN TAB =============== */
function renderDesign(){
  const th = state.theme;
  $('#rtab-design').innerHTML = `
    <h4>${t('Palette')}</h4>
    <div class="swatches" style="margin-bottom:14px">${Object.entries(PALETTES).map(([k,p])=>`
      <button class="swatch ${th.palette===k?'on':''}" data-pal="${k}" title="${p.name}" style="background:linear-gradient(135deg, ${p.bg} 48%, ${p.accent} 48% 74%, ${p.accent2} 74%)"></button>`).join('')}
    </div>
    <div class="field"><label>${t('Accent')}</label><div class="colorwrap"><input type="color" data-tk="accent" value="${th.accent}"><input class="in hex" data-tk="accent" value="${th.accent}"></div></div>
    <div class="field"><label>${t('Second accent')}</label><div class="colorwrap"><input type="color" data-tk="accent2" value="${th.accent2}"><input class="in hex" data-tk="accent2" value="${th.accent2}"></div></div>
    <div class="field-row">
      <div class="field"><label>${t('Background')}</label><div class="colorwrap"><input type="color" data-tk="bg" value="${th.bg}"></div></div>
      <div class="field"><label>${t('Text')}</label><div class="colorwrap"><input type="color" data-tk="ink" value="${th.ink}"></div></div>
    </div>
    <h4>${t('Type')}</h4>
    <div class="field"><select data-tk="font">${th.fontCustom?`<option value="custom" ${th.font==='custom'?'selected':''}>${esc('Imported: '+th.fontCustom.name)}</option>`:''}${Object.entries(FONTS).map(([k,f])=>`<option value="${k}" ${th.font===k?'selected':''}>${f.name}</option>`).join('')}</select></div>
    <h4>${t('Corners')}</h4>
    <div class="field"><input type="range" min="0" max="34" value="${th.radius}" data-tk="radius"><label style="margin-top:4px">${t('Radius')}: <span id="radv">${th.radius}</span>px</label></div>
    <h4>${t('Spacing')}</h4>
    <div class="field"><div class="seg" data-density>${[['compact','Compact'],['normal','Normal'],['roomy','Roomy']].map(([v,l])=>`<button data-v="${v}" class="${(th.density||'normal')===v?'on':''}">${t(l)}</button>`).join('')}</div></div>
    <h4>${t('Buttons')}</h4>
    <div class="field"><div class="seg" data-tseg="btn">${[['pill','Pill'],['soft','Rounded'],['sharp','Square']].map(([v,l])=>`<button data-v="${v}" class="${(th.btn||'pill')===v?'on':''}">${t(l)}</button>`).join('')}</div></div>
    <h4>${t('Content width')}</h4>
    <div class="field"><div class="seg" data-tseg="width">${[['narrow','Narrow'],['normal','Normal'],['wide','Wide']].map(([v,l])=>`<button data-v="${v}" class="${(th.width||'normal')===v?'on':''}">${t(l)}</button>`).join('')}</div></div>
    <h4>${t('Type size')}</h4>
    <div class="field"><div class="seg" data-tseg="scale">${[['compact','Compact'],['normal','Normal'],['large','Large']].map(([v,l])=>`<button data-v="${v}" class="${(th.scale||'normal')===v?'on':''}">${t(l)}</button>`).join('')}</div></div>
    <h4>${t('Hero texture')}</h4>
    <div class="field"><div class="seg" data-tseg="texture">${[['glow','Glow'],['grid','Grid'],['dots','Dots'],['none','None']].map(([v,l])=>`<button data-v="${v}" class="${(th.texture||'glow')===v?'on':''}">${t(l)}</button>`).join('')}</div></div>
    <h4>${t('Page meta')}</h4>
    <div class="field"><label>${t('Page language')}</label><select data-meta="lang">${Object.entries(LANGS).map(([k,n])=>`<option value="${k}" ${(state.meta.lang||'en')===k?'selected':''}>${n}</option>`).join('')}</select></div>
    <div class="field"><label>${t('Currency')}</label><select data-meta="currency">${Object.entries(CURRENCIES).map(([k,sym])=>`<option value="${k}" ${(state.meta.currency||'PHP')===k?'selected':''}>${sym} ${k}</option>`).join('')}</select></div>
    <div class="field"><label>${t('SEO description')}</label><textarea data-meta="desc" placeholder="${escAttr(t('One sentence describing this site for search engines'))}">${esc(state.meta.desc||'')}</textarea></div>
  `;
  const d = $('#rtab-design');
  $$('.swatch',d).forEach(sw=>sw.addEventListener('click',()=>{
    snapshot();
    const p = PALETTES[sw.dataset.pal];
    Object.assign(state.theme,{palette:sw.dataset.pal,bg:p.bg,ink:p.ink,accent:p.accent,accent2:p.accent2});
    renderCanvas(); renderDesign(); autosave();
  }));
  $$('[data-tk]',d).forEach(el=>{
    const ev = el.type==='range' ? 'input' : 'change';
    el.addEventListener(ev, ()=>{
      if(!renderDesign._snapped){ snapshot(); renderDesign._snapped=true; setTimeout(()=>renderDesign._snapped=false,800); }
      let v = el.value;
      if (el.dataset.tk==='radius'){ v=+v; $('#radv').textContent=v; }
      else if (el.classList.contains('hex') || el.type==='color'){
        v = v.trim(); if(!v.startsWith('#')) v = '#'+v;
        if(!/^#[0-9a-fA-F]{6}$/.test(v)){ if(el.classList.contains('hex')) toast(t('Colors need a 6-digit hex like #D25A28')); return; }
      }
      state.theme[el.dataset.tk]=v; state.theme.palette='custom';
      // keep hex + picker twins in sync
      $$(`[data-tk="${el.dataset.tk}"]`,d).forEach(x=>{ if(x!==el) x.value=v; });
      renderCanvas(); autosave();
    });
  });
  $('[data-meta="desc"]',d).addEventListener('change',e=>{ state.meta.desc=e.target.value; autosave(); });
  $('[data-density]',d).addEventListener('click',e=>{
    const btn = e.target.closest('button[data-v]'); if(!btn) return;
    snapshot(); state.theme.density = btn.dataset.v;
    renderCanvas(); renderDesign(); autosave();
  });
  $$('[data-tseg]',d).forEach(seg=>seg.addEventListener('click',e=>{
    const btn = e.target.closest('button[data-v]'); if(!btn) return;
    snapshot(); state.theme[seg.dataset.tseg] = btn.dataset.v;
    renderCanvas(); renderDesign(); autosave();
  }));
  $('[data-meta="lang"]',d).addEventListener('change',e=>{
    snapshot();
    state.meta.lang = e.target.value;
    state.meta.currency = LANG_CURRENCY[state.meta.lang] || state.meta.currency || 'PHP';
    swapCurrencySymbols();
    renderCanvas(); renderDesign(); autosave();
  });
  $('[data-meta="currency"]',d).addEventListener('change',e=>{
    snapshot();
    state.meta.currency = e.target.value;
    swapCurrencySymbols();
    renderCanvas(); renderDesign(); renderInspector(); autosave();
  });
}
