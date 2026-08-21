import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArticleService } from './article.service';

function summary(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      type: 'standard',
      titles: { normalized: 'Titan (moon)' },
      extract: 'Titan is the largest moon of Saturn.',
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Titan_(moon)' } },
      ...overrides
    }),
    { status: 200 }
  );
}

function missing(): Response {
  return new Response('{}', { status: 404 });
}

/** What Wikipedia sends anyone who asks too quickly. */
function rateLimited(): Response {
  return new Response('You are making too many requests to the API.', { status: 429 });
}

function service(): ArticleService {
  TestBed.resetTestingModule();
  return TestBed.inject(ArticleService);
}

/** The language each call was made in, in order, so the fallback chain can be asserted. */
function languagesAsked(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => new URL(String(call[0])).hostname.split('.')[0]);
}

function titlesAsked(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => decodeURIComponent(String(call[0]).split('/summary/')[1]));
}

describe('ArticleService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { language: 'en-GB' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands back what Wikipedia wrote, and where to go and check it', async () => {
    fetchMock.mockResolvedValue(summary());

    const result = await service().lookup('Titan');

    expect(result).toEqual({
      status: 'found',
      article: {
        title: 'Titan (moon)',
        extract: 'Titan is the largest moon of Saturn.',
        url: 'https://en.wikipedia.org/wiki/Titan_(moon)',
        language: 'en'
      }
    });
  });

  it('asks in the browser’s language first and English second', async () => {
    vi.stubGlobal('navigator', { language: 'fr-FR' });
    fetchMock.mockResolvedValueOnce(missing()).mockResolvedValueOnce(summary());

    const result = await service().lookup('Titan');

    expect(languagesAsked(fetchMock)).toEqual(['fr', 'en']);
    expect(result.status).toBe('found');
  });

  it('asks English only once, when English is what the browser is set to', async () => {
    fetchMock.mockResolvedValue(summary());

    await service().lookup('Titan');

    expect(languagesAsked(fetchMock)).toEqual(['en']);
  });

  it('names the kind when the plain name lands on a list of other things', async () => {
    fetchMock.mockResolvedValueOnce(summary({ type: 'disambiguation' })).mockResolvedValueOnce(summary());

    const result = await service().lookup('Titan', 'moon');

    expect(titlesAsked(fetchMock)).toEqual(['Titan', 'Titan (moon)']);
    expect(result.status).toBe('found');
  });

  it('says there is nothing written rather than pretending, when nothing is', async () => {
    fetchMock.mockResolvedValue(missing());

    expect(await service().lookup('HD 224700', 'planet')).toEqual({ status: 'none' });
  });

  it('tells being unable to ask apart from there being no answer', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));

    expect(await service().lookup('Titan')).toEqual({ status: 'unavailable' });
  });

  it('counts the rate limit as being unable to ask, not as an empty answer', async () => {
    fetchMock.mockResolvedValue(rateLimited());

    expect(await service().lookup('Titan')).toEqual({ status: 'unavailable' });
  });

  it('asks once per body, however many times it is asked for', async () => {
    fetchMock.mockResolvedValue(summary());
    const articles = service();

    await articles.lookup('Titan');
    await articles.lookup('Titan');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remembers that there is nothing, but never that it could not ask', async () => {
    const articles = service();

    fetchMock.mockResolvedValue(missing());
    await articles.lookup('Nowhere');
    await articles.lookup('Nowhere');
    const afterMissing = fetchMock.mock.calls.length;

    fetchMock.mockRejectedValue(new TypeError('offline'));
    await articles.lookup('Elsewhere');
    const afterFirstFailure = fetchMock.mock.calls.length;
    await articles.lookup('Elsewhere');

    // One round of requests for the missing page, then nothing more; but a failure to reach
    // Wikipedia is a fact about this minute, so pressing again is allowed to try again.
    expect(afterMissing).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirstFailure);
  });

  it('treats an article with nothing in it as no article', async () => {
    fetchMock.mockResolvedValue(summary({ extract: '   ' }));

    expect(await service().lookup('Titan')).toEqual({ status: 'none' });
  });

  it('does not send a browser language that is not one', async () => {
    vi.stubGlobal('navigator', { language: 'not a language tag' });
    fetchMock.mockResolvedValue(summary());

    await service().lookup('Titan');

    expect(languagesAsked(fetchMock)).toEqual(['en']);
  });
});
