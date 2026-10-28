import './styles/base.css';
import './styles/scrollbar.css';
import './styles/workspace.css';
import { createTicker } from './core/ticker';
import {
  applyPalette,
  dynamicTheme,
  staticPalette,
  type DynamicTheme,
  type Palette,
} from './theme/palettes';
import { createClock, type ClockHandle } from './ui/clock';
import { createIdleTracker } from './ui/idle';
import { createSettings } from './ui/settings';
import { loadSettings, type Settings } from './ui/storage';
import { touchStreak } from './streak/streak';
import { createWorkspace } from './coach/workspace';
import { retriever } from './coach/retrieve';
import { currentFocus } from './coach/progress';
import { closePage, isPageOpen } from './viewer/page-viewer';
import { Pomodoro, playChime, type PomodoroState } from './timer/pomodoro';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app not found');

let settings: Settings = loadSettings();
const streak = touchStreak();

// ---- atmosphere ----
const skyLayer = document.createElement('div');
skyLayer.className = 'sky';

const blobA = document.createElement('div');
blobA.className = 'blob blob--a';
blobA.setAttribute('aria-hidden', 'true');

const blobB = document.createElement('div');
blobB.className = 'blob blob--b';
blobB.setAttribute('aria-hidden', 'true');

const stage = document.createElement('main');
stage.className = 'stage';

const hasLocation = (): boolean => settings.latitude !== null && settings.longitude !== null;

// ---- theme ----
let currentPalette: Palette = resolvePalette();

function resolvePalette(now = new Date()): Palette {
  if (settings.themeMode === 'dynamic' && hasLocation()) {
    return dynamicTheme(now, settings.latitude!, settings.longitude!).palette;
  }
  return staticPalette(settings.staticTheme);
}

function applyTheme(now = new Date()): void {
  const dynamic: DynamicTheme | null =
    settings.themeMode === 'dynamic' && hasLocation()
      ? dynamicTheme(now, settings.latitude!, settings.longitude!)
      : null;

  currentPalette = dynamic?.palette ?? staticPalette(settings.staticTheme);
  applyPalette(document.documentElement, currentPalette, dynamic?.phase);
  clock.setOptions({ sky: dynamic, palette: currentPalette });
  workspace.syncSettings();
}

// ---- pomodoro ----
const pomodoro = new Pomodoro(settings.pomodoro);

// ---- clock ----
const clock: ClockHandle = createClock({
  use24h: settings.use24h,
  showSeconds: settings.showSeconds,
  showTimezone: settings.showTimezone,
  showSun: settings.showSun && hasLocation(),
  showStreak: settings.showStreak,
  streak,
  sky: null,
  palette: currentPalette,
  pomodoro: null,
  longBreakEvery: settings.pomodoro.longBreakEvery,
});

stage.append(clock.element);

// ---- workspace + settings ----
const workspace = createWorkspace({
  settings: () => settings,
  streak,
  palette: () => currentPalette,
  pomodoro,
  focus: () => {
    const focus = currentFocus();
    if (!focus) return null;
    const manifest = retriever.manifests().find((m) => m.id === focus.bookId);
    return manifest ? { bookTitle: manifest.title, page: focus.page, unit: focus.unit } : null;
  },
  onClose: () => workspace.close(),
  onOpenSettings: () => settingsPanel.toggle(),
});

const settingsPanel = createSettings(settings, (next) => {
  const previous = settings;
  settings = next;

  clock.setOptions({
    use24h: next.use24h,
    showSeconds: next.showSeconds,
    showTimezone: next.showTimezone,
    showSun: next.showSun && hasLocation(),
    showStreak: next.showStreak,
    longBreakEvery: next.pomodoro.longBreakEvery,
  });

  if (previous.pomodoro !== next.pomodoro) pomodoro.setSettings(next.pomodoro);
  workspace.syncSettings();
  workspace.refresh();

  if (
    previous.themeMode !== next.themeMode ||
    previous.staticTheme !== next.staticTheme ||
    previous.latitude !== next.latitude ||
    previous.longitude !== next.longitude
  ) {
    applyTheme(new Date());
  }
});

app.append(skyLayer, blobA, blobB, stage, workspace.element, settingsPanel.element);

applyTheme(new Date());

// ---- pomodoro wiring ----
pomodoro.onPhaseComplete((finished) => {
  if (settings.pomodoro.sound) playChime();
  // Phase changes are worth surfacing in the tab title too, since a background
  // tab cannot play a chime reliably.
  document.title = `${finished === 'focus' ? 'Mola zaman\u0131' : 'Odak zaman\u0131'} \u00b7 Study O'Clock`;
});

pomodoro.subscribe((state) => {
  clock.setOptions({ pomodoro: state });
  workspace.setPomodoro(state);
});

function pushPomodoro(state: PomodoroState): void {
  clock.setOptions({ pomodoro: state });
  workspace.setPomodoro(state);
}
pushPomodoro(pomodoro.state());

// ---- ticker ----
let ticks = 0;
let lastTimerKey = '';

createTicker((now) => {
  clock.update(now);
  workspace.update(now);

  // Pomodoro needs a per-second refresh; read state (which also handles phase
  // rollover) only when something visible could have changed.
  const state = pomodoro.state(now.getTime());
  const timerKey = `${state.phase}${state.running}${state.startedAt ?? 0}${Math.ceil(state.remainingMs / 1000)}`;
  if (timerKey !== lastTimerKey) {
    lastTimerKey = timerKey;
    pushPomodoro(state);
  }

  // Elevation moves slowly; once a minute is plenty and avoids per-second trig.
  if (settings.themeMode === 'dynamic' && ticks++ % 60 === 0) {
    applyTheme(now);
  }
});

// ---- idle ----
createIdleTracker(5000);

// ---- keyboard ----
const TEXT_ENTRY = /^(INPUT|TEXTAREA)$/;

window.addEventListener('keydown', (event) => {
  // Modifier combos belong to the browser: Cmd/Ctrl+C must still copy.
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const target = event.target;
  const el = target instanceof HTMLElement ? target : null;
  const inTextField = el !== null && TEXT_ENTRY.test(el.tagName);
  // A field inside a collapsed panel is not really being typed into. Treating
  // it as focused let a closed workspace swallow every shortcut.
  const fieldIsVisible = el !== null && el.offsetParent !== null;
  const realField = inTextField && fieldIsVisible;

  // Escape always escapes, even from a field.
  if (event.key === 'Escape') {
    if (isPageOpen()) {
      closePage();
      return;
    }
    if (settingsPanel.isOpen()) {
      settingsPanel.close();
      return;
    }
    if (workspace.isOpen()) {
      workspace.close();
      return;
    }
    if (inTextField) (target as HTMLInputElement).blur();
    return;
  }

  // Single-letter shortcuts must never fire while typing a question.
  if (realField) return;

  const key = event.key.toLowerCase();
  switch (key) {
    case 'c':
      // preventDefault is load-bearing: without it the browser inserts the
      // character into whatever gains focus, which is what produced the
      // "c" landing in the composer.
      event.preventDefault();
      workspace.toggle();
      break;
    case 'p':
      event.preventDefault();
      if (event.shiftKey) pomodoro.reset();
      else pomodoro.toggle();
      break;
    case 's':
      event.preventDefault();
      settingsPanel.toggle();
      break;
    case 'f':
      event.preventDefault();
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => {});
      break;
    case 'd':
      event.preventDefault();
      document.body.dataset.dim = String(document.body.dataset.dim !== 'true');
      break;
    case 'b':
      event.preventDefault();
      document.body.dataset.burnin = String(document.body.dataset.burnin !== 'true');
      break;
    default:
      break;
  }
});

// Warm the book manifest so the first question and the rail are instant.
void retriever.load().then(() => {
  workspace.refresh();
});
