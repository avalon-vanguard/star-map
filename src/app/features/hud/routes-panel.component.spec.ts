import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { StarRecord } from '../../shared/models/star.model';
import { RoutesPanelComponent, routeResultOf } from './routes-panel.component';

const star = (id: number, name: string, x: number, y: number, z: number): StarRecord => ({ id, name, x, y, z, magnitude: 5, spectralType: 'G2V', colorIndex: 0.65 });

// Three hops of 5, 12 and 0.5 pc, on a dog-leg whose ends are 13.0 pc apart.
const sol = star(0, 'Sol', 0, 0, 0);
const near = star(1, 'Near', 3, 4, 0);
const far = star(2, 'Far', 3, 4, 12);
const beyond = star(3, 'Beyond', 3, 4, 12.5);
const byId = new Map([sol, near, far, beyond].map((entry) => [entry.id, entry]));
const answer = (stars: number[], totalPc: number) => ({ route: { stars, totalPc, longestHopPc: 0 }, neededRangePc: null, gaveUp: false, least: true });

describe('routeResultOf', () => {
  it('measures each hop from the star before it, and the ends in a straight line', () => {
    const result = routeResultOf(answer([0, 1, 2, 3], 17.5), byId);
    expect(result.stars.map((step) => step.legPc)).toEqual([0, 5, 12, 0.5]);
    expect(result.directPc).toBeCloseTo(Math.hypot(3, 4, 12.5));
    expect(result.totalPc).toBe(17.5);
  });

  it('has nothing to measure when there is no route', () => {
    expect(routeResultOf({ route: null, neededRangePc: 4.2, gaveUp: false, least: true }, byId)).toEqual({ stars: [], totalPc: 0, directPc: 0, neededRangePc: 4.2, gaveUp: false, least: true });
  });
});

describe('RoutesPanelComponent, the route it lists', () => {
  function render(stars: number[], totalPc: number) {
    const fixture = TestBed.createComponent(RoutesPanelComponent);
    fixture.componentRef.setInput('result', routeResultOf(answer(stars, totalPc), byId));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return {
      summary: text(host.querySelector('[data-testid="route-summary"]')),
      // Span by span: the template's whitespace between them is not kept.
      steps: [...host.querySelectorAll('[data-testid="route-steps"] li')].map((step) => [...step.querySelectorAll('span')].map(text).join(' ')),
      plot: [...host.querySelectorAll('button')].find((button) => text(button) === 'Plot route')!,
    };
  }

  it('prints each hop beside the star it reaches, and how far the ends are apart in a straight line', () => {
    const { summary, steps } = render([0, 1, 2, 3], 17.5);
    expect(steps).toEqual(['1 Sol', '2 Near 5.00 pc', '3 Far 12 pc', '4 Beyond 0.50 pc']);
    expect(summary).toBe('3 jumps · 18 pc · 13 pc direct');
  });

  it('gives one jump no straight line, which its total already is', () => {
    expect(render([0, 1], 5).summary).toBe('1 jump · 5.00 pc');
  });

  it('keeps the plot button on one line beside a summary long enough to wrap', () => {
    // At 390 px, '9 jumps · 18 pc · 7.68 pc direct' squeezed the button to two lines, PLOT over ROUTE.
    const { classList } = render([0, 1, 2, 3], 17.5).plot;
    expect(classList).toContain('shrink-0');
    expect(classList).toContain('whitespace-nowrap');
  });
});
