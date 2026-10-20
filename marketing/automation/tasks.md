# Tareas programadas (preparadas, NO activadas)

Todo lo que hacen es idempotente y está acotado por presupuesto (`imageEngine.perBriefBudgetUsd`/`monthlyBudgetUsd`, `imageEngine.auto.maxPerRun`).
**Ninguna fusiona a `main` ni toca producción.** La publicación en plataformas la hace Work con sus conectores (`mk work next` → `mk work done`).
Activarlas requiere decisión de Aitor: una vez activas, gastan en OpenAI (céntimos por pieza) y empujan a la rama `media`.

Requisitos previos en la máquina donde corran: `marketing/_state/.env` con `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` (y `OPENAI_VISION_MODEL` para el crítico) y git con credenciales de GitHub.

## A) Ciclo de la máquina (lunes, miércoles y viernes 08:30)

Prepara todo antes de la hora de publicación: plan ≥ 4 semanas, imágenes de las piezas próximas, QA, cola `READY_TO_PUBLISH` y URLs públicas.

```
npm run mk -- auto run
```

Viernes, además, **limpieza semanal** (activos obsoletos, pruebas, renders huérfanos, `rejected` vencidos y rama `media`) e informe: `npm run mk -- auto run --prune`, después `npm run mk -- verify` y `npm run mk -- report`. Una pieza sin visual aprobado NO se publica (queda `VISUAL_PENDING`/`REJECTED`; ver `npm run mk -- visual state`).

Windows (Programador de tareas), **ejemplo sin ejecutar**:

```
schtasks /Create /TN "AitorSoluciones-mk-auto" /SC WEEKLY /D MON,WED,FRI /ST 08:30 /TR "cmd /c cd /d \"D:\NEGOCIOS Y IA\AITOR SOLUCIONES\Aitor_Soluciones_Web_Optimizada_SEO_Conversion_PWA\" && npm run mk -- auto run >> marketing\_state\auto.log 2>&1"
```

Para desactivarla: `schtasks /Delete /TN "AitorSoluciones-mk-auto" /F`.

## B) Rutina de Work (lunes y miércoles 10:00, hora de publicación)

Prompt para Work/ChatGPT:

> En el repo de Aitor Soluciones ejecuta `npm run mk -- work next`. Para cada ítem con `ready:true`, publica con el conector indicado (Facebook orgánico, Instagram, Google Business Profile) usando exactamente `caption`, `imageUrls` y `extraUrls`. Después confirma cada una con `npm run mk -- work done <pieza> <canal> <url>`; si falla, `npm run mk -- work fail <pieza> <canal> "motivo"`. Si algún ítem sale `ready:false`, ejecuta `npm run mk -- auto run` y vuelve a intentarlo; si sigue bloqueado, avisa del motivo (`blockedBy`). No fusiones nada ni publiques nada que no esté en `work next`.

## C) Rutina de Work (lunes 09:30): material nuevo de Drive

> Lista `Aitor Soluciones/00_NUEVOS_TRABAJOS` en Drive y genera el manifiesto; `npm run mk -- ingest --manifest <listado>`. Con `npm run mk -- drive pending` descarga cada fichero (raw/streaming) en una carpeta local con el nombre `<driveId>__<nombre>` y ejecuta `npm run mk -- drive receive <carpeta>`. Revisa `npm run mk -- jobs --status NEW`; no confirmes localidades sin que Aitor las indique.

## D) Revisión semanal (viernes 12:00)

`npm run mk -- status`, `npm run mk -- qa`, `npm run mk -- drive-plan` (qué mover entre carpetas de Drive) y `npm run mk -- report add ...` con las métricas disponibles. Informa de bloqueos: sin material seguro (`plan` lo indica), conectores caídos, presupuesto de imágenes (`npm run mk -- visual cost`).
