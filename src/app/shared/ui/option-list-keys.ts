/**
 * The keys of a text field that offers a list of matches below or above it (`role="combobox"` over
 * a `role="listbox"` of option buttons), shared by the search and the two Routes fields.
 *
 * Real focus moves onto the option buttons rather than an `aria-activedescendant` pointer: the
 * buttons already carry their focus ring, Enter on a focused one is already its click, and no
 * option needs an id.
 */

/** ArrowDown in the field: onto the first option, when the field's list is showing. */
export function focusFirstOption(event: Event): void {
  const field = event.target as HTMLElement;
  const list = field.ownerDocument.getElementById(field.getAttribute('aria-controls') ?? '');
  const first = list?.querySelector<HTMLElement>('[role="option"]');
  if (first) {
    // Kept from moving the caret to the end of the text as well.
    event.preventDefault();
    first.focus();
  }
}

/**
 * Inside the list: Down and Up walk the options, Up from the first one and Escape go back to the
 * field. The last option holds on Down, as the end of a list does.
 */
export function onOptionListKeydown(event: KeyboardEvent, field: HTMLInputElement): void {
  const item = (event.target as HTMLElement).closest('li');
  let next: HTMLElement | null | undefined;
  if (event.key === 'ArrowDown') {
    next = item?.nextElementSibling?.querySelector('button');
  } else if (event.key === 'ArrowUp') {
    next = item?.previousElementSibling?.querySelector('button') ?? field;
  } else if (event.key === 'Escape') {
    next = field;
  } else {
    return;
  }
  // Kept from scrolling the list as well, and from reaching the dock, whose Escape folds the panel.
  event.preventDefault();
  event.stopPropagation();
  next?.focus();
}
