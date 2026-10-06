# Aitor Soluciones — nueva arquitectura (preview)

Rama: `redesign/spec-arquitectura` (creada desde `mejora-seo-conversion`).

Reconstrucción completa de la web siguiendo `AITOR-WEB-SPEC.md`: arquitectura
por componentes y datos (Eleventy + Nunjucks), sin páginas locales
duplicadas, jardinería como eje principal, mantenimiento de propiedades como
segundo pilar, y las 17 páginas de lanzamiento de la sección 4.1 del spec.

## Cómo previsualizar

```bash
npm install
npm run images   # solo hace falta si tocas fotos en tools/convert-images.mjs
npm run serve    # http://localhost:8080 con recarga en caliente
```

`npm run build` genera el sitio estático en `_site/` (lo que Netlify
publicará cuando se apruebe el despliegue).

## Qué se ha construido

- **Arquitectura de datos** en `src/_data/`: `business.js` (NAP, WhatsApp),
  `services.json` (jerarquía jardinería → mantenimiento de propiedades,
  con estado `active`/`draft`), `locations.json` (las 35 localidades del
  spec, con `hasLandingPage`/`isPriority`), `workCases.json` (7 trabajos
  reales, 3 con página propia), `faqs.json`.
- **Componentes reutilizables** en `src/_includes/components/` (hero,
  tarjetas, antes/después, FAQ, formulario, CTA, migas de pan, JSON-LD…).
  Los 6 servicios y las 5 páginas locales se generan por paginación a
  partir de los datos — añadir un servicio o localidad nuevo es editar el
  JSON correspondiente, no copiar una página.
- **17 páginas de lanzamiento**: home, `/jardineria/` + 3 subservicios,
  `/mantenimiento-propiedades/` + segundas residencias, `/trabajos/` + 3
  fichas de caso, `/sobre-aitor-soluciones/`, `/contacto/`, `/zonas/`, las
  4 locales existentes (URLs sin cambios) + `/jardineria-la-senia/` (nueva,
  sin afirmar sede física), `/en/property-maintenance/`, legales,
  `/gracias/` (noindex) y 404 (noindex).
- **SEO técnico**: title/description/canonical únicos, Open Graph,
  hreflang ES/EN, breadcrumbs + JSON-LD (`Organization`, `LocalBusiness`,
  `WebSite`, `Service`, `BreadcrumbList`, `FAQPage` solo donde hay FAQ
  real), `sitemap.xml` y `robots.txt` autogenerados (excluyen `/gracias/`,
  404 y páginas fase 2).
- **Imágenes reales**: `tools/convert-images.mjs` decodifica los HEIC
  reales del negocio (vía `heic-convert`, sin depender de códecs del SO) y
  genera WebP optimizado. Se añadieron 3 casos reales nuevos (jardín con
  olivos, parcela agrícola, solar urbano) tras revisar visualmente las
  fotos; se descartaron `galeria-1/2/3.jpg`, `s.jpg`, `2.jpg` y
  `trabajo-parcela.jpg` por ser imágenes generadas por IA, no trabajos
  reales.
- **WhatsApp/formulario/analítica**: se reutiliza `assets/script.js`
  (UTM, `whatsapp_click`, `phone_click`, `generate_lead`, service worker),
  formulario con Netlify Forms igual que la versión actual.

## Comprobado

- `npx @11ty/eleventy` compila sin errores (28 páginas).
- `node tools/check-links.mjs` → 0 enlaces/recursos internos rotos.
- `node tools/check-jsonld.mjs` → 85 bloques JSON-LD, todos válidos.
- Recorrido manual en navegador: home, servicio con incluye/excluye,
  La Sénia (sin sede física), `/zonas/` (35 localidades, solo 5
  enlazadas), vista móvil (menú, barra WhatsApp/llamar).

## Pendiente antes de producción

1. **`/mantenimiento-fincas-alcanar/`**: el spec fija `/mantenimiento-jardines/`
   como destino final, pero condiciona el 301 a revisar Search Console. La
   regla está preparada y comentada en `src/_redirects`; actívala cuando
   confirmes que no hay tráfico/backlinks relevantes que perder.
2. **Reseñas**: no se ha inventado ninguna cita. Cuando tengas 1-2 reseñas
   reales de Google con permiso del cliente, añádelas al componente
   `trust.njk` (`reviewsTrust`).
3. Revisar el aviso legal (`/aviso-legal/`) con los datos fiscales reales.
4. Los HTML antiguos en la raíz del repo (`index.html`,
   `limpieza-parcelas-*`, etc.) siguen ahí como referencia; se pueden
   borrar una vez se apruebe y despliegue esta versión.
5. Fase 2 (limpieza de viviendas, pintura, montajes, reparaciones, pladur)
   y fase 7 (Ulldecona, Tortosa, Benicarló) quedan fuera a propósito, tal
   como pide el spec.

No se ha hecho `git push` ni desplegado a Netlify.

---

## Cierre final (2026-09-23)

### Datos legales (bloqueo de publicación legal)
El Aviso legal y la Política de privacidad se generan a partir de `src/_data/legal.js`.
Faltan tres datos que solo puede facilitar Aitor y que **no se han inventado**:

| Variable de entorno (Netlify) | Dato |
|---|---|
| `LEGAL_HOLDER_NAME` | Nombre y apellidos legales completos del titular |
| `LEGAL_TAX_ID` | NIF |
| `LEGAL_POSTAL_ADDRESS` | Dirección postal o profesional válida |

- Mientras falten, los **Deploy Previews** muestran los campos marcados como pendientes.
- Una build de **producción** (`CONTEXT=production`) falla a propósito con "BLOQUEO DE PUBLICACION LEGAL", de modo que no puede publicarse un aviso incompleto.
- Configúralos en Netlify (Site configuration → Environment variables) para no guardarlos en el repositorio, que es público. `npm run check:legal` indica el estado.

### Comprobaciones
`npm run build` · `npm run check` (enlaces e imágenes, JSON-LD, SEO: un H1, title/description únicos, canónicas, hreflang recíproco, sitemap de 25 URLs, robots).

### Analítica
`MEASUREMENT_ID` sigue vacío en `src/assets/script.js`: no se carga ninguna etiqueta hasta que Aitor facilite un ID real de GA4/GTM. Al activarla habrá que añadir banner de consentimiento y actualizar la política de privacidad.

### Datos legales: comportamiento verificado (2026-09-23)
- El NIF se normaliza (mayúsculas, sin espacios ni guiones) y se valida como DNI/NIE con su letra de control. Si es otro tipo de documento válido, `LEGAL_SKIP_NIF_VALIDATION=1` omite la validación.
- Las variables se leen al construir: tras guardarlas en Netlify hay que lanzar un nuevo deploy (Deploys → Trigger deploy → Clear cache and deploy site) para que aparezcan.
- Producción (`CONTEXT=production`) falla si falta un dato o el NIF es inválido; previews y local no fallan.
- `netlify.toml` excluye estas tres variables del escáner de secretos de Netlify (`SECRETS_SCAN_OMIT_KEYS`), porque el Aviso legal las publica a propósito.


### Servicios de vivienda (2026-09-23)
Limpieza de viviendas (/limpieza-viviendas/), pintura (/pintura/) y pequeñas reparaciones (/reparaciones-hogar/) están activas en src/_data/services.json con contenido mínimo y sin precios, fotos ni reseñas inventados (lean: true). Los servicios que siguen como draft (apartamentos turísticos, montajes, pladur) no se publican.

### Herramienta de QA: servidor equivalente a producción (2026-10-01)

`npm run serve:prod-equiv` levanta `tools/prod-equiv-server.mjs`, que sirve
`_site` en `http://localhost:5055` aplicando las cabeceras reales de
`src/_headers` (CSP, seguridad, caché) tal cual las vería un visitante en
`aitorsoluciones.com`. A diferencia de `npm run serve` (servidor de
desarrollo de Eleventy, con su propio script de recarga en vivo) y de un
Deploy Preview de Netlify (que añade su script de colaboración y
`X-Robots-Tag: noindex`, ambos exclusivos de preview), este servidor no
añade ni quita nada: es el build real con las cabeceras reales, sin
artefactos de entorno. Úsalo para auditorías de Lighthouse/Best
Practices/SEO que no se quieran contaminar con herramientas propias del
flujo de desarrollo o de Netlify Preview. Requiere haber ejecutado antes
`npm run build`.

### Analítica (GA4) y consentimiento (2026-10-05)

`src/assets/script.js` es la única fuente de verdad: `MEASUREMENT_ID` (GA4 `G-WSJYEMQTR7`) y `GA_COOKIE_EXPIRES_SECONDS` (395 días ≈ 13 meses, enviado como `cookie_expires` en `gtag("config")`; GA4 usa 2 años por defecto). Ese plazo es el que declara `/politica-privacidad/#cookies`: si se cambia uno, hay que cambiar el otro. La retención de datos en el panel de GA4 es un ajuste distinto, de la propiedad.

- Sin consentimiento: no se carga ningún script de Google, no hay cookies `_ga*`, no se registra ni encola ningún evento (`leadEvent` sale sin hacer nada) y los UTM solo se leen de la URL actual (no se guardan en `sessionStorage`).
- "Aceptar": se carga `gtag.js` una vez, se persisten los UTM durante la sesión.
- "Rechazar" tras haber aceptado (desde "Configurar cookies"): `consent update denied`, bloqueo `ga-disable-<ID>`, borrado de `_ga`/`_ga_*`/`_gid`/`_gat*` (host y dominios padre) y de los UTM, y recarga.

#### Eventos GA4 (arquitectura final)

| Evento | Cuándo | Parámetros |
|---|---|---|
| `page_view` | Automático al cargar GA4 (con consentimiento), uno por página | — |
| `whatsapp_click` | Clic en un enlace `data-lead="whatsapp"` | `lead_source` (ubicación del botón), `page_path`, UTM |
| `phone_click` | Clic en un enlace `data-lead="phone"` | ídem |
| `generate_lead` | Una vez por envío de formulario **completado**: al enviar (con consentimiento) se guarda un flag de sesión (`pending-lead`) y solo al llegar a `/gracias/` (Netlify ya aceptó el POST) se dispara y se borra el flag; las visitas directas o recargas de `/gracias/` no lo disparan | `lead_source` (nombre del formulario), `origin_page`, `page_path`, UTM |

`form_submit` ya no lo envía el código; si la Medición mejorada de la propiedad lo genera, es el evento automático de GA4. Evento clave del negocio: `generate_lead`. Los parámetros personalizados (`lead_source`, `origin_page`) solo aparecen en informes si se registran como dimensiones personalizadas de evento.
