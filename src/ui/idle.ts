/**
 * Idle tracking: drives the extras fade-in and cursor hiding.
 * `active` means "the user did something in the last N ms".
 */
export function createIdleTracker(idleMs = 5000, onChange?: (active: boolean) => void): { destroy: () => void } {
  let active = true;
  let timer: number | undefined;

  const set = (next: boolean): void => {
    if (next === active) return;
    active = next;
    document.body.dataset.active = String(active);
    onChange?.(active);
  };

  const bump = (): void => {
    set(true);
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => set(false), idleMs);
  };

  const events: Array<keyof WindowEventMap> = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
  for (const ev of events) window.addEventListener(ev, bump, { passive: true });

  document.body.dataset.active = 'true';
  bump();

  return {
    destroy() {
      if (timer !== undefined) window.clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, bump);
    },
  };
}
