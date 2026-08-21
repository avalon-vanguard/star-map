import { expect, test } from '@playwright/test';

/** Every request the article service makes, whichever language it is asking in. */
const isWikipedia = (url: URL): boolean => url.hostname.endsWith('wikipedia.org');

/** The article Wikipedia would send, stubbed: this suite tests the panel, not the encyclopedia. */
const SUMMARY = {
  type: 'standard',
  titles: { normalized: 'Titan (moon)' },
  extract: 'Titan is the largest moon of Saturn.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Titan_(moon)' } }
};

test.describe('About', () => {
  test('fetches an article only when asked, and says where it came from', async ({ page }) => {
    let requests = 0;
    await page.route(isWikipedia, async (route) => {
      requests++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY) });
    });

    await page.goto('/body/titan');
    await expect(page.getByRole('heading', { name: 'Titan' })).toBeVisible({ timeout: 30_000 });

    // Nothing has been fetched yet: the panel is measurements until a reader asks for prose.
    expect(requests).toBe(0);
    await expect(page.getByText('Titan is the largest moon')).toHaveCount(0);

    await page.getByRole('button', { name: 'About', exact: true }).click();

    await expect(page.getByText('Titan is the largest moon of Saturn.')).toBeVisible();
    const credit = page.getByRole('link', { name: /Wikipedia/ });
    await expect(credit).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Titan_(moon)');
    expect(requests).toBeGreaterThan(0);
  });

  test('says nothing is written rather than leaving the press unanswered', async ({ page }) => {
    await page.route(isWikipedia, (route) => route.fulfill({ status: 404, body: '{}' }));

    await page.goto('/body/titan');
    await expect(page.getByRole('heading', { name: 'Titan' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'About', exact: true }).click();

    await expect(page.getByText(/Wikipedia has no article on Titan/)).toBeVisible();
  });

  test('tells being unable to ask apart from there being no answer, and offers to try again', async ({ page }) => {
    await page.route(isWikipedia, (route) => route.abort('failed'));

    await page.goto('/body/titan');
    await expect(page.getByRole('heading', { name: 'Titan' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'About', exact: true }).click();
    await expect(page.getByText(/could not be reached/)).toBeVisible();

    // And the retry actually retries, rather than reading back a remembered failure.
    await page.unroute(isWikipedia);
    await page.route(isWikipedia, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY) }));
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByText('Titan is the largest moon of Saturn.')).toBeVisible();
  });
});
