import type { DeviceEvalRequest, DeviceEvalResult, DeviceScreenshotReport, EvalOutcome } from '@roomkit/shared';

type Pending = {
	request: DeviceEvalRequest;
	result?: EvalOutcome;
	finish: (result: DeviceEvalResult) => void;
};

/** One request follows one document through execution, paint and native capture. */
export class WebsiteEvaluator {
	private pending: Pending | null = null;
	private supported = false;

	constructor(private readonly io: {
		post: (request: DeviceEvalRequest) => void;
		isTest: () => boolean;
		afterPaint: () => Promise<void>;
		capture: (format: 'png' | 'jpeg') => Promise<DeviceScreenshotReport | null>;
	}) {}

	hello(supported: boolean): void {
		this.invalidate('Website reloaded');
		this.supported = supported;
	}

	invalidate(message: string): void {
		this.supported = false;
		const pending = this.pending;
		if (pending) pending.finish({ requestId: pending.request.requestId, result: {
			ok: false, error: { code: 'page_gone', message }
		} });
	}

	run(request: DeviceEvalRequest): Promise<DeviceEvalResult> {
		const fail = (code: string, message: string): DeviceEvalResult => ({
			requestId: request.requestId, result: { ok: false, error: { code, message } }
		});
		if (!this.io.isTest()) return Promise.resolve(fail('test_only', 'JS evaluation requires a live test session'));
		if (!this.supported) return Promise.resolve(fail('helper_unavailable', 'Wait for an updated Helper to load in the website'));
		if (this.pending) return Promise.resolve(fail('busy', 'Another evaluation is running'));
		return new Promise((resolve) => {
			const pending: Pending = {
				request,
				finish: (result) => {
					if (this.pending !== pending) return;
					clearTimeout(timer);
					this.pending = null;
					resolve(result);
				}
			};
			const timer = setTimeout(() => {
				if (pending.result) pending.finish({ requestId: request.requestId, result: pending.result,
					screenshotError: { code: 'capture_timeout', message: 'Fresh screenshot did not finish before the deadline' } });
				else pending.finish(fail('timeout', 'Website did not reply; execution may still be running. Reload before another evaluation.'));
			}, request.timeoutMs + 5000);
			this.pending = pending;
			try { this.io.post(request); }
			catch { pending.finish(fail('delivery_failed', 'Could not deliver the script to the website')); }
		});
	}

	async receive(requestId: string, result: EvalOutcome): Promise<void> {
		const pending = this.pending;
		if (!pending || pending.request.requestId !== requestId || pending.result) return;
		pending.result = result;
		if (!result.ok || !pending.request.screenshot) {
			pending.finish({ requestId, result });
			return;
		}
		try {
			await this.io.afterPaint();
			if (this.pending !== pending) return;
			const screenshot = await this.io.capture(pending.request.screenshotFormat);
			if (!screenshot) throw new Error('Native screenshot is unavailable or exceeds the size limit');
			pending.finish({ requestId, result, screenshot: { ...screenshot, capturedAt: Date.now() } });
		} catch (error) {
			pending.finish({ requestId, result, screenshotError: { code: 'capture_failed',
				message: (error instanceof Error ? error.message : String(error)).slice(0, 4000) } });
		}
	}
}

