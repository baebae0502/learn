import os from 'node:os';
import type { ElectronApplication } from '@playwright/test';
import { IS_MAC, LABEL, tryExec, writeJson } from './capture';

interface DisplaySummary {
  gpu: string | null;
  cores: string | null;
  metal: string | null;
  displays: Array<{ name: string; resolution: string | null; pixels: string | null; main: boolean; retina: boolean }>;
}

/** `system_profiler SPDisplaysDataType -json`, reduced to what matters for screenshots. */
async function macDisplays(): Promise<DisplaySummary | { error: string }> {
  const r = await tryExec('system_profiler', ['SPDisplaysDataType', '-json'], 60_000);
  if (!r.ok) return { error: r.stderr.trim() };
  try {
    const gpus = (JSON.parse(r.stdout) as { SPDisplaysDataType?: Array<Record<string, unknown>> }).SPDisplaysDataType ?? [];
    const gpu = gpus[0] ?? {};
    const displays = ((gpu['spdisplays_ndrvs'] as Array<Record<string, unknown>> | undefined) ?? []).map((d) => ({
      name: String(d['_name'] ?? ''),
      resolution: (d['_spdisplays_resolution'] as string | undefined) ?? null,
      pixels: (d['_spdisplays_pixels'] as string | undefined) ?? null,
      main: d['spdisplays_main'] === 'spdisplays_yes',
      retina: String(d['spdisplays_display_type'] ?? '').includes('retina'),
    }));
    return {
      gpu: (gpu['sppci_model'] as string | undefined) ?? (gpu['_name'] as string | undefined) ?? null,
      cores: (gpu['sppci_cores'] as string | undefined) ?? null,
      metal: (gpu['spdisplays_mtlgpufamilysupport'] as string | undefined) ?? null,
      displays,
    };
  } catch (e) {
    return { error: `unparsable system_profiler output: ${(e as Error).message}` };
  }
}

async function macInfo(): Promise<Record<string, unknown>> {
  const swVers = await tryExec('sw_vers', []);
  const kv = Object.fromEntries(
    swVers.stdout
      .split('\n')
      .map((l) => l.split(':').map((x) => x.trim()))
      .filter((p) => p.length === 2 && p[0]),
  );
  const cpu = await tryExec('sysctl', ['-n', 'machdep.cpu.brand_string']);
  const model = await tryExec('sysctl', ['-n', 'hw.model']);
  return {
    swVers: kv,
    cpuBrand: cpu.stdout.trim(),
    hwModel: model.stdout.trim(),
    displays: await macDisplays(),
  };
}

/** Collect runner + app environment into evidence-results/env.json. */
export async function writeEnv(app: ElectronApplication): Promise<Record<string, unknown>> {
  const electron = await app.evaluate(async ({ app: a, screen, BrowserWindow }) => {
    // The main window by its URL (sheets and the settings window are windows too).
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('window=main'));
    let gpuInfo: unknown = null;
    try {
      gpuInfo = await a.getGPUInfo('basic');
    } catch (e) {
      gpuInfo = { error: String(e) };
    }
    return {
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        v8: process.versions.v8,
      },
      appName: a.getName(),
      appVersion: a.getVersion(),
      isPackaged: a.isPackaged,
      locale: a.getLocale(),
      preferredLanguages: a.getPreferredSystemLanguages(),
      gpuFeatureStatus: a.getGPUFeatureStatus(),
      gpuInfo,
      displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor })),
      windowBounds: w?.getBounds() ?? null,
      windowContentBounds: w?.getContentBounds() ?? null,
    };
  });
  const env = {
    label: LABEL,
    capturedAt: new Date().toISOString(),
    host: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? null,
      totalMemGiB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
      testRunnerNode: process.version,
    },
    ci: {
      ci: process.env['CI'] ?? null,
      runnerOs: process.env['RUNNER_OS'] ?? null,
      runnerArch: process.env['RUNNER_ARCH'] ?? null,
      imageOs: process.env['ImageOS'] ?? null,
      imageVersion: process.env['ImageVersion'] ?? null,
      runId: process.env['GITHUB_RUN_ID'] ?? null,
      sha: process.env['GITHUB_SHA'] ?? null,
      ref: process.env['GITHUB_REF_NAME'] ?? null,
    },
    mac: IS_MAC ? await macInfo() : null,
    electron,
  };
  writeJson('env.json', env, 'runner and app environment');
  return env;
}
