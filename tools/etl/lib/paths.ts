import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = join(process.cwd(), 'src', 'assets', 'data');

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

export function dataPath(fileName: string): string {
  return join(DATA_DIR, fileName);
}
