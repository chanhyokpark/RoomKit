import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/stores/auth.svelte';
import { themesStore } from '$lib/stores/themes.svelte';

// Runs in the browser only (ssr = false). Expired tokens are caught by the
// API client's 401 handling.
export async function load() {
	if (!auth.isAuthenticated) redirect(302, '/login');
	if (!themesStore.loaded) await themesStore.refresh();
}
