import { Injectable } from '@angular/core';

/** A Wikipedia summary, as much of it as this app shows. */
export interface Article {
  readonly title: string;
  readonly extract: string;
  /** The article itself, so a reader can go and check. */
  readonly url: string;
  /** Which Wikipedia it came from — `en`, `fr`. Shown, because it is not always the one asked for. */
  readonly language: string;
}

/**
 * Found it, there is no article, or Wikipedia could not be reached. The last two are different
 * facts and the panel says so: "nothing written about this" and "could not ask" are not the
 * same, and only one of them is about the world.
 */
export type ArticleLookup = { readonly status: 'found'; readonly article: Article } | { readonly status: 'none' } | { readonly status: 'unavailable' };

const FALLBACK_LANGUAGE = 'en';

/** Wikipedia's own summary endpoint, which follows redirects — "Proxima Cen b" lands on
 *  "Proxima Centauri b" without this app having to know that. */
function summaryUrl(language: string, title: string): string {
  return `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
}

/** The primary subtag of whatever the browser is set to, or English where there is no browser. */
function browserLanguage(): string {
  // `navigator.language` is optional in the DOM lib and absent in some embedded engines.
  const tag = (typeof navigator === 'undefined' ? '' : navigator.language) ?? '';
  const primary = tag.split('-')[0]?.toLowerCase();
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : FALLBACK_LANGUAGE;
}

/**
 * Wikipedia summaries, fetched only when asked for.
 *
 * The map's own figures are measurements; this is prose someone wrote, from somewhere else. It
 * is never loaded with a body, only when a reader asks for it, and it is always labelled with
 * where it came from and linked back to the article — the same rule the derived surfaces follow,
 * for the same reason.
 *
 * Asked for in the browser's language first and English second, because the catalogue's names
 * are English and the disambiguation this has to work around is an English-Wikipedia habit.
 */
@Injectable({ providedIn: 'root' })
export class ArticleService {
  private readonly cache = new Map<string, ArticleLookup>();

  /**
   * The article for `name`, or why there is none.
   *
   * `qualifier` is what tells "Titan the moon" from "Titan the disambiguation page": Wikipedia
   * parenthesises the kind, and this app happens to know it. Only English gets that treatment —
   * every wiki words its own qualifiers — so a disambiguation anywhere else falls back to
   * English rather than guessing at a translation.
   */
  async lookup(name: string, qualifier?: string): Promise<ArticleLookup> {
    // Separated by an escape rather than a space: a name may contain one, so `("Kepler-22 b",
    // undefined)` and `("Kepler-22", "b")` would otherwise be the same question.
    const key = `${name}\0${qualifier ?? ''}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const language = browserLanguage();
    const attempts: { language: string; title: string }[] = [
      ...(language === FALLBACK_LANGUAGE ? [] : [{ language, title: name }]),
      { language: FALLBACK_LANGUAGE, title: name },
      ...(qualifier ? [{ language: FALLBACK_LANGUAGE, title: `${name} (${qualifier})` }] : [])
    ];

    let reachedWikipedia = false;
    for (const attempt of attempts) {
      const result = await this.fetchSummary(attempt.language, attempt.title);
      if (result === 'unreachable') {
        continue;
      }
      reachedWikipedia = true;
      if (result) {
        const found: ArticleLookup = { status: 'found', article: result };
        this.cache.set(key, found);
        return found;
      }
    }

    // Not cached when Wikipedia could not be reached: that is a fact about the network this
    // minute, and the next press should be allowed to ask again.
    const outcome: ArticleLookup = reachedWikipedia ? { status: 'none' } : { status: 'unavailable' };
    if (reachedWikipedia) {
      this.cache.set(key, outcome);
    }
    return outcome;
  }

  /**
   * One request. `null` where Wikipedia answered but has nothing usable — a missing page, or a
   * disambiguation, which is a list of things this is not. `'unreachable'` where it did not
   * answer at all, including the rate limit it returns to anyone who asks too fast.
   */
  private async fetchSummary(language: string, title: string): Promise<Article | null | 'unreachable'> {
    let response: Response;
    try {
      response = await fetch(summaryUrl(language, title), { headers: { Accept: 'application/json' } });
    } catch {
      return 'unreachable';
    }
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      return 'unreachable';
    }

    try {
      const body = (await response.json()) as {
        type?: string;
        extract?: string;
        titles?: { normalized?: string };
        content_urls?: { desktop?: { page?: string } };
      };
      const extract = body.extract?.trim();
      if (!extract || body.type === 'disambiguation') {
        return null;
      }
      return {
        title: body.titles?.normalized ?? title,
        extract,
        url: body.content_urls?.desktop?.page ?? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        language
      };
    } catch {
      return 'unreachable';
    }
  }
}
