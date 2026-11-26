import path from 'node:path';

export interface AppConfig {
  port: number;
  databasePath: string;
  storagePath: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  deviceAccessKey: string;
  maxFileSize: number;
  maxChunkSize: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataPath = path.resolve(env.DATA_PATH ?? './data');
  return {
    port: positiveInteger(env.PORT, 3000),
    databasePath: path.resolve(env.DATABASE_PATH ?? path.join(dataPath, 'photos.db')),
    storagePath: path.resolve(env.STORAGE_PATH ?? path.join(dataPath, 'media')),
    jwtSecret: env.JWT_SECRET ?? 'development-only-change-me',
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '365d',
    deviceAccessKey: env.DEVICE_ACCESS_KEY ?? '',
    maxFileSize: positiveInteger(env.MAX_FILE_SIZE, 20 * 1024 * 1024 * 1024),
    maxChunkSize: positiveInteger(env.MAX_CHUNK_SIZE, 20 * 1024 * 1024),
    rateLimitWindowMs: positiveInteger(env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: positiveInteger(env.RATE_LIMIT_MAX, 120)
  };
}
