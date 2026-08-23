import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // resolve inlines the workspace packages' type declarations; without it the
  // emitted d.ts keeps `import ... from '@roomkit/client'`, which consumers
  // can't resolve (see packages/client/tsup.config.ts).
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  // The workspace packages are private; bundle them so the dist is
  // installable outside the monorepo. Their own externals (socket.io-client,
  // zod) stay in dependencies.
  noExternal: ['@roomkit/client', '@roomkit/helper', '@roomkit/shared'],
});
