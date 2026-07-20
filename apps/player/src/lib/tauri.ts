/**
 * Thin wrappers so the app also runs in a plain browser tab (`pnpm dev:web`)
 * with graceful fallbacks — useful for UI work without a Rust build.
 */
export function isTauri(): boolean {
	return '__TAURI_INTERNALS__' in window;
}

export async function platformName(): Promise<string> {
	if (!isTauri()) return 'web';
	const { platform } = await import('@tauri-apps/plugin-os');
	return platform();
}
