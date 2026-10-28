import { expandPrefixes, tokenizeQuery } from './tokenize';

export interface CorpusPage {
  bookId: string;
  page: number;
  unit: string | null;
  text: string;
}

export interface BookManifest {
  id: string;
  title: string;
  subject: string;
  pages: number;
  hash: string;
  units: string[];
}

export interface SearchHit extends CorpusPage {
  score: number;
  bookTitle: string;
}

interface BookIndex {
  termFreq: Map<string, number>;
  postings: Map<string, Map<number, number>>;
  lengths: number[];
  pages: CorpusPage[];
  avgLength: number;
}

const K1 = 1.35;
const B = 0.7;

/**
 * Picks the books whose titles match words in the query, so "fizik" or
 * "kimya" in a question narrows the search instead of poisoning it.
 */
const BOOK_HINTS: Record<string, string[]> = {
  matematik: ['matematik', 'mat', 'geometri', 'cebir', 'denklem', 'uslu', 'koklu'],
  fizik: ['fizik', 'vektor', 'kuvvet', 'hareket', 'enerji', 'elektrik'],
  kimya: ['kimya', 'atom', 'element', 'bilesik', 'mol', 'reaksiyon', 'periyodik'],
  biyoloji: ['biyoloji', 'hucre', 'doku', 'organ', 'canli', 'organizma', 'enzim'],
  cografya: ['cografya', 'iklim', 'harita', 'nufus', 'yeryuzu', 'bolge', 'ekonomi'],
  tarih: ['tarih', 'osmanli', 'selcuklu', 'cumhuriyet', 'savas', 'antlasma', 'devlet'],
  edebiyat: ['edebiyat', 'siir', 'roman', 'hikaye', 'metin', 'yazar', 'dil', 'anlatim'],
};

function inferBooks(terms: string[], available: string[]): string[] {
  const matched = new Set<string>();
  for (const term of terms) {
    for (const [bookId, hints] of Object.entries(BOOK_HINTS)) {
      if (!available.includes(bookId)) continue;
      if (hints.some((h) => term === h || term.startsWith(h) || h.startsWith(term))) {
        matched.add(bookId);
      }
    }
  }
  return [...matched];
}

/**
 * Lazily builds one BM25 index per book and keeps it warm.
 *
 * Rebuilding a ~280-page book takes a few milliseconds, so there is no reason
 * to ship a precomputed index: only books you actually consult get indexed,
 * and the committed corpus stays tiny (3.6 MB for all seven books).
 */
export class Retriever {
  private books = new Map<string, BookManifest>();
  private indexes = new Map<string, BookIndex>();
  private loaded = false;

  async load(): Promise<BookManifest[]> {
    if (this.loaded) return [...this.books.values()];
    const res = await fetch('/content/books.json');
    if (!res.ok) throw new Error(`Kitap listesi yüklenemedi (${res.status})`);
    const data = (await res.json()) as { books: BookManifest[] };
    this.books = new Map(data.books.map((b) => [b.id, b]));
    this.loaded = true;
    return data.books;
  }

  manifests(): BookManifest[] {
    return [...this.books.values()];
  }

  private async loadBook(id: string): Promise<BookIndex | null> {
    const cached = this.indexes.get(id);
    if (cached) return cached;

    const res = await fetch(`/content/pages/${id}.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as { pages: CorpusPage[] };

    const postings = new Map<string, Map<number, number>>();
    const termFreq = new Map<string, number>();
    const lengths: number[] = [];

    data.pages.forEach((page, pageIndex) => {
      const tokens = tokenizeQuery(page.text);
      lengths.push(tokens.length);

      const counts = new Map<string, number>();
      for (const tok of tokens) counts.set(tok, (counts.get(tok) ?? 0) + 1);

      for (const [tok, count] of counts) {
        termFreq.set(tok, (termFreq.get(tok) ?? 0) + count);
        let posting = postings.get(tok);
        if (!posting) {
          posting = new Map();
          postings.set(tok, posting);
        }
        posting.set(pageIndex, count);
      }
    });

    const avgLength = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
    const built: BookIndex = { postings, termFreq, lengths, pages: data.pages, avgLength };
    this.indexes.set(id, built);
    return built;
  }

  async search(
    query: string,
    options: { books?: string[]; unit?: string | null; limit?: number } = {},
  ): Promise<SearchHit[]> {
    const terms = [...new Set(tokenizeQuery(query))];
    if (!terms.length) return [];

    const limit = options.limit ?? 5;
    const allIds = this.manifests().map((b) => b.id);

    // Explicit selection wins; otherwise infer a subject from the wording.
    let bookIds = options.books?.length ? options.books : allIds;
    if (!options.books?.length) {
      const inferred = inferBooks(terms, allIds);
      if (inferred.length && inferred.length < allIds.length) bookIds = inferred;
    }

    const hits: SearchHit[] = [];

    for (const id of bookIds) {
      const book = await this.loadBook(id);
      if (!book) continue;
      const manifest = this.books.get(id);
      const total = book.pages.length;

      // Resolve each query term to the concrete indexed terms it should match.
      const expanded = new Map<string, string[]>();
      for (const term of terms) {
        expanded.set(term, expandPrefixes(term, book.termFreq.keys()));
      }

      const scores = new Map<number, number>();

      for (const [term, variants] of expanded) {
        if (!variants.length) continue;

        // Aggregate document frequency across variants for a fair idf.
        const docs = new Set<number>();
        for (const variant of variants) {
          const p = book.postings.get(variant);
          if (p) for (const idx of p.keys()) docs.add(idx);
        }
        if (!docs.size) continue;

        const idf = Math.max(0.05, Math.log(1 + (total - docs.size + 0.5) / (docs.size + 0.5)));

        for (const variant of variants) {
          const posting = book.postings.get(variant);
          if (!posting) continue;
          for (const [pageIndex, tf] of posting) {
            const page = book.pages[pageIndex];
            if (!page) continue;
            if (options.unit && page.unit !== options.unit) continue;

            const len = book.lengths[pageIndex] ?? 0;
            const norm = 1 - B + B * (len / (book.avgLength || 1));
            const contribution = idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
            scores.set(pageIndex, (scores.get(pageIndex) ?? 0) + contribution);
          }
        }
        void term;
      }

      for (const [pageIndex, score] of scores) {
        const page = book.pages[pageIndex];
        if (!page) continue;

        // Rerank slightly toward pages where the query words appear near each
        // other. Pure BM25 rewards any page that repeats a term a lot, which
        // lets an unrelated "etkinlik" page outrank the actual section.
        const base = page.text.toLocaleLowerCase('tr-TR');
        let proximity = 0;
        for (const term of terms) {
          if (term.length < 4) continue;
          if (base.includes(term)) proximity += 1;
        }
        const locality = terms.length > 1 ? proximity / terms.length : 0;

        hits.push({
          ...page,
          score: score * (1 + 0.25 * locality),
          bookTitle: manifest?.title ?? id,
        });
      }
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export const retriever = new Retriever();
