import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { pdfSource, pdfjs } from '../viewers/pdfjs';

/** What the panel's head can tell from the file itself (spec §5.3): a PDF's page count, a video's length. */
export interface FileFacts {
  pages?: number;
  durationMs?: number;
}
export interface Probe {
  done: Promise<FileFacts>;
  cancel(): void;
}

/** By revision: a revision's bytes never change, so a fact read once holds for the session (a failed read is {}). */
const known = new Map<string, FileFacts>();
export const knownFacts = (revisionId: string): FileFacts | undefined => known.get(revisionId);
export const rememberFacts = (revisionId: string, facts: FileFacts): void => void known.set(revisionId, facts);

/** numPages without the whole file: no streaming and no auto-fetch, so pdf.js asks the asset protocol for ranges only. */
export function probePdf(assetId: string): Probe {
  let task: PDFDocumentLoadingTask | null = null;
  let cancelled = false;
  const done = pdfjs()
    .then(async (lib): Promise<FileFacts> => {
      if (cancelled) return {};
      task = lib.getDocument({ ...pdfSource(assetId), disableAutoFetch: true, disableStream: true });
      try {
        return { pages: (await task.promise).numPages };
      } finally {
        void task.destroy();
      }
    })
    .catch((): FileFacts => ({}));
  return {
    done,
    cancel: () => {
      cancelled = true;
      void task?.destroy();
    },
  };
}

/** The duration from the metadata alone (preload="metadata"); a file the engine cannot read gives {}. */
export function probeVideo(assetId: string): Probe {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  const release = () => {
    video.removeAttribute('src');
    video.load();
  };
  const done = new Promise<FileFacts>((resolve) => {
    video.addEventListener('loadedmetadata', () => resolve(Number.isFinite(video.duration) && video.duration > 0 ? { durationMs: Math.round(video.duration * 1000) } : {}), { once: true });
    video.addEventListener('error', () => resolve({}), { once: true });
  }).finally(release);
  video.src = assetUrl(assetId);
  return { done, cancel: release };
}

declare global {
  interface Window {
    /** E2E only: a test creates this array to count the files the panel opens; nothing is kept where it does not exist. */
    __learnProbes?: Array<{ kind: 'pdf' | 'video'; assetId: string }>;
  }
}

/** Opens the item's file for its fact (pdf.js for a PDF, a video element for a video), noting it where a test asks to count. */
export function startProbe(item: Pick<LibraryItem, 'type' | 'assetId'>): Probe {
  const kind = item.type === 'pdf' ? 'pdf' : 'video';
  window.__learnProbes?.push({ kind, assetId: item.assetId });
  return kind === 'pdf' ? probePdf(item.assetId) : probeVideo(item.assetId);
}
