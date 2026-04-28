import { z } from 'zod';

// Both print endpoints take only the order id. Kept as a body parameter (not
// a URL param) so the mobile app can send a JSON body — easier to add fields
// later (e.g. force-reprint, station hint) without a route rename.
export const printOrderSchema = z.object({
  order_id: z.string().uuid(),
});

// Network discovery scan. Optional override of the subnet (CIDR /24) — if
// missing the server probes whichever local interface it sees first. Port
// defaults to 9100 (RAW IPP, near-universal for ESC/POS network printers).
const ipv4 = z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/u, 'Invalid IPv4 address');

export const scanPrintersSchema = z
  .object({
    subnet: ipv4.optional(),
    port: z.number().int().min(1).max(65535).optional(),
    // Cap how long the probe loop waits per host. Keeps the worst case bounded
    // when scanning a /24 with mostly-empty IPs.
    timeout_ms: z.number().int().min(50).max(2000).optional(),
  })
  .strict();

// Test print fires a tiny diagnostic to a specific role's printer (kitchen
// or receipt). Used from the Settings UI's "Test print" button.
export const testPrintSchema = z
  .object({
    role: z.enum(['kitchen', 'receipt']),
  })
  .strict();

export type PrintOrderInput = z.infer<typeof printOrderSchema>;
export type ScanPrintersInput = z.infer<typeof scanPrintersSchema>;
export type TestPrintInput = z.infer<typeof testPrintSchema>;
