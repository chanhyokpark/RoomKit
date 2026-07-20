import { api } from '$lib/api/client';

const TOKEN_KEY = 'roomkit.token';

/** Admin auth state. Safe to read localStorage at init — the app is CSR-only. */
class AuthStore {
	token = $state<string | null>(localStorage.getItem(TOKEN_KEY));

	get isAuthenticated(): boolean {
		return this.token !== null;
	}

	async login(id: string, password: string): Promise<void> {
		const { accessToken } = await api<{ accessToken: string }>('/auth/login', {
			method: 'POST',
			body: { id, password }
		});
		this.token = accessToken;
		localStorage.setItem(TOKEN_KEY, accessToken);
	}

	logout(): void {
		this.token = null;
		localStorage.removeItem(TOKEN_KEY);
	}
}

export const auth = new AuthStore();
