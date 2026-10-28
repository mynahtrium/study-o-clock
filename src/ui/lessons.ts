import { retriever, type BookManifest } from '../coach/retrieve';
import { allProgress, onProgressChange } from '../coach/progress';
import { cachedPlan, generatePlan, type Plan } from '../coach/plan';
import { openPage } from '../viewer/page-viewer';

export interface LessonsOptions {
  apiKey: string;
  model: string;
  streak: number;
  onPickBook?: (bookId: string, page: number, subject: string) => void;
}

export interface LessonsHandle {
  element: HTMLElement;
  refresh: () => void;
  loadPlan: (force?: boolean) => Promise<void>;
  setOptions: (next: Partial<LessonsOptions>) => void;
  destroy: () => void;
}

/**
 * Left rail: the seven books with where you left off, plus today's plan.
 *
 * Progress is read from localStorage on every refresh so opening a page in the
 * viewer immediately updates the rail without needing an event bus.
 */
export function createLessons(initial: LessonsOptions): LessonsHandle {
  let opts = { ...initial };
  let plan: Plan | null = null;
  let planLoading = false;

  const root = document.createElement('aside');
  root.className = 'rail scrollable';
  root.setAttribute('aria-label', 'Dersler');

  const booksSection = document.createElement('section');
  booksSection.className = 'rail__section';
  const booksTitle = document.createElement('h2');
  booksTitle.className = 'rail__title';
  booksTitle.textContent = 'dersler';
  const booksList = document.createElement('ul');
  booksList.className = 'rail__books';
  booksSection.append(booksTitle, booksList);

  const planSection = document.createElement('section');
  planSection.className = 'rail__section rail__section--plan';
  const planTitle = document.createElement('h2');
  planTitle.className = 'rail__title';
  planTitle.textContent = 'bug\u00fcn\u00fcn plan\u0131';
  const planBody = document.createElement('div');
  planBody.className = 'rail__plan';
  planSection.append(planTitle, planBody);

  root.append(booksSection, planSection);

  /**
   * Signature of what the rail actually displays. Re-rendering on every tick is
   * what caused the blink: replaceChildren() destroys the button under the
   * cursor, so hover and its transition restart from nothing.
   */
  let lastSignature = '';

  const progressSignature = (): string => {
    const progress = allProgress();
    const manifests = retriever.manifests();
    if (!manifests.length) return 'loading';
    return manifests
      .map((b) => {
        const p = progress[b.id];
        return `${b.id}:${p?.page ?? 0}:${p?.unit ?? ''}`;
      })
      .join('|');
  };

  const renderBooks = (): void => {
    const manifests = retriever.manifests();
    const progress = allProgress();

    if (!manifests.length) {
      booksList.replaceChildren();
      const li = document.createElement('li');
      li.className = 'rail__hint';
      li.textContent = 'Kitaplar y\u00fckleniyor\u2026';
      booksList.append(li);
      return;
    }

    // Reuse existing rows and patch their text: a node swap would drop hover.
    const existing = new Map<string, HTMLButtonElement>();
    for (const btn of booksList.querySelectorAll<HTMLButtonElement>('.rail__book')) {
      const id = btn.dataset.book;
      if (id) existing.set(id, btn);
    }

    if (existing.size !== manifests.length) {
      booksList.replaceChildren();
      existing.clear();
    }

    for (const book of manifests) {
      const saved = progress[book.id];

      let btn = existing.get(book.id);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rail__book';
        btn.dataset.book = book.id;

        const name = document.createElement('span');
        name.className = 'rail__book-name';
        name.textContent = book.subject;

        const meta = document.createElement('span');
        meta.className = 'rail__book-meta';

        const li = document.createElement('li');
        btn.append(name, meta);
        li.append(btn);
        booksList.append(li);

        btn.addEventListener('click', () => {
          const current = allProgress()[book.id];
          const page = current?.page ?? 1;
          openPage(book.id, page);
          opts.onPickBook?.(book.id, page, book.subject);
        });
      }

      const meta = btn.querySelector('.rail__book-meta');
      if (meta) {
        const text = saved
          ? saved.unit
            ? `${saved.unit} \u00b7 s. ${saved.page}`
            : `s. ${saved.page}`
          : `${book.pages} sayfa`;
        if (meta.textContent !== text) meta.textContent = text;
      }
      btn.dataset.started = String(Boolean(saved));
    }
  };

  const refresh = (): void => {
    const signature = progressSignature();
    if (signature === lastSignature) return;
    lastSignature = signature;
    renderBooks();
  };

  const renderPlan = (): void => {
    planBody.replaceChildren();

    if (planLoading) {
      const p = document.createElement('p');
      p.className = 'rail__hint';
      p.textContent = 'Plan haz\u0131rlan\u0131yor\u2026';
      planBody.append(p);
      return;
    }

    if (!plan) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rail__plan-btn';
      btn.textContent = 'Plan olu\u015ftur';
      btn.addEventListener('click', () => void loadPlan());
      planBody.append(btn);
      return;
    }

    const list = document.createElement('ol');
    list.className = 'plan__list';

    for (const block of plan.blocks) {
      const li = document.createElement('li');
      li.className = 'plan__item';

      const time = document.createElement('span');
      time.className = 'plan__time';
      time.textContent = block.time;

      const body = document.createElement('span');
      body.className = 'plan__body';

      const subject = document.createElement('strong');
      subject.textContent = block.subject;

      const task = document.createElement('span');
      task.className = 'plan__task';
      task.textContent = block.task;

      const pages = document.createElement('span');
      pages.className = 'plan__pages';
      pages.textContent = block.pages;

      body.append(subject, task, pages);
      li.append(time, body);
      list.append(li);
    }

    const note = document.createElement('p');
    note.className = 'plan__note';
    note.textContent = plan.note;

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'rail__plan-btn rail__plan-btn--ghost';
    refresh.textContent = 'Yeniden olu\u015ftur';
    refresh.addEventListener('click', () => {
      try {
        localStorage.removeItem('soc.plan.v1');
      } catch {
        // non-fatal
      }
      void loadPlan(true);
    });

    planBody.append(list, note, refresh);
  };

  const loadPlan = async (force = false): Promise<void> => {
    if (!force) {
      const cached = cachedPlan();
      if (cached) {
        plan = cached;
        renderPlan();
        return;
      }
    }

    planLoading = true;
    renderPlan();

    const progress = allProgress();
    const manifests: BookManifest[] = retriever.manifests();
    const rows = manifests.map((m) => {
      const saved = progress[m.id];
      return { subject: m.subject, unit: saved?.unit ?? null, page: saved?.page ?? 1 };
    });

    plan = await generatePlan(opts.apiKey, opts.model, {
      progress: rows.length ? rows : [{ subject: 'Matematik', unit: null, page: 1 }],
      streak: opts.streak,
    });

    planLoading = false;
    renderPlan();
  };

  renderBooks();
  lastSignature = progressSignature();
  renderPlan();

  // Event-driven instead of polled: no per-tick DOM work, and the rail still
  // updates the moment a page is opened.
  const unsubscribe = onProgressChange(refresh);

  return {
    element: root,
    refresh,
    loadPlan,
    setOptions(next) {
      opts = { ...opts, ...next };
    },
    destroy: unsubscribe,
  };
}
