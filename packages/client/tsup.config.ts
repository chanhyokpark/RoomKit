import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // resolve inlines shared's type declarations; without it the emitted d.ts
  // keeps `import ... from '@roomkit/shared'`, which consumers can't
  // resolve. Must be `true`, not ['@roomkit/shared']: the narrow form
  // leaves shared's internal `./json.js`-style imports dangling.
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  // Shared is a private CJS workspace package; bundle it so the dist is
  // installable outside the monorepo. Zod must come along: shared loads it
  // via require(), which esbuild turns into a runtime throw in browser ESM.
  noExternal: ['@roomkit/shared', 'zod'],
});
