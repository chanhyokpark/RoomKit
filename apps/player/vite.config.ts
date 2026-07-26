import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	resolve: {
		alias: {
			// Compile both workspace libs from source in dev AND build (same
			// rationale as studio: the built dist goes through vite's dep
			// prebundle cache, which only invalidates on lockfile changes, and
			// kept serving stale schemas).
			'@roomkit/shared': fileURLToPath(
				new URL('../../packages/shared/src/index.ts', import.meta.url)
			),
			'@roomkit/client': fileURLToPath(
				new URL('../../packages/client/src/index.ts', import.meta.url)
			)
		}
	},
	plugins: [
		tailwindcss(),
		svelte({
			compilerOptions: {
				// Force runes mode for the project, except for libraries.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			}
		})
	],
	// Tauri expects a fixed dev port (studio owns 5173/5174). For mobile dev
	// the CLI exports TAURI_DEV_HOST — the server must listen on that address
	// so the device/emulator can reach it (HMR gets its own port).
	server: {
		port: 5175,
		strictPort: true,
		host: process.env.TAURI_DEV_HOST || false,
		hmr: process.env.TAURI_DEV_HOST
			? { protocol: 'ws', host: process.env.TAURI_DEV_HOST, port: 5176 }
			: undefined
	},
	clearScreen: false,
	envPrefix: ['VITE_', 'TAURI_']
});
