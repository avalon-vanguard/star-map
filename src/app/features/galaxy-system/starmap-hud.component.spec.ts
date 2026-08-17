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

  it('renders the readout panel from its inputs', () => {
    fixture.componentRef.setInput('level', 'galactic');
    fixture.componentRef.setInput('eyebrow', 'Galactic Scale');
    fixture.componentRef.setInput('title', 'Milky Way');
    fixture.componentRef.setInput('subtitle', 'Barred spiral');
    fixture.componentRef.setInput('readouts', [{ label: 'Arms', value: '5' }]);
    fixture.componentRef.setInput('note', 'Illustrative model.');
    fixture.componentRef.setInput('range', '21.5 kpc');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    for (const expected of ['Galactic Scale', 'Milky Way', 'Barred spiral', 'Arms', '5', 'Illustrative model.', '21.5 kpc']) {
      expect(text).toContain(expected);
    }
  });

  it('leaves out the optional lines it was given nothing for', () => {
    const host = render('galaxy');
    expect(host.querySelector('dl')).toBeNull();
    expect(host.textContent).not.toContain('undefined');
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
});
