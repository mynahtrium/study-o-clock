/**
 * Turkish-aware tokenizer, shared by the index builder and the retriever.
 * Both must agree exactly, so this is the single source of truth.
 *
 * Note: no stemming. Turkish is agglutinative, and hand-rolled suffix
 * stripping is far more likely to destroy a match ("yasa" -> "yas") than to
 * create one. Convergence is instead handled by prefix matching at query
 * time — see `expandPrefixes` in retrieve.ts.
 */

/**
 * Turkish casing is not the default Unicode mapping: I -> ı and İ -> i.
 * Using 'tr' locale rules keeps "IŞIK" and "ışık" on the same term.
 */
function lowerTr(input: string): string {
  return input.toLocaleLowerCase('tr-TR');
}

/**
 * Fold diacritics so a query typed without Turkish characters still matches:
 * "ışık" and "isik" both become "isik". This is a search convenience layer,
 * not locale-correct display text.
 */
const FOLD: Record<string, string> = {
  ı: 'i',
  ş: 's',
  ğ: 'g',
  ü: 'u',
  ö: 'o',
  ç: 'c',
  â: 'a',
  î: 'i',
  û: 'u',
};

function fold(input: string): string {
  let out = '';
  for (const ch of input) out += FOLD[ch] ?? ch;
  return out;
}

/**
 * Function words and textbook scaffolding. Dropping these is what keeps
 * "nasıl yapılır" from dominating every query.
 */
const STOPWORDS = new Set([
  've', 'veya', 'ile', 'bir', 'bu', 'su', 'o', 'da', 'de', 'ki', 'mi', 'mu',
  'icin', 'gibi', 'kadar', 'daha', 'cok', 'az', 'en', 'her', 'hem', 'ama', 'fakat', 'ancak',
  'ise', 'olarak', 'olan', 'oldugu', 'oldugunu', 'olur', 'olmak', 'oldukca',
  'ne', 'nasil', 'neden', 'nicin', 'hangi', 'kim', 'nerede', 'nereden',
  'var', 'yok', 'degil', 'sonra', 'once', 'simdi', 'bile', 'sadece', 'yine',
  'uzerinde', 'altinda', 'arasinda', 'icinde', 'disinda', 'yoluyla', 'tarafindan',
  'asagidaki', 'yukaridaki', 'asagida', 'yukarida', 'verilen', 'asagidakilerden',
  'buna', 'bunun', 'bunu', 'bunlar', 'sekilde', 'sekildeki',
  'soru', 'sayfa', 'etkinlik', 'cevaplayiniz', 'yaziniz', 'bulunuz', 'aciklayiniz',
  'inceleyiniz', 'tartisiniz', 'dusununuz', 'belirtiniz', 'sinif', 'yönerge', 'yonerge',
  'gorsel', 'tablo', 'metin', 'metni', 'ornek', 'ornak', 'olarak',
]);

const WORD_RE = /[\p{L}\p{N}]+/gu;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(WORD_RE) ?? []) {
    // Pure numbers are meaningful in a textbook (exponents, page refs).
    if (/^\d+$/.test(raw)) {
      if (raw.length <= 4) out.push(raw);
      continue;
    }
    const folded = fold(lowerTr(raw));
    if (folded.length < 2) continue;
    if (STOPWORDS.has(folded)) continue;
    out.push(folded);
  }
  return out;
}

export function tokenizeQuery(query: string): string[] {
  return tokenize(query);
}

/** Minimum length before partial matching kicks in. */
export const PREFIX_MIN_LENGTH = 5;

/**
 * Given a query term, returns every indexed term that should match it.
 *
 * A term matches when either side is a prefix of the other and both are at
 * least PREFIX_MIN_LENGTH long. This makes "iklim" match "iklimler",
 * "iklimi", "iklimin" without needing a real stemmer, while short words
 * still match exactly only.
 */
export function expandPrefixes(term: string, vocabulary: Iterable<string>): string[] {
  if (term.length < PREFIX_MIN_LENGTH) return [term];
  const matches: string[] = [];
  for (const candidate of vocabulary) {
    if (candidate.length < PREFIX_MIN_LENGTH) continue;
    if (candidate === term) {
      matches.push(candidate);
    } else if (candidate.startsWith(term) || term.startsWith(candidate)) {
      matches.push(candidate);
    }
  }
  return matches;
}
