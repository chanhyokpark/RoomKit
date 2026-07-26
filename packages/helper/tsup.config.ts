import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    // resolve inlines shared's type declarations; without it the emitted d.ts
    // keeps `import ... from '@roomkit/shared'`, which consumers can't
    // resolve. Must be `true`, not ['@roomkit/shared']: the narrow form
    // leaves shared's internal `./json.js`-style imports dangling.
    dts: { resolve: true },
    sourcemap: true,
    clean: true,
  },
  {
    // <script> embed for websites shown inside the player's iframe. global.ts
    // assigns window.RoomKitHelper itself (tsup's globalName would nest the
    // export as RoomKitHelper.RoomKitHelper).
    entry: { 'roomkit-helper': 'src/global.ts' },
    format: ['iife'],
    sourcemap: true,
    minify: true,
  },
]);
