/**
 * Remembers where the student is in each book.
 *
 * This is what makes "bu konuyu anlat" work without naming a chapter: the coach
 * receives the current page and unit as context. Progress is set when a page is
 * opened in the viewer, and is kept per book so switching subjects does not lose
 * your place.
 */

const KEY = 'soc.progress.v1';

export interface BookProgress {
  page: number;
  unit: string | null;
  /** ms epoch, used to pick the most recently studied book. */
  at: number;
}

type ProgressMap = Record<string, BookProgress>;
type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Notifies on every progress change. The lessons rail subscribes to this
 * instead of polling, which is what let us stop rebuilding its DOM on every
 * clock tick.
 */
export function onProgressChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProgressMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(map: ProgressMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // non-fatal
  }
}

export function recordVisit(bookId: string, page: number, unit: string | null): void {
  const map = read();
  map[bookId] = { page, unit, at: Date.now() };
  write(map);
  for (const listener of listeners) listener();
}

export function allProgress(): ProgressMap {
  return read();
}

/** The book studied most recently, with its current page. */
export function currentFocus(): (BookProgress & { bookId: string }) | null {
  const map = read();
  let best: (BookProgress & { bookId: string }) | null = null;
  for (const [bookId, entry] of Object.entries(map)) {
    if (!best || entry.at > best.at) best = { ...entry, bookId };
  }
  return best;
}
