import type { SystemTrigger } from '@roomkit/shared';

/** Korean display names for the system hook triggers. */
export const SYSTEM_TRIGGER_LABELS: Record<SystemTrigger, string> = {
	'session:start': '세션 시작',
	'phase:enter': '페이즈 시작',
	'phase:leave': '페이즈 종료',
	'timer:expired': '타이머 만료'
};

/** Trigger name for display: system hooks map to Korean, device names pass through. */
export function triggerNameLabel(triggerName: string | null): string | null {
	if (triggerName === null) return null;
	return SYSTEM_TRIGGER_LABELS[triggerName as SystemTrigger] ?? triggerName;
}
