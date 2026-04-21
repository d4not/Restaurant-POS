import { z } from 'zod';

export const paginationQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Prisma cursor pagination: fetch `limit + 1` to detect whether another page
 * follows, then truncate and emit the id of the last returned row as the
 * next cursor.
 */
export function buildCursorArgs(query: PaginationQuery): {
  take: number;
  cursor?: { id: string };
  skip?: number;
} {
  const base = { take: query.limit + 1 };
  if (!query.cursor) return base;
  return { ...base, cursor: { id: query.cursor }, skip: 1 };
}

export function toPageResult<T extends { id: string }>(
  rows: T[],
  limit: number,
): PageResult<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: items[items.length - 1]!.id };
}
