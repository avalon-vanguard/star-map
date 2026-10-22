/** The launch screen `index.html` paints before the app boots. */
const BOOT_LOADER_ID = 'boot-loader';

/** Matches the fade in `index.html`, with a margin; a timer rather than `transitionend`, which never fires under reduced motion. */
const FADE_MS = 450;

/** Fades the launch screen out and removes it. Safe to call more than once, or when it is gone. */
export function dismissBootLoader(doc: Document = document): void {
  const loader = doc.getElementById(BOOT_LOADER_ID);
  if (!loader || loader.classList.contains('boot-loader--done')) {
    return;
  }
  loader.classList.add('boot-loader--done');
  setTimeout(() => loader.remove(), FADE_MS);
}

/** Stops the animation and says why, so a failed start does not spin forever. */
export function failBootLoader(message: string, doc: Document = document): void {
  const loader = doc.getElementById(BOOT_LOADER_ID);
  if (!loader) {
    return;
  }
  loader.classList.add('boot-loader--failed');
  const text = loader.querySelector('p');
  if (text) {
    text.textContent = message;
  }
}
