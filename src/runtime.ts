import { createHash, randomUUID } from 'node:crypto';
import type { Environment } from './domain/types.ts';

/** Server-owned defaults. These functions are never read from a task payload. */
export const nodeEnvironment: Environment = {
  id: randomUUID,
  now: () => new Date().toISOString(),
  sha256: value => createHash('sha256').update(value).digest('hex'),
};
