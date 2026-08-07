import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { BodyDetailViewModel } from '../body-detail/body-detail.model';
import { PlanetAppearance } from '../../shared/astro/planet-appearance';
import { SystemObjectCardComponent } from './system-object-card.component';

const appearance = (overrides: Partial<PlanetAppearance> = {}): PlanetAppearance =>
  ({
    planetClass: 'temperate',
    palette: { structure: 'mottled' },
    equilibriumTemperatureK: 255,
    bulkDensityGramsPerCm3: 5.51,
    polarCapExtentDeg: 25,
    seed: 1,
    ...overrides,
  }) as PlanetAppearance;

const earth: BodyDetailViewModel = {
  id: 'earth',
  name: 'Earth',
  kind: 'planet',
  hostStarName: 'Sol',
  radiusKm: 6371,
  orbit: { semiMajorAxisAu: 1, eccentricity: 0.0167 },
  appearance: appearance(),
  hasPhotography: true,
  orbitalPeriodDays: 365.25,
  orbitalPeriodSource: 'derived',
};

describe('SystemObjectCardComponent', () => {
  let fixture: ComponentFixture<SystemObjectCardComponent>;

  function render(body: BodyDetailViewModel): HTMLElement {
    fixture.componentRef.setInput('body', body);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** The label/value pairs under one of the two headings, in order. */
  function block(host: HTMLElement, heading: 'Measured' | 'Derived'): string[] {
    const headings = [...host.querySelectorAll('p')].filter((p) => p.textContent?.trim() === heading);
    const list = headings[0]?.nextElementSibling;
    return list ? [...list.querySelectorAll('dt')].map((dt) => dt.textContent?.trim() ?? '') : [];
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SystemObjectCardComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SystemObjectCardComponent);
  });

  it('files a period computed from the semi-major axis under Derived', () => {
    const host = render(earth);
    expect(block(host, 'Derived')).toContain('Period');
    expect(block(host, 'Measured')).not.toContain('Period');
  });

  it('files a published period under Measured instead', () => {
    // Same field, opposite heading — the provenance flag is what decides, not the field's name.
    const host = render({ ...earth, orbitalPeriodSource: 'measured' });
    expect(block(host, 'Measured')).toContain('Period');
    expect(block(host, 'Derived')).not.toContain('Period');
  });

  it('omits the period entirely when there is none to show', () => {
    const host = render({ ...earth, orbitalPeriodDays: undefined, orbitalPeriodSource: undefined });
    expect(block(host, 'Measured')).not.toContain('Period');
    expect(block(host, 'Derived')).not.toContain('Period');
  });

  it('never shows an empty Measured block', () => {
    const bare: BodyDetailViewModel = {
      ...earth,
      radiusKm: undefined,
      orbit: {},
      orbitalPeriodDays: undefined,
      orbitalPeriodSource: undefined,
      discoveryYear: undefined,
    };
    expect(render(bare).textContent).not.toContain('Measured');
  });

  it('says a photographed surface is a photograph', () => {
    expect(render(earth).textContent).toContain('photography');
  });

  it('says an illustrated surface is not an observation', () => {
    expect(render({ ...earth, hasPhotography: false }).textContent).toContain('Not an observation');
  });

  it('explains a missing temperature rather than leaving the row blank', () => {
    const host = render({
      ...earth,
      hasPhotography: false,
      appearance: appearance({ equilibriumTemperatureK: null }),
    });
    expect(block(host, 'Derived')).not.toContain('Equilibrium temp.');
    expect(host.textContent).toContain('host star is not in the catalogue');
  });

  it('emits rather than navigating, so the scene decides what selection means', () => {
    const host = render(earth);
    let opened = 0;
    let dismissed = 0;
    fixture.componentInstance.openRequested.subscribe(() => (opened += 1));
    fixture.componentInstance.dismissed.subscribe(() => (dismissed += 1));

    host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Full view'))!.click();

    expect({ opened, dismissed }).toEqual({ opened: 1, dismissed: 1 });
  });
});
