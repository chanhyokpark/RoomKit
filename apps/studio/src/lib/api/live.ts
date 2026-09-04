import { io } from 'socket.io-client';
import { PUBLIC_API_URL } from '$env/static/public';
import { ADMIN_NAMESPACE, AdminEvents, ThemeAssetsChangedSchema } from '@roomkit/shared';
import { auth } from '$lib/stores/auth.svelte';

/**
 * Subscribes to /admin `theme:assets` broadcasts so studio views refetch when
 * anyone (another tab, another operator) changes this theme's assets or tags.
 * `onchange` also fires on reconnect — changes made while disconnected are
 * only visible via a fresh fetch. Returns an unsubscribe function.
 */
export function watchThemeAssets(themeId: string, onchange: () => void): () => void {
	const socket = io(`${PUBLIC_API_URL}${ADMIN_NAMESPACE}`, {
		auth: { token: auth.token ?? '' }
	});
	let firstConnect = true;
	socket.on('connect', () => {
		if (!firstConnect) onchange();
		firstConnect = false;
	});
	socket.on('connect_error', (err: Error) => {
		// REST calls surface auth failures; a dead watch socket just stays quiet.
		if (err.message === 'unauthorized') socket.disconnect();
	});
	socket.on(AdminEvents.themeAssets, (payload: unknown) => {
		const parsed = ThemeAssetsChangedSchema.safeParse(payload);
		if (parsed.success && parsed.data.themeId === themeId) onchange();
	});
	return () => {
		socket.disconnect();
	};
}
