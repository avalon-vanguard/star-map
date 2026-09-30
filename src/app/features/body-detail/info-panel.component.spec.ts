import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ArticleService } from '../../core/data/article.service';
import { PlanetAppearance } from '../../shared/astro/planet-appearance';
import { BodyDetailViewModel } from './body-detail.model';
import { InfoPanelComponent } from './info-panel.component';

const planet: BodyDetailViewModel = {
  id: '2MASS J21252752-8138278 b',
  name: '2MASS J21252752-8138278 b',
  kind: 'exoplanet',
  hostStarName: '2MASS J21252752-8138278',
  orbit: { semiMajorAxisAu: 7493 },
  appearance: { planetClass: 'gasGiant', palette: { structure: 'banded' }, equilibriumTemperatureK: 2.74, bulkDensityGramsPerCm3: null, polarCapExtentDeg: 0, seed: 1 } as unknown as PlanetAppearance,
  hasPhotography: false
};

describe('InfoPanelComponent', () => {
  let fixture: ComponentFixture<InfoPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InfoPanelComponent],
      providers: [provideRouter([]), { provide: ArticleService, useValue: { lookup: async () => ({ status: 'none' }) } }]
    }).compileComponents();
    fixture = TestBed.createComponent(InfoPanelComponent);
    fixture.componentRef.setInput('body', planet);
    fixture.detectChanges();
  });

  it('wraps a long designation rather than cutting off the digits that tell it apart', () => {
    const host = fixture.nativeElement as HTMLElement;
    const heading = host.querySelector('h1')!;
    const eyebrow = heading.nextElementSibling!;
    expect(heading.textContent?.trim()).toBe('2MASS J21252752-8138278 b');
    for (const line of [heading, eyebrow]) {
      expect(line.classList).not.toContain('truncate');
      expect(line.classList).toContain('wrap-break-word');
    }
  });
});
