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
	// Tauri expects a fixed dev port (studio owns 5173).
	server: { port: 5174, strictPort: true },
	clearScreen: false,
	envPrefix: ['VITE_', 'TAURI_']
});
