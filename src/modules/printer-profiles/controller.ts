import type { Request, Response } from 'express';
import * as service from './service.js';
import type { CreateProfileInput, UpdateProfileInput } from './schema.js';
import { probePrinter } from '../print/printer.js';

function id(req: Request): string {
  return req.params.id as string;
}

export async function list(_req: Request, res: Response): Promise<void> {
  const profiles = await service.listProfiles();
  res.json({ success: true, data: profiles });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const profile = await service.getProfile(id(req));
  res.json({ success: true, data: profile });
}

export async function create(req: Request, res: Response): Promise<void> {
  const profile = await service.createProfile(req.body as CreateProfileInput);
  res.status(201).json({ success: true, data: profile });
}

export async function update(req: Request, res: Response): Promise<void> {
  const profile = await service.updateProfile(id(req), req.body as UpdateProfileInput);
  res.json({ success: true, data: profile });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteProfile(id(req));
  res.status(204).send();
}

export async function assignCategories(req: Request, res: Response): Promise<void> {
  const { category_ids } = req.body as { category_ids: string[] };
  const profile = await service.assignCategories(id(req), category_ids);
  res.json({ success: true, data: profile });
}

export async function routingMap(_req: Request, res: Response): Promise<void> {
  const map = await service.getRoutingMap();
  res.json({ success: true, data: map });
}

export async function getStatus(_req: Request, res: Response): Promise<void> {
  const profiles = await service.listProfiles();
  const result: Record<string, boolean> = {};
  await Promise.all(
    profiles.map(async (p) => {
      if (!p.address) {
        result[p.id] = false;
        return;
      }
      const [ip, portStr] = p.address.split(':');
      const port = Number(portStr) || 9100;
      const width = p.paper_width === 32 ? 58 : p.paper_width === 42 ? 76 : 80;
      result[p.id] = await probePrinter({ ip, port, width });
    }),
  );
  res.json({ success: true, data: result });
}

export async function testPrint(req: Request, res: Response): Promise<void> {
  const profile = await service.getProfile(id(req));
  if (!profile.address) {
    res.json({ success: true, data: { ok: false, error: 'No address configured' } });
    return;
  }
  const [ip, portStr] = profile.address.split(':');
  const port = Number(portStr) || 9100;
  const width = profile.paper_width === 32 ? 58 : profile.paper_width === 42 ? 76 : 80;
  const connected = await probePrinter({ ip, port, width });
  res.json({ success: true, data: { ok: connected, profile_name: profile.name } });
}
