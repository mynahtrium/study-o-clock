/**
 * Textbook ingestion.
 *
 * Run: npm run ingest
 *
 * Reads the gitignored PDFs from the repo root, extracts per-page text with
 * pdftotext, cleans it, tags units where the book exposes headings, and writes
 * the searchable corpus to content/. The PDFs themselves are never copied.
 *
 * The text is the searchable layer only. Anything with a formula is unreliable
 * here (stacked fractions decompose into digits), which is why the UI cites
 * page images rendered from the PDF rather than quoting extracted math.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tokenize } from '../src/coach/tokenize.ts';

const ROOT = process.cwd();
// Written under public/ so Vite serves it in dev and copies it into dist/ on
// build with no extra middleware. Lazy-fetched by the coach, per book.
const OUT = join(ROOT, 'public', 'content');
const PAGES_DIR = join(OUT, 'pages');

interface BookSpec {
  /** Stable id; also the /books/<id>.pdf route. */
  id: string;
  file: string;
  title: string;
  subject: string;
  /** Heading pattern that opens a new unit, if this book uses one. */
  unitPattern?: RegExp;
}

const BOOKS: BookSpec[] = [
  { id: 'matematik', file: 'matematik.pdf', title: 'Matematik 9', subject: 'Matematik', unitPattern: /^\d+\.\s*Tema\s*\/?\s*(.+)$/ },
  { id: 'fizik', file: 'fizik.pdf', title: 'Fizik 9', subject: 'Fizik', unitPattern: /^\d+\.\s*ÜNİTE\s*$/ },
  { id: 'kimya', file: 'kimya.pdf', title: 'Kimya 9', subject: 'Kimya', unitPattern: /^\d+\.\s*Tema\s*\/?\s*(.+)$/ },
  { id: 'biyoloji', file: 'biyoloji.pdf', title: 'Biyoloji 9', subject: 'Biyoloji', unitPattern: /^\d+\.\s*Tema\s*\/?\s*(.+)$/ },
  { id: 'cografya', file: 'cografya.pdf', title: 'Coğrafya 9', subject: 'Coğrafya', unitPattern: /^\d+\.\s*(?:ÜNİTE|Tema)\s*\/?\s*(.+)$/ },
  { id: 'tarih', file: 'tarih.pdf', title: 'Tarih 9', subject: 'Tarih' },
  { id: 'edebiyat', file: 'edebiyat.pdf', title: 'Türk Dili ve Edebiyatı 9', subject: 'Edebiyat', unitPattern: /^\d+\.\s*(?:ÜNİTE|Tema)\s*\/?\s*(.+)$/ },
];

export interface PageRecord {
  bookId: string;
  /** 1-based physical page number, matching the PDF. */
  page: number;
  unit: string | null;
  text: string;
  /** Tokens, length-prefixed so the runtime index can be rebuilt cheaply. */
  tokens: number;
}

export interface BookManifest {
  id: string;
  title: string;
  subject: string;
  pages: number;
  /** sha1 of the source PDF, so re-ingesting is skipped when unchanged. */
  hash: string;
  units: string[];
}

const REPLACEMENT_RUN = /\uFFFD+/g;

/** Removes lines that are mostly replacement chars (fill-in worksheet rules). */
function cleanPage(raw: string): string {
  const lines = raw.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const bad = (line.match(/\uFFFD/g) ?? []).length;
    if (line.length > 0 && bad / line.length > 0.4) continue;

    const trimmed = line.trim();
    if (!trimmed) {
      // Preserve at most one blank line, keeps paragraph structure.
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    // Bare page numbers and running headers.
    if (/^\d{1,3}$/.test(trimmed)) continue;
    kept.push(trimmed);
  }

  return kept
    .join('\n')
    .replace(REPLACEMENT_RUN, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeUnit(label: string | null): string | null {
  if (!label) return null;
  let out = label
    // trailing page numbers bled in from TOC-style lines
    .replace(/\s+\d{1,4}$/, '')
    // "1. Tema: Baslik" / "2 : Baslik" -> "1 Tema · Baslik"
    .replace(/^(\d+)\.\s*:?\s*/, '$1 ')
    .replace(/\s*:\s*/, ' \u00b7 ')
    .replace(/Karekodu[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A unit label longer than this is a parsing accident, not a heading.
  if (out.length > 40) return null;
  if (!out) return null;
  return out;
}

function sha1File(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

function extractPages(pdfPath: string): string[] {
  // -layout preserves column and table reading order, which matters for
  // textbooks far more than the default mode does.
  const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], {
    maxBuffer: 1024 * 1024 * 512,
    encoding: 'utf8',
  });
  return text.split('\f');
}

const FORCE = process.argv.includes('--force');

/**
 * Bump when cleaning/tagging behaviour changes. Without it, cached output
 * silently hides pipeline fixes behind an unchanged PDF hash.
 */
const PIPE_VERSION = 3;

function ingestBook(spec: BookSpec): BookManifest | null {
  const pdfPath = join(ROOT, spec.file);
  if (!existsSync(pdfPath)) {
    console.warn(`  ! ${spec.file} not found, skipping`);
    return null;
  }

  const hash = sha1File(pdfPath);
  const pagesDirBook = join(PAGES_DIR, `${spec.id}.json`);

  // Skip only when the source is unchanged AND the pipeline logic is unchanged.
  // PIPE_VERSION must be bumped whenever cleaning/tagging behaviour changes,
  // otherwise cached output silently hides the fix.
  if (!FORCE && existsSync(pagesDirBook)) {
    try {
      const existing = JSON.parse(readFileSync(pagesDirBook, 'utf8')) as {
        sourceHash: string;
        pipeVersion?: number;
        pages: PageRecord[];
      };
      if (existing.sourceHash === hash && existing.pipeVersion === PIPE_VERSION) {
        console.log(`  = ${spec.id}: unchanged, skipping extraction`);
        return {
          id: spec.id,
          title: spec.title,
          subject: spec.subject,
          pages: existing.pages.length,
          hash,
          units: [...new Set(existing.pages.map((p) => p.unit).filter((u): u is string => !!u))],
        };
      }
    } catch {
      // Corrupt cache; fall through and rebuild.
    }
  }

  const rawPages = extractPages(pdfPath);
  const pages: PageRecord[] = [];
  let currentUnit: string | null = null;
  const units: string[] = [];

  rawPages.forEach((raw, index) => {
    const text = cleanPage(raw);
    if (!text) return;

    if (spec.unitPattern) {
      for (const line of text.split('\n').slice(0, 12)) {
        const trimmed = line.trim();
        // Table-of-contents pages produce garbage unit labels: they are long,
        // carry dot leaders, and pack several headings onto one line.
        if (trimmed.length > 60) continue;
        if (/\.{3,}|\u2026/.test(trimmed)) continue;
        if (trimmed.split(/\s{3,}/).length > 2) continue;

        const m = spec.unitPattern.exec(trimmed);
        if (m) {
          const label = (m[1] ?? '').trim();
          const num = /^(\d+)\./.exec(trimmed)?.[1];
          const candidate = normalizeUnit(
            label ? `${num ?? ''} ${label}` : `\u00dcnite ${num ?? ''}`,
          );
          if (candidate) {
            currentUnit = candidate;
            if (!units.includes(candidate)) units.push(candidate);
          }
          break;
        }
      }
    }

    pages.push({
      bookId: spec.id,
      page: index + 1,
      unit: currentUnit,
      text,
      tokens: tokenize(text).length,
    });
  });

  const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
  const junkPct = rawPages.reduce(
    (n, p) => n + (p.match(/\uFFFD/g) ?? []).length,
    0,
  );

  writeFileSync(pagesDirBook, JSON.stringify({ sourceHash: hash, pipeVersion: PIPE_VERSION, pages }));
  console.log(
    `  + ${spec.id}: ${pages.length} pages, ${totalChars.toLocaleString('tr-TR')} chars, ` +
      `${units.length} units, ${junkPct.toLocaleString('tr-TR')} junk chars stripped`,
  );

  return { id: spec.id, title: spec.title, subject: spec.subject, pages: pages.length, hash, units };
}

function main(): void {
  console.log("Study O'Clock \u2014 ingesting textbooks\n");
  mkdirSync(PAGES_DIR, { recursive: true });

  const manifests: BookManifest[] = [];
  for (const spec of BOOKS) {
    const m = ingestBook(spec);
    if (m) manifests.push(m);
  }

  writeFileSync(join(OUT, 'books.json'), JSON.stringify({ books: manifests }, null, 2));
  console.log(`\nWrote ${manifests.length} books to public/content/books.json`);
}

main();
