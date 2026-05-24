# Restaurant POS — Product Context

`register: product` (app UI, dashboards, internal tools — design serves the product, not the brand)

## Users

The system has three primary surfaces, each with a distinct operator:

- **POS Terminal (Electron + Android tablet)** — cashier, waiter and barista. Touch-first. Operates the floor during service. Time-sensitive: every second counts during a rush.
- **Admin Mode (inside the terminal)** — manager and admin. Keyboard-friendly, accelerated workflows. Used between rushes for shift audits, reports, supply management.
- **Admin Web (`localhost:5174`)** — admin only. Catalog editing, employee management, deep reporting.

This document covers the **Admin Mode** surface specifically — full-screen views launched from the Launchpad-style admin launcher inside the terminal.

The operator there is a manager or admin running a small café. They have ~3-5 minutes between rushes to act on supply problems: reorder before stockouts, audit a suspicious shift, log a write-off. They are competent but not desktop-natives. They will touch the screen as often as they tap a keyboard.

## Tone

Warm, calm, confident. Professional kitchen craft, not SaaS. The aesthetic is closer to a Michelin-listed café's printed menu than to Stripe or Linear.

Copy is direct ("New supply", not "Create a new supply item"). No jargon, no marketing voice. Errors are observations, not accusations.

## Anti-references

What this is NOT:

- **Not Toast / Square / Lightspeed**: those lean cold blue-and-white SaaS, dense data tables, generic.
- **Not Notion / Linear**: those are productivity-tools-for-thinkers. We are a kitchen tool for operators on their feet.
- **Not dark-mode dashboards**: this runs in a daylight café, not a 2am ops center.
- **Not Material / Fluent**: avoid Google/Microsoft component languages. They feel transactional.

## Strategic principles

1. **One screen, one job.** Each operation has its own full-screen view. Don't combine "browse + create + edit" into one mega-page unless the workflow genuinely demands it.
2. **Numbers are the hero.** Stock counts, costs, totals — these get Playfair Display and tabular numerics. They are the operator's primary signal.
3. **Status, not chrome.** Low stock is red. On hand is dark brown. Don't decorate; let semantic color do the work.
4. **Keyboard equals touch.** Every action available by tap must also work by keyboard (Esc to back out, 1-9 to pick tiles, ⌘K for the palette). The operator might be holding a coffee.
5. **No animations on layout.** Subtle ease-out on opacity / transform is welcome; sliding cards on every render is forbidden.

## The aesthetic vocabulary

- Cream background (`#f5f0e8`), warm dark brown text (`#2c2420`), brushed gold accent (`#c9a45c`), forest green for OK, terracotta red for warnings.
- Playfair Display for titles and numerals. DM Sans for everything else.
- Borders are 1px hairlines in `#e2dcd4`. Shadows are soft, warm-toned, never blue/grey.
- Rounded corners: 10px on cards, 8px on buttons / inputs, 6px on small chips.
- Minimum touch target: 44px. Inputs default to 38-40px height; primary CTAs to 48-52px.

## What "good" looks like in this codebase

Look at these existing views as the bar to clear (not to copy, but to beat):

- `terminal/src/components/adminMode/views/EmployeesView.tsx` — list + drawer detail with deep edits.
- `terminal/src/components/adminMode/views/ShiftAuditView.tsx` — date-grouped table with calm density.
- `terminal/src/components/adminMode/views/CashMovementsLogView.tsx` — filterable audit log.
- `terminal/src/components/adminMode/views/MultiTransferView.tsx` — multi-line draft form.

All four use `AdminViewShell` for the back-bar + title block and live in `terminal/src/components/adminMode/views/`.
