import { buildMessages } from './prompt';
import { streamChat, type ChatMessage, type Usage } from './openrouter';
import { retriever, type SearchHit } from './retrieve';
import { renderMarkdown } from './markdown';

export interface ConversationOptions {
  apiKey: string;
  model: string;
  focus: { bookTitle: string; page: number; unit: string | null } | null;
  onUsage?: (usage: Usage | null) => void;
}

export interface ConversationHandle {
  element: HTMLElement;
  ask: (question: string) => Promise<void>;
  clear: () => void;
  isBusy: () => boolean;
  setOptions: (next: Partial<ConversationOptions>) => void;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  hits: SearchHit[];
  error?: string;
}

/**
 * The conversation pane: turns, streaming, scroll.
 *
 * Deliberately has no chrome of its own — the workspace owns the header, the
 * composer and the rail. This keeps the streaming logic in one place and makes
 * the pane droppable into any layout.
 */
export function createConversation(initial: ConversationOptions): ConversationHandle {
  let opts = { ...initial };
  let busy = false;
  let controller: AbortController | null = null;

  const turns: Turn[] = [];
  const history: ChatMessage[] = [];

  const root = document.createElement('div');
  root.className = 'conversation scrollable';

  const log = document.createElement('div');
  log.className = 'conversation__log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');

  const empty = document.createElement('div');
  empty.className = 'conversation__empty';
  empty.innerHTML = `
    <p class="conversation__empty-title">Kitaplarına sor.</p>
    <p class="conversation__empty-hint">
      Cevaplar yalnızca kendi ders kitaplarından gelir, sayfa numarasıyla birlikte.
      Sol taraftaki bir derse tıklayarak konumunu ayarlayabilirsin.
    </p>`;

  log.append(empty);
  root.append(log);

  const scrollToEnd = (): void => {
    root.scrollTop = root.scrollHeight;
  };

  const renderTurns = (): void => {
    log.replaceChildren();
    if (!turns.length) {
      log.append(empty);
      return;
    }

    for (const turn of turns) {
      const el = document.createElement('div');
      el.className = `turn turn--${turn.role}`;

      const bubble = document.createElement('div');
      bubble.className = 'turn__bubble';

      if (turn.error) {
        const err = document.createElement('p');
        err.className = 'turn__error';
        err.textContent = turn.error;
        bubble.append(err);
      } else if (turn.role === 'user') {
        bubble.textContent = turn.text;
      } else {
        renderMarkdown(bubble, turn.text, turn.hits);
        if (!turn.text) {
          const dots = document.createElement('span');
          dots.className = 'turn__dots';
          dots.textContent = '\u2026';
          bubble.append(dots);
        }
      }

      el.append(bubble);
      log.append(el);
    }

    scrollToEnd();
  };

  /** Streams into the last assistant bubble without re-rendering the whole log. */
  const renderStreaming = (turn: Turn): void => {
    const bubble = log.querySelector('.turn:last-child .turn__bubble');
    if (bubble instanceof HTMLElement) {
      renderMarkdown(bubble, turn.text, turn.hits);
      scrollToEnd();
    }
  };

  const ask = async (question: string): Promise<void> => {
    if (busy || !question.trim()) return;

    if (!opts.apiKey) {
      turns.push({
        role: 'assistant',
        text: '',
        hits: [],
        error: 'API anahtarı yok. Sağ üstteki ayarlardan OpenRouter anahtarınızı girin.',
      });
      renderTurns();
      return;
    }

    turns.push({ role: 'user', text: question, hits: [] });
    const assistant: Turn = { role: 'assistant', text: '', hits: [] };
    turns.push(assistant);
    renderTurns();

    busy = true;

    let hits: SearchHit[] = [];
    try {
      hits = await retriever.search(question, { limit: 5 });
    } catch (err) {
      assistant.error = `Kitaplar yüklenemedi: ${(err as Error).message}`;
      busy = false;
      renderTurns();
      return;
    }

    assistant.hits = hits;

    if (!hits.length) {
      assistant.text =
        'Bu soruyla ilgili kitaplarında bir bölüm bulamadım. Farklı kelimelerle sormayı deneyebilirsin.';
      busy = false;
      renderTurns();
      return;
    }

    const messages = buildMessages(history, question, { hits, focus: opts.focus });
    controller = new AbortController();

    await streamChat(
      opts.apiKey,
      opts.model,
      messages,
      {
        onDelta(delta) {
          assistant.text += delta;
          renderStreaming(assistant);
        },
        onDone(usage) {
          history.push({ role: 'user', content: question });
          history.push({ role: 'assistant', content: assistant.text });
          renderTurns();
          opts.onUsage?.(usage);
        },
        onError(message) {
          assistant.error = message;
          renderTurns();
        },
      },
      controller.signal,
    );

    busy = false;
    controller = null;
  };

  return {
    element: root,
    ask,
    clear() {
      turns.length = 0;
      history.length = 0;
      renderTurns();
      opts.onUsage?.(null);
    },
    isBusy: () => busy,
    setOptions(next) {
      opts = { ...opts, ...next };
    },
  };
}
