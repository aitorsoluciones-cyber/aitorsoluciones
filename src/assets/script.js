
const menuBtn = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
if (menuBtn && navLinks) {
  const openLabel = menuBtn.getAttribute('aria-label') || 'Abrir menú';
  const closeLabel = openLabel.replace(/^Abrir/, 'Cerrar').replace(/^Open/, 'Close');
  const closeNav = () => {
    navLinks.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', openLabel);
  };
  menuBtn.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(isOpen));
    menuBtn.setAttribute('aria-label', isOpen ? closeLabel : openLabel);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navLinks.classList.contains('open')) closeNav();
  });
  document.addEventListener('click', (e) => {
    if (navLinks.classList.contains('open') && !navLinks.contains(e.target) && !menuBtn.contains(e.target)) {
      closeNav();
    }
  });
}
document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',()=>{
    navLinks?.classList.remove('open');
    menuBtn?.setAttribute('aria-expanded', 'false');
    if (menuBtn) menuBtn.setAttribute('aria-label', menuBtn.getAttribute('aria-label').replace(/^Cerrar/, 'Abrir').replace(/^Close/, 'Open'));
  });
});

/* ============================================================
   MEDICIÓN DE CONVERSIÓN + CONSENTIMIENTO (Google Consent Mode v2)
   GA4 (o GTM) solo se carga si el visitante acepta el aviso de
   cookies. Sin esa aceptación no se añade ningún script externo,
   no se guarda ninguna cookie ni dato de analítica (ni UTM entre
   páginas) y no se registra ni encola ningún evento analítico.
   ============================================================ */
const MEASUREMENT_ID = "G-WSJYEMQTR7";
const CONSENT_KEY = "cookie-consent";
const PENDING_LEAD_KEY = "pending-lead";
// Única fuente de verdad de la caducidad de _ga/_ga_*: 395 días (~13 meses),
// el plazo que declara /politica-privacidad/#cookies. GA4 usa 2 años por defecto.
const GA_COOKIE_EXPIRES_SECONDS = 395 * 24 * 60 * 60;

window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
gtag("consent", "default", {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied"
});

let analyticsLoaded = false;
function loadAnalyticsTag() {
  if (analyticsLoaded || !MEASUREMENT_ID) return;
  analyticsLoaded = true;
  gtag("consent", "update", { analytics_storage: "granted" });
  if (MEASUREMENT_ID.indexOf("G-") === 0) {
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
    document.head.appendChild(tag);
    gtag("js", new Date());
    gtag("config", MEASUREMENT_ID, { cookie_expires: GA_COOKIE_EXPIRES_SECONDS });
  } else if (MEASUREMENT_ID.indexOf("GTM-") === 0) {
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = "https://www.googletagmanager.com/gtm.js?id=" + MEASUREMENT_ID;
    document.head.appendChild(tag);
  }
}

// Elimina _ga, _ga_* (y restos _gid/_gat) en el host y en sus dominios padre.
function clearAnalyticsCookies() {
  const names = document.cookie.split(";").map(c => c.split("=")[0].trim()).filter(n => /^(_ga|_gid|_gat)/.test(n));
  const parts = location.hostname.split(".");
  const domains = [""];
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join(".");
    domains.push(d, "." + d);
  }
  names.forEach(n => domains.forEach(d => {
    document.cookie = n + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/" + (d ? ";domain=" + d : "");
  }));
}

// Revocación: bloquea ya nuevos eventos, deniega consentimiento y borra cookies y UTM.
function revokeAnalytics() {
  analyticsLoaded = false;
  window["ga-disable-" + MEASUREMENT_ID] = true;
  gtag("consent", "update", { analytics_storage: "denied" });
  clearAnalyticsCookies();
  try { sessionStorage.removeItem("utm"); sessionStorage.removeItem(PENDING_LEAD_KEY); } catch (e) {}
}

let storedConsent = null;
try { storedConsent = localStorage.getItem(CONSENT_KEY); } catch (e) { storedConsent = null; }
if (storedConsent === "granted") loadAnalyticsTag();

// UTM: se leen de la URL actual; solo se conservan entre páginas con consentimiento analítico
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
let storedUtm = {};
function persistUtm() {
  try { if (Object.keys(storedUtm).length) sessionStorage.setItem("utm", JSON.stringify(storedUtm)); } catch (e) {}
}
try {
  const params = new URLSearchParams(location.search);
  if (UTM_KEYS.some(k => params.has(k))) {
    UTM_KEYS.forEach(k => { if (params.has(k)) storedUtm[k] = params.get(k); });
  } else if (storedConsent === "granted") {
    storedUtm = JSON.parse(sessionStorage.getItem("utm") || "{}");
  }
  if (storedConsent === "granted") persistUtm();
  else sessionStorage.removeItem("utm");
} catch (e) { storedUtm = {}; }

// Eventos de analítica: solo con consentimiento (analyticsLoaded). Sin él no se registra ni encola nada.
function leadEvent(eventName, source, extra) {
  if (!analyticsLoaded) return;
  const params = Object.assign({ lead_source: source || "", page_path: location.pathname }, extra, storedUtm);
  // Un solo canal por tipo de ID: gtag() con G-, objeto {event} con GTM- (evita duplicados).
  if (MEASUREMENT_ID.indexOf("GTM-") === 0) window.dataLayer.push(Object.assign({ event: eventName }, params));
  else gtag("event", eventName, params);
}

// Clics en WhatsApp y teléfono (elementos con data-lead)
const EVENT_BY_METHOD = { whatsapp: "whatsapp_click", phone: "phone_click" };
document.querySelectorAll("[data-lead]").forEach(el => {
  el.addEventListener("click", () => {
    const name = EVENT_BY_METHOD[el.dataset.lead];
    if (name) leadEvent(name, el.dataset.source || location.pathname);
  });
});

// Formulario: atribución en campos ocultos. La conversión (generate_lead) no se cuenta al
// enviar, sino al llegar a /gracias/ (Netlify ya aceptó el envío): al enviar, y solo con
// consentimiento, se deja un flag de sesión que /gracias/ consume una única vez.
const utmText = UTM_KEYS.map(k => storedUtm[k]).filter(Boolean).join(" / ");
document.querySelectorAll('input[name="utm"]').forEach(i => i.value = utmText);
document.querySelectorAll('input[name="pagina"]').forEach(i => i.value = location.pathname);
document.querySelectorAll("form[name]").forEach(f => {
  f.addEventListener("submit", () => {
    if (!analyticsLoaded) return;
    try { sessionStorage.setItem(PENDING_LEAD_KEY, JSON.stringify({ form: f.getAttribute("name"), page: location.pathname })); } catch (e) {}
  });
});
if (location.pathname.replace(/\/+$/, "") === "/gracias") {
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_LEAD_KEY) || "null");
    sessionStorage.removeItem(PENDING_LEAD_KEY);
  } catch (e) { pending = null; }
  if (pending && pending.form) leadEvent("generate_lead", pending.form, { origin_page: pending.page });
}

// CTA sticky "Enviar fotos" en movil: aparece tras el primer scroll, discreto,
// no ocupa el primer viewport (sustituye a la barra inferior fija doble).
const mobileCta = document.querySelector('.mobile-cta');
if (mobileCta) {
  let ticking = false;
  let shown = false;
  const THRESHOLD = Math.min(420, Math.round(window.innerHeight * 0.6));
  const setShown = (visible) => {
    if (visible === shown) return;
    shown = visible;
    mobileCta.classList.toggle('is-visible', visible);
    if (visible) {
      mobileCta.removeAttribute('aria-hidden');
      mobileCta.removeAttribute('tabindex');
    } else {
      mobileCta.setAttribute('aria-hidden', 'true');
      mobileCta.setAttribute('tabindex', '-1');
    }
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      setShown(window.scrollY > THRESHOLD);
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Aviso de cookies: GA4 solo se activa tras un clic explícito en "Aceptar".
const cookieBanner = document.getElementById('cookie-banner');
if (cookieBanner) {
  const showBanner = () => {
    cookieBanner.hidden = false;
    document.body.classList.add('has-cookie-banner');
  };
  const hideBanner = () => {
    cookieBanner.hidden = true;
    document.body.classList.remove('has-cookie-banner');
  };
  if (!storedConsent) showBanner();
  cookieBanner.querySelectorAll('[data-cookie-accept]').forEach(btn => btn.addEventListener('click', () => {
    try { localStorage.setItem(CONSENT_KEY, 'granted'); } catch (e) {}
    loadAnalyticsTag();
    persistUtm();
    hideBanner();
  }));
  cookieBanner.querySelectorAll('[data-cookie-reject]').forEach(btn => btn.addEventListener('click', () => {
    const wasActive = analyticsLoaded;
    try { localStorage.setItem(CONSENT_KEY, 'denied'); } catch (e) {}
    hideBanner();
    if (wasActive) {
      revokeAnalytics();
      location.reload();
    }
  }));
  document.querySelectorAll('[data-cookie-settings]').forEach(btn => btn.addEventListener('click', showBanner));
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" })
      .catch(error => console.error("No se pudo registrar el service worker:", error));
  });
}

/* Comparador antes/despues: mejora progresiva accesible (teclado y tactil).
   Sin JS se siguen viendo las dos fotografias una junto a otra. */
document.querySelectorAll('[data-compare]').forEach((box, i) => {
  const grid = box.querySelector('.before-after-grid');
  if (!grid || grid.querySelectorAll('figure').length !== 2) return;
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.step = '1';
  range.value = '50';
  range.className = 'ba-range';
  range.id = 'ba-range-' + i;
  range.setAttribute('aria-label', 'Comparar antes y después: mueve el control para ver más de cada foto');
  const handle = document.createElement('span');
  handle.className = 'ba-handle';
  handle.setAttribute('aria-hidden', 'true');
  const update = () => {
    box.style.setProperty('--pos', range.value + '%');
    range.setAttribute('aria-valuetext', 'Antes ' + range.value + ' %, después ' + (100 - range.value) + ' %');
  };
  range.addEventListener('input', update);
  grid.appendChild(range);
  grid.appendChild(handle);
  box.classList.add('is-compare');
  update();
  const hint = document.createElement('p');
  hint.className = 'ba-hint';
  hint.textContent = 'Desliza para comparar el antes y el después.';
  box.insertAdjacentElement('afterend', hint);
});
