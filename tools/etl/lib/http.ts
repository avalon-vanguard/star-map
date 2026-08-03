import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CACHE_DIR = join(process.cwd(), 'tools', 'etl', '.cache');
const FORCE_REFRESH = process.env['ETL_FORCE_REFRESH'] === '1';

/**
 * Downloads `url` as text, caching the raw response under `tools/etl/.cache/<cacheKey>` so
 * re-running the ETL doesn't hit live NASA/astronomy endpoints unless the cache is missing
 * or `ETL_FORCE_REFRESH=1` is set. Keeps the pipeline idempotent and resilient to rate limits.
 */
export async function fetchTextCached(url: string, cacheKey: string): Promise<string> {
  const cachePath = join(CACHE_DIR, cacheKey);

  if (!FORCE_REFRESH && existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf-8');
  }

  console.log(`  fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();

  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, text, 'utf-8');
  return text;
}

/** Convenience wrapper around {@link fetchTextCached} that parses the cached response as JSON. */
export async function fetchJsonCached<T>(url: string, cacheKey: string): Promise<T> {
  return JSON.parse(await fetchTextCached(url, cacheKey)) as T;
}
