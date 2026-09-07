import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    // Shebang + a real `require` so the bundled CJS @roomkit/shared can load
    // its external deps (zod) from ESM output.
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
  // Bundle every dependency so dist/index.js runs standalone (installable
  // from git without a node_modules). ws's optional native addons stay
  // external; its try/catch require falls back to the JS implementation.
  noExternal: [/.*/],
  external: ['bufferutil', 'utf-8-validate'],
});
