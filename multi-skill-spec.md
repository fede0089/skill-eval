## 1. Objetivo Funcional
Permitir que los comandos de evaluación (`functional` y `trigger`) realicen un A/B test simultáneo entre el código de un Skill en desarrollo (local) y una o múltiples versiones históricas de ese mismo Skill alojadas en Git. Todas las versiones se evaluarán contra un entorno de prueba idéntico y contra el baseline habitual de cero-skills.

## 2. API de Usuario (CLI)
* **Flag a añadir:** `--compare-ref [refs...]` (Opcional, variádico, en `trigger` y `functional`).
* **Uso base:** `skill-eval functional --workspace ./project --skill ./my-skill`
  * *Comportamiento:* Evalúa Zero-Skill Baseline vs Local Skill. Etiqueta el Local Skill estáticamente como `local`.
* **Uso comparativo:** `skill-eval functional --workspace ./project --skill ./my-skill --compare-ref main v1.2`
  * *Comportamiento:* Evalúa N+1 variantes simultáneas: Zero-Skill Baseline, Ref Skills (extraídos de `main` y `v1.2`), y Local Skill.

## 3. Modelo de Datos (Extensibilidad "1 + N")
El modelo interno (`src/types/index.ts`) debe refactorizarse para abandonar la estructura dual estática y soportar $N$ versiones de un skill, manteniendo el baseline por separado.

**Estructura Requerida para `TaskResult`:**

```typescript
interface TaskResult {
  taskId: number;
  prompt: string;
  baselineTrials: EvalTrial[]; // Antes: withoutSkillTrials
  skillTrials: Record<string, EvalTrial[]>; 
  // Ej: { "local": [...], "ref:main": [...], "ref:v1.2": [...] }
}
```

**Identificadores de Versión (Claves del Diccionario con Namespaces):**
1. **Ref Skill:** Se utilizará el prefijo `ref:` seguido del string exacto proveído por el usuario (ej. `"ref:main"`).
2. **Local Skill:** Siempre utilizará la clave estática `"local"` para evitar colisiones en caso de que el usuario compare contra la misma rama en la que se encuentra posicionado.

Las métricas agregadas (`EvalSuiteReport.metrics`) deben adaptarse para agrupar puntuaciones, tiempos y tokens respetando estas claves dinámicas.

## 4. Arquitectura de Aislamiento (Patrón "Two-Step Extraction")
Para garantizar una evaluación limpia sin acoplar la gestión de versiones a la capa de integración de agentes (Runners), se utilizará el siguiente patrón:

### Fase 1: Global Setup (Preparación)
Antes de iniciar los trials concurrentes:
1. El sistema valida que el path `--skill` proveído pertenezca a un repositorio de Git. Si falla, y se proveyó `--compare-ref`, debe abortar inmediatamente.
2. Por cada referencia a comparar, se crea un directorio temporal global: `.project-skill-evals/skill-refs/<compare-ref>/`.
3. Se extrae el repositorio completo en el estado exacto del `<compare-ref>` usando `git archive` hacia esta carpeta efímera. *(Nota: Por el momento se asume aceptable la ineficiencia de extraer el repositorio completo, incluso si el skill reside en un subdirectorio).*

### Fase 2: Evaluación Concurrente (Linkeo)
Durante el ciclo principal de tareas:
* Se instanciarán Runners adicionales para cada variante histórica.
* En lugar de pasarles el path original del skill, se les inyectará el path de la carpeta efímera generada en la Fase 1 (añadiendo la ruta relativa al skill si aplica).
* El `AgentRunner` específico utilizará su contrato habitual `linkSkill` sin tener conocimiento de que el origen es un checkout histórico temporal.

### Fase 3: Teardown (Limpieza)
Al finalizar (o interrumpirse) la ejecución, el directorio global `.project-skill-evals/skill-refs/` debe ser purgado físicamente.

## 5. Requisitos de Ejecución y Visualización
* **Concurrencia de Pruebas:** Las ejecuciones de las variantes se limitarán globalmente utilizando el `AgentPool` (semáforo) existente, asegurando que sin importar cuántas versiones se comparen (N), nunca se exceda el límite de concurrencia máximo hacia la API de los agentes (ej. Gemini).
* **UI Dinámica (`table-renderer.ts`):** * La cabecera de la tabla y las columnas de resultados deben generarse dinámicamente iterando sobre las claves del diccionario `skillTrials`.
  * **Reporte de Métricas:** La UI mostrará los valores absolutos (ej. % de Pass@K, promedio de puntuación) de cada variante en columnas lado a lado. **No** se calculará ni mostrará un "Uplift Relativo" matemático; el usuario sacará sus propias conclusiones basándose en los resultados absolutos presentados en la tabla.