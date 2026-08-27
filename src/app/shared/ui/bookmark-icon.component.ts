import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The mark on a place worth coming back to. Hollow when it is not kept, filled when it is —
 * the same two states as the Display panel's layer ticks, which is where the eye has already
 * learned what a filled mark means here.
 *
 * Size and colour come from the classes on the host; the svg fills it.
 */
@Component({
  selector: 'app-bookmark-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'aria-hidden': 'true' },
  template: `
    <svg class="h-full w-full" viewBox="0 0 24 24" [attr.fill]="kept() ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
      <path d="M7 4h10v16l-5-4-5 4z" />
    </svg>
  `
})
export class BookmarkIconComponent {
  readonly kept = input(false);
}
