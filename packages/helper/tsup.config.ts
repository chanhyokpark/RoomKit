import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
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
