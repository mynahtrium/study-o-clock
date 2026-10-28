const KEY = 'soc.streak.v1';

interface StreakState {
  /** ISO date (YYYY-MM-DD) of the most recent counted day. */
  last: string;
  /** Consecutive-day count. */
  days: number;
}

function todayKey(now = new Date()): string {
  // Local date, not UTC — a streak is a human day, not a UTC day.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86400000);
}

function read(): StreakState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StreakState>;
    if (typeof parsed.last !== 'string' || typeof parsed.days !== 'number') return null;
    return { last: parsed.last, days: parsed.days };
  } catch {
    return null;
  }
}

/**
 * Day-based streak. Visiting on a consecutive day increments; skipping a day
 * resets to 1. Revisiting on the same day is a no-op, so refreshing the page
 * does not inflate the count.
 */
export function touchStreak(now = new Date()): number {
  const today = todayKey(now);
  const state = read();

  let next: StreakState;
  if (!state) {
    next = { last: today, days: 1 };
  } else if (state.last === today) {
    return state.days;
  } else {
    const gap = dayDiff(state.last, today);
    next = { last: today, days: gap === 1 ? state.days + 1 : 1 };
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked; the clock still works, just no persistence.
  }
  return next.days;
}
