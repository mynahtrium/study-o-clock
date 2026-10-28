import type { PomodoroSettings } from '../ui/storage';

export type Phase = 'focus' | 'shortBreak' | 'longBreak';

export interface PomodoroState {
  phase: Phase;
  /** Epoch ms when the current phase ends. Null when idle/stopped. */
  endsAt: number | null;
  /** Epoch ms when the current phase started. */
  startedAt: number | null;
  /** Total length of the current phase, ms. */
  durationMs: number;
  /** Remaining ms, recomputed from the clock on every read. */
  remainingMs: number;
  running: boolean;
  /** Focus blocks finished since the last long break. */
  completedFocus: number;
  /** Focus blocks finished today. */
  totalFocus: number;
}

const KEY = 'soc.pomodoro.v1';

interface Persisted {
  phase: Phase;
  endsAt: number | null;
  startedAt: number | null;
  durationMs: number;
  completedFocus: number;
  totalFocus: number;
  /** Local date the totals belong to, so they reset at midnight. */
  day: string;
}

type Listener = (state: PomodoroState) => void;

function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const PHASE_LABEL: Record<Phase, string> = {
  focus: 'odak',
  shortBreak: 'kısa mola',
  longBreak: 'uzun mola',
};

function durationFor(phase: Phase, settings: PomodoroSettings): number {
  const minutes =
    phase === 'focus'
      ? settings.workMin
      : phase === 'shortBreak'
        ? settings.shortBreakMin
        : settings.longBreakMin;
  // Guard against a corrupted or zeroed setting producing a 0ms phase that
  // flips instantly in a loop.
  return Math.max(1, minutes) * 60_000;
}

/**
 * Pomodoro timer.
 *
 * Time is stored as a deadline, never as a decrementing counter. A counter
 * drifts whenever the tab is throttled or the machine sleeps; a deadline read
 * against Date.now() is exactly right whenever it is asked. It also means a
 * refresh resumes mid-session instead of losing the block.
 */
export class Pomodoro {
  private settings: PomodoroSettings;
  private phase: Phase = 'focus';
  private endsAt: number | null = null;
  private startedAt: number | null = null;
  private durationMs: number;
  private completedFocus = 0;
  private totalFocus = 0;
  private day = todayKey();
  private listeners = new Set<Listener>();
  private onPhaseEnd: ((finished: Phase, next: Phase) => void) | null = null;

  constructor(settings: PomodoroSettings) {
    this.settings = settings;
    this.durationMs = durationFor('focus', settings);
    this.restore();
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Persisted;

      this.phase = saved.phase ?? 'focus';
      this.endsAt = saved.endsAt ?? null;
      this.startedAt = saved.startedAt ?? null;
      this.durationMs = saved.durationMs ?? durationFor(this.phase, this.settings);
      this.completedFocus = saved.completedFocus ?? 0;
      this.day = saved.day ?? todayKey();
      this.totalFocus = saved.totalFocus ?? 0;

      // Totals are per-day.
      if (this.day !== todayKey()) {
        this.totalFocus = 0;
        this.completedFocus = 0;
        this.day = todayKey();
      }
    } catch {
      // Corrupt state: fall back to a fresh focus phase.
    }
  }

  private persist(): void {
    try {
      const data: Persisted = {
        phase: this.phase,
        endsAt: this.endsAt,
        startedAt: this.startedAt,
        durationMs: this.durationMs,
        completedFocus: this.completedFocus,
        totalFocus: this.totalFocus,
        day: this.day,
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // non-fatal
    }
  }

  private emit(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  state(now = Date.now()): PomodoroState {
    // Roll over if the deadline has passed since the last tick, so a caller
    // that simply reads state never sees a negative remaining time.
    this.checkExpiry(now);

    const remainingMs = this.endsAt === null ? this.durationMs : Math.max(0, this.endsAt - now);
    return {
      phase: this.phase,
      endsAt: this.endsAt,
      startedAt: this.startedAt,
      durationMs: this.durationMs,
      remainingMs,
      running: this.endsAt !== null,
      completedFocus: this.completedFocus,
      totalFocus: this.totalFocus,
    };
  }

  /** True when the countdown elapsed; advances the phase exactly once. */
  private checkExpiry(now: number): void {
    if (this.endsAt === null || now < this.endsAt) return;

    const finished = this.phase;
    if (finished === 'focus') {
      this.completedFocus += 1;
      this.totalFocus += 1;
    }

    const next = this.nextPhase(finished);
    this.onPhaseEnd?.(finished, next);

    this.phase = next;
    this.durationMs = durationFor(next, this.settings);
    // Auto-advance immediately: stopping dead after a focus block means the
    // user has to notice and restart, which is the thing Pomodoro exists to
    // remove.
    this.startedAt = now;
    this.endsAt = now + this.durationMs;
    this.day = todayKey();
    this.persist();
    this.emit();
  }

  private nextPhase(finished: Phase): Phase {
    if (finished !== 'focus') return 'focus';
    const every = Math.max(1, this.settings.longBreakEvery);
    return this.completedFocus > 0 && this.completedFocus % every === 0 ? 'longBreak' : 'shortBreak';
  }

  start(): void {
    const now = Date.now();
    if (this.endsAt !== null && this.endsAt > now) return;

    // Resuming must continue from the frozen remainder. Recomputing from the
    // phase length here would silently restart the block at 25:00.
    const resuming = this.startedAt !== null && this.durationMs > 0;
    if (!resuming) this.durationMs = durationFor(this.phase, this.settings);

    this.startedAt = now;
    this.endsAt = now + this.durationMs;
    this.persist();
    this.emit();
  }

  pause(): void {
    if (this.endsAt === null) return;
    // Freeze the remaining time into durationMs so resume() has something to
    // add the new deadline to.
    this.durationMs = Math.max(0, this.endsAt - Date.now());
    this.endsAt = null;
    this.persist();
    this.emit();
  }

  toggle(): void {
    if (this.endsAt !== null) this.pause();
    else this.start();
  }

  reset(): void {
    this.phase = 'focus';
    this.endsAt = null;
    this.startedAt = null;
    this.durationMs = durationFor('focus', this.settings);
    this.persist();
    this.emit();
  }

  /** Jumps to the next phase without counting the current one as completed. */
  skip(): void {
    const next = this.nextPhase(this.phase);
    this.phase = next;
    this.durationMs = durationFor(next, this.settings);
    this.endsAt = null;
    this.startedAt = null;
    this.persist();
    this.emit();
  }

  setSettings(settings: PomodoroSettings): void {
    this.settings = settings;
    // A running phase keeps its deadline; an idle one picks up the new length.
    if (this.endsAt === null) {
      this.durationMs = durationFor(this.phase, settings);
      this.emit();
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  onPhaseComplete(cb: (finished: Phase, next: Phase) => void): void {
    this.onPhaseEnd = cb;
  }
}

/** mm:ss, or h:mm:ss for very long blocks. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * A short two-tone chime via WebAudio, so no audio asset ships with the app.
 * Browsers block audio before a user gesture, so the AudioContext is created
 * lazily here — by the time a phase ends the user has almost certainly clicked
 * or typed at least once.
 */
export function playChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;

    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const start = now + i * 0.18;
      // Soft attack and a long decay: a bell, not a beep.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);

      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 1);
    }

    window.setTimeout(() => void ctx.close(), 1600);
  } catch {
    // Audio is a nicety; never let it break a phase transition.
  }
}
