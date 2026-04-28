import { prisma } from '../src/lib/prisma.js';

async function main() {
  const [daily, registers, openShifts, shiftReports, admins, cashiers, products, categories] = await Promise.all([
    prisma.dailyReport.findMany({
      orderBy: { date: 'desc' },
      select: { id: true, date: true, folio: true, status: true },
    }),
    prisma.cashRegister.count(),
    prisma.cashRegister.count({ where: { status: 'OPEN' } }),
    prisma.shiftReport.count(),
    prisma.user.findMany({
      where: { role: 'ADMIN', active: true },
      select: { id: true, name: true, email: true },
    }),
    prisma.user.findMany({
      where: { role: { in: ['CASHIER', 'MANAGER', 'WAITER'] }, active: true },
      select: { id: true, name: true, role: true },
    }),
    prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        type: true,
        sell_price: true,
        category: { select: { id: true, name: true } },
      },
      take: 30,
    }),
    prisma.productCategory.findMany({ select: { id: true, name: true } }),
  ]);
  console.log(
    JSON.stringify(
      { daily, registers, openShifts, shiftReports, admins, cashiers, products, categories },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
