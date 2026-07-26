import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  banner: {
    // Shebang + a real `require` so the bundled CJS @roomkit/shared can load
    // its external deps (zod) from ESM output.
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
  // Shared is a CJS workspace package; bundling it makes dist self-contained.
  noExternal: ['@roomkit/shared'],
});
