import type { StaticThemeName, ThemeMode } from '../theme/palettes';

export interface PomodoroSettings {
  workMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  /** A long break replaces a short one every Nth focus block. */
  longBreakEvery: number;
  sound: boolean;
}

export interface Settings {
  use24h: boolean;
  showSeconds: boolean;
  showTimezone: boolean;
  showSun: boolean;
  showStreak: boolean;
  /** null = not configured; sun features stay off rather than guessing. */
  latitude: number | null;
  longitude: number | null;
  apiKey: string;
  model: string;
  themeMode: ThemeMode;
  staticTheme: StaticThemeName;
  pomodoro: PomodoroSettings;
}

const KEY = 'soc.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  use24h: true,
  showSeconds: true,
  showTimezone: true,
  showSun: false,
  showStreak: true,
  latitude: null,
  longitude: null,
  apiKey: '',
  model: '',
  themeMode: 'static',
  staticTheme: 'obsidian',
  pomodoro: {
    workMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    longBreakEvery: 4,
    sound: true,
  },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings> & { pomodoro?: Partial<PomodoroSettings> };
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // Nested object needs its own merge or a partial save from an older
      // version would leave missing keys undefined.
      pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...(parsed.pomodoro ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: settings just won't persist across reloads.
  }
}
