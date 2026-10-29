/// <reference types="node" />
import { describe, expect, it, vi } from 'vitest';

import { fetchSimbadCsv } from './simbad';

describe('fetchSimbadCsv', () => {
  it('asks the Harvard mirror, under the same cache key, when Strasbourg does not answer', async () => {
    const csv = 'hd,gaia\n"HD  45951","Gaia DR3 3369454521490604416"\n';
    const fetchText = vi
      .fn<(url: string, cacheKey: string) => Promise<string>>()
      .mockRejectedValueOnce(
        new Error('Failed to fetch https://simbad.cds.unistra.fr/…: fetch failed'),
      )
      .mockResolvedValueOnce(csv);

    expect(
      await fetchSimbadCsv(
        "select id from ident where id = 'HD 45951'",
        'simbad-hd-gaia',
        fetchText,
      ),
    ).toBe(csv);

    const [[strasbourg, strasbourgKey], [mirror, mirrorKey]] = fetchText.mock.calls;
    expect(new URL(strasbourg).host).toBe('simbad.cds.unistra.fr');
    expect(new URL(mirror).host).toBe('simbad.harvard.edu');
    expect(new URL(mirror).search).toBe(new URL(strasbourg).search);
    expect(mirrorKey).toBe(strasbourgKey);
  });

  it('asks only Strasbourg when it answers', async () => {
    const fetchText = vi
      .fn<(url: string, cacheKey: string) => Promise<string>>()
      .mockResolvedValue('hd,gaia\n');

    await fetchSimbadCsv("select id from ident where id = 'HD 45951'", 'simbad-hd-gaia', fetchText);

    expect(fetchText).toHaveBeenCalledOnce();
    expect(new URL(fetchText.mock.calls[0][0]).host).toBe('simbad.cds.unistra.fr');
  });
});
