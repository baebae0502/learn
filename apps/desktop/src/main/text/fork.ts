import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { utilityProcess } from 'electron';
import { mainStrings } from '../strings';
import type { WorkerPort } from './extractor';
import type { ExtractRequest } from './messages';

/** The body-text worker as a utility process, below normal priority so the app's own work comes first. */
export function forkTextWorker(entry: string): WorkerPort {
  const child = utilityProcess.fork(entry, [], { serviceName: mainStrings.textWorker.serviceName, execArgv: ['--max-old-space-size=1024'], stdio: 'pipe' });
  child.stdout?.resume();
  child.stderr?.resume();
  child.once('spawn', () => {
    if (child.pid === undefined) return;
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // The process may be gone already, or the system may refuse; the priority is a courtesy.
    }
  });
  return {
    get pid() {
      return child.pid;
    },
    postMessage: (m: ExtractRequest) => child.postMessage(m),
    kill: () => child.kill(),
    onMessage: (fn) => void child.on('message', fn),
    onExit: (fn) => void child.on('exit', fn),
  };
}

/** The folder with pdf.js's cMaps and fonts: beside the renderer in a build, in the source tree for a dev run (P-12). */
export function pdfjsAssetsDir(mainDir: string): string {
  const built = path.join(mainDir, '../renderer/pdfjs');
  if (fs.existsSync(built)) return built;
  return path.join(mainDir, '../../src/renderer/public/pdfjs');
}
