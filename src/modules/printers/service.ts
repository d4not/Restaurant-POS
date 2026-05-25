import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import type { CreatePrinterInput, UpdatePrinterInput } from './schema.js';

export async function listPrinters() {
  return prisma.printer.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
  });
}

export async function getPrinter(id: string) {
  const printer = await prisma.printer.findUnique({ where: { id } });
  if (!printer || !printer.active) throw new NotFoundError('Printer not found');
  return printer;
}

export async function createPrinter(input: CreatePrinterInput) {
  if (input.address) {
    const existing = await prisma.printer.findFirst({
      where: { address: input.address, active: true },
      select: { id: true },
    });
    if (existing) throw new ConflictError('A printer with this address already exists');
  }

  return prisma.printer.create({ data: input });
}

export async function updatePrinter(id: string, input: UpdatePrinterInput) {
  const printer = await prisma.printer.findUnique({
    where: { id },
    select: { id: true, active: true, address: true },
  });
  if (!printer || !printer.active) throw new NotFoundError('Printer not found');

  if (input.address && input.address !== printer.address) {
    const dup = await prisma.printer.findFirst({
      where: { address: input.address, active: true, id: { not: id } },
      select: { id: true },
    });
    if (dup) throw new ConflictError('A printer with this address already exists');
  }

  return prisma.printer.update({ where: { id }, data: input });
}

export async function deletePrinter(id: string) {
  const printer = await prisma.printer.findUnique({
    where: { id },
    select: { id: true, active: true },
  });
  if (!printer || !printer.active) throw new NotFoundError('Printer not found');

  await prisma.$transaction([
    prisma.printerProfile.updateMany({
      where: { printer_id: id },
      data: { printer_id: null },
    }),
    prisma.printer.update({
      where: { id },
      data: { active: false },
    }),
  ]);
}
