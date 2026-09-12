import { isTauri } from './tauri';

/**
 * Player-side logging.
 *
 * Every window's console output, `vlog` lines and uncaught errors go two
 * ways: to tauri-plugin-log (stdout + a rotating `player.log` in the app log
 * dir, see src-tauri/src/lib.rs) and to in-window subscribers. A stage
 * window's subscriber is the device-log uploader, which ships the lines to
 * the server over the device socket so operators read them in the session
 * dashboard (Studio / debug window) without touching the machine.
 *
 * Verbose devtools output stays dev-only; the forwarding is on in every
 * Tauri build.
 */
export const verboseLogs = import.meta.env.DEV;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogLine {
	at: number;
	level: LogLevel;
	message: string;
}

const ARG_LIMIT = 600;
const LINE_LIMIT = 2400;

// Saved before any wrapper is installed: vlog and the wrappers print through
// these so devtools keep the original output and nothing re-enters itself.
const native = {
	log: console.log.bind(console),
	info: console.info.bind(console),
	debug: console.debug.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console)
};

let windowLabel = 'web';
let plugin: Record<LogLevel, (message: string) => Promise<void>> | null = null;
const subscribers = new Set<(line: LogLine) => void>();

function formatArg(arg: unknown): string {
	let text: string;
	if (typeof arg === 'string') text = arg;
	else if (arg instanceof Error) text = `${arg.name}: ${arg.message}`;
	else if (arg === undefined) text = 'undefined';
	else {
		try {
			text = JSON.stringify(arg) ?? String(arg);
		} catch {
			text = String(arg);
		}
	}
	return text.length > ARG_LIMIT ? `${text.slice(0, ARG_LIMIT - 1)}…` : text;
}

export function formatLogArgs(args: unknown[]): string {
	const line = args.map(formatArg).join(' ');
	return line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT - 1)}…` : line;
}

function record(level: LogLevel, message: string): void {
	const line: LogLine = { at: Date.now(), level, message };
	for (const fn of subscribers) fn(line);
	void plugin?.[level](`[${windowLabel}] ${message}`).catch(() => {});
}

/** Receive every log line of this window (from the moment of subscribing). */
export function subscribeLogs(fn: (line: LogLine) => void): () => void {
	subscribers.add(fn);
	return () => subscribers.delete(fn);
}

export function vlog(scope: string, ...args: unknown[]): void {
	if (verboseLogs) native.log(`[player:${scope}]`, ...args);
	record('info', `${scope}: ${formatLogArgs(args)}`);
}

let installed = false;

/**
 * Wraps the console and error events of this window so everything reaches
 * `record`. Tauri builds also get the log plugin; the browser harness only
 * feeds subscribers. Called once per window before the app mounts; never
 * throws.
 */
export async function installGlobalLogging(): Promise<void> {
	if (installed) return;
	installed = true;
	if (isTauri()) {
		try {
			const [{ getCurrentWindow }, log] = await Promise.all([
				import('@tauri-apps/api/window'),
				import('@tauri-apps/plugin-log')
			]);
			windowLabel = getCurrentWindow().label;
			plugin = { debug: log.debug, info: log.info, warn: log.warn, error: log.error };
		} catch (err) {
			native.warn('[player:log] log plugin unavailable', err);
		}
	}
	const wrap = (method: keyof typeof native, level: LogLevel) => {
		console[method] = (...args: unknown[]) => {
			native[method](...args);
			record(level, formatLogArgs(args));
		};
	};
	wrap('log', 'info');
	wrap('info', 'info');
	wrap('debug', 'debug');
	wrap('warn', 'warn');
	wrap('error', 'error');
	window.addEventListener('error', (event) => {
		record('error', `Uncaught ${event.message} (${event.filename}:${event.lineno}:${event.colno})`);
	});
	window.addEventListener('unhandledrejection', (event) => {
		record('error', `Unhandled rejection: ${formatArg(event.reason)}`);
	});
	record('info', `window opened ${window.location.search || '(launcher)'}`);
}
