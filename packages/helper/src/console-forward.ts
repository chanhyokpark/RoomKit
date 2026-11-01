import type { HelperLogLevel } from '@roomkit/shared';

/** One captured line: the `HelperLog` envelope minus source/type. */
export interface ConsoleLine {
  at: number;
  level: HelperLogLevel;
  message: string;
}

type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';
type ListenTarget = { addEventListener: Window['addEventListener']; removeEventListener: Window['removeEventListener'] };

const LEVELS: Record<ConsoleMethod, HelperLogLevel> = {
  log: 'info',
  info: 'info',
  debug: 'debug',
  warn: 'warn',
  error: 'error',
};
/** Lines kept until the player opts in; the oldest go first. */
const BUFFER_LIMIT = 100;
/** At most this many lines per window; the rest are counted and dropped. */
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 1000;
const ARG_LIMIT = 600;
const LINE_LIMIT = 2000;

/*
 * Live forwarders of this page, newest last. Only the newest records, so
 * two helper instances (or two bundled copies of this package, hence the
 * global symbol) never forward a line twice; destroying it hands recording
 * back to the previous one.
 */
const STACK_KEY = Symbol.for('roomkit-helper.console-forwarders');
function stack(): unknown[] {
  const g = globalThis as unknown as Record<symbol, unknown[] | undefined>;
  return (g[STACK_KEY] ??= []);
}

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

function formatArg(arg: unknown): string {
  let text: string;
  try {
    if (typeof arg === 'string') text = arg;
    else if (arg instanceof Error) text = `${arg.name}: ${arg.message}`;
    else if (arg === undefined) text = 'undefined';
    else if (typeof arg === 'function') text = `[function ${arg.name || 'anonymous'}]`;
    else text = JSON.stringify(arg) ?? String(arg);
  } catch {
    // Cycles, BigInt, hostile toJSON — fall back to the plain string form.
    try {
      text = String(arg);
    } catch {
      text = '[unprintable]';
    }
  }
  return clip(text, ARG_LIMIT);
}

const formatArgs = (args: unknown[]) => args.map(formatArg).join(' ');

/**
 * Captures the website's console output and uncaught errors for the player's
 * device logs. The console methods are wrapped (original first, then
 * record); lines are buffered until `setForwarding(true)` — the player's
 * `mode` message with `forwardLogs` — and then handed to `post` in order.
 * Never throws into the page and never re-enters itself.
 */
export class ConsoleForwarder {
  private forwarding = false;
  private destroyed = false;
  private buffer: ConsoleLine[] = [];
  private windowStart = 0;
  private windowCount = 0;
  private dropped = 0;
  private dropTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set while recording/posting: a console call made from in there is skipped. */
  private busy = false;
  private readonly undo: (() => void)[] = [];

  constructor(
    private readonly post: (line: ConsoleLine) => void,
    target: ListenTarget,
  ) {
    stack().push(this);
    if (typeof console !== 'undefined') {
      for (const method of Object.keys(LEVELS) as ConsoleMethod[]) this.wrap(method);
    }
    const onError = (event: Event) => {
      const e = event as ErrorEvent;
      this.capture('error', () => {
        const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
        return `Uncaught ${e.message || formatArg(e.error)}${where}`;
      });
    };
    const onRejection = (event: Event) =>
      this.capture('error', () => `Unhandled rejection: ${formatArg((event as PromiseRejectionEvent).reason)}`);
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    this.undo.push(() => {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onRejection);
    });
  }

  private wrap(method: ConsoleMethod): void {
    const original = console[method];
    if (typeof original !== 'function') return;
    const level = LEVELS[method];
    const wrapper = (...args: unknown[]) => {
      original.apply(console, args);
      this.capture(level, () => formatArgs(args));
    };
    console[method] = wrapper;
    // Someone may have wrapped on top of us since; then our wrapper stays in
    // their chain but no longer records (we left the stack).
    this.undo.push(() => {
      if (console[method] === wrapper) console[method] = original;
    });
  }

  /** The player opted in (or out); opting in flushes the buffered lines in order. */
  setForwarding(on: boolean): void {
    if (this.destroyed || this.forwarding === on) return;
    this.forwarding = on;
    if (!on) return;
    const lines = this.buffer;
    this.buffer = [];
    this.guarded(() => {
      for (const line of lines) this.post(line);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const list = stack();
    const index = list.indexOf(this);
    if (index >= 0) list.splice(index, 1);
    for (const undo of this.undo.splice(0)) undo();
    if (this.dropTimer !== null) clearTimeout(this.dropTimer);
    this.dropTimer = null;
    this.buffer = [];
  }

  private capture(level: HelperLogLevel, format: () => string): void {
    if (this.busy || this.destroyed) return;
    const list = stack();
    if (list[list.length - 1] !== this) return;
    this.guarded(() => {
      const now = Date.now();
      if (now - this.windowStart >= RATE_WINDOW_MS) {
        this.windowStart = now;
        this.windowCount = 0;
      }
      if (this.windowCount >= RATE_LIMIT) {
        // Formatting is skipped for dropped lines; one summary per window.
        if (this.dropped++ === 0) {
          this.dropTimer = setTimeout(
            () => this.reportDropped(),
            Math.max(0, this.windowStart + RATE_WINDOW_MS - now),
          );
        }
        return;
      }
      this.windowCount++;
      this.emit({ at: now, level, message: clip(format(), LINE_LIMIT) });
    });
  }

  private reportDropped(): void {
    this.dropTimer = null;
    const count = this.dropped;
    this.dropped = 0;
    if (count === 0 || this.destroyed) return;
    this.guarded(() =>
      this.emit({ at: Date.now(), level: 'warn', message: `console forwarding dropped ${count} lines` }),
    );
  }

  private emit(line: ConsoleLine): void {
    if (this.forwarding) {
      this.post(line);
      return;
    }
    this.buffer.push(line);
    if (this.buffer.length > BUFFER_LIMIT) this.buffer.shift();
  }

  private guarded(run: () => void): void {
    const wasBusy = this.busy;
    this.busy = true;
    try {
      run();
    } catch {
      // Logging must never break the page.
    } finally {
      this.busy = wasBusy;
    }
  }
}
