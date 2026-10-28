export type TickHandler = (now: Date) => void;

/**
 * Drift-free second scheduler.
 *
 * `setInterval(1000)` accumulates drift and, worse, silently desynchronises in
 * background tabs where timers are throttled. This computes the delay to the
 * next wall-clock second boundary on every tick, and re-syncs on visibility
 * change, so the displayed second is always the real second.
 */
export function createTicker(onTick: TickHandler): { stop: () => void } {
  let timer: number | undefined;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    const now = Date.now();
    const delay = 1000 - (now % 1000);
    timer = window.setTimeout(() => {
      onTick(new Date());
      schedule();
    }, delay);
  };

  const resync = (): void => {
    if (stopped) return;
    if (timer !== undefined) window.clearTimeout(timer);
    onTick(new Date());
    schedule();
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') resync();
  };

  document.addEventListener('visibilitychange', onVisibility);
  onTick(new Date());
  schedule();

  return {
    stop() {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
