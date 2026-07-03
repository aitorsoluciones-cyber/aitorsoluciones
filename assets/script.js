
const menuBtn = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
if (menuBtn && navLinks) {
  menuBtn.addEventListener('click', () => navLinks.classList.toggle('open'));
}
document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',()=>navLinks?.classList.remove('open'));
});
function trackLead(source, method) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({event:'lead_click', lead_source:source, lead_method:method});
  if (typeof gtag === 'function') {
    gtag('event','generate_lead',{method,source});
  }
}
document.querySelectorAll('[data-lead]').forEach(el=>{
  el.addEventListener('click',()=>trackLead(el.dataset.source || location.pathname, el.dataset.lead));
});
const params = new URLSearchParams(location.search);
const utm = ['utm_source','utm_medium','utm_campaign','utm_content'].map(k=>params.get(k)).filter(Boolean).join(' / ');
document.querySelectorAll('input[name="utm"]').forEach(i=>i.value=utm);


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" })
      .catch(error => console.error("No se pudo registrar el service worker:", error));
  });
}
