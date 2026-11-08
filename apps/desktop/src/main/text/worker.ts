import { extractDocument } from './extract-document';
import type { ExtractRequest } from './messages';

// One request at a time: main sends the next one only after this one's done or failed.
process.parentPort.on('message', (e) => void extractDocument(e.data as ExtractRequest, (m) => process.parentPort.postMessage(m)));
