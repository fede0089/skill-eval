# Baseline Capability Evaluation Plan

El objetivo es añadir la capacidad de evaluar cuántas de las expectativas de un skill son cumplidas por el agente de forma nativa (sin tener el skill enlazado), proveyendo una métrica "baseline" (línea base) para contrastar con la efectividad de usar el skill y medir el "uplift" (mejora real) del uso del skill.

## Funcionalidad por Defecto

Esta evaluación se realizará **por defecto** cada vez que se ejecute el comando `functional`. Testear contra el baseline sin intervención manual provee un diagnóstico riguroso de si el skill cumple un propósito real, midiendo el _uplift_ de forma nativa.

## Aislamiento de Efectividad vs Triggering (NUEVO)

Para garantizar que la evaluación funcional mida **estrictamente la efectividad del skill** y no se vea penalizada por problemas de _undertriggering_ (que el agente decida no usar el skill), los *prompts* durante la pasada con el skill activado serán modificados en tiempo de ejecución.
Se inyectará un sufijo o instrucción adicional que explícitamente obligue al agente a usar la herramienta referida. Ejemplo:
`[Prompt Original] + "\n\n(IMPORTANT: You MUST use the '${skill_name}' skill/tool to solve this request)."`

## Proposed Changes

### Modificación de Entorno
#### [MODIFY] src/core/environment.ts
Necesitamos poder preparar el entorno *sin* enlazar el skill de forma inicial para la pasada de "baseline".
- Refactorizaremos `setup()` para aislar el proceso de _linking_ en un nuevo método `linkSkill()`.
- Añadiremos un método `unlinkSkill()`.

### Actualización de la Lógica del Comando (`src/commands/functional.ts`)
#### [MODIFY] src/commands/functional.ts
- **Doble pasada de evaluación, siempre activa**:
  1. No se enlaza el skill (o se asegura de desenlazar invocando `env.unlinkSkill()`).
  2. Se ejecuta un bucle para todas las evals (modo baseline) recolectando las métricas usando el `prompt` original intacto.
  3. Se enlaza el skill localmente invocando `env.linkSkill()`.
  4. Se ejecuta un segundo bucle de iteración evaluando las expectativas (modo functional), pero **modificando el prompt** sumando la instrucción forzada: `"\n\nIMPORTANT: You must use the '${skill_name}' skill/tool to solve this task."`
- **Reporte Expandido (`summary.json`)**:
  Se generará un listado consolidado mostrando `Baseline Expectations Met`, `Functional Expectations Met`, y `Skill Uplift`.

#### [MODIFY] src/types/index.ts
Actualizar las interfaces del reporte final (`EvalSummaryReport`) y el resultado individual sumando métricas numéricas necesarias (ej., `baselinePassedCount`, `upliftExpectations`).

## Open Questions
- ¿La instrucción sugerida `"\n\nIMPORTANT: You must use the '${skill_name}' skill/tool to solve this task."` te parece lo suficientemente robusta para el Gemini CLI, o prefieres algún texto más estricto?

## Verification Plan

### Automated Tests
- Ejecutar el comando `npm run test:functional` usando el `mock-skill`. 
- Verificar que el log del runner para el pase "Functional" contenga la instrucción inyectada, garantizando que evalúa el skill a la fuerza.
- Confirmar visualmente el resumen de consola final y su versión en disco (`summary.json`) con las diferencias comparativas (baseline vs con skill).
