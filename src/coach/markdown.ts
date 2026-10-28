import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { openPage } from '../viewer/page-viewer';
import type { SearchHit } from './retrieve';

/**
 * Markdown rendering for coach answers.
 *
 * Two hard rules:
 *
 * 1. Citations become interactive chips. `[s. 42]` is rewritten into a marker
 *    element *before* parsing, because running regexes over generated HTML is
 *    how you end up with tags inside attributes.
 * 2. Model output is never trusted. It goes through DOMPurify with an explicit
 *    allowlist, so a prompt-injected textbook page cannot inject a script or an
 *    event handler into a page that also holds the user's API key.
 */

marked.setOptions({
  gfm: true,
  breaks: true,
});

/** Placeholder element inserted where a citation should appear. */
const CITE_TAG = 'soc-cite';
const CITE_RE = /\[\s*s\.?\s*(\d{1,4})(?:\s*[,–-]\s*(?:s\.?\s*)?(\d{1,4}))?\s*\]/gi;

/**
 * Rewrites "[s. 42]" and "[s. 42, s. 43]" into marker tags, expanding short
 * ranges so [s. 42-44] yields three chips.
 */
function markCitations(text: string): string {
  return text.replace(CITE_RE, (_match, firstRaw: string, secondRaw?: string) => {
    const first = Number(firstRaw);
    if (!Number.isFinite(first)) return _match;

    const pages = [first];
    const second = secondRaw ? Number(secondRaw) : null;
    // Only expand genuinely short ranges; a stray large number is a typo, not
    // a request for twenty chips.
    if (second !== null && Number.isFinite(second) && second > first && second - first <= 3) {
      for (let p = first + 1; p <= second; p++) pages.push(p);
    }

    return pages.map((p) => `<${CITE_TAG} data-page="${p}"></${CITE_TAG}>`).join(' ');
  });
}

/**
 * Resolves a cited page to the retrieved page that actually carries it, so a
 * chip opens the right book instead of assuming the top hit.
 */
function resolveSource(page: number, sources: SearchHit[]): SearchHit | undefined {
  return (
    sources.find((h) => h.page === page) ??
    sources.find((h) => Math.abs(h.page - page) <= 2) ??
    sources[0]
  );
}

/**
 * Renders an answer into `target`.
 *
 * Streaming calls this repeatedly with growing text. It is cheap enough for
 * that (a few KB of markdown) but clearly not free, which is why callers only
 * re-render the last answer's node rather than the whole log.
 */
export function renderMarkdown(target: HTMLElement, text: string, sources: SearchHit[]): void {
  const withMarkers = markCitations(text);
  const rawHtml = marked.parse(withMarkers, { async: false });

  target.innerHTML = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'a', 'span',
      CITE_TAG,
    ],
    ALLOWED_ATTR: ['href', 'title', 'class', 'data-page'],
    // No scripts, no styles, no event handlers, no iframes. DOMPurify strips
    // javascript: URLs on its own, but being explicit documents the intent.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'srcdoc'],
  });

  // Links open outside the app; citations become chips.
  for (const anchor of target.querySelectorAll('a')) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }

  for (const marker of target.querySelectorAll(CITE_TAG)) {
    const page = Number(marker.getAttribute('data-page'));
    if (!Number.isFinite(page)) continue;

    const source = resolveSource(page, sources);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cite';
    chip.textContent = `s. ${page}`;
    chip.title = source ? `${source.bookTitle} \u00b7 s. ${page}` : `Sayfay\u0131 a\u00e7`;
    chip.addEventListener('click', () => {
      if (source) openPage(source.bookId, page);
    });
    marker.replaceWith(chip);
  }
}

/** Plain-text fallback for places that only need a readable excerpt. */
export function stripMarkdown(text: string): string {
  return text
    .replace(CITE_RE, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
