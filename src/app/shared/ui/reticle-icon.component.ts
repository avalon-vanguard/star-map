import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The circle-and-ticks lock mark the instrument brands itself with. The search field, the
 * nameplate and the viewport reticle all render this one geometry — it used to be drawn three
 * times, once with hand-rescaled coordinates, and the copies could drift apart.
 *
 * Size and colour come from the classes on the host (`h-4 w-4 text-accent/70` etc.); the svg
 * fills it. `vector-effect: non-scaling-stroke` keeps the stroke a screen-pixel width however
 * far the 24-unit viewBox is scaled, so `strokeWidth` means the same at every size.
 */
@Component({
  selector: 'app-reticle-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'aria-hidden': 'true' },
  template: `
    <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" [attr.stroke-width]="strokeWidth()" stroke-linecap="round">
      <circle cx="12" cy="12" r="5" vector-effect="non-scaling-stroke" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" vector-effect="non-scaling-stroke" />
    </svg>
  `
})
export class ReticleIconComponent {
  readonly strokeWidth = input(1.5);
}
