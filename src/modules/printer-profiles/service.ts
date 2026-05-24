import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import type { CreateProfileInput, UpdateProfileInput } from './schema.js';

const INCLUDE_CATEGORIES = {
  categories: {
    select: { id: true, name: true, color: true, display_order: true },
    orderBy: { display_order: 'asc' as const },
  },
};

export async function listProfiles() {
  return prisma.printerProfile.findMany({
    where: { active: true },
    include: INCLUDE_CATEGORIES,
    orderBy: { display_order: 'asc' },
  });
}

export async function getProfile(id: string) {
  const profile = await prisma.printerProfile.findUnique({
    where: { id },
    include: INCLUDE_CATEGORIES,
  });
  if (!profile || !profile.active) throw new NotFoundError('Printer profile not found');
  return profile;
}

export async function createProfile(input: CreateProfileInput) {
  const existing = await prisma.printerProfile.findFirst({
    where: { name: input.name, active: true },
    select: { id: true },
  });
  if (existing) throw new ConflictError('A profile with this name already exists');

  return prisma.printerProfile.create({
    data: input,
    include: INCLUDE_CATEGORIES,
  });
}

export async function updateProfile(id: string, input: UpdateProfileInput) {
  const profile = await prisma.printerProfile.findUnique({
    where: { id },
    select: { id: true, active: true, name: true },
  });
  if (!profile || !profile.active) throw new NotFoundError('Printer profile not found');

  if (input.name && input.name !== profile.name) {
    const dup = await prisma.printerProfile.findFirst({
      where: { name: input.name, active: true, id: { not: id } },
      select: { id: true },
    });
    if (dup) throw new ConflictError('A profile with this name already exists');
  }

  return prisma.printerProfile.update({
    where: { id },
    data: input,
    include: INCLUDE_CATEGORIES,
  });
}

export async function deleteProfile(id: string) {
  const profile = await prisma.printerProfile.findUnique({
    where: { id },
    select: { id: true, active: true },
  });
  if (!profile || !profile.active) throw new NotFoundError('Printer profile not found');

  await prisma.$transaction([
    prisma.productCategory.updateMany({
      where: { printer_profile_id: id },
      data: { printer_profile_id: null },
    }),
    prisma.printerProfile.update({
      where: { id },
      data: { active: false },
    }),
  ]);
}

export async function assignCategories(profileId: string, categoryIds: string[]) {
  const profile = await prisma.printerProfile.findUnique({
    where: { id: profileId },
    select: { id: true, active: true },
  });
  if (!profile || !profile.active) throw new NotFoundError('Printer profile not found');

  await prisma.$transaction([
    // Clear categories currently assigned to this profile (that are not in the new list)
    prisma.productCategory.updateMany({
      where: { printer_profile_id: profileId, id: { notIn: categoryIds } },
      data: { printer_profile_id: null },
    }),
    // Assign the listed categories to this profile (moves them from other profiles)
    ...(categoryIds.length > 0
      ? [
          prisma.productCategory.updateMany({
            where: { id: { in: categoryIds } },
            data: { printer_profile_id: profileId },
          }),
        ]
      : []),
  ]);

  return getProfile(profileId);
}

export async function getRoutingMap(): Promise<Record<string, string>> {
  const rows = await prisma.productCategory.findMany({
    where: { printer_profile_id: { not: null } },
    select: { id: true, printer_profile_id: true },
  });
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.id] = row.printer_profile_id!;
  }
  return map;
}

export async function getProfilesForPrinting(mode: 'comandas' | 'receipts') {
  return prisma.printerProfile.findMany({
    where: {
      active: true,
      ...(mode === 'comandas' ? { prints_comandas: true } : { prints_receipts: true }),
    },
    include: INCLUDE_CATEGORIES,
  });
}
