
const menuBtn = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
if (menuBtn && navLinks) {
  menuBtn.addEventListener('click', () => navLinks.classList.toggle('open'));
}
document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',()=>navLinks?.classList.remove('open'));
});

/* ============================================================
   MEDICIÓN DE CONVERSIÓN
   Pega aquí tu ID cuando lo tengas (GA4 "G-XXXXXXXXXX" o
   GTM "GTM-XXXXXXX"). Con el campo vacío no se carga nada
   externo: los eventos quedan disponibles en window.dataLayer.
   ============================================================ */
const MEASUREMENT_ID = "";

window.dataLayer = window.dataLayer || [];
if (MEASUREMENT_ID.indexOf("G-") === 0) {
  const tag = document.createElement("script");
  tag.async = true;
  tag.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
  document.head.appendChild(tag);
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID);
} else if (MEASUREMENT_ID.indexOf("GTM-") === 0) {
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const tag = document.createElement("script");
  tag.async = true;
  tag.src = "https://www.googletagmanager.com/gtm.js?id=" + MEASUREMENT_ID;
  document.head.appendChild(tag);
}

// UTM: se capturan al aterrizar y sobreviven a la navegación interna
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
let storedUtm = {};
try {
  const params = new URLSearchParams(location.search);
  if (UTM_KEYS.some(k => params.has(k))) {
    UTM_KEYS.forEach(k => { if (params.has(k)) storedUtm[k] = params.get(k); });
    sessionStorage.setItem("utm", JSON.stringify(storedUtm));
  } else {
    storedUtm = JSON.parse(sessionStorage.getItem("utm") || "{}");
  }
} catch (e) { storedUtm = {}; }

function leadEvent(eventName, source) {
  const data = Object.assign({
    event: eventName,
    lead_source: source || "",
    page_path: location.pathname
  }, storedUtm);
  window.dataLayer.push(data);
  if (typeof gtag === "function") {
    gtag("event", eventName, Object.assign({ source: source || "", page_path: location.pathname }, storedUtm));
  }
}

// Clics en WhatsApp y teléfono (elementos con data-lead)
const EVENT_BY_METHOD = { whatsapp: "whatsapp_click", phone: "call_click" };
document.querySelectorAll("[data-lead]").forEach(el => {
  el.addEventListener("click", () => {
    const name = EVENT_BY_METHOD[el.dataset.lead];
    if (name) leadEvent(name, el.dataset.source || location.pathname);
  });
});

// Formulario: atribución en campos ocultos + evento form_submit al enviar
const utmText = UTM_KEYS.map(k => storedUtm[k]).filter(Boolean).join(" / ");
document.querySelectorAll('input[name="utm"]').forEach(i => i.value = utmText);
document.querySelectorAll('input[name="pagina"]').forEach(i => i.value = location.pathname);
document.querySelectorAll("form[name]").forEach(f => {
  f.addEventListener("submit", () => leadEvent("form_submit", f.getAttribute("name")));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" })
      .catch(error => console.error("No se pudo registrar el service worker:", error));
  });
}
