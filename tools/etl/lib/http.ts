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
  const text = await fetchText(url);

  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, text, 'utf-8');
  return text;
}

/**
 * How long to wait before each retry of a failed request. The archives this reads are public
 * services that time out under load — the Gaia TAP has answered a five-row join in two and a
 * half minutes and a full one with a 500 — and a weekly refresh that gives up on the first of
 * those publishes nothing that week.
 */
const RETRY_DELAYS_MS = [30_000, 120_000];

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (!(response instanceof Error) && response.ok) {
      return response.text();
    }
    const reason = response instanceof Error ? response.message : `${response.status} ${response.statusText}`;
    // A 4xx is the request's own fault, and waiting will not change the answer.
    const retryable = response instanceof Error || response.status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
      throw new Error(`Failed to fetch ${url}: ${reason}`);
    }
    console.log(`  ${reason}; trying again in ${RETRY_DELAYS_MS[attempt] / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

/** Convenience wrapper around {@link fetchTextCached} that parses the cached response as JSON. */
export async function fetchJsonCached<T>(url: string, cacheKey: string): Promise<T> {
  return JSON.parse(await fetchTextCached(url, cacheKey)) as T;
}
