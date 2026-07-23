/**
 * Simulated playback for placeholder (fileless) media: waits durationMs, then
 * fires onDone. Returns a cancel — cancelled timers never fire onDone.
 */
export function simulate(durationMs: number, onDone: () => void): () => void {
	const timer = setTimeout(onDone, durationMs);
	return () => clearTimeout(timer);
}
