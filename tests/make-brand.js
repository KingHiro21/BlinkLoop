// Cuts every brand asset from the Illustrator lockup (an .ai saved with PDF compatibility) with pdf.js in headless Chrome:
//   node tests/make-brand.js "C:/path/BlinkLoop with eye.ai"
// Writes assets/blinkloop-icon.png, the PWA icons and badge, both wordmarks (PNG + 240px WebP), blinkloop-logo-full.png and og.png.
// Needs Chrome/Edge and internet for the pdf.js CDN. Starts its own harness on :3472 for the site fonts used in og.png.
process.env.HARNESS_PORT = process.env.HARNESS_PORT || '3472';
const harness = require('./harness');
const fs = require('fs'); const path = require('path'); const findChrome = require('./chrome');
const ROOT = path.join(__dirname, '..');
(async () => {
  const pmod = await import('puppeteer-core'); const puppeteer = pmod.default || pmod;
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); page.on('console', m => console.log('[page]', m.text()));
  await harness.start(); await page.goto(harness.base + '/login', { waitUntil: 'load' });
  await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js' });
  const src = process.argv[2]; if (!src){ console.error('usage: node tests/make-brand.js <BlinkLoop.ai>'); process.exit(2); }
  const b64 = fs.readFileSync(src).toString('base64');
  const out = await page.evaluate(async (b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise; const pg = await pdf.getPage(1);
    const scale = 8; const vp = pg.getViewport({ scale });
    const src = document.createElement('canvas'); src.width = Math.round(vp.width); src.height = Math.round(vp.height);
    const sctx = src.getContext('2d'); await pg.render({ canvasContext: sctx, viewport: vp }).promise;
    const W = src.width, H = src.height, d = sctx.getImageData(0, 0, W, H).data;
    const ink = i => d[i + 3] > 20 && !(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245);
    /* bbox + row occupancy to split the mark (top) from the wordmark (bottom) */
    let x0 = W, y0 = H, x1 = 0, y1 = 0; const rows = new Uint32Array(H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const i = (y * W + x) * 4; if (ink(i)){ rows[y]++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    let bestGap = null, run = 0; for (let y = y0; y <= y1; y++){ if (rows[y] === 0) run++; else { if (run > 4 && (!bestGap || run > bestGap[1] - bestGap[0])) bestGap = [y - run, y - 1]; run = 0; } }
    const splitY = Math.round((bestGap[0] + bestGap[1]) / 2);
    const bboxIn = (ya, yb) => { let a = W, b = 0, c = H, e = 0; for (let y = ya; y <= yb; y++) for (let x = x0; x <= x1; x++){ const i = (y * W + x) * 4; if (ink(i)){ if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > e) e = y; } } return { x: a, y: c, w: b - a + 1, h: e - c + 1 }; };
    const mark = bboxIn(y0, splitY), word = bboxIn(splitY, y1), full = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    /* the source canvas has a white page behind the art: make white transparent (art has no pure white fills except highlights inside shapes, which sit on colour) */
    const cut = (box, pad = 0.02) => { const px = Math.round(box.w * pad), py = Math.round(box.h * pad); const c = document.createElement('canvas'); c.width = box.w + 2 * px; c.height = box.h + 2 * py; const ctx = c.getContext('2d'); ctx.drawImage(src, box.x - px, box.y - py, c.width, c.height, 0, 0, c.width, c.height); const im = ctx.getImageData(0, 0, c.width, c.height); const p = im.data; for (let i = 0; i < p.length; i += 4){ if (p[i] > 245 && p[i + 1] > 245 && p[i + 2] > 245) p[i + 3] = 0; } ctx.putImageData(im, 0, 0); return c; };
    /* the eye's white highlight and the white swirl strokes must stay: they are enclosed. Keep whites that have any non-white neighbour within the mark by flood-filling transparency from the border instead */
    const cutFlood = (box, pad = 0.02) => { const px = Math.round(box.w * pad), py = Math.round(box.h * pad); const c = document.createElement('canvas'); c.width = box.w + 2 * px; c.height = box.h + 2 * py; const ctx = c.getContext('2d'); ctx.drawImage(src, box.x - px, box.y - py, c.width, c.height, 0, 0, c.width, c.height); const im = ctx.getImageData(0, 0, c.width, c.height); const p = im.data, w = c.width, h = c.height; const isWhite = i => p[i] > 240 && p[i + 1] > 240 && p[i + 2] > 240; const seen = new Uint8Array(w * h); const stack = []; for (let x = 0; x < w; x++){ stack.push(x, (h - 1) * w + x); } for (let y = 0; y < h; y++){ stack.push(y * w, y * w + w - 1); } while (stack.length){ const k = stack.pop(); if (seen[k]) continue; seen[k] = 1; const i = k * 4; if (!isWhite(i)) continue; p[i + 3] = 0; const x = k % w, y = (k - x) / w; if (x > 0) stack.push(k - 1); if (x < w - 1) stack.push(k + 1); if (y > 0) stack.push(k - w); if (y < h - 1) stack.push(k + w); } /* soften: pixels next to transparent that are near-white edge fringe */ ctx.putImageData(im, 0, 0); return c; };
    /* The icon keeps its enclosed whites: the eye highlight and the swirl strokes are real shapes. Letters are the
       opposite, their counters are holes, so a flood fill from the border leaves the B and the o rings filled solid white. */
    const markC = cutFlood(mark, 0.015), wordC = cut(word, 0.02), fullC = cutFlood(full, 0.03);
    const fit = (img, S, frac, bg) => { const c = document.createElement('canvas'); c.width = S; c.height = S; const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; if (bg){ ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S); } const k = Math.min(S * frac / img.width, S * frac / img.height); const w = img.width * k, h = img.height * k; ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h); return c; };
    const widthTo = (img, w) => { const c = document.createElement('canvas'); c.width = w; c.height = Math.round(img.height * w / img.width); const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; /* two-step downscale keeps edges crisp */ let cur = img; while (cur.width > w * 2){ const t = document.createElement('canvas'); t.width = Math.round(cur.width / 2); t.height = Math.round(cur.height / 2); const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(cur, 0, 0, t.width, t.height); cur = t; } ctx.drawImage(cur, 0, 0, c.width, c.height); return c; };
    const recolorDark = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const im = ctx.getImageData(0, 0, c.width, c.height); const p = im.data; for (let i = 0; i < p.length; i += 4){ if (p[i + 3] === 0) continue; const r = p[i], g = p[i + 1], b = p[i + 2]; if (r < 175 && g < 90 && b < 90){ p[i] = 250; p[i + 1] = 244; p[i + 2] = 234; } } ctx.putImageData(im, 0, 0); return c; };
    /* dark theme wants a black pupil: find the small maroon disc (the pupil) as a connected component and darken it, edges included */
    /* dark theme: the maroon square and loop tail vanish against a dark page, so brighten them; the pupil (found as the small maroon disc) keeps its colour */
    const darkVariant = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const im = ctx.getImageData(0, 0, c.width, c.height); const p = im.data, w = c.width, h = c.height; const maroon = i => p[i + 3] > 40 && p[i] < 0x9c && p[i + 1] < 0x48 && p[i + 2] < 0x48 && p[i] > p[i + 1] + 40; const nearPupil = i => p[i + 3] > 200 && Math.abs(p[i] - 0x75) < 22 && Math.abs(p[i + 1] - 0x1a) < 22 && Math.abs(p[i + 2] - 0x19) < 22; const seen = new Uint8Array(w * h); let best = null; for (let k = 0; k < w * h; k++){ if (seen[k] || !nearPupil(k * 4)) continue; const stack = [k]; let n = 0, x0 = w, x1 = 0, y0 = h, y1 = 0; while (stack.length){ const q = stack.pop(); if (seen[q]) continue; seen[q] = 1; if (!nearPupil(q * 4)) continue; n++; const x = q % w, y = (q - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (x > 0) stack.push(q - 1); if (x < w - 1) stack.push(q + 1); if (y > 0) stack.push(q - w); if (y < h - 1) stack.push(q + w); } const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ar = bw / bh, frac = n / (w * h); if (frac > 0.002 && frac < 0.08 && ar > 0.75 && ar < 1.33 && n > 0.5 * bw * bh && (!best || n > best.n)) best = { n, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.max(bw, bh) / 2 }; } const R = best ? best.r * 1.12 + 3 : 0; console.log(best ? 'pupil kept at ' + Math.round(best.cx) + ',' + Math.round(best.cy) : 'pupil not found'); const T = [0xA6, 0x2B, 0x32]; /* brighter brand maroon for the square and tail */ for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const i = (y * w + x) * 4; if (!maroon(i)) continue; if (best){ const dx = x - best.cx, dy = y - best.cy; if (dx * dx + dy * dy <= R * R) continue; } const lum = (p[i] * 0.55 + p[i + 1] * 0.3 + p[i + 2] * 0.15) / (0x68 * 0.55 + 0x08 * 0.3 + 0x10 * 0.15); /* keep the little shading the art has */ const k = Math.max(0.85, Math.min(1.15, lum)); p[i] = Math.min(255, Math.round(T[0] * k)); p[i + 1] = Math.min(255, Math.round(T[1] * k)); p[i + 2] = Math.min(255, Math.round(T[2] * k)); } ctx.putImageData(im, 0, 0); return c; };
    const silhouette = img => { const c = fit(img, 96, 0.9); const ctx = c.getContext('2d'); const im = ctx.getImageData(0, 0, 96, 96); const p = im.data; for (let i = 0; i < p.length; i += 4){ if (p[i + 3] > 0){ p[i] = 255; p[i + 1] = 255; p[i + 2] = 255; } } ctx.putImageData(im, 0, 0); return c; };
    const png = c => c.toDataURL('image/png').split(',')[1], webp = c => c.toDataURL('image/webp', 0.92).split(',')[1];
    const files = {};
    const icon = widthTo(markC, 272); files['assets/blinkloop-icon.png'] = png(icon);
    files['assets/blinkloop-icon-dark.png'] = png(widthTo(darkVariant(markC), 272));
    files['assets/icon-192.png'] = png(fit(markC, 192, 0.92)); files['assets/icon-512.png'] = png(fit(markC, 512, 0.92)); files['assets/icon-180.png'] = png(fit(markC, 180, 0.92));
    files['assets/icon-512-maskable.png'] = png(fit(markC, 512, 0.62, '#FFF7EF')); files['assets/badge-96.png'] = png(silhouette(markC));
    const wordL = widthTo(wordC, 962), wordD = recolorDark(wordL);
    files['assets/blinkloop-wordmark-transparent.png'] = png(wordL); files['assets/blinkloop-wordmark.png'] = png(wordL); files['assets/blinkloop-wordmark-dark.png'] = png(wordD);
    files['assets/blinkloop-wordmark-240.webp'] = webp(widthTo(wordL, 240)); files['assets/blinkloop-wordmark-dark-240.webp'] = webp(widthTo(wordD, 240));
    files['assets/blinkloop-logo-full.png'] = png(widthTo(fullC, 1200));
    /* og.png: 1200x630, new lockup left, headline in the site fonts */
    try { await Promise.all([document.fonts.load('700 64px Unbounded'), document.fonts.load('500 32px Sora'), document.fonts.load('400 26px Sora'), document.fonts.load('600 28px Sora')]); } catch (e) { console.log('font load: ' + e.message); }
    const og = document.createElement('canvas'); og.width = 1200; og.height = 630; const o = og.getContext('2d'); o.imageSmoothingQuality = 'high';
    const g = o.createLinearGradient(0, 0, 1200, 630); g.addColorStop(0, '#FFFCF7'); g.addColorStop(1, '#FFF1E6'); o.fillStyle = g; o.fillRect(0, 0, 1200, 630);
    const rg = o.createRadialGradient(1080, 60, 10, 1080, 60, 520); rg.addColorStop(0, 'rgba(244,93,42,.22)'); rg.addColorStop(1, 'rgba(244,93,42,0)'); o.fillStyle = rg; o.fillRect(0, 0, 1200, 630);
    const rg2 = o.createRadialGradient(80, 620, 10, 80, 620, 420); rg2.addColorStop(0, 'rgba(127,32,39,.14)'); rg2.addColorStop(1, 'rgba(127,32,39,0)'); o.fillStyle = rg2; o.fillRect(0, 0, 1200, 630);
    const ih = 150, iw = markC.width * ih / markC.height; o.drawImage(widthTo(markC, Math.round(iw * 2)), 90, 84, iw, ih);
    const wh = 118, ww = wordC.width * wh / wordC.height; o.drawImage(wordL, 90 + iw + 34, 84 + (ih - wh) / 2 + 8, ww, wh);
    o.fillStyle = '#2B140E'; o.font = '700 64px Unbounded, sans-serif'; o.textBaseline = 'alphabetic'; o.fillText('Websites in a blink.', 90, 392);
    o.fillStyle = '#7E5D4C'; o.font = '500 32px Sora, sans-serif'; o.fillText('Design  ·  Development  ·  Hosting', 90, 456);
    o.font = '400 26px Sora, sans-serif'; o.fillText('For small businesses in Cebu and across the Philippines.', 90, 504);
    o.fillStyle = '#F45D2A'; o.beginPath(); o.roundRect(90, 560, 260, 12, 6); o.fill();
    o.fillStyle = '#BD4218'; o.font = '600 28px Sora, sans-serif'; o.fillText('Pay once. Own your website.', 380, 576);
    files['og.png'] = png(og);
    return { files, dims: { mark: [markC.width, markC.height], word: [wordC.width, wordC.height], icon: [icon.width, icon.height], wordL: [wordL.width, wordL.height], full: full, splitY }, fontsOk: document.fonts.check('700 64px Unbounded') };
  }, b64);
  for (const [name, data] of Object.entries(out.files)){ fs.writeFileSync(path.join(ROOT, name), Buffer.from(data, 'base64')); }
  console.log(JSON.stringify({ dims: out.dims, fontsOk: out.fontsOk, files: Object.keys(out.files).map(f => f + ' ' + fs.statSync(path.join(ROOT, f)).size) }, null, 1));
  await browser.close(); await harness.stop(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
