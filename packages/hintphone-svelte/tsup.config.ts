import { defineConfig } from 'tsup';

/**
 * Runs AFTER svelte-package (see the build script). svelte-package emits
 * dist/core.js as a bare re-export of @roomkit/hintphone-core — a private
 * workspace package consumers can't resolve — so this pass overwrites
 * dist/core.js (+ .d.ts) with a self-contained bundle. The shipped .svelte
 * files import './core.js' and pick the bundle up. socket.io-client/zod stay
 * external (in dependencies).
 */
export default defineConfig({
  entry: { core: 'src/lib/core.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: { resolve: true },
  sourcemap: true,
  clean: false,
  noExternal: ['@roomkit/hintphone-core'],
});
