# Cómo publicar la versión optimizada

## Antes de subir
1. Revisa `aviso-legal/index.html` y completa los datos fiscales obligatorios.
2. Comprueba que todos los precios y condiciones del pack siguen siendo válidos.
3. Cambia o añade fotografías reales si quieres mostrar más trabajos.
4. Confirma que puedes atender consultas en inglés antes de enlazar la página inglesa.

## Despliegue en Netlify
- Arrastra la carpeta completa o el ZIP descomprimido a Netlify.
- No subas solo `index.html`: las carpetas locales, assets, sitemap y archivos técnicos también son necesarios.
- Después de publicar, prueba:
  - WhatsApp
  - llamada
  - formulario
  - menú móvil
  - páginas locales
  - sitemap.xml
  - robots.txt

## Medición
El JavaScript envía eventos a `dataLayer`:
- `lead_click`
- `lead_method`: whatsapp, phone o form
- `lead_source`: sección o página

Para registrar conversiones reales hay que conectar Google Tag Manager o GA4 con tus identificadores. No se han inventado IDs de seguimiento.

## Atribución
Cada página utiliza un texto de WhatsApp diferente. Así podrás saber si el contacto llegó desde:
- portada
- Alcanar
- Vinaròs
- La Ràpita
- Amposta
- mantenimiento
- página inglesa


## PWA incluida
La web incorpora:
- `manifest.webmanifest`
- `service-worker.js`
- página offline
- iconos 192x192 y 512x512
- iconos maskable
- apple-touch-icon
- theme color y splash screen configurables por el navegador

Después de publicar:
1. Abre la web una vez en Chrome.
2. Recarga.
3. Ejecuta Lighthouse de nuevo.
4. Si muestra datos antiguos, elimina el service worker anterior desde DevTools > Application > Service Workers y limpia el almacenamiento del sitio.
