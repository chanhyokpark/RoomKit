import type { RoomKitClient } from '@roomkit/client';
import { DEVICE_LOG_REPORT_MAX_LINES, type DeviceLogLineInput } from '@roomkit/shared';
import { subscribeLogs, type LogLine } from './log';

/** Lines wait at most this long before an upload attempt. */
const FLUSH_INTERVAL_MS = 5000;
/** Lines kept while the socket is down; the oldest go first past this. */
const PENDING_LIMIT = 600;

let pending: DeviceLogLineInput[] = [];
let client: RoomKitClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;

function flush(): void {
	if (!client || pending.length === 0) return;
	const batch = pending.slice(0, DEVICE_LOG_REPORT_MAX_LINES);
	// An offline socket keeps the batch for the next tick.
	if (!client.reportLogs({ lines: batch })) return;
	pending = pending.slice(batch.length);
	if (pending.length > 0) flush();
}

/**
 * Ships this stage window's log lines (see log.ts) to the server over the
 * device socket in batches: every few seconds, and at once when something
 * an operator will want to read about happens (`flushDeviceLogs`). Lines
 * that arrive while the socket is down wait for the reconnect.
 */
export function startDeviceLogUploader(target: RoomKitClient): () => void {
	stopDeviceLogUploader();
	client = target;
	unsubscribe = subscribeLogs((line: LogLine) => {
		pending.push({ at: line.at, level: line.level, message: line.message });
		if (pending.length > PENDING_LIMIT) pending.splice(0, pending.length - PENDING_LIMIT);
	});
	timer = setInterval(flush, FLUSH_INTERVAL_MS);
	return stopDeviceLogUploader;
}

/** Upload whatever is pending now (session end, reconnection, errors). */
export function flushDeviceLogs(): void {
	flush();
}

export function stopDeviceLogUploader(): void {
	flush();
	unsubscribe?.();
	unsubscribe = null;
	if (timer) clearInterval(timer);
	timer = null;
	client = null;
	pending = [];
}
