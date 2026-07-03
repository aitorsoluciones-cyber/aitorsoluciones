AITOR SOLUCIONES - WEB ESTATICA (NETLIFY)

Contenido del deploy:
- index.html          Pagina principal (SEO local, calculadora, formulario Netlify)
- gracias.html        Pagina de confirmacion tras enviar el formulario
- robots.txt          Permite indexacion y apunta al sitemap
- sitemap.xml         Mapa del sitio para Google
- assets/             Imagenes optimizadas en WebP (~1 MB en total)
  - favicon.png       Favicon ligero (64x64)
  - og-image.jpg      Imagen de previsualizacion al compartir por WhatsApp/redes

Notas:
- Todo el sitio es estatico: se sube tal cual a Netlify, sin build.
- Las imagenes originales (JPG/PNG grandes) estan guardadas fuera del deploy,
  en la carpeta del Escritorio "aitor-soluciones-ORIGINALES". No subirlas.
- Las fotos de galeria siguen siendo provisionales: sustituirlas por fotos
  reales de trabajos (antes/despues) mejorara credibilidad y conversion.
- Las URLs de SEO (canonical, og:url, sitemap) usan https://www.aitorsoluciones.com
  Si el dominio final es otro, actualizarlas en index.html, robots.txt y sitemap.xml.
