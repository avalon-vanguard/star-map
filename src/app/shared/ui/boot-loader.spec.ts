import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dismissBootLoader, failBootLoader } from './boot-loader';

describe('boot loader', () => {
  beforeEach(() => {
    document.body.insertAdjacentHTML('afterbegin', '<div id="boot-loader" role="status"><div class="boot-orbit"></div><p>Loading the catalogue</p></div>');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById('boot-loader')?.remove();
  });

  it('fades the launch screen out, then removes it', () => {
    dismissBootLoader();

    expect(document.getElementById('boot-loader')?.classList.contains('boot-loader--done')).toBe(true);
    vi.runAllTimers();
    expect(document.getElementById('boot-loader')).toBeNull();
  });

  it('can be dismissed twice, and once it is gone', () => {
    dismissBootLoader();
    dismissBootLoader();
    vi.runAllTimers();

    expect(() => dismissBootLoader()).not.toThrow();
  });

  it('stops and says why when the start fails, instead of spinning on', () => {
    failBootLoader('The catalogue could not be loaded');

    const loader = document.getElementById('boot-loader');
    expect(loader?.classList.contains('boot-loader--failed')).toBe(true);
    expect(loader?.textContent).toContain('The catalogue could not be loaded');
    vi.runAllTimers();
    expect(document.getElementById('boot-loader')).not.toBeNull();
  });
});
