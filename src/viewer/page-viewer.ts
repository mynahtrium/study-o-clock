/**
 * On-demand PDF page rendering.
 *
 * The textbooks are never pre-rendered: all 1,757 pages would be ~195 MB of
 * JPEGs. Instead PDF.js reads the local PDF through the /books/<id>.pdf
 * middleware (which supports range requests) and paints just the page you
 * asked for. That also gives exact vector fidelity at any zoom, which matters
 * because extracted text cannot reproduce a printed formula.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { recordVisit } from '../coach/progress';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Unit label lookup, filled lazily from the ingested corpus so a visit can be
 * tagged with the chapter the student landed in.
 */
const unitCache = new Map<string, Array<{ page: number; unit: string | null }>>();

async function pageUnit(bookId: string, page: number): Promise<string | null> {
  try {
    let entries = unitCache.get(bookId);
    if (!entries) {
      const res = await fetch(`/content/pages/${bookId}.json`);
      if (!res.ok) return null;
      const data = (await res.json()) as { pages: Array<{ page: number; unit: string | null }> };
      entries = data.pages.map((p) => ({ page: p.page, unit: p.unit }));
      unitCache.set(bookId, entries);
    }
    // Nearest page at or before the requested one carries the unit.
    let found: string | null = null;
    for (const entry of entries) {
      if (entry.page > page) break;
      found = entry.unit;
    }
    return found;
  } catch {
    return null;
  }
}

const docs = new Map<string, Promise<pdfjs.PDFDocumentProxy>>();

function loadDoc(bookId: string): Promise<pdfjs.PDFDocumentProxy> {
  let doc = docs.get(bookId);
  if (!doc) {
    doc = pdfjs.getDocument({ url: `/books/${encodeURIComponent(bookId)}.pdf` }).promise;
    docs.set(bookId, doc);
  }
  return doc;
}

let overlay: HTMLElement | null = null;
let currentRender: pdfjs.RenderTask | null = null;

function buildOverlay(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Sayfa görüntüleyici');
  root.hidden = true;

  const bar = document.createElement('div');
  bar.className = 'viewer__bar';

  const label = document.createElement('span');
  label.className = 'viewer__label';

  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.className = 'viewer__btn';
  zoomOut.textContent = '\u2212';
  zoomOut.title = 'Uzaklaştır';

  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.className = 'viewer__btn';
  zoomIn.textContent = '+';
  zoomIn.title = 'Yakınlaştır';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'viewer__btn viewer__btn--close';
  close.textContent = '\u00d7';
  close.title = 'Kapat (Esc)';
  close.setAttribute('aria-label', 'Kapat');

  bar.append(label, zoomOut, zoomIn, close);

  const scroll = document.createElement('div');
  scroll.className = 'viewer__scroll scrollable scrollable--viewer';

  const canvas = document.createElement('canvas');
  canvas.className = 'viewer__canvas';
  scroll.append(canvas);

  root.append(bar, scroll);
  document.body.append(root);

  close.addEventListener('click', () => {
    root.hidden = true;
  });
  root.addEventListener('click', (event) => {
    if (event.target === root) root.hidden = true;
  });

  return root;
}

export interface PageViewerHandle {
  open: (bookId: string, page: number) => Promise<void>;
  close: () => void;
  isOpen: () => boolean;
}

export function createPageViewer(): PageViewerHandle {
  let zoom = 1.15;
  let last: { bookId: string; page: number } | null = null;

  const ensure = (): HTMLElement => {
    if (!overlay) overlay = buildOverlay();
    return overlay;
  };

  const render = async (bookId: string, page: number): Promise<void> => {
    const root = ensure();
    const canvas = root.querySelector('canvas');
    const label = root.querySelector('.viewer__label');
    if (!(canvas instanceof HTMLCanvasElement) || !(label instanceof HTMLElement)) return;

    label.textContent = `${bookId} \u00b7 s. ${page} y\u00fckleniyor\u2026`;

    try {
      const doc = await loadDoc(bookId);
      const pdfPage = await doc.getPage(page);
      // Render at device pixel ratio so text is crisp on any display.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: zoom * dpr });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;

      // Cancel an in-flight render before starting a new one.
      currentRender?.cancel();
      const context = canvas.getContext('2d');
      if (!context) return;
      currentRender = pdfPage.render({ canvasContext: context, viewport });
      await currentRender.promise;
      currentRender = null;

      label.textContent = `${bookId} \u00b7 s. ${page}`;
    } catch (err) {
      if ((err as Error).name !== 'RenderingCancelledException') {
        label.textContent = `Sayfa y\u00fcklenemedi (${bookId} s. ${page})`;
      }
    }
  };

  const open = async (bookId: string, page: number): Promise<void> => {
    const root = ensure();
    root.hidden = false;
    last = { bookId, page };
    await render(bookId, page);
    // Remember where the student is; this feeds the coach's focus context.
    void pageUnit(bookId, page).then((unit) => recordVisit(bookId, page, unit));
  };

  const bindZoom = (): void => {
    const root = ensure();
    const [zoomOut, zoomIn] = [...root.querySelectorAll('.viewer__btn')];
    zoomOut?.addEventListener('click', () => {
      zoom = Math.max(0.5, zoom - 0.25);
      if (last) void render(last.bookId, last.page);
    });
    zoomIn?.addEventListener('click', () => {
      zoom = Math.min(4, zoom + 0.25);
      if (last) void render(last.bookId, last.page);
    });
  };
  bindZoom();

  return {
    open,
    close() {
      if (overlay) overlay.hidden = true;
    },
    isOpen() {
      return !!overlay && !overlay.hidden;
    },
  };
}

const viewer = createPageViewer();

export function openPage(bookId: string, page: number): void {
  void viewer.open(bookId, page);
}

export function closePage(): void {
  viewer.close();
}

export function isPageOpen(): boolean {
  return viewer.isOpen();
}
