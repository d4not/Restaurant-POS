// Seed entrypoint — populated in later phases per SPEC.md §"Seed data for testing".
// Keeping this stub so `prisma db seed` is wired up from day one.
import { prisma } from '../src/lib/prisma.js';

async function main(): Promise<void> {
  // TODO: café seed (supplies, supplier, storages, products, preparations,
  // modifier groups, recipes) — added alongside Phase 2 / 3 implementation.
  console.log('Seed stub — no data inserted yet.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
