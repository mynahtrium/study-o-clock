import { retriever } from './retrieve';

export interface AutocompleteOptions {
  onSubmit: (text: string) => void;
  /** Called with the current text whenever it changes, for external state. */
  onInput?: (text: string) => void;
}

export interface AutocompleteHandle {
  element: HTMLElement;
  input: HTMLTextAreaElement;
  setEnabled: (enabled: boolean) => void;
  setValue: (text: string) => void;
  focus: () => void;
}

const HISTORY_KEY = 'soc.questions.v1';
const HISTORY_MAX = 20;
const VISIBLE_MAX = 6;
const DEBOUNCE_MS = 80;

interface Suggestion {
  text: string;
  /** Secondary label, e.g. the book a unit belongs to. */
  hint: string;
  kind: 'history' | 'unit' | 'book' | 'prompt';
}

const QUICK_PROMPTS: Suggestion[] = [
  { text: 'Bu konuyu anlat.', hint: 'hızlı', kind: 'prompt' },
  { text: 'Bana bu konudan bir soru sor.', hint: 'hızlı', kind: 'prompt' },
  { text: 'Bu konunun kısa bir özetini çıkar.', hint: 'hızlı', kind: 'prompt' },
];

/**
 * Seed topics per subject.
 *
 * The books' own unit headings are mostly theme titles ("Sayılar",
 * "Etkileşim"), which are too generic to be useful suggestions. These are the
 * actual topics a 9th-grader asks about, and they double as good retrieval
 * queries because they contain the vocabulary the textbooks use.
 */
const TOPICS: Record<string, string[]> = {
  matematik: [
    'Üslü sayılar', 'Köklü sayılar', 'Sayı kümeleri', 'Bölünebilme kuralları',
    'EBOB ve EKOK', 'Mantık ve önermeler', 'Kümeler', 'Fonksiyonlar',
    'Üçgenler', 'Açılar', 'Eşlik ve benzerlik',
  ],
  fizik: [
    'Fiziksel nicelikler', 'Vektörler', 'Vektörlerin bileşenlerine ayrılması',
    'Newton hareket yasaları', 'Kuvvet ve hareket', 'Sürtünme kuvveti',
    'Enerji korunumu', 'İç enerji ve sıcaklık', 'Isı ve sıcaklık',
  ],
  kimya: [
    'Atom modelleri', 'Atomun yapısı', 'Periyodik sistem', 'Elementler ve bileşikler',
    'Kimyasal türler arası etkileşim', 'Güçlü etkileşimler', 'Zayıf etkileşimler',
    'Kimyanın alt dalları', 'Yeşil kimya',
  ],
  biyoloji: [
    'Hücre yapısı', 'Organeller', 'Hücre zarından madde geçişleri',
    'Difüzyon ve osmoz', 'Aktif taşıma', 'Enzimler', 'Canlıların ortak özellikleri',
    'Biyoçeşitlilik', 'Canlıların sınıflandırılması',
  ],
  cografya: [
    'Coğrafyanın konusu', 'Harita bilgisi', 'Ölçek hesaplamaları',
    'Dünya’nın şekli ve hareketleri', 'İklim tipleri', 'Sıcaklık dağılışı',
    'Basınç ve rüzgârlar', 'Nüfus dağılışı', 'Ekonomik faaliyetler',
  ],
  tarih: [
    'Tarihin konusu', 'Tarih yazıcılığı', 'Zaman ve takvimler',
    'İlk Çağ medeniyetleri', 'Eski Çağ Türkleri', 'İlk Türk devletleri',
    'Osmanlı Devleti’nin kuruluşu', 'İslamiyet’in doğuşu',
  ],
  edebiyat: [
    'Şiir türleri', 'Şiirde ölçü', 'Uyak ve redif', 'Söz sanatları',
    'Roman türleri', 'Hikâye türleri', 'Anlatım biçimleri', 'Metin incelemesi',
    'Dilin işlevi',
  ],
};

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberQuestion(question: string): void {
  const trimmed = question.trim();
  if (trimmed.length < 4) return;
  try {
    const history = readHistory().filter((q) => q !== trimmed);
    history.unshift(trimmed);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)));
  } catch {
    // non-fatal
  }
}

/**
 * Composer with an inline suggestion list.
 *
 * Pool is history + units + book titles + quick prompts. Matching is on the
 * whole input against the start of a suggestion, then anywhere inside it, so
 * typing "üs" surfaces "Üslü sayılar" whether or not the accent is typed.
 */
export function createAutocomplete(options: AutocompleteOptions): AutocompleteHandle {
  let enabled = true;

  const root = document.createElement('form');
  root.className = 'composer';
  root.setAttribute('role', 'search');

  const field = document.createElement('div');
  field.className = 'composer__field';

  const input = document.createElement('textarea');
  input.className = 'composer__input';
  input.rows = 1;
  input.placeholder = 'Bir soru yaz\u2026 (\u21b5 g\u00f6nder, \u21e7\u21b5 yeni sat\u0131r)';
  input.setAttribute('aria-label', 'Sorunuz');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';
  input.spellcheck = false;

  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'composer__send';
  sendBtn.textContent = 'g\u00f6nder';

  field.append(input, sendBtn);

  const list = document.createElement('ul');
  list.className = 'autocomplete scrollable scrollable--inset';
  list.id = 'composer-suggestions';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.setAttribute('aria-controls', list.id);

  root.append(list, field);

  let items: Suggestion[] = [];
  let active = -1;
  let debounce: number | undefined;
  let pool: Suggestion[] = [];

  /** Rebuilt lazily: books arrive asynchronously from the manifest. */
  const buildPool = (): Suggestion[] => {
    if (pool.length) return pool;

    const next: Suggestion[] = [...QUICK_PROMPTS];

    for (const question of readHistory()) {
      next.push({ text: question, hint: 'ge\u00e7mi\u015f', kind: 'history' });
    }

    for (const book of retriever.manifests()) {
      for (const topic of TOPICS[book.id] ?? []) {
        next.push({ text: topic, hint: book.subject, kind: 'unit' });
      }
      // Books without a curated topic list still contribute their headings.
      if (!TOPICS[book.id]) {
        for (const unit of book.units.slice(0, 8)) {
          next.push({ text: unit, hint: book.subject, kind: 'unit' });
        }
      }
    }

    pool = next;
    return pool;
  };

  /**
   * Folds Turkish diacritics so "hucre" matches "Hücre" and "uslu" matches
   * "Üslü". Without this, a user typing without Turkish characters — which is
   * most people on a non-Turkish keyboard — gets no suggestions at all.
   */
  const FOLD: Record<string, string> = {
    ı: 'i', İ: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u',
  };

  const normalize = (s: string): string => {
    const lowered = s.toLocaleLowerCase('tr-TR');
    let out = '';
    for (const ch of lowered) out += FOLD[ch] ?? ch;
    return out;
  };

  const score = (needle: string, candidate: string): number => {
    if (!needle) return 0;
    const c = normalize(candidate);
    const at = c.indexOf(needle);
    if (at === 0) return 3;
    if (at > 0) return 2;
    return 0;
  };

  const closeList = (): void => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    for (const el of list.querySelectorAll('.autocomplete__item')) {
      el.setAttribute('aria-selected', 'false');
    }
  };

  const renderList = (): void => {
    list.replaceChildren();

    if (!items.length) {
      closeList();
      return;
    }

    items.forEach((suggestion, index) => {
      const li = document.createElement('li');
      li.className = 'autocomplete__item';
      li.id = `suggestion-${index}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(index === active));

      const text = document.createElement('span');
      text.className = 'autocomplete__text';
      text.textContent = suggestion.text;

      const hint = document.createElement('span');
      hint.className = 'autocomplete__hint';
      hint.textContent = suggestion.hint;

      li.append(text, hint);
      // mousedown, not click: the textarea would blur first and the list would
      // close before the click landed.
      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        accept(index);
      });
      list.append(li);
    });

    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const refresh = (): void => {
    if (!enabled) {
      closeList();
      return;
    }

    const raw = input.value;
    const needle = normalize(raw.trim());

    // Do not suggest while the user is writing a long question; it is noise.
    if (raw.trim().length > 40) {
      items = [];
      renderList();
      return;
    }

    const candidates = buildPool();
    items = candidates
      .map((s) => ({ s, sc: needle ? score(needle, s.text) : 1 }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, VISIBLE_MAX)
      .map((x) => x.s);

    active = items.length ? 0 : -1;
    renderList();
  };

  const accept = (index: number): void => {
    const suggestion = items[index];
    if (!suggestion) return;
    input.value = suggestion.text;
    closeList();
    autoGrow();
    input.focus();
    options.onInput?.(input.value);
  };

  const autoGrow = (): void => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  };

  const submit = (): void => {
    const text = input.value.trim();
    if (!text) return;
    rememberQuestion(text);
    // Drop cached pool so the new question appears in history next time.
    pool = [];
    input.value = '';
    autoGrow();
    closeList();
    options.onSubmit(text);
  };

  input.addEventListener('input', () => {
    autoGrow();
    options.onInput?.(input.value);
    if (debounce !== undefined) window.clearTimeout(debounce);
    debounce = window.setTimeout(refresh, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (event) => {
    const open = !list.hidden && items.length > 0;

    if (event.key === 'ArrowDown' && open) {
      event.preventDefault();
      active = (active + 1) % items.length;
      renderList();
      return;
    }
    if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      active = (active - 1 + items.length) % items.length;
      renderList();
      return;
    }
    if ((event.key === 'Enter' && !event.shiftKey) || (event.key === 'Tab' && open)) {
      // Enter accepts only when the list is genuinely open *and* the selection
      // differs from what is typed; otherwise it must send, not autocomplete.
      if (open && event.key === 'Tab') {
        event.preventDefault();
        accept(active);
        return;
      }
      if (open && event.key === 'Enter' && items[active]?.text !== input.value) {
        event.preventDefault();
        accept(active);
        return;
      }
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape' && open) {
      // Dismiss the list without leaving the room.
      event.preventDefault();
      event.stopPropagation();
      closeList();
      return;
    }
    if (event.key === 'Enter' && event.shiftKey) {
      autoGrow();
    }
  });

  input.addEventListener('blur', () => {
    // Defer so a mousedown on a suggestion can land first.
    window.setTimeout(closeList, 120);
  });

  root.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  return {
    element: root,
    input,
    setEnabled(next) {
      enabled = next;
      if (!next) closeList();
    },
    setValue(text) {
      input.value = text;
      autoGrow();
    },
    focus() {
      input.focus();
    },
  };
}

export function getQuestionHistory(): string[] {
  return readHistory();
}
