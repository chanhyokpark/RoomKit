import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // resolve inlines helper/hintphone-core declarations (which already inline
  // shared); see packages/client/tsup.config.ts.
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  // helper and hintphone-core are private workspace packages; bundling them
  // makes this dist installable outside the monorepo. Only the transport-less
  // controller/counter are imported from hintphone-core, so the client (and
  // socket.io-client) is tree-shaken away. zod stays external (in dependencies).
  noExternal: ['@roomkit/helper', '@roomkit/hintphone-core'],
  external: ['react'],
  // rollup pass that actually drops hintphone-core's client transport (esbuild
  // keeps it, dragging the whole socket.io-client bundle in).
  treeshake: true,
});
