import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The route-rail chevron — "back to" when pointing left, "on to" when pointing right. One
 * geometry for every rail button, where each previously inlined its own copy of the svg.
 * Size and colour come from the classes on the host; the svg fills it.
 */
@Component({
  selector: 'app-chevron-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'aria-hidden': 'true' },
  template: `
    <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path [attr.d]="direction() === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'" />
    </svg>
  `
})
export class ChevronIconComponent {
  readonly direction = input<'left' | 'right'>('left');
}
