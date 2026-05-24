Starting a new work session. Do these steps **in order**.

0. **Crear/entrar worktree fresco** — el repo tiene muchas ramas paralelas en
   vuelo y el master local suele estar sucio. Esta sesión vive en su propio
   worktree, no en el directorio compartido.
   - Llama `EnterWorktree` con `name` = el argumento que pasó el usuario
     después de `/start-session`. Si no pasó nada, llámalo sin `name` y deja
     que el runtime genere uno aleatorio.
   - El `baseRef` por default es `fresh` (origin/<default-branch>), así que
     arranca limpio sin importar qué tenga master local.
   - Si `EnterWorktree` falla porque ya estás dentro de un worktree, NO
     intentes "limpiar" ni `ExitWorktree`: pregunta al usuario qué quiere
     hacer y para ahí.

1. Lee `tasks/lessons.md` e internaliza los patrones.
2. Lee `tasks/todo.md` para ver estado actual.
3. Lee la sección Known Bugs de CLAUDE.md.
4. Corre `npm run test` para baseline (ahora corre en el worktree limpio,
   no en el master sucio).
5. Reporta: nombre del worktree, estado de tests, tareas pendientes,
   known bugs.
6. Pregunta qué trabajar hoy.
