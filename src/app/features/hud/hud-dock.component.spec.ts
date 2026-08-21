import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataLoaderService } from '../../core/data/data-loader.service';
import { BookmarksStore } from '../../shared/state/bookmarks.store';
import { DEFAULT_HUD_DISPLAY, HudDisplay, HudDockComponent } from './hud-dock.component';

class EmptyDataLoaderService {
  loadStars() {
    return Promise.resolve({ stars: [], positions: new Float32Array(0) });
  }
  loadBodies() {
    return Promise.resolve([]);
  }
  loadExoplanets() {
    return Promise.resolve([]);
  }
}

describe('HudDockComponent', () => {
  let fixture: ComponentFixture<HudDockComponent>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function tabNames(): string[] {
    return [...host().querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim() ?? '');
  }

  function tab(name: string): HTMLButtonElement {
    const found = [...host().querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.trim() === name);
    if (!found) {
      throw new Error(`no "${name}" tab`);
    }
    return found;
  }

  function setReadout(): void {
    fixture.componentRef.setInput('eyebrow', 'Galactic Scale');
    fixture.componentRef.setInput('title', 'Milky Way');
    fixture.componentRef.setInput('subtitle', 'Barred spiral');
    fixture.componentRef.setInput('readouts', [{ label: 'Arms', value: '5' }, { label: 'Luminosity', value: '1 L☉', derived: true }]);
    fixture.componentRef.setInput('note', 'Illustrative model.');
    fixture.componentRef.setInput('range', '21.5 kpc');
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [HudDockComponent],
      providers: [
        { provide: DataLoaderService, useClass: EmptyDataLoaderService },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(HudDockComponent);
  });

  it('offers the search and what has been kept, when it has nothing else', () => {
    // Bookmarks are always offered: it is the only place that says the map can keep anything.
    fixture.detectChanges();
    expect(tabNames()).toEqual(['Search', 'Bookmarks']);
    expect(host().querySelector('[role="tabpanel"]')).toBeNull();
  });

  it('grows a tab per thing it has been given', () => {
    setReadout();
    fixture.componentRef.setInput('display', DEFAULT_HUD_DISPLAY);
    fixture.detectChanges();
    expect(tabNames()).toEqual(['Search', 'Readout', 'Bookmarks', 'Display']);

    fixture.componentRef.setInput('routing', true);
    fixture.detectChanges();
    expect(tabNames()).toEqual(['Search', 'Readout', 'Routes', 'Bookmarks', 'Display']);
  });

  it('opens the default tab on mount and renders the readout from its inputs', () => {
    setReadout();
    fixture.componentRef.setInput('defaultTab', 'readout');
    fixture.detectChanges();

    expect(tab('Readout').getAttribute('aria-selected')).toBe('true');
    const text = host().textContent ?? '';
    for (const expected of ['Galactic Scale', 'Milky Way', 'Barred spiral', 'Arms', '5', 'Illustrative model.', 'Derived, not catalogued', '21.5 kpc']) {
      expect(text).toContain(expected);
    }
    expect(host().querySelector('[data-testid="hud-title"]')?.textContent?.trim()).toBe('Milky Way');
  });

  it('leaves out the optional lines it was given nothing for', () => {
    fixture.componentRef.setInput('title', 'Local Stars');
    fixture.componentRef.setInput('defaultTab', 'readout');
    fixture.detectChanges();
    expect(host().querySelector('dl')).toBeNull();
    expect(host().textContent).not.toContain('undefined');
  });

  it('keeps the range on the strip whichever panel is open, and hides it when there is none', () => {
    setReadout();
    fixture.componentRef.setInput('defaultTab', 'search');
    fixture.detectChanges();
    expect(host().textContent).toContain('21.5 kpc');

    fixture.componentRef.setInput('range', '');
    fixture.detectChanges();
    expect(host().textContent).not.toContain('Range');
  });

  it('toggles a tab closed when it is clicked while open', () => {
    setReadout();
    fixture.componentRef.setInput('defaultTab', 'readout');
    fixture.detectChanges();

    tab('Readout').click();
    fixture.detectChanges();
    expect(host().querySelector('[role="tabpanel"]')).toBeNull();
    expect(tab('Readout').getAttribute('aria-selected')).toBe('false');

    tab('Search').click();
    fixture.detectChanges();
    expect(host().querySelector('input[type="text"]')).not.toBeNull();
  });

  it('emits the flipped layer and nothing else', () => {
    fixture.componentRef.setInput('display', DEFAULT_HUD_DISPLAY);
    fixture.componentRef.setInput('defaultTab', 'display');
    fixture.detectChanges();
    const emitted: HudDisplay[] = [];
    fixture.componentInstance.displayChange.subscribe((display) => emitted.push(display));

    const orbits = [...host().querySelectorAll<HTMLButtonElement>('[aria-pressed]')].find((b) => b.textContent?.includes('Orbits'));
    orbits?.click();

    expect(emitted).toEqual([{ ...DEFAULT_HUD_DISPLAY, orbits: false }]);
  });

  it('reflects the layer state it is given as pressed buttons', () => {
    fixture.componentRef.setInput('display', { ...DEFAULT_HUD_DISPLAY, grid: false });
    fixture.componentRef.setInput('defaultTab', 'display');
    fixture.detectChanges();
    const pressed = [...host().querySelectorAll('[aria-pressed]')].map((b) => `${b.textContent?.trim()}=${b.getAttribute('aria-pressed')}`);
    expect(pressed).toEqual(['Labels=true', 'Orbits=true', 'Grid=false', 'Deep sky=true', 'Sky=true', 'Systems=true', 'Jump links=false']);
  });

  it('says how to keep a place, rather than showing an empty list', () => {
    fixture.componentRef.setInput('defaultTab', 'bookmarks');
    fixture.detectChanges();

    expect(host().querySelector('#dock-panel-bookmarks ul')).toBeNull();
    expect(host().textContent).toContain('Nothing kept yet');
  });

  it('lists what has been kept, newest first, and says which kind each is', () => {
    const bookmarks = TestBed.inject(BookmarksStore);
    bookmarks.toggle({ kind: 'star', id: 7, name: 'Sirius' });
    bookmarks.toggle({ kind: 'body', id: 'earth', name: 'Earth' });
    fixture.componentRef.setInput('defaultTab', 'bookmarks');
    fixture.detectChanges();

    const rows = [...host().querySelectorAll('#dock-panel-bookmarks li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('Earth');
    expect(rows[0]).toContain('Body');
    expect(rows[1]).toContain('Sirius');
    expect(rows[1]).toContain('System');
  });

  it('hands back the place that was chosen, whole', () => {
    const bookmarks = TestBed.inject(BookmarksStore);
    bookmarks.toggle({ kind: 'star', id: 7, name: 'Sirius' });
    fixture.componentRef.setInput('defaultTab', 'bookmarks');
    fixture.detectChanges();
    const chosen: unknown[] = [];
    fixture.componentInstance.bookmarkChosen.subscribe((bookmark) => chosen.push(bookmark));

    host().querySelector<HTMLButtonElement>('#dock-panel-bookmarks li button')?.click();

    expect(chosen).toEqual([{ kind: 'star', id: 7, name: 'Sirius' }]);
  });

  it('forgets one without disturbing the rest', () => {
    const bookmarks = TestBed.inject(BookmarksStore);
    bookmarks.toggle({ kind: 'star', id: 7, name: 'Sirius' });
    bookmarks.toggle({ kind: 'body', id: 'earth', name: 'Earth' });
    fixture.componentRef.setInput('defaultTab', 'bookmarks');
    fixture.detectChanges();

    host().querySelector<HTMLButtonElement>('[aria-label="Forget Earth"]')?.click();
    fixture.detectChanges();

    expect(bookmarks.bookmarks().map((bookmark) => bookmark.name)).toEqual(['Sirius']);
    expect(host().textContent).not.toContain('Earth');
  });

  it('keeps the star the readout is about, and says so on the control', () => {
    const bookmarks = TestBed.inject(BookmarksStore);
    setReadout();
    fixture.componentRef.setInput('title', 'Sirius');
    fixture.componentRef.setInput('keepableStarId', 7);
    fixture.componentRef.setInput('defaultTab', 'readout');
    fixture.detectChanges();

    const keep = host().querySelector<HTMLButtonElement>('[aria-label="Keep Sirius"]');
    expect(keep?.getAttribute('aria-pressed')).toBe('false');
    keep?.click();
    fixture.detectChanges();

    expect(bookmarks.has('star', 7)).toBe(true);
    expect(host().querySelector('[aria-label="Forget Sirius"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the one system whose catalogue id is zero, which truthiness would have lost', () => {
    // The Sun is star 0. A `@if (id; as ...)` reads that as "no star" and hides the control.
    const bookmarks = TestBed.inject(BookmarksStore);
    setReadout();
    fixture.componentRef.setInput('title', 'Sol');
    fixture.componentRef.setInput('keepableStarId', 0);
    fixture.componentRef.setInput('defaultTab', 'readout');
    fixture.detectChanges();

    host().querySelector<HTMLButtonElement>('[aria-label="Keep Sol"]')?.click();
    fixture.detectChanges();

    expect(bookmarks.has('star', 0)).toBe(true);
  });

  it('offers nothing to keep where the readout is a scale rather than a place', () => {
    setReadout();
    fixture.componentRef.setInput('defaultTab', 'readout');
    fixture.detectChanges();

    expect(host().querySelector('[aria-label^="Keep"]')).toBeNull();
  });

  it('opens the search on "/" from anywhere but a text field', () => {
    setReadout();
    fixture.componentRef.setInput('defaultTab', 'readout');
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    fixture.detectChanges();
    expect(tab('Search').getAttribute('aria-selected')).toBe('true');
  });

  it('hands the panel back to the readout once a result is picked', () => {
    setReadout();
    fixture.componentRef.setInput('defaultTab', 'search');
    fixture.detectChanges();

    fixture.componentInstance.onPicked();
    fixture.detectChanges();
    expect(tab('Readout').getAttribute('aria-selected')).toBe('true');
  });
});
