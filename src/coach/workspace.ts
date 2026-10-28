import { createAutocomplete } from './autocomplete';
import { createConversation } from './conversation';
import { createLessons } from '../ui/lessons';
import { createClock, type ClockHandle } from '../ui/clock';
import type { Usage } from './openrouter';
import type { Pomodoro, PomodoroState } from '../timer/pomodoro';
import type { Settings } from '../ui/storage';
import type { Palette } from '../theme/palettes';

export interface WorkspaceDeps {
  settings: () => Settings;
  streak: number;
  palette: () => Palette;
  pomodoro: Pomodoro;
  focus: () => { bookTitle: string; page: number; unit: string | null } | null;
  onClose: () => void;
  onOpenSettings: () => void;
}

export interface WorkspaceHandle {
  element: HTMLElement;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  update: (now: Date) => void;
  setPomodoro: (state: PomodoroState) => void;
  refresh: () => void;
  syncSettings: () => void;
  focusInput: () => void;
}

/**
 * The full-screen study workspace.
 *
 * Layout is a three-area grid: a fixed rail on the left, a conversation column,
 * and a composer pinned under it. The clock moves into the header so the page
 * still reads as a clock app rather than a chat window.
 */
export function createWorkspace(deps: WorkspaceDeps): WorkspaceHandle {
  let open = false;

  const root = document.createElement('section');
  root.className = 'workspace';
  root.setAttribute('aria-label', 'Çalışma alanı');
  root.setAttribute('aria-hidden', 'true');

  // ---- header ----
  const header = document.createElement('header');
  header.className = 'workspace__header';

  const clockHost = document.createElement('div');
  clockHost.className = 'workspace__clock';

  const headerActions = document.createElement('div');
  headerActions.className = 'workspace__actions';

  const timerChip = document.createElement('button');
  timerChip.type = 'button';
  timerChip.className = 'ws-btn ws-btn--timer';
  timerChip.title = 'Pomodoro başlat / duraklat (P)';

  const timerPhaseEl = document.createElement('span');
  timerPhaseEl.className = 'ws-btn__phase';
  const timerValueEl = document.createElement('span');
  timerValueEl.className = 'ws-btn__value';
  timerChip.append(timerPhaseEl, timerValueEl);

  const planBtn = document.createElement('button');
  planBtn.type = 'button';
  planBtn.className = 'ws-btn';
  planBtn.textContent = 'plan';
  planBtn.title = 'Günlük planı yenile';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'ws-btn';
  clearBtn.textContent = 'temizle';
  clearBtn.title = 'Sohbeti temizle';

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'ws-btn';
  settingsBtn.textContent = 'ayarlar';
  settingsBtn.title = 'Ayarlar (S)';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ws-btn ws-btn--close';
  closeBtn.textContent = '\u00d7';
  closeBtn.setAttribute('aria-label', 'Çalışma alanını kapat');
  closeBtn.title = 'Kapat (Esc)';

  headerActions.append(timerChip, planBtn, clearBtn, settingsBtn, closeBtn);
  header.append(clockHost, headerActions);

  // ---- body ----
  const body = document.createElement('div');
  body.className = 'workspace__body';

  const lessons = createLessons({
    apiKey: deps.settings().apiKey,
    model: deps.settings().model,
    streak: deps.streak,
  });

  const main = document.createElement('div');
  main.className = 'workspace__main';

  const conversation = createConversation({
    apiKey: deps.settings().apiKey,
    model: deps.settings().model,
    focus: deps.focus(),
    onUsage: renderUsage,
  });

  const composerHost = document.createElement('div');
  composerHost.className = 'workspace__composer';

  const autocomplete = createAutocomplete({
    onSubmit: (text) => void conversation.ask(text),
  });

  const footer = document.createElement('div');
  footer.className = 'workspace__footer';

  composerHost.append(autocomplete.element, footer);
  main.append(conversation.element, composerHost);
  body.append(lessons.element, main);
  root.append(header, body);

  function renderUsage(usage: Usage | null): void {
    if (!usage) {
      footer.textContent = '';
      return;
    }
    const cost = usage.cost === null ? '' : ` \u00b7 $${usage.cost.toFixed(4)}`;
    footer.textContent = `${usage.promptTokens} girdi + ${usage.completionTokens} \u00e7\u0131kt\u0131 jeton${cost}`;
  }

  // ---- compact header clock ----
  const clock: ClockHandle = createClock({
    use24h: deps.settings().use24h,
    showSeconds: deps.settings().showSeconds,
    showTimezone: false,
    showSun: false,
    showStreak: false,
    streak: deps.streak,
    sky: null,
    palette: deps.palette(),
    pomodoro: null,
    longBreakEvery: deps.settings().pomodoro.longBreakEvery,
  });
  // Compact variant: the header shows time and date, nothing else.
  clock.element.classList.add('glass--compact');
  clock.element.querySelector('.eyebrow')?.remove();
  clock.element.querySelector('.extras')?.remove();
  clockHost.append(clock.element);

  // ---- wiring ----
  closeBtn.addEventListener('click', () => deps.onClose());
  settingsBtn.addEventListener('click', () => deps.onOpenSettings());

  clearBtn.addEventListener('click', () => {
    conversation.clear();
    autocomplete.setValue('');
  });

  planBtn.addEventListener('click', () => {
    try {
      localStorage.removeItem('soc.plan.v1');
    } catch {
      // non-fatal
    }
    void lessons.loadPlan(true);
  });

  timerChip.addEventListener('click', () => deps.pomodoro.toggle());

  const syncSettings = (): void => {
    const s = deps.settings();
    clock.setOptions({
      use24h: s.use24h,
      showSeconds: s.showSeconds,
      palette: deps.palette(),
      longBreakEvery: s.pomodoro.longBreakEvery,
    });
    conversation.setOptions({ apiKey: s.apiKey, model: s.model });
    lessons.setOptions({ apiKey: s.apiKey, model: s.model });
    autocomplete.setEnabled(true);
  };

  syncSettings();

  const setOpen = (next: boolean): void => {
    open = next;
    root.classList.toggle('workspace--open', open);
    root.setAttribute('aria-hidden', String(!open));
    document.body.dataset.view = open ? 'workspace' : 'clock';

    if (open) {
      lessons.refresh();
      conversation.setOptions({ focus: deps.focus() });
      // Never focus synchronously from a keydown: the browser would insert the
      // triggering character into the freshly focused textarea. The delay also
      // lets the visibility transition begin, without which focus silently
      // fails on a visibility:hidden subtree.
      window.setTimeout(() => autocomplete.focus(), 60);
    } else {
      // Release focus. Leaving it in the now-hidden textarea swallowed every
      // single-letter shortcut, because the keydown handler ignores keys that
      // originate in a text field.
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.contains(active)) active.blur();
    }
  };

  return {
    element: root,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    isOpen: () => open,
    update(now) {
      clock.update(now);
      // The rail is refreshed explicitly when progress actually changes (a page
      // is opened, the plan reloads). Refreshing it on every tick rebuilt its
      // DOM once a second and killed hover states.
    },
    setPomodoro(state) {
      // Runs once a second while a session is active. Writing identical values
      // still replaces text nodes and re-triggers attribute change handling, so
      // only touch the DOM when something differs.
      const phaseLabel =
        state.phase === 'focus' ? 'odak' : state.phase === 'shortBreak' ? 'mola' : 'uzun mola';
      const value = formatShort(state.remainingMs);

      if (timerPhaseEl.textContent !== phaseLabel) timerPhaseEl.textContent = phaseLabel;
      if (timerValueEl.textContent !== value) timerValueEl.textContent = value;
      if (timerChip.dataset.phase !== state.phase) timerChip.dataset.phase = state.phase;

      const running = String(state.running);
      if (timerChip.dataset.running !== running) timerChip.dataset.running = running;
      if (document.body.dataset.timerActive !== running) {
        document.body.dataset.timerActive = running;
      }

      clock.setOptions({ pomodoro: state });
    },
    refresh() {
      lessons.refresh();
    },
    syncSettings,
    focusInput: () => autocomplete.focus(),
  };
}

function formatShort(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
