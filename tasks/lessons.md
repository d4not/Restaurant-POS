# Lessons Learned

## Patterns to Remember
<!-- After ANY correction, add the pattern here so it's never repeated -->

- **List KPIs source from a different entity than the form collects.** When a list view shows a primary KPI (e.g., Supply.average_cost) but the create form only writes peripheral entities (PurchasePackaging.price_per_package), the operator sees "$0" after save and assumes the form is broken. Always seed the parent's display field on create — backend usually has the hook (e.g., createSupplySchema.initial_unit_cost writes to both average_cost and last_cost). The terminal-side SupplyNewView did this; the admin-side SupplyEditor did not — that asymmetry caused the "supplier/price not persisted" bug.
- **Zod silently drops unknown fields.** When investigating "field X doesn't persist", check the module's schema.ts FIRST — if X isn't declared in the Zod schema, the controller never sees it. validate() middleware replaces req.body with the parsed object. Adding the field to the frontend payload without adding it to the Zod schema will pass validation and 2xx, but the field will vanish.
- **When adding multi-line endpoints on top of an existing per-item service**, extract the per-item body into a private `applyXWithinTx(tx, …)` helper first and call it from both the singleton and batch paths. Keeps stock/movement invariants in one place. Example: `write-offs/service.ts` → `applyWriteOffWithinTx` used by `createWriteOff` and `createWriteOffBatch`.
- **Recipe expansion already lives in cost-engine.** When you need to walk a recipe down to raw supply quantities (e.g., the Log Waste flow), reuse `convertRecipeQuantityToBase` + `computePreparationFactor` from `src/modules/recipes/cost-engine.ts` — don't re-derive the math. New resolvers should add a thin orchestration layer (see `recipes/recipe-resolver.ts`).
- **Validation errors return 422, not 400.** The Zod `validate()` middleware in this project responds with HTTP 422 on schema failure. Tests asserting `400` will fail; use `422`.
- **Test harness deadlocks under parallel load.** If many tests fail with Postgres `code: "40P01"` (deadlock during TRUNCATE), it's harness flakiness, not a regression. Single-file runs or a fresh full run usually pass clean.
- **Tree sucio al iniciar = otra sesión en curso, no triaje.** Si entras a una sesión y `git status` viene cargado de cambios + tests rotos, NO empieces a inventariar: estás viendo el WIP de otro agente en otra rama paralela. `/start-session` ahora arranca en su propio worktree fresco por esta razón — si te encuentras en master con basura ajena, para y pide worktree.
- **node-thermal-printer v4 needs an explicit `driver` for `printer:NAME` URIs.** It no longer auto-requires the printer module. Pass `driver: require('@thiagoelg/node-printer')` to the `ThermalPrinter` constructor, ONLY when interface starts with `printer:` (raw paths + `tcp://` don't need it). Lazy-load the driver so a missing/broken native binary surfaces at print time, not at boot.
- **Electron's binary can silently disappear after npm churn.** Symptom: `node_modules/electron/dist/` contains only `locales/`, `path.txt` missing, `npx electron` errors "Electron failed to install correctly". Root cause: `@electron/get` or `extract-zip` got pruned by a sibling install, so `install.js` exits 0 without downloading. Fix: reinstall those deps + manually unzip from `~/.cache/electron/<sha>/electron-vX.Y.Z-<plat>-<arch>.zip` into `dist/` and write `path.txt` with the platform binary name (`electron` on Linux, `electron.exe` on Windows, `Electron.app/Contents/MacOS/Electron` on Mac).
- **Native modules (`.node`) need `electron-builder install-app-deps` after npm install.** Add `"postinstall": "electron-builder install-app-deps"` so subsequent fresh installs rebuild against Electron's ABI. Without this, system-Node-built bindings throw "Module did not self-register" inside Electron. Don't forget the asarUnpack glob for the package too (`**/node_modules/@scope/pkg/**/*`) — otherwise the .node file ends up sealed inside app.asar and Node can't dlopen it.

## Project-Specific Gotchas
- All monetary values are integers in centavos — NEVER use floats
- Prices are TAX-INCLUSIVE: base = price / (1 + rate/100), tax = price - base
- Use decimal.js for ALL arithmetic involving costs, quantities, unit conversions
- Inventory ops MUST update stock AND log movement in a single Prisma transaction
- NEVER import @capacitor/* inside terminal/src/ — only in terminal-mobile/src/platform/
- NEVER duplicate code from terminal/src/ — import via @ alias
- CSS must use classes and variables from docs/mockup-style.css (admin) or docs/pos-terminal-styles.js (terminal)
- No UI frameworks (no Tailwind, no MUI)
- Modifier groups: SWAP replaces recipe ingredients, ADD stacks on top
- Recipe modifier lines link to modifier_group_id, not a specific supply
