/// <reference types="node" />
import { describe, expect, it } from 'vitest';

import { tapQueryUrl } from './gaia';

describe('tapQueryUrl', () => {
  it('asks for as many rows as the query holds, which the archive caps at 50 000 otherwise', () => {
    const url = new URL(
      tapQueryUrl('select top 117955 hip from public.hipparcos_newreduction', 117_955),
    );
    expect(url.searchParams.get('MAXREC')).toBe('117955');
    expect(url.searchParams.get('QUERY')).toBe(
      'select top 117955 hip from public.hipparcos_newreduction',
    );
  });
});
