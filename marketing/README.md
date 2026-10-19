# Marketing autónomo · Aitor Soluciones

Infraestructura para que Work/IA produzca y gestione marketing de forma continua, con o sin trabajos nuevos.
**No es otra web ni un rediseño**: vive en `marketing/`, no toca `src/` salvo por el mecanismo seguro de casos (ver §Web).

```
npm run mk -- <comando>      # CLI (marketing/cli.mjs)
npm run mk:test              # 28 pruebas
npm run mk:qa                # QA del banco y de las piezas (-- --web para QA de la web)
```

## Flujo

```
Drive 00_NUEVOS_TRABAJOS ──ingest──> NEW ──review──> REVIEWED ──> READY ──plan──> SCHEDULED ──queue──> READY_TO_PUBLISH ──published──> PUBLISHED
        (o archivo histórico)           (Aitor/IA confirma servicio y localidad)                 (activos 1080x1350, story, carrusel, GBP)
Banco evergreen (26 temas × 2 enfoques) ───────────────────────────────────────────────────────┘   (siempre hay contenido, con o sin trabajos)
```

Estados de material, trabajos y piezas: `NEW · REVIEWED · READY · SCHEDULED · PUBLISHED · ARCHIVED · REJECTED`.
Carpetas de Drive (ya creadas): `00_NUEVOS_TRABAJOS` (NEW) · `01_PROCESADOS` (REVIEWED/READY/SCHEDULED) · `02_PUBLICADOS` (PUBLISHED) · `03_DESCARTADOS` (REJECTED/ARCHIVED) · `04_MATERIAL_MARCA`. `npm run mk -- drive-plan` lista qué mover.

## Comandos

| Necesidad | Comando |
|---|---|
| Estado general y colchón | `status` |
| Sembrar el banco con los casos reales ya publicados en la web | `init` |
| Detectar material nuevo (carpeta local o espejo de Drive) | `ingest <carpeta> [--origin archive]` |
| Detectar material nuevo (listado del conector de Drive) | `ingest --manifest drive.json` |
| Emparejar originales HEIC con las fotos ya publicadas (800 px → alta resolución) | `link-originals` (revisar) → `link-originals --apply` |
| Ver trabajos | `jobs [--status NEW]` |
| Revisar un trabajo | `review <id> --title ".." --service desbroce-parcelas --location alcanar --confirm-location --role <assetId>=before --notes ".." --status READY` |
| Descartar / archivar | `reject <id>` · `archive <id>` |
| Temas evergreen (y aprobar los pendientes) | `evergreen` · `evergreen approve <id>` |
| Rellenar el colchón (≥ 4 semanas) | `plan [--weeks 4] [--dry-run]` |
| Quitar una pieza y liberar el material | `cancel <pieceId>` |
| Generar activos y dejar la cola lista | `queue [--ahead 3]` → `queue/READY_TO_PUBLISH/<fecha>__<pieza>__<canal>/` |
| Registrar una publicación real | `published <pieceId> <instagram\|facebook\|gbp> <url>` |
| Publicar automáticamente (si hay credenciales) | `publish --live` |
| Métricas | `report add --period 2026-10-19 --metric leads --value 3 --source ga4` · `report import --file m.csv` · `report summary` |
| Llevar un trabajo a la web (rama + PR) | `web propose-case <id> [--page --problem ".."] [--related a,b] [--featured] [--dry-run] [--no-push]` |
| QA | `qa` · `qa --web [--urls /,/trabajos/]` |
| Exportar a CSV / Google Sheets | `export` |
| Rutina del día (lunes/miércoles/viernes) | `week [--day mon]` |

El estado (banco, cola, métricas, ids de carpetas de Drive en `config.local.json`) vive en `marketing/_state/` (**fuera de git**: el repositorio es público) o en `MK_HOME`.

## Planificador

Lunes (10:00): producción + primera publicación (Instagram + Facebook). Miércoles (10:00): segunda revisión + publicación (Instagram + Google Business).
Viernes: cierre y preparación de la semana siguiente (`week` repone el colchón). Mínimo **4 semanas** disponibles (`cadence.minBufferWeeks`).
Mezcla: como máximo 1 trabajo real por semana (lunes); el resto, evergreen de temporada, sin repetir categoría ni plantilla gráfica dos veces seguidas (guardarraíl de diversidad).

## Control de repeticiones

Cada uso se registra (material/tema + enfoque + canal + fecha) en `usage.json`. Reglas: mismo material con el mismo enfoque nunca; con otro enfoque solo tras 45 días;
reutilización deliberada del mismo enfoque solo tras 120 días (`plan --allow-reuse`). Huellas: SHA-256 (duplicado exacto, bloquea), aHash (similar, avisa).

## Guardarraíles (se aplican al planificar, renderizar y en `qa`)

- Los trabajos solo usan **fotografías reales de ese trabajo**; lo evergreen solo gráficos tipográficos. No se generan trabajos ni fotos falsas.
- Localidades: solo las de `src/_data/locations.json`, y solo nombradas si una persona las confirmó (`--confirm-location`). Nada de clientes, cifras, reseñas, precios ni garantías (patrones prohibidos en `config.json`).
- Temas que aluden a normativa (`reviewed:false`) no se usan hasta `evergreen approve <id>`.
- Nada de páginas SEO masivas: una página de caso exige contenido real (`problem ≥ 60`, `whatWeDid ≥ 40`) y por defecto un caso solo entra en la galería de `/trabajos/`.

## Web

`web propose-case` exige trabajo READY, localidad confirmada, foto antes y después reales. Crea la rama `marketing/caso-<slug>`, convierte las fotos a WebP, ejecuta `make-thumbnails`, añade el caso a `workCases.json`, corre `build` + `check`, hace commit, empuja la rama y abre el PR (Deploy Preview automático de Netlify). **Nunca toca main ni producción**; si algo falla, descarta la rama. `qa --web` añade QA responsive (320/390/768/1280 sin desbordamiento ni imágenes rotas) y Lighthouse (A11y/BP/SEO = 100, rendimiento ≥ 95).

## Publicación

Hoy no hay API/conector conectado para Google Business Profile, Facebook ni Instagram: todo queda en `READY_TO_PUBLISH` (imagen + `caption.txt` + `alt.txt` + `PUBLICAR.md`).
Los adaptadores (`lib/adapters.mjs`) publican solos con `FB_PAGE_ID/FB_PAGE_TOKEN`, `IG_USER_ID/IG_TOKEN`, `GBP_ACCOUNT/GBP_LOCATION/GBP_TOKEN`, `MK_MEDIA_BASE_URL` (URL pública de la cola, necesaria para IG y GBP) y `MK_ALLOW_PUBLISH=1`. Están probados con un `fetch` simulado, no contra las cuentas reales.

Procedimiento diario de Work/IA: `marketing/RUNBOOK-WORKIA.md`.
