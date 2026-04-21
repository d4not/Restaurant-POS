/**
 * Sanity-check that each report returns meaningful data against the seed.
 * Run with: `npx tsx scripts/verify-reports.ts`
 */
import { prisma } from '../src/lib/prisma.js';
import { listLowStock } from '../src/modules/alerts/service.js';
import {
  getProductCostReport,
  getSupplyMovementReport,
  getVarianceReport,
} from '../src/modules/reports/service.js';

async function main(): Promise<void> {
  console.log('=== LOW STOCK ALERTS (all storages) ===');
  const alerts = await listLowStock({});
  for (const a of alerts) {
    console.log(
      `  [${a.storage_name}] ${a.supply_name}: ${a.quantity} ${a.base_unit}` +
        ` (min ${a.min_stock}, shortfall ${a.shortfall})`,
    );
  }
  if (alerts.length === 0) console.log('  (none)');

  console.log('\n=== VARIANCE REPORT (last 30 days, Barra only) ===');
  const barra = await prisma.storage.findFirstOrThrow({ where: { name: 'Barra' } });
  const from = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const to = new Date();
  const variance = await getVarianceReport({
    storage_id: barra.id,
    from,
    to,
  });
  console.log(`  Window: ${variance.from} → ${variance.to}`);
  for (const r of variance.rows) {
    // Only surface rows with some activity; empty pairs make the log noisy.
    const hasActivity =
      r.actual_usage !== '0' ||
      r.theoretical_usage !== '0' ||
      r.purchases !== '0';
    if (!hasActivity) continue;
    console.log(
      `  ${r.supply_name.padEnd(28)} begin=${r.beginning.padStart(8)}` +
        ` purch=${r.purchases.padStart(6)} end=${r.ending.padStart(10)}` +
        ` actual=${r.actual_usage.padStart(10)} theo=${r.theoretical_usage.padStart(10)}` +
        ` var=${r.variance.padStart(10)}`,
    );
  }

  console.log('\n=== SUPPLY MOVEMENTS — Whole Milk, last 30 days ===');
  const milk = await prisma.supply.findFirstOrThrow({ where: { name: 'Whole Milk 946ml' } });
  const movement = await getSupplyMovementReport({
    supply_id: milk.id,
    from,
    to,
  });
  console.log(`  Supply: ${movement.supply_name} (${movement.base_unit})`);
  console.log(`  Summary:`);
  for (const [k, v] of Object.entries(movement.summary)) {
    console.log(`    ${k}: ${v}`);
  }
  console.log(`  ${movement.movements.length} movements`);
  for (const m of movement.movements) {
    console.log(
      `    ${m.created_at}  ${m.type.padEnd(14)}` +
        ` ${m.quantity.padStart(10)} ${m.storage_name.padEnd(8)}` +
        ` ref=${m.reference_type}`,
    );
  }

  console.log('\n=== PRODUCT COSTS (active only) ===');
  const productCosts = await getProductCostReport({ active_only: true });
  for (const p of productCosts.rows) {
    if (p.variants.length > 0) {
      console.log(`  ${p.product_name} [${p.type}]`);
      for (const v of p.variants) {
        console.log(
          `    • ${v.variant_name.padEnd(14)} price=${v.sell_price.padStart(5)}c` +
            ` cost=${Number(v.recipe_cost).toFixed(2).padStart(8)}c` +
            ` fc%=${Number(v.food_cost_pct).toFixed(1).padStart(5)}` +
            ` margin=${Number(v.gross_margin).toFixed(2).padStart(8)}c`,
        );
      }
    } else {
      console.log(
        `  ${p.product_name} [${p.type}]  price=${p.sell_price ?? '—'}c` +
          ` cost=${Number(p.recipe_cost).toFixed(2)}c` +
          ` fc%=${Number(p.food_cost_pct).toFixed(1)}` +
          ` margin=${p.gross_margin ? Number(p.gross_margin).toFixed(2) : '—'}c`,
      );
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
