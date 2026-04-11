# Implementation Plan: NDJSON Fix + Pass@k Multi-Trial

## Phase 1: Fix NDJSON Parsing (Fundación)

El regex `line.match(/\{.*\}/)` en 3 ubicaciones rompe silenciosamente con JSON anidado (ej: `{"parameters":{"options":{}}}`). Esta phase es prerequisito de la Phase 2.

- [x] Task: Escribir test para objeto JSON con braces anidados
    - [x] En `tests/core/trigger-grader.test.ts`: añadir caso con `{"type":"tool_use","parameters":{"name":"mock-skill","opts":{}}}`
- [x] Task: Crear `src/utils/ndjson.ts` con `parseNdjsonEvents(output: string): any[]`
    - [x] `JSON.parse(line.trim())` por línea, sin regex; skip silencioso de líneas inválidas
    - [x] Exportar función para uso en evaluator y eval-runner
- [x] Task: Refactorizar `parseStreamResult()` en `src/core/eval-runner.ts`
    - [x] Reemplazar loop con regex por `parseNdjsonEvents(output)`
- [x] Task: Refactorizar `gradeTrigger()` en `src/core/evaluator.ts`
    - [x] Reemplazar loop con regex por `parseNdjsonEvents(rawOutput)`
- [x] Task: Refactorizar `detectSkillAttempt()` en `src/core/evaluator.ts`
    - [x] Mismo reemplazo
- [x] Task: Verificar `npm run test:unit` — todos los tests pasan (50/50)

## Phase 2: Pass@k Multi-Trial

`EvalTrial.id` siempre es `1`, `trials[]` siempre tiene 1 elemento. El no-determinismo de los LLMs hace que 1 solo intento no sea representativo.

- [x] Task: Crear `src/core/statistics.ts` con `computePassAtK()`
    - [x] Implementar `pass@k = 1 - C(failing, k) / C(total, k)` con función `combinations(n, r)`
    - [x] Escribir unit tests: `[P,P,F]→k=1 ≈ 0.667`, `[F,F,F]→k=1 = 0`, `[P,P,P]→k=1 = 1`
- [x] Task: Actualizar `src/types/index.ts`
    - [x] Añadir `numTrials?: number`, `passAtK?: number`, `baselinePassAtK?: number` a `EvalSuiteReport.metrics`
- [x] Task: Añadir flag `--trials <number>` (default `3`) en `src/index.ts`
    - [x] Thread `numTrials` a `triggerCommand()` y `functionalCommand()`
- [x] Task: Actualizar `EvalRunner` en `src/core/eval-runner.ts`
    - [x] Añadir `trialId: number` como parámetro a `runTriggerTask()` y `runFunctionalTask()`
    - [x] Worktree incluye trial: `task-${task.id}-trial-${trialId}`
    - [x] `EvalTrial.id` usa el `trialId` recibido (no hardcoded `1`)
- [x] Task: Actualizar `src/commands/trigger.ts` para multi-trial
    - [x] Loop externo `for trialId = 1..numTrials` por tarea
    - [x] `TaskResult.score = passed_trials / numTrials`
    - [x] Tabla muestra `X/N` cuando `numTrials > 1`, `PASS/FAIL` cuando `= 1`
    - [x] Añadir `passAtK` y `numTrials` en `metrics`
- [x] Task: Actualizar `src/commands/functional.ts` para multi-trial
    - [x] Mismo patrón para baseline loop y target loop
    - [x] `baselinePassAtK` en metrics
- [x] Task: Verificar `npm run test:unit` — 57/57 tests pasan
