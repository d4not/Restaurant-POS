import { prisma } from '../../lib/prisma.js';
import { computeAvailabilityBulk, type AvailabilityOpts } from './engine.js';
import type { BulkAvailabilityResult } from './types.js';

// Thin wrapper — opens a non-transactional client and delegates to the engine.
// Kept separate so callers (the controller and any future cache/cron layer)
// don't depend on the engine module directly.
export async function getAvailability(
  opts: AvailabilityOpts = {},
): Promise<BulkAvailabilityResult> {
  return computeAvailabilityBulk(prisma, opts);
}
