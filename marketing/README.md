# Marketing autónomo · Aitor Soluciones

Infraestructura para que Work/IA produzca y gestione marketing de forma continua, con o sin trabajos nuevos.
**No es otra web ni un rediseño**: vive en `marketing/`, no toca `src/` salvo por el mecanismo seguro de casos (ver §Web).

```
npm run mk -- <comando>      # CLI (marketing/cli.mjs)
npm run mk:test              # 52 pruebas
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

- Los trabajos solo usan **fotografías reales de ese trabajo**; lo evergreen, gráficos tipográficos o imágenes generadas **etiquetadas como IA**. No se generan trabajos ni fotos falsas.
- Localidades: solo las de `src/_data/locations.json`, y solo nombradas si una persona las confirmó (`--confirm-location`). Nada de clientes, cifras, reseñas, precios ni garantías (patrones prohibidos en `config.json`).
- Temas que aluden a normativa (`reviewed:false`) no se usan hasta `evergreen approve <id>`.
- Nada de páginas SEO masivas: una página de caso exige contenido real (`problem ≥ 60`, `whatWeDid ≥ 40`) y por defecto un caso solo entra en la galería de `/trabajos/`.

## Web

`web propose-case` exige trabajo READY, localidad confirmada, foto antes y después reales. Crea la rama `marketing/caso-<slug>`, convierte las fotos a WebP, ejecuta `make-thumbnails`, añade el caso a `workCases.json`, corre `build` + `check`, hace commit, empuja la rama y abre el PR (Deploy Preview automático de Netlify). **Nunca toca main ni producción**; si algo falla, descarta la rama. `qa --web` añade QA responsive (320/390/768/1280 sin desbordamiento ni imágenes rotas) y Lighthouse (A11y/BP/SEO = 100, rendimiento ≥ 95).

## Publicación (Work consume la cola con sus conectores)

La publicación diaria **no depende de tokens de Meta/Google**: Work/ChatGPT ya tiene conectores con escritura (Facebook orgánico, Instagram, Google Business Profile). El sistema solo prepara y deja todo listo:

```
mk auto run            → ingesta · plan · imágenes · QA · cola READY_TO_PUBLISH · URLs públicas
mk work next           → JSON con lo que Work debe publicar hoy: conector, herramienta, cuenta, texto, URLs HTTPS
  (Work ejecuta create_photo_post / create_image_post / create_carousel_post / create_story / create_local_post)
mk work done <pieza> <canal> <url>   → confirma (la pieza pasa a PUBLISHED y se libera el hueco)
mk work fail <pieza> <canal> "motivo" → deja constancia; la pieza sigue en cola
```

- Cada ítem de `work next` trae `ready`, `blockedBy` (p. ej. sin URL pública, Instagram sin JPEG, cuenta sin configurar), `imageUrls`, `extraUrls` (story), `actions[]` con `tool` y `args` (los nombres de argumentos son orientativos: Work los adapta al esquema real de cada herramienta) y `aiGenerated`.
- Los ids de cuenta (página de Facebook, usuario de Instagram, ubicación de Business Profile) viven en `<estado>/config.local.json` → `work.accounts`, fuera de git.
- Los adaptadores API propios (`lib/adapters.mjs`, `mk publish --live`) siguen disponibles como **alternativa**, no como requisito.

### URLs públicas de los medios
Instagram y Google Business exigen una URL HTTPS. `mk media publish` copia los ficheros de `READY_TO_PUBLISH` a la rama huérfana **`media`** del mismo repositorio (sin historial común con `main`, no entra en el build de la web, no engorda el repo principal), verifica que **cada URL devuelve la imagen directamente** (200, `image/*`, mismos bytes) y escribe `publicUrls` en el `post.json`.
- URL estable `https://raw.githubusercontent.com/<owner>/<repo>/media/m/AAAA-MM/<publicación>__<huella>/<fichero>`; la huella cambia si cambia la imagen (la CDN cachea unos minutos).
- Sin secretos: usa las credenciales de git ya configuradas. `config.media.provider: "netlify"` sirve la misma rama como `media--<sitio>.netlify.app` si se activan los branch deploys.
- Limpieza: `mk media prune [--days 30] [--squash]` retira lo anterior a la retención (y con `--squash` compacta el historial de la rama). Las piezas se hacen públicas a medida que entran en el horizonte (`--ahead`, 3 días por defecto), no antes.

### Drive → pipeline sin descarga manual
`mk drive pending` lista lo registrado por manifiesto que falta descargar. Work baja cada fichero con su descarga raw/streaming y lo entrega: `mk drive receive <fichero|carpeta> [--drive-id ID --name N --path "00_NUEVOS_TRABAJOS/..."] [--map mapa.json] [--move]` (en una carpeta, `<driveId>__nombre.ext`). Se verifica el md5 de Drive, se copia a `<estado>/inbox/drive/`, se calculan huellas y duplicados y el trabajo queda NEW para revisión. No hay otra autenticación de Drive en este código.

## Motor visual (OpenAI Images API)

Work/IA entrega un **brief** (`marketing/brief.example.json`); el motor decide si generar, editar o solo componer, llama a la API, puntúa, compone texto/logotipo **por código**, genera los tamaños y registra todo. Aitor solo aporta material nuevo.

| Tipo de salida | Cuándo | Qué hace el modelo |
|---|---|---|
| **A) Generada** (`editorial`, `illustration`, `background`, `infographic`, `carousel`) | piezas evergreen/educativas | genera solo el fondo/escena, **sin texto ni logotipos**; en fotorrealismo sin personas ni herramientas; en ilustración se permiten herramientas, manos y siluetas editoriales (`elements`) |
| **B) Foto real** (`use_real_work:true`, `edit.operation`: `compose` · `enhance` · `extend_canvas`) | trabajos reales | `compose`/`enhance`: nada de IA. `extend_canvas`: el modelo solo rellena márgenes; los píxeles reales se re-pegan y se rechaza si los altera |
| **C) Composición** (siempre) | todos | titular, CTA, localidad y **logotipo oficial** (`src/assets/img/logo-aitor-soluciones.png`) se aplican con código tras generar |

```bash
npm run mk -- visual env                       # comprueba modelo/clave (sin mostrar la clave)
npm run mk -- visual run brief.json --dry-run  # prompts, tamaño, variantes y coste estimado; sin llamar a la API
npm run mk -- visual run brief.json            # genera 2–3 variantes, puntúa, elige, compone, registra
npm run mk -- visual batch                     # procesa <MK_HOME>/briefs/*.json → done/ o failed/
npm run mk -- visual attach <pieceId> <assetId..>  # asocia imágenes a una pieza evergreen (añade la etiqueta de IA)
npm run mk -- visual cost                      # gasto del mes frente al presupuesto
```

- **Configuración**: `OPENAI_API_KEY` y `OPENAI_IMAGE_MODEL` por variables de entorno o `<MK_HOME>/.env` (ver `marketing/.env.example`). El modelo no está fijado en el código; DALL·E se rechaza como principal. `.env*` está en `.gitignore`.
- **Presupuesto**: `imageEngine.perBriefBudgetUsd` y `monthlyBudgetUsd` en `config.json`; el motor reduce variantes o se detiene si no caben. Cada llamada se anota en el ledger.
- **Variantes y crítico visual**: 2 por defecto (máx. 3). Puntuación programática (saturación, aspecto tecnológico, nitidez, contraste, simetría) + **crítico visual** (`OPENAI_VISION_MODEL`) sobre el fondo **y sobre la pieza final compuesta**: ¿parece IA?, ¿encaja con la marca?, ¿atractiva?, ¿errores?, ¿respira?, ¿texto bien situado?, ¿se entiende en móvil?, ¿publicable? Si falla → `rejected/` con motivos y se genera otra variante (hasta `maxVariants`) dentro del presupuesto; si ninguna pasa, no se compone nada (salida 2). Sin crítico la imagen queda `autoPublish:false` y `lintPiece`/`qa` exigen `mk visual approve <activo>` (aprobación humana).
- **Salidas** (fuera de git y de `src/`): `<MK_HOME>/assets/marketing/AAAA/MM/{originals,generated,composed,stories,feed,gbp,web,rejected}/`. Cada activo tiene un `.json` y una entrada en `assets.json` con `id, prompt, source, model, timestamp, campaign, type, format, channel, published, hash` (+ `origin`, `score`, `review`, `derivedFrom`).
- **Transparencia** (sin deteriorar el marketing): foto real (compose/enhance) → sin etiqueta; infografía/ilustración evidente → sin etiqueta; imagen generada que puede parecer una fotografía → etiqueta discreta **«Ilustración»** dentro de la imagen (abajo a la derecha); foto real ampliada con IA → «Ampliada con IA». Siempre se registra `aiGenerated`, modelo, prompt y fecha. Los pies no llevan frase obligatoria. Las piezas de trabajo real **no admiten** imágenes generadas ni se usan fotos reales como referencia.
- **Dirección visual**: permitidas herramientas, manos sin rasgos, siluetas, maquinaria simplificada y vegetación cuando explican el servicio (solo en ilustración); nunca personas falsas como clientes u operarios, trabajos o resultados inventados, maquinaria imposible ni fotorrealismo que se pueda tomar por una obra real.
- **Instagram** exige JPEG: la cola convierte PNG→JPG al preparar `READY_TO_PUBLISH`.
- **Pieza evergreen**: `mk visual for-piece <pieza> [--quality low]` genera la imagen (o el carrusel si la pieza lo es) con su titular, la adjunta y rehace su cola.

## Automatización y prueba E2E

- `mk auto run [--quality low] [--no-visuals] [--no-media] [--prune] [--dry-run]`: ingesta → plan (colchón ≥ 4 semanas) → imágenes de las piezas evergreen próximas (`imageEngine.auto`: 7 días, máx. 2 por ejecución, dentro de presupuesto) → QA → cola → URLs públicas → resumen de lo que Work debe publicar. Idempotente; no publica en plataformas ni toca `main`.
- `mk e2e [--piece id] [--quality low]`: prueba completa sobre una pieza del plan (banco → brief → OpenAI Images → selección → composición → crítico → QA → URL pública → `READY_TO_PUBLISH` → ítem de `work next`).
- Tareas programadas listas (sin activar): `marketing/automation/tasks.md`.
