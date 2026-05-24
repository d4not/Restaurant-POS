import type { Request, Response } from 'express';
import * as service from './service.js';
import type { AvailabilityQuery } from './schema.js';

export async function getAvailability(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as AvailabilityQuery;
  const data = await service.getAvailability({
    registerId: query.register_id ?? null,
    stationId: query.station_id ?? null,
  });
  res.json({ success: true, data });
}
