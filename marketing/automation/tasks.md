# Tareas programables (NO activadas)

Prompts listos para el programador de tareas de Claude. Cada una solo prepara y deja en cola; **no publica ni fusiona nada**.
Activarlas requiere confirmación de Aitor (ver README, "bloqueos").

## Lunes 09:30 · `mk-lunes`
Trabaja en el repo de Aitor Soluciones. Lee `marketing/RUNBOOK-WORKIA.md`. 1) Lista `00_NUEVOS_TRABAJOS` en Drive y ejecuta `npm run mk -- ingest --manifest <listado>`. 2) Si hay trabajos NEW con fotos descargables, revísalos
(sin confirmar localidades: pídeselo a Aitor). 3) `npm run mk -- week --day mon`. 4) Resume: piezas en cola, colchón, avisos. No publiques ni hagas merge.

## Miércoles 09:30 · `mk-miercoles`
Igual que el lunes pero con `npm run mk -- week --day wed`. Si hay material nuevo, ingerirlo y revisarlo.

## Viernes 12:00 · `mk-viernes`
`npm run mk -- week --day fri`; comprueba colchón ≥ 4 semanas (`status`); registra las métricas disponibles (`report add`); `drive-plan`. Informa de bloqueos (sin material seguro, canales sin credenciales).
