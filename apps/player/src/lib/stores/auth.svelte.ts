import { vlog } from '../log';
import { config } from './config.svelte';

/**
 * Admin login for the test tab and debug window. Credentials persist in the
 * player config; the JWT (12h expiry) lives only in memory and is re-minted
 * on demand — including transparently after a 401 (see api.ts).
 */
class AuthStore {
	token = $state<string | null>(null);
	status = $state<'idle' | 'pending' | 'ok' | 'error'>('idle');
	error = $state('');

	get loggedIn(): boolean {
		return this.token !== null;
	}

	/** Login with fresh credentials; persists them on success. */
	async login(id: string, password: string): Promise<boolean> {
		this.status = 'pending';
		this.error = '';
		const token = await this.requestToken(id, password);
		if (token === null) return false;
		this.token = token;
		this.status = 'ok';
		config.auth = { id, password };
		await config.save();
		return true;
	}

	/** Silent (re)login with the stored credentials, e.g. on start or 401. */
	async relogin(): Promise<boolean> {
		const saved = config.auth;
		if (!saved) return false;
		const token = await this.requestToken(saved.id, saved.password);
		if (token === null) {
			this.token = null;
			return false;
		}
		this.token = token;
		this.status = 'ok';
		return true;
	}

	async logout(): Promise<void> {
		this.token = null;
		this.status = 'idle';
		this.error = '';
		config.auth = null;
		await config.save();
	}

	private async requestToken(id: string, password: string): Promise<string | null> {
		const serverUrl = config.serverUrl.trim().replace(/\/$/, '');
		try {
			const res = await fetch(`${serverUrl}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id, password })
			});
			if (!res.ok) {
				this.status = 'error';
				this.error = res.status === 401 ? '아이디 또는 비밀번호가 올바르지 않습니다.' : `로그인 실패 (${res.status})`;
				return null;
			}
			const body = (await res.json()) as { accessToken?: string };
			if (typeof body.accessToken !== 'string') {
				this.status = 'error';
				this.error = '서버 응답이 올바르지 않습니다.';
				return null;
			}
			vlog('auth', 'logged in');
			return body.accessToken;
		} catch (err) {
			this.status = 'error';
			this.error = '서버에 연결할 수 없습니다.';
			vlog('auth', 'login failed', err);
			return null;
		}
	}
}

export const auth = new AuthStore();
