import { formatDate, formatTimezone, formatWeekday, timeParts } from '../core/format';
import { PHASE_LABEL as SKY_PHASE_LABEL } from '../sky/solar';
import type { DynamicTheme, Palette } from '../theme/palettes';
import { formatRemaining, PHASE_LABEL as POMODORO_LABEL, type PomodoroState } from '../timer/pomodoro';

export interface ClockOptions {
  use24h: boolean;
  showSeconds: boolean;
  showTimezone: boolean;
  showSun: boolean;
  showStreak: boolean;
  streak: number;
  /** Present only in dynamic mode. */
  sky: DynamicTheme | null;
  /** Current palette, used for the ring colour. */
  palette: Palette;
  pomodoro: PomodoroState | null;
  /** Focus blocks before a long break, for the "3/4" readout. */
  longBreakEvery: number;
}

export interface ClockHandle {
  update: (now: Date) => void;
  setOptions: (next: Partial<ClockOptions>) => void;
  element: HTMLElement;
}

function digitSpan(): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'time__digit';
  return s;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_INSET = 7;

export function createClock(initial: ClockOptions): ClockHandle {
  let opts = { ...initial };

  const root = document.createElement('section');
  root.className = 'glass';
  root.setAttribute('aria-label', 'Saat');

  // ---- progress ring ----
  // Drawn on the panel edge rather than as a circle, so it stays correct while
  // the digits scale from 4.5rem to 21rem. A ResizeObserver keeps the rect
  // geometry honest because the panel is sized to its content.
  const ringSvg = document.createElementNS(SVG_NS, 'svg');
  ringSvg.setAttribute('class', 'ring');
  ringSvg.setAttribute('aria-hidden', 'true');

  const ringTrack = document.createElementNS(SVG_NS, 'rect');
  ringTrack.setAttribute('class', 'ring__track');
  ringTrack.setAttribute('fill', 'none');
  ringTrack.setAttribute('pathLength', '100');

  const ringFill = document.createElementNS(SVG_NS, 'rect');
  ringFill.setAttribute('class', 'ring__fill');
  ringFill.setAttribute('fill', 'none');
  ringFill.setAttribute('pathLength', '100');
  ringFill.setAttribute('stroke-dasharray', '100 100');
  ringFill.setAttribute('stroke-dashoffset', '100');

  ringSvg.append(ringTrack, ringFill);
  root.append(ringSvg);

  const observer = new ResizeObserver(() => {
    const { width, height } = root.getBoundingClientRect();
    if (!width || !height) return;
    const w = width - RING_INSET * 2;
    const h = height - RING_INSET * 2;
    const r = Math.min(22, h / 2, w / 2);

    for (const rect of [ringTrack, ringFill]) {
      rect.setAttribute('x', String(RING_INSET));
      rect.setAttribute('y', String(RING_INSET));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', String(r));
      rect.setAttribute('ry', String(r));
    }
  });
  observer.observe(root);

  // ---- content ----
  const content = document.createElement('div');
  content.className = 'glass__content';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  const rule = document.createElement('span');
  rule.className = 'eyebrow__rule';
  const eyebrowText = document.createElement('span');
  eyebrowText.textContent = 'study o\u2019clock';
  eyebrow.append(rule, eyebrowText);

  const time = document.createElement('div');
  time.className = 'time';
  // A clock that announces itself every second is hostile to screen readers.
  time.setAttribute('role', 'timer');
  time.setAttribute('aria-live', 'off');

  const hourGroup = document.createElement('span');
  hourGroup.className = 'time__group';
  const h1 = digitSpan();
  const h2 = digitSpan();
  hourGroup.append(h1, h2);

  const colon = document.createElement('span');
  colon.className = 'time__colon';
  colon.textContent = ':';

  const minuteGroup = document.createElement('span');
  minuteGroup.className = 'time__group';
  const m1 = digitSpan();
  const m2 = digitSpan();
  minuteGroup.append(m1, m2);

  const seconds = document.createElement('span');
  seconds.className = 'time__seconds';

  const meridiem = document.createElement('span');
  meridiem.className = 'time__meridiem';

  time.append(hourGroup, colon, minuteGroup, seconds, meridiem);

  const dateLine = document.createElement('div');
  dateLine.className = 'date-line';

  // ---- pomodoro readout ----
  const timerRow = document.createElement('div');
  timerRow.className = 'timer-row';
  timerRow.hidden = true;

  const timerPhase = document.createElement('span');
  timerPhase.className = 'timer-row__phase';

  const timerValue = document.createElement('span');
  timerValue.className = 'timer-row__value';

  const timerCount = document.createElement('span');
  timerCount.className = 'timer-row__count';

  const timerDot = document.createElement('span');
  timerDot.className = 'timer-row__sep';

  const timerDot2 = document.createElement('span');
  timerDot2.className = 'timer-row__sep';

  timerRow.append(timerPhase, timerDot, timerValue, timerDot2, timerCount);

  const extras = document.createElement('div');
  extras.className = 'extras';

  content.append(eyebrow, time, dateLine, timerRow, extras);
  root.append(content);

  const item = (text: string): HTMLSpanElement => {
    const el = document.createElement('span');
    el.className = 'extras__item';
    el.textContent = text;
    return el;
  };

  const sep = (): HTMLSpanElement => {
    const el = document.createElement('span');
    el.className = 'extras__sep';
    el.setAttribute('aria-hidden', 'true');
    return el;
  };

  let lastKey = '';

  const renderExtras = (): void => {
    extras.replaceChildren();
    const items: string[] = [];
    if (opts.showTimezone) items.push(formatTimezone());
    if (opts.showSun && opts.sky) {
      items.push(
        `${SKY_PHASE_LABEL[opts.sky.phase]} \u00b7 ${Math.round(opts.sky.elevation)}\u00b0`,
      );
    }
    if (opts.showStreak) items.push(`${opts.streak} g\u00fcn seri`);

    items.forEach((text, i) => {
      if (i > 0) extras.append(sep());
      extras.append(item(text));
    });
  };

  const renderTimer = (): void => {
    const p = opts.pomodoro;
    if (!p) {
      timerRow.hidden = true;
      root.dataset.timer = 'idle';
      root.dataset.timerRunning = 'false';
      ringFill.setAttribute('stroke-dashoffset', '100');
      return;
    }

    // Idle only when the session has never been started. Comparing
    // remainingMs against durationMs is wrong: pause() freezes one into the
    // other, so a paused timer would be indistinguishable from a fresh one.
    const untouched = p.startedAt === null && p.completedFocus === 0;
    if (untouched) {
      timerRow.hidden = true;
      root.dataset.timer = 'idle';
      // Must also reset the running flag, or a reset leaves the ring styled as
      // though a session were in progress.
      root.dataset.timerRunning = 'false';
      ringFill.setAttribute('stroke-dashoffset', '100');
      return;
    }

    timerRow.hidden = false;
    root.dataset.timer = p.phase;
    root.dataset.timerRunning = String(p.running);

    timerPhase.textContent = POMODORO_LABEL[p.phase];
    timerValue.textContent = formatRemaining(p.remainingMs);
    timerCount.textContent = `${p.completedFocus}/${opts.longBreakEvery}`;

    const elapsed = p.durationMs === 0 ? 0 : 1 - p.remainingMs / p.durationMs;
    const progress = Math.max(0, Math.min(1, elapsed));
    ringFill.setAttribute('stroke-dashoffset', String(100 - progress * 100));
  };

  const update = (now: Date): void => {
    const p = timeParts(now, opts.use24h);

    // Only touch the DOM when a displayed value actually changed.
    const key = `${p.hour}${p.minute}${opts.showSeconds ? p.second : ''}${opts.use24h}`;
    if (key !== lastKey) {
      lastKey = key;
      const hour = opts.use24h ? p.hour : p.hour.padStart(2, ' ');
      h1.textContent = hour[0] ?? '0';
      h2.textContent = hour[1] ?? '0';
      m1.textContent = p.minute[0] ?? '0';
      m2.textContent = p.minute[1] ?? '0';

      // Seconds carry their own leading marker so "13:00" and "06" can never be
      // misread as "13:0006" in plain text or on a narrow layout.
      const secondsText = opts.showSeconds ? `:${p.second}` : '';
      if (seconds.textContent !== secondsText) seconds.textContent = secondsText;
      const shouldHide = !opts.showSeconds;
      if (seconds.hidden !== shouldHide) seconds.hidden = shouldHide;

      // The date changes once a day. Assigning it every tick replaced the text
      // node 86,400 times a day for no reason.
      const dateText = `${formatWeekday(now)}, ${formatDate(now)}`;
      if (dateLine.textContent !== dateText) dateLine.textContent = dateText;

      const title = `${p.hour}:${p.minute} \u00b7 Study O'Clock`;
      if (document.title !== title) document.title = title;
    }
  };

  renderExtras();
  renderTimer();

  // Rebuilding the extras row every second would restart its fade-in transition
  // and drop any hover, so track what was actually rendered.
  let lastExtrasKey = '';
  let lastTimerKey = '';
  let extrasRendered = false;
  let timerRendered = false;

  return {
    element: root,
    update,
    setOptions(next) {
      opts = { ...opts, ...next };
      lastKey = '';

      const extrasKey = [
        opts.showTimezone,
        opts.showSun,
        opts.sky?.phase ?? '',
        Math.round(opts.sky?.elevation ?? 0),
        opts.showStreak,
        opts.streak,
      ].join('|');

      if (!extrasRendered || extrasKey !== lastExtrasKey) {
        lastExtrasKey = extrasKey;
        extrasRendered = true;
        renderExtras();
      }

      const timerKey = [
        opts.pomodoro?.phase ?? '',
        opts.pomodoro?.startedAt ?? 'none',
        opts.pomodoro ? Math.ceil(opts.pomodoro.remainingMs / 1000) : '',
        opts.pomodoro?.running ?? '',
        opts.pomodoro?.completedFocus ?? '',
        opts.longBreakEvery,
        opts.palette.accent,
      ].join('|');

      if (!timerRendered || timerKey !== lastTimerKey) {
        lastTimerKey = timerKey;
        timerRendered = true;
        renderTimer();
      }
    },
  };
}
