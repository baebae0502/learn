import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export interface HashOptions {
  /** Stops the read: the promise rejects with an AbortError (the import queue's cancel points, spec 3.5). */
  signal?: AbortSignal;
  /** Called with each chunk's size as it is hashed (the progress bar counts hashed bytes, spec 3.3). */
  onBytes?: (bytes: number) => void;
}

export async function sha256File(filePath: string, opts: HashOptions = {}): Promise<string> {
  opts.signal?.throwIfAborted();
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath, { signal: opts.signal })) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    opts.onBytes?.(bytes.length);
  }
  return hash.digest('hex');
}
