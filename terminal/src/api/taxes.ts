// Tax list — used by the product editor to assign or override the inherited
// default tax. The default itself lives under settings/default_tax_id, which
// the editor reads separately via the settings module.

import { api } from './client';
import type { PageResult } from './pagination';

export interface Tax {
  id: string;
  name: string;
  rate: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export async function listTaxes(opts: { active?: boolean } = {}): Promise<Tax[]> {
  const out: Tax[] = [];
  let cursor: string | null = null;
  do {
    const qs: string[] = ['limit=100'];
    if (opts.active !== undefined) qs.push(`active=${opts.active ? 'true' : 'false'}`);
    if (cursor) qs.push(`cursor=${cursor}`);
    const page = await api.get<PageResult<Tax>>(`/taxes?${qs.join('&')}`);
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 200) break;
  } while (cursor);
  return out;
}
