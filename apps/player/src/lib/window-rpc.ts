import type {
	DeviceScreenshotReport,
	DeviceWindowRequest,
	DeviceWindowResult,
	DeviceWindowState
} from '@roomkit/shared';

export interface WindowRpcIo {
	isTest: () => boolean;
	/** Show / unminimize / focus the window and wait until it is visible. */
	focus: (timeoutMs: number) => Promise<void>;
	state: () => Promise<DeviceWindowState>;
	/** Two paint turns; rejects while the document is hidden. */
	afterPaint: () => Promise<void>;
	capture: (format: 'png' | 'jpeg') => Promise<DeviceScreenshotReport | null>;
}

const message = (error: unknown) =>
	(error instanceof Error ? error.message : String(error)).slice(0, 4000);

/**
 * `device:window` — the test-only window RPC. Unlike `device:eval` it needs
 * no website: focus and capture work on the idle screen and during video.
 * The focus step is bounded by the request's deadline; a capture failure
 * keeps the (successful) window state in the result.
 */
export async function answerWindowRequest(
	request: DeviceWindowRequest,
	io: WindowRpcIo
): Promise<DeviceWindowResult> {
	const fail = (code: string, text: string): DeviceWindowResult => ({
		requestId: request.requestId,
		result: { ok: false, error: { code, message: text } }
	});
	if (!io.isTest()) return fail('test_only', 'A window request requires a live test session');
	const deadline = Date.now() + request.timeoutMs;
	if (request.focus) {
		try {
			await io.focus(request.timeoutMs);
		} catch (error) {
			return fail('focus_failed', message(error));
		}
	}
	let value: DeviceWindowState;
	try {
		value = await io.state();
	} catch (error) {
		return fail('player_error', message(error));
	}
	const result: DeviceWindowResult = { requestId: request.requestId, result: { ok: true, value } };
	if (!request.screenshot) return result;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const capture = (async () => {
			await io.afterPaint();
			const shot = await io.capture(request.screenshotFormat);
			if (!shot) throw new Error('Native screenshot is unavailable or exceeds the size limit');
			return shot;
		})();
		const expired = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error('Fresh screenshot did not finish before the deadline')),
				Math.max(0, deadline - Date.now())
			);
		});
		const shot = await Promise.race([capture, expired]);
		result.screenshot = { ...shot, capturedAt: Date.now() };
	} catch (error) {
		result.screenshotError = { code: 'capture_failed', message: message(error) };
	} finally {
		clearTimeout(timer);
	}
	return result;
}
