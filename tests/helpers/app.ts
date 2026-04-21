import type { Express } from 'express';
import { createApp } from '../../src/app.js';

// Share a single Express instance per test file — createApp is cheap but
// recreating it per test costs nothing valuable and sometimes churns listeners.
let cached: Express | null = null;
export function getTestApp(): Express {
  if (!cached) cached = createApp();
  return cached;
}
