import { defineConfig } from 'tsup';

/**
 * Runs AFTER svelte-package (see the build script). svelte-package emits
 * dist/core.js importing @roomkit/helper and @roomkit/hintphone-core —
 * private workspace packages consumers can't resolve — so this pass
 * overwrites dist/core.js (+ .d.ts) with a self-contained bundle. The shipped
 * .svelte files import './core.js' and pick the bundle up. Only the
 * transport-less controller/counter are imported from hintphone-core, so the
 * client (and socket.io-client) is tree-shaken away. zod stays external (in
 * dependencies).
 */
export default defineConfig({
  entry: { core: 'src/lib/core.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: { resolve: true },
  sourcemap: true,
  clean: false,
  noExternal: ['@roomkit/helper', '@roomkit/hintphone-core'],
});
