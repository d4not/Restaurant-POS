# Restaurant POS — Design System (Admin Mode views)

This file captures the design tokens, component patterns and rules that govern the full-screen admin views inside the POS terminal. It is the canonical reference for any new view in `terminal/src/components/adminMode/views/`.

## Color tokens

CSS variables are declared globally and consumed via `var(--name)`:

```css
--bg:       rgb(245, 240, 232);  /* warm cream — primary surface */
--bg2:      #ffffff;             /* lifted card / panel surface */
--text1:    #2c2420;             /* primary text, dark warm brown */
--text2:    #6b5e54;             /* secondary text */
--text3:    #a89888;             /* muted text, helpers, labels */
--gold:     #c9a45c;             /* accent / focus / selection */
--green:    #4a8c5c;             /* success, OK stock, payment in */
--red:      #c45040;             /* danger, low stock, write-off */
--border:   #e2dcd4;             /* 1px hairline */
--sidebar:  #2c2420;             /* dark surfaces (top bar, drawers) */
--shadow-sm: 0 1px 2px rgba(44,36,32,0.04);
--shadow:    0 2px 8px rgba(44,36,32,0.06);
--shadow-lg: 0 8px 32px rgba(44,36,32,0.12);
```

**Bans.** `#000` and `#fff` are not used for text or surface. Cards never use side-stripe borders thicker than 1px as an accent (use a full hairline border + background tint, or a leading colored dot, instead). Gradient text is banned. Glassmorphism is banned.

## Typography

- **Headings, numerals, totals**: Playfair Display, weight 600. Use for view titles (24px), section heads (18px), KPI values (22-28px), and totals.
- **Body, UI, controls**: DM Sans. 13-14px default. 11-12px for labels.
- **Eyebrow labels**: 10-11px, uppercase, letter-spacing 0.12-0.16em, color `--text3`. Used above KPI values, section dividers, table headers.
- **Tabular numerics**: `fontVariantNumeric: 'tabular-nums'` on anything where columns of numbers need to line up.

## Spacing & rhythm

- 4 / 8 / 12 / 16 / 20 / 24 / 32 scale. Don't invent values in between.
- Variable spacing across regions — header `20-22px`, body `14-20px`, dense table rows `10-12px`. Same padding everywhere is the SaaS-cliché trap.
- Hairlines (1px borders) for division, not boxes-within-boxes. Avoid nested cards.

## Layout primitives

### `AdminViewShell`
Every admin sub-view wraps its content in `AdminViewShell` (from `terminal/src/components/adminMode/views/AdminViewShell.tsx`). It owns:
- Back chevron + title + optional subtitle in the slim header.
- Optional `headerActions` slot for filters / "+ New" buttons.
- Captured Esc handler (Esc backs out of the view).

```tsx
<AdminViewShell
  titleKey="admin.suppliesList.title"
  subtitleKey="admin.suppliesList.subtitle"
  onBack={onBack}
  headerActions={<Filters />}
>
  {/* body */}
</AdminViewShell>
```

### Page body grid
For list-plus-detail views, use a CSS grid: `gridTemplateColumns: 'minmax(0, 1fr) 380px'` (master + drawer) or `'minmax(0, 1.6fr) minmax(380px, 1fr)'` (split workspace).

For form-only views, max-width the form at ~720-820px and center it.

### Tables
```tsx
<div style={tableShell}>
  <div style={tableHead}>{/* uppercase eyebrow labels */}</div>
  <div style={tableScroll}>
    {rows.map(r => <div style={tableRow} key={r.id}>...</div>)}
  </div>
</div>
```
- `tableHead` uses `--bg` background, 11px uppercase letter-spaced labels in `--text3`.
- `tableRow` is grid-based, `12px` row gap, 13px content, `--border` hairline divider, hover background `#fef8ef` (warm).
- Row height ≥ 44px for touch. Numeric columns right-aligned + tabular-nums.

## Buttons

- **Primary CTA**: dark brown background (`var(--text1)`), white text, 14-15px, weight 600, 10-12px radius, ≥48px height. Used once per view (the main commit action).
- **Gold action**: gold background, dark brown text. Reserved for `+ New X` and `Send to kitchen`-class actions.
- **Secondary / ghost**: transparent background, 1px `var(--border)` border, `var(--text1)` text. For Cancel, Filter pills (active state inverts to dark brown).
- **Danger inline**: transparent background, `var(--red)` text, 1px `rgba(196,80,64,0.25)` border. For Delete, Cancel order.
- **Icon button**: 30-36px square, 6-8px radius, single icon stroke.

## Inputs

- 36-40px height. 1px `var(--border)` border, 6-8px radius. Background `var(--bg2)`.
- Focus: 1px `var(--gold)` border, lifted background. No fat focus rings.
- Labels above the input, 10-11px uppercase eyebrow in `var(--text3)`.

## Badges & status

- 11-12px text, 2-3px vertical padding, 9-11px horizontal padding, pill (radius 999).
- Color pairs: green / gold / red / blue / gray. Always paired background tint + colored border + colored text (e.g. red badge = `rgba(196,80,64,0.10)` bg, `0.30` border, `var(--red)` text).
- Status dots: 8-10px circles, used in row indicators alongside text.

## Empty states

Centered in the body area, ~60-80px vertical padding. `var(--text3)` color, 13-14px. Optional 36px icon at top. No illustration art.

## Motion

- Keep it sparse. Existing views use a CSS class `admin-view-enter` that runs a 180-220ms ease-out fade + 8px translate Y on mount.
- Never animate `width` / `height` / `top` / `left`. Use opacity + transform.
- Hover transitions on rows / buttons: 0.12-0.15s, ease-out.

## API & i18n hookups

- All data fetching uses TanStack Query (`useQuery`, `useMutation`). Use `queryClient.invalidateQueries` on success.
- API clients live in `terminal/src/api/` — already present for supplies, suppliers, purchases, packagings, transfers, write-offs, storages, etc.
- All visible text MUST use `t()` from `terminal/src/i18n`. New keys go into both `en.ts` and `es.ts`. Tile / view titles for the inventory section are already added under `admin.suppliesList.*`, `admin.supplyNew.*`, `admin.purchaseOrders.*`, `admin.suppliersList.*`, `admin.inventoryCount.*`, `admin.writeOffs.*`, `admin.stockMovements.*`.

## Reference implementations in this repo

Study these before crafting a new view:

- `EmployeesView.tsx` — list + slide-in drawer pattern, deep inline edits.
- `ShiftAuditView.tsx` — calm dense table grouped by date with KPI strip.
- `CashMovementsLogView.tsx` — filterable audit log with type chips.
- `MultiTransferView.tsx` — multi-line draft form, supply picker, totals.
- `SuppliesAdminView.tsx` — legacy combined "supplies + PO drafter"; useful for understanding the supply / packaging data model but NOT a template (it bundles two operations into one view, which is exactly what we are splitting apart).
