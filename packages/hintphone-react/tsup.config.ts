import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // resolve inlines hintphone-core's declarations (which already inline
  // client/helper/shared); see packages/client/tsup.config.ts.
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  // hintphone-core is a private workspace package; its dist already bundles
  // client/helper/shared, so bundling it makes this dist installable outside
  // the monorepo. socket.io-client/zod stay external (in dependencies).
  noExternal: ['@roomkit/hintphone-core'],
  external: ['react'],
});
