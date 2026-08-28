import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	resolve: {
		alias: {
			// Compile @roomkit/shared from source in dev AND build. Consuming the
			// built dist went through vite's dep prebundle cache, which only
			// invalidates on lockfile changes — a rebuilt dist kept serving stale
			// schemas and silently broke parity with the server.
			'@roomkit/shared': fileURLToPath(
				new URL('../../packages/shared/src/index.ts', import.meta.url)
			),
			'@roomkit/session-ui': fileURLToPath(
				new URL('../../packages/session-ui/src/index.ts', import.meta.url)
			)
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node so the studio can run as a plain Node server in Docker.
			adapter: adapter()
		})
	]
});
