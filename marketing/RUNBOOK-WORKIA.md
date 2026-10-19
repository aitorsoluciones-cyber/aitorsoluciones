# Runbook Work/IA · Aitor Soluciones

Objetivo: que Aitor no gestione marketing a mano. Aitor solo sube fotos/vídeos a Drive (`Aitor Soluciones/00_NUEVOS_TRABAJOS`) y, cuando se le pida, confirma una localidad.
Todo se ejecuta desde la raíz del repo con `npm run mk -- <comando>`. Nunca se modifica producción: la web solo cambia por rama → PR → Deploy Preview.

## Lunes · producción y primera publicación
1. **Material nuevo.** Con el conector de Drive: listar `00_NUEVOS_TRABAJOS` (id de carpeta en `marketing/_state/config.local.json`, fuera de git), guardar el listado como `drive.json`
   (`[{driveId, name, path, mimeType, size, createdTime}]`) y `ingest --manifest drive.json`. Si hay copia local de Drive: `ingest <carpeta>`.
   El conector no descarga ficheros de varios MB: para generar activos hace falta el fichero local (Drive para escritorio o descarga manual a una carpeta y `ingest`).
2. **Revisar** (`jobs --status NEW`): ver las fotos, fijar `--role` antes/después, `--service`, título y `--notes` (solo lo que se hizo, sin inventar).
   La localidad solo se confirma con `--confirm-location` cuando Aitor la ha confirmado; sin confirmar, no se nombra.
   Pasar a `--status READY`. Rechazar lo que no sirva (`reject`).
3. `week --day mon`: QA del estado, `plan` (repone hasta 4 semanas) y deja en `READY_TO_PUBLISH` lo de hoy.
4. **Publicar** lo de `queue/READY_TO_PUBLISH/<hoy>__*` (o `publish --live` si hay credenciales) y registrar: `published <pieza> <canal> <url>`.

## Miércoles · segunda revisión y publicación
1. `week --day wed` (QA + plan + cola). 2. Publicar Instagram + Google Business. 3. `published ...`.

## Viernes · cierre y preparación de la siguiente semana
1. `week --day fri`: debe quedar ≥ 4 semanas de colchón (`status`). Si falta material seguro → ampliar `marketing/bank/evergreen.json` (2 enfoques por tema, sin cifras ni precios) o pedir trabajos nuevos.
2. Métricas de la semana: `report add ...` (GA4: `generate_lead`, `whatsapp_click`, `phone_click`; Netlify Forms; Search Console; Google Business; alcance social) y `report summary`.
3. `drive-plan`: mover en Drive el material a `01_PROCESADOS` / `02_PUBLICADOS` / `03_DESCARTADOS` según su estado.

## Llevar un trabajo real a la web
`web propose-case <jobId> [--related servicio1,servicio2] [--page --problem "..."]` → rama + build/check + PR. Revisar el Deploy Preview del PR; solo Aitor/el humano responsable fusiona.
Antes: `qa --web --urls /trabajos/` (y la URL del caso si lleva página).

## Reglas que no se saltan
Fotos reales solo para trabajos reales · nada de localidades, clientes, resultados, precios o reseñas inventados · no duplicar ni publicar en masa · no cambiar URLs ni SEO estructural sin necesidad ·
no publicar sin pasar `qa` · las credenciales de Meta/Google viven en variables de entorno, nunca en el repo.

## Imagen para una pieza evergreen (motor visual)
1. Escribe el brief (`marketing/brief.example.json`): campaña, tipo, canal, ratio, titular, CTA y, si procede, una localidad prioritaria. Nunca fotos reales como referencia ni `use_real_work` con material de otro trabajo.
2. `npm run mk -- visual run brief.json --dry-run` y revisa prompts y coste. Luego sin `--dry-run`.
3. Revisa `composed/`/`feed/` y lo descartado en `rejected/`. Si algo se ve «de IA» (manos, herramientas, vegetación imposible, brillos, colores saturados) no lo uses.
4. `npm run mk -- visual attach <pieceId> <assetId..>`, después `qa` y la cola de siempre.
Trabajo real con titular/logotipo: brief con `use_real_work:true` y `source_images:[<id de foto real>]` (`edit.operation: compose` por defecto, sin IA).
