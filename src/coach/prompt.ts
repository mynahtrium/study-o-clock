import type { ChatMessage } from './openrouter';
import type { SearchHit } from './retrieve';

/**
 * The system prompt is doing real work here, not decoration:
 *
 * 1. Grounding — answer only from the retrieved pages, so the coach cannot
 *    invent a curriculum that isn't yours.
 * 2. Formula safety — extracted text destroys stacked fractions and radicals
 *    ("__" runs, stray "$"), so the model is told to describe notation and
 *    point at the page rather than transcribe it. This is the single most
 *    important instruction in the app.
 * 3. Citation format — a machine-parseable marker that the UI turns into
 *    clickable page chips.
 */
export const SYSTEM_PROMPT = `Sen Türkiye MEB 9. sınıf müfredatına göre çalışan bir ders koçusun. Adın "Study O'Clock".

Kurallar:
- Yalnızca sana verilen SAYFA METİNLERİNE dayanarak cevap ver. Sayfalarda olmayan bir bilgi sorulursa açıkça "Bu bilgi verilen sayfalarda yok" de ve neyin eksik olduğunu söyle. Bilgi uydurma.
- Her önemli iddiadan sonra kaynak ver: [s. 42] biçiminde. Birden fazla sayfa varsa [s. 42, s. 43] yaz.
- ÇOK ÖNEMLİ: Sana verilen metin, PDF'ten otomatik çıkarılmıştır ve MATEMATİKSEL GÖSTERİMLER BOZULMUŞTUR. Kesirler, kökler, üsler ve altlı/üstlü ifadeler anlamsız karakter yığınlarına dönüşür (örneğin "144444424444443", "_x $ yi", "a $ b").
  * Bozuk bir gösterimi ASLA aynen yazma veya tahmin ederek "düzeltme".
  * Bunun yerine gösterimi SÖZLEL olarak tarif et ("tabanı 2, üssü 5 olan ifade") ve öğrenciye ilgili sayfayı göstermesi için [s. N] bağlantısını kullanmasını söyle.
  * Sayfaların görüntüsü öğrenciye ayrıca gösterilecek; asıl kaynak odur.
- Türkçe, sade ve öğrenci dostu bir dille yaz. Gereksiz giriş cümlesi kurma; doğrudan konuya gir.
- Bir konuyu açıklarken adım adım ilerle, sonunda tek cümlelik bir özet ver.
- Soru belirsizse hangi sayfadan başlamak istediğini sor.`;

export interface RetrievalContext {
  hits: SearchHit[];
  /** Where the student currently is, if known. */
  focus?: { bookTitle: string; page: number; unit: string | null } | null;
}

/**
 * Builds the page block handed to the model.
 *
 * Pages are truncated individually rather than dropping whole pages: a textbook
 * page is mostly whitespace, headers and exercise scaffolding, so the first
 * ~1,400 characters carry the actual exposition. Truncation is marked so the
 * model knows it is not seeing the whole page.
 */
const MAX_CHARS_PER_PAGE = 1400;

export function buildContextBlock(context: RetrievalContext): string {
  if (!context.hits.length) {
    return 'SAYFA METNİ: (arama sonucu bulunamadı)';
  }

  const blocks = context.hits.map((hit) => {
    const body =
      hit.text.length > MAX_CHARS_PER_PAGE
        ? `${hit.text.slice(0, MAX_CHARS_PER_PAGE)}\n[…sayfanın devamı]`
        : hit.text;
    const unit = hit.unit ? ` | ${hit.unit}` : '';
    return `--- ${hit.bookTitle}${unit} | s. ${hit.page} [s. ${hit.page}] ---\n${body}`;
  });

  const focus = context.focus
    ? `\nÖĞRENCİNİN ŞU ANKİ KONUMU: ${context.focus.bookTitle}, s. ${context.focus.page}${context.focus.unit ? ` (${context.focus.unit})` : ''}. Kısa ve bağlamsız soruları bu konuma göre yorumla.\n`
    : '';

  return `${focus}\nSAYFA METİNLERİ:\n\n${blocks.join('\n\n')}`;
}

export function buildMessages(
  history: ChatMessage[],
  question: string,
  context: RetrievalContext,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  // Trim history to the last few turns: the retrieved pages are what matters,
  // and a long transcript only dilutes them.
  const recent = history.slice(-6);
  messages.push(...recent);

  messages.push({
    role: 'user',
    content: `${buildContextBlock(context)}\n\nSORU: ${question}`,
  });

  return messages;
}

/**
 * Pulls page numbers out of "[s. 42]" / "[s. 42, s. 43]" markers so the UI can
 * render page chips. Returns page numbers in first-appearance order.
 */
export function extractCitedPages(answer: string): number[] {
  const found = new Set<number>();
  const re = /\[\s*s\.?\s*(\d{1,4})(?:\s*[,–-]\s*(?:s\.?\s*)?(\d{1,4}))?\s*\]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    const first = Number(match[1]);
    if (Number.isFinite(first)) found.add(first);
    // Expand a short range like [s. 42-44].
    const second = match[2] ? Number(match[2]) : null;
    if (second !== null && Number.isFinite(second) && second > first && second - first <= 3) {
      for (let p = first + 1; p <= second; p++) found.add(p);
    }
  }
  return [...found];
}
