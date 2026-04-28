/**
 * Currency denominations used by the close-day flow and the printed
 * verification checklist (REPORTS-SPEC §4.4 / §5.2). Values are in centavos,
 * descending — bills first, then coins. Stored as a constant rather than a
 * DB table because denominations don't change at runtime; if they ever do,
 * a code change is the right vehicle.
 */
export const DENOMINATIONS: Record<string, number[]> = {
  MXN: [
    100_000, // $1,000
     50_000, // $500
     20_000, // $200
     10_000, // $100
      5_000, // $50
      2_000, // $20
      1_000, // $10 coin
        500, // $5 coin
        200, // $2 coin
        100, // $1 coin
         50, // $0.50 coin
  ],
  USD: [
    10_000, // $100
     5_000, // $50
     2_000, // $20
     1_000, // $10
      500,  // $5
      100,  // $1
       25,  // quarter
       10,  // dime
        5,  // nickel
        1,  // penny
  ],
};

/** Denominations for the active currency, falling back to MXN when unknown. */
export function getDenominations(currency: string): number[] {
  return DENOMINATIONS[currency] ?? DENOMINATIONS.MXN!;
}

/**
 * Threshold below which a denomination is treated as a coin rather than a
 * bill. Used by the printout to group rows under "Billetes/Bills" vs
 * "Monedas/Coins". The split is conventional: anywhere $20+ is paper, less
 * is metal in MXN; $1+ is paper, less is metal in USD.
 */
export function smallestBillCentavos(currency: string): number {
  switch (currency) {
    case 'USD':
      return 100; // $1 bill
    case 'MXN':
    default:
      return 2_000; // $20 bill
  }
}
