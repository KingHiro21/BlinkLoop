/* BlinkLoop cookie consent + analytics loader.
   Asks only when there is something to consent to: set window.BL_ANALYTICS.ga4 to a GA4 Measurement ID.
   window.BL_ANALYTICS.plausible = "www.blinkloop-ph.com" loads Plausible (cookieless, no personal data, no banner needed).
   and the banner appears once per visitor (choice kept 12 months in localStorage "bl-consent").
   With no ID configured nothing is stored, nothing is loaded, no banner is shown.
   Global Privacy Control is honoured as "Essential only". Public API: BLConsent.open(), .status(), .reset() */
(function(){
  'use strict';
  var KEY = 'bl-consent', TTL = 365 * 86400000;
  var cfg = window.BL_ANALYTICS || {};
  var ga = String(cfg.ga4 || '').trim();
  var pl = String(cfg.plausible || '').trim(); // Plausible is cookieless and needs no consent: it loads right away when a domain is set
  if (pl){ var ps = document.createElement('script'); ps.defer = true; ps.setAttribute('data-domain', pl); ps.src = 'https://plausible.io/js/script.js'; document.head.appendChild(ps); }
  var gpc = navigator.globalPrivacyControl === true;
  var loaded = false, el = null;

  function read(){ try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); return (c && c.ts && Date.now() - c.ts < TTL) ? c : null; } catch (e) { return null; } }
  function write(analytics){ try { localStorage.setItem(KEY, JSON.stringify({ analytics: !!analytics, ts: Date.now(), v: 1 })); } catch (e) {} }

  function loadAnalytics(){
    if (loaded || !ga) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ga, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script'); s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ga);
    document.head.appendChild(s);
  }

  function style(){
    if (document.getElementById('blConsentCss')) return;
    var st = document.createElement('style'); st.id = 'blConsentCss';
    st.textContent =
      '.bl-consent{position:fixed;left:20px;bottom:20px;z-index:90;max-width:460px;padding:18px 20px;border-radius:18px;' +
      'background:var(--glass-strong,rgba(255,247,239,.96));border:1px solid var(--line,rgba(127,32,39,.16));color:var(--ink,#2B140E);' +
      'font-family:Sora,system-ui,sans-serif;font-size:.9rem;line-height:1.55;box-shadow:0 18px 50px rgba(43,20,14,.18);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}' +
      '.bl-consent h2{font-family:Unbounded,Sora,sans-serif;font-size:.98rem;font-weight:600;margin:0 0 6px}' +
      '.bl-consent p{margin:0 0 14px;color:var(--muted,#7E5D4C)}' +
      '.bl-consent a{color:var(--rust-ink,#BD4218);text-decoration:underline;text-underline-offset:2px}' +
      '.bl-consent .row{display:flex;gap:10px;flex-wrap:wrap}' +
      '.bl-consent button{font:inherit;font-weight:600;font-size:.88rem;padding:10px 18px;border-radius:999px;cursor:pointer;border:1px solid var(--line,rgba(127,32,39,.16));background:transparent;color:var(--ink,#2B140E)}' +
      '.bl-consent button.yes{background:var(--rust,#F45D2A);border-color:var(--rust,#F45D2A);color:#2B140E}' +
      '.bl-consent button:focus-visible{outline:3px solid var(--rust,#F45D2A);outline-offset:3px}' +
      '@media (max-width:640px){.bl-consent{left:12px;right:12px;bottom:12px;max-width:none;padding:16px}.bl-consent .row button{flex:1}}';
    document.head.appendChild(st);
  }

  function show(){
    if (!ga || el) return;
    style();
    el = document.createElement('section');
    el.className = 'bl-consent'; el.setAttribute('role', 'region'); el.setAttribute('aria-labelledby', 'blConsentTitle');
    el.innerHTML =
      '<h2 id="blConsentTitle">Analytics on this site</h2>' +
      '<p>We use one optional tool, Google Analytics, to see which pages help visitors. Essential storage (your theme choice) is always on. Nothing else is tracked. <a href="/cookies">Cookie Policy</a></p>' +
      '<div class="row"><button type="button" class="yes" data-c="1">Accept analytics</button><button type="button" data-c="0">Essential only</button></div>';
    el.addEventListener('click', function(e){
      var b = e.target.closest('button[data-c]'); if (!b) return;
      decide(b.getAttribute('data-c') === '1');
    });
    document.body.appendChild(el);
    var first = el.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  function hide(){ if (el){ el.remove(); el = null; } }
  function decide(analytics){
    write(analytics); hide();
    if (analytics) loadAnalytics();
    try { document.dispatchEvent(new CustomEvent('bl-consent', { detail: { analytics: analytics } })); } catch (e) {}
  }

  function init(){
    var links = document.querySelectorAll('[data-consent-settings]');
    for (var i = 0; i < links.length; i++){
      links[i].hidden = !ga;
      links[i].addEventListener('click', function(e){ e.preventDefault(); hide(); show(); });
    }
    if (!ga) return;
    var c = read();
    if (c){ if (c.analytics && !gpc) loadAnalytics(); return; }
    if (gpc){ write(false); return; }
    show();
  }

  window.BLConsent = { open: function(){ hide(); show(); }, status: read, reset: function(){ try { localStorage.removeItem(KEY); } catch (e) {} } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
