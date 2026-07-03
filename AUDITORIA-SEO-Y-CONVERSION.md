# Auditoría SEO local y conversión — Aitor Soluciones

## Diagnóstico de la web actual

### Lo que ya funciona
- Marca visible, teléfono y zona de servicio.
- Enlaces repetidos a WhatsApp.
- Explicación del proceso de trabajo.
- Antes y después y enlace a reseñas.
- Páginas locales enlazadas desde la portada.
- Aviso legal, privacidad y sitemap.

### Problemas prioritarios
1. **La portada intenta vender demasiadas cosas a la vez.**
   El mensaje principal mezcla parcelas, viviendas, locales, inmobiliarias, reformas, pintura, calculadora y Academy. Como la mayor parte del negocio real es limpieza y mantenimiento de fincas, la intención principal queda diluida.

2. **El H1 actual no coincide del todo con la búsqueda principal.**
   “Preparo tu finca, casa o local…” es comercial, pero menos directo para búsquedas como “limpieza de parcelas Alcanar” o “desbroce Vinaròs”.

3. **Demasiados caminos antes del contacto.**
   Calculadora, Academy, inmobiliarias, proyectos y diferentes CTA compiten entre sí. La nueva versión utiliza una acción principal: enviar fotos y ubicación por WhatsApp.

4. **La frase sobre imágenes profesionales de apoyo reduce confianza.**
   Para servicios locales, los trabajos reales son una ventaja competitiva. La nueva versión destaca que los antes y después son reales.

5. **El formulario actual depende de FormSubmit.**
   La propia política indica que la primera vez puede requerir confirmación por correo. Eso introduce riesgo operativo. La propuesta usa Netlify Forms y mantiene WhatsApp como vía principal.

6. **La oferta principal no filtra suficiente.**
   La nueva versión pide localidad, metros, fotos, acceso y gestión de restos; así reduce curiosos y facilita presupuestar.

7. **Indexación local por comprobar.**
   En búsquedas `site:` realizadas durante la auditoría aparecieron claramente la portada y privacidad, pero no las páginas locales. Hay que revisar cada URL en Search Console, enviar el sitemap y solicitar indexación.

8. **Academy distrae del objetivo comercial.**
   Se conserva como enlace secundario en el pie, pero deja de ocupar una sección principal en la web de servicios.

## Cambios incluidos
- Portada enfocada en limpieza, desbroce y mantenimiento.
- Un CTA principal y mensajes de WhatsApp con origen identificable.
- Pack desde 150 € con condiciones claras y extras separados.
- Galería de trabajos reales.
- Secciones de problema, solución, proceso y FAQ.
- Páginas locales únicas para Alcanar, Vinaròs, La Ràpita y Amposta.
- Página de mantenimiento periódico.
- Landing en inglés para propietarios extranjeros.
- LocalBusiness y Service schema JSON-LD.
- Títulos y descripciones únicos.
- Canonical, Open Graph, robots.txt y sitemap.xml.
- Imágenes WebP, carga diferida y dimensiones definidas.
- Diseño responsive y barra móvil de llamada/WhatsApp.
- Formulario Netlify con honeypot.
- Eventos preparados para GA4/Google Ads mediante `dataLayer`.

## Acciones posteriores al publicar
1. Añadir el sitio a Google Search Console.
2. Enviar `https://aitorsoluciones.com/sitemap.xml`.
3. Inspeccionar y solicitar indexación de cada página local.
4. Validar schema con Rich Results Test.
5. Configurar GA4 y conversiones: clic en WhatsApp, llamada y formulario.
6. Añadir enlaces con UTM desde Google Business y campañas.
7. Mostrar 3 reseñas reales con permiso o mantener el enlace a Google.
8. Sustituir cualquier imagen de apoyo por trabajo real.
9. Completar el aviso legal con los datos fiscales correctos.
10. Revisar PageSpeed y Core Web Vitals después del despliegue.
