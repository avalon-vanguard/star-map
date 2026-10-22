import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ViewLevel } from '../../shared/state/navigation.store';
import { StarmapHudComponent } from './starmap-hud.component';

describe('StarmapHudComponent', () => {
  let fixture: ComponentFixture<StarmapHudComponent>;

  function render(level: ViewLevel): HTMLElement {
    fixture.componentRef.setInput('level', level);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function buttonLabels(host: HTMLElement): string[] {
    return [...host.querySelectorAll('nav button')].map((button) => button.textContent?.trim() ?? '');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StarmapHudComponent] }).compileComponents();
    fixture = TestBed.createComponent(StarmapHudComponent);
  });

  it('offers the way back down from the outermost scale', () => {
    // The two outer scales share one space, so the ladder goes both ways between them.
    expect(buttonLabels(render('galactic'))).toEqual(['Solar Neighbourhood']);
  });

  it('offers the Milky Way from the solar neighbourhood', () => {
    expect(buttonLabels(render('galaxy'))).toEqual(['Milky Way']);
  });

  it('offers both wider scales from inside a system', () => {
    expect(buttonLabels(render('system'))).toEqual(['Milky Way', 'Solar Neighbourhood']);
  });

  it('never offers the system scale, which needs a star picked first', () => {
    for (const level of ['galactic', 'galaxy', 'system'] as const) {
      expect(buttonLabels(render(level))).not.toContain('System');
    }
  });

  it('marks the current scale rather than making it a button that goes nowhere', () => {
    // Load-bearing beyond tidiness: this marker is how the end-to-end tests tell which scale the
    // view has actually settled at.
    const host = render('galaxy');
    const current = host.querySelector('[data-testid="hud-current-level"]');
    expect(current?.textContent?.trim()).toBe('Solar Neighbourhood');
    expect(current?.getAttribute('aria-current')).toBe('step');
    expect(buttonLabels(host)).not.toContain('Solar Neighbourhood');
  });

  it('marks exactly one scale as current', () => {
    for (const level of ['galactic', 'galaxy', 'system'] as const) {
      expect(render(level).querySelectorAll('[data-testid="hud-current-level"]')).toHaveLength(1);
    }
  });

  it('emits the scale that was asked for', () => {
    const host = render('system');
    const emitted: ViewLevel[] = [];
    fixture.componentInstance.levelSelected.subscribe((level) => emitted.push(level));

    host.querySelectorAll('nav button').forEach((button) => (button as HTMLButtonElement).click());

    expect(emitted).toEqual(['galactic', 'galaxy']);
  });

  it('keeps the rail on one line on a phone, padding each step 8 px a side below sm and 16 from it', () => {
    // jsdom lays nothing out: the classes are what decide it. Measured in Chromium at 16 px a side,
    // the rail was 365 px wide, and on a 360 px phone it broke onto a second line, into the scale
    // bar under it. At 8 px a side it is 317 px on one line.
    const steps = [...render('system').querySelectorAll('nav > *')];

    expect(steps).toHaveLength(3);
    for (const step of steps) {
      expect([...step.classList]).toEqual(expect.arrayContaining(['px-2', 'sm:px-4']));
    }
  });

  it('names what the view is holding on the banner across the top', () => {
    fixture.componentRef.setInput('level', 'system');
    fixture.componentRef.setInput('title', 'Sol');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="hud-banner"]')?.textContent?.trim()).toBe('Sol');
  });

  it('shows no banner when the view is holding nothing', () => {
    // An empty nameplate is worse than none: it reads as a selection that failed to resolve.
    expect(render('galaxy').querySelector('[data-testid="hud-banner"]')).toBeNull();
  });

  it('shows the scale it is given, as a bar of that width', () => {
    fixture.componentRef.setInput('scale', { label: '10 pc', widthPx: 100 });
    const bar = render('galaxy').querySelector<HTMLElement>('[data-testid="hud-scale"]');

    expect(bar?.getAttribute('aria-label')).toBe('Scale: 10 pc');
    expect(bar?.textContent?.trim()).toBe('10 pc');
    expect(bar?.querySelector<HTMLElement>('span:last-child')?.style.width).toBe('100px');
  });

  it('shows no scale bar while there is no scale to show', () => {
    expect(render('galaxy').querySelector('[data-testid="hud-scale"]')).toBeNull();
  });
});
