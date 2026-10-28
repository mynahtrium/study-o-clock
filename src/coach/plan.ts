import { listModels } from './openrouter';
import type { ChatMessage } from './openrouter';

export interface PlanBlock {
  time: string;
  subject: string;
  task: string;
  pages: string;
}

export interface Plan {
  date: string;
  blocks: PlanBlock[];
  note: string;
}

const CACHE_KEY = 'soc.plan.v1';

function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

interface CachedPlan {
  date: string;
  plan: Plan;
}

function readCache(): Plan | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPlan;
    // Plans are per-day; yesterday's plan is not today's.
    return parsed.date === todayKey() ? parsed.plan : null;
  } catch {
    return null;
  }
}

function writeCache(plan: Plan): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ date: plan.date, plan }));
  } catch {
    // non-fatal
  }
}

const PLAN_PROMPT = `Sen bir ders koçusun. Öğrenciye bugün için gerçekçi bir çalışma planı hazırla.

Kurallar:
- Yalnızca aşağıda listelenen dersler ve konumlar üzerinden plan yap.
- 3-5 blok üret. Toplam süre 2-3 saat olsun, bloklar 25-50 dakika arası.
- Saatleri "16:00-16:45" biçiminde yaz. Sabah saatlerini kullanma (okul var).
- En zor/öncelikli dersi ilk bloğa koy.
- Her blokta konu adı ve sayfa aralığı olsun.
- Yanıtı SADECE şu JSON biçiminde ver, başka hiçbir şey yazma:
{"blocks":[{"time":"16:00-16:45","subject":"Matematik","task":"Üslü sayılar tekrarı","pages":"s. 34-41"}],"note":"kısa bir motivasyon cümlesi"}`;

export interface PlanInput {
  /** Current unit per book, derived from the manifest. */
  progress: Array<{ subject: string; unit: string | null; page: number }>;
  streak: number;
}

/**
 * Generates a plan for today through OpenRouter and caches it per day.
 *
 * Uses a strict JSON output shape and falls back to a deterministic local plan
 * if the model returns something unparseable, so the panel never renders empty.
 */
export async function generatePlan(
  apiKey: string,
  model: string,
  input: PlanInput,
): Promise<Plan> {
  if (!apiKey || !model) {
    return fallbackPlan(input);
  }

  const progressText = input.progress
    .map((p) => `- ${p.subject}: ${p.unit ?? 'konum bilinmiyor'} (şu an s. ${p.page})`)
    .join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: PLAN_PROMPT },
    {
      role: 'user',
      content: `Bugünkü durum:\n${progressText}\n\nÇalışma serisi: ${input.streak} gün.\n\nBugün için plan hazırla.`,
    },
  ];

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': location.origin,
        'X-Title': "Study O'Clock",
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.4,
      }),
    });

    if (!res.ok) return fallbackPlan(input);

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';

    const parsed = JSON.parse(content) as {
      blocks?: Array<{ time?: string; subject?: string; task?: string; pages?: string }>;
      note?: string;
    };

    const blocks: PlanBlock[] = (parsed.blocks ?? [])
      .filter((b) => b.time && b.subject && b.task)
      .map((b) => ({
        time: b.time ?? '',
        subject: b.subject ?? '',
        task: b.task ?? '',
        pages: b.pages ?? '',
      }));

    if (!blocks.length) return fallbackPlan(input);

    const plan: Plan = {
      date: todayKey(),
      blocks,
      note: parsed.note ?? 'Bugün defterini aç, gerisi gelir.',
    };
    writeCache(plan);
    return plan;
  } catch {
    return fallbackPlan(input);
  }
}

export function cachedPlan(): Plan | null {
  return readCache();
}

/** Deterministic plan used when there is no key, no network, or bad JSON. */
function fallbackPlan(input: PlanInput): Plan {
  const subjects = input.progress.length
    ? input.progress.slice(0, 3)
    : [{ subject: 'Matematik', unit: null, page: 1 }];

  const times = ['16:00-16:45', '17:00-17:40', '19:00-19:35'];
  const blocks: PlanBlock[] = subjects.map((s, i) => {
    // When no progress is known yet, suggest the opening section rather than a
    // degenerate "s. 1-1" that reads like a bug.
    const known = s.page > 1;
    const from = known ? Math.max(1, s.page - 6) : 1;
    const to = known ? s.page : 20;
    return {
      time: times[i] ?? '20:00-20:30',
      subject: s.subject,
      task: s.unit ?? 'başlangıç konusu',
      pages: `s. ${from}-${to}`,
    };
  });

  return {
    date: todayKey(),
    blocks,
    note: 'Küçük adımlar birikir. Bugün sadece ilk bloğu bitir.',
  };
}

/** Ensures the chosen model can return JSON; used to filter the picker later. */
export async function modelSupportsJson(modelId: string): Promise<boolean> {
  try {
    const models = await listModels();
    return models.some((m) => m.id === modelId);
  } catch {
    return false;
  }
}
