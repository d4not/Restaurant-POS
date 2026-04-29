import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  // Comma-separated list of allowed frontend origins. Empty string (default)
  // means reflect-the-request-origin, which is what `cors()` with no options
  // does — fine for dev and for deployments fronted by a same-origin proxy.
  CORS_ORIGINS: z.string().default(''),
  // Directory where the uploads module persists user-supplied images
  // (product photos, category covers). Resolved relative to the process
  // CWD when not absolute. The same directory is served read-only at
  // `/uploads/*` by app.ts so the URL stored in image_url is reachable from
  // the admin browser and the POS terminal alike.
  UPLOAD_DIR: z.string().default('./uploads'),
  // Max upload size in bytes. 2 MiB is comfortable for the JPEG product
  // photos this project takes — the POS terminal renders thumbnails so we
  // don't need DSLR-quality originals.
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
