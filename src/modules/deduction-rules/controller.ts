import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateDeductionRuleInput,
  ListDeductionRuleQuery,
  UpdateDeductionRuleInput,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const rule = await service.createDeductionRule(req.body as CreateDeductionRuleInput);
  res.status(201).json({ success: true, data: rule });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listDeductionRules(
    req.query as unknown as ListDeductionRuleQuery,
  );
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const rule = await service.getDeductionRule(req.params.id as string);
  res.json({ success: true, data: rule });
}

export async function update(req: Request, res: Response): Promise<void> {
  const rule = await service.updateDeductionRule(
    req.params.id as string,
    req.body as UpdateDeductionRuleInput,
  );
  res.json({ success: true, data: rule });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteDeductionRule(req.params.id as string);
  res.status(204).send();
}
