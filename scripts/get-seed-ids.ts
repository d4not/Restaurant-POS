import { prisma } from '../src/lib/prisma.js';

async function main(): Promise<void> {
  const barra = await prisma.storage.findFirstOrThrow({ where: { name: 'Barra' } });
  const milk = await prisma.supply.findFirstOrThrow({ where: { name: 'Whole Milk 946ml' } });
  console.log(JSON.stringify({ barraId: barra.id, milkId: milk.id }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
