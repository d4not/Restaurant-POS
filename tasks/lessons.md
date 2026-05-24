# Lessons Learned

## Patterns to Remember
<!-- After ANY correction, add the pattern here so it's never repeated -->

- **List KPIs source from a different entity than the form collects.** When a list view shows a primary KPI (e.g., Supply.average_cost) but the create form only writes peripheral entities (PurchasePackaging.price_per_package), the operator sees "$0" after save and assumes the form is broken. Always seed the parent's display field on create — backend usually has the hook (e.g., createSupplySchema.initial_unit_cost writes to both average_cost and last_cost). The terminal-side SupplyNewView did this; the admin-side SupplyEditor did not — that asymmetry caused the "supplier/price not persisted" bug.
- **Zod silently drops unknown fields.** When investigating "field X doesn't persist", check the module's schema.ts FIRST — if X isn't declared in the Zod schema, the controller never sees it. validate() middleware replaces req.body with the parsed object. Adding the field to the frontend payload without adding it to the Zod schema will pass validation and 2xx, but the field will vanish.

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
