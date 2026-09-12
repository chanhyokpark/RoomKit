import type { PlayerLink, SessionResponse } from '@roomkit/shared';
import { api, ApiError } from '../api';
import { vlog } from '../log';
import { isMobile } from '../tauri';
import { openDebugWindow, openTestDeviceWindow } from '../windows';
import { auth } from './auth.svelte';
import { config } from './config.svelte';
import { player } from './player.svelte';
import { testSetup } from './test-setup.svelte';

export interface PendingLaunch {
	link: PlayerLink;
	/** The link names a server other than the configured one — needs the user's OK. */
	serverMismatch: boolean;
}

function configuredServer(): string {
	return config.serverUrl.trim().replace(/\/+$/, '');
}

/**
 * Opens test sessions handed to the launcher from outside: `roomkit-player://`
 * app links (Studio, `rk dev`) and the test tab's "open by session id" box.
 * Both end in {@link openSession}, which fetches the session's device codes
 * and opens the same windows a `test:start` push would.
 *
 * App links are untrusted input (any web page can fire one), so a link that
 * points at a different server waits for confirmation, and nothing opens
 * without an admin login.
 */
class LaunchStore {
	pending = $state<PendingLaunch | null>(null);
	status = $state<'idle' | 'opening' | 'done' | 'error'>('idle');
	error = $state('');
	/** Session opened last, for the launcher's status line. */
	lastSessionId = $state<string | null>(null);

	/** Entry point for app links. */
	handle(link: PlayerLink): void {
		this.error = '';
		this.status = 'idle';
		const mismatch = link.server !== null && link.server !== configuredServer();
		this.pending = { link, serverMismatch: mismatch };
		if (!mismatch) void this.resume();
	}

	/** Switch to the link's server and continue (user confirmed). */
	async accept(): Promise<void> {
		const pending = this.pending;
		if (!pending?.link.server) return;
		config.serverUrl = pending.link.server;
		await config.save();
		player.reconnectSoon();
		// The stored admin credentials belong to the old server; a fresh login
		// will be asked for if they do not work there.
		auth.token = null;
		pending.serverMismatch = false;
		await this.resume();
	}

	dismiss(): void {
		this.pending = null;
		this.status = 'idle';
		this.error = '';
	}

	/**
	 * Runs the pending link if it can run now: server agreed and, for a test
	 * session, an admin login available (stored credentials are tried). Called
	 * again after a manual login.
	 */
	async resume(): Promise<void> {
		const pending = this.pending;
		if (!pending || pending.serverMismatch) return;
		if (pending.link.action === 'launch') {
			this.pending = null;
			return;
		}
		if (!auth.loggedIn && !(await auth.relogin())) {
			// Stays pending; the launcher shows a login prompt and calls resume() after.
			return;
		}
		const { sessionId, source } = pending.link;
		this.pending = null;
		// Studio has its own session dashboard open next to the link it fired;
		// a second one in the player would only fight it for the operator.
		await this.openSession(sessionId, { debugWindow: source !== 'studio' });
	}

	/** Open the stage windows (and, by default, the debug window) of an existing test session. */
	async openSession(
		sessionId: string,
		{ debugWindow = true }: { debugWindow?: boolean } = {}
	): Promise<boolean> {
		const id = sessionId.trim();
		if (!id) return false;
		this.status = 'opening';
		this.error = '';
		try {
			if (!auth.loggedIn && !(await auth.relogin())) {
				throw new Error('테스트 세션을 열려면 관리자 로그인이 필요합니다.');
			}
			const session = await api<SessionResponse>(`/sessions/${encodeURIComponent(id)}`);
			if (session.mode !== 'test') throw new Error('테스트 세션만 열 수 있습니다.');
			if (session.state === 'ended') throw new Error('이미 종료된 세션입니다.');
			const devices = session.testDeviceCodes ?? [];
			if (devices.length === 0) throw new Error('이 세션에는 장치 코드가 없습니다.');
			vlog('launch', 'opening session', id, devices.length, { debugWindow });
			const mobile = await isMobile();
			if (mobile) {
				// One webview: the launcher itself becomes the first device's stage.
				await openTestDeviceWindow(session.id, devices[0]!);
			} else {
				for (const device of devices) await openTestDeviceWindow(session.id, device);
				if (debugWindow) await openDebugWindow(session.id, session.themeId);
				// Keep the test tab in step so the theme's devices show up there.
				if (config.selectedThemeId !== session.themeId) void testSetup.selectTheme(session.themeId);
			}
			testSetup.lastSessionId = session.id;
			this.lastSessionId = session.id;
			this.status = 'done';
			return true;
		} catch (err) {
			this.status = 'error';
			this.error =
				err instanceof ApiError
					? err.status === 404
						? '세션을 찾을 수 없습니다.'
						: err.message
					: err instanceof Error
						? err.message
						: '세션을 열지 못했습니다.';
			vlog('launch', 'open failed', err);
			return false;
		}
	}
}

export const launch = new LaunchStore();
