import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/** One preload per window kind: each page sees only its window's part of the API. */
const preload = (kind: 'main' | 'settings' | 'sheet') => fileURLToPath(new URL(`src/preload/${kind}.ts`, import.meta.url));

export default defineConfig({
  main: {},
  preload: {
    build: {
      // A sandboxed preload must be one CommonJS file: it cannot require a sibling chunk, so each entry is bundled on
      // its own with everything it imports (isolatedEntries; electron-vite asks for externalizeDeps off with it).
      isolatedEntries: true,
      externalizeDeps: false,
      rollupOptions: {
        input: { main: preload('main'), settings: preload('settings'), sheet: preload('sheet') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
