import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError } from '../../lib/errors.js';
import {
  LANGUAGE_DEFAULT,
  LANGUAGE_VALUES,
  SETTING_KEYS,
  type LanguageCode,
  type UpdateSettingsInput,
} from './schema.js';

type PrismaLike = Prisma.TransactionClient | typeof prisma;

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    orderBy: { key: 'asc' },
    select: { key: true, value: true },
  });
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function getSetting(
  key: string,
  client: PrismaLike = prisma,
): Promise<string | null> {
  const row = await client.setting.findUnique({
    where: { key },
    select: { value: true },
  });
  return row?.value ?? null;
}

export async function updateSettings(
  input: UpdateSettingsInput,
): Promise<Record<string, string>> {
  // Validate well-known keys before any write — default_tax_id must point at
  // an existing tax (or be an empty string meaning "unset"). Fail early so
  // partial updates don't leave the store in a half-valid state.
  if (SETTING_KEYS.DEFAULT_TAX_ID in input) {
    const value = input[SETTING_KEYS.DEFAULT_TAX_ID];
    if (value !== '') {
      const tax = await prisma.tax.findUnique({
        where: { id: value },
        select: { id: true },
      });
      if (!tax) {
        throw new BadRequestError(
          'default_tax_id references a non-existent tax',
        );
      }
    }
  }

  await prisma.$transaction(
    Object.entries(input).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    ),
  );

  return getAllSettings();
}

export async function getLanguage(): Promise<LanguageCode> {
  const value = await getSetting(SETTING_KEYS.LANGUAGE);
  if (value && (LANGUAGE_VALUES as readonly string[]).includes(value)) {
    return value as LanguageCode;
  }
  return LANGUAGE_DEFAULT;
}

export async function setLanguage(value: LanguageCode): Promise<LanguageCode> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.LANGUAGE },
    create: { key: SETTING_KEYS.LANGUAGE, value },
    update: { value },
  });
  return value;
}
