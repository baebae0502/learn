// pdf.js ships no types for its worker module; the worker only hands it to globalThis.pdfjsWorker.
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
