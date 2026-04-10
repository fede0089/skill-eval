# Implementation Plan

## Objective
Asegurar que cuando una tarea falle en la interfaz de usuario, no se pierda el título original de la tarea. Actualmente, el mensaje de error ("Task failed evaluation" o "No skill activation detected...") reemplaza el título original en la terminal, lo cual confunde al usuario. Queremos que la línea se mantenga (ej: `Task 1/6: I'm having a wonderful day today...`) y simplemente muestre la cruz de fallo junto con la razón.

## Key Files & Context
- `src/utils/ui.ts`: Controla la configuración y ejecución de Listr2, incluyendo cómo se manejan y formatean los errores lanzados por las tareas.

## Implementation Steps
1.  **Modificar el manejo de errores en `src/utils/ui.ts`**:
    *   En el método `addTask`, dentro del bloque `catch` que captura los fallos de las tareas.
    *   Verificar si el error capturado es una instancia de `Error`.
    *   Modificar `error.message` para que el título original de la tarea (`descriptor.title`) se agregue como prefijo al mensaje de error. Por ejemplo: `error.message = \`\${descriptor.title} - \${error.message}\`;`.
    *   De esta manera, Listr2 (que ya agrega la cruz `✖` automáticamente) renderizará la cruz seguida del título de la tarea y luego el error, cumpliendo el requisito: "que deje la linea igual solo ponga la cruz cuando fallo".

## Verification & Testing
- Run `npm run build`.
- Run `npm run test:unit`.
- Comprobar visualmente que los tests en consola que fallan ahora muestran el título original junto con la cruz de fallo.

## Phase: Review Fixes
- [x] Task: Apply review suggestions (Type safety and visibility) [8746ab1]