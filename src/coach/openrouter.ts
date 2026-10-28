export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number;
  /** USD per million input tokens. */
  promptPrice: number;
  /** USD per million output tokens. */
  completionPrice: number;
  supportsTools: boolean;
}

interface RawModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
}

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const APP_HEADERS = {
  'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'http://localhost',
  'X-Title': "Study O'Clock",
};

let cachedModels: OpenRouterModel[] | null = null;

export async function listModels(force = false): Promise<OpenRouterModel[]> {
  if (cachedModels && !force) return cachedModels;

  const res = await fetch(MODELS_URL);
  if (!res.ok) throw new Error(`Model listesi alınamadı (${res.status})`);

  const data = (await res.json()) as { data: RawModel[] };
  cachedModels = data.data
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextLength: m.context_length ?? 0,
      // API prices are USD per token; convert to per-million for display.
      promptPrice: Number(m.pricing?.prompt ?? 0) * 1_000_000,
      completionPrice: Number(m.pricing?.completion ?? 0) * 1_000_000,
      supportsTools: (m.supported_parameters ?? []).includes('tools'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return cachedModels;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Cost in USD when the provider reports it. */
  cost: number | null;
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: (usage: Usage | null) => void;
  onError: (message: string) => void;
}

/**
 * Streams a chat completion.
 *
 * Uses fetch + ReadableStream rather than EventSource, because EventSource
 * cannot issue a POST or set an Authorization header.
 */
export async function streamChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  if (!apiKey) {
    handlers.onError('API anahtarı ayarlanmamış. Ayarlar (S) bölümünden ekleyin.');
    return;
  }
  if (!model) {
    handlers.onError('Model seçilmemiş. Ayarlar (S) bölümünden bir model seçin.');
    return;
  }

  let res: Response;
  try {
    res = await fetch(CHAT_URL, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...APP_HEADERS,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        usage: { include: true },
      }),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    handlers.onError('Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.');
    return;
  }

  if (!res.ok) {
    handlers.onError(await describeHttpError(res));
    return;
  }
  if (!res.body) {
    handlers.onError('Sunucu boş yanıt döndürdü.');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: Usage | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
              error?: { message?: string };
            };

            if (parsed.error?.message) {
              handlers.onError(parsed.error.message);
              return;
            }

            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) handlers.onDelta(delta);

            if (parsed.usage) {
              usage = {
                promptTokens: parsed.usage.prompt_tokens ?? 0,
                completionTokens: parsed.usage.completion_tokens ?? 0,
                totalTokens: parsed.usage.total_tokens ?? 0,
                cost: typeof parsed.usage.cost === 'number' ? parsed.usage.cost : null,
              };
            }
          } catch {
            // A malformed frame should not kill an otherwise good stream.
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      handlers.onError('Yanıt akışı kesildi.');
      return;
    }
  }

  handlers.onDone(usage);
}

async function describeHttpError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // no JSON body
  }

  switch (res.status) {
    case 401:
      return 'API anahtarı geçersiz. Ayarlardan kontrol edin.';
    case 402:
      return 'Yetersiz bakiye. OpenRouter hesabınıza kredi ekleyin.';
    case 429:
      return 'İstek sınırı aşıldı. Kısa bir süre bekleyip tekrar deneyin.';
    case 404:
      return `Model bulunamadı${detail ? `: ${detail}` : '.'}`;
    default:
      return `İstek başarısız (${res.status})${detail ? `: ${detail}` : '.'}`;
  }
}
