import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { BodyReadouts } from './body-readouts';

/**
 * The Measured/Derived rows and the provenance footnote, shared by the detail page's info panel
 * and the system view's object card. `bodyReadouts` already guarantees the two surfaces agree
 * on the numbers; this guarantees they agree on the pixels — the markup used to be pasted four
 * times across the two templates, which is exactly the drift the shared data model exists to
 * prevent.
 */
@Component({
  selector: 'app-readout-sections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (readouts().measured.length) {
      <p class="type-label border-t border-border/40 px-4 pt-3 pb-1 text-muted">Measured</p>
      <dl class="divide-y divide-border/25">
        @for (row of readouts().measured; track row.label) {
          <div class="flex items-baseline justify-between gap-4 px-4 py-2">
            <dt class="type-label text-muted">{{ row.label }}</dt>
            <dd class="text-sm tabular-nums">{{ row.value }}</dd>
          </div>
        }
      </dl>
    }

    <p class="type-label border-t border-border/40 px-4 pt-3 pb-1 text-muted">Derived</p>
    <dl class="divide-y divide-border/25">
      @for (row of readouts().derived; track row.label) {
        <div class="flex items-baseline justify-between gap-4 px-4 py-2">
          <dt class="type-label text-muted">{{ row.label }}</dt>
          <dd class="text-sm tabular-nums">{{ row.value }}</dd>
        </div>
      }
    </dl>

    <p class="border-t border-border/40 px-4 py-3 text-[10px] leading-relaxed text-muted">{{ readouts().provenance }}</p>
  `
})
export class ReadoutSectionsComponent {
  readonly readouts = input.required<BodyReadouts>();
}
