import { prisma } from '../src/lib/prisma.js';

async function main() {
  const report = await prisma.dailyReport.findFirst({
    orderBy: { date: 'desc' },
    include: {
      closed_by: { select: { name: true } },
      shifts: {
        include: {
          user: { select: { name: true } },
          shift_report: { include: { alerts: true } },
        },
      },
      alerts: true,
    },
  });
  if (!report) {
    console.log('No daily reports.');
    return;
  }
  console.log('Folio Z-' + String(report.folio).padStart(4, '0'));
  console.log('Date:', report.date.toISOString().slice(0, 10), 'Status:', report.status);
  console.log('Closed by:', report.closed_by?.name, 'at', report.closed_at?.toISOString());
  console.log(`Gross: ${report.gross_sales} centavos / Net: ${report.net_sales} / Tickets: ${report.total_tickets}`);
  console.log(`Cash: ${report.cash_sales} | Card: ${report.card_sales} | Transfer: ${report.transfer_sales}`);
  console.log(`Variance: ${report.total_cash_variance}, Shifts: ${report.total_shifts} (${report.provisional_shifts} prov, ${report.unverified_provisionals} unverified)`);
  console.log('Shifts:');
  for (const s of report.shifts) {
    console.log(`  - ${s.user.name} (${s.type}) gross=${s.shift_report?.gross_sales} variance=${s.shift_report?.cash_variance} alerts=${s.shift_report?.alerts.length ?? 0}`);
  }
  console.log('Day-level alerts:', report.alerts.length);
  for (const a of report.alerts) {
    console.log(`  - [${a.severity}] ${a.type} — ${a.message}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
